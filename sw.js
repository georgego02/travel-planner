// Service worker: позволяет открыть сайт без интернета и установить его на экран телефона.
// Стратегия «сначала сеть»: свежая версия, если сеть есть; сохранённая — если нет.
const CACHE = "planner-v11";
const SHELL = ["./", "index.html", "config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "fonts/fira-sans-cyrillic-400-normal.woff2", "fonts/fira-sans-latin-400-normal.woff2",
  "fonts/fira-sans-cyrillic-500-normal.woff2", "fonts/fira-sans-latin-500-normal.woff2",
  "fonts/fira-sans-cyrillic-600-normal.woff2", "fonts/fira-sans-latin-600-normal.woff2",
  "fonts/fira-sans-condensed-cyrillic-600-normal.woff2", "fonts/fira-sans-condensed-latin-600-normal.woff2",
  "fonts/fira-sans-condensed-cyrillic-700-normal.woff2", "fonts/fira-sans-condensed-latin-700-normal.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // данные Google не трогаем
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
