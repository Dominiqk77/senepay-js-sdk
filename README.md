# SenePay JS SDK v1.0.0

© 2026 Millennium Capital Invest LLC — Tous droits réservés.

## Intégration JavaScript/TypeScript pour l'API SenePay

SDK officiel pour intégrer les paiements SenePay (Mobile Money, Orange Money, Wave, Free Money) dans toute application JavaScript ou TypeScript.

## Installation

```bash
npm install @senepay/js-sdk
# ou
yarn add @senepay/js-sdk
```

## Utilisation

```typescript
import { SenePay } from '@senepay/js-sdk';

const senepay = new SenePay({
  apiKey: 'votre_cle_api',
  environment: 'sandbox' // ou 'production'
});

// Créer un paiement
const payment = await senepay.createPayment({
  amount: 5000,
  currency: 'XOF',
  description: 'Facture Pro #1234',
  order_id: 'ORDER-1234',
  return_url: 'https://votre-domaine.com/confirmation',
  cancel_url: 'https://votre-domaine.com/annulation'
});

console.log(payment.checkout_url);
```

## API Reference

### `createPayment(params)`
Crée une demande de paiement.

| Paramètre | Type | Description |
|-----------|------|-------------|
| `amount` | number | Montant en FCFA |
| `currency` | string | Code devise (XOF) |
| `description` | string | Description du paiement |
| `order_id` | string | Identifiant unique de commande |
| `return_url` | string | URL de retour après paiement |
| `cancel_url` | string | URL en cas d'annulation |

### `getPaymentStatus(order_id)`
Récupère le statut d'un paiement.

### `listPayments(filters)`
Liste les paiements avec filtres optionnels.

## Support

- API Endpoint: `https://api.sene-pay.com/v1/payments`
- Documentation: https://docs.sene-pay.com
- Support technique: contact.senepay@gmail.com

## Licence

Propriétaire — Millennium Capital Invest LLC. Usage autorisé uniquement pour les projets de l'écosystème Millennium.
