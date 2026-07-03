const fetch = require('node-fetch');
const crypto = require('crypto');

const URL = process.env.ENDPOINT || 'http://localhost:3000/api/luma-webhook';
const SECRET = process.env.LUMA_WEBHOOK_SECRET || 'your_secret';
const payload = { event: 'test', time: Date.now() };
const body = JSON.stringify(payload);
const ts = Math.floor(Date.now() / 1000).toString();
const signed = `${ts}.${body}`;
const sig = crypto.createHmac('sha256', SECRET).update(signed).digest('hex');
const header = `t=${ts},v1=${sig}`;

(async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Webhook-Signature': header,
    },
    body,
  });
  console.log('status', res.status);
  console.log('body', await res.text());
})();
