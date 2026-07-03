addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function readBody(request) {
  return await request.text();
}

async function computeHMAC(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const arr = Array.from(new Uint8Array(sig));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseSignature(header) {
  if (!header) return null;
  return header.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
}

async function handleRequest(request) {
  try {
    const secret = LUMA_WEBHOOK_SECRET || (typeof LUMA_WEBHOOK_SECRET === 'undefined' ? null : LUMA_WEBHOOK_SECRET);
    const githubToken = GITHUB_TOKEN || (typeof GITHUB_TOKEN === 'undefined' ? null : GITHUB_TOKEN);
    const repo = GITHUB_REPOSITORY || null; // owner/repo

    if (!secret || !githubToken || !repo) {
      return new Response(JSON.stringify({ error: 'Missing environment variables' }), { status: 500 });
    }

    const raw = await readBody(request);
    const sigHeader = request.headers.get('Webhook-Signature') || request.headers.get('webhook-signature');
    const parts = parseSignature(sigHeader);
    if (!parts || !parts.t || !parts.v1) return new Response('Invalid signature format', { status: 400 });

    const signed = `${parts.t}.${raw}`;
    const expected = await computeHMAC(secret, signed);
    if (expected !== parts.v1) return new Response('Invalid signature', { status: 401 });

    let payload;
    try { payload = JSON.parse(raw); } catch (e) { payload = { raw }; }

    const [owner, repoName] = repo.split('/');
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'luma_webhook', client_payload: payload }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: 'GitHub dispatch failed', details: text }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
