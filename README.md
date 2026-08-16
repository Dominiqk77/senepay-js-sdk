# SDK SenePay pour Node.js

Encaissez **Orange Money, Wave et Free Money** depuis votre serveur.

> ### ⚠️ Ce SDK s'exécute côté serveur. Jamais dans un navigateur.
>
> Appeler l'API SenePay exige une clé **et** un secret. Tout code exécuté dans
> une page web est lisible par n'importe qui. Placer votre `sk_live_…` dans du
> JavaScript de navigateur revient à le publier.
>
> Le SDK refuse d'ailleurs de démarrer s'il détecte un environnement navigateur.

Node.js 18 ou plus récent (`fetch` et `AbortController` natifs).

---

## Installation

```bash
npm install senepay-js
```

## Utilisation

### 1. Créer le paiement — sur votre serveur

```js
const SenePay = require('senepay-js');

const senepay = new SenePay({
  apiKey: process.env.SENEPAY_API_KEY,        // pk_live_…
  apiSecret: process.env.SENEPAY_API_SECRET,  // sk_live_… — ne sort jamais du serveur
});

app.post('/commander', async (req, res) => {
  const paiement = await senepay.initierPaiement({
    montant: 5000,                        // en FCFA — PAS en centimes
    referenceCommande: 'CMD-2026-00123',
    libelle: 'Commande #123',
    telephoneClient: '221771234567',      // obligatoire
    nomClient: 'Awa Diop',
    emailClient: 'awa@example.sn',
    urlRetour: 'https://boutique.sn/merci',
    urlNotification: 'https://boutique.sn/webhooks/senepay',
    metadonnees: { commandeId: 123 },
  });

  res.redirect(paiement.urlPaiement);
});
```

Le navigateur ne reçoit qu'une URL de redirection, valable pour cette seule
transaction. Aucun secret ne le traverse.

### 2. Confirmer le paiement — dans votre webhook

```js
app.post('/webhooks/senepay', async (req, res) => {
  // Ce point d'entrée est PUBLIC. Le corps reçu n'est qu'un signal.
  const jeton = req.body.token || req.body.tokenPay;

  const etat = await senepay.verifierPaiement(jeton);

  if (etat.paye) {
    // livrer la commande — une seule fois (prévoyez une clé d'idempotence)
    return res.status(200).json({ ok: true });
  }

  if (etat.definitif) {
    return res.status(200).json({ ok: false, statut: etat.statut });
  }

  // Ni payé ni refusé de façon certaine : demandez à SenePay de relancer.
  return res.status(503).json({ ok: false, relancer: true });
});
```

---

## La règle qui évite la fraude

> **Le corps d'un webhook n'est jamais une preuve de paiement.**

Votre point d'entrée est public : n'importe qui peut y poster
`{"status":"PAID"}`. Si vous livrez sur cette seule base, vous livrez
gratuitement à qui le demande.

`verifierPaiement()` interroge SenePay avec vos propres clés. C'est la seule
réponse qui engage quoi que ce soit.

## Trois retours possibles, trois conduites

| `paye` | `definitif` | Signification | Que faire |
|---|---|---|---|
| `true` | `true` | SenePay confirme l'encaissement | Livrer |
| `false` | `true` | Refus confirmé (échec, annulation, expiration) | Ne pas livrer, informer le client |
| `false` | `false` | Statut intermédiaire, ou SenePay injoignable | **Ne rien conclure.** Répondre `503` et réessayer |

Cette troisième ligne compte autant que les deux autres : une coupure réseau ne
doit jamais condamner le paiement d'un client qui a réellement payé.

## Points d'attention

**Le montant est en francs CFA.** Le franc CFA n'a pas de sous-unité. N'appliquez
aucune conversion en centimes : `5000` signifie 5 000 FCFA.

**Le minimum est de 200 FCFA.** En dessous, SenePay refuse. Le SDK vous arrête
avant l'appel réseau.

**Le téléphone est obligatoire.** SenePay refuse toute transaction sans numéro
du payeur. Un numéro international est accepté, ce qui permet à la diaspora de
régler par carte bancaire.

**SenePay peut refuser dans une réponse `200`.** L'API renvoie parfois
`{"statut": true, "message": "Paiement initié.", "status": "Failed"}`. Le champ
`statut` dit seulement que la requête a été reçue ; c'est `status` qui dit si la
transaction vit. Le SDK lit le bon champ et lève une erreur portant la cause
réelle.

---

## Ce qui a changé en version 2.0.0

**Si vous utilisez la version 1, migrez : elle ne fonctionnait pas et exposait
votre secret.**

### Le modèle était dangereux

La v1 était conçue pour le navigateur : `window.SenePay`, `openCheckout()`, clé
API passée au constructeur côté client. Un marchand qui suivait la
documentation publiait son secret sur son propre site. Avec ce secret, un tiers
peut lire ses transactions et en créer en son nom.

### Elle appelait une API qui n'existe pas

`POST /checkout/sessions` avec `Authorization: Bearer`. L'API SenePay expose
`/payments/initiate` et attend `X-Api-Key` **et** `X-Api-Secret`. Aucun appel
n'aboutissait.

### Elle concluait au succès sur la fermeture d'une fenêtre

```js
if (popup.closed) { /* … */ if (session.status === 'PAID') onSuccess(); }  // v1
```

Une fenêtre fermée ne prouve rien : le client a pu la fermer sans payer. Seul le
serveur SenePay sait si l'argent est arrivé.

### Migration

| v1 | v2 |
|---|---|
| `new SenePay(apiKey)` | `new SenePay({ apiKey, apiSecret })` |
| `createCheckout({ amount })` | `initierPaiement({ montant, telephoneClient, … })` |
| `getSession(token)` | `verifierPaiement(jeton)` |
| `openCheckout()` (navigateur) | **supprimé** — redirigez depuis votre serveur |

## Sécurité

Votre secret ne doit jamais apparaître dans une page web, un fichier
JavaScript livré au navigateur, un dépôt public ou une capture d'écran.
Utilisez une variable d'environnement.

Pour signaler une vulnérabilité : **security@sene-pay.com**.

## Licence

MIT — Millennium Capital Invest LLC.
