/**
 * SDK SenePay pour Node.js — initiation et vérification de paiements.
 *
 * ============================================================================
 * CE SDK S'EXÉCUTE CÔTÉ SERVEUR. IL NE DOIT JAMAIS ÊTRE CHARGÉ DANS UNE PAGE.
 * ============================================================================
 *
 * La version précédente était pensée pour le navigateur : elle exposait un
 * constructeur `new SenePay(apiKey)` et une méthode `openCheckout()` qui
 * ouvrait une fenêtre de paiement depuis la page. Elle s'attachait même à
 * `window.SenePay`.
 *
 * Le problème n'est pas une URL à corriger, c'est le modèle lui-même : pour
 * appeler l'API SenePay il faut une clé ET un secret. Tout code exécuté dans
 * un navigateur est lisible par n'importe qui — il suffit d'ouvrir les outils
 * de développement. Un marchand qui suivait cette documentation publiait donc
 * son secret `sk_live_` sur son propre site. Avec ce secret, un tiers peut
 * consulter les transactions du marchand et en initier en son nom.
 *
 * La règle, universelle chez les prestataires de paiement : le secret ne quitte
 * jamais le serveur. Le navigateur ne reçoit qu'une URL de redirection, déjà
 * créée côté serveur, qui ne permet de payer qu'une seule transaction.
 *
 * Ce que la version précédente cassait aussi, au passage :
 *   • elle appelait `/checkout/sessions` avec `Authorization: Bearer`, alors
 *     que l'API expose `/payments/initiate` et attend `X-Api-Key` +
 *     `X-Api-Secret`. Aucun appel n'aboutissait ;
 *   • `openCheckout()` concluait au succès sur la simple fermeture de la
 *     fenêtre, en interrogeant un point d'entrée inexistant. Une fenêtre fermée
 *     ne prouve rien : seul le serveur SenePay sait si l'argent est arrivé.
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *
 *   const SenePay = require('@senepay/sdk');
 *   const senepay = new SenePay({
 *     apiKey: process.env.SENEPAY_API_KEY,       // pk_live_…
 *     apiSecret: process.env.SENEPAY_API_SECRET, // sk_live_… — côté serveur uniquement
 *   });
 *
 *   // 1. Sur votre serveur, à la validation du panier :
 *   const paiement = await senepay.initierPaiement({
 *     montant: 5000,                       // en FCFA — PAS en centimes
 *     referenceCommande: 'CMD-2026-00123',
 *     libelle: 'Commande #123',
 *     telephoneClient: '221771234567',     // obligatoire
 *     urlRetour: 'https://boutique.sn/merci',
 *     urlNotification: 'https://boutique.sn/webhooks/senepay',
 *   });
 *   res.redirect(paiement.urlPaiement);
 *
 *   // 2. Dans votre webhook, ne JAMAIS croire le corps reçu :
 *   const etat = await senepay.verifierPaiement(jeton);
 *   if (etat.paye) {
 *     // livrer la commande
 *   }
 */

'use strict';

const BASE_PAR_DEFAUT = 'https://api.sene-pay.com/api/v1';

/** Le franc CFA n'a pas de sous-unité ; SenePay refuse en dessous de ce seuil. */
const MONTANT_MINIMUM_XOF = 200;

class ErreurSenePay extends Error {
  constructor(message, { statut, corps } = {}) {
    super(message);
    this.name = 'ErreurSenePay';
    this.statut = statut;
    this.corps = corps;
  }
}

class SenePay {
  /**
   * @param {object} options
   * @param {string} options.apiKey     Clé publique (pk_live_… ou pk_test_…).
   * @param {string} options.apiSecret  Secret (sk_live_…). Ne doit jamais atteindre un navigateur.
   * @param {string} [options.baseUrl]  Pour pointer vers un environnement de test.
   * @param {number} [options.timeoutMs=30000]
   */
  constructor({ apiKey, apiSecret, baseUrl = BASE_PAR_DEFAUT, timeoutMs = 30000 } = {}) {
    // Garde-fou explicite : si quelqu'un empaquète ce module pour le navigateur,
    // il doit s'en apercevoir tout de suite, et non le jour où son secret fuite.
    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
      throw new ErreurSenePay(
        "Le SDK SenePay ne doit pas être exécuté dans un navigateur : votre secret API y serait lisible par tous. " +
        "Créez le paiement depuis votre serveur et ne transmettez au navigateur que l'URL de redirection."
      );
    }
    if (!apiKey || !apiSecret) {
      throw new ErreurSenePay('apiKey et apiSecret sont requis.');
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  /** @private */
  get _entetes() {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
      'X-Api-Secret': this.apiSecret,
      'X-Sdk': 'node/2.0.0',
    };
  }

