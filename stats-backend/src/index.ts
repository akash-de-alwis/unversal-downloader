/**
 * Universal Downloader — anonymous usage stats.
 *
 *   POST /ping               { "deviceId": "<uuid>" }  → records the device as seen now
 *   POST /download-complete                            → bumps the global download counter
 *   GET  /stats                                        → { totalDownloads, activeUsers: { last5Minutes, last24Hours } }
 *
 * Storage (one KV namespace, bound as STATS):
 *   device:<deviceId>  value "", metadata { t: lastSeenMs }, expires 25h after the last ping
 *   counter:downloads  total completed downloads, as a decimal string
 *
 * Last-seen time is kept in the key's metadata so /stats can count devices with
 * list() alone, without a get() per device. Devices expire on their own once they
 * are outside the 24-hour window, so the list never grows past recent users.
 */

const DEVICE_PREFIX = 'device:';
const DOWNLOADS_KEY = 'counter:downloads';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// A little past 24h so a device is never dropped before it leaves the 24h window
const DEVICE_TTL_SECONDS = 25 * 60 * 60;
// /stats walks every device key, so serve it from the edge cache for a short while
const STATS_CACHE_SECONDS = 60;

// A ping body is a few dozen bytes; refuse anything larger instead of buffering it
const MAX_PING_BODY_BYTES = 1024;

// Anonymous IDs only: a UUID or similar random token, never anything user-identifying
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

interface DeviceMetadata {
  t: number;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

/** Reads a request body as text, or returns null once it passes `limit` bytes. */
async function readBodyWithLimit(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > limit) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function handlePing(request: Request, env: Env): Promise<Response> {
  const body = await readBodyWithLimit(request, MAX_PING_BODY_BYTES);
  if (body === null) {
    return json({ error: `Body must be at most ${MAX_PING_BODY_BYTES} bytes` }, 413);
  }

  let deviceId: unknown;
  try {
    ({ deviceId } = JSON.parse(body) as { deviceId?: unknown });
  } catch {
    return json({ error: 'Body must be JSON: { "deviceId": "..." }' }, 400);
  }
  if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) {
    return json({ error: 'deviceId must be 8-64 characters of letters, digits, "-" or "_"' }, 400);
  }

  const metadata: DeviceMetadata = { t: Date.now() };
  await env.STATS.put(DEVICE_PREFIX + deviceId, '', {
    metadata,
    expirationTtl: DEVICE_TTL_SECONDS,
  });
  return json({ ok: true });
}

async function handleDownloadComplete(env: Env): Promise<Response> {
  // KV has no atomic increment: two completions landing in the same instant can
  // both read N and write N+1. Fine for a rough public counter (see README).
  const current = parseInt((await env.STATS.get(DOWNLOADS_KEY)) ?? '0', 10) || 0;
  const totalDownloads = current + 1;
  await env.STATS.put(DOWNLOADS_KEY, String(totalDownloads));
  return json({ ok: true, totalDownloads });
}

async function computeStats(env: Env) {
  const now = Date.now();
  let last5Minutes = 0;
  let last24Hours = 0;

  let cursor: string | undefined;
  do {
    const page = await env.STATS.list<DeviceMetadata>({ prefix: DEVICE_PREFIX, cursor });
    for (const key of page.keys) {
      const lastSeen = key.metadata?.t;
      if (typeof lastSeen !== 'number') continue;
      const age = now - lastSeen;
      if (age <= DAY_MS) last24Hours++;
      if (age <= FIVE_MINUTES_MS) last5Minutes++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const totalDownloads = parseInt((await env.STATS.get(DOWNLOADS_KEY)) ?? '0', 10) || 0;

  return {
    totalDownloads,
    activeUsers: { last5Minutes, last24Hours },
    generatedAt: new Date(now).toISOString(),
  };
}

async function handleStats(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/stats', request.url).toString(), { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = json(await computeStats(env), 200, {
    'Cache-Control': `public, max-age=${STATS_CACHE_SECONDS}`,
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname.replace(/\/+$/, '') || '/'}`;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      switch (route) {
        case 'POST /ping':
          return await handlePing(request, env);
        case 'POST /download-complete':
          return await handleDownloadComplete(env);
        case 'GET /stats':
          return await handleStats(request, env, ctx);
        default:
          return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'request failed',
          route,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return json({ error: 'Internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
