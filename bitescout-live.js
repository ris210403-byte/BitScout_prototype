/* biteScout live layer — persistence, GPS, camera, auth.
   Works with zero setup (on-device store). Paste a Firebase web config in
   Settings → Cloud sync and it upgrades to Auth + Firestore + Storage.
   Exposes window.BS. No build step, no npm. */
(function () {
  var KEY = 'bs.v1', CFG = 'bs.firebase', LISTENERS = [];
  var STORE_VERSION = 2;
  var CHECKIN_RADIUS_M = 150;

  function nowISO() { return new Date().toISOString(); }
  function uid(p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); }

  // ── store ────────────────────────────────────────────────────────────
  function blank() {
    return { v: STORE_VERSION, spots: [], checkins: [], saved: {}, lists: [], listAdd: {}, following: {},
             msgs: {}, user: null, origin: null, seeded: false, settings: { loc: true, push: false, halal: false } };
  }
  // v1 stores carried invented endorsers and fabricated visit counts — scrub them
  function migrate(s) {
    if ((s.v || 1) >= STORE_VERSION) return s;
    (s.spots || []).forEach(function (sp) {
      delete sp.who; delete sp.initials; delete sp.avBg; delete sp.quote;
      sp.visits = 0; sp.again = null;
      if (sp.addedBy === 'seed') sp.unverified = true;
    });
    s.msgs = {};
    s.following = {};
    s.v = STORE_VERSION;
    return s;
  }
  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var parsed = JSON.parse(raw);
      var s = Object.assign(blank(), parsed);
      s.v = parsed.v || 1;           // version must come from the STORED data, not the defaults
      return migrate(s);
    }
    catch (e) { return blank(); }
  }
  var store = read();
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { // quota — drop the oldest photos and retry once
      store.checkins.forEach(function (c, i) { if (i < store.checkins.length - 6) delete c.photo; });
      store.spots.forEach(function (s, i) { if (i > 3) delete s.photo; });
      try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e2) {}
    }
  }
  function emit() { persist(); LISTENERS.forEach(function (f) { try { f(); } catch (e) {} }); }

  // ── geo ──────────────────────────────────────────────────────────────
  var geo = { pos: null, error: null, accuracy: null, watching: false };
  function distanceM(a, b, c, d) {
    if ([a, b, c, d].some(function (v) { return typeof v !== 'number'; })) return null;
    var R = 6371000, p = Math.PI / 180;
    var dLat = (c - a) * p, dLng = (d - b) * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  function fmtDist(m) {
    if (m === null || m === undefined) return '—';
    return m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 9500 ? 1 : 0) + ' km';
  }
  function fmtWalk(m) {
    if (m === null) return '';
    var mins = Math.round(m / 80);
    return m < 1400 ? 'walk ' + Math.max(1, mins) + ' min' : 'drive ' + Math.max(2, Math.round(m / 450)) + ' min';
  }
  function requestGeo() {
    if (!navigator.geolocation) { geo.error = 'unsupported'; emit(); return Promise.resolve(null); }
    return new Promise(function (res) {
      navigator.geolocation.getCurrentPosition(function (p) {
        geo.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        geo.accuracy = Math.round(p.coords.accuracy); geo.error = null;
        if (!store.origin) { store.origin = geo.pos; seedAround(geo.pos); }
        watch(); emit(); res(geo.pos);
      }, function (err) {
        geo.error = err.code === 1 ? 'denied' : 'unavailable';
        if (!store.origin) { store.origin = FALLBACK; seedAround(FALLBACK); }
        emit(); res(null);
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
  }
  function watch() {
    if (geo.watching || !navigator.geolocation) return;
    geo.watching = true;
    navigator.geolocation.watchPosition(function (p) {
      geo.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      geo.accuracy = Math.round(p.coords.accuracy);
      LISTENERS.forEach(function (f) { try { f(); } catch (e) {} });
    }, function () {}, { enableHighAccuracy: true, maximumAge: 15000 });
  }

  // ── seed: place the starter spots around wherever the user actually is ──
  var FALLBACK = { lat: 3.1319, lng: 101.6841 }; // Bangsar, KL
  var SEED = [
    { name: 'Warung Pak Din', cuisine: 'Nasi lemak', priceNum: 8, area: 'corner shoplot', halal: 'Certified', hours: '7:00 – 14:30', open: true, slot: 'photo — nasi lemak plate',  tags: ['Cash only', 'Breakfast', 'Standing tables'], dx: 90, dy: 60 },
    { name: 'Kopi & Kaya House', cuisine: 'Kopitiam', priceNum: 12, area: 'main road', halal: 'Pork-free', hours: '7:30 – 18:00', open: true, slot: 'photo — kopitiam interior',  tags: ['Wifi', 'Aircon', 'Card ok'], dx: -220, dy: 180 },
    { name: 'Roti Canai Corner', cuisine: 'Mamak', priceNum: 6, area: 'two streets over', halal: 'Certified', hours: 'Open 24 hours', open: true, slot: 'photo — roti canai on griddle',  tags: ['Late night', 'Halal', 'Outdoor'], dx: 420, dy: -300 },
    { name: 'Sate Kajang Corner', cuisine: 'Satay', priceNum: 18, area: 'night market row', halal: 'Certified', hours: '17:00 – 23:00', open: false, slot: 'photo — satay over charcoal',  tags: ['Dinner', 'Halal', 'Family'], dx: -1400, dy: 900 },
    { name: 'CKT Ah Leng', cuisine: 'Noodles', priceNum: 11, area: 'food court', halal: 'Pork-free', hours: '8:00 – 13:00', open: true, slot: 'photo — wok-fried kuey teow',  tags: ['Cash only', 'Breakfast', 'Queue'], dx: 780, dy: 1100 },
    { name: 'Lorong Selamat CKT', cuisine: 'Noodles', priceNum: 15, area: 'Georgetown, Penang', halal: 'Pork-free', hours: '11:00 – 18:00', open: true, slot: 'photo — char kuey teow closeup',  tags: ['Cash only', 'Lunch', 'Queue'], lat: 5.4192, lng: 100.3306 },
    { name: 'Nasi Kandar Beratur', cuisine: 'Nasi kandar', priceNum: 14, area: 'Georgetown, Penang', halal: 'Certified', hours: '22:00 – 07:00', open: false, slot: 'photo — nasi kandar counter',  tags: ['Late night', 'Halal', 'Queue'], lat: 5.4141, lng: 100.3288 },
    { name: 'Kacang Pool Haji', cuisine: 'Breakfast', priceNum: 9, area: 'Larkin, JB', halal: 'Certified', hours: '7:00 – 12:00', open: true, slot: 'photo — kacang pool with egg',  tags: ['Breakfast', 'Halal', 'Cash only'], lat: 1.4927, lng: 103.7414 },
    { name: 'Restoran Ah Chuan', cuisine: 'Bak kut teh', priceNum: 20, area: 'Taman Sentosa, JB', halal: 'Non-halal', hours: '8:00 – 15:00', open: true, slot: 'photo — claypot bak kut teh',  tags: ['Aircon', 'Lunch', 'Card ok'], lat: 1.4732, lng: 103.7618 }
  ];
  function offset(o, dx, dy) {
    return { lat: o.lat + dy / 111320, lng: o.lng + dx / (111320 * Math.cos(o.lat * Math.PI / 180)) };
  }
  function seedAround(origin) {
    if (store.seeded) return;
    store.spots = SEED.map(function (s, i) {
      var pos = s.lat ? { lat: s.lat, lng: s.lng } : offset(origin, s.dx, s.dy);
      var o = {}; for (var k in s) if (k !== 'dx' && k !== 'dy') o[k] = s[k];
      o.id = 's' + (i + 1); o.lat = pos.lat; o.lng = pos.lng; o.addedBy = 'seed'; o.createdAt = nowISO();
      o.unverified = true; o.visits = 0; o.again = null;
      return o;
    });
    store.seeded = true;
    persist();
    if (cloud.db) store.spots.forEach(function (s) { cloudWrite('spots', s); });
  }

  // ── photos ───────────────────────────────────────────────────────────
  function pickPhoto() {
    return new Promise(function (res) {
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
      input.style.position = 'fixed'; input.style.left = '-9999px';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        document.body.removeChild(input);
        if (!f) return res(null);
        downscale(f).then(res);
      });
      input.click();
    });
  }
  function downscale(file) {
    return new Promise(function (res) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 900, r = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }

  // ── firebase (optional) ──────────────────────────────────────────────
  var cloud = { app: null, auth: null, db: null, storage: null, fns: null, error: null };
  function getConfig() {
    try { var raw = localStorage.getItem(CFG); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveConfig(text) {
    var cfg;
    try {
      cfg = typeof text === 'string' ? JSON.parse(
        text.trim()
          .replace(/^const\s+firebaseConfig\s*=\s*/, '').replace(/;$/, '')
          .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
          .replace(/'/g, '"').replace(/,(\s*[}\]])/g, '$1')
      ) : text;
    } catch (e) { return { ok: false, error: 'That does not look like a Firebase config object.' }; }
    if (!cfg || !cfg.apiKey || !cfg.projectId) return { ok: false, error: 'Missing apiKey or projectId.' };
    localStorage.setItem(CFG, JSON.stringify(cfg));
    return { ok: true, config: cfg };
  }
  function clearConfig() { localStorage.removeItem(CFG); }

  var CDN = 'https://www.gstatic.com/firebasejs/10.12.2/';
  function initCloud() {
    var cfg = getConfig();
    if (!cfg) return Promise.resolve(false);
    return Promise.all([
      import(CDN + 'firebase-app.js'),
      import(CDN + 'firebase-auth.js'),
      import(CDN + 'firebase-firestore.js'),
      import(CDN + 'firebase-storage.js')
    ]).then(function (mods) {
      var A = mods[0], Au = mods[1], F = mods[2], St = mods[3];
      cloud.app = A.initializeApp(cfg);
      cloud.auth = Au.getAuth(cloud.app);
      cloud.db = F.getFirestore(cloud.app);
      cloud.storage = St.getStorage(cloud.app);
      cloud.fns = { Au: Au, F: F, St: St };
      Au.onAuthStateChanged(cloud.auth, function (u) {
        if (u) cloudWrite('users', { id: u.uid, name: u.displayName || 'Scout', email: u.email || '',
          photo: u.photoURL || '', lastSeen: nowISO() });
        store.user = u ? { uid: u.uid, name: u.displayName || 'Scout', email: u.email || '',
          initials: (u.displayName || 'S C').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() } : null;
        emit();
      });
      // live spots + checkins
      F.onSnapshot(F.collection(cloud.db, 'spots'), function (snap) {
        if (snap.empty) { store.seeded = false; if (store.origin) seedAround(store.origin); return; }
        store.spots = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        store.seeded = true; emit();
      }, function (e) { cloud.error = e.message; emit(); });
      F.onSnapshot(F.collection(cloud.db, 'checkins'), function (snap) {
        store.checkins = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        emit();
      }, function () {});
      return true;
    }).catch(function (e) { cloud.error = e.message || String(e); emit(); return false; });
  }
  function cloudWrite(coll, obj) {
    if (!cloud.db) return Promise.resolve();
    if (coll === 'spots') { obj = Object.assign({}, obj); delete obj.who; delete obj.initials; delete obj.avBg; delete obj.quote; }
    var F = cloud.fns.F;
    return F.setDoc(F.doc(cloud.db, coll, obj.id), obj, { merge: true }).catch(function (e) { cloud.error = e.message; });
  }
  function uploadPhoto(dataUrl, path) {
    if (!cloud.storage || !dataUrl) return Promise.resolve(dataUrl);
    var St = cloud.fns.St, ref = St.ref(cloud.storage, path);
    return St.uploadString(ref, dataUrl, 'data_url').then(function () { return St.getDownloadURL(ref); })
      .catch(function () { return dataUrl; });
  }

  // ── public API ───────────────────────────────────────────────────────
  var BS = {
    RADIUS: CHECKIN_RADIUS_M,
    get store() { return store; },
    get geo() { return geo; },
    get cloud() { return { on: !!cloud.db, configured: !!getConfig(), error: cloud.error }; },
    onChange: function (fn) { LISTENERS.push(fn); return function () { LISTENERS = LISTENERS.filter(function (f) { return f !== fn; }); }; },
    start: function () {
      if (!store.seeded) seedAround(store.origin || FALLBACK);
      var p = initCloud();
      requestGeo();
      return p;
    },
    requestGeo: requestGeo,
    distanceTo: function (s) {
      var from = geo.pos || store.origin;
      if (!from || typeof s.lat !== 'number') return null;
      return distanceM(from.lat, from.lng, s.lat, s.lng);
    },
    fmtDist: fmtDist, fmtWalk: fmtWalk,
    canCheckIn: function (s) { var d = this.distanceTo(s); return d !== null && d <= CHECKIN_RADIUS_M; },
    visitsFor: function (id) {
      return store.checkins.filter(function (c) { return c.spotId === id; }).length;
    },
    againFor: function (id) {
      var cs = store.checkins.filter(function (c) { return c.spotId === id; });
      if (!cs.length) return null;
      var yes = cs.filter(function (c) { return c.verdict === 'Definitely'; }).length;
      return Math.round(yes / cs.length * 100);
    },
    myCheckins: function () {
      var me = (store.user && store.user.uid) || 'local';
      return store.checkins.filter(function (c) { return c.userId === me; }).reverse();
    },
    activity: function () { return store.checkins.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }); },
    checkinsFor: function (id) { return store.checkins.filter(function (c) { return c.spotId === id; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }); },
    photoFor: function (id) {
      var c = store.checkins.filter(function (x) { return x.spotId === id && x.photo; }).pop();
      var s = store.spots.find(function (x) { return x.id === id; });
      return (c && c.photo) || (s && s.photo) || null;
    },
    pickPhoto: pickPhoto,
    addCheckin: function (spotId, verdict, note, photo) {
      var u = store.user || {};
      var c = { id: uid('ci'), spotId: spotId, verdict: verdict, note: note || '', photo: photo || null,
                userId: u.uid || 'local', userName: u.name || 'You', userInitials: u.initials || 'ME',
                createdAt: nowISO(), geo: geo.pos || null };
      store.checkins.push(c); emit();
      if (cloud.db) uploadPhoto(c.photo, 'place-photos/' + spotId + '/' + c.id + '.jpg').then(function (url) {
        cloudWrite('checkins', Object.assign({}, c, { photo: url }));
      });
      return c;
    },
    addSpot: function (data) {
      var pos = geo.pos || store.origin || FALLBACK;
      var s = Object.assign({
        id: uid('sp'), lat: pos.lat, lng: pos.lng, open: true,
        hours: 'Hours not added yet', area: 'added by you', tags: ['New', 'Needs 2 confirmations'],
        addedBy: (store.user && store.user.uid) || 'local',
        createdAt: nowISO(), slot: 'photo — ' + (data.name || 'new spot').toLowerCase()
      }, data);
      store.spots.push(s); emit();
      if (cloud.db) uploadPhoto(s.photo, 'place-photos/' + s.id + '/cover.jpg').then(function (url) {
        cloudWrite('spots', Object.assign({}, s, { photo: url }));
      });
      return s;
    },
    toggleSave: function (id) {
      store.saved[id] = !store.saved[id]; emit();
      if (cloud.db && store.user) cloudWrite('users', { id: store.user.uid, saved: store.saved });
      return store.saved[id];
    },
    createList: function (name, note) {
      var l = { id: uid('ul'), name: name, note: note, spots: [] };
      store.lists.push(l); emit();
      if (cloud.db) cloudWrite('lists', l);
      return l;
    },
    toggleInList: function (listId, spotId) {
      var cur = store.listAdd[listId] || [];
      store.listAdd[listId] = cur.indexOf(spotId) > -1 ? cur.filter(function (x) { return x !== spotId; }) : cur.concat([spotId]);
      emit();
    },
    setFollow: function (id, on) { store.following[id] = on; emit(); },
    setSetting: function (k, v) { store.settings[k] = v; emit(); },
    pushMsg: function (threadId, msg) {
      store.msgs[threadId] = (store.msgs[threadId] || []).concat([msg]); emit();
    },
    signInLocal: function (name) {
      var n = (name || 'Me').trim();
      var parts = n.split(/\s+/).filter(Boolean);
      var ini = (parts.length > 1 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
      store.user = { uid: 'local', name: n, email: 'this device only', initials: ini, local: true };
      emit(); return Promise.resolve(store.user);
    },
    signInGoogle: function () {
      if (!cloud.auth) return Promise.resolve({ needsCloud: true });
      var Au = cloud.fns.Au;
      return Au.signInWithPopup(cloud.auth, new Au.GoogleAuthProvider()).catch(function (e) { cloud.error = e.message; emit(); });
    },
    signInEmailLink: function (email) {
      if (!cloud.auth) return Promise.resolve({ needsCloud: true });
      var Au = cloud.fns.Au;
      return Au.sendSignInLinkToEmail(cloud.auth, email, { url: location.href, handleCodeInApp: true })
        .then(function () { localStorage.setItem('bs.emailForSignIn', email); return true; })
        .catch(function (e) { cloud.error = e.message; emit(); return false; });
    },
    completeEmailLink: function () {
      if (!cloud.auth) return Promise.resolve(false);
      var Au = cloud.fns.Au;
      if (!Au.isSignInWithEmailLink(cloud.auth, location.href)) return Promise.resolve(false);
      var email = localStorage.getItem('bs.emailForSignIn') || '';
      return Au.signInWithEmailLink(cloud.auth, email, location.href).then(function () { return true; }).catch(function () { return false; });
    },
    signOut: function () {
      if (cloud.auth) cloud.fns.Au.signOut(cloud.auth);
      store.user = null; emit();
    },
    saveConfig: function (text) {
      var r = saveConfig(text);
      if (r.ok) return initCloud().then(function (ok) { emit(); return { ok: ok, error: cloud.error }; });
      return Promise.resolve(r);
    },
    disconnect: function () { clearConfig(); location.reload(); },
    reset: function () { localStorage.removeItem(KEY); location.reload(); }
  };
  window.BS = BS;
})();
