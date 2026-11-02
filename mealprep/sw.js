// 오프라인용: 네트워크 먼저, 안 되면 저장해 둔 것.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open("mealprep-v1").then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
