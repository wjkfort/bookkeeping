import { Hono } from 'hono';
import { cors } from 'hono/cors';

const proxyRouter = new Hono();

// CORS for proxy endpoint
proxyRouter.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
}));

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

  const fetchOptions = [
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
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

  let lastError: Error | null = null;
  let lastStatus: number | null = null;

  // Try with different fetch options
  for (let attempt = 0; attempt < fetchOptions.length; attempt++) {
    try {
      const response = await fetch(url, fetchOptions[attempt]);

      // If fetch succeeded but non-OK status, log it
      if (!response.ok) {
        lastStatus = response.status;
        console.log(`Proxy attempt ${attempt + 1} for ${url}: status ${response.status}`);
        continue; // Try next option
      }

      // Check if response is actually an image
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        console.log(`Proxy: non-image content-type for ${url}: ${contentType}`);
      }

      const buffer = await response.arrayBuffer();

      return new Response(buffer, {
        headers: {
          'Content-Type': contentType || 'image/png',
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      lastError = error as Error;
      console.error(`Proxy attempt ${attempt + 1} error for ${url}:`, lastError.message);
    }
  }

  // All attempts failed - return 200 with minimal transparent pixel as fallback
  // This prevents broken images from showing errors in the UI
  console.error(`Proxy all attempts failed for ${url}: status=${lastStatus}, error=${lastError?.message}`);

  // Return 1x1 transparent PNG
  const transparentPixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );

  return new Response(transparentPixel, {
    headers: {
      'Content-Type': 'image/png',
      'X-Proxy-Error': `failed:${lastStatus || lastError?.message}`,
    },
  });
});

export default proxyRouter;
