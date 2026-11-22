// GPX Workshop offline helper (service worker).
// Lets a shared link that was "Saved for offline" open with no signal, and serves the saved map tiles.
// Everything else (cloud sync, GitHub, routing) goes straight to the network as before.
const SHELL = 'gpxw-shell';
const TILE_HOSTS = ['server.arcgisonline.com'];
const ASSET_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const pageKey = () => new URL('./', self.registration.scope).href;

// Network first, but give up after a few seconds when a saved copy exists (weak signal in the mountains).
function fetchSoon(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('slow')), ms);
    fetch(req).then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

async function page(req) {
  const saved = await caches.match(pageKey(), { ignoreSearch: true });
  try {
    const res = saved ? await fetchSoon(req, 6000) : await fetch(req);
    if (res.ok && saved) (await caches.open(SHELL)).put(pageKey(), res.clone());   // keep the offline copy up to date
    return res;
  } catch (err) {
    if (saved) return saved;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  try { return await fetch(req); }
  catch (err) { return new Response('', { status: 504, statusText: 'Offline' }); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate' && u.origin === self.location.origin) { e.respondWith(page(req)); return; }
  // Map tiles shown on the page (not the page's own downloads while saving), the map library and fonts.
  if ((TILE_HOSTS.includes(u.hostname) && req.destination === 'image') || ASSET_HOSTS.includes(u.hostname)) e.respondWith(cacheFirst(req));
  else if (u.origin === self.location.origin && !u.pathname.endsWith('sw.js') && !u.pathname.endsWith('login.json')) e.respondWith(cacheFirst(req));
});
