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

## Firebase — where to find your keys

1. console.firebase.google.com → your project
2. gear icon → **Project settings**
3. scroll to **Your apps**. If there is no web app, click the **</>** icon and register one (nickname "biteScout web", no hosting needed).
4. under **SDK setup and configuration** choose **Config** — you get a block like
   `const firebaseConfig = { apiKey: "AIza…", authDomain: "…", projectId: "…", … }`
5. copy that whole block, then in the app: **Me → gear → "Saving on this phone only"** → paste → **Connect**.

Then in the Firebase console enable:
- **Authentication → Sign-in method → Google** (and **Email link** for passwordless email).
  Add your GitHub Pages domain under Authentication → Settings → **Authorised domains**,
  otherwise the Google popup is rejected.
- **Firestore Database → Create database** (production mode is fine)
- **Storage → Get started** (for check-in photos)

While you're just testing with friends, these Firestore rules are enough:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /spots/{id}    { allow read: if true; allow write: if request.auth != null; }
    match /checkins/{id} { allow read: if true; allow create: if request.auth != null; }
    match /lists/{id}    { allow read, write: if request.auth != null; }
    match /users/{uid}   { allow read, write: if request.auth != null && request.auth.uid == uid; }
  }
}
```

Until you connect Firebase the app runs in on-device mode: everything works and persists, it just
doesn't sync between phones. Settings → "Reset prototype data" wipes it.

## What is real vs. mocked in this build

Real: your GPS position and true distances to every spot, the 150 m check-in rule, camera
photos (stored on device, uploaded to Firebase Storage once connected), saving, list building,
adding new places, streak and level from your actual check-ins, offline shell, install to home screen.

Mocked: nothing social is faked any more. The activity feed, "who\'s been" on a spot and your
profile stats are built only from real check-ins. Until Firebase is connected there is one
local account ("You") on this phone, and other people\'s check-ins can\'t reach you. Photos of the
seed spots are labelled placeholders until someone checks in with a real photo.

Note on the seed data: on first launch the nine starter spots are planted around wherever you
actually are (90 m, 250 m, 500 m, 1.5 km…) plus the real Penang and JB ones. That way distances
and the check-in radius are testable without driving to Bangsar.

## Next steps to make it a product

1. **Firebase Auth** — swap the simulated sign-in for `signInWithPopup(GoogleAuthProvider)`
   and `sendSignInLinkToEmail`. The email-link screens already match that flow.
2. **Firestore** — collections: `spots`, `checkins`, `users`, `lists`, `follows`.
   A check-in document is the unit of trust: `{spotId, userId, photoUrl, verdict, geo, createdAt}`.
   Compute `visits` and `wouldGoAgain%` from it rather than storing them.
3. **Map** — done: MapLibre GL + OpenStreetMap raster tiles, no API key or billing. Markers are
   your real spots, the blue dot is you, the crosshair button re-centres. If you later want
   Google's tiles, only the style URL in `OSM_STYLE` changes.
4. **Geolocation gate** — `navigator.geolocation.getCurrentPosition` on the check-in screen;
   reject check-ins further than ~150 m from the spot. This is the anti-fake-review rule.
5. **Photo upload** — `<input type="file" accept="image/*" capture="environment">` →
   Firebase Storage; keep the "photo required" rule.
6. **Real logo + photography** — replace the two icon PNGs and the striped photo slots.
