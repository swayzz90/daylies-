// Service Worker: App offline verfügbar machen, Nachrichten immer frisch laden.
const VERSION = "db-__BUILD__";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "countries.json",
  "bricolage-grotesque-latin-500-normal.woff2",
  "bricolage-grotesque-latin-700-normal.woff2",
  "bricolage-grotesque-latin-800-normal.woff2",
  "apple-touch-icon.png", "icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Nachrichten: erst Netz (max. 3,5 s), sonst letzter gespeicherter Stand
  if (url.pathname.endsWith("/news.json")) {
    e.respondWith(
      new Promise((resolve) => {
        const fromCache = () => caches.match("news.json").then((r) => r || Response.error());
        const timer = setTimeout(() => fromCache().then(resolve), 3500);
        fetch(e.request, { cache: "no-store" })
          .then((res) => {
            clearTimeout(timer);
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put("news.json", copy));
            resolve(res);
          })
          .catch(() => { clearTimeout(timer); fromCache().then(resolve); });
      })
    );
    return;
  }

  // Alles andere: Cache zuerst
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
