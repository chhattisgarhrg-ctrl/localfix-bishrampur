const CACHE_VERSION = "localfix-v1.0.0";
const STATIC_CACHE  = "localfix-static-v1";
const DYNAMIC_CACHE = "localfix-dynamic-v1";

const STATIC_FILES = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(STATIC_FILES).catch(() => {})
    )
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== DYNAMIC_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
  self.clients.matchAll().then((clients) =>
    clients.forEach((c) => c.postMessage({ type: "SW_UPDATED" }))
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // API + Firebase = network only
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("firestore.googleapis") ||
    url.hostname.includes("razorpay") ||
    url.hostname.includes("nominatim")
  ) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "offline", offline: true }), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Static files = cache first
  if (STATIC_FILES.some((f) => e.request.url.endsWith(f))) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // Everything else = network first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(DYNAMIC_CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(
          (cached) => cached || caches.match("/index.html")
        )
      )
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────
self.addEventListener("push", (e) => {
  let data = { title: "LocalFix", body: "नया update!", icon: "/icons/icon-192.png" };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; } catch {}
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon,
      badge:   "/icons/icon-96.png",
      vibrate: [200, 100, 200],
      tag:     data.tag || "localfix",
      renotify: true,
      data:    { url: data.url || "/" },
      actions: [
        { action: "open",    title: "📱 खोलें" },
        { action: "dismiss", title: "✕ बंद करें" },
      ],
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "dismiss") return;
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if (c.url === url && "focus" in c) return c.focus();
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

// ── BACKGROUND SYNC ───────────────────────────────────────────
self.addEventListener("sync", (e) => {
  if (e.tag === "sync-bookings") e.waitUntil(syncBookings());
});

async function syncBookings() {
  // IndexedDB se pending bookings nikal ke backend pe POST karo
  console.log("[SW] Syncing pending bookings...");
}

// ── MESSAGE ───────────────────────────────────────────────────
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});
