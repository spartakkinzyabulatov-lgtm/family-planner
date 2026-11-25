var VERSION = "v7";
const CACHE = 'family-planner-' + VERSION;
const CORE = ['./','./index.html','./style.css','./app.js','./model.mjs','./vault.mjs','./storage.mjs','./config.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('family-planner-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/')) return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./index.html',self.registration.scope),{ignoreVary:true})));
  } else if(CORE.some(path=>new URL(path,self.registration.scope).pathname===url.pathname)) {
    event.respondWith(caches.match(event.request,{ignoreSearch:true,ignoreVary:true}).then(cached=>cached||fetch(event.request)));
  }
});
