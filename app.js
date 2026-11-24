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
  // solitary homes (Twigs' tower, 2026-11-12) sit outside every district: they get their own name
  // instead of the locked district's blank one
  const WILDS = 'wilds';
  const homeDistrict = (v) => v && v.home && (v.home.solitary ? WILDS : v.home.district);
  const districtName = (id) => id === WILDS ? 'the Wilds' : (D.world.districts[id] && D.world.districts[id].name) || '???';
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
  // Presentation only: the map opens at dusk, like the arrival scene on the Harbor, so walking from
  // one to the other keeps the same light. The button still shows every time of day.
  M.tod = 'dusk';
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
    if (document.hidden) return;
    scenesTick(now);
    if (!M.visible || panel !== 'village') return;
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
  PLACE_TEXT.horse = { title: 'A Horse', kicker: 'Village', text: 'A horse of the village, grazing when nobody needs it.' };
  PLACE_TEXT.cart = { title: 'A Cart', kicker: 'Village', text: 'A wooden cart for carrying things round the village.' };
  PLACE_TEXT.shark = { title: 'A Shark', kicker: 'Sea', text: 'A fin in the harbour water. It keeps to itself.' };
  PLACE_TEXT.bunker = { title: 'A Bunker', kicker: 'Village', text: 'A small bunker dug into a grassy mound.' };
  PLACE_TEXT.foodstall = { title: 'A Food Stall', kicker: 'Village', text: 'Something warm to eat, right off the counter.' };
  PLACE_TEXT.stoneharbour = { title: 'The Stone Harbour', kicker: 'Sea', text: 'A small stone harbour with room for two boats and their cargo.' };
  PLACE_TEXT.furnace = { title: 'A Furnace', kicker: 'Village', text: 'A cast-iron furnace, glowing against the winter.' };
  PLACE_TEXT.diver = { title: 'Diving', kicker: 'Sea', text: 'A red dive flag bobbing on the water. Somebody is down there.' };
  PLACE_TEXT.magicflowers = { title: 'Magic Flowers', kicker: 'Village', text: 'Flowers that glow after dark. Nobody planted them on purpose.' };
  PLACE_TEXT.fruittree = { title: 'A Fruit Tree', kicker: 'Village', text: 'A fruit tree someone planted for the village.' };
  PLACE_TEXT.sheep = { title: 'A Sheep', kicker: 'Village', text: 'A sheep of the village, grazing in peace.' };

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
      push({ id: 'home-' + v.id, title: (v.displayName || 'A villager') + "'s home", kicker: v.job || 'Villager', text: v.trait || '', meta: 'In ' + districtName(homeDistrict(v)) + ' · moved in on day ' + v.dayJoined, person: v.id, day: v.dayJoined }, [cx - 20, base - 44, cx + 20, base + 3]);
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
    const KIND = { cave: 'Cave', clearing: 'Clearing', ruins: 'Ruins', stones: 'Standing stones', mine: 'Mine', tower: 'Tower', shrine: 'Shrine', pond: 'Pond', garden: 'Garden', campfire: 'Campfire', pit: 'A hole', statue: 'Statue', beacon: 'Beacon', windmill: 'Windmill', well: 'Well', festival: 'Festival square', greenhouse: 'Greenhouse', observatory: 'Observatory', fountain: 'Fountain', belltower: 'Bell tower', treehouse: 'Treehouse', balloon: 'Balloon', fishracks: 'Fish racks', orchard: 'Orchard', gate: 'Gate', maypole: 'Maypole', boat: 'Boat', bandstand: 'Bandstand', hotspring: 'Hot spring', wreck: 'Old wreck', wishtree: 'Wishing tree', oven: 'Bread oven', lookout: 'Lookout', apiary: 'Beehives', maze: 'Hedge maze', sundial: 'Sundial', totem: 'Totem pole', wreckshop: 'Wreck shop' };
    KIND.guildhall = 'Guild hall';
    KIND.townhall = 'Town hall';
    KIND.sawmill = 'Sawmill';
    KIND.foxstatue = 'Fox statue';
    KIND.warriorstatue = 'Warrior statue';
    KIND.henhouse = 'Chicken farm';
    KIND.palisade = 'Village wall';
    KIND.hospital = 'Hospital';
    KIND.tradepost = 'Trading post';
    KIND.seaweedfarm = 'Seaweed farm';
    KIND.inn = 'Inn';
    KIND.anchorforge = 'Anchor forge';
    KIND.heatpipes = 'Warm pipes';
    KIND.motel = 'Beach motel';
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
    const SIZE = { dock: null, board: [14, 27], lamppost: [4, 26], barrel: [6, 12], crate: [7, 12], rowboat: [12, 9], buoy: [5, 9], netrack: [10, 15], plankpile: [11, 15], sawhorse: [9, 10], bench: [9, 7], sign: [10, 22] };
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

  // ---------- places of the site: one panel at a time (the Harbor is the front door) ----------
  // Addresses: #harbor #explore #residents #shipyard #chronicles #noticeboard #join. The old ones
  // (#instagram, #youtube, #instagram/<villager id>) keep working: see fromHash / route below.
  const ROUTE = { harbor: 'harbor', village: 'explore', villagers: 'residents', ship: 'shipyard', story: 'chronicles', board: 'noticeboard', join: 'join' };
  const PANEL = Object.fromEntries(Object.entries(ROUTE).map(([k, r]) => [r, k]));
  const TITLE = { harbor: 'Last Harbor: the last village before the fog', village: 'Explore the village · Last Harbor', villagers: 'The residents · Last Harbor', ship: 'The shipyard · Last Harbor', story: 'The chronicles · Last Harbor', board: 'The noticeboard · Last Harbor', join: 'Join us · Last Harbor' };
  let panel = 'harbor';
  function showPanel(name, keepHash) {
    if (!ROUTE[name]) name = 'harbor';
    const changed = name !== panel;
    panel = name;
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.dataset.panel === name);
    for (const b of document.querySelectorAll('.tabbar [data-go], .topnav [data-go]')) { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    const p = document.querySelector('.panel.on');
    if (p && name !== 'village' && changed) p.scrollTop = 0;
    if (name === 'village') { M.visible = true; M.touched = performance.now(); }
    document.title = TITLE[name];
    if (!keepHash && location.hash !== '#' + ROUTE[name]) history.pushState(null, '', '#' + ROUTE[name]);
    for (const s of scenes) s.drawn = false;
  }
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', (e) => { e.preventDefault(); showPanel(b.dataset.go); });
  // "walk down to the quay" on the arrival scene: scroll inside the Harbor panel
  for (const a of document.querySelectorAll('.hero-down')) a.addEventListener('click', (e) => { e.preventDefault(); const t = $('today'); if (t) t.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); });

  // ---------- scenes: other views of the same village, drawn by the same engine ----------
  // The arrival scene on the Harbor, the chart, and the ship on its slipway. Each is the real world
  // (renderWorld), only the camera differs. Still pictures when the visitor asked for reduced motion.
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scenes = [];
  function scene(id, panelName, camFn, o = {}) {
    const c = $(id);
    if (!c) return;
    const s = { c, g: c.getContext('2d'), panelName, camFn, fps: o.fps || 10, once: !!o.once, tod: o.tod || 'dusk', after: o.after, seen: false, last: 0, drawn: false, key: '' };
    new IntersectionObserver((es) => { s.seen = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(c);
    scenes.push(s);
  }
  function scenesTick(now) {
    if (!D) return;
    for (const s of scenes) {
      if (s.panelName !== panel || !s.seen) continue;
      const r = dpr();
      const cw = s.c.clientWidth, ch = s.c.clientHeight;
      if (!cw || !ch) continue;
      const key = cw + 'x' + ch + '@' + r;
      const still = s.once || REDUCED;
      if (still ? (s.drawn && s.key === key) : now - s.last < 1000 / s.fps) continue;
      s.last = now; s.drawn = true; s.key = key;
      const w = Math.round(cw * r), h = Math.round(ch * r);
      if (s.c.width !== w || s.c.height !== h) { s.c.width = w; s.c.height = h; }
      const cam = s.camFn(cw, ch);
      const z = Math.max(1, Math.round(cam.z * r));
      const cat = D.cat ? [D.cat[0] * T, D.cat[1] * T] : undefined;
      LH.draw.renderWorld(s.g, { world: D.world, cam: { x: cam.x, y: cam.y, z }, t: still ? 2 : now / 1000, tod: s.tod, cat, fast: true });
      if (s.after) s.after({ x: cam.x, y: cam.y, z: z / r, w: cw, h: ch });
    }
  }
  const shipAt = () => (D.world.ship && D.world.ship.x != null ? D.world.ship : { x: 144, y: 56 });
  // arrival: wide screens see the quay from the ship to the lighthouse; phones stand by the ship
  function heroCam(w, h) {
    const s = shipAt();
    if (w < 700) {
      const z = Math.max(2, Math.floor(w / 190));
      const free = document.querySelector('.hero-text').getBoundingClientRect().top - $('hero').getBoundingClientRect().top;
      const target = Math.max(96, Math.min(h * 0.32, free * 0.62)); // where the ship's middle should stand, in px from the top
      return { x: s.x + 54, y: s.y - 16 + (h / 2 - target) / z, z };
    }
    const z = Math.max(2, Math.min(6, Math.floor(Math.min(w / 465, h / 250))));
    return { x: 242, y: -196 + h / z / 2, z };
  }
  const yardCam = (w, h) => { const s = shipAt(); return { x: s.x + 52, y: s.y - 24, z: Math.max(2, Math.min(8, Math.floor(Math.min(w / 150, h / 80)))) }; };
  const chartCam = (w) => ({ x: OVERVIEW.x, y: OVERVIEW.y + 2 * T, z: w > 1500 ? 2 : 1 });
  // signposts standing in the arrival scene: real places, placed where the engine drew them
  const SIGNS = [
    { go: 'ship', label: 'The shipyard', at: () => { const s = shipAt(); return [s.x + 52, s.y - 40]; } },
    { go: 'village', label: 'Explore the village', at: () => { const b = (D.world.buildings || []).find((q) => q.type === 'lighthouse'); return b ? [b.tileX * T + T, b.tileY * T + 2 * T - 78] : null; } },
    { go: 'board', label: 'Noticeboard', at: () => { const b = (D.world.props || []).find((q) => q.type === 'board'); return b ? [b.x * T, b.y * T - 28] : null; } },
  ];
  function placeSigns(cam) {
    const box = $('hero-signs');
    if (!box.children.length) for (const sg of SIGNS) { const a = el('a', 'signpost'); a.href = '#' + ROUTE[sg.go]; a.appendChild(el('span', null, sg.label)); a.addEventListener('click', (e) => { e.preventDefault(); showPanel(sg.go); }); box.appendChild(a); }
    const txt = document.querySelector('.hero-text').getBoundingClientRect(), hero = $('hero').getBoundingClientRect();
    SIGNS.forEach((sg, i) => {
      const a = box.children[i], p = sg.at();
      if (!p) { a.hidden = true; return; }
      const x = (p[0] - cam.x) * cam.z + cam.w / 2, y = (p[1] - cam.y) * cam.z + cam.h / 2;
      // never over the words, never cut off at an edge
      const overText = y > txt.top - hero.top - 8 && x > txt.left - hero.left - 70 && x < txt.right - hero.left + 70;
      a.hidden = x < 78 || x > cam.w - 78 || y < 56 || y > cam.h - 20 || overText;
      a.style.left = Math.round(x) + 'px'; a.style.top = Math.round(y) + 'px';
    });
  }
  scene('hero-canvas', 'harbor', heroCam, { fps: 10, after: placeSigns });
  scene('chart-canvas', 'harbor', chartCam, { once: true });
  scene('slip-canvas', 'harbor', yardCam, { fps: 8 });
  scene('yard-canvas', 'ship', yardCam, { fps: 10 });

  // ---------- villager dialog ----------
  const dlg = $('villager');
  let current = null;
  // "Watch day N": a link to that day's Reel/Short, so people go back and watch older days
  function watchButton(a, day) {
    const e = day && (D.episodes || []).find((q) => q.day === day);
    a.hidden = !e;
    if (!e) return;
    a.href = e.url;
    a.title = e.also ? 'Opens the episode on Instagram' : '';
    const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ico.setAttribute('class', 'ico'); ico.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-play'); ico.appendChild(use);
    a.replaceChildren(ico, document.createTextNode('Watch day ' + day));
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
    // their Instagram / YouTube handle (the user, 2026-11-13)
    const so = $('v-social');
    so.hidden = !p.social;
    if (p.social) { so.textContent = (p.social.platform === 'instagram' ? 'Instagram ' : 'YouTube ') + p.social.handle; so.dataset.platform = p.social.platform; }
    const dn = districtName(homeDistrict(p));
    $('v-meta').textContent = founder ? 'Founder of Last Harbor' : (dn === '???' ? 'Moved in on day ' : 'Lives in ' + dn + ' · moved in on day ') + p.dayJoined;
    watchButton($('v-watch'), founder ? null : p.dayJoined);
    $('v-show').hidden = !spotOf(p);
    $('v-save').hidden = !spotOf(p);
    const days = seenIn(p), seen = $('v-seen');
    seen.hidden = !days.length;
    seen.replaceChildren(document.createTextNode('Named in the chronicles: '));
    for (const e of days) { const a = el('a', null, 'DAY ' + e.day); a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; seen.appendChild(a); }
    $('toast').textContent = '';
    if (!dlg.open) dlg.showModal();
    history.replaceState(null, '', '#' + village + '/' + p.id);
  }
  dlg.addEventListener('close', () => history.replaceState(null, '', '#' + ROUTE[panel]));
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

  const matches = (p, q) => fold(p.displayName).includes(q) || fold(p.job).includes(q) || (p.social && fold(p.social.handle).includes(q)) || (p.id === 'cat' && 'the cat'.includes(q));
  function renderSearch() {
    const q = fold($('search').value.trim()).replace(/^@/, '');
    const out = $('results');
    if (!q) { out.replaceChildren(); return; }
    const all = [...D.world.founders, ...people()];
    const hits = all.filter((p) => matches(p, q));
    if (!hits.length) { const li = el('li', 'empty', people().length ? 'Nobody by that name yet. Comment on the latest day to move in.' : 'Nobody has moved in yet.'); out.replaceChildren(li); return; }
    out.replaceChildren(...hits.slice(0, 24).map((p) => { const li = el('li'); li.appendChild(personButton(p, p.dayJoined ? 'DAY ' + p.dayJoined : 'FOUNDER')); return li; }));
  }

  function renderShip() {
    const s = D.world.ship;
    const goal = s.goal || LH.map.SHIP_GOAL;
    $('planks').textContent = s.planks;
    $('goal').textContent = goal;
    $('ship-bar').style.width = Math.min(100, (s.planks / goal) * 100) + '%';
    hull($('yard-hull'), s.planks, goal);
    const bits = [];
    if (s.sharePlanks) bits.push(s.sharePlanks + ' came from shares of the videos' + (LH.map.SHARE_PLANKS ? ' (' + LH.map.SHARE_PLANKS + ' planks a share)' : ''));
    if (s.founderPlanks) bits.push(s.founderPlanks + ' were laid by the founders');
    $('ship-sources').textContent = bits.length ? 'Every villager adds one plank. ' + bits.join(', and ') + '.' : '';
    const crew = people().filter((v) => v.crew);
    $('crew-sub').textContent = crew.length ? crew.length + (crew.length === 1 ? ' villager has' : ' villagers have') + ' signed up for the voyage. Comment crew under a day to join them.' : 'Nobody has signed up yet. If you already live here, comment crew under a day to sign up for the voyage.';
    $('crew-list').replaceChildren(...crew.map((v) => { const li = el('li'); li.appendChild(personButton(v, 'DAY ' + v.dayJoined)); return li; }));
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

  const whereOf = (url) => (/youtu/.test(url) ? 'YouTube' : /instagram/.test(url) ? 'Instagram' : /tiktok/.test(url) ? 'TikTok' : 'the video');
  const dayDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
  const cleanDayTitle = (e) => e.title.replace(/^Day \d+:\s*/i, '');
  function watchLinks(e, box) {
    const a = el('a', null, 'Watch on ' + whereOf(e.url)); a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a);
    for (const u of Object.values(e.also || {})) { const y = el('a', 'alt', whereOf(u)); y.href = u; y.target = '_blank'; y.rel = 'noopener'; y.setAttribute('aria-label', 'Watch day ' + e.day + ' on ' + whereOf(u)); box.appendChild(y); }
  }
  function renderDays() {
    const box = $('days');
    if (!D.episodes.length) { box.replaceChildren(el('p', 'muted', 'Day 1 is on its way.')); return; }
    $('days-sub').textContent = D.episodes.length + (D.episodes.length === 1 ? ' day' : ' days') + ' so far, newest first. Every day is a new video.';
    box.replaceChildren(...D.episodes.map((e) => {
      const row = el('article', 'day');
      const pic = el('a', 'pic');
      pic.href = e.url; pic.target = '_blank'; pic.rel = 'noopener'; pic.setAttribute('aria-label', 'Watch day ' + e.day);
      if (e.thumb) { const img = el('img'); img.src = e.thumb; img.alt = ''; img.loading = 'lazy'; pic.appendChild(img); }
      row.appendChild(pic);
      const t = el('div', 'txt');
      t.appendChild(el('span', 'd', 'DAY ' + e.day + (e.publishedAt ? ' · ' + dayDate(e.publishedAt).toUpperCase() : '')));
      t.appendChild(el('h2', 't', cleanDayTitle(e)));
      const links = el('div', 'links');
      if (e.beat) {
        const b = el('p', 'b clip', e.beat);
        t.appendChild(b);
        const more = el('button', null, 'Read the whole day');
        more.type = 'button';
        more.addEventListener('click', () => { const open = b.classList.toggle('clip'); more.textContent = open ? 'Read the whole day' : 'Fold it back'; });
        watchLinks(e, links);
        links.appendChild(more);
      } else watchLinks(e, links);
      t.appendChild(links);
      row.appendChild(t);
      return row;
    }));
  }

  function renderAshore() {
    const items = [...D.world.story.washedAshore].reverse();
    $('ashore').replaceChildren(...(items.length ? items.map((w) => { const li = el('li'); li.appendChild(el('span', 'd', 'DAY ' + w.day)); li.appendChild(document.createTextNode(w.description || w.item)); return li; }) : [el('li', 'muted', 'Nothing yet. The sea brings something every day.')]));
  }

  function renderDistricts() {
    const n = people().length;
    const counts = {};
    for (const v of people()) if (v.home) counts[homeDistrict(v)] = (counts[homeDistrict(v)] || 0) + 1;
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
    for (const [id, d] of ds) if (counts[id] && d.name) { const o = el('option', null, d.name); o.value = id; sel.appendChild(o); }
    if (counts[WILDS]) { const o = el('option', null, 'Out in the Wilds'); o.value = WILDS; sel.appendChild(o); }
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
    const rq = fold($('r-search').value.trim()).replace(/^@/, '');
    let list = people().filter((v) => (!dist || homeDistrict(v) === dist) && (!onlyCrew || v.crew) && (!rq || matches(v, rq)));
    $('register-empty').hidden = !!list.length || !people().length;
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
  $('r-search').addEventListener('input', () => renderRegister(true));

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

  // ---------- the Harbor (front page), the noticeboard, the list of places ----------
  // Everything here is read from the village data; nothing is written by hand.
  function hull(box, planks, goal) {
    const cells = 100, per = goal / cells, full = Math.floor(planks / per);
    box.replaceChildren(...Array.from({ length: cells }, (_, i) => el('i', i < full ? 'in' : i === full && planks < goal ? 'now' : '')));
    box.setAttribute('aria-label', planks + ' of ' + goal + ' planks');
  }
  // The days whose chronicle names this villager. Only shown when the text leaves no doubt; when
  // in doubt, nothing is claimed. A day counts for a villager only if ALL of this holds:
  //  - the whole display name stands in that day's text (never inside a longer villager's name, and
  //    never inside the name of a landmark, building or object, which are blanked out first);
  //  - nobody else who lived here by that day has that name, or carries it as a word of their name
  //    ("Ram" and "Ram the Crier"), and the name is not a founder's;
  //  - the villager had moved in by that day;
  //  - a name that is also an ordinary word of the chronicles (used in lower case somewhere, or a
  //    job word like "Baker") must stand in the middle of a sentence, where the capital means a name.
  // A villager with even one impossible hit (named before they arrived) gets no claim at all.
  let SEEN = null;
  function seenIn(p) {
    if (!SEEN) {
      SEEN = {};
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const word = (t) => new RegExp('(^|[^\\p{L}\\p{N}])' + esc(t) + '(?![\\p{L}\\p{N}])', 'gu');
      const w = D.world;
      const all = [...w.founders, ...people()].filter((v) => v.displayName && v.displayName.trim().length >= 3);
      const joined = (v) => v.dayJoined || 0;
      const byLen = [...all].sort((a, b) => b.displayName.length - a.displayName.length);
      const placeNames = [...(w.landmarks || []), ...(w.buildings || []), ...(w.props || [])].map((x) => x.name).filter((n) => n && n.length >= 3).sort((a, b) => b.length - a.length);
      const allText = D.episodes.map((e) => e.beat || '').join(' \n ');
      const ordinary = new Set();
      for (const v of all) for (const j of fold(v.job).split(/[^a-z]+/)) if (j.length >= 3) ordinary.add(j);
      const isOrdinary = (name) => !/\s/.test(name) && (ordinary.has(fold(name)) || word(name.toLowerCase()).test(allText));
      const doubt = new Set();
      for (const e of D.episodes) {
        let text = e.beat || '';
        for (const n of placeNames) text = text.replace(word(n), '$1#');
        for (const v of byLen) {
          const name = v.displayName.trim(), re = word(name);
          let m, hit = false, mid = false;
          while ((m = re.exec(text))) {
            hit = true;
            const before = text.slice(0, m.index + m[1].length).trimEnd();
            if (before && !/[.!?:;#"”)]$/.test(before)) mid = true; // inside a sentence, after ordinary words
          }
          if (!hit) continue;
          text = text.replace(word(name), '$1#');
          // anyone else this could mean, among the people living here by that day
          const others = all.filter((o) => o !== v && joined(o) <= e.day && (o.displayName.trim() === name || word(name).test(o.displayName)));
          if (others.length) continue;
          if (e.day < joined(v)) { doubt.add(v.id); continue; }
          if (isOrdinary(name) && !mid) continue;
          (SEEN[v.id] = SEEN[v.id] || []).push(e);
        }
      }
      for (const id of doubt) delete SEEN[id];
    }
    return [...(SEEN[p.id] || [])].sort((a, b) => a.day - b.day);
  }
  const firstSentences = (t, n) => { const m = String(t || '').match(/[^.!?]+[.!?]+(\s|$)/g); return m ? m.slice(0, n).join('').trim() : String(t || ''); };
  function goPlace(id) {
    const p = places().find((q) => q.id === id);
    if (!p) return;
    showPanel('village');
    M.sel = null;
    setZoom(4);
    flyTo((p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2);
    setTimeout(() => openPlace(p), 950);
  }
  const newestLandmarks = () => [...(D.world.landmarks || [])].filter((l) => l.name).sort((a, b) => b.dayAdded - a.dayAdded);

  function note(kicker, title, text) {
    const n = el('div', 'note');
    n.appendChild(el('p', 'nk', kicker));
    if (title) n.appendChild(el('h3', null, title));
    if (text) n.appendChild(el('p', null, text));
    return n;
  }
  function notes(withVote) {
    const w = D.world, st = w.story, out = [];
    const v = st.activeVote;
    if (v && D.open && withVote) {
      const n = note('Open decision' + (v.day ? ' · day ' + v.day : ''), v.question);
      const opts = el('div', 'vote-opts');
      for (const o of v.options || []) opts.appendChild(el('span', null, typeof o === 'string' ? o : o.word || o.label || ''));
      n.appendChild(opts);
      n.appendChild(el('p', null, 'Comment your word under the latest day. The count decides what happens next.'));
      if (D.latestUrl) { const a = el('a', 'btn', 'Vote on the latest day'); a.href = D.latestUrl; a.target = '_blank'; a.rel = 'noopener'; n.appendChild(a); }
      out.push(n);
    }
    const fresh = people().filter((p) => p.dayJoined === st.day);
    if (fresh.length) {
      const n = note('Moved in on day ' + st.day, fresh.length + (fresh.length === 1 ? ' new villager' : ' new villagers'));
      const names = el('p', 'names');
      fresh.slice(0, 12).forEach((p, i) => {
        if (i) names.appendChild(document.createTextNode(', '));
        const b = el('button', null, p.displayName || 'A villager'); b.type = 'button'; b.addEventListener('click', () => openVillager(p.id)); names.appendChild(b);
      });
      if (fresh.length > 12) names.appendChild(document.createTextNode(' and ' + (fresh.length - 12) + ' more'));
      n.appendChild(names);
      out.push(n);
    }
    const marks = newestLandmarks();
    const today = marks.filter((l) => l.dayAdded === st.day);
    for (const l of (today.length ? today : marks).slice(0, today.length ? 2 : 1)) {
      const n = note((l.dayAdded === st.day ? 'New in the village' : 'Built') + ' · day ' + l.dayAdded, l.name, l.description);
      const b = el('button', 'btn ghost', 'See it on the map'); b.type = 'button'; b.addEventListener('click', () => goPlace(l.id)); n.appendChild(b);
      out.push(n);
    }
    const sea = st.washedAshore[st.washedAshore.length - 1];
    if (sea) out.push(note('Washed ashore · day ' + sea.day, null, (sea.description || sea.item).replace(/^./, (c) => c.toUpperCase()) + '.'));
    const nx = LH.map.nextUpgrade(w);
    if (nx && D.open) out.push(note('Next for the village', (nx.at - w.villagers.length) + ' more villagers', 'and the village gets ' + nx.name + '.'));
    const last = st.votes[st.votes.length - 1];
    if (last) out.push(note('Decided on day ' + last.day, last.question, (last.winner ? 'The village chose ' + last.winner : 'Decided') + (last.counts ? ' (' + Object.entries(last.counts).map(([k, c]) => k + ' ' + c).join(', ') + ').' : '.')));
    return out;
  }
  function renderBoard() {
    const st = D.world.story;
    $('board-sub').textContent = D.open ? 'What is pinned up on day ' + st.day + '. Updated ' + fmtDate(D.builtAt) + '.' : 'Nothing pinned up yet. Day 1 is on its way.';
    const all = notes(false);
    $('board-notes').replaceChildren(...(all.length ? all : [note('Quiet', null, 'Nothing new today.')]));
    $('notice-dot').hidden = !(st.activeVote && D.open);
  }

  function renderPlaces() {
    const all = places(), box = $('places-list'), kids = [];
    const group = (title, items) => {
      if (!items.length) return;
      kids.push(el('h4', null, title));
      const ul = el('ul');
      for (const p of items) {
        const li = el('li'), b = el('button'); b.type = 'button';
        b.appendChild(el('b', null, p.title)); b.appendChild(el('span', null, p.kicker || ''));
        b.addEventListener('click', () => { $('places').close(); goPlace(p.id); });
        li.appendChild(b); ul.appendChild(li);
      }
      kids.push(ul);
    };
    group('The harbour', ['lighthouse', 'ship', 'bram-workshop', 'board', 'dock', 'camp'].map((id) => all.find((p) => p.id === id)).filter(Boolean));
    group('Landmarks, newest first', newestLandmarks().map((l) => all.find((p) => p.id === l.id)).filter(Boolean));
    box.replaceChildren(...kids);
  }
  $('map-places').addEventListener('click', () => $('places').showModal());
  $('places').addEventListener('click', (e) => { if (e.target === $('places')) $('places').close(); });

  function renderHarbor() {
    const w = D.world, st = w.story, s = w.ship, goal = s.goal || LH.map.SHIP_GOAL;
    const residents = Math.max(st.followers || 0, w.villagers.length);
    const latest = D.episodes[0];
    if (D.open) $('hero-kicker').textContent = 'Day ' + st.day + ' · ' + residents.toLocaleString('en-US') + ' residents';
    const hw = $('hero-watch');
    if (latest) { hw.href = latest.url; hw.target = '_blank'; hw.rel = 'noopener'; hw.textContent = 'Watch day ' + latest.day; }
    // today: the tally on the quay
    const plate = (n, label, go) => { const p = el(go ? 'a' : 'div', 'plate'); if (go) { p.href = '#' + ROUTE[go]; p.addEventListener('click', (e) => { e.preventDefault(); showPanel(go); }); } p.appendChild(el('b', null, String(n))); p.appendChild(el('span', null, label)); return p; };
    $('today-plates').replaceChildren(
      plate(D.open ? st.day : 0, st.day === 1 ? 'day so far' : 'days so far', 'story'),
      plate(residents.toLocaleString('en-US'), 'residents', 'villagers'),
      plate(w.villagers.length, 'with a house', 'village'),
      plate(s.planks, 'of ' + goal + ' planks', 'ship'));
    const nx = LH.map.nextUpgrade(w);
    const log = $('today-log');
    log.hidden = !(nx && D.open);
    if (nx && D.open) log.textContent = (nx.at - w.villagers.length) + ' more villagers and the village gets ' + nx.name + '.';
    // the latest day
    if (latest) {
      const f = $('latest-frame');
      f.hidden = !latest.thumb; f.href = latest.url; f.setAttribute('aria-label', 'Watch day ' + latest.day);
      if (latest.thumb) $('latest-img').src = latest.thumb;
      $('latest-kicker').textContent = 'The latest day · day ' + latest.day + (latest.publishedAt ? ' · ' + dayDate(latest.publishedAt) : '');
      $('latest-title').textContent = cleanDayTitle(latest);
      $('latest-beat').textContent = firstSentences(latest.beat, 2);
      const links = $('latest-links');
      links.replaceChildren();
      watchLinks(latest, links);
      for (const a of links.children) a.className = 'btn' + (a.classList.contains('alt') ? ' ghost' : '');
      if (links.children[1]) links.children[1].textContent = 'Watch on ' + links.children[1].textContent;
    }
    // places worth a walk: the newest landmarks
    $('home-places').replaceChildren(...newestLandmarks().slice(0, 6).map((l) => { const li = el('li'), b = el('button', null, l.name); b.type = 'button'; b.addEventListener('click', () => goPlace(l.id)); li.appendChild(b); return li; }));
    // the newest residents, as they described themselves
    const folk = [...people()].sort((a, b) => b.dayJoined - a.dayJoined || b.id.localeCompare(a.id)).slice(0, 6);
    $('home-res-sub').textContent = people().length ? people().length + ' villagers have a house so far, each one a real comment. These are the newest arrivals.' : 'Nobody has moved in yet. The first comments become the first villagers.';
    $('home-folk').replaceChildren(...folk.map((p) => {
      const li = el('li'), b = el('button'); b.type = 'button';
      b.appendChild(portrait(p));
      const d = el('span');
      d.appendChild(el('span', 'nm', p.displayName || p.id)); d.appendChild(el('span', 'jb', (p.job || '') + ' · day ' + p.dayJoined)); d.appendChild(el('span', 'tr', p.trait || ''));
      b.appendChild(d);
      b.addEventListener('click', () => openVillager(p.id));
      li.appendChild(b);
      return li;
    }));
    $('home-res-all').textContent = people().length ? 'Meet all ' + people().length + ' villagers' : 'The register';
    // the ship
    $('home-planks').textContent = s.planks; $('home-goal').textContent = goal;
    hull($('home-hull'), s.planks, goal);
    // the board: the three notes on top
    const top = notes(true).slice(0, 3);
    $('home-board').replaceChildren(...(top.length ? top : [note('Quiet', null, 'Nothing pinned up yet.')]));
    // older days
    const older = D.episodes.slice(1, 5);
    $('home-days').replaceChildren(...older.map((e) => { const li = el('li'), a = el('a'); a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; a.appendChild(el('span', 'd', 'DAY ' + e.day)); a.appendChild(el('span', 't', cleanDayTitle(e))); li.appendChild(a); return li; }));
    $('home-chron-all').textContent = D.episodes.length ? 'Open the chronicles (' + D.episodes.length + ' days)' : 'Open the chronicles';
    const hl = $('home-latest');
    hl.href = D.latestUrl || D.follow.url;
    hl.textContent = D.latestUrl ? 'Comment on the latest day' : 'Follow ' + D.follow.label;
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
    SEEN = null;
    renderStats(); renderShip(); renderVote(); renderDays(); renderAshore(); renderDistricts(); renderRegister(true); renderJoin(); renderSearch();
    renderHarbor(); renderBoard(); renderPlaces();
    for (const s of scenes) s.drawn = false;
    if (focus && findPerson(focus)) { showOnMap(focus); openVillager(focus); }
  }
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => load(b.dataset.village));

  function fromHash() {
    const [v, id] = location.hash.replace(/^#/, '').split('/');
    if (!VILLAGES.includes(v) && REDIRECT[v]) return { v: REDIRECT[v].village, id: id && REDIRECT[v].ids[id] };
    return VILLAGES.includes(v) ? { v, id } : null;
  }
  function route() {
    const key = location.hash.replace(/^#/, '');
    if (PANEL[key]) { if (dlg.open) dlg.close(); showPanel(PANEL[key], true); return; }
    const h = fromHash();
    if (h && (h.v !== village || h.id)) load(h.v, h.id);
    else if (!key || h) showPanel('harbor', true);
  }
  window.addEventListener('hashchange', route);

  fetch('data/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((ix) => {
    if (ix && ix.villages && ix.villages.length) VILLAGES = ix.villages;
    if (ix && ix.redirect) REDIRECT = ix.redirect;
    // one village: no village tabs
    if (VILLAGES.length < 2) for (const n of document.querySelectorAll('.tabs')) n.hidden = true;
    const start = fromHash();
    return load(start ? start.v : VILLAGES[0], start && start.id);
  }).then(() => { const key = location.hash.replace(/^#/, ''); if (PANEL[key]) showPanel(PANEL[key], true); requestAnimationFrame(loop); });
  // fonts arrive a moment later; name tags and portraits use them
  document.fonts && document.fonts.ready.then(() => { if (D) { renderRegister(false); } });
})();
