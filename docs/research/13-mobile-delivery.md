# 13 — Mobile delivery, PWA & push (research report)

Author: mobile-delivery researcher · Date: Sun 8 Nov 2026 · Scope: how graders open FINN on a phone, how "push" reaches them, what it costs (nothing), and what to QA before 15 Nov.

Everything marked **[verified]** was read today from the linked primary source. **[not re-verified]** = widely documented but I did not fetch a source today. **[unverified]** = could not confirm; treat as a risk.

---

## 0. TL;DR

1. **Ship a responsive web app + installable PWA on Vercel Hobby. Do not ship Expo/TestFlight.** A web link is one tap; TestFlight needs a $99/yr Apple Developer membership and Beta App Review for external testers; Expo Go is explicitly "not useful for the review process" per Expo's own docs. (§2)
2. **Current phones (Nov 2026): iOS 27.2 is current, iOS 26.x and 18.x are still patched.** On iOS 26+ *any* site added to the Home Screen opens as a web app (no manifest needed), and Home Screen web apps get Web Push + Badging. In a Safari *tab* `Notification` is undefined — Web Push on iPhone only works after Add to Home Screen. Android Chrome does Web Push in the tab. (§1, §3)
3. **Push strategy = three layers, all free:** (a) in-app **Alerts inbox** that always works (the thing graders *see*), (b) **Web Push** (declarative-JSON payload so iOS 18.4+ shows it even without the service worker; classic SW path for Android), (c) **Telegram bot** as the "it reached my phone" channel — one tap deep-link subscribe, rich HTML + buttons, 1 msg/s/chat, no approval process. Skip WhatsApp (template approval, 5-recipient sandbox, per-message billing). Email via Resend is optional (100/day free). (§4, §5)
4. **Vercel Hobby constraints that bite:** cron **once per day with ±59 min jitter**, 300 s max function duration, non-commercial only, preview URLs are **behind Vercel login by default** (give graders the *production* URL). Use **cron-job.org** (free, 1-minute granularity) to hit an authenticated job route for intraday announcement polling and a precise EOD run. Set function region **`bom1` (Mumbai)**. (§7)
5. **Python worker:** Hugging Face Spaces Docker/Gradio now **requires a paid PRO plan**; Fly.io has **no free tier**; Render free **sleeps after 15 min and takes ~1 min to wake** (fatal for an on-demand tap). Best free options: **Vercel Python Functions** (FastAPI zero-config, 500 MB bundle, 300 s, Fluid compute) or Google Cloud Run (2M req/mo free but needs a billing card). (§7)
6. **Perf budget:** ≤ 300 KB gzipped JS on first load, ≤ 1 MB critical path, one variable font with `tabular-nums`, SVG sparklines (0 KB) + at most one lazily-loaded chart lib. Recharts is 150 KB gz — don't. Lighthouse mobile ≥ 90, LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. (§6)

---

## 1. Platform facts (what graders' phones can do)

### 1.1 Versions in the wild (Nov 2026) [verified]
- Apple security releases page: **iOS 27.2** released 26 Oct 2026; **iOS 26.7.2** and **iOS 18.7.11** (iPhone XS/XR class) released the same day → three iOS majors are live. https://support.apple.com/en-us/100100
- Safari 27.0 (14 Sep 2026): "Added support for the service worker static routing API"; **no push-specific changes**. https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes.md
- Safari 26.0 (15 Sep 2025): "**every website added to the Home Screen opens as a web app** by default … there are now zero requirements for 'installability' in Safari." Users can toggle "Open as Web App" off. https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ and Apple user guide https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios

### 1.2 Capability matrix

| Capability | iOS Safari (tab) | iOS Home Screen web app | Android Chrome (tab or installed) | Source |
|---|---|---|---|---|
| Standalone display (no browser chrome) | — | Yes (iOS 26+: any site; <26 needs manifest `display: standalone`/`fullscreen` or Apple meta) | Yes via manifest; WebAPK on GMS devices | WebKit 26.0 post; MDN installable guide [verified] |
| Web Push | **No** (`Notification` undefined) | **Yes** since iOS 16.4; permission needs a **user gesture**; **every push must show a notification** (30 s budget; 3 silent pushes → subscription revoked); payload ≤ 4 KB; endpoints `*.push.apple.com`; **no Apple developer account needed** | Yes in the tab, no install required | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; https://progressivewebapps.com/background/ios-web-push/ [verified] |
| Declarative Web Push (`"web_push": 8030` JSON, no SW needed; `window.pushManager`) | — | **Yes, iOS 18.4+**; exempt from silent-push penalty | Not implemented (delivered to SW as normal data) | https://webkit.org/blog/16535/meet-declarative-web-push/ [verified] |
| Badging API (`navigator.setAppBadge`) | No | Yes (16.4+), badge shows only after notification permission | Yes for installed PWAs | https://webkit.org/blog/14112/badging-for-home-screen-web-apps/ [verified] |
| `beforeinstallprompt` / custom install button | **No** (manual Share → Add to Home Screen) | n/a | Yes; manifest needs `name`/`short_name`, `start_url`, `display`, 192+512 px icons; **no service worker required** since Chrome 108 | https://developer.chrome.com/blog/update-install-criteria ; https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable [verified] |
| Haptics `navigator.vibrate` | **Never shipped in WebKit** (formally opposed) | No | Yes (after a user tap; no intensity control) | https://caniuse.com/mdn-api_navigator_vibrate ; https://w3c.github.io/vibration/reports/implementation.html [verified] |
| View Transitions (same-document) | Safari 18.0+ | same | Chrome 111+ | https://caniuse.com/view-transitions [verified] |
| View Transitions (cross-document `@view-transition`) | Safari 18.2+ | same | Chrome 126+ | https://caniuse.com/cross-document-view-transitions [verified] |
| Web Speech **recognition** (`webkitSpeechRecognition`) | Yes since iOS 14.5 (prefixed; Apple dictation engine; `continuous` OK since 17) | same | Yes (prefixed; `continuous` **not** supported on Chrome for Android; cloud-based) | https://caniuse.com/speech-recognition ; https://caniuse.com/mdn-api_speechrecognition_continuous [verified] |
| Web Speech **synthesis** (TTS) | Yes (must start from a tap; Safari 27 fixed a `speechSynthesis.cancel()` queue bug) | same | Yes | Safari 27 release notes [verified]; rest [not re-verified] |
| `100dvh` / `svh` / `lvh` | Safari 15.4+ | same | Chrome 108+ | https://caniuse.com/viewport-unit-variants [not re-verified] |
| `viewport-fit=cover` + `env(safe-area-inset-*)` | Yes | Yes (needed for content under the translucent status bar / home indicator) | Yes (display cutouts) | https://progressivewebapps.com/manifest/display-modes/ [verified] |
| `interactive-widget=resizes-content` (keyboard shrinks layout viewport) | **No** — implemented in WebKit source, not shipped in Safari as of Sep 2026 → use `visualViewport` | No | Yes, Chrome 108+ | https://www.bram.us/2026/09/11/webkit-supports-interactive-widget-and-hopefully-safari-will-too/ [verified] |
| `overscroll-behavior` to kill pull-to-refresh | Property supported (Safari 16) but **does not disable Safari's pull-to-refresh** (WebKit bug 275947, still open) | Home Screen web apps have **no** pull-to-refresh at all | `overscroll-behavior-y: contain` on `html, body` disables it (also in standalone) | https://bugs.webkit.org/show_bug.cgi?id=275947 ; https://developer.chrome.com/blog/overscroll-behavior [verified] |
| CSS scroll-snap | Yes (Safari 27 fixed several re-snap bugs) | same | Yes | Safari 27 release notes [verified] |
| `theme-color` meta | Safari 15+ tinted browser chrome; **from Safari 26 the tint comes from page background/fixed elements, theme-color only used for installed web apps** | Status bar area follows `apple-mobile-web-app-status-bar-style` | Colours the status bar/title bar of the WebAPK | https://progressivewebapps.com/manifest/display-modes/ [verified; secondary source] |

