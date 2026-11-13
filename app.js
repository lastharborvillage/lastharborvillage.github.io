// Last Harbor site. Loads data/<village>.json (built by scripts/site.mjs) and draws the village live with
// the same engine as the videos (engine/*.js, everything on globalThis.LH).
(() => {
  'use strict';
  const LH = globalThis.LH;
  const T = LH.map.T;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let VILLAGES = ['instagram', 'youtube']; // data/index.json: since the merge (2026-11-11) one village
  let REDIRECT = {}; // old links of a village that moved in: { youtube: { village, ids: { oldId: newId } } }
  const STAGE_NAMES = { none: 'Nothing yet', keel: 'Keel', ribs: 'Ribs', hull: 'Hull', deck: 'Deck', mast: 'Mast', sails: 'Sails', flag: 'Flag' };
  const cache = {};
  let D = null; // current village data
  let village = 'instagram';

  // ---------- helpers ----------
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const districtName = (id) => (D.world.districts[id] && D.world.districts[id].name) || '???';
  const people = () => D.world.villagers;
  const findPerson = (id) => people().find((v) => v.id === id) || D.world.founders.find((f) => f.id === id);
  const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
  const spotOf = (p) => (p.pos ? p.pos : p.home && p.home.tileX != null ? LH.map.homeSpot(p) : null);

  // a small portrait of a villager (or the cat) on a canvas
  function portrait(p, w = 32, h = 30) {
    const c = el('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = LH.PAL.grass;
    g.fillRect(0, 0, w, h);
    g.fillStyle = LH.PAL.moss;
    g.fillRect(0, h - 4, w, 4);
    if (p.appearance) LH.draw.drawVillager(g, p.appearance, p.id, Math.round(w / 2) - (p.appearance.pet ? 4 : 0), h - 4, 0, null);
    else if (p.id === 'cat') { const s = LH.draw.petSprite('cat'); g.drawImage(s.frames[0], Math.round(w / 2 - s.w / 2), h - 4 - s.h + 1); }
    return c;
  }

  function personButton(p, tag) {
    const b = el('button', 'person');
    b.type = 'button';
    b.appendChild(portrait(p));
    const who = el('span', 'who');
    who.appendChild(el('span', 'nm', p.displayName || (p.id === 'cat' ? 'The cat' : p.id)));
    who.appendChild(el('span', 'jb', p.job || ''));
    b.appendChild(who);
    if (tag) b.appendChild(el('span', 'tag', tag));
    b.addEventListener('click', () => openVillager(p.id));
    return b;
  }

  // ---------- map ----------
  const canvas = $('map-canvas');
  const ctx = canvas.getContext('2d');
  const ZOOMS = [1, 1.5, 2, 3, 4, 5, 6, 8];
  const HOME = { x: 7 * T, y: 3 * T };
  const OVERVIEW = { x: -2 * T, y: 7 * T }; // the start (and the home button): fully zoomed out
  const M = { x: HOME.x, y: HOME.y, zi: 3, tod: null, sel: null, actors: [], visible: true, last: 0, fly: null, hinted: false };
  // how far the map can be dragged: the old village area, widened to every home, landmark and tent
  const BOUNDS = { x0: -44 * T, x1: 38 * T, y0: -14 * T, y1: 27 * T };
  function fitBounds(w) {
    Object.assign(BOUNDS, { x0: -44 * T, x1: 38 * T, y0: -14 * T, y1: 27 * T });
    const grow = (x, y) => { BOUNDS.x0 = Math.min(BOUNDS.x0, x - 6 * T); BOUNDS.x1 = Math.max(BOUNDS.x1, x + 6 * T); BOUNDS.y1 = Math.max(BOUNDS.y1, y + 6 * T); };
    for (const v of w.villagers || []) if (v.home && v.home.tileX != null) grow(v.home.tileX * T, v.home.tileY * T);
    for (const l of w.landmarks || []) grow(l.tileX * T, l.tileY * T);
    const tents = LH.map.camp(LH.map.tentsFor(w, (w.story && w.story.followers) || 0));
    if (tents.length) { const [tx, ty] = tents[tents.length - 1]; grow(tx * T, ty * T); }
  }
  const zoom = () => ZOOMS[M.zi];
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const clampCam = () => { M.x = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, M.x)); M.y = Math.max(BOUNDS.y0, Math.min(BOUNDS.y1, M.y)); };

  function brusselsTod() {
    const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
    return h >= 6 && h < 9 ? 'dawn' : h >= 9 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
  }
  const TODS = ['day', 'dusk', 'night', 'dawn'];
  M.tod = brusselsTod();
  $('map-tod').textContent = M.tod.toUpperCase();
  $('map-tod').addEventListener('click', () => { M.tod = TODS[(TODS.indexOf(M.tod) + 1) % TODS.length]; $('map-tod').textContent = M.tod.toUpperCase(); });

  function draw(t) {
    if (!D) return;
    const r = dpr();
    const w = Math.round(canvas.clientWidth * r), h = Math.round(canvas.clientHeight * r);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (M.fly) {
      const p = Math.min(1, (performance.now() - M.fly.start) / 900);
      const e = LH.core.eio(p);
      M.x = M.fly.from.x + (M.fly.to.x - M.fly.from.x) * e;
      M.y = M.fly.from.y + (M.fly.to.y - M.fly.from.y) * e;
      if (p >= 1) M.fly = null;
    }
    const z = Math.max(1, Math.round(zoom() * r));
    M.cam = { x: M.x, y: M.y, z, w, h };
    const cat = D.cat ? [D.cat[0] * T, D.cat[1] * T] : undefined;
    const res = LH.draw.renderWorld(ctx, { world: D.world, cam: { x: M.x, y: M.y, z }, t, tod: M.tod, cat, fast: true });
    M.actors = res.actors;
    // name tags when close enough to read
    const tagSize = Math.round(13 * r);
    if (zoom() >= 4) {
      for (const a of res.actors.sort((p, q) => p.sy - q.sy)) {
        if (!a.name || a.id === M.sel) continue;
        if (a.sx < 0 || a.sx > w || a.sHead < 30 * r || a.sy > h + 20) continue;
        LH.ui.nameTag(ctx, a.name, a.sx, a.sHead - 2 * r, { crew: a.crew, patron: a.patron, size: tagSize });
      }
    }
    // the selected villager: a bobbing marker and a tag at any zoom
    const s = M.sel && res.actors.find((a) => a.id === M.sel);
    if (s) {
      LH.ui.nameTag(ctx, s.name, s.sx, s.sHead - (4 + Math.sin(t * 4) * 2) * r, { crew: s.crew, patron: s.patron, size: Math.round(16 * r), color: LH.PAL.lanternhi });
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!M.visible || document.hidden) return;
    // full speed while the map is being dragged, zoomed or flying (and a moment after); ~15 fps is
    // plenty for waves and lights when nobody touches it
    const busyNow = M.fly || now - (M.touched || 0) < 600;
    if (now - M.last < (busyNow ? 0 : 66)) return;
    M.last = now;
    draw(now / 1000);
  }
  new IntersectionObserver((es) => { M.visible = es[0].isIntersecting; }, { rootMargin: '100px' }).observe(canvas);

  // pan, zoom, tap
  const pointers = new Map();
  let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    M.fly = null;
    M.touched = performance.now();
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: M.x, cy: M.y, moved: 0 };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zi: M.zi }; drag = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    M.touched = performance.now();
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const f = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
      M.zi = Math.max(0, Math.min(ZOOMS.length - 1, pinch.zi + Math.round(Math.log2(f) * 2)));
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    M.x = drag.cx - dx / zoom();
    M.y = drag.cy - dy / zoom();
    clampCam();
    if (!M.hinted && drag.moved > 20) { M.hinted = true; $('map-hint').style.opacity = 0; }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (drag && drag.moved < 6 && pointers.size === 0) tap(e);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(M.zi + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });

  function tap(e) {
    const rect = canvas.getBoundingClientRect();
    const r = dpr();
    const x = (e.clientX - rect.left) * r, y = (e.clientY - rect.top) * r;
    const z = Math.round(zoom() * r);
    let best = null, bestD = Infinity;
    for (const a of M.actors) {
      if (!a.name && a.id !== 'cat') continue;
      if (x < a.sx - 8 * z || x > a.sx + 8 * z || y < a.sHead - 4 * z || y > a.sy + 2 * z) continue;
      const d = Math.abs(x - a.sx) + Math.abs(y - (a.sy + a.sHead) / 2);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) return openVillager(best.id);
    const place = placeAt(e);
    if (place) openPlace(place);
  }

  // ---------- places: buildings, homes, the ship and props can be tapped ----------
  // Texts per building id, then per type. A building or prop in world.json may carry its own
  // "name" and "description" (the daily writer adds them for new places), which win over these.
  // No spoilers: describe what is there now, never what is coming.
  const PLACE_TEXT = {
    lighthouse: { title: 'The Lighthouse', kicker: 'Landmark', text: 'Old Morten keeps the light burning every night and writes down everything he sees in the fog. Its beam is the first thing a new villager sees from the sea.', person: 'morten' },
    'bram-workshop': { title: "Bram's Workshop", kicker: 'Shipyard', text: 'Where Bram the shipwright cuts every plank for the ship. He has talked to the ship more than to people.', person: 'bram' },
    dock: { title: 'The Pier', kicker: 'Harbour', text: 'The fishing boats tie up here. From the end of the pier you can see the buoys, and behind them the fog.' },
    rowboat: { title: 'Rowboat', kicker: 'Harbour', text: 'A small fishing boat. Nobody takes it past the last buoy.' },
    buoy: { title: 'Buoy', kicker: 'Sea', text: 'The buoys mark the edge of the safe water. Past them there is only fog.' },
    lamppost: { title: 'Harbour Lamp', kicker: 'Harbour', text: 'Lit every evening, so nobody walks off the quay in the dark.' },
    barrel: { title: 'Barrels', kicker: 'Supplies', text: 'Salted fish and fresh water, put away for the voyage.' },
    crate: { title: 'Crates', kicker: 'Supplies', text: 'Nails, rope and tar for the shipyard.' },
    netrack: { title: 'Net Rack', kicker: 'Harbour', text: 'The fishing nets, drying in the salt wind.' },
    board: { title: 'The Village Board', kicker: 'Harbour', text: "Every villager's name is pinned here. Pause the video, or search below, and find yours.", find: true },
    bench: { title: 'Harbour Bench', kicker: 'Harbour', text: 'The best seat in the village for watching the fog.' },
    plankpile: { title: 'Plank Pile', kicker: 'Shipyard', text: 'Planks waiting for the ship. Every one of them stands for a villager.' },
    sawhorse: { title: 'Sawhorse', kicker: 'Shipyard', text: 'Where Bram cuts each plank to size.' },
    sign: { title: 'A Sign', kicker: 'Village', text: 'A villager put this sign up.' },
    flag: { title: 'A Flag', kicker: 'Village', text: 'A villager raised this flag.' },
  };

  // Every tappable place with its box in world pixels [x0, y0, x1, y1].
  function places() {
    const w = D.world, out = [];
    const push = (p, box) => out.push({ ...p, box });
    for (const b of w.buildings || []) {
      const bx = b.tileX * T, by = b.tileY * T;
      const base = PLACE_TEXT[b.id] || PLACE_TEXT[b.type] || { title: 'A building', kicker: 'Last Harbor', text: 'Part of the village.' };
      const p = { ...base, title: b.name || base.title, text: b.description || base.text, id: b.id };
      if (b.type === 'lighthouse') push(p, [bx + T - 12, by + 2 * T - 75, bx + T + 12, by + 2 * T + 2]);
      else push(p, [bx + 16 - 20, by + 30 - 44, bx + 16 + 20, by + 30 + 3]);
    }
    for (const v of w.villagers || []) {
      if (!v.home || v.home.tileX == null) continue;
      const lay = LH.map.homeLayout(v.home);
      const cx = v.home.tileX * T + 16 + lay.dx, base = v.home.tileY * T + 30 + lay.dy;
      push({ id: 'home-' + v.id, title: (v.displayName || 'A villager') + "'s home", kicker: v.job || 'Villager', text: v.trait || '', meta: 'In ' + districtName(v.home.district) + ' · moved in on day ' + v.dayJoined, person: v.id, day: v.dayJoined }, [cx - 20, base - 44, cx + 20, base + 3]);
    }
    const s = w.ship;
    if (s && s.x != null) {
      const st = LH.map.shipStage(s.planks);
      const goal = s.goal || LH.map.SHIP_GOAL;
      push({ id: 'ship', title: 'The Ship', kicker: st.index ? 'Stage: ' + STAGE_NAMES[st.id] : 'Waiting for planks', text: 'Every villager adds one plank. ' + s.planks + ' of ' + goal + ' so far. When the last plank is in, the village sails into the fog.', person: 'bram' }, [s.x - 6, s.y - 40, s.x + 110, s.y + 5]);
    }
    // the followers' camp on the beach: one box around the first stretch of tents
    const n = LH.map.tentsFor(w, (w.story && w.story.followers) || 0);
    const tents = LH.map.camp(n);
    if (tents.length) {
      const xs = tents.slice(0, 140).map((p) => p[0] * T), ys = tents.slice(0, 140).map((p) => p[1] * T);
      push({ id: 'camp', title: 'The Camp', kicker: 'Beach · ' + n.toLocaleString('en-US') + (n === 1 ? ' tent' : ' tents'), text: 'Every follower without a house lives here, in a tent on the beach. ' + (n === 1 ? 'One tent so far.' : n.toLocaleString('en-US') + ' tents so far, and the camp keeps growing along the coast.') + ' Follow, and yours goes up the next day. Comment a name and a job to move from your tent into a house.' }, [Math.min(...xs) - 6, Math.min(...ys) - 10, Math.max(...xs) + 6, Math.max(...ys) + 2]);
    }
    // landmarks: the big changes the story made (a cave, a clearing, ruins...), each with its story
    const KIND = { cave: 'Cave', clearing: 'Clearing', ruins: 'Ruins', stones: 'Standing stones', mine: 'Mine', tower: 'Tower', shrine: 'Shrine', pond: 'Pond', garden: 'Garden', campfire: 'Campfire', pit: 'A hole', statue: 'Statue', beacon: 'Beacon', windmill: 'Windmill', well: 'Well', festival: 'Festival square', greenhouse: 'Greenhouse', observatory: 'Observatory', fountain: 'Fountain', belltower: 'Bell tower', treehouse: 'Treehouse', balloon: 'Balloon', fishracks: 'Fish racks', orchard: 'Orchard', gate: 'Gate', maypole: 'Maypole', boat: 'Boat', bandstand: 'Bandstand', hotspring: 'Hot spring', wreck: 'Old wreck', wishtree: 'Wishing tree', oven: 'Bread oven', lookout: 'Lookout', apiary: 'Beehives', maze: 'Hedge maze', sundial: 'Sundial', totem: 'Totem pole' };
    for (const l of w.landmarks || []) {
      const s = LH.map.LANDMARKS[l.type];
      if (!s) continue;
      const by = l.by && (w.villagers || []).find((v) => v.id === l.by);
      const later = (l.history || []).filter((h) => h.day !== l.dayAdded).map((h) => 'Day ' + h.day + ': ' + h.text);
      const info = { id: l.id, title: l.name, kicker: (KIND[l.type] || 'Landmark') + ' · discovered on day ' + l.dayAdded, text: l.description, meta: [by ? 'Found by ' + (by.displayName || 'a villager') : '', ...later].filter(Boolean).join(' · '), person: by ? by.id : null, day: l.dayAdded };
      const x0 = l.tileX * T, y0 = l.tileY * T;
      if (l.type === 'clearing') push(info, [x0 - 20, y0 - 12, x0 + 36, y0 + 20]);
      else if (l.type === 'tower') push(info, [x0, y0 + 30 - 56, x0 + s.w * T, y0 + s.h * T]);
      else push(info, [x0, y0 - 14, x0 + s.w * T, y0 + s.h * T + 2]);
    }
    const SIZE = { dock: null, board: [14, 27], lamppost: [4, 26], barrel: [6, 12], crate: [7, 12], rowboat: [12, 9], buoy: [5, 9], netrack: [10, 15], plankpile: [11, 15], sawhorse: [9, 10], bench: [9, 7], sign: [11, 26] };
    for (const p of w.props || []) {
      const base = PLACE_TEXT[p.type];
      if (!base && !p.name) continue;
      const info = { ...(base || { kicker: 'Last Harbor' }), title: p.name || (base && base.title), text: p.description || (base && base.text) || '', id: p.type };
      // objects a viewer asked for: what the sign says, who asked, and a Meet button for them
      if (p.text) info.text = (info.text ? info.text + ' ' : '') + 'It says: "' + p.text + '"';
      if (p.by) {
        const who = (w.villagers || []).find((v) => v.id === p.by);
        if (who) { info.person = who.id; info.kicker = 'Village'; info.meta = 'Asked for by ' + (who.displayName || 'a villager') + (p.dayAdded ? ' · day ' + p.dayAdded : ''); }
      }
      if (p.dayAdded) info.day = p.dayAdded;
      if (p.type === 'flag') { push(info, [p.x * T - 2, p.y * T - 32, p.x * T + 17, p.y * T + 2]); continue; }  // the cloth hangs to the right
      const x = p.x * T, y = p.y * T;
      if (p.type === 'dock') push(info, [x, y - (p.len || 4) * T, x + 24, y]);
      else { const [hw, hh] = SIZE[p.type] || [8, 14]; push(info, [x - hw, y - hh, x + hw, y + 2]); }
    }
    return out;
  }

  // the place under a pointer event, the smallest box first (a lamp in front of a house wins)
  function placeAt(e) {
    if (!M.cam || !D) return null;
    const rect = canvas.getBoundingClientRect();
    const r = dpr();
    const sx = (e.clientX - rect.left) * r, sy = (e.clientY - rect.top) * r;
    const wx = M.cam.x + (sx - M.cam.w / 2) / M.cam.z, wy = M.cam.y + (sy - M.cam.h / 2) / M.cam.z;
    const pad = 3;
    const hits = places().filter(({ box: b }) => wx >= b[0] - pad && wx <= b[2] + pad && wy >= b[1] - pad && wy <= b[3] + pad);
    hits.sort((a, b) => (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) - (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]));
    return hits[0] || null;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || drag || !D) return;
    canvas.style.cursor = placeAt(e) ? 'pointer' : '';
  });

  const pdlg = $('place');
  let placePerson = null;
  function openPlace(p) {
    $('p-kicker').textContent = (p.kicker || '').toUpperCase();
    $('p-title').textContent = p.title || '';
    $('p-text').textContent = p.text || '';
    $('p-meta').textContent = p.meta || '';
    $('p-meta').hidden = !p.meta;
    placePerson = p.person && findPerson(p.person) ? p.person : null;
    const who = placePerson && findPerson(placePerson);
    $('p-person').hidden = !who;
    if (who) $('p-person').textContent = 'Meet ' + (who.displayName || 'the cat');
    $('p-find').hidden = !p.find;
    watchButton($('p-watch'), p.day);
    if (!pdlg.open) pdlg.showModal();
  }
  pdlg.addEventListener('click', (e) => { if (e.target === pdlg) pdlg.close(); });
  $('p-person').addEventListener('click', () => { const id = placePerson; pdlg.close(); if (id) openVillager(id); });
  $('p-find').addEventListener('click', () => { pdlg.close(); showPanel('village'); setTimeout(() => $('search').focus(), 100); });

  function setZoom(zi) { M.zi = Math.max(0, Math.min(ZOOMS.length - 1, zi)); M.touched = performance.now(); }
  $('zoom-in').addEventListener('click', () => setZoom(M.zi + 1));
  $('zoom-out').addEventListener('click', () => setZoom(M.zi - 1));
  $('map-home').addEventListener('click', () => { M.sel = null; flyTo(OVERVIEW.x, OVERVIEW.y); setZoom(0); });

  function flyTo(x, y) { M.fly = { start: performance.now(), from: { x: M.x, y: M.y }, to: { x, y } }; }
  function showOnMap(id) {
    const p = findPerson(id);
    const s = p && spotOf(p);
    if (!s) return;
    M.sel = id;
    if (M.zi < 5) setZoom(5);
    flyTo(s[0], s[1] - 12);
    showPanel('village');
  }

  // ---------- music: the episodes' tune (music.mp3, made by scripts/site-music.mjs) ----------
  // A plain looping <audio> element (unlike Web Audio it also plays on an iPhone with the silent
  // switch on; its volume is baked into the file because iPhones ignore a page's volume). Browsers
  // only allow sound after the visitor touches the page, so it starts on the first tap, click or key
  // (unless they muted it before) and pauses while the tab is hidden. The button shows the real state.
  const audio = new Audio('music.mp3');
  audio.loop = true; audio.preload = 'auto';
  let musicOn = true, musicBlocked = false;
  try { musicOn = localStorage.getItem('lh-music') !== 'off'; } catch { /* no storage: default on */ }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browsers */ }
  function musicButton() {
    const b = $('music'), playing = !audio.paused;
    b.setAttribute('aria-pressed', String(musicOn));
    b.dataset.playing = String(playing);
    b.setAttribute('aria-label', !musicOn ? 'Music muted (tap to play)' : playing ? 'Music playing (tap to mute)' : 'Music on, starts when you tap the page');
  }
  function musicPlay() {
    if (!musicOn || document.hidden) return;
    const p = audio.play();
    if (p && p.catch) p.catch(() => { musicBlocked = true; musicButton(); });
  }
  for (const ev of ['play', 'pause', 'playing']) audio.addEventListener(ev, musicButton);
  audio.addEventListener('playing', () => { musicBlocked = false; });
  $('music').addEventListener('click', (e) => {
    e.stopPropagation();
    musicOn = !musicOn;
    try { localStorage.setItem('lh-music', musicOn ? 'on' : 'off'); } catch { /* fine */ }
    if (musicOn) musicPlay(); else audio.pause();
    musicButton();
  });
  // every touch tries again until it is playing (a blocked first attempt is not the end)
  const touch = () => { if (musicOn && audio.paused) musicPlay(); if (!audio.paused || !musicOn) for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, touch, true); };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, touch, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); else if (musicOn && !musicBlocked) musicPlay(); });
  musicButton();

  // ---------- tabs: one panel at a time (the map is the first) ----------
  function showPanel(name) {
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.dataset.panel === name);
    for (const b of document.querySelectorAll('.tabbar button')) { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    const p = document.querySelector('.panel.on');
    if (p && name !== 'village') p.scrollTop = 0;
    if (name === 'village') { M.visible = true; }
  }
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', (e) => { e.preventDefault(); showPanel(b.dataset.go); });

  // ---------- villager dialog ----------
  const dlg = $('villager');
  let current = null;
  // "Watch day N": a link to that day's Reel/Short, so people go back and watch older days
  function watchButton(a, day) {
    const e = day && (D.episodes || []).find((q) => q.day === day);
    a.hidden = !e;
    if (e) { a.href = e.url; a.textContent = 'Watch day ' + day + (e.also ? ' (Instagram)' : ''); }
  }
  function openVillager(id) {
    const p = findPerson(id);
    if (!p) return;
    current = p;
    const big = $('v-sprite');
    const pc = portrait(p, 32, 32);
    const g = big.getContext('2d');
    g.clearRect(0, 0, 32, 32);
    g.drawImage(pc, 0, 0);
    const founder = D.world.founders.includes(p);
    $('v-name').textContent = p.displayName || (p.id === 'cat' ? 'The cat' : p.id);
    $('v-job').textContent = (p.job || '').toUpperCase();
    $('v-trait').textContent = p.trait || '';
    $('v-crew').hidden = !p.crew;
    $('v-meta').textContent = founder ? 'Founder of Last Harbor' : 'Lives in ' + districtName(p.home && p.home.district) + ' · moved in on day ' + p.dayJoined;
    watchButton($('v-watch'), founder ? null : p.dayJoined);
    $('v-show').hidden = !spotOf(p);
    $('v-save').hidden = !spotOf(p);
    $('toast').textContent = '';
    if (!dlg.open) dlg.showModal();
    history.replaceState(null, '', '#' + village + '/' + p.id);
  }
  dlg.addEventListener('close', () => history.replaceState(null, '', '#' + village));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const linkFor = (p) => location.href.split('#')[0] + '#' + village + '/' + p.id;
  const toast = (m) => { $('toast').textContent = m; };
  $('v-show').addEventListener('click', () => { const id = current.id; dlg.close(); showOnMap(id); });
  $('v-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(linkFor(current)); toast('Link copied.'); } catch { toast(linkFor(current)); }
  });
  $('v-share').addEventListener('click', async () => {
    const name = current.displayName || 'the cat';
    const data = { title: name + ' lives in Last Harbor', text: name + ' lives in Last Harbor, the village at the edge of the world. Come find them:', url: linkFor(current) };
    if (navigator.share) { try { await navigator.share(data); } catch { /* cancelled */ } }
    else { try { await navigator.clipboard.writeText(data.url); toast('Link copied. Paste it anywhere.'); } catch { toast(data.url); } }
  });
  $('v-save').addEventListener('click', () => saveCard(current));

  // a 1080x1350 picture of the villager at their home, for stories and posts
  function saveCard(p) {
    const c = el('canvas');
    c.width = 1080; c.height = 1350;
    const g = c.getContext('2d');
    const s = spotOf(p);
    const res = LH.draw.renderWorld(g, { world: D.world, cam: { x: s[0], y: s[1] - 10, z: 7 }, t: 2, tod: 'day' });
    const a = res.actors.find((q) => q.id === p.id);
    if (a) LH.ui.nameTag(g, p.displayName, a.sx, a.sHead - 6, { crew: p.crew, patron: p.patron === true, size: 40, color: LH.PAL.lanternhi });
    g.fillStyle = 'rgba(27,23,36,0.92)';
    g.fillRect(0, 960, 1080, 390);
    g.fillStyle = LH.PAL.lantern;
    g.fillRect(0, 960, 1080, 8);
    g.textBaseline = 'top';
    g.fillStyle = LH.PAL.cream;
    g.font = '700 72px "LH Digits", "Pixelify Sans"';
    g.fillText(p.displayName || '', 60, 1000);
    g.fillStyle = LH.PAL.lanternhi;
    g.font = '400 30px Silkscreen';
    g.fillText((p.job || '').toUpperCase(), 60, 1090);
    g.fillStyle = LH.PAL.cream;
    g.font = '400 36px "LH Digits", "Pixelify Sans"';
    const words = String(p.trait || '').split(' ');
    let line = '', y = 1145;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > 960 && line) { g.fillText(line, 60, y); line = w; y += 46; }
      else line = test;
    }
    if (line) g.fillText(line, 60, y);
    g.fillStyle = LH.PAL.fog;
    g.font = '400 24px Silkscreen';
    g.fillText('LAST HARBOR · ' + D.label.toUpperCase() + ' VILLAGE · DAY ' + p.dayJoined, 60, 1290);
    c.toBlob((b) => {
      const url = URL.createObjectURL(b);
      const link = el('a');
      link.href = url;
      link.download = 'last-harbor-' + fold(p.displayName).replace(/[^a-z0-9]+/g, '-') + '.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Image saved.');
    }, 'image/png');
  }

  // ---------- sections ----------
  function renderStats() {
    const w = D.world;
    const stats = [
      [w.story.day, w.story.day === 1 ? 'day' : 'days'],
      [w.villagers.length, 'with a house'],
      [w.ship.planks, 'planks'],
    ];
    // followers live in the beach camp; the count arrives with the next day (hidden until then)
    if (w.story.followers) stats.splice(1, 0, [Math.max(w.story.followers, w.villagers.length).toLocaleString('en-US'), 'residents']);
    // the next village upgrade: a goal people can help reach
    const nx = LH.map.nextUpgrade(w);
    if (nx && D.open) stats.push([nx.at - w.villagers.length, 'more villagers for ' + nx.name]);
    const box = $('stats');
    box.replaceChildren(...stats.map(([n, l]) => { const d = el('div', 'stat'); d.appendChild(el('b', null, String(n))); d.appendChild(el('span', null, l.toUpperCase())); return d; }));
    $('day-badge').textContent = D.open ? 'Day ' + w.story.day : 'Opening soon';
    if ($('village-where')) $('village-where').textContent = D.where;
    // the card on the map: the day, everyone who lives here, and the next upgrade
    $('map-day').textContent = D.open ? 'DAY ' + w.story.day : 'SOON';
    $('map-live').textContent = Math.max(w.story.followers || 0, w.villagers.length).toLocaleString('en-US'); // followers (most villagers follow too)
    $('map-next').hidden = !(nx && D.open);
    if (nx && D.open) $('map-next').textContent = (nx.at - w.villagers.length) + ' more for ' + nx.name;
  }

  function renderSearch() {
    const q = fold($('search').value.trim());
    const out = $('results');
    if (!q) { out.replaceChildren(); return; }
    const all = [...D.world.founders, ...people()];
    const hits = all.filter((p) => fold(p.displayName).includes(q) || fold(p.job).includes(q) || (p.id === 'cat' && 'the cat'.includes(q)));
    if (!hits.length) { const li = el('li', 'empty', people().length ? 'Nobody by that name yet. Comment on the latest day to move in.' : 'Nobody has moved in yet.'); out.replaceChildren(li); return; }
    out.replaceChildren(...hits.slice(0, 24).map((p) => { const li = el('li'); li.appendChild(personButton(p, p.dayJoined ? 'DAY ' + p.dayJoined : 'FOUNDER')); return li; }));
  }

  function renderShip() {
    const s = D.world.ship;
    const goal = s.goal || LH.map.SHIP_GOAL;
    $('planks').textContent = s.planks;
    $('goal').textContent = goal;
    $('ship-bar').style.width = Math.min(100, (s.planks / goal) * 100) + '%';
    const cur = LH.map.shipStage(s.planks).index;
    $('stages').replaceChildren(...LH.map.SHIP_STAGES.slice(1).map((st, i) => {
      // no spoilers: a stage's name shows once the ship reaches it
      const li = el('li', i + 1 < cur ? 'done' : i + 1 === cur ? 'now' : '', (i + 1 <= cur ? STAGE_NAMES[st.id] : '???') + ' ' + st.at);
      return li;
    }));
  }

  function renderVote() {
    const box = $('vote');
    const st = D.world.story;
    const kids = [];
    const v = st.activeVote;
    if (v) {
      kids.push(el('p', 'vote-q', v.question));
      const opts = el('div', 'vote-opts');
      for (const o of v.options || []) opts.appendChild(el('span', null, typeof o === 'string' ? o : o.word || o.label || JSON.stringify(o)));
      kids.push(opts);
      kids.push(el('p', 'muted', 'Comment your choice under the latest day. The count decides what happens next.'));
      if (D.latestUrl) { const a = el('a', 'btn', 'Vote on the latest day'); a.href = D.latestUrl; a.target = '_blank'; a.rel = 'noopener'; kids.push(a); }
    } else {
      kids.push(el('p', 'muted', 'No vote open right now. About once a week the village gets a choice, and the comments decide what happens.'));
    }
    if (st.votes.length) {
      const ul = el('ul', 'past');
      for (const r of [...st.votes].reverse()) {
        const li = el('li');
        li.appendChild(el('span', null, 'Day ' + r.day + ': ' + r.question + ' '));
        li.appendChild(el('b', null, String(r.winner || '')));
        if (r.counts) li.appendChild(el('span', null, ' (' + Object.entries(r.counts).map(([k, n]) => k + ' ' + n).join(', ') + ')'));
        ul.appendChild(li);
      }
      kids.push(ul);
    }
    box.replaceChildren(...kids);
  }

  function renderDays() {
    const box = $('days');
    if (!D.episodes.length) { box.replaceChildren(el('p', 'muted', 'Day 1 is on its way.')); return; }
    box.replaceChildren(...D.episodes.map((e) => {
      const a = el('a', 'day');
      a.href = e.url; a.target = '_blank'; a.rel = 'noopener';
      if (e.thumb) { const img = el('img'); img.src = e.thumb; img.alt = ''; img.loading = 'lazy'; a.appendChild(img); }
      const t = el('div', 'txt');
      t.appendChild(el('span', 'd', 'DAY ' + e.day));
      t.appendChild(el('p', 't', e.title.replace(/^Day \d+:\s*/i, '')));
      if (e.beat) t.appendChild(el('p', 'b', e.beat));
      a.appendChild(t);
      return a;
    }));
  }

  function renderAshore() {
    const items = [...D.world.story.washedAshore].reverse();
    $('ashore').replaceChildren(...(items.length ? items.map((w) => { const li = el('li'); li.appendChild(el('span', 'd', 'DAY ' + w.day)); li.appendChild(document.createTextNode(w.description || w.item)); return li; }) : [el('li', 'muted', 'Nothing yet. The sea brings something every day.')]));
  }

  function renderDistricts() {
    const n = people().length;
    const counts = {};
    for (const v of people()) if (v.home) counts[v.home.district] = (counts[v.home.district] || 0) + 1;
    const ds = Object.entries(D.world.districts).sort((a, b) => a[1].unlockAt - b[1].unlockAt);
    $('districts').replaceChildren(...ds.map(([id, d]) => {
      const open = n >= d.unlockAt;
      const li = el('li', open ? 'open' : 'locked');
      // no spoilers: a district's name shows once it opens
      li.appendChild(el('span', 'nm', open && d.name ? d.name : '???'));
      li.appendChild(el('span', 'st', open ? (counts[id] || 0) + ' LIVING HERE' : 'OPENS AT ' + d.unlockAt + ' VILLAGERS · ' + (d.unlockAt - n) + ' TO GO'));
      return li;
    }));
    const sel = $('f-district');
    const keep = sel.value;
    sel.replaceChildren(el('option', null, 'All districts'));
    sel.firstChild.value = '';
    for (const [id, d] of ds) if (counts[id]) { const o = el('option', null, d.name); o.value = id; sel.appendChild(o); }
    sel.value = counts[keep] ? keep : '';
  }

  let shown = 48;
  function renderRegister(reset) {
    if (reset) shown = 48;
    const w = D.world;
    const crew = people().filter((v) => v.crew).length;
    $('register-sub').textContent = people().length
      ? people().length + ' villagers have moved in' + (crew ? ', ' + crew + ' signed up as crew' : '') + '.'
      : 'Nobody has moved in yet. The first comments become the first villagers.';
    $('founders').replaceChildren(...w.founders.map((f) => personButton(f, 'FOUNDER')));
    const dist = $('f-district').value, onlyCrew = $('f-crew').checked, sort = $('f-sort').value;
    let list = people().filter((v) => (!dist || (v.home && v.home.district === dist)) && (!onlyCrew || v.crew));
    if (sort === 'new') list = [...list].sort((a, b) => b.dayJoined - a.dayJoined || b.id.localeCompare(a.id));
    else if (sort === 'old') list = [...list].sort((a, b) => a.dayJoined - b.dayJoined || a.id.localeCompare(b.id));
    else list = [...list].sort((a, b) => fold(a.displayName).localeCompare(fold(b.displayName)));
    $('register-list').replaceChildren(...list.slice(0, shown).map((v) => { const li = el('li'); li.appendChild(personButton(v, (v.crew ? '⚓ ' : '') + 'DAY ' + v.dayJoined)); return li; }));
    $('more').hidden = list.length <= shown;
    $('more').textContent = 'Show more (' + (list.length - shown) + ' left)';
  }
  $('more').addEventListener('click', () => { shown += 96; renderRegister(false); });
  for (const id of ['f-district', 'f-sort', 'f-crew']) $(id).addEventListener('change', () => renderRegister(true));
  $('search').addEventListener('input', renderSearch);

  function renderJoin() {
    $('join-follow').replaceChildren(document.createTextNode('Follow '));
    const fl = D.follows || [D.follow];
    fl.forEach((f, i) => {
      if (i) $('join-follow').appendChild(document.createTextNode(i === fl.length - 1 ? ' or subscribe to ' : ', '));
      const a = el('a', null, f.label); a.href = f.url; a.target = '_blank'; a.rel = 'noopener';
      $('join-follow').appendChild(a);
    });
    if (D.merged && $('foot-villages')) $('foot-villages').textContent = 'One village, built by Instagram and YouTube together' + (D.platforms ? ' (' + Object.entries(D.platforms).map(([p, n]) => n + ' from ' + (p === 'youtube' ? 'YouTube' : p === 'instagram' ? 'Instagram' : p)).join(', ') + ')' : '') + '. Every villager is a real public comment.';
    $('join-follow').appendChild(document.createTextNode(' so you see each new day. A new day comes out every day.'));
    const latest = $('join-latest');
    latest.href = D.latestUrl || D.follow.url;
    latest.textContent = D.latestUrl ? 'Comment on the latest day' : 'Follow ' + D.follow.label;
    const banner = $('closed-banner');
    banner.hidden = D.open;
    $('closed-follow').href = D.follow.url;
    $('closed-follow').textContent = 'Follow ' + D.follow.label;
    $('built').textContent = fmtDate(D.builtAt);
  }

  // ---------- village switching ----------
  async function load(v, focus) {
    village = v;
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.village === v));
    if (!cache[v]) {
      const r = await fetch('data/' + v + '.json', { cache: 'no-cache' });
      cache[v] = await r.json();
    }
    D = cache[v];
    fitBounds(D.world);
    M.sel = null;
    const narrow = window.innerWidth < 600;
    // start fully zoomed out on the whole village (sea, harbour, camp and fields); tap + to go closer
    M.x = OVERVIEW.x; M.y = OVERVIEW.y + (narrow ? 2 * T : 0);
    M.zi = 0;
    renderStats(); renderShip(); renderVote(); renderDays(); renderAshore(); renderDistricts(); renderRegister(true); renderJoin(); renderSearch();
    if (focus && findPerson(focus)) { showOnMap(focus); openVillager(focus); }
    else history.replaceState(null, '', '#' + v);
  }
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => load(b.dataset.village));

  function fromHash() {
    const [v, id] = location.hash.replace(/^#/, '').split('/');
    if (!VILLAGES.includes(v) && REDIRECT[v]) return { v: REDIRECT[v].village, id: id && REDIRECT[v].ids[id] };
    return VILLAGES.includes(v) ? { v, id } : null;
  }
  window.addEventListener('hashchange', () => { const h = fromHash(); if (h && (h.v !== village || h.id)) load(h.v, h.id); });

  fetch('data/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((ix) => {
    if (ix && ix.villages && ix.villages.length) VILLAGES = ix.villages;
    if (ix && ix.redirect) REDIRECT = ix.redirect;
    // one village: no village tabs
    if (VILLAGES.length < 2) for (const n of document.querySelectorAll('.tabs')) n.hidden = true;
    const start = fromHash();
    return load(start ? start.v : VILLAGES[0], start && start.id);
  }).then(() => requestAnimationFrame(loop));
  // fonts arrive a moment later; name tags and portraits use them
  document.fonts && document.fonts.ready.then(() => { if (D) { renderRegister(false); } });
})();
