class SenePay {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.sene-pay.com/api/v1';
  }

  async createCheckout({ amount, currency = 'XOF', description, webhookUrl, successUrl, cancelUrl }) {
    const res = await fetch(`${this.baseUrl}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, currency, description, webhook_url: webhookUrl, success_url: successUrl, cancel_url: cancelUrl }),
    });
    return res.json();
  }

  async getSession(token) {
    const res = await fetch(`${this.baseUrl}/checkout/sessions/${token}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    return res.json();
  }

  openCheckout({ amount, currency = 'XOF', description, onSuccess, onFailure }) {
    this.createCheckout({ amount, currency, description }).then(data => {
      if (data.checkout_url) {
        const popup = window.open(data.checkout_url, 'SenePay', 'width=500,height=700');
        const timer = setInterval(() => {
          if (popup.closed) {
            clearInterval(timer);
            this.getSession(data.token).then(session => {
              if (session.status === 'PAID') onSuccess && onSuccess(session);
              else onFailure && onFailure(session);
            });
          }
        }, 1000);
      }
    });
  }
}

if (typeof module !== 'undefined') module.exports = SenePay;
if (typeof window !== 'undefined') window.SenePay = SenePay;
