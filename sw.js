/* Field Photo service worker.
   App files: cache first, refreshed when SHELL_VERSION changes.
   Content (content/*.json): network first with a short timeout, falling back
   to the saved copy, so the library always opens offline. */
var SHELL_VERSION = "shell-v2";
var CONTENT_CACHE = "content";
var SHELL = [
  "./", "index.html", "app.css", "app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL_VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL_VERSION && k !== CONTENT_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf("/content/") !== -1) {
    var key = url.origin + url.pathname; // ignore query strings
    e.respondWith(caches.open(CONTENT_CACHE).then(function (cache) {
      var net = fetch(req).then(function (res) {
        if (res.ok) cache.put(key, res.clone());
        return res;
      });
      var timeout = req.cache === "no-store" ? 15000 : 4000;
      return withTimeout(net, timeout).catch(function () {
        return cache.match(key).then(function (hit) { return hit || net; });
      });
    }));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(function () { return caches.match("index.html"); }));
    return;
  }

  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req);
  }));
});
