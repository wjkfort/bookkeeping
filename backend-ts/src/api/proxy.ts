import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from 'hono/adapter';

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

  try {
    const response = await fetch(url, {
      headers: {
        // Mimic browser User-Agent to avoid some blocking
        'User-Agent': 'Mozilla/5.0 (compatible; BookkeepingApp/1.0)',
        'Accept': 'image/*,*/*',
      },
    });

    if (!response.ok) {
      return c.json({ error: `Failed to fetch image: ${response.status}` }, 502);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Proxy fetch error:', error);
    return c.json({ error: 'Failed to fetch image' }, 502);
  }
});

export default proxyRouter;
