// Bump CACHE on every deploy. Navigation requests are network-first, so a stale
// cache name no longer strands installed users on an old index.html.
var CACHE = "painting-v2";
var FILES = ["./","./index.html","./manifest.json","./apple-touch-icon.png","./icon-192.png","./icon-512.png"];

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
  if(new URL(req.url).origin !== self.location.origin) return;

  // The app shell: always try the network first so an update lands on next launch.
  if(req.mode === "navigate"){
    e.respondWith(
      fetch(req).then(function(res){ return put(req, res); })
        .catch(function(){
          return caches.match(req).then(function(hit){ return hit || caches.match("./index.html"); });
        })
    );
    return;
  }

  // Everything else: serve from cache at once, refresh it in the background.
  e.respondWith(caches.match(req).then(function(hit){
    var net = fetch(req).then(function(res){ return put(req, res); }).catch(function(){ return hit; });
    return hit || net;
  }));
});
