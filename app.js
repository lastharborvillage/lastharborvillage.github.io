// Last Harbor site. Loads data/<village>.json (built by scripts/site.mjs) and draws the village live with
// the same engine as the videos (engine/*.js, everything on globalThis.LH).
(() => {
  'use strict';
  const LH = globalThis.LH;
  const T = LH.map.T;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const VILLAGES = ['youtube', 'instagram'];
  const STAGE_NAMES = { none: 'Nothing yet', keel: 'Keel', ribs: 'Ribs', hull: 'Hull', deck: 'Deck', mast: 'Mast', sails: 'Sails', flag: 'Flag' };
  const cache = {};
  let D = null; // current village data
  let village = 'youtube';

  // ---------- helpers ----------
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const districtName = (id) => (D.world.districts[id] && D.world.districts[id].name) || id;
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
  const M = { x: HOME.x, y: HOME.y, zi: 3, tod: null, sel: null, actors: [], visible: true, last: 0, fly: null, hinted: false };
  const BOUNDS = { x0: -44 * T, x1: 38 * T, y0: -14 * T, y1: 27 * T };
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
    const cat = D.cat ? [D.cat[0] * T, D.cat[1] * T] : undefined;
    const res = LH.draw.renderWorld(ctx, { world: D.world, cam: { x: M.x, y: M.y, z }, t, tod: M.tod, cat });
    M.actors = res.actors;
    // name tags when close enough to read
    const tagSize = Math.round(13 * r);
    if (zoom() >= 4) {
      for (const a of res.actors.sort((p, q) => p.sy - q.sy)) {
        if (!a.name || a.id === M.sel) continue;
        if (a.sx < 0 || a.sx > w || a.sHead < 30 * r || a.sy > h + 20) continue;
        LH.ui.nameTag(ctx, a.name, a.sx, a.sHead - 2 * r, { crew: a.crew, size: tagSize });
      }
    }
    // the selected villager: a bobbing marker and a tag at any zoom
    const s = M.sel && res.actors.find((a) => a.id === M.sel);
    if (s) {
      LH.ui.nameTag(ctx, s.name, s.sx, s.sHead - (4 + Math.sin(t * 4) * 2) * r, { crew: s.crew, size: Math.round(16 * r), color: LH.PAL.lanternhi });
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!M.visible || document.hidden) return;
    if (now - M.last < (M.fly ? 16 : 66)) return; // ~15 fps is plenty for waves and lights
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
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: M.x, cy: M.y, moved: 0 };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zi: M.zi }; drag = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    if (best) openVillager(best.id);
  }

  function setZoom(zi) { M.zi = Math.max(0, Math.min(ZOOMS.length - 1, zi)); }
  $('zoom-in').addEventListener('click', () => setZoom(M.zi + 1));
  $('zoom-out').addEventListener('click', () => setZoom(M.zi - 1));
  $('map-home').addEventListener('click', () => { M.sel = null; flyTo(HOME.x, HOME.y); setZoom(3); });

  function flyTo(x, y) { M.fly = { start: performance.now(), from: { x: M.x, y: M.y }, to: { x, y } }; }
  function showOnMap(id) {
    const p = findPerson(id);
    const s = p && spotOf(p);
    if (!s) return;
    M.sel = id;
    if (M.zi < 5) setZoom(5);
    flyTo(s[0], s[1] - 12);
    $('village').scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- villager dialog ----------
  const dlg = $('villager');
  let current = null;
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
    if (a) LH.ui.nameTag(g, p.displayName, a.sx, a.sHead - 6, { crew: p.crew, size: 40, color: LH.PAL.lanternhi });
    g.fillStyle = 'rgba(27,23,36,0.92)';
    g.fillRect(0, 960, 1080, 390);
    g.fillStyle = LH.PAL.lantern;
    g.fillRect(0, 960, 1080, 8);
    g.textBaseline = 'top';
    g.fillStyle = LH.PAL.cream;
    g.font = '700 72px "Pixelify Sans"';
    g.fillText(p.displayName || '', 60, 1000);
    g.fillStyle = LH.PAL.lanternhi;
    g.font = '400 30px Silkscreen';
    g.fillText((p.job || '').toUpperCase(), 60, 1090);
    g.fillStyle = LH.PAL.cream;
    g.font = '400 36px "Pixelify Sans"';
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
      [w.villagers.length, 'villagers'],
      [w.ship.planks, 'planks'],
      [w.story.atSea, 'waiting at sea'],
    ];
    const box = $('stats');
    box.replaceChildren(...stats.map(([n, l]) => { const d = el('div', 'stat'); d.appendChild(el('b', null, String(n))); d.appendChild(el('span', null, l.toUpperCase())); return d; }));
    $('day-badge').textContent = D.open ? 'Day ' + w.story.day : 'Opening soon';
    $('village-where').textContent = D.where;
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
      const li = el('li', i + 1 < cur ? 'done' : i + 1 === cur ? 'now' : '', STAGE_NAMES[st.id] + ' ' + st.at);
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
      li.appendChild(el('span', 'nm', d.name));
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
      ? people().length + ' villagers have moved in' + (crew ? ', ' + crew + ' signed up as crew' : '') + '.' + (w.story.atSea ? ' ' + w.story.atSea + ' more are waiting at sea for a house.' : '')
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
    const a = el('a', null, D.follow.label); a.href = D.follow.url; a.target = '_blank'; a.rel = 'noopener';
    $('join-follow').appendChild(a);
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
    M.sel = null;
    const narrow = window.innerWidth < 600;
    M.x = HOME.x; M.y = HOME.y + (narrow ? 2 * T : 0);
    M.zi = narrow ? 2 : 3;
    renderStats(); renderShip(); renderVote(); renderDays(); renderAshore(); renderDistricts(); renderRegister(true); renderJoin(); renderSearch();
    if (focus && findPerson(focus)) { showOnMap(focus); openVillager(focus); }
    else history.replaceState(null, '', '#' + v);
  }
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => load(b.dataset.village));

  function fromHash() {
    const [v, id] = location.hash.replace(/^#/, '').split('/');
    return VILLAGES.includes(v) ? { v, id } : null;
  }
  window.addEventListener('hashchange', () => { const h = fromHash(); if (h && (h.v !== village || h.id)) load(h.v, h.id); });

  const start = fromHash();
  load(start ? start.v : 'youtube', start && start.id).then(() => requestAnimationFrame(loop));
  // fonts arrive a moment later; name tags and portraits use them
  document.fonts && document.fonts.ready.then(() => { if (D) { renderRegister(false); } });
})();
