/* Astralium service worker (Phase 6, feature 28) — versioned.
   - App shell precache: home, manifest, brand icons.
   - Runtime cache (stale-while-revalidate) for shop/product/catalogue
     pages only.
   - NEVER cached: /api/* (personal + signed content), download links,
     checkout, success, account, admin, privacy-center (one-time token
     pages), POST anything.
   - Push: displays notifications from lib/push.ts payloads and opens
     the payload URL on click.
   Registration happens only when the pwa_push flag is on (SwRegister). */
const VERSION = "astralium-pwa-v3";
const SHELL_CACHE = `${VERSION}-shell`;
const PAGE_CACHE = `${VERSION}-pages`;
const SHELL = ["/", "/en", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const NEVER_CACHE = [
  "/api/",
  "/checkout",
  "/success",
  "/account",
  "/control-astralium",
  "/privacy-center",
  "/cart",
];

function isCacheablePage(url) {
  if (NEVER_CACHE.some((p) => url.pathname.includes(p))) return false;
  // Locale-prefixed catalogue surfaces: /{locale}, /{locale}/shop, /{locale}/product/…
  return /^\/(?:[a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i.test(url.pathname) &&
    (url.pathname.includes("/shop") || url.pathname.includes("/product") || url.pathname.split("/").length <= 2);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // personal/signed — network only
  if (url.pathname.includes("/download")) return;

  // Static build assets: cache-first (hashed by Next.js).
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Catalogue pages: stale-while-revalidate.
  if (request.mode === "navigate" && isCacheablePage(url)) {
    event.respondWith(
      caches.open(PAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});

// ─── Web Push ────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Astralium Digitale Store", body: "", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
