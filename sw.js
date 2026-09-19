// Bump CACHE on every deploy. Navigation requests are network-first, so a stale
// cache name no longer strands installed users on an old index.html.
var CACHE = "painting-v7";

// The shell. Faction points files are deliberately absent: they are fetched on
// demand and cached on first use, so installing does not pull 318 KB the user
// may never need.
var FILES = [
  "./", "./index.html", "./manifest.json",
  "./js/app.js", "./js/store.js", "./js/mfm.js", "./js/ui.js",
  "./js/views-collection.js", "./js/views-lists.js", "./js/views-data.js",
  "./data/factions.json",
  "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES); }));
  self.skipWaiting();
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ if(k !== CACHE) return caches.delete(k); }));
  }));
  self.clients.claim();
});

function put(req, res){
  if(res && res.ok && res.type === "basic"){
    var copy = res.clone();
    caches.open(CACHE).then(function(c){ c.put(req, copy); });
  }
  return res;
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // Points data and icons change rarely and are the bulky part, so serve them
  // from cache at once and refresh in the background.
  var lazy = url.pathname.indexOf("/data/") !== -1 || /\.(png|jpg|svg|ico)$/.test(url.pathname);
  if(lazy){
    e.respondWith(caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){ return put(req, res); }).catch(function(){ return hit; });
      return hit || net;
    }));
    return;
  }

  // The shell — index.html and the modules it loads — must stay in step with
  // each other, so always try the network first and fall back to the cache.
  //
  // "no-cache" forces a revalidation rather than letting the browser's own HTTP
  // cache answer: GitHub Pages serves these with max-age, so without it a
  // network-first fetch can still hand back a stale copy for several minutes.
  e.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then(function(res){ return put(req, res); })
      .catch(function(){
        return caches.match(req).then(function(hit){
          return hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
        });
      })
  );
});
