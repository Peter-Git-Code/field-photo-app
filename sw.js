/* Field Photo service worker.
   App files: cache first, refreshed when SHELL_VERSION changes.
   Content (content/*.json): network first with a short timeout, falling back
   to the saved copy, so the library always opens offline.
   Media (media/*): saved the first time it's shown, then served from the
   phone. File names carry a content hash, so a replaced photo gets a new name. */
var SHELL_VERSION = "shell-v9";
var CONTENT_CACHE = "content";
var MEDIA_CACHE = "media";
var SHELL = [
  "./", "index.html", "app.css", "app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  // cache: "reload" skips the browser's HTTP cache, so a new version never
  // saves an older copy of app.js or app.css that the browser still holds.
  e.waitUntil(caches.open(SHELL_VERSION).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL_VERSION && k !== CONTENT_CACHE && k !== MEDIA_CACHE; })
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
      // no-cache: always ask GitHub whether the file changed (cheap when it hasn't),
      // instead of trusting the browser's 10-minute copy.
      var net = fetch(new Request(req, { cache: "no-cache" })).then(function (res) {
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

  if (url.pathname.indexOf("/media/") !== -1) {
    e.respondWith(media(e, url.origin + url.pathname));
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

// Videos are read in byte ranges. Keep the whole file, answer ranges from it.
function media(e, key) {
  var range = e.request.headers.get("range");
  return caches.open(MEDIA_CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return range ? slice(hit, range) : hit;
      var whole = fetch(key).then(function (res) {
        if (res.status === 200) return cache.put(key, res.clone()).then(function () { return res; });
        return res;
      });
      if (!range) return whole;
      e.waitUntil(whole.catch(function () {}));  // save it in the background
      return fetch(e.request);
    });
  });
}

function slice(res, range) {
  var m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  var type = res.headers.get("Content-Type") || "application/octet-stream";
  return res.arrayBuffer().then(function (buf) {
    var size = buf.byteLength;
    if (!m || (m[1] === "" && m[2] === "")) return new Response(buf, { headers: { "Content-Type": type } });
    var start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    var end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
    }
    return new Response(buf.slice(start, end + 1), { status: 206, headers: {
      "Content-Type": type, "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size, "Accept-Ranges": "bytes" } });
  });
}