  /** @private */
  async _appeler(chemin, options = {}) {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), this.timeoutMs);
    try {
      const reponse = await fetch(`${this.baseUrl}${chemin}`, {
        ...options,
        headers: this._entetes,
        signal: controleur.signal,
      });
      const corps = await reponse.json().catch(() => null);
      return { statut: reponse.status, ok: reponse.ok, corps };
    } finally {
      clearTimeout(minuteur);
    }
  }

  /**
   * Crée une transaction et renvoie l'URL de la page de paiement.
   *
   * @returns {Promise<{urlPaiement: string, jeton: string|null, brut: object}>}
   */
  async initierPaiement({
    montant,
    referenceCommande,
    libelle,
    telephoneClient,
    urlRetour,
    urlNotification,
    devise = 'XOF',
    nomClient,
    emailClient,
    urlAnnulation,
    metadonnees = {},
  }) {
    if (!Number.isFinite(Number(montant))) {
      throw new ErreurSenePay('montant doit être un nombre, exprimé en FCFA.');
    }
    if (Number(montant) < MONTANT_MINIMUM_XOF) {
      throw new ErreurSenePay(`Le montant minimum accepté est de ${MONTANT_MINIMUM_XOF} FCFA.`);
    }
    // SenePay refuse toute transaction sans numéro : autant le dire ici,
    // clairement, plutôt que de laisser l'API répondre une erreur opaque.
    if (!telephoneClient) {
      throw new ErreurSenePay(
        "telephoneClient est obligatoire : SenePay refuse toute transaction sans numéro de téléphone du payeur."
      );
    }
    if (!urlRetour || !urlNotification) {
      throw new ErreurSenePay('urlRetour et urlNotification sont requis.');
    }

    const { statut, ok, corps } = await this._appeler('/payments/initiate', {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(montant),
        currency: devise,
        orderId: referenceCommande,
        itemName: libelle,
        customerName: nomClient || emailClient || 'Client',
        customerEmail: emailClient || '',
        customerPhone: telephoneClient,
        returnUrl: urlRetour,
        cancelUrl: urlAnnulation || urlRetour,
        notifyUrl: urlNotification,
        metadata: metadonnees,
      }),
    });

    if (!ok) {
      // `erreur` porte la cause utile ; `message` n'est qu'un intitulé générique.
      const cause = corps?.erreur || corps?.failedReason || corps?.message || `HTTP ${statut}`;
      throw new ErreurSenePay(cause, { statut, corps });
    }

    /*
     * SenePay peut refuser À L'INTÉRIEUR d'une réponse 200, et la lecture est
     * contre-intuitive :
     *
     *   { "statut": true,                 <- la demande a été reçue
     *     "message": "Paiement initié.",  <- rassurant, et trompeur
     *     "redirectUrl": null,
     *     "status": "Failed",             <- le VRAI résultat
     *     "failedReason": "Montant trop élevé" }
     *
     * `statut` dit que la requête est passée ; `status` dit si la transaction vit.
     */
    const etat = String(corps?.status ?? '').toLowerCase();
    if (corps?.statut === false || ['failed', 'rejected', 'cancelled'].includes(etat)) {
      const raison = corps?.failedReason || corps?.message || 'SenePay a refusé la transaction.';
      throw new ErreurSenePay(raison, { statut, corps });
    }

    const urlPaiement = corps?.redirectUrl || corps?.redirect_url || corps?.data?.redirectUrl;
    if (!urlPaiement) {
      throw new ErreurSenePay("SenePay n'a pas renvoyé d'URL de paiement.", { statut, corps });
    }

    return {
      urlPaiement,
      jeton: corps?.token || corps?.tokenPay || corps?.internalId || null,
      brut: corps,
    };
  }

  /**
   * Demande à SenePay si une transaction est réellement réglée.
   *
   * C'est la SEULE source de vérité. Le corps d'un webhook n'est qu'un signal :
   * n'importe qui peut poster sur votre point d'entrée public en annonçant un
   * paiement réussi. Appelez toujours cette méthode avant de livrer.
   *
   * @returns {Promise<{paye: boolean, definitif: boolean, statut: string, brut: any}>}
   */
  async verifierPaiement(jeton) {
    if (!jeton) throw new ErreurSenePay('jeton requis.');

    let reponse;
    try {
      reponse = await this._appeler(`/${encodeURIComponent(jeton)}/status`, { method: 'GET' });
    } catch (err) {
      // Réseau coupé ou délai dépassé : on ne conclut RIEN. Marquer un échec
      // ici condamnerait le paiement d'un client qui a pourtant payé.
      return { paye: false, definitif: false, statut: 'injoignable', brut: String(err && err.message) };
    }

    const { statut: code, ok, corps } = reponse;
    if (!ok || !corps) {
      return { paye: false, definitif: false, statut: `http_${code}`, brut: corps };
    }

    const charge = corps.data || corps;
    const etat = String(charge.status ?? charge.payment_status ?? '').toLowerCase();

    if (['paid', 'completed', 'success', 'successful', 'approved'].includes(etat)) {
      return { paye: true, definitif: true, statut: etat, brut: corps };
    }
    if (['failed', 'cancelled', 'canceled', 'declined', 'expired', 'refused'].includes(etat)) {
      return { paye: false, definitif: true, statut: etat, brut: corps };
    }
    // Statut intermédiaire : réponse valide mais non finale. On réessaiera.
    return { paye: false, definitif: false, statut: etat || 'inconnu', brut: corps };
  }
}

module.exports = SenePay;
module.exports.SenePay = SenePay;
module.exports.ErreurSenePay = ErreurSenePay;
module.exports.MONTANT_MINIMUM_XOF = MONTANT_MINIMUM_XOF;
