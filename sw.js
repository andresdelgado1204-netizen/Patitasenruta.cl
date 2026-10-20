const CACHE="patitas-en-ruta-v154";
const FILES=["./","./index.html","./manifest.webmanifest","./icon.svg","./brand.svg","./wordmark.svg","./logo-titulo.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response}).catch(()=>caches.match(event.request).then(response=>response||caches.match("./index.html"))))});
