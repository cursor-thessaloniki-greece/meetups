import * as crypto from 'crypto';

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

function parseRoutingRules(value: string) {
  if (!value) return [] as Array<{ keyword: string; repo: string }>;

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([keyword, repo]) => ({
        keyword: String(keyword).trim().toLowerCase(),
        repo: String(repo).trim(),
      })).filter(({ keyword, repo }) => keyword && repo);
    }
  } catch {
    // fall back to comma-separated key=value rules
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [keyword, repo] = entry.split('=');
      return {
        keyword: keyword?.trim().toLowerCase(),
        repo: repo?.trim(),
      };
    })
    .filter(({ keyword, repo }) => keyword && repo);
}

function getEventText(payload: any) {
  const data = payload?.data || payload || {};
  const event = data?.event || {};
  return [
    data?.name,
    data?.title,
    data?.description,
    data?.category,
    data?.event_type,
    event?.name,
    event?.title,
    event?.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function resolveTargetRepository(payload: any, currentRepo: string) {
  const owner = currentRepo.split('/')[0];
  const rules = parseRoutingRules(process.env.LUMA_ROUTING_RULES || '');
  const text = getEventText(payload);

  const matches = rules
    .map((rule) => ({
      ...rule,
      score: text.includes(rule.keyword) ? rule.keyword.length : 0,
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length > 0) {
    const target = matches[0].repo;
    return target.includes('/') ? target : `${owner}/${target}`;
  }

  const fallback = process.env.LUMA_DEFAULT_REPOSITORY || currentRepo;
  return fallback.includes('/') ? fallback : `${owner}/${fallback}`;
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

    const [owner] = repoEnv.split('/');
    const targetRepo = resolveTargetRepository(payload, repoEnv);
    const routingPayload = {
      ...payload,
      _routing: {
        source_repo: repoEnv,
        target_repo: targetRepo,
      },
    };

    const ghResp = await fetch(`https://api.github.com/repos/${targetRepo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'luma-webhook-middleware',
      },
      body: JSON.stringify({ event_type: 'luma_webhook', client_payload: routingPayload }),
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
