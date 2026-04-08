import { Hono } from 'hono';
import { cors } from 'hono/cors';

const proxyRouter = new Hono();

// CORS for proxy endpoint
proxyRouter.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
}));

// Transparent 1x1 PNG (base64 decoded)
const TRANSPARENT_PIXEL = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82
]);

// Proxy image endpoint
proxyRouter.get('/image', async (c) => {
  const url = c.req.query('url');

  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400);
  }

  // Validate URL is HTTP/HTTPS
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return c.json({ error: 'Invalid URL protocol' }, 400);
  }

  // Block internal/private networks
  const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '10.', '192.168.', '172.16.', '172.31.'];
  if (blocked.some(b => url.includes(b))) {
    return c.json({ error: 'Blocked URL' }, 403);
  }

  const fetchOptionsList = [
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
    },
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'image/*,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
  ];

  let lastError: string = 'Unknown error';
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < fetchOptionsList.length; attempt++) {
    try {
      const response = await fetch(url, fetchOptionsList[attempt]);

      if (!response.ok) {
        lastStatus = response.status;
        lastError = `HTTP ${response.status}`;
        continue;
      }

      // Read body safely
      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch (e) {
        lastError = 'Failed to read response body';
        continue;
      }

      const contentType = response.headers.get('content-type') || 'image/png';

      return new Response(buffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) {
      lastError = String((e as Error).message || e);
      console.error(`Proxy attempt ${attempt + 1} failed for ${url}:`, lastError);
    }
  }

  // All attempts failed - return transparent pixel as fallback
  console.error(`Proxy all attempts failed for ${url}: status=${lastStatus}, error=${lastError}`);

  return new Response(TRANSPARENT_PIXEL, {
    headers: {
      'Content-Type': 'image/png',
      'X-Proxy-Error': `failed:${lastStatus || lastError}`,
    },
  });
});

export default proxyRouter;
