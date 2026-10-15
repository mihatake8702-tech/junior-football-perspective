// offline cache (version changes on every build)
const C = "pd8-e3aea0fd";
const FILES = ["./", "index.html", "coach.html", "privacy.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // pages: network first so updates arrive; everything else (icons, fonts): cache first
  if (new URL(e.request.url).pathname.includes("/board/")) return;   // the tactics board has its own worker
  if (e.request.mode === "navigate") {
    const path = new URL(e.request.url).pathname, page = path.endsWith("coach.html") ? "coach.html" : path.endsWith("privacy.html") ? "privacy.html" : "index.html";
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(page, cp)); return r; }).catch(() => caches.match(page)));
    return;
  }
  // never cache the results endpoints (the coach's Google sheet, or the drill API)
  if (e.request.url.startsWith("https://script.google") || e.request.url.includes("/api/")) return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok || r.type === "opaque") { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  })));
});