Practical consequences for FINN:
- iPhone graders will most likely open the link in Safari (a tab). The app must be **great in a tab** and *offer* Home Screen install as an upgrade for push — never gate anything on install.
- Haptics on iPhone: not possible from JS. Fake it visually (tap scale/colour) and keep Android `navigator.vibrate(10)` behind a helper that returns `false` elsewhere.
- Voice input is viable on both platforms with `webkitSpeechRecognition` (iOS: restart on `onend`; Android: no `continuous`, restart loop). Keep it as a secondary input next to a text box; test on device (Firefox has none — irrelevant for graders).

---

## 2. Responsive web / PWA vs Expo: grader friction

| Path | Steps for a grader | Cost / gates | Verdict |
|---|---|---|---|
| **Responsive web (URL/QR)** | 1 tap. Optional: Share → Add to Home Screen (2 taps) for push/badge | $0 | **Ship this** |
| TestFlight (external) | Receive invite/public link → install TestFlight app → accept → install → open | **$99/yr Apple Developer Program**; **Beta App Review required on the first build of every version**; 90-day build expiry | Too much friction & risk in 7 days [verified: https://docs.expo.dev/submit/testflight/ ; https://expo.dev/blog/apple-developer-program-explained-free-vs-paid] |
| Expo Go | Install Expo Go → scan QR → wait for bundle; needs an EAS Update or a running dev server | $0, but Expo: "not useful for the review process of your app" | No [verified: https://docs.expo.dev/review/overview/] |
| EAS internal distribution (ad-hoc iOS) | Register each tester's UDID → rebuild → install from link | Needs paid Apple account; 100 devices/yr; new device = new build | No |
| Android APK sideload | Download → allow unknown sources → install | $0 | Only as a bonus; not needed |

EAS free plan: 15 Android + 15 iOS builds/month, low-priority queue (90+ min waits at peak) [verified: https://expo.dev/pricing/]. Even if we wanted native later, the React code written for the web today is the right base.

---

## 3. Exact PWA setup (Next.js 16 App Router)

Next.js 16.4.5 is current (3 Nov 2026 security release; Turbopack default; `cacheComponents` replaces PPR flag) [verified: https://nextjs.org/blog/next-16 ; https://github.com/vercel/next.js/releases/tag/v16.4.5]. Every `Viewport`/`Metadata`/`Manifest` field used below (`viewportFit`, `interactiveWidget`, `colorScheme`, `appleWebApp.statusBarStyle`, `formatDetection`, manifest `id`/`shortcuts`/`categories`/`orientation`/`purpose`) exists in the 16.4.5 type definitions [verified against `next@16.4.5/dist/lib/metadata/types/*.d.ts` on unpkg].

### 3.1 `app/layout.tsx` — viewport + metadata (emits the meta tags)

```tsx
import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',                 // enables env(safe-area-inset-*) on iOS
  interactiveWidget: 'resizes-content', // Android Chrome: layout shrinks above the keyboard; ignored by Safari
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)',  color: '#0b0f14' },
  ],
}

export const metadata: Metadata = {
  title: { default: 'FINN', template: '%s · FINN' },
  applicationName: 'FINN',
  description: 'What changed in your portfolio, and why it matters.',
  manifest: '/manifest.webmanifest',    // served by app/manifest.ts below
  appleWebApp: {
    capable: true,                      // iOS <26 fallback; harmless on 26+
    title: 'FINN',
    statusBarStyle: 'black-translucent' // content runs under the status bar → pad with safe-area-inset-top
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192' }],
    apple: '/apple-touch-icon.png',     // 180×180 PNG, opaque background (iOS ignores transparency)
  },
  formatDetection: { telephone: false }, // stops iOS turning "1800 2667" style numbers into tel: links
  other: { 'mobile-web-app-capable': 'yes' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className="min-h-dvh bg-bg text-fg antialiased">{children}</body>
    </html>
  )
}
```

Notes: Chrome logs a deprecation warning for `apple-mobile-web-app-capable` and asks for `mobile-web-app-capable`; the manifest `display` is what actually matters on both platforms, so the meta tags are belt-and-braces only [verified: https://deadhead.cevdet.ch/rules/meta/apple-mobile-web-app-capable]. `black-translucent` is the only value that lets content run edge-to-edge under the iOS status bar [verified: progressivewebapps.com display-modes].

### 3.2 `app/manifest.ts`

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',                        // stable identity: iOS uses id + user-given name for Focus sync; Chrome for updates
    name: 'FINN — Portfolio intelligence',
    short_name: 'FINN',
    description: 'Push: what changed in your portfolio. Pull: research grounded in filings.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0f14',    // Android splash; match the first-paint background to avoid a white flash
    theme_color: '#0b0f14',
    lang: 'en-IN',
    dir: 'ltr',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today\u2019s digest', url: '/digest', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Alerts', url: '/alerts', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
```

Chromium install requirements satisfied: name, start_url, display, 192 & 512 icons, HTTPS; no service worker needed for installability [verified]. Keep a separate `purpose: 'maskable'` icon with safe-zone padding; never set `purpose: 'any maskable'` on one file (looks tiny on iOS).

### 3.3 Safe areas, viewport height, keyboard — `app/globals.css` (Tailwind v4.3.x)

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --color-bg: light-dark(#ffffff, #0b0f14);   /* light-dark(): Safari 17.5+, Chrome 123+ */
  --color-fg: light-dark(#0b0f14, #e7edf3);
  --color-up: light-dark(#0a7f3f, #3ddc84);
  --color-down: light-dark(#b42318, #ff6b6b);
}

:root { color-scheme: light dark; }        /* system dark mode, zero JS, zero flash */

html, body { overscroll-behavior-y: contain; } /* Android: no accidental pull-to-refresh; iOS tab ignores this */

.app-shell {
  min-height: 100dvh;                      /* not 100vh: Safari toolbar collapse */
  padding-top: env(safe-area-inset-top);
  padding-bottom: calc(env(safe-area-inset-bottom) + var(--tabbar-h, 56px));
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
.tabbar { position: fixed; inset-inline: 0; bottom: 0; padding-bottom: env(safe-area-inset-bottom); }

/* numbers never jiggle */
.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

/* only animate for people who want it */
@media (prefers-reduced-motion: no-preference) {
  @view-transition { navigation: auto; }   /* free cross-document crossfade: Safari 18.2+, Chrome 126+ */
}
```

Tailwind 4.3.5 is current (6 Nov 2026); core needs Safari 16.4+/Chrome 111+; `light-dark()` raises that to Safari 17.5+ — acceptable because iOS 18+ is the realistic floor [verified: https://github.com/tailwindlabs/tailwindcss/tags ; https://tailwindcss.com/docs/compatibility]. If a *manual* theme toggle is wanted, use `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))` + `next-themes` (1.5 KB gz, injects a blocking inline script so there is no flash) — otherwise stay system-only.

**Chat composer above the iOS keyboard** (Safari ignores `interactive-widget`): position the composer with `visualViewport`:

```ts
// hooks/useKeyboardInset.ts — iOS Safari keyboard inset; Android handled by interactive-widget=resizes-content
import { useEffect } from 'react'
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const inset = Math.max(0, document.documentElement.clientHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--kb-inset', `${inset}px`)
    }
    vv.addEventListener('resize', update); vv.addEventListener('scroll', update); update()
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
}
// CSS: .composer { position: fixed; bottom: calc(env(safe-area-inset-bottom) + var(--kb-inset, 0px)); }
```
[verified pattern: https://www.observerviewport.com/.../handling-the-mobile-virtual-keyboard-with-visualviewport/]

### 3.4 Standalone detection + install hint

```ts
// lib/platform.ts
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isAppleWebApp = () => (navigator as any).standalone === true          // reliable on iOS
export const isInstalled = () => isAppleWebApp() || matchMedia('(display-mode: standalone)').matches
// iOS Safari tab: push impossible → show "Add to Home Screen" hint instead of a dead button
export const needsHomeScreenInstall = () => isIOS() && (navigator as any).standalone === false && !('Notification' in window)
```

Install hint copy (iOS): "Tap **Share** → **Add to Home Screen** → keep **Open as Web App** on → **Add**. Then open FINN from your Home Screen to turn on alerts." Android: listen for `beforeinstallprompt`, `preventDefault()`, show an "Install" chip, call `prompt()` on tap; hide after `appinstalled`. Don't block on it — Chrome may never fire the event.

### 3.5 Service worker `public/sw.js` (push + click only; no offline caching in v1)

```js
/* public/sw.js — keep tiny; served with Cache-Control: no-cache (see next.config headers) */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  // Payload is the Declarative Web Push JSON. iOS 18.4+ shows it itself (and only runs this if "mutable": true);
  // Android/Chrome always lands here, so we render the same JSON.
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { notification: { title: 'FINN', body: event.data?.text() } } }
  const n = data.notification || {}
  const show = self.registration.showNotification(n.title || 'FINN', {
    body: n.body, tag: n.tag, icon: '/icon-192.png', badge: '/badge-96.png',
    data: { url: n.navigate || '/alerts' }, silent: !!n.silent, renotify: false,
  })
  const badge = (typeof data.app_badge === 'number' && 'setAppBadge' in navigator) ? navigator.setAppBadge(data.app_badge) : Promise.resolve()
  event.waitUntil(Promise.all([show, badge]))  // ALWAYS show something: WebKit revokes after 3 silent pushes
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/alerts', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const existing = list.find((c) => c.url.startsWith(self.location.origin))
    return existing ? existing.focus().then((c) => c.navigate(url)) : self.clients.openWindow(url)
  }))
})
```

`next.config.ts` headers (from the official Next.js PWA guide [verified: https://nextjs.org/docs/app/guides/progressive-web-apps]):

```ts
async headers() {
  return [{ source: '/sw.js', headers: [
    { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
    { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
    { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
  ]}]
}
```

Register it early (in a client component mounted in the layout) with `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })` so the registration already exists when the user taps "Enable alerts" (the tap handler must call `subscribe()` synchronously-ish — WebKit consumes the transient activation).

---

## 4. Web Push end-to-end

### 4.1 Keys & library [verified]
- `web-push` **4.0.0 was published 6 Nov 2026 and is ESM-only** (`"type": "module"`, **no default export**). `import webpush from 'web-push'` (as in the Next.js guide) **throws** `does not provide an export named 'default'` — I reproduced this on Node 24.9. Use `import * as webpush from 'web-push'` or named imports; `require('web-push')` also works on Node 24 via require(esm). Pin `web-push@4.0.0` (or `3.6.7` for CJS). Source: npm registry metadata + GitHub compare v3.6.7…v4.0.0 ("feat: migrate to ESM-only (#961)").
- Generate keys once: `npx web-push generate-vapid-keys --json` (worked locally). Put `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT=mailto:you@domain` in Vercel env. The VAPID subject must be a real `mailto:` or https URL (v4 docs warn against localhost subjects).

### 4.2 Client subscribe (`components/EnableAlerts.tsx`)

```tsx
'use client'
import { useState } from 'react'
import { needsHomeScreenInstall } from '@/lib/platform'

function b64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export function EnableAlerts({ deviceId }: { deviceId: string }) {
  const [state, setState] = useState<'idle' | 'on' | 'denied' | 'unsupported' | 'install'>('idle')
  if (typeof window !== 'undefined' && needsHomeScreenInstall()) return <InstallHint />   // iOS Safari tab
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && ('PushManager' in window || 'pushManager' in window)
  if (!supported) return null

  async function enable() {                       // MUST run directly in the tap handler
    const reg = await navigator.serviceWorker.ready // already registered at app start → resolves immediately
    const pm: PushManager = reg.pushManager ?? (window as any).pushManager
    try {
      const sub = await pm.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) })
      await fetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ deviceId, sub: sub.toJSON(), ua: navigator.userAgent }) })
      setState('on')
      await fetch('/api/push/test', { method: 'POST', body: JSON.stringify({ deviceId }) })  // the 30-second demo
    } catch (e: any) { setState(e?.name === 'NotAllowedError' ? 'denied' : 'unsupported') }
  }
  return <button onClick={enable} className="…">{state === 'on' ? 'Alerts on' : 'Enable alerts'}</button>
}
```

### 4.3 Server: store + send (`app/api/push/send/route.ts`, Vercel Node runtime)

```ts
import * as webpush from 'web-push'                 // v4: namespace/named imports only
import { Redis } from '@upstash/redis'             // free: 500K commands/mo, 250 MB, no sleep
import { waitUntil } from '@vercel/functions'

const redis = Redis.fromEnv()
webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)

export type Alert = { id: string; title: string; body: string; url: string; badge?: number; tag?: string }

// Declarative Web Push format → iOS 18.4+ renders without JS; Chrome hands it to sw.js. Keep < 4 KB.
export function toPayload(a: Alert, origin: string) {
  return JSON.stringify({
    web_push: 8030,
    mutable: true,                                  // Safari 26.2+ reads here …
    app_badge: a.badge ?? 1,                        // … and here (moved to top level in 2025)
    notification: {
      title: a.title, body: a.body, lang: 'en-IN', dir: 'ltr',
      navigate: new URL(a.url, origin).href,        // REQUIRED: tap target
      tag: a.tag ?? a.id, silent: false, mutable: true, app_badge: a.badge ?? 1,  // old-placement fallbacks (18.4–26.1)
    },
  })
}

export async function pushToDevice(deviceId: string, alert: Alert, origin: string) {
  const subs = await redis.hgetall<Record<string, string>>(`push:${deviceId}`)   // endpoint → JSON(sub)
  if (!subs) return 0
  const payload = toPayload(alert, origin)
  let sent = 0
  await Promise.allSettled(Object.entries(subs).map(async ([endpoint, raw]) => {
    try {
      await webpush.sendNotification(JSON.parse(raw), payload, { TTL: 3600, urgency: 'high', topic: alert.tag?.slice(0, 32) })
      sent++
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) await redis.hdel(`push:${deviceId}`, endpoint)  // expired → prune
      else console.error('push failed', err?.statusCode, err?.body)   // Apple returns reason codes e.g. BadJwtToken, VapidPkHashMismatch
    }
  }))
  return sent
}

export async function POST(req: Request) {
  if (req.headers.get('x-job-key') !== process.env.JOB_KEY) return new Response('nope', { status: 401 })
  const { deviceId, alert } = await req.json()
  waitUntil(pushToDevice(deviceId, alert, new URL(req.url).origin))   // respond fast, finish sending after
  return Response.json({ ok: true })
}
```

Why these choices (all [verified] above): `userVisibleOnly: true` is mandatory on WebKit; every push must display (we always `showNotification`); iOS payload cap 4 KB (3993 bytes plaintext); `TTL` so stale alerts aren't delivered hours later; `topic` collapses repeats. Storage: **Upstash Redis free** (500K commands/month, 250 MB, 1 DB) [verified: https://upstash.com/docs/redis/overall/billing] or **Neon Postgres free** (scales to zero after 5 min, resumes in "a few hundred milliseconds", never pauses) [verified: https://neon.com/pricing]. **Avoid Supabase free for this**: projects pause after 7 days of low activity and need a manual restore — a grader opening the link two weeks after submission would hit a dead app [verified: https://supabase.com/docs/guides/platform/free-project-pausing].

### 4.4 Vercel serverless constraints for push [verified: https://vercel.com/docs/functions/limitations ; https://vercel.com/docs/cron-jobs/usage-and-pricing]
- No long-lived process: everything runs inside a request (≤ 300 s on Hobby). Sending to 20 devices takes < 2 s — fine.
- **Vercel Cron on Hobby: max once per day, fires anywhere within the hour.** Hourly/minute expressions fail at deploy. Therefore: `vercel.json` cron for the *daily digest build* only (`"schedule": "30 1 * * *"` = 07:00–08:00 IST), and use an external scheduler for anything intraday or time-precise.
- External scheduler: **cron-job.org** — free, up to once per minute, custom headers/body, 30 s timeout, 64 KB response [verified: https://cron-job.org/en/]. Point it at `POST /api/jobs/poll-announcements` (every 10 min, 09:00–20:00 IST Mon–Fri) and `POST /api/jobs/eod` (18:45 IST) with an `x-job-key` header; make jobs idempotent. Alternatives: Upstash QStash free (1,000 msgs/day, 10 schedules) [verified: https://upstash.com/pricing/qstash]; GitHub Actions schedule (5-min minimum, "can be delayed … some queued jobs may be dropped") [verified: GitHub docs].
- Outbound to `push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com` is plain HTTPS — no allow-listing needed on Vercel.

### 4.5 The 30-second grader demo
Android (Chrome): open URL → tap **Enable alerts** → **Allow** → a test notification ("FINN is watching 18 stocks. Tap to see what changed today.") arrives in ~1–3 s → tap it → lands on `/alerts/<id>`. Then tap **Simulate an EOD anomaly** → second notification "TATAMOTORS −4.8% on 2.7× volume" → tap → the alert detail with sparkline + the filing.

iPhone: the button is replaced by the 3-step install card. After Add to Home Screen (~15 s) and reopening from the icon, the same two taps work. Keep **"Send to Telegram instead"** right next to it (§5.1) so an iPhone grader who doesn't want to install still gets a real push on their phone within 10 s.

### 4.6 In-app Alerts inbox (the fallback that always works)
- Every generated alert is written to `alerts:<deviceId>` (Redis list, newest first, 30-day TTL) **before** any channel is tried; channels are "delivery hints", the inbox is truth.
- UI: bell with unread count (also mirrored to `navigator.setAppBadge` when installed), grouped by day, swipe-to-dismiss, filters (Results / M&A / Mgmt change / Anomaly), a "Why did I get this?" line showing the rule that fired (threshold, window, ratio).
- Live update without push: `EventSource` or `fetch` polling every 60 s while the tab is visible (`document.visibilityState`), so a grader who denied notifications still sees the simulated alert appear.

---

## 5. External push channels

### 5.1 Telegram Bot API — **include** [verified: https://core.telegram.org/bots/features ; https://core.telegram.org/bots/faq ; https://core.telegram.org/bots/api]
Facts: create a bot in **@BotFather** (`/newbot`) — instant, free, no review. Deep links `https://t.me/<bot>?start=<payload>` deliver `/start <payload>`; payload **≤ 64 chars of `A–Z a–z 0–9 _ -`** (base64url recommended). Rate limits: **≤ 1 message/s per chat, ~30 messages/s overall**, 20/min in groups; text ≤ 4096 chars; `parse_mode` `HTML`/`MarkdownV2`; inline keyboards with `url`, `callback_data`, `web_app` buttons (buttons now also support `style: "danger"|"success"|"primary"`). Webhooks need a valid cert on ports 443/80/88/8443 and support a `secret_token` echoed in `X-Telegram-Bot-Api-Secret-Token`.

Subscribe flow (one tap for the grader):
1. Settings → **Connect Telegram** → app creates `tok = base64url(randomBytes(24))` (32 chars), `SETEX tg:link:<tok> 600 <deviceId>`, opens `https://t.me/finn_alerts_bot?start=<tok>` (`target=_blank`; on phones this opens the Telegram app directly).
2. Grader taps **Start** in Telegram. Bot webhook receives `/start <tok>` → `GETDEL tg:link:<tok>` → `SET tg:chat:<deviceId> <chat_id>` → replies with a rich confirmation + "Open FINN" button.
3. From then on every alert is also `sendMessage`'d. "Disconnect" in settings deletes the mapping; `/stop` in the chat does the same.

Webhook handler (`app/api/telegram/route.ts`), no SDK needed:

```ts
import { Redis } from '@upstash/redis'
const redis = Redis.fromEnv()
const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

export async function tg(method: string, body: unknown) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json(); if (!j.ok) console.error('telegram', method, j.description); return j
}

export async function POST(req: Request) {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== process.env.TELEGRAM_WEBHOOK_SECRET) return new Response('no', { status: 401 })
  const u = await req.json()
  const msg = u.message
  const m = msg?.text?.match(/^\/start\s+([A-Za-z0-9_-]{1,64})$/)
  if (m) {
    const deviceId = await redis.getdel<string>(`tg:link:${m[1]}`)
    if (!deviceId) await tg('sendMessage', { chat_id: msg.chat.id, text: 'That link expired — open FINN and tap <b>Connect Telegram</b> again.', parse_mode: 'HTML' })
    else {
      await redis.set(`tg:chat:${deviceId}`, msg.chat.id)
      await tg('sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
        text: '✅ <b>FINN connected.</b>\nYou\u2019ll get material filings and EOD anomalies for your 18 stocks here.',
        reply_markup: { inline_keyboard: [[{ text: 'Open FINN', url: `${process.env.APP_URL}/alerts` }], [{ text: 'Send a test alert', callback_data: 'test' }]] } })
    }
  } else if (msg?.text === '/stop') { /* delete mapping by chat_id index */ }
  if (u.callback_query) {
    await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id })   // must answer within a few seconds
    // handle 'test' | 'mute:RELIANCE:7d' etc.
  }
  return Response.json({ ok: true })   // always 200 fast; Telegram retries non-2xx
}
```

Alert message template (HTML, dense, phone-sized):

```ts
export function alertToTelegram(a: { symbol: string; kind: string; headline: string; lines: string[]; url: string; id: string }) {
  const text = `<b>${a.symbol}</b> · ${a.kind}\n${a.headline}\n${a.lines.map((l) => `• ${l}`).join('\n')}`.slice(0, 4000)
  return { parse_mode: 'HTML', text, link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [
      [{ text: 'Open in FINN', url: a.url }, { text: 'Filing PDF', url: `${a.url}/source` }],
      [{ text: `Mute ${a.symbol} 7d`, callback_data: `mute:${a.symbol}:7d` }, { text: 'Lower threshold', callback_data: `thr:${a.symbol}` }],
    ] } }
}
```

Register once (production URL only — Vercel preview URLs are behind Vercel login): `curl -X POST "$API/setWebhook" -d url="https://<prod>/api/telegram" -d secret_token="$TELEGRAM_WEBHOOK_SECRET" -d allowed_updates='["message","callback_query"]'`. Queue sends with ≥ 1 s spacing per chat (digest of N items = one message, not N).

Optional later: a `web_app` button opens FINN as a Telegram Mini App inside Telegram (needs the `telegram-web-app.js` script and theme handling) — skip for v1.

### 5.2 WhatsApp Cloud API — **skip** (confirmed too much friction) [verified: https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing]
- Test number: recipients must be pre-added and verify via code (historically max 5); temporary token expires in ~24 h; not for real traffic.
- Any business-initiated message outside a 24-hour customer-service window must be a **Meta-approved template** (status `APPROVED`), categorised Marketing/Utility/Authentication and **billed per delivered message** since 1 Jul 2025; service messages billed from the 1,001st per month since 1 Oct 2026. Production requires a real number + business verification. Three gates (approval, verification, billing) in a 7-day build with graders who won't pre-register their numbers → no.

### 5.3 Email — **optional, cheap to add** [verified: https://resend.com/docs/knowledge-base/resend-sending-limits ; https://help.brevo.com/hc/en-us/articles/208580669]
- **Resend free**: 100 emails/day, 3,000/month, 3 verified domains, 10 req/s. Needs a domain you control for a non-spammy From; the shared `onboarding@resend.dev` sender is for testing to your own address only [not re-verified].
- **Brevo free**: 300 emails/day, no time limit, SMTP + API.
- Use case: a **"Morning digest" email** at 07:30 IST is exactly what an investor reads over chai, and it's a nice artefact to screenshot in the covering note. Only worth it if a domain is available; otherwise skip.

### 5.4 ntfy.sh — **skip for graders, fine for ourselves** [verified live: `GET https://ntfy.sh/v1/account` → anonymous limits `messages: 250/day`, `emails: 5/day`; docs https://docs.ntfy.sh/publish/]
- Zero-signup HTTP push with Markdown, `Click` URL and `Actions: view, …` buttons — great for *our own* ops alerts (job failures). But graders would have to install the ntfy app and subscribe to a topic; the iOS app relies on Firebase + background tasks and is documented as not reliably instant. Telegram is the better external channel for people.

---

## 6. Performance on phones

### 6.1 Budget (first load, cold, 4G mid-range Android) [verified: https://infrequently.org/2025/11/performance-inequality-gap-2026/ ; https://web.dev/articles/defining-core-web-vitals-thresholds]
Alex Russell's 2026 baseline (Galaxy A24-class, 4G): for a 3-second load, **JS-light pages get 2.0 MiB total / 0.3 MiB JS; JS-heavy pages 1.2 MiB / 0.62 MiB JS** (two TLS connections). CWV "good": **LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1** at p75. Lighthouse mobile preset = 150 ms RTT, 1.6 Mbps down, 4× CPU slowdown.

FINN budget (hard limits for `next build` output and Lighthouse):

| Metric | Budget | How we hold it |
|---|---|---|
| First Load JS per route (gz) | **≤ 150 KB** (App Router framework baseline is roughly 100 KB [not re-verified]; read the real number from the `next build` table on day 1) | Server Components for data views; client components only for interaction; `next/dynamic(() => …, { ssr: false })` for charts/voice |
| Total critical path | ≤ 1 MB | No hero images; SVG icons inline; logos lazy |
| Fonts | 1 variable font, latin subset, ≤ 2 files, ≤ 120 KB | `next/font/google` (self-hosted, `display: 'swap'` default, automatic size-adjusted fallback → "no layout shift") [verified: https://nextjs.org/docs/app/api-reference/components/font] |
| LCP (Lighthouse mobile) | ≤ 2.0 s | Static shell via `cacheComponents` + streaming; the digest header is server-rendered text, not a chart |
| INP | ≤ 150 ms | No heavy list re-renders; virtualise > 50 rows; charts on canvas off main thread not needed at this size |
| CLS | ≤ 0.05 | Fixed-height rows, `tabular-nums`, skeletons sized to final height, images with width/height |
| Lighthouse mobile | Performance ≥ 90, A11y ≥ 95, Best Practices ≥ 95 | Run on prod URL before submission; **the PWA category no longer exists (removed in Lighthouse 12, Apr 2024)** — don't chase it [verified: https://github.com/GoogleChrome/lighthouse/releases/tag/v12.0.0] |

Also free on Hobby: Vercel **Speed Insights** (10k events/30 days) to see real CWV from graders' phones [verified: Hobby plan table].

### 6.2 Next.js 16 specifics
- `cacheComponents: true` + `partialPrefetching: true` in `next.config.ts` gives PPR: static shell served instantly, dynamic parts stream in `<Suspense>` [verified: https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents]. Use `"use cache"` for the EOD price table (revalidate daily) and per-company research outputs (cache by ticker+doc hash).
- React 19.2 ships `<ViewTransition>`; fine for tab switches, but keep animations ≤ 200 ms and respect `prefers-reduced-motion`.
- `proxy.ts` replaces middleware — use it only for the demo-mode cookie (§8); it runs on every request.
- Patch level matters: 16.4.5 fixed cache-poisoning issues in Cache Components; stay on latest.

### 6.3 Numeric data without layout shift
- `font-variant-numeric: tabular-nums` everywhere numbers appear (Tailwind `tabular-nums`); right-align columns; reserve width with `min-width: 7ch`.
- Render the sign and unit in fixed slots ("+4.2%" and "−0.8%" same width; use U+2212 minus).
- Format with `Intl.NumberFormat('en-IN')` for lakh/crore grouping (12,34,567). **[unverified]** whether `notation: 'compact'` yields "1.2 Cr"/"12 L" identically on iOS Safari vs Chrome — format compact values ourselves (`₹2.41L cr`) to be safe.
- Skeletons: same height as the final row; never swap "—" for a number of different width after load.

### 6.4 Dark mode without flash
Default to **system** theme: `color-scheme: light dark` + `light-dark()` tokens (or Tailwind `dark:` media variant). Zero JS, zero flash, and iOS/Android status bars follow via the two `theme-color` metas. Only add `next-themes` if a manual toggle is a product decision; set `suppressHydrationWarning` on `<html>`. Match manifest `background_color` to the dark background so the PWA launch frame isn't white.

### 6.5 Chart libraries (bundlephobia, measured today)

| Library | Version | min / gz | Rendering | Touch behaviour | Use for FINN? |
|---|---|---|---|---|---|
| Plain SVG sparkline (own code) | — | **~0 KB** | SVG, server-renderable | None needed (static) | **Yes** — every row/card; renders in RSC, no hydration |
| `uplot` | 1.6.32 | 50.8 / **21.9 KB** | Canvas | No built-in touch; pinch/pan via a plugin demo with known gaps [verified: GitHub README/issues] | Maybe, for a dense price+volume chart if size matters more than touch |
| `lightweight-charts` (TradingView) | 5.2.1 | 194 / **61.6 KB** (vendor: 35 KB base after tree-shaking) | Canvas | Native touch scroll/zoom; crosshair on **long-press** (can be made immediate by disabling scroll/scale) [verified: TradingView docs] | **Yes, one instance, lazy-loaded** on the company page only |
| `@visx/shape` + `@visx/scale` | 4.0.0 | ~87 / **~28 KB** | SVG (React) | You write it | Fine for custom small multiples; more code than value here |
| `react-sparklines` | 1.7.0 | 27.7 / 6.6 KB | SVG | None | Unmaintained; write our own instead |
| `recharts` | 3.10.1 | 562 / **150 KB** | SVG (React) | OK tooltips, heavy | **No** — alone it blows half the JS budget |

Chart guidance: 30-day sparkline (close) + a tiny volume bar strip with the anomaly bar highlighted, inline in alerts; one scrollable 1-year chart in Pull view. Touch targets ≥ 44×44 px; no hover-only affordances; `touch-action: pan-y` on chart containers so the page still scrolls.

---

## 7. Free hosting (verified from docs today)

| Platform | Free tier (Nov 2026) | Sleep / cold start | Verdict for FINN |
|---|---|---|---|
| **Vercel Hobby** | 100 GB bandwidth, 1M invocations, 4 CPU-h, 360 GB-h memory; functions **300 s max**, 2 GB; **cron: once/day, ±59 min**; **non-commercial only**; Python runtime (3.12 default; 500 MB bundle; FastAPI zero-config); single region, **`bom1` available** | Scale-to-zero functions, Fluid compute reuses instances; Node cold start sub-second (typical) | **Web app: yes.** Python API: **yes as a second Hobby project** (FastAPI) — biggest risk is pandas/yfinance import time on cold start **[unverified; measure]** |
| Cloudflare Workers Free | 100k req/day, **10 ms CPU/request**, 128 MB, 5 cron triggers, 50 subrequests/req | None (edge) | Not for Next.js SSR or Python; **good as a free precise cron pinger** if cron-job.org is undesirable |
| Netlify Free | **300 credits/month hard cap** (20 credits/GB bandwidth, 10/GB-h functions, 15 per production deploy) → projects pause when exhausted | — | A few deploys + grader traffic could exhaust 300 credits; no |
| Render Free | 750 instance-h/month, 512 MB, 0.1 CPU; Postgres expires in 30 days | **Spins down after 15 min idle; ~1 min to spin up** with a loading page | Fatal for on-demand taps. Acceptable only as a cron-woken batch worker (cron-job.org call doubles as wake-up) |
| Fly.io | **No free tier for new orgs** (pay-as-you-go; $1 trial credit for 7 days; smallest machine $2.19/mo) | — | No |
| Railway | $5 one-time trial for 30 days → Free plan **$1/month credit** | — | Trial would cover the demo window, then dies; no |
| Koyeb | 1 Free Instance (512 MB, 0.1 vCPU; Frankfurt/Washington only) | **Scales to zero after 1 h idle** | Marginal; US/EU only |
| Hugging Face Spaces | Static Spaces free; **Gradio/Docker Spaces now require PRO (paid)**; cpu-basic sleeps after 48 h | 48 h sleep | **No longer a free Python host** |
| Google Cloud Run | 2M requests, 180k vCPU-s, 360k GiB-s per month free; **billing account (card) required** | Scale-to-zero; cold start seconds for Python; min-instances cost money | Best "real" container option if a card is acceptable; `asia-south1` (Mumbai) exists |
| Upstash Redis | 500K commands/mo, 250 MB, 1 DB | None | **Yes** — subscriptions, inbox, caches, job locks |
| Neon Postgres | 100 CU-h/project/mo, 0.5 GB, scale-to-zero after 5 min | ~hundreds of ms resume; never pauses | Yes if relational data is wanted |
| Supabase Free | 500 MB, 2 projects | **Pauses after 7 days low activity; manual restore** | Avoid for a demo graded weeks later |

Sources: Vercel https://vercel.com/docs/plans/hobby , https://vercel.com/docs/functions/limitations , https://vercel.com/docs/cron-jobs/usage-and-pricing , https://vercel.com/docs/functions/runtimes/python , https://vercel.com/docs/frameworks/backend/fastapi , https://vercel.com/docs/functions/configuring-functions/region ; Cloudflare https://developers.cloudflare.com/workers/platform/limits/ ; Netlify https://netlify.com/pricing ; Render https://render.com/docs/free ; Fly https://docs.fly.io/about/pricing ; Railway https://railway.com/pricing.md ; Koyeb https://www.koyeb.com/docs/reference/instances ; HF https://huggingface.co/docs/hub/spaces-overview ; Cloud Run https://cloud.google.com/run/pricing ; Upstash https://upstash.com/docs/redis/overall/billing ; Neon https://neon.com/pricing ; Supabase https://supabase.com/pricing .

### 7.1 Recommended topology
```
graders' phones ──HTTPS──▶ Vercel Hobby project "finn" (Next.js 16, region bom1)
                               ├─ /api/push/*, /api/telegram, /api/jobs/* (Node functions, ≤300 s)
                               ├─ Upstash Redis (subs, inbox, caches, locks)
                               └─ fetch ─▶ Vercel Hobby project "finn-py" (FastAPI: yfinance EOD, PDF → text)  [or Cloud Run]
cron-job.org ──▶ POST /api/jobs/poll-announcements every 10 min (09:00–20:00 IST, Mon–Fri)
cron-job.org ──▶ POST /api/jobs/eod at 18:45 IST  (anomaly scan + Telegram/Web Push fan-out)
Vercel Cron  ──▶ GET  /api/jobs/digest "30 1 * * *" (07:00–08:00 IST; daily digest cache)
```
- **Give graders the production URL only.** New Vercel projects have Deployment Protection (Vercel Authentication) on by default for preview/deployment URLs; the production domain is public [verified: https://vercel.com/changelog/deployment-protection-is-now-enabled-by-default-for-new-projects]. Telegram's webhook must also point at production.
- Hobby's "non-commercial" clause: a hiring challenge prototype with no payments/ads is personal use [verified: fair-use guidelines]. Do not add "Buy me a coffee" links (donations count as commercial).
- Keep Python out of the request path graders tap: EOD data and PDF text are produced by jobs and cached; the Pull research call reads cached text and calls Gemini from Node. If Python must be synchronous, Vercel Python functions are the only free option without a sleep penalty — measure its cold start on day 1 and fall back to Node (`unpdf`/`pdfjs-dist` for PDFs, Yahoo chart JSON from Node) if it is > 3 s.

---

## 8. Easy access for graders

- **URL**: pick a memorable Vercel project name (`finn-enam.vercel.app` or similar; `*.vercel.app` names are first-come, free; a custom domain is optional). Put the URL in the README header, the email, and the covering note. Avoid URL shorteners (they add an interstitial on some phones and look phishy).
- **QR code**: `npx qrcode -o docs/finn-qr.png -w 512 "https://finn-enam.vercel.app/?demo=1"` (tested; 3 KB PNG) or `-t svg` for the README. Embed under the title with the caption "Scan on your phone". Also paste the QR into the email as an attachment.
- **Demo mode, no login**: first visit sets a signed `finn_device` cookie (UUID) in `proxy.ts`; the demo portfolio (15–20 tickers) is seeded for every new device from a static JSON; `?demo=1` also pre-seeds 3 sample alerts so the inbox is never empty. No OAuth, no email, no password. "Reset demo" in settings clears the device's state. Device-scoped state means two graders don't trample each other.
- **Add any NSE ticker**: bundle NSE's equity master list — `https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` downloads with a browser `User-Agent` (fetched today: **200 OK, 2,632 rows, 186 KB**; columns `SYMBOL, NAME OF COMPANY, SERIES, …, ISIN NUMBER`). Convert at build time to `public/nse-equities.json` (symbol + name, ~60 KB gz) for an instant offline-capable autocomplete; validate on add by fetching one EOD row (`<SYMBOL>.NS`) before accepting, and show the company name so a grader can confirm. Pre-set portfolio stays editable; a "Suggested additions" row (e.g. ZOMATO/ETERNAL, HAL, DIXON) shows the engine isn't hard-wired.
- **First-run state** must demonstrate both modes within 20 s: a digest already computed (from the last job run), two alerts in the inbox, and one pre-warmed research view (so Pull doesn't start with a 40-second PDF fetch). Pre-warm the ad-hoc research companies in the EOD job.
- Put a **"Tried it on a phone?"** footer with three links: Enable alerts · Connect Telegram · Add to Home Screen (iOS instructions). Graders remember what they could *feel*.

---

## 9. Phone QA checklist (run on real devices before submission)

Devices: at least one iPhone on iOS 26 or 27 (Safari), one iPhone on iOS 18 if available, one Android on Chrome (ideally a mid-range device). Also test with Low Power Mode on (iOS throttles timers/animations) and in a Telegram in-app browser (opens links by default).

**A. Access**
- [ ] QR in README scans with the iOS Camera app and Google Lens; lands on the production URL (not a preview URL / no Vercel login).
- [ ] Cold load over 4G (Wi-Fi off) < 3 s to usable digest; no login wall; demo portfolio present; inbox not empty.
- [ ] Link opened from Telegram/WhatsApp in-app browser works; "Open in Safari/Chrome" not required.

**B. Layout & viewport (iOS Safari tab + Home Screen; Android Chrome tab + installed)**
- [ ] No horizontal scroll at 320 px (iPhone SE width) and 430 px; nothing clipped behind the iOS bottom toolbar or home indicator (safe-area bottom padding visible).
- [ ] Standalone: content under translucent status bar is padded (`safe-area-inset-top`); clock/battery readable in both themes.
- [ ] `100dvh` shells don't jump when Safari's toolbar collapses/expands; fixed tab bar stays put.
- [ ] Rotation to landscape and back doesn't break layout (or orientation lock explained).
- [ ] Dark mode via system setting: no white flash on load or when opening from the Home Screen; status bar text contrast OK.
- [ ] Text zoom 150% (iOS Settings → Display → Text Size; Android font size Largest): no overlapping numbers; tables still readable.
- [ ] All tap targets ≥ 44×44 px; no hover-only UI; long-press on cards doesn't trigger iOS text selection/callouts (`-webkit-touch-callout: none`, `user-select: none` where appropriate).

**C. Interaction**
- [ ] Scrolling is smooth at 60 fps on the digest (no jank from charts); momentum scroll not cancelled by JS.
- [ ] Horizontal scroll-snap carousels (if any) snap correctly and don't trap vertical scroll.
- [ ] Pull-to-refresh: Android disabled where we provide our own refresh; iOS tab behaviour acceptable; standalone has our refresh control.
- [ ] Chat composer stays above the keyboard on iOS (visualViewport) and Android (`resizes-content`); sending keeps the keyboard open; the page doesn't scroll to a stale position after dismiss.
- [ ] Voice input button: permission prompt appears once; interim text shows; works after the first `onend`; fails gracefully with a text hint if denied.
- [ ] View transitions/animations respect Reduce Motion; nothing animates > 300 ms.
- [ ] Back gesture (iOS swipe / Android back) returns to the previous view, not out of the app; bottom-sheet modals close on back.

**D. Push & channels**
- [ ] iOS Safari tab: "Enable alerts" is replaced by the 3-step install card (no dead button).
- [ ] iOS Home Screen app: tap Enable → system prompt → Allow → test notification arrives within 5 s; tapping it opens the alert inside the web app (not Safari); app badge shows "1" and clears when the inbox is viewed.
- [ ] iOS: deny permission → UI explains how to re-enable in Settings → Notifications → FINN.
- [ ] Android Chrome tab: same flow without install; notification icon/badge render; tap opens the right URL (existing tab focused, not a new tab each time).
- [ ] Android installed (WebAPK): `beforeinstallprompt` chip works; installed app opens standalone; notifications attributed to "FINN".
- [ ] Telegram: Connect → Telegram opens → Start → confirmation within 3 s; test alert buttons work (Open in FINN deep-links to the exact alert; Mute acknowledges); `/stop` disconnects.
- [ ] Simulated anomaly alert appears in inbox within 60 s even with notifications denied (polling path).
- [ ] Kill the app/tab and send a push: notification still delivered (background delivery) on both platforms.
- [ ] Send 3 pushes in a row: all three display (no silent push; counter never trips).

**E. Performance & robustness**
- [ ] Lighthouse (mobile, prod URL): Performance ≥ 90, A11y ≥ 95; First Load JS ≤ 150 KB per route in `next build` output.
- [ ] LCP element is server-rendered text/number, not a client chart; CLS < 0.05 when alerts/skeletons resolve.
- [ ] Airplane mode mid-session: friendly offline notice, cached digest still visible; reconnect recovers without reload.
- [ ] Deploy a trivial change: the service worker updates (no-cache headers) and old notifications still open correct URLs.
- [ ] Leave the app untouched for 48 h, then open it: everything (Vercel functions, Redis/Neon, Python API) responds — nothing has "paused".
- [ ] Vercel logs show zero `FUNCTION_INVOCATION_TIMEOUT`; cron-job.org run history shows green for 24 h before submission.

---

## 10. Prioritised recommendations

1. **Day 1:** Next.js 16 + Tailwind 4.3 scaffold on Vercel Hobby (region `bom1`), production domain fixed, Upstash Redis attached, `manifest.ts` + `sw.js` + meta tags from §3 in place; QR generated. Verify on an iPhone and an Android *before* building features.
2. **Day 1–2:** Alerts inbox + "Simulate anomaly" button (the push story that can't fail), then Web Push with the declarative payload (§4), then Telegram connect (§5.1). Budget ≤ 1.5 days for all three.
3. **Day 2:** Decide Python's place by measuring Vercel Python cold start with yfinance+pandas; if > 3 s, keep Python only in cron-woken jobs and make the tap path Node-only.
4. Schedulers: cron-job.org for 10-minute announcement polling and the 18:45 IST EOD run; Vercel Cron only for the daily digest. Make every job idempotent and locked (`SET NX` in Redis).
5. Use SVG sparklines everywhere; load `lightweight-charts` lazily on one screen or not at all. Never ship Recharts.
6. Default to system dark mode with `light-dark()`; `tabular-nums` on every number; `en-IN` grouping.
7. Skip WhatsApp, ntfy for graders, Expo/TestFlight, Netlify/Render/Fly/Railway/HF for anything in the tap path.
8. Run the §9 checklist on the production URL on **Fri 14 Nov**, fix, re-run Sat morning, then freeze.

## 11. Assumptions other agents should challenge
- That graders will open the link on iOS 26/27 Safari or Android Chrome — if a grader uses iOS 18 on an old iPhone, everything still works except `light-dark()` is fine (17.5+) and View Transitions (18.0+) — OK; iOS < 17.5 would lose theme tokens → consider a `@supports` fallback if we care.
- That a Python service is needed at request time at all. The Yahoo chart endpoint and PDF-to-text are callable from Node; removing Python removes the only cold-start risk on free tiers.
- That Upstash Redis is enough state. If the research agent wants relational joins (filings × companies × quarters), use Neon (not Supabase free).
- That cron-job.org (donation-funded) is reliable enough for a week. Mitigation: also register a Cloudflare Worker cron (5 free triggers) hitting the same endpoints; jobs are idempotent so double-firing is harmless.
- That 10-minute polling of NSE/BSE announcements is acceptable latency for "triggered alerts". If the data agent finds a push/RSS/WebSocket source, the poll becomes a cheap backstop.

## 12. Not verified / open risks
- Vercel Python function cold start with pandas + yfinance (needs a deploy; not done per instructions).
- Real APNs delivery latency for Web Push and whether Focus modes on a grader's iPhone suppress the test notification (we can't control it; the inbox covers it).
- `Intl.NumberFormat` compact Indian notation parity across Safari/Chrome — format manually.
- Safari 26+ `theme-color` behaviour (secondary source only); low stakes.
- `100dvh`/`svh` Safari 15.4 support cited from memory (caniuse), not re-fetched today.
