// offline cache for the menu, coach and privacy pages (version changes on every build)
const C = "pd8-aab8d4c5";
const FILES = ["./", "index.html", "coach.html", "privacy.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("pd8-") && k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const path = new URL(e.request.url).pathname;
  if (path.includes("/board/") || path.includes("/drill/") || path.includes("/practice/") || path.includes("/api/") || e.request.url.startsWith("https://script.google")) return;
  if (e.request.mode === "navigate") {
    const page = path.endsWith("coach.html") ? "coach.html" : path.endsWith("privacy.html") ? "privacy.html" : "index.html";
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(page, cp)); return r; }).catch(() => caches.match(page)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok || r.type === "opaque") { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  })));
});
