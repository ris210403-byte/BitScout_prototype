# biteScout — installable PWA build

This folder is a complete, hostable web app. Serve it over HTTPS and Android Chrome will
offer "Install app" / "Add to Home screen" — it then launches full-screen with no browser UI.

```
index.html      the app (all 5 tabs, onboarding, search, check-in, lists, messages)
support.js      runtime the app is built on
manifest.json   name, icons, standalone display, cobalt theme colour
sw.js           service worker — caches the app shell so it opens offline
icon-192.png    placeholder launcher icons (replace with the real logo)
icon-512.png
```

## Test it on your phone in 2 minutes

Any static host works. Firebase Hosting is the natural fit since biteScout is already on Firebase:

```bash
npm install -g firebase-tools
firebase login
cd pwa
firebase init hosting      # public directory: . (this folder) · single-page app: No
firebase deploy
```

Open the deployed URL on Android Chrome → menu → **Install app**.

Quicker, no account: `npx serve .` on your laptop and open `http://<laptop-ip>:3000` on
your phone (same wifi). Note: install + offline need HTTPS, so use a real host for that.

There is also a single-file `biteScout standalone.html` next to this folder — AirDrop/WhatsApp
it to a phone and open it in Chrome. No server, no install, good for showing people.

## Play Store (optional, later)

Wrap the hosted PWA in a Trusted Web Activity — no code changes:

```bash
npx @bubblewrap/cli init --manifest https://<your-domain>/manifest.json
npx @bubblewrap/cli build
```

That produces a signed `.aab` you can upload to Play Console. (Capacitor is the alternative
if you later need native camera/geolocation APIs beyond what the web gives you.)

## What is real vs. mocked in this build

Real: navigation, all screen states, live search, filters, saving, list building, check-in
gating and validation, follow/unfollow, messages, settings toggles, install prompt, offline shell.

Mocked: the 9 spots and 5 scouts are in-memory data in `index.html`; the map is a stylised
placeholder; sign-in is simulated; photos are labelled placeholder blocks. Nothing persists
across a reload.

## Next steps to make it a product

1. **Firebase Auth** — swap the simulated sign-in for `signInWithPopup(GoogleAuthProvider)`
   and `sendSignInLinkToEmail`. The email-link screens already match that flow.
2. **Firestore** — collections: `spots`, `checkins`, `users`, `lists`, `follows`.
   A check-in document is the unit of trust: `{spotId, userId, photoUrl, verdict, geo, createdAt}`.
   Compute `visits` and `wouldGoAgain%` from it rather than storing them.
3. **Real map** — Google Maps JS SDK (or MapLibre + free tiles) in the Nearby tab; the pin
   markers, bottom card and city switcher already have their places in the layout.
4. **Geolocation gate** — `navigator.geolocation.getCurrentPosition` on the check-in screen;
   reject check-ins further than ~150 m from the spot. This is the anti-fake-review rule.
5. **Photo upload** — `<input type="file" accept="image/*" capture="environment">` →
   Firebase Storage; keep the "photo required" rule.
6. **Real logo + photography** — replace the two icon PNGs and the striped photo slots.
