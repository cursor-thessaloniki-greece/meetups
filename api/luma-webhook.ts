import crypto from 'crypto';
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err: Error) => reject(err));
  });
}

function timingSafeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req: any, res: any) {
  try {
    const secret = process.env.LUMA_WEBHOOK_SECRET;
    const token = process.env.GITHUB_TOKEN;
    const repoEnv = process.env.GITHUB_REPOSITORY; // owner/repo

    if (!secret || !token || !repoEnv) {
      res.status(500).json({ error: 'Missing environment variables' });
      return;
    }

    const raw = await getRawBody(req);
    const payloadText = raw.toString('utf8');

    const sigHeader = (req.headers['webhook-signature'] || req.headers['Webhook-Signature'] || req.headers['Webhook-signature']);
    if (!sigHeader) {
      res.status(400).json({ error: 'Missing Webhook-Signature header' });
      return;
    }

    // Expected format: t=1600000000,v1=hexsignature
    const parts = sigHeader.split(',').reduce((acc: any, part: string) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});

    const timestamp = parts.t;
    const sig = parts.v1;
    if (!timestamp || !sig) {
      res.status(400).json({ error: 'Invalid signature format' });
      return;
    }

    // optional timestamp tolerance (300 seconds)
    const tolerance = 300;
    const tsNum = Number(timestamp);
    if (Number.isFinite(tsNum)) {
      const delta = Math.abs(Date.now() / 1000 - tsNum);
      if (delta > tolerance) {
        res.status(400).json({ error: 'Timestamp outside tolerance' });
        return;
      }
    }

    const signed = `${timestamp}.${payloadText}`;
    const hmac = crypto.createHmac('sha256', secret).update(signed).digest('hex');

    const valid = timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(sig, 'hex'));
    if (!valid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Parse JSON payload to forward as client_payload
    let payload: any = null;
    try {
      payload = JSON.parse(payloadText);
    } catch (e) {
      payload = { raw: payloadText };
    }

    const [owner, repo] = repoEnv.split('/');

    const ghResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'luma-webhook-middleware',
      },
      body: JSON.stringify({ event_type: 'luma_webhook', client_payload: payload }),
    });

    if (!ghResp.ok) {
      const txt = await ghResp.text();
      res.status(502).json({ error: 'GitHub dispatch failed', details: txt });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
}
