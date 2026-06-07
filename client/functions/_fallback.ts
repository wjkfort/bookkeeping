// SPA fallback — serve index.html for all frontend routes
// so client-side routing works without a server-side redirect config.
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(request);
  if (response.status === 404) {
    return env.ASSETS.fetch(new URL("/index.html", url));
  }
  return response;
}
