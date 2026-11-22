// GPX Workshop offline helper (service worker), Version 14.
// - Keeps the app itself on the device so it opens with no signal (installed app or browser).
// - Serves map tiles and shared tracks that were "Saved for offline".
// - Receives GPX files shared to the installed app (Android share menu).
// Cloud sync, GitHub, routing and everything else still go straight to the network.
const SHELL = 'gpxw-shell', INBOX = 'gpxw-inbox';
const TILE_HOSTS = ['server.arcgisonline.com'];
const ASSET_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];
const PRECACHE = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;600;700&family=JetBrains+Mono&display=swap'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(PRECACHE.map(u =>
    fetch(u, { cache: 'reload', mode: /^https?:/.test(u) ? 'cors' : 'same-origin' }).then(r => (r.ok ? c.put(u === './' ? pageKey() : u, r) : null)).catch(() => null)))));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const pageKey = () => new URL('./', self.registration.scope).href;

// Network first, but give up after a few seconds when a saved copy exists (weak signal in the mountains).
function fetchSoon(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('slow')), ms);
    fetch(req).then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}
async function networkFirst(req, key, ms) {
  const saved = await caches.match(key, { ignoreSearch: true });
  try {
    const res = saved ? await fetchSoon(req, ms) : await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(key, res.clone());   // keep the offline copy up to date
    return res;
  } catch (err) {
    if (saved) return saved;
    throw err;
  }
}
async function cacheFirst(req, keep) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (keep && res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch (err) { return new Response('', { status: 504, statusText: 'Offline' }); }
}
// Android: GPX files shared to the installed app arrive here; the app picks them up from the inbox.
async function receiveShare(req) {
  try {
    const form = await req.formData(), box = await caches.open(INBOX);
    let i = 0;
    for (const f of form.getAll('gpx')) if (f && f.name) await box.put(`./__inbox/${Date.now()}-${i++}/${encodeURIComponent(f.name)}`, new Response(f));
  } catch (e) { /* nothing usable was shared */ }
  return Response.redirect(new URL('./?inbox=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method === 'POST' && u.origin === self.location.origin && u.searchParams.has('share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate' && u.origin === self.location.origin) { e.respondWith(networkFirst(req, pageKey(), 4000)); return; }
  if (u.origin === self.location.origin && u.pathname.endsWith('/login.json')) { e.respondWith(networkFirst(req, u.href, 4000)); return; }   // lock screen works offline too
  // Map tiles shown on the page (not the page's own downloads while saving), the map library and fonts.
  if (TILE_HOSTS.includes(u.hostname) && req.destination === 'image') { e.respondWith(cacheFirst(req, false)); return; }
  if (ASSET_HOSTS.includes(u.hostname)) { e.respondWith(cacheFirst(req, true)); return; }
  if (u.origin === self.location.origin && !u.pathname.endsWith('sw.js')) e.respondWith(cacheFirst(req, false));
});
