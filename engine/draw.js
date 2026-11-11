// Browser-side pixel renderer: villager composer, terrain, buildings, ship, sea, fog, lights.
// The world is drawn at native resolution (1 px = 1 art pixel) into a small buffer, then
// scaled up with nearest-neighbour onto the 1080x1920 canvas. Every frame is a pure function
// of (world, camera, t).
(function () {
  const LH = globalThis.LH;
  const { PAL, SPR, SKIN, map } = LH;
  const C = LH.core;
  const T = map.T;

  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  // A home's left and right edge in world pixels, measured from how it is really drawn (roof overhang,
  // annex, signs, a founder's plaque), in the band where its side yard is. Cached per look of the home.
  const extentCache = new Map();
  const firstFences = new WeakMap();
  function homeExtent(v, districts) {
    const h = v.home, key = JSON.stringify([h, v.patron === true, LH.map.isFounder(v), (districts[h.district] || {}).style]);
    let e = extentCache.get(key);
    if (e) return e;
    const W = 112, H = 80, ox = h.tileX * LH.map.T - 40, oy = h.tileY * LH.map.T - 40;
    const cv = canvas(W, H), g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, -ox, -oy);
    LH.bld.drawHome(g, v, districts, 0, []);
    const d = g.getImageData(0, 0, W, H).data;
    let a = Infinity, b = -Infinity;
    for (let y = 40 + 6; y < 40 + 34; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 0) { a = Math.min(a, x); b = Math.max(b, x); }
    e = a === Infinity ? [h.tileX * LH.map.T, (h.tileX + 2) * LH.map.T] : [ox + a, ox + b];
    extentCache.set(key, e);
    return e;
  }
  const rgbCache = {};
  const rgb = (name) => {
    if (rgbCache[name]) return rgbCache[name];
    const hex = PAL[name];
    if (!hex) throw new Error('unknown palette colour ' + name);
    const n = parseInt(hex.slice(1), 16);
    return (rgbCache[name] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  };
  const col = (name) => { if (!PAL[name]) throw new Error('unknown palette colour ' + name); return PAL[name]; };
  function rect(c, name, x, y, w, h) { c.fillStyle = col(name); c.fillRect(Math.round(x), Math.round(y), w, h); }
  function px(c, name, x, y) { c.fillStyle = col(name); c.fillRect(Math.round(x), Math.round(y), 1, 1); }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)];

  // ---------------------------------------------------------------- villagers
  const FW = 32, FH = 32, OX = 8, OY = 11;

  function part(lib, spec, kind) {
    const [name, colour] = String(spec || 'none').split(':');
    const p = lib[name];
    if (!p) throw new Error('unknown ' + kind + ' part "' + name + '"');
    return { p, colour: colour || p.accent || 'grey' };
  }

  function stamp(G, rows, ox, oy, colourOf) {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;
        const y = oy + r, x = ox + c;
        if (y < 0 || y >= G.length || x < 0 || x >= G[0].length) continue;
        const v = colourOf(ch);
        if (!v) throw new Error('unknown sprite letter "' + ch + '"');
        G[y][x] = v;
      }
    });
  }

  function composeGrid(app, f) {
    const skin = SKIN[app.skin] || SKIN[2];
    const hair = LH.fam(app.hairColor, 'brown');
    const outC = LH.fam(app.outfitColor, 'blue');
    const outfit = part(SPR.OUTFIT, app.outfit || 'tunic', 'outfit');
    const oAcc = LH.fam(outfit.colour);
    const legs = outfit.p.legs === 'accent' ? oAcc : outfit.p.legs === 'outfit' ? outC : LH.fam(outfit.p.legs || 'grey');
    const boots = LH.fam(outfit.p.boots || 'dark');
    const base = { S: skin[0], s: skin[1], H: hair[0], h: hair[1], O: outC[0], o: outC[1], L: legs[0], B: boots[0] };
    const colourOf = (accent) => {
      const a = LH.fam(accent);
      return (ch) => SPR.FIXED[ch] || base[ch] || (ch === 'A' ? a[0] : ch === 'a' ? a[1] : null);
    };
    const G = Array.from({ length: FH }, () => Array(FW).fill(null));
    const put = (pt) => stamp(G, pt.p.rows, OX, OY + pt.p.y, colourOf(pt.colour));
    put({ p: { rows: SPR.BODY, y: 0 }, colour: 'grey' });
    put(outfit);
    const accs = [app.accessory || 'none', ...(app.extras || [])].map((s) => part(SPR.ACCESSORY[String(s).split(':')[0]] ? SPR.ACCESSORY : SPR.HAT, s, 'accessory'));
    accs.filter((a) => a.p.layer === 'neck').forEach(put);
    put(part(SPR.BEARD, app.beard, 'beard'));
    put(part(SPR.HAIR, app.hair, 'hair'));
    accs.filter((a) => a.p.layer === 'face').forEach(put);
    put(part(SPR.HAT, app.hat, 'hat'));
    accs.filter((a) => !a.p.layer).forEach(put); // hats given as extras
    const tool = part(SPR.TOOL, app.tool, 'tool');
    const fr = tool.p.frames[f % 2];
    stamp(G, fr.rows, OX + SPR.HAND[0] - fr.ax, OY + SPR.HAND[1] - fr.ay, colourOf(tool.colour));
    if (fr.rows.length) G[OY + SPR.HAND[1]][OX + SPR.HAND[0]] = skin[0];
    if (f % 2 === 1 && tool.p.bob) {
      for (let r = OY + 16; r >= 1; r--) G[r] = G[r - 1].slice();
      G[0] = Array(FW).fill(null);
    }
    return shape(G, String(app.body || 'average'));
  }

  // Body types change the composed figure: tall (+2 rows), short (-2 rows), stout (+2 columns).
  function shape(G, body) {
    const mods = body.split(/[\s,+]+/);
    const row = (r) => G[r].slice();
    const empty = () => Array(G[0].length).fill(null);
    if (mods.includes('tall')) G = [...G.slice(2, 25), row(24), ...G.slice(25, 28), row(27), ...G.slice(28)];
    if (mods.includes('short')) G = [empty(), empty(), ...G.slice(0, 24), ...G.slice(25, 27), ...G.slice(28)];
    if (mods.includes('stout')) {
      G = G.map((r, i) => (i >= OY + 11 ? [...r.slice(0, 15), r[14], ...r.slice(15, 18), r[17], ...r.slice(18)] : [null, ...r, null]));
    }
    return G;
  }

  function gridToCanvas(G) {
    const h = G.length, w = G[0].length;
    const c = canvas(w, h);
    const x = c.getContext('2d');
    const img = x.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      const v = G[y][i];
      if (!v) continue;
      const [r, g, b] = rgb(v);
      const o = (y * w + i) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  const spriteCache = new Map();
  function villagerSprite(app) {
    const key = JSON.stringify(app);
    let s = spriteCache.get(key);
    if (!s) {
      const g0 = composeGrid(app, 0), g1 = composeGrid(app, 1);
      let top = 0;
      while (top < g0.length && g0[top].every((v) => !v)) top++;
      const tool = part(SPR.TOOL, app.tool, 'tool').p;
      s = { frames: [gridToCanvas(g0), gridToCanvas(g1)], w: g0[0].length, h: g0.length, top, rate: tool.rate, glow: tool.glow };
      spriteCache.set(key, s);
    }
    return s;
  }

  const petCache = new Map();
  function petSprite(spec) {
    let s = petCache.get(spec);
    if (!s) {
      const pt = part(SPR.PET, spec, 'pet');
      const a = LH.fam(pt.colour === 'grey' && pt.p.accent ? pt.p.accent : pt.colour);
      const of = (ch) => SPR.FIXED[ch] || (ch === 'A' ? a[0] : ch === 'a' ? a[1] : null);
      const frames = pt.p.frames.map((rows) => {
        const w = Math.max(...rows.map((r) => r.length));
        const G = Array.from({ length: rows.length }, () => Array(w).fill(null));
        stamp(G, rows, 0, 0, of);
        return gridToCanvas(G);
      });
      s = { frames, w: frames[0].width, h: frames[0].height };
      petCache.set(spec, s);
    }
    return s;
  }

  // Moving about: every villager has their own day, a loop of short walks around the yard and the path
  // in front of their home (any direction, never into the house), each followed by a stop where they
  // work (their tool's action), look around or just stand. About 3 in 10 are busy at home and only take
  // a step or two now and then. The loop ends where it starts, so it repeats without a jump.
  // Deterministic in t (seeded per id). Returns { dx, dy (pixels from the door), walk, face }.
  const plans = new Map();
  function dayPlan(id) {
    let p = plans.get(id);
    if (p) return p;
    const r = C.rng(C.hashStr('walk:' + id));
    const busy = r() < 0.3;
    const n = busy ? 2 + Math.floor(r() * 2) : 4 + Math.floor(r() * 4);
    const legs = [];
    let x = 0, y = 0, face = r() < 0.5 ? -1 : 1, total = 0;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const reach = busy ? 0.8 : 1.2 + r() * 1.6; // tiles
      let x1 = last ? 0 : Math.round((r() * 2 - 1) * reach * T);
      const y1 = last ? 0 : Math.round(r() * (busy ? 0.4 : 1.3) * T);
      if (!last && Math.abs(x1 - x) + Math.abs(y1 - y) < 6) x1 = x + (x1 >= x ? 8 : -8);
      const walk = Math.hypot(x1 - x, y1 - y) / (10 + r() * 6); // seconds, at 10-16 px/s
      const stop = busy ? 4 + r() * 6 : r() < 0.35 ? 3 + r() * 5 : 0.8 + r() * 2.2;
      if (x1 !== x) face = x1 > x ? 1 : -1;
      legs.push({ x0: x, y0: y, x1, y1, walk, stop, face, look: r() < 0.45, start: total });
      total += walk + stop;
      x = x1; y = y1;
    }
    p = { legs, total, phase: r() * total };
    plans.set(id, p);
    return p;
  }
  function stroll(id, t) {
    const p = dayPlan(String(id));
    const q = (((t + p.phase) % p.total) + p.total) % p.total;
    let leg = p.legs[0];
    for (const l of p.legs) if (q >= l.start) leg = l;
    const lt = q - leg.start;
    if (lt < leg.walk) {
      const e = lt / leg.walk;
      return { dx: C.lerp(leg.x0, leg.x1, e), dy: C.lerp(leg.y0, leg.y1, e), walk: true, face: leg.face };
    }
    // stopped: working or standing; now and then a look over the shoulder
    const s = (lt - leg.walk) / leg.stop;
    const face = leg.look && s > 0.35 && s < 0.65 ? -leg.face : leg.face;
    return { dx: leg.x1, dy: leg.y1, walk: false, face };
  }

  // Daily work (map.WORKS): a loop of walking out along a route between the houses (map.route), working
  // at one or more stops (hauling a trap, casting, hoeing...), walking home and resting by the door.
  // Haulers carry a plank on the way out. Deterministic in t (seeded per id). Points are world pixels.
  const workPlans = new WeakMap();
  function workPlan(world, v) {
    let per = workPlans.get(world);
    if (!per) { per = new Map(); workPlans.set(world, per); }
    const key = v.id + '|' + (v.work || '') + '|' + (v.job || '') + '|' + v.home.tileX + ',' + v.home.tileY;
    if (per.has(key)) return per.get(key);
    const spot = map.workSpot(world, v);
    let p = null;
    if (spot) {
      const r = C.rng(C.hashStr('work:' + v.id));
      const home = map.homeSpot(v);
      const speed = 13 + r() * 5; // px per second
      const legs = [];
      let total = 0, face = 1;
      const go = (pts, carry) => {
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          if (x1 !== x0) face = x1 > x0 ? 1 : -1;
          const walk = Math.hypot(x1 - x0, y1 - y0) / speed;
          legs.push({ x0, y0, x1, y1, walk, stop: 0, face, carry, start: total });
          total += walk;
        }
      };
      const stay = (x, y, s, work, f) => { legs.push({ x0: x, y0: y, x1: x, y1: y, walk: 0, stop: s, face: f, work, start: total }); total += s; };
      const out = map.route(world, home, spot.stops[0]);
      go(out, spot.work === 'haul');
      spot.stops.forEach((s, i) => {
        if (i) go([spot.stops[i - 1], s], false);
        const f = spot.work === 'patrol' ? (i ? -1 : 1) : spot.work === 'sweep' ? (i ? -1 : 1) : spot.face;
        stay(s[0], s[1], (spot.stops.length > 1 ? 5 : 9) + r() * 6, spot.work, f);
      });
      const last = spot.stops[spot.stops.length - 1];
      go(map.route(world, last, home), false);
      stay(home[0], home[1], 3 + r() * 4, null, face);
      p = { legs, total, phase: r() * total, spot, home };
    }
    per.set(key, p);
    return p;
  }
  function runPlan(p, t) {
    const q = (((t + p.phase) % p.total) + p.total) % p.total;
    let leg = p.legs[0];
    for (const l of p.legs) if (q >= l.start) leg = l;
    const lt = q - leg.start;
    if (lt < leg.walk) {
      const e = lt / leg.walk;
      return { x: C.lerp(leg.x0, leg.x1, e), y: C.lerp(leg.y0, leg.y1, e), walk: true, face: leg.face, carry: leg.carry };
    }
    return { x: leg.x1, y: leg.y1, walk: false, face: leg.face, work: leg.work, u: lt - leg.walk };
  }

  // What working looks like, drawn over the villager (x, y feet, head = head-top y, f facing, u seconds
  // into the stop). Returns how far the body dips (crouching, bending).
  const workDip = (w, u) => w === 'traps' || w === 'beachcomb' || w === 'garden' ? (Math.floor(u * 1.4) % 2) : w === 'farm' || w === 'chop' ? (Math.floor(u * 2.2) % 2) : 0;
  function drawWork(c, w, x, y, head, f, t, u, id) {
    const hx = x + f * 6, hy = y - 10; // about where the hands are
    if (w === 'traps') {
      // a wire trap on a rope: hauled up out of the water and lowered again
      const k = (u % 4) / 4, lift = Math.round(Math.sin(k * Math.PI) * 6);
      const tx = x + f * 10, ty = y - 4 - lift;
      rect(c, 'sand3', hx, hy, 1, ty - hy);
      rect(c, 'ink', tx - 4, ty - 5, 9, 6); rect(c, 'wood', tx - 3, ty - 4, 7, 4);
      for (let i = -3; i <= 3; i += 2) rect(c, 'sand2', tx + i, ty - 4, 1, 4);
      if (lift > 2) { px(c, 'foam', tx - 2, ty + 2 + (Math.floor(t * 8) % 3)); px(c, 'foam', tx + 2, ty + 1 + (Math.floor(t * 7) % 3)); }
      rect(c, 'foam', x - 6, y, 13, 1);
    } else if (w === 'fishing') {
      // a rod over the water; the float bobs, and now and then something bites
      const tipx = x + f * 13, tipy = y - 21;
      for (let i = 0; i < 9; i++) px(c, 'wood2', hx + Math.round(f * i * 0.8), hy - Math.round(i * 1.2));
      const bite = (u % 7) > 5.6;
      const fx = x + f * 20, fy = y - 13 + (bite ? 2 : Math.round(Math.sin(t * 2.5 + x) * 0.6));
      c.globalAlpha = 0.7;
      for (let i = 0; i <= 8; i++) px(c, 'cream', Math.round(C.lerp(tipx, fx, i / 8)), Math.round(C.lerp(tipy, fy, i / 8) + Math.sin((i / 8) * Math.PI) * 2));
      c.globalAlpha = 1;
      rect(c, 'ember', fx, fy - 1, 2, 2); px(c, 'white', fx, fy - 2);
      if (bite) { rect(c, 'foam', fx - 3, fy + 1, 2, 1); rect(c, 'foam', fx + 3, fy + 1, 2, 1); }
    } else if (w === 'beachcomb') {
      if ((u % 3) > 1.8) { px(c, 'white', x + f * 5, y - 2); px(c, 'rose', x + f * 6, y - 1); px(c, 'gold', x + f * 5, y - 6 - Math.floor(u * 4) % 2); }
    } else if (w === 'farm') {
      // a hoe going up and down, with a puff of earth when it lands
      const up = Math.floor(u * 2.2) % 2 === 0;
      const ex = x + f * (up ? 9 : 11), ey = up ? y - 15 : y;
      for (let i = 0; i <= 6; i++) px(c, 'wood2', Math.round(C.lerp(hx, ex, i / 6)), Math.round(C.lerp(hy, ey, i / 6)));
      rect(c, 'stone2', ex - (f < 0 ? 2 : 0), ey, 3, 1);
      if (!up) { px(c, 'wood3', ex - 2, ey - 2); px(c, 'wood2', ex + 2, ey - 3); px(c, 'wood3', ex + 1, ey - 1); }
    } else if (w === 'chop') {
      const up = Math.floor(u * 2.2) % 2 === 0;
      const ax = x + f * (up ? 4 : 10), ay = up ? head - 4 : y - 5;
      for (let i = 0; i <= 5; i++) px(c, 'wood2', Math.round(C.lerp(hx, ax, i / 5)), Math.round(C.lerp(hy, ay, i / 5)));
      rect(c, 'stone3', ax - 1, ay - 1, 3, 3);
      if (!up) { px(c, 'wood3', ax + f * 4, ay - 3); px(c, 'wood3', ax + f * 6, ay - 1); px(c, 'cream', ax - f * 2, ay - 4); }
    } else if (w === 'garden') {
      // a watering can and a trickle of drops
      rect(c, 'ink', hx - 1, hy - 1, 6, 5); rect(c, 'stone3', hx, hy, 4, 3); rect(c, 'stone3', hx + f * 4, hy - 1, 3, 1);
      for (let i = 0; i < 3; i++) px(c, 'foam', hx + f * 7, hy + 1 + ((Math.floor(t * 9) + i * 3) % 9));
    } else if (w === 'sweep') {
      const s = Math.round(Math.sin(u * 6) * 3);
      for (let i = 0; i <= 7; i++) px(c, 'wood2', hx + Math.round(i * 0.3 * f) + Math.round(s * i / 7), hy + i);
      rect(c, 'sand3', hx + f * 2 + s - 2, y - 2, 5, 2);
      if (Math.floor(u * 3) % 2) { c.globalAlpha = 0.5; px(c, 'sand2', hx + s + f * 6, y - 3); px(c, 'sand2', hx + s + f * 8, y - 5); c.globalAlpha = 1; }
    } else if (w === 'music') {
      // little notes floating up
      for (let i = 0; i < 2; i++) {
        const k = ((u * 0.6 + i * 0.5) % 1);
        const nx = x + f * 4 + Math.round(Math.sin(k * 6 + i) * 3) + i * 5, ny = head - 4 - Math.round(k * 14);
        c.globalAlpha = 1 - k;
        rect(c, 'ink', nx, ny, 2, 2); rect(c, 'ink', nx + 1, ny - 4, 1, 4);
        c.globalAlpha = 1;
      }
    } else if (w === 'laundry') {
      if (Math.floor(u * 1.2) % 2) rect(c, 'white', hx - 1, hy - 8, 4, 3);
    } else if (w === 'patrol') {
      // stops to look out, hand over the eyes
      if ((u % 4) > 1.5) rect(c, 'ink', x + f * 2, head + 4, 4, 1);
    }
  }
  // The things that stay at a work spot, working or not: trap buoys, a plank pile, a chopping block, a
  // washing line, flower beds, a stool.
  function drawWorkProps(c, spot, id, t) {
    const w = spot.work, [x, y] = spot.stops[0];
    const r = C.rng(C.hashStr('workprops:' + id));
    if (w === 'traps') {
      for (const [bx, by] of [[x + 6, y - 22], [x + 24, y - 18]]) {
        const b = Math.round(Math.sin(t * 2 + bx) * 1);
        rect(c, 'ink', bx - 2, by - 5 + b, 5, 5); rect(c, 'ember', bx - 1, by - 4 + b, 3, 3); px(c, 'white', bx - 1, by - 3 + b);
        rect(c, 'foam', bx - 3, by + b, 7, 1);
      }
      // a spare trap on the sand
      const sx = x - 12, sy = y + 10;
      rect(c, 'ink', sx - 4, sy - 6, 9, 6); rect(c, 'wood', sx - 3, sy - 5, 7, 4);
      for (let i = -3; i <= 3; i += 2) rect(c, 'sand2', sx + i, sy - 5, 1, 4);
    } else if (w === 'haul') {
      for (let i = 0; i < 3; i++) { rect(c, 'ink', x + 6 + i, y - 2 - i * 3, 18, 3); rect(c, i % 2 ? 'wood3' : 'wood', x + 7 + i, y - 1 - i * 3, 16, 2); }
    } else if (w === 'chop') {
      const bx = x + spot.face * 11;
      rect(c, 'ink', bx - 5, y - 6, 10, 6); rect(c, 'wood', bx - 4, y - 5, 8, 5); rect(c, 'wood3', bx - 4, y - 6, 8, 1); px(c, 'wood2', bx, y - 6);
      for (let i = 0; i < 3; i++) { rect(c, 'ink', bx - 18 * spot.face - 5, y - 3 - i * 3, 10, 3); rect(c, 'wood3', bx - 18 * spot.face - 4, y - 2 - i * 3, 8, 2); }
    } else if (w === 'laundry') {
      const x0 = x - 14, x1 = x + 14;
      rect(c, 'wood2', x0, y - 20, 1, 20); rect(c, 'wood2', x1, y - 20, 1, 20);
      for (let i = x0; i <= x1; i++) px(c, 'stone', i, y - 19 + Math.round(Math.sin(((i - x0) / (x1 - x0)) * Math.PI) * 1.5));
      const cols = ['white', 'cream', 'rose', 'teal', 'gold', 'plum'];
      for (let k = 0; k < 3; k++) {
        const cx = x0 + 3 + k * 8, cl = cols[Math.floor(r() * cols.length)];
        const sway = Math.round(Math.sin(t * 2.4 + k) * 1);
        rect(c, cl, cx + sway * 0.5, y - 18, 6, 7 + (k % 2)); rect(c, 'ink', cx, y - 19, 6, 1);
      }
    } else if (w === 'garden') {
      const bx = x + spot.face * 12;
      rect(c, 'wood2', bx - 7, y - 3, 14, 3); rect(c, 'wood4', bx - 6, y - 3, 12, 2);
      const cols = ['rose', 'gold', 'plum', 'white'];
      for (let i = 0; i < 4; i++) { rect(c, 'moss', bx - 5 + i * 3, y - 6, 1, 3); px(c, cols[(i + Math.floor(r() * 4)) % 4], bx - 5 + i * 3, y - 7); }
    } else if (w === 'music') {
      rect(c, 'ink', x - 4, y - 5, 8, 2); rect(c, 'wood3', x - 3, y - 5, 6, 1); rect(c, 'wood2', x - 3, y - 3, 1, 3); rect(c, 'wood2', x + 2, y - 3, 1, 3);
    }
  }

  // Animation frame (0/1) of a sprite at time t, phase-shifted per id so a crowd is not in sync.
  const animFrame = (id, rate, t) => Math.floor(t * rate + C.h2(C.hashStr(String(id)), 3) * 2) % 2;

  // Draws a villager with feet at (x, y). Returns head-top y.
  function drawVillager(c, app, id, x, y, t, lights, o = {}) {
    const s = villagerSprite(app);
    // walking (o.walk): quicker steps with a small bob; o.face -1 = facing left (mirrored)
    const f = o.frame != null ? o.frame : o.walk ? Math.floor(t * 6) % 2 : animFrame(id, s.rate, t);
    const bob = o.walk ? Math.floor(t * 6) % 2 : 0;
    c.globalAlpha = 0.28; rect(c, 'ink', x - 5, y - 1, 11, 2); c.globalAlpha = 1;
    const dx = Math.round(x - s.w / 2), dy = Math.round(y - s.h + 1) - bob + (o.dip || 0);
    if (o.face === -1) { c.save(); c.translate(dx * 2 + s.w, 0); c.scale(-1, 1); c.drawImage(s.frames[f], dx, dy); c.restore(); }
    else c.drawImage(s.frames[f], dx, dy);
    if (s.glow && lights) lights.push({ x: dx + OX + SPR.HAND[0] - 2 + s.glow[0] + (s.w - FW) / 2, y: dy + OY + SPR.HAND[1] + s.glow[1] + (s.h - FH), r: 12, kind: 'lamp' });
    if (app.pet) {
      const p = petSprite(app.pet);
      const pf = animFrame(id + 'pet', 1.3, t);
      c.globalAlpha = 0.28; rect(c, 'ink', x - 15 - p.w / 2 + 1, y - 1, p.w - 2, 2); c.globalAlpha = 1;
      c.drawImage(p.frames[pf], Math.round(x - 15 - p.w / 2), Math.round(y - p.h + 1));
    }
    return dy + s.top;
  }

  // ---------------------------------------------------------------- ground tiles
  const tileCache = new Map();
  function tileCanvas(type, variant) {
    const key = type + variant;
    let c = tileCache.get(key);
    if (c) return c;
    c = canvas(T, T);
    const g = c.getContext('2d');
    const r = C.rng(C.hashStr(key));
    const speck = (name, n) => { for (let i = 0; i < n; i++) px(g, name, Math.floor(r() * T), Math.floor(r() * T)); };
    if (type === 'grass' || type === 'rockgrass') {
      rect(g, 'grass', 0, 0, T, T);
      for (let i = 0; i < 7; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 15); px(g, 'moss', x, y); px(g, 'moss', x + 1, y - 1); }
      if (variant === 3) { const x = 3 + Math.floor(r() * 10), y = 3 + Math.floor(r() * 10); px(g, ['rose', 'gold', 'white'][Math.floor(r() * 3)], x, y); px(g, 'moss2', x, y + 1); }
      if (type === 'rockgrass') { const x = 2 + Math.floor(r() * 9), y = 4 + Math.floor(r() * 8); rect(g, 'stone2', x, y + 1, 5, 3); rect(g, 'stone', x, y, 4, 3); rect(g, 'stone3', x + 1, y, 2, 1); }
    } else if (type === 'darkgrass') {
      rect(g, 'moss', 0, 0, T, T); speck('moss2', 14); speck('grass', 4);
    } else if (type === 'sand') {
      rect(g, 'sand', 0, 0, T, T); speck('sand2', 9); if (variant === 2) { px(g, 'white', 6, 9); px(g, 'rose', 7, 9); }
    } else if (type === 'rock') {
      rect(g, 'stone2', 0, 0, T, T);
      for (let i = 0; i < 4; i++) { const x = Math.floor(r() * 12), y = Math.floor(r() * 12); rect(g, 'stone', x, y, 4, 3); rect(g, 'stone3', x, y, 3, 1); }
    } else if (type === 'path') {
      rect(g, 'sand2', 0, 0, T, T); speck('sand3', 8); speck('sand', 6);
    } else if (type === 'footpath' || type === 'footpath-dark') {
      const dark = type === 'footpath-dark';
      rect(g, dark ? 'moss' : 'grass', 0, 0, T, T);
      for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 4); px(g, dark ? 'moss2' : 'moss', x, y); }
      for (let x = 0; x < T; x++) {
        const top = 6 + (r() < 0.3 ? 1 : 0) - (r() < 0.2 ? 1 : 0), bot = 13 - (r() < 0.3 ? 1 : 0);
        rect(g, 'sand2', x, top, 1, bot - top);
      }
      for (let i = 0; i < 5; i++) px(g, i % 2 ? 'sand3' : 'sand', Math.floor(r() * 16), 8 + Math.floor(r() * 4));
    } else if (type === 'stonepath' || type === 'stonepath-dark') { // upgrade "stonepaths": flagstones to the door
      rect(g, type === 'stonepath-dark' ? 'moss' : 'grass', 0, 0, T, T);
      rect(g, 'stone2', 0, 6, T, 7);
      for (let i = 0; i < 4; i++) { const x = i * 4 + (variant % 2) * 2 - 1; rect(g, 'stone', x + 1, 7, 3, 2); rect(g, 'stone', x, 10, 3, 2); px(g, 'stone3', x + 1, 7); }
      for (let x = 0; x < T; x++) { if (r() < 0.35) px(g, 'moss', x, 6); if (r() < 0.35) px(g, 'moss', x, 12); }
    } else if (type === 'road') { // upgrade "cobbles": the main roads are paved
      rect(g, 'stone2', 0, 0, T, T);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) { const ox = (y % 2) * 2 - 1; rect(g, (x + y + variant) % 3 ? 'stone' : 'stone3', x * 4 + ox, y * 4, 3, 3); }
      speck('sand2', 3);
    } else if (type === 'yard') {
      rect(g, 'sand2', 0, 0, T, T); speck('sand3', 6); speck('wood3', 5); speck('sand', 5);
    } else if (type === 'cobble') {
      rect(g, 'stone2', 0, 0, T, T);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const ox = (y % 2) * 2; rect(g, 'stone', x * 4 + ox, y * 4, 3, 3); px(g, 'stone3', x * 4 + ox, y * 4); }
    } else if (type === 'boards') {
      rect(g, 'wood3', 0, 0, T, T);
      for (let y = 3; y < T; y += 4) rect(g, 'wood', 0, y, T, 1);
      for (let y = 0; y < 4; y++) { const x = (y * 7 + variant * 3) % 14; rect(g, 'wood', x, y * 4, 1, 3); px(g, 'wood2', x + 1, y * 4 + 1); }
    } else if (type === 'field') {
      // variant "crop-dir" (map.fieldKind). Rows every 4 px so they run on across tiles.
      const [crop, dir] = String(variant).split('-');
      const row = (i, col, w = 2) => dir === 'v' ? rect(g, col, i, 0, w, T) : rect(g, col, 0, i, T, w);
      const dot = (i, j, col) => dir === 'v' ? px(g, col, i, j) : px(g, col, j, i);
      if (crop === 'wheat' || crop === 'barley') {
        rect(g, crop === 'wheat' ? 'gold' : 'sand', 0, 0, T, T);
        for (let i = 3; i < T; i += 4) row(i, crop === 'wheat' ? 'gold2' : 'sand2', 1);
        for (let k = 0; k < 10; k++) dot(Math.floor(r() * 4) * 4 + 1, Math.floor(r() * T), crop === 'wheat' ? 'lanternhi' : 'cream');
      } else if (crop === 'green') {
        rect(g, 'wood', 0, 0, T, T);
        for (let i = 1; i < T; i += 4) { row(i, 'moss2'); for (let j = (i * 3) % 3; j < T; j += 3) dot(i, j, 'grass'); }
      } else if (crop === 'cabbage') {
        rect(g, 'wood', 0, 0, T, T);
        for (let i = 1; i < T; i += 4) for (let j = 1; j < T; j += 4) { dot(i, j, 'moss'); dot(i + 1, j, 'moss'); dot(i, j + 1, 'moss2'); dot(i + 1, j + 1, 'grass'); }
      } else if (crop === 'lavender') {
        rect(g, 'wood', 0, 0, T, T);
        for (let i = 1; i < T; i += 4) { row(i, 'moss2'); for (let j = 0; j < T; j += 2) dot(i, j, 'plum'); }
      } else { // plowed
        rect(g, 'wood', 0, 0, T, T);
        for (let i = 2; i < T; i += 4) row(i, 'wood2', 1);
        for (let k = 0; k < 4; k++) px(g, 'wood3', Math.floor(r() * T), Math.floor(r() * T));
      }
    } else {
      rect(g, 'ink', 0, 0, T, T);
    }
    tileCache.set(key, c);
    return c;
  }

  // Water tile with moving waves and shore foam.
  const waterBase = (tx, ty) => { const d = map.coastY(tx) - ty; return d <= 1 ? 'sea3' : d <= 3 ? 'sea2' : 'sea'; };
  function drawWater(c, tx, ty, t) {
    const coast = map.coastY(tx);
    const d = coast - ty;
    const base = waterBase(tx, ty);
    const hi = d <= 1 ? 'foam' : d <= 3 ? 'sea3' : 'sea2';
    const x0 = tx * T, y0 = ty * T;
    rect(c, base, x0, y0, T, T);
    // dither into the band above so depth changes are soft
    const above = waterBase(tx, ty - 1);
    if (above !== base) for (let x = 0; x < T; x++) {
      const k = 2 + Math.floor(7 * C.vnoise((x0 + x) * 0.12, ty, 8));
      for (let y = 0; y < k; y++) if (bayer(x0 + x, y0 + y) < (k - y) / (k + 1)) px(c, above, x0 + x, y0 + y);
    }
    for (const side of [-1, 1]) {
      if (map.isLand(tx + side, ty)) continue;
      const nb = waterBase(tx + side, ty);
      if (nb === base) continue;
      for (let y = 0; y < T; y++) {
        const k = 2 + Math.floor(6 * C.vnoise(tx, (y0 + y) * 0.12, 9 + side));
        for (let i = 0; i < k; i++) { const x = side < 0 ? i : T - 1 - i; if (bayer(x0 + x, y0 + y) < (k - i) / (k + 1)) px(c, nb, x0 + x, y0 + y); }
      }
    }
    for (let i = 0; i < 2; i++) {
      const hx = C.h2(tx, ty, 21 + i);
      if (Math.sin(t * 1.3 + hx * 6.283) < -0.3) continue;
      const wx = (((hx * 16 + t * (i ? 3 : -2)) % 16) + 16) % 16;
      rect(c, hi, x0 + Math.floor(wx), y0 + 3 + i * 8 + Math.floor(C.h2(tx, ty, 9) * 3), 3, 1);
    }
    // foam along land below and beside
    const landBelow = map.isLand(tx, ty + 1);
    if (landBelow) {
      const e = 2 + Math.round(1.4 * Math.sin(t * 1.7 + tx * 0.9));
      for (let x = 0; x < T; x++) {
        const top = T - e - (C.h2(tx * 16 + x, 1, 3) < 0.3 ? 1 : 0);
        rect(c, 'foam', x0 + x, y0 + top, 1, T - top);
        px(c, 'foam2', x0 + x, y0 + T - 1);
      }
    }
    for (const side of [-1, 1]) {
      if (!map.isLand(tx + side, ty)) continue;
      const e = 2 + Math.round(Math.sin(t * 1.7 + ty));
      rect(c, 'foam', side < 0 ? x0 : x0 + T - e, y0, e, T);
    }
  }

  // ---------------------------------------------------------------- trees and props
  function drawTree(c, x, y, kind, seed, t) {
    // x,y = trunk base
    c.globalAlpha = 0.25; rect(c, 'ink', x - 6, y - 1, 12, 2); c.globalAlpha = 1;
    const sway = Math.round(Math.sin(t * 0.8 + seed) * 0.6);
    if (kind === 'pine') {
      rect(c, 'ink', x - 2, y - 5, 4, 5); rect(c, 'wood2', x - 1, y - 5, 2, 5);
      const tiers = [[7, 0], [6, 6], [4, 11], [2, 15]];
      for (const [w, dy] of tiers) {
        const yy = y - 6 - dy;
        for (let r = 0; r < 7; r++) {
          const half = Math.max(0, w - Math.floor(r * w / 7));
          rect(c, 'ink', x - half - 1 + (r < 3 ? sway : 0), yy - r, half * 2 + 2, 1);
          rect(c, r < 2 ? 'pine2' : 'pine', x - half + (r < 3 ? sway : 0), yy - r, half * 2, 1);
        }
        px(c, 'moss2', x - 2, yy - 3);
      }
    } else {
      rect(c, 'ink', x - 2, y - 7, 4, 7); rect(c, 'wood', x - 1, y - 7, 2, 7);
      const cx = x + sway, cy = y - 14;
      const R = 8;
      for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
        const d = Math.sqrt(xx * xx + yy * yy * 1.15);
        if (d > R) continue;
        const name = d > R - 1 ? 'ink' : (xx + yy < -4 ? 'grass' : xx + yy > 5 ? 'moss2' : 'moss');
        px(c, name, cx + xx, cy + yy);
      }
      if (seed % 3 === 0) { px(c, 'ember', cx - 3, cy + 1); px(c, 'ember', cx + 2, cy - 3); px(c, 'ember', cx + 4, cy + 3); }
    }
  }

  const PROPS = {
    lamppost(c, x, y, o, t, L) {
      rect(c, 'ink', x - 1, y - 18, 3, 18); rect(c, 'wood2', x, y - 18, 1, 18);
      rect(c, 'ink', x - 3, y - 25, 7, 8); rect(c, 'lantern', x - 2, y - 24, 5, 6); rect(c, 'lanternhi', x - 1, y - 23, 3, 3);
      L.push({ x: x + 0.5, y: y - 21, r: 16, kind: 'lamp' });
    },
    barrel(c, x, y) {
      rect(c, 'ink', x - 5, y - 11, 10, 11); rect(c, 'wood', x - 4, y - 10, 8, 10); rect(c, 'wood3', x - 3, y - 10, 2, 10);
      rect(c, 'stone2', x - 4, y - 8, 8, 1); rect(c, 'stone2', x - 4, y - 3, 8, 1); rect(c, 'wood2', x - 4, y - 11, 8, 1);
    },
    crate(c, x, y) {
      rect(c, 'ink', x - 6, y - 11, 12, 11); rect(c, 'wood3', x - 5, y - 10, 10, 9); rect(c, 'wood', x - 5, y - 6, 10, 1);
      for (let i = 0; i < 9; i++) px(c, 'wood', x - 5 + i, y - 10 + i);
    },
    rowboat(c, x, y, o, t) {
      const b = Math.round(Math.sin(t * 1.6 + x) * 1);
      rect(c, 'sea', x - 11, y - 1, 22, 2);
      rect(c, 'ink', x - 10, y - 7 + b, 20, 7); rect(c, 'wood', x - 9, y - 6 + b, 18, 5); rect(c, 'wood3', x - 9, y - 6 + b, 18, 1);
      rect(c, 'wood2', x - 7, y - 5 + b, 14, 2); rect(c, 'wood3', x - 1, y - 5 + b, 2, 2);
      rect(c, 'foam', x - 12, y + b, 3, 1); rect(c, 'foam', x + 9, y - b, 3, 1);
    },
    buoy(c, x, y, o, t) {
      const b = Math.round(Math.sin(t * 2 + x) * 1);
      rect(c, 'ink', x - 3, y - 7 + b, 6, 7); rect(c, 'ember', x - 2, y - 6 + b, 4, 5); rect(c, 'white', x - 2, y - 4 + b, 4, 1);
      rect(c, 'foam', x - 4, y + b, 8, 1);
    },
    netrack(c, x, y) {
      rect(c, 'wood2', x - 9, y - 14, 2, 14); rect(c, 'wood2', x + 7, y - 14, 2, 14); rect(c, 'wood2', x - 9, y - 14, 18, 1);
      for (let yy = -13; yy < -3; yy++) for (let xx = -7; xx < 7; xx++) if ((xx + yy) % 3 === 0 || (xx - yy) % 3 === 0) px(c, 'sand2', x + xx, y + yy);
    },
    plankpile(c, x, y) {
      for (let i = 0; i < 4; i++) { rect(c, 'ink', x - 10 + i, y - 3 - i * 3, 20, 3); rect(c, i % 2 ? 'wood3' : 'wood', x - 9 + i, y - 2 - i * 3, 18, 2); }
    },
    sawhorse(c, x, y) {
      rect(c, 'wood2', x - 6, y - 7, 1, 7); rect(c, 'wood2', x + 5, y - 7, 1, 7); rect(c, 'ink', x - 8, y - 9, 16, 3); rect(c, 'wood3', x - 7, y - 8, 14, 1);
    },
    bench(c, x, y) {
      rect(c, 'ink', x - 8, y - 6, 16, 3); rect(c, 'wood3', x - 7, y - 5, 14, 1); rect(c, 'wood2', x - 6, y - 3, 1, 3); rect(c, 'wood2', x + 5, y - 3, 1, 3);
    },
    board(c, x, y, o, t, L, world) {
      rect(c, 'ink', x - 12, y - 22, 2, 22); rect(c, 'ink', x + 10, y - 22, 2, 22);
      rect(c, 'wood2', x - 11, y - 22, 1, 22); rect(c, 'wood2', x + 11, y - 22, 1, 22);
      rect(c, 'ink', x - 14, y - 26, 28, 16); rect(c, 'wood', x - 13, y - 25, 26, 14); rect(c, 'wood2', x - 14, y - 27, 28, 2);
      const n = Math.min(14, (world.villagers || []).length + 3);
      for (let i = 0; i < n; i++) {
        const r = C.rng(i + 7);
        rect(c, i % 3 ? 'cream' : 'white', x - 12 + (i % 7) * 3.6, y - 24 + Math.floor(i / 7) * 6 + Math.floor(r() * 2), 3, 4);
      }
    },
    // A wooden sign a viewer asked for. o.text is shown on the website; here it is suggested by
    // short pen strokes (pixel text this small would not be readable). o.color tints the board.
    sign(c, x, y, o) {
      rect(c, 'ink', x - 1, y - 16, 3, 16); rect(c, 'wood2', x, y - 16, 1, 16);
      const [b1, b2] = o.color ? LH.fam(o.color, 'tan') : ['wood3', 'wood'];
      rect(c, 'ink', x - 10, y - 25, 21, 12); rect(c, b1, x - 9, y - 24, 19, 10); rect(c, b2, x - 9, y - 16, 19, 2);
      const r = C.rng(C.hashStr(o.text || o.name || 'sign'));
      for (let row = 0; row < 2; row++) {
        let xx = x - 7;
        while (xx < x + 7) { const len = 2 + Math.floor(r() * 4); rect(c, 'wood4', xx, y - 22 + row * 3, Math.min(len, x + 7 - xx), 1); xx += len + 1; }
      }
    },
    // A flag a viewer asked for: o.color (and o.color2) from the colour families, o.pattern plain,
    // stripes, half, cross or dot. The cloth waves.
    flag(c, x, y, o, t) {
      rect(c, 'ink', x - 1, y - 30, 3, 30); rect(c, 'stone3', x, y - 30, 1, 30); px(c, 'gold', x, y - 31);
      const c1 = LH.fam(o.color || 'red')[0], c2 = LH.fam(o.color2 || 'white')[0];
      const pat = o.pattern || 'plain';
      for (let i = 0; i < 14; i++) {
        const wave = Math.round(Math.sin(t * 4 + i * 0.6 + x) * (i / 14) * 1.5);
        const top = y - 29 + wave;
        rect(c, 'ink', x + 2 + i, top - 1, 1, 11);
        for (let r = 0; r < 9; r++) {
          const second = pat === 'stripes' ? r >= 3 && r < 6 : pat === 'half' ? i >= 7 : pat === 'cross' ? r === 4 || i === 5 : pat === 'dot' ? (i - 6) ** 2 + (r - 4) ** 2 < 6 : false;
          px(c, second ? c2 : c1, x + 2 + i, top + r);
        }
      }
    },
    dock(c, x, y, o) {
      // x,y = top-left of the pier (world px), o.len in tiles, going north from the quay
      const len = (o.len || 4) * T;
      for (let yy = 0; yy < len; yy += 12) { rect(c, 'ink', x + 1, y - yy - 2, 3, 6); rect(c, 'ink', x + 20, y - yy - 2, 3, 6); rect(c, 'wood2', x + 2, y - yy - 2, 1, 6); rect(c, 'wood2', x + 21, y - yy - 2, 1, 6); }
      rect(c, 'ink', x, y - len, 24, len);
      for (let yy = 0; yy < len - 1; yy += 3) { rect(c, 'wood3', x + 1, y - len + 1 + yy, 22, 2); px(c, 'wood', x + 4 + ((yy * 7) % 15), y - len + 1 + yy); }
    },
  };

  // ---------------------------------------------------------------- landmarks
  function drawLighthouse(c, x, y, t, L) {
    // x,y = base centre
    rect(c, 'ink', x - 12, y - 4, 24, 5); rect(c, 'stone', x - 11, y - 3, 22, 3); rect(c, 'stone3', x - 11, y - 3, 22, 1);
    const H = 52;
    for (let i = 0; i < H; i++) {
      const w = Math.round(8 - (i / H) * 3);
      const band = Math.floor(i / 9) % 2 ? 'ember' : 'white';
      rect(c, 'ink', x - w - 1, y - 4 - i, w * 2 + 2, 1);
      rect(c, band, x - w, y - 4 - i, w * 2, 1);
      rect(c, band === 'white' ? 'stone3' : 'ember2', x + w - 3, y - 4 - i, 3, 1);
    }
    rect(c, 'ink', x - 3, y - 13, 6, 9); rect(c, 'wood2', x - 2, y - 12, 4, 8);
    rect(c, 'ink', x - 2, y - 30, 4, 5); rect(c, 'night', x - 1, y - 29, 2, 3);
    const top = y - 4 - H;
    rect(c, 'ink', x - 9, top - 2, 18, 3); rect(c, 'stone2', x - 8, top - 1, 16, 1);
    rect(c, 'ink', x - 6, top - 10, 12, 9); rect(c, 'lanternhi', x - 5, top - 9, 10, 7); rect(c, 'ink', x - 1, top - 9, 1, 7);
    for (let i = 0; i < 6; i++) rect(c, 'ink', x - 6 + i, top - 11 - i, 12 - i * 2, 1), rect(c, 'ember', x - 5 + i, top - 11 - i, Math.max(0, 10 - i * 2), 1);
    px(c, 'ink', x, top - 18);
    L.push({ x, y: top - 6, r: 26, kind: 'lighthouse' });
    return { lampX: x, lampY: top - 6 };
  }

  // The ship on its slipway, side view, bow to the east. x,y = stern end of the keel, bottom.
  // ---- landmarks (map.LANDMARKS): big story changes to the map. x0, y0 = top-left pixel of the
  // footprint (w x h tiles); drawn from the footprint's bottom edge up, so tall ones rise above it.
  // stage 0 = just found; 1+ = explored / in use (lights, tools); see the skill.
  function blob(c, col, cx, cy, rx, ry, outline = 'ink') { // filled pixel ellipse
    for (let yy = -ry; yy <= ry; yy++) {
      const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2)));
      if (outline) rect(c, outline, cx - hw - 1, cy + yy, hw * 2 + 3, 1);
      rect(c, col, cx - hw, cy + yy, hw * 2 + 1, 1);
    }
  }
  const glow = (lights, x, y, r = 14) => { if (lights) lights.push({ x, y, r, kind: 'lamp' }); };
  const LANDMARK_DRAW = {
    cave(c, x0, y0, l, t, lights) {
      const cx = x0 + 24, by = y0 + 32;
      blob(c, 'stone2', cx, by - 14, 24, 16); blob(c, 'stone', cx - 4, by - 18, 17, 11, null);
      for (let i = 0; i < 14; i++) px(c, 'moss', cx - 14 + i * 2, by - 29 + (i % 3));
      rect(c, 'moss2', cx - 10, by - 30, 20, 2);
      for (let yy = 0; yy < 15; yy++) { const hw = Math.round(8 * Math.sqrt(1 - ((15 - yy) / 16) ** 2)) + 1; rect(c, 'ink', cx - hw, by - 16 + yy, hw * 2, 1); }
      rect(c, 'stone3', cx - 18, by - 22, 3, 2); rect(c, 'stone3', cx + 10, by - 26, 4, 2);
      if ((l.stage || 0) >= 1) { rect(c, 'wood2', cx + 11, by - 12, 1, 12); rect(c, 'lantern', cx + 10, by - 15, 3, 3); glow(lights, cx + 11, by - 14); }
      if ((l.stage || 0) >= 2) { rect(c, 'wood', cx - 10, by - 17, 2, 17); rect(c, 'wood', cx + 8, by - 17, 2, 17); rect(c, 'wood3', cx - 10, by - 18, 20, 2); }
      if ((l.stage || 0) >= 3) { const f = Math.floor(t * 2) % 2; px(c, f ? 'gold' : 'lanternhi', cx - 1, by - 8); glow(lights, cx, by - 8, 10); }
    },
    ruins(c, x0, y0, l, t, lights) {
      const by = y0 + 48;
      const wall = (x, y, w, h) => { rect(c, 'ink', x - 1, y - 1, w + 2, h + 1); rect(c, 'stone', x, y, w, h); for (let yy = y + 3; yy < y + h; yy += 4) rect(c, 'stone2', x, yy, w, 1); rect(c, 'stone3', x, y, w, 1); };
      wall(x0 + 2, by - 22, 14, 22); wall(x0 + 2, by - 30, 6, 8); wall(x0 + 30, by - 18, 16, 18); wall(x0 + 40, by - 26, 6, 8);
      wall(x0 + 16, by - 8, 14, 8);
      rect(c, 'ink', x0 + 18, by - 34, 12, 2); rect(c, 'stone3', x0 + 18, by - 35, 12, 1); wall(x0 + 18, by - 32, 3, 24); wall(x0 + 27, by - 32, 3, 10);
      for (let i = 0; i < 9; i++) { const r = C.h2(i, l.tileX, 91); rect(c, i % 2 ? 'stone2' : 'stone', x0 + 4 + Math.floor(r * 40), by - 3 + (i % 3), 3, 2); }
      for (let i = 0; i < 6; i++) px(c, 'moss', x0 + 4 + i * 7, by - 22 + (i % 3) * 4);
      if ((l.stage || 0) >= 1) { rect(c, 'wood2', x0 + 33, by - 34, 1, 16); rect(c, 'wood2', x0 + 43, by - 34, 1, 8); rect(c, 'wood3', x0 + 32, by - 34, 13, 1); }
      if ((l.stage || 0) >= 2) { rect(c, 'lantern', x0 + 22, by - 12, 3, 3); glow(lights, x0 + 23, by - 11); }
    },
    stones(c, x0, y0, l, t, lights) {
      const cx = x0 + 24, cy = y0 + 30;
      blob(c, 'moss2', cx, cy, 20, 9, null);
      const lit = (l.stage || 0) >= 1;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4, sx = Math.round(cx + Math.cos(a) * 18), sy = Math.round(cy + Math.sin(a) * 8);
        const h = 10 + (i % 3) * 3;
        rect(c, 'ink', sx - 3, sy - h - 1, 6, h + 1); rect(c, 'stone', sx - 2, sy - h, 4, h); rect(c, 'stone3', sx - 2, sy - h, 1, h);
        if (lit) { px(c, Math.sin(t * 2 + i) > 0 ? 'sea3' : 'foam', sx, sy - h + 3); }
      }
      rect(c, 'ink', cx - 6, cy - 3, 12, 5); rect(c, 'stone2', cx - 5, cy - 2, 10, 3);
      if (lit) glow(lights, cx, cy - 6, 18);
    },
    mine(c, x0, y0, l, t, lights) {
      const cx = x0 + 16, by = y0 + 32;
      blob(c, 'stone2', cx, by - 10, 17, 12); blob(c, 'stone', cx - 3, by - 13, 11, 7, null);
      rect(c, 'ink', cx - 7, by - 16, 14, 16);
      rect(c, 'wood', cx - 9, by - 18, 3, 18); rect(c, 'wood', cx + 6, by - 18, 3, 18); rect(c, 'wood3', cx - 10, by - 20, 20, 3);
      rect(c, 'stone3', cx - 5, by - 2, 1, 4); rect(c, 'stone3', cx + 4, by - 2, 1, 4);
      for (let i = 0; i < 3; i++) rect(c, 'wood2', cx - 6, by - 1 + i * 2, 12, 1);
      if ((l.stage || 0) >= 1) { rect(c, 'ink', cx + 10, by - 6, 9, 6); rect(c, 'stone2', cx + 11, by - 5, 7, 3); rect(c, 'stone3', cx + 11, by - 7, 7, 2); }
      if ((l.stage || 0) >= 2) { rect(c, 'lantern', cx - 1, by - 22, 3, 3); glow(lights, cx, by - 21); }
    },
    tower(c, x0, y0, l, t, lights) {
      const cx = x0 + 16, by = y0 + 30;
      rect(c, 'ink', cx - 11, by - 52, 22, 52); rect(c, 'stone', cx - 10, by - 51, 20, 51); rect(c, 'stone3', cx - 10, by - 51, 3, 51); rect(c, 'stone2', cx + 6, by - 51, 4, 51);
      for (let yy = by - 47; yy < by; yy += 6) rect(c, 'stone2', cx - 10, yy, 20, 1);
      for (let i = 0; i < 5; i++) rect(c, 'night', cx - 10 + i * 4 + (i % 2), by - 55 + (i % 3) * 2, 3, 4 + (i % 2) * 3); // broken top
      rect(c, 'ink', cx - 3, by - 38, 6, 8); rect(c, 'ink', cx - 3, by - 10, 6, 10);
      if ((l.stage || 0) >= 1) { rect(c, 'lanternhi', cx - 2, by - 37, 4, 6); glow(lights, cx, by - 34, 16); }
      for (let i = 0; i < 4; i++) px(c, 'moss', cx - 9 + i * 5, by - 20 + i * 3);
    },
    shrine(c, x0, y0, l, t, lights) {
      const cx = x0 + 16, by = y0 + 30;
      rect(c, 'ink', cx - 11, by - 5, 22, 5); rect(c, 'stone2', cx - 10, by - 4, 20, 3);
      rect(c, 'ink', cx - 7, by - 18, 14, 13); rect(c, 'stone', cx - 6, by - 17, 12, 12); rect(c, 'ink', cx - 3, by - 13, 6, 8);
      for (let r = 0; r < 6; r++) { rect(c, 'ink', cx - 10 + r, by - 24 + r, 20 - r * 2, 1); } rect(c, 'ember2', cx - 9, by - 23, 18, 4);
      const f = Math.floor(t * 6) % 2;
      px(c, f ? 'lanternhi' : 'gold', cx, by - 10); px(c, 'cream', cx, by - 9); glow(lights, cx, by - 10, (l.stage || 0) >= 1 ? 18 : 10);
      if ((l.stage || 0) >= 1) for (let i = 0; i < 3; i++) px(c, ['rose', 'gold', 'white'][i], cx - 8 + i * 8, by - 6);
    },
    pond(c, x0, y0, l, t) {
      const cx = x0 + 24, cy = y0 + 18;
      blob(c, 'sea2', cx, cy, 22, 10, 'sand2'); blob(c, 'sea', cx + 2, cy + 2, 14, 5, null);
      const r = Math.floor(t * 1.5) % 6; rect(c, 'sea3', cx - 6 + r, cy - 3, 4, 1); rect(c, 'foam', cx + 6 - r, cy + 3, 3, 1);
      for (let i = 0; i < 5; i++) { rect(c, 'moss2', x0 + 2 + i * 2, cy - 4 - (i % 2) * 2, 1, 6); px(c, 'wood2', x0 + 2 + i * 2, cy - 5 - (i % 2) * 2); }
      if ((l.stage || 0) >= 1) { rect(c, 'wood', cx + 12, cy - 2, 12, 3); rect(c, 'wood2', cx + 12, cy + 1, 1, 4); rect(c, 'wood2', cx + 22, cy + 1, 1, 4); }
    },
    garden(c, x0, y0, l, t) {
      const by = y0 + 30;
      rect(c, 'wood2', x0 + 1, by - 22, 46, 1); rect(c, 'wood2', x0 + 1, by - 2, 46, 1);
      for (let x = x0 + 1; x <= x0 + 46; x += 5) rect(c, 'wood', x, by - 24, 1, 24);
      for (let row = 0; row < 3; row++) {
        rect(c, 'wood4', x0 + 4, by - 19 + row * 6, 40, 3);
        for (let i = 0; i < 9; i++) { const k = (i + row + (l.stage || 0)) % 4; px(c, 'moss', x0 + 6 + i * 4, by - 20 + row * 6); px(c, ['rose', 'gold', 'white', 'ember'][k], x0 + 6 + i * 4, by - 21 + row * 6); }
      }
    },
    campfire(c, x0, y0, l, t, lights) {
      const cx = x0 + 16, cy = y0 + 22;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; rect(c, 'stone', Math.round(cx + Math.cos(a) * 6) - 1, Math.round(cy + Math.sin(a) * 3) - 1, 3, 2); }
      const f = Math.floor(t * 8) % 3;
      rect(c, 'ember', cx - 2, cy - 4 - f, 5, 4 + f); rect(c, 'lantern', cx - 1, cy - 6 - f, 3, 5); px(c, 'lanternhi', cx, cy - 7 - (f % 2));
      glow(lights, cx, cy - 4, 22);
      rect(c, 'ink', cx - 15, cy + 3, 9, 4); rect(c, 'wood', cx - 14, cy + 4, 7, 2); rect(c, 'ink', cx + 6, cy - 9, 9, 4); rect(c, 'wood', cx + 7, cy - 8, 7, 2);
      if ((l.stage || 0) >= 1) { rect(c, 'ink', cx + 7, cy + 3, 9, 4); rect(c, 'wood', cx + 8, cy + 4, 7, 2); }
    },
    pit(c, x0, y0, l, t, lights) {
      const cx = x0 + 16, cy = y0 + 18;
      blob(c, 'wood4', cx, cy, 13, 8, 'stone2'); blob(c, 'ink', cx, cy + 1, 9, 5, null);
      for (let i = 0; i < 7; i++) rect(c, i % 2 ? 'stone' : 'stone2', cx - 14 + i * 4, cy + 7 + (i % 2), 3, 2);
      if ((l.stage || 0) >= 1) { rect(c, 'wood', cx + 2, cy - 10, 1, 14); rect(c, 'wood', cx + 6, cy - 10, 1, 14); for (let yy = cy - 8; yy < cy + 4; yy += 3) rect(c, 'wood3', cx + 2, yy, 5, 1); }
      if ((l.stage || 0) >= 2) { rect(c, 'lantern', cx - 2, cy - 1, 2, 2); glow(lights, cx - 1, cy, 10); }
    },
    clearing(c, x0, y0, l) { // the trees are gone (stumps are drawn where they stood); a log pile in the middle
      const cx = x0 + 8, by = y0 + 14;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) { const lx = cx - 7 + j * 5 + i * 2, ly = by - 4 - i * 3; rect(c, 'ink', lx - 1, ly - 1, 6, 4); rect(c, 'wood', lx, ly, 4, 2); px(c, 'wood3', lx + 1, ly); }
      if ((l.stage || 0) >= 1) { rect(c, 'wood2', cx + 9, by - 9, 1, 9); rect(c, 'stone3', cx + 7, by - 10, 5, 2); } // an axe in a stump
    },
    statue(c, x0, y0, l, t) {
      const cx = x0 + 8, by = y0 + 15;
      rect(c, 'ink', cx - 6, by - 6, 12, 6); rect(c, 'stone2', cx - 5, by - 5, 10, 4);
      rect(c, 'ink', cx - 4, by - 26, 8, 20); rect(c, 'stone', cx - 3, by - 25, 6, 19); rect(c, 'stone3', cx - 3, by - 25, 2, 19);
      rect(c, 'ink', cx - 3, by - 32, 6, 6); rect(c, 'stone', cx - 2, by - 31, 4, 4);
      if ((l.stage || 0) >= 1) { px(c, 'rose', cx - 4, by - 7); px(c, 'gold', cx + 3, by - 7); }
    },
    // ---- added 2026-11-07 (rewards for the like goals and more story places) ----
    beacon(c, x0, y0, l, t, lights) { // a stone pillar with an iron fire basket; stage 1+ it burns
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 11, by - 6, 22, 6); rect(c, 'stone2', cx - 10, by - 5, 20, 4); rect(c, 'stone', cx - 10, by - 5, 20, 1);
      for (let i = 0; i < 35; i++) {
        const w = Math.round(7 - (i / 35) * 2);
        rect(c, 'ink', cx - w - 1, by - 6 - i, w * 2 + 2, 1);
        rect(c, i % 6 === 5 ? 'stone2' : 'stone', cx - w, by - 6 - i, w * 2, 1);
        rect(c, 'stone3', cx - w, by - 6 - i, 2, 1);
      }
      const ty = by - 41;
      rect(c, 'ink', cx - 9, ty - 2, 18, 3); rect(c, 'stone2', cx - 8, ty - 1, 16, 1);
      rect(c, 'ink', cx - 7, ty - 9, 14, 1); rect(c, 'ink', cx - 6, ty - 3, 12, 1);
      for (let k = 0; k < 5; k++) rect(c, 'ink', cx - 7 + k * 3, ty - 9, 1, 7);
      if (st < 1) { rect(c, 'wood', cx - 5, ty - 6, 10, 2); rect(c, 'wood2', cx - 4, ty - 5, 8, 1); }
      else {
        const f = Math.floor(t * 8) % 3;
        rect(c, 'ember', cx - 5, ty - 7 - f, 10, 5 + f); rect(c, 'lantern', cx - 3, ty - 10 - f, 6, 6); rect(c, 'lanternhi', cx - 1, ty - 12 - (f % 2), 2, 4);
        glow(lights, cx, ty - 8, 40);
      }
      if (st >= 2) { rect(c, 'ink', cx - 2, by - 14, 4, 8); rect(c, 'wood2', cx - 1, by - 13, 2, 7); }
      if (st >= 3) for (const lx of [cx - 9, cx + 8]) { rect(c, 'lantern', lx, by - 9, 2, 2); glow(lights, lx + 1, by - 8, 10); }
    },
    windmill(c, x0, y0, l, t, lights) { // sails turn from stage 1 (with cloth); 2 flour sacks; 3 a lit window
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      for (let i = 0; i < 36; i++) {
        const hw = Math.round(9 - (i / 36) * 3);
        rect(c, 'ink', cx - hw - 1, by - i, hw * 2 + 2, 1);
        rect(c, i % 4 === 3 ? 'wood2' : 'wood3', cx - hw, by - i, hw * 2, 1);
        rect(c, 'wood', cx + hw - 3, by - i, 3, 1);
      }
      rect(c, 'ink', cx - 3, by - 10, 6, 10); rect(c, 'wood2', cx - 2, by - 9, 4, 9);
      const ty = by - 36;
      for (let r = 0; r < 7; r++) { rect(c, 'ink', cx - 8 + r, ty - r, 16 - r * 2, 1); if (r > 0) rect(c, 'ember2', cx - 7 + r, ty - r, 14 - r * 2, 1); }
      if (st >= 3) { rect(c, 'lanternhi', cx - 1, by - 24, 3, 3); glow(lights, cx, by - 23, 12); }
      const hx = cx, hy = ty - 2, a0 = st >= 1 ? t * 1.2 : 0.4;
      for (let k = 0; k < 4; k++) {
        const a = a0 + (k * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a), pa = Math.cos(a + Math.PI / 2), pb = Math.sin(a + Math.PI / 2);
        for (let r = 3; r <= 22; r++) {
          px(c, 'wood2', hx + ca * r, hy + sa * r);
          if (st >= 1 && r >= 7) for (let o = 1; o <= 4; o++) px(c, o === 4 || r === 22 ? 'sand2' : 'cream', hx + ca * r + pa * o, hy + sa * r + pb * o);
          else if (r >= 7 && r % 3 === 0) for (let o = 1; o <= 4; o++) px(c, 'wood', hx + ca * r + pa * o, hy + sa * r + pb * o);
        }
      }
      rect(c, 'ink', hx - 1, hy - 1, 3, 3); px(c, 'stone3', hx, hy);
      if (st >= 2) for (const sx of [cx + 9, cx + 14]) { rect(c, 'ink', sx, by - 6, 5, 6); rect(c, 'cream', sx + 1, by - 5, 3, 5); px(c, 'sand2', sx + 2, by - 6); }
    },
    well(c, x0, y0, l, t, lights) { // stone well with a little roof and a bucket
      const cx = x0 + 8, by = y0 + 15, st = l.stage || 0;
      rect(c, 'ink', cx - 6, by - 8, 12, 8); rect(c, 'stone', cx - 5, by - 7, 10, 7); rect(c, 'stone2', cx - 5, by - 4, 10, 1); rect(c, 'stone2', cx - 1, by - 7, 1, 3);
      rect(c, 'ink', cx - 7, by - 10, 14, 3); rect(c, 'stone3', cx - 6, by - 9, 12, 1); rect(c, 'night', cx - 4, by - 9, 8, 1);
      rect(c, 'wood2', cx - 6, by - 21, 1, 12); rect(c, 'wood2', cx + 5, by - 21, 1, 12);
      for (let r = 0; r < 5; r++) { rect(c, 'ink', cx - 8 + r, by - 21 - r, 16 - r * 2, 1); if (r < 4) rect(c, 'ember2', cx - 7 + r, by - 21 - r, 14 - r * 2, 1); }
      rect(c, 'wood', cx - 5, by - 17, 10, 1);
      for (let yy = by - 16; yy < by - 13; yy++) px(c, 'ink', cx, yy);
      rect(c, 'ink', cx - 1, by - 13, 3, 3); px(c, 'wood', cx, by - 12);
      if (st >= 1) { rect(c, 'lantern', cx + 6, by - 15, 2, 2); glow(lights, cx + 7, by - 14, 10); }
      if (st >= 2) { px(c, 'rose', cx - 7, by - 1); px(c, 'gold', cx - 5, by); px(c, 'rose', cx + 6, by); px(c, 'white', cx + 7, by - 1); }
    },
    festival(c, x0, y0, l, t, lights) { // three poles with a string of flags (stage 0) or lanterns (1+);
      const by = y0 + 30, st = l.stage || 0; // 2 a small stage; 3 tables
      const poles = [x0 + 2, x0 + 24, x0 + 45], top = by - 28;
      for (const p of poles) { rect(c, 'ink', p - 1, top - 1, 3, 29); rect(c, 'wood2', p, top, 1, 28); px(c, 'gold', p, top - 2); }
      const COLS = ['ember', 'gold', 'rose', 'teal', 'sea3', 'cream'];
      let n = 0;
      for (let k = 0; k < 2; k++) {
        const a = poles[k], b = poles[k + 1];
        for (let x = a + 1; x < b; x++) px(c, 'stone2', x, top + Math.round(Math.sin(((x - a) / (b - a)) * Math.PI) * 5));
        for (let x = a + 4; x < b - 2; x += 5) {
          const y = top + Math.round(Math.sin(((x - a) / (b - a)) * Math.PI) * 5) + 1, col = COLS[n++ % COLS.length];
          if (st >= 1) {
            const sw = Math.round(Math.sin(t * 2 + n) * 0.6);
            px(c, 'ink', x + sw, y); rect(c, col, x - 1 + sw, y + 1, 3, 3); px(c, 'lanternhi', x + sw, y + 2);
            if (n % 3 === 0) glow(lights, x, y + 2, 12);
          } else { rect(c, col, x - 1, y, 3, 1); px(c, col, x, y + 1); }
        }
      }
      if (st >= 2) {
        rect(c, 'ink', x0 + 13, by - 9, 22, 9); rect(c, 'wood', x0 + 14, by - 8, 20, 8); rect(c, 'wood3', x0 + 14, by - 8, 20, 2);
        for (let x = x0 + 16; x < x0 + 34; x += 5) rect(c, 'wood2', x, by - 6, 1, 6);
      }
      if (st >= 3) for (const tx of [x0 + 2, x0 + 37]) { rect(c, 'ink', tx - 1, by - 6, 11, 3); rect(c, 'wood3', tx, by - 5, 9, 1); rect(c, 'wood2', tx, by - 3, 1, 3); rect(c, 'wood2', tx + 8, by - 3, 1, 3); px(c, 'cream', tx + 3, by - 6); px(c, 'ember', tx + 5, by - 6); }
    },
    greenhouse(c, x0, y0, l, t, lights) { // glass house with plants; stage 1 fuller and a lamp; 2 pots outside
      const by = y0 + 30, st = l.stage || 0, x = x0 + 3, w = 42;
      rect(c, 'ink', x, by - 6, w, 6); rect(c, 'stone', x + 1, by - 5, w - 2, 5); rect(c, 'stone2', x + 1, by - 2, w - 2, 1);
      rect(c, 'ink', x, by - 24, w, 18); rect(c, 'foam', x + 1, by - 23, w - 2, 17);
      for (let r = 0; r < 8; r++) { rect(c, 'ink', x + r, by - 25 - r, w - r * 2, 1); if (r < 7) rect(c, r % 2 ? 'foam2' : 'foam', x + r + 1, by - 25 - r, w - r * 2 - 2, 1); }
      for (let i = 0; i < 10; i++) { const k = C.h2(i, l.tileX, 7); px(c, k > 0.5 ? 'moss2' : 'moss', x + 3 + i * 4, by - 9 - Math.floor(k * 3)); px(c, 'moss', x + 4 + i * 4, by - 8); if (st >= 1) px(c, ['rose', 'gold', 'ember'][i % 3], x + 3 + i * 4, by - 12 - Math.floor(k * 2)); }
      for (let xx = x + 6; xx < x + w; xx += 7) rect(c, 'wood2', xx, by - 24, 1, 18);
      rect(c, 'wood2', x, by - 15, w, 1);
      rect(c, 'ink', x + 18, by - 16, 6, 10); rect(c, 'wood', x + 19, by - 15, 4, 9);
      for (let i = 0; i < 4; i++) px(c, 'white', x + 4 + i * 11, by - 21 + (i % 2));
      if (st >= 1) { rect(c, 'lanternhi', x + 30, by - 20, 2, 2); glow(lights, x + 31, by - 19, 16); }
      if (st >= 2) for (const ppx of [x - 3, x + w + 1]) { rect(c, 'ink', ppx - 1, by - 4, 5, 4); rect(c, 'ember2', ppx, by - 3, 3, 3); px(c, 'moss', ppx + 1, by - 5); px(c, 'rose', ppx + 1, by - 6); }
    },
    observatory(c, x0, y0, l, t, lights) { // a stone drum with a dome and a telescope aimed at the fog
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 12, by - 20, 24, 20); rect(c, 'stone', cx - 11, by - 19, 22, 19); rect(c, 'stone3', cx - 11, by - 19, 3, 19); rect(c, 'stone2', cx + 7, by - 19, 4, 19);
      for (let yy = by - 15; yy < by; yy += 5) rect(c, 'stone2', cx - 11, yy, 22, 1);
      for (let yy = -9; yy <= 0; yy++) {
        const hw = Math.round(12 * Math.sqrt(1 - (yy / 9) ** 2));
        rect(c, 'ink', cx - hw - 1, by - 21 + yy, hw * 2 + 3, 1); rect(c, 'stone3', cx - hw, by - 21 + yy, hw * 2 + 1, 1); rect(c, 'stone', cx + Math.round(hw * 0.4), by - 21 + yy, Math.max(0, hw - Math.round(hw * 0.4)), 1);
      }
      rect(c, st >= 1 ? 'lanternhi' : 'ink', cx - 1, by - 30, 3, 9);
      if (st >= 1) glow(lights, cx, by - 26, 14);
      const len = st >= 2 ? 14 : 9;
      for (let i = 0; i < len; i++) { rect(c, 'ink', cx - 3 - i, by - 28 - i, 4, 3); }
      for (let i = 0; i < len; i++) { rect(c, i % 4 === 0 ? 'gold2' : 'gold', cx - 2 - i, by - 27 - i, 2, 1); }
      rect(c, 'ink', cx - 3, by - 9, 6, 9); rect(c, 'wood2', cx - 2, by - 8, 4, 8);
      if (st >= 3) for (let i = 0; i < 4; i++) px(c, Math.sin(t * 3 + i * 2) > 0 ? 'white' : 'lanternhi', cx - 20 - i * 6, by - 48 - (i % 2) * 5);
    },
    fountain(c, x0, y0, l, t, lights) { // a round basin with running water; 1 coins in it; 2 lamps
      const cx = x0 + 16, cy = y0 + 22, st = l.stage || 0;
      blob(c, 'stone2', cx, cy, 14, 6); blob(c, 'sea2', cx, cy - 1, 11, 4, null); rect(c, 'stone3', cx - 13, cy - 5, 26, 1);
      const r = Math.floor(t * 2) % 5; rect(c, 'sea3', cx - 7 + r, cy - 2, 3, 1); rect(c, 'foam', cx + 4 - r, cy + 1, 2, 1);
      if (st >= 1) for (let i = 0; i < 3; i++) px(c, Math.sin(t * 4 + i * 2) > 0.3 ? 'lanternhi' : 'gold', cx - 6 + i * 5, cy + (i % 2));
      rect(c, 'ink', cx - 2, cy - 15, 4, 13); rect(c, 'stone3', cx - 1, cy - 14, 2, 12);
      rect(c, 'ink', cx - 6, cy - 17, 12, 3); rect(c, 'stone', cx - 5, cy - 16, 10, 1);
      for (let k = 0; k < 8; k++) {
        const ph = (t * 1.4 + k / 8) % 1, side = k % 2 ? 1 : -1;
        px(c, k % 3 ? 'foam' : 'foam2', cx + side * (3 + ph * 8), cy - 17 + Math.round(ph * ph * 16 - ph * 3));
      }
      px(c, 'foam2', cx, cy - 18 - (Math.floor(t * 6) % 2));
      if (st >= 2) for (const lx of [x0 + 1, x0 + 30]) { rect(c, 'ink', lx, cy - 12, 1, 14); rect(c, 'lantern', lx - 1, cy - 14, 3, 3); glow(lights, lx, cy - 13, 12); }
    },
    belltower(c, x0, y0, l, t, lights) { // a wooden frame tower with a bell; 1 a roof; 2 the bell polished; 3 a lantern
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 10, by - 40, 4, 40); rect(c, 'wood', cx - 9, by - 40, 2, 40); rect(c, 'ink', cx + 6, by - 40, 4, 40); rect(c, 'wood', cx + 7, by - 40, 2, 40);
      for (const yy of [by - 12, by - 26]) for (let i = 0; i < 13; i++) { px(c, 'wood2', cx - 7 + i, yy - i); px(c, 'wood2', cx - 7 + i, yy - 13 + i); }
      rect(c, 'ink', cx - 11, by - 41, 22, 3); rect(c, 'wood3', cx - 10, by - 40, 20, 1);
      const sw = st >= 1 ? Math.round(Math.sin(t * 3) * 1.5) : 0, bell = st >= 2 ? ['gold', 'gold2'] : ['teal', 'teal2'];
      rect(c, 'ink', cx - 4 + sw, by - 38, 8, 8); rect(c, bell[0], cx - 3 + sw, by - 37, 6, 6); rect(c, bell[1], cx + 1 + sw, by - 37, 2, 6); rect(c, 'ink', cx - 5 + sw, by - 31, 10, 1); px(c, 'ink', cx + sw * 2, by - 30);
      if (st >= 1) for (let r = 0; r < 7; r++) { rect(c, 'ink', cx - 12 + r, by - 42 - r, 24 - r * 2, 1); if (r < 6) rect(c, 'ember', cx - 11 + r, by - 42 - r, 22 - r * 2, 1); }
      if (st >= 3) { rect(c, 'lantern', cx + 10, by - 22, 2, 3); glow(lights, cx + 11, by - 21, 12); }
    },
    treehouse(c, x0, y0, l, t, lights) { // a big tree with a platform and a ladder; 1 a hut; 2 a lit window; 3 a swing
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 4, by - 30, 8, 30); rect(c, 'wood', cx - 3, by - 30, 6, 30); rect(c, 'wood2', cx + 1, by - 30, 2, 30); rect(c, 'ink', cx - 6, by - 2, 12, 2);
      blob(c, 'moss2', cx, by - 40, 15, 11); blob(c, 'moss', cx - 3, by - 43, 10, 7, null);
      for (let i = 0; i < 8; i++) px(c, 'grass', cx - 9 + i * 3, by - 47 + (i % 3) * 3);
      rect(c, 'ink', cx - 13, by - 25, 26, 3); rect(c, 'wood3', cx - 12, by - 24, 24, 1);
      rect(c, 'wood2', cx + 8, by - 22, 1, 22); rect(c, 'wood2', cx + 12, by - 22, 1, 22);
      for (let yy = by - 20; yy < by; yy += 4) rect(c, 'wood3', cx + 8, yy, 5, 1);
      if (st >= 1) {
        rect(c, 'ink', cx - 11, by - 35, 13, 10); rect(c, 'wood', cx - 10, by - 34, 11, 9);
        for (let r = 0; r < 4; r++) rect(c, 'ink', cx - 12 + r, by - 36 - r, 15 - r * 2, 1), rect(c, 'ember2', cx - 11 + r, by - 36 - r, Math.max(0, 13 - r * 2), 1);
        rect(c, st >= 2 ? 'lanternhi' : 'ink', cx - 7, by - 31, 3, 3);
        if (st >= 2) glow(lights, cx - 6, by - 30, 12);
      }
      if (st >= 3) { const s = Math.round(Math.sin(t * 2) * 2); for (let yy = by - 21; yy < by - 6; yy++) { px(c, 'stone2', cx - 9 + Math.round(s * (yy - by + 21) / 15), yy); px(c, 'stone2', cx - 4 + Math.round(s * (yy - by + 21) / 15), yy); } rect(c, 'wood3', cx - 9 + s, by - 6, 6, 1); }
    },
    balloon(c, x0, y0, l, t, lights) { // a striped balloon: stage 0 laid out flat; 1 up on its rope; 2 the burner lit
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      if (st < 1) {
        blob(c, 'ember', cx - 2, by - 5, 12, 3); for (let x = cx - 12; x < cx + 9; x += 4) rect(c, 'cream', x, by - 7, 1, 5);
        rect(c, 'ink', cx + 9, by - 8, 8, 7); rect(c, 'wood3', cx + 10, by - 7, 6, 5); rect(c, 'wood', cx + 10, by - 5, 6, 1);
        return;
      }
      const bob = Math.round(Math.sin(t * 1.3) * 2), ey = by - 46 + bob;
      rect(c, 'wood2', cx + 13, by - 4, 2, 4);
      for (let i = 0; i < 18; i++) px(c, 'stone2', cx + 4 + i * 0.5, by - 10 + bob + i * 0.4);
      for (let yy = -14; yy <= 14; yy++) {
        const hw = Math.round(12 * Math.sqrt(1 - (yy / 15) ** 2) * (yy > 6 ? 1 - (yy - 6) / 16 : 1));
        rect(c, 'ink', cx - hw - 1, ey + yy, hw * 2 + 3, 1);
        for (let xx = -hw; xx <= hw; xx++) px(c, Math.floor((xx + 12) / 4) % 2 ? 'cream' : 'ember', cx + xx, ey + yy);
      }
      for (let yy = -12; yy <= 10; yy++) px(c, 'white', cx - 7, ey + yy);
      const bt = by - 14 + bob;
      for (let yy = ey + 13; yy < bt; yy++) { const f = (yy - ey - 13) / Math.max(1, bt - ey - 13); px(c, 'wood2', cx - 6 + f * 2, yy); px(c, 'wood2', cx + 6 - f * 2, yy); }
      rect(c, 'ink', cx - 5, bt, 10, 8); rect(c, 'wood3', cx - 4, bt + 1, 8, 6); rect(c, 'wood', cx - 4, bt + 3, 8, 1);
      if (st >= 2) { const f = Math.floor(t * 8) % 2; rect(c, f ? 'lantern' : 'lanternhi', cx - 1, bt - 4, 2, 3); glow(lights, cx, bt - 3, 14); }
    },
    fishracks(c, x0, y0, l, t, lights) { // drying racks with fish; 1 more fish and a salt barrel; 2 a smoker
      const by = y0 + 14, st = l.stage || 0;
      for (const rx of [x0 + 2, x0 + 25]) {
        rect(c, 'wood2', rx, by - 14, 1, 14); rect(c, 'wood2', rx + 20, by - 14, 1, 14);
        rect(c, 'wood', rx, by - 14, 21, 1); rect(c, 'wood', rx, by - 8, 21, 1);
        for (let k = 0; k < (st >= 1 ? 6 : 4); k++) for (const row of [by - 13, by - 7]) {
          const fx = rx + 2 + k * 3, sw = Math.round(Math.sin(t * 2 + k + row) * 0.4);
          rect(c, 'stone3', fx + sw, row, 2, 4); px(c, 'stone', fx + 1 + sw, row + 1); px(c, 'stone2', fx + sw, row + 4);
        }
      }
      if (st >= 1) { rect(c, 'ink', x0 + 21, by - 6, 5, 6); rect(c, 'wood', x0 + 22, by - 5, 3, 5); rect(c, 'white', x0 + 22, by - 6, 3, 1); }
      if (st >= 2) {
        rect(c, 'ink', x0 + 44, by - 10, 6, 10); rect(c, 'stone', x0 + 45, by - 9, 4, 9);
        for (let i = 0; i < 4; i++) { const ph = (t * 0.6 + i / 4) % 1; px(c, i % 2 ? 'fog' : 'fog2', x0 + 46 + Math.round(Math.sin(ph * 6 + i) * 2), by - 12 - Math.round(ph * 14)); }
      }
    },
    orchard(c, x0, y0, l, t, lights) { // six young fruit trees; stage 1 fruit; 2 bigger, baskets; 3 full grown
      const st = l.stage || 0, size = 5 + Math.min(st, 3);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
        const tx = x0 + 8 + i * 16, ty = y0 + 20 + j * 20;
        rect(c, 'ink', tx - 1, ty - 7, 3, 7); rect(c, 'wood2', tx, ty - 7, 1, 7);
        blob(c, 'moss2', tx, ty - 8 - size, size, size - 1); blob(c, 'moss', tx - 1, ty - 9 - size, size - 2, size - 3, null);
        if (st >= 1) for (let k = 0; k < 4 + st; k++) px(c, (i + j) % 2 ? 'ember' : 'gold', tx - size + 1 + Math.floor(C.h2(i * 7 + j, k, l.tileX) * (size * 2 - 1)), ty - 8 - size - size + 2 + Math.floor(C.h2(k, i + j * 3, 5) * (size * 2 - 2)));
      }
      if (st >= 2) for (const [bx, byy] of [[x0 + 15, y0 + 22], [x0 + 31, y0 + 42]]) { rect(c, 'ink', bx - 1, byy - 4, 7, 4); rect(c, 'wood3', bx, byy - 3, 5, 3); px(c, 'ember', bx + 1, byy - 4); px(c, 'gold', bx + 3, byy - 4); }
    },
    gate(c, x0, y0, l, t, lights) { // a stone arch; 1 a lantern under it; 2 ivy; 3 a name plaque
      const by = y0 + 14, st = l.stage || 0;
      for (const gx of [x0 + 2, x0 + 23]) { rect(c, 'ink', gx - 1, by - 28, 9, 28); rect(c, 'stone', gx, by - 27, 7, 27); rect(c, 'stone3', gx, by - 27, 2, 27); for (let yy = by - 23; yy < by; yy += 5) rect(c, 'stone2', gx, yy, 7, 1); }
      for (let x = x0 + 1; x <= x0 + 31; x++) {
        const top = by - 32 - Math.round(Math.sin(((x - x0 - 1) / 30) * Math.PI) * 5);
        rect(c, 'ink', x, top - 1, 1, 7); rect(c, (x - x0) % 6 === 0 ? 'stone2' : 'stone', x, top, 1, 5); px(c, 'stone3', x, top);
      }
      rect(c, 'ink', x0 + 14, by - 39, 5, 6); rect(c, st >= 3 ? 'gold' : 'stone3', x0 + 15, by - 38, 3, 4);
      if (st >= 1) { px(c, 'ink', x0 + 16, by - 31); rect(c, 'lantern', x0 + 15, by - 30, 3, 3); glow(lights, x0 + 16, by - 28, 12); }
      if (st >= 2) for (let i = 0; i < 10; i++) px(c, i % 3 ? 'moss' : 'moss2', x0 + 1 + (i % 2) * 28 + Math.floor(i / 4), by - 26 + i * 2);
    },
    maypole(c, x0, y0, l, t, lights) { // a tall pole with ribbons that turn; 1 a flower crown; 2 lanterns
      const cx = x0 + 8, by = y0 + 15, st = l.stage || 0;
      rect(c, 'ink', cx - 1, by - 34, 3, 34); rect(c, 'cream', cx, by - 34, 1, 34);
      rect(c, 'ink', cx - 2, by - 37, 5, 4); rect(c, 'gold', cx - 1, by - 36, 3, 2);
      const COLS = ['ember', 'sea3', 'gold', 'rose'];
      for (let k = 0; k < 4; k++) for (let i = 1; i <= 11; i++) {
        const a = t * 1.5 + (k * Math.PI) / 2 + i * 0.25;
        px(c, COLS[k], cx + Math.round(Math.cos(a) * i * 0.9), by - 33 + i * 3);
      }
      if (st >= 1) for (let i = 0; i < 5; i++) px(c, i % 2 ? 'rose' : 'white', cx - 2 + i, by - 38);
      if (st >= 2) for (const lx of [cx - 7, cx + 7]) { rect(c, 'ink', lx, by - 10, 1, 10); rect(c, 'lantern', lx - 1, by - 12, 3, 3); glow(lights, lx, by - 11, 10); }
    },
    boat(c, x0, y0, l, t, lights) { // a boat being built on trestles: 0 keel and ribs; 1 planked; 2 painted; 3 a mast
      const cx = x0 + 24, by = y0 + 28, st = l.stage || 0;
      for (const tx of [x0 + 10, x0 + 36]) { rect(c, 'ink', tx - 1, by - 9, 4, 9); rect(c, 'wood2', tx, by - 9, 2, 9); }
      rect(c, 'ink', x0 + 3, by - 11, 42, 3); rect(c, 'wood', x0 + 4, by - 10, 40, 1);
      if (st < 1) {
        for (let k = 0; k < 7; k++) { const rx = x0 + 8 + k * 5, h = 7 - Math.abs(k - 3); for (let yy = 0; yy < h + 2; yy++) px(c, 'wood3', rx - Math.round(Math.abs(k - 3) * yy / 8), by - 11 - yy); }
        rect(c, 'wood3', x0 + 42, by - 20, 2, 10);
      } else {
        for (let r = 0; r < 11; r++) { // the hull side: a curved stern on the left, a sharper bow on the right
          const xs = x0 + 3 + Math.round(r * r * 0.12), xe = x0 + 46 - Math.round(r * r * 0.22), y = by - 21 + r;
          rect(c, 'ink', xs - 1, y, xe - xs + 2, 1);
          rect(c, st >= 2 && r === 2 ? 'teal' : r === 0 ? 'wood3' : r % 3 === 2 ? 'wood2' : 'wood', xs, y, xe - xs, 1);
        }
        rect(c, 'ink', x0 + 15, by - 10, 19, 1);
        rect(c, 'ink', x0 + 44, by - 23, 3, 5); rect(c, 'wood3', x0 + 45, by - 22, 1, 3);
        if (st >= 2) { rect(c, 'white', x0 + 34, by - 16, 6, 1); px(c, 'gold', x0 + 8, by - 17); }
        if (st >= 3) { rect(c, 'ink', cx - 1, by - 46, 3, 28); rect(c, 'wood2', cx, by - 46, 1, 28); rect(c, 'ink', cx - 9, by - 42, 18, 4); rect(c, 'cream', cx - 8, by - 41, 16, 2); }
      }
      for (let i = 0; i < 4; i++) px(c, 'wood3', x0 + 12 + i * 7 + (i % 2), by + 1);
    },
    // added 2026-11-10 (by hand, at the user's request: more landmarks)
    bandstand(c, x0, y0, l, t, lights) { // a round bandstand: 0 bare posts on a deck; 1 a striped roof; 2 bunting and lamps; 3 music
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 15, by - 6, 30, 6); rect(c, 'wood', cx - 14, by - 5, 28, 5); rect(c, 'wood3', cx - 14, by - 5, 28, 1);
      for (let x = cx - 12; x < cx + 13; x += 4) rect(c, 'wood2', x, by - 3, 1, 3);
      for (const x of [cx - 13, cx - 5, cx + 4, cx + 12]) { rect(c, 'ink', x - 1, by - 24, 3, 19); rect(c, 'cream', x, by - 23, 1, 18); }
      rect(c, 'ink', cx - 14, by - 11, 28, 1); rect(c, 'cream', cx - 13, by - 11, 26, 1);
      if (st >= 1) {
        for (let r = 0; r < 10; r++) {
          const hw = 17 - Math.round(r * 1.6);
          rect(c, 'ink', cx - hw - 1, by - 25 - r, hw * 2 + 3, 1);
          for (let xx = -hw; xx <= hw; xx++) px(c, Math.floor((xx + 18) / 4) % 2 ? 'cream' : 'ember', cx + xx, by - 25 - r);
        }
        rect(c, 'ink', cx - 1, by - 38, 3, 4); px(c, 'gold', cx, by - 38);
      } else rect(c, 'ink', cx - 15, by - 25, 30, 2);
      if (st >= 2) {
        const COLS = ['gold', 'sea3', 'rose', 'moss'];
        for (let x = cx - 16, n = 0; x <= cx + 16; x += 3, n++) { px(c, COLS[n % 4], x, by - 24 + (n % 2)); }
        for (const lx of [cx - 18, cx + 17]) { rect(c, 'ink', lx, by - 12, 1, 12); rect(c, 'lantern', lx - 1, by - 14, 3, 3); glow(lights, lx, by - 13, 12); }
      }
      if (st >= 3) for (let i = 0; i < 3; i++) {
        const ph = (t * 0.5 + i / 3) % 1, nx = cx - 6 + i * 6 + Math.round(Math.sin(ph * 6) * 2), ny = by - 40 - Math.round(ph * 14);
        rect(c, 'ink', nx, ny - 3, 1, 4); rect(c, 'ink', nx - 2, ny, 2, 2); px(c, 'ink', nx + 1, ny - 3);
      }
    },
    hotspring(c, x0, y0, l, t, lights) { // a steaming pool in a ring of rocks: 1 a deck and towels; 2 lamps; 3 a little bath hut
      const cx = x0 + 24, cy = y0 + 20, st = l.stage || 0;
      blob(c, 'stone2', cx, cy, 20, 8); blob(c, 'stone', cx - 2, cy - 2, 17, 6, null); blob(c, 'sea3', cx, cy, 15, 5); blob(c, 'foam', cx - 2, cy - 1, 10, 3, null);
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; rect(c, 'stone3', cx + Math.round(Math.cos(a) * 18) - 1, cy + Math.round(Math.sin(a) * 7) - 1, 3, 2); }
      const b = Math.floor(t * 3) % 6; px(c, 'foam2', cx - 6 + b, cy + 1); px(c, 'foam2', cx + 5 - b, cy - 2);
      for (let i = 0; i < 7; i++) {
        const ph = (t * 0.35 + i / 7) % 1, sx = cx - 12 + i * 4 + Math.round(Math.sin(ph * 5 + i) * 2);
        px(c, ph < 0.5 ? 'foam2' : 'fog2', sx, cy - 4 - Math.round(ph * 18)); if (ph < 0.6) px(c, 'foam2', sx + 1, cy - 5 - Math.round(ph * 18));
      }
      if (st >= 1) {
        rect(c, 'ink', x0 + 1, cy + 6, 14, 5); rect(c, 'wood3', x0 + 2, cy + 7, 12, 2); rect(c, 'wood', x0 + 2, cy + 9, 12, 1);
        rect(c, 'ink', x0 + 4, cy + 4, 5, 3); rect(c, 'white', x0 + 5, cy + 5, 3, 1); rect(c, 'ink', x0 + 9, cy + 4, 5, 3); rect(c, 'rose', x0 + 10, cy + 5, 3, 1);
      }
      if (st >= 2) for (const lx of [x0 + 2, x0 + 45]) { rect(c, 'ink', lx, cy - 10, 1, 14); rect(c, 'lantern', lx - 1, cy - 12, 3, 3); glow(lights, lx, cy - 11, 12); }
      if (st >= 3) {
        const hx = x0 + 36, hb = y0 + 31;
        rect(c, 'ink', hx - 1, hb - 10, 12, 10); rect(c, 'wood', hx, hb - 9, 10, 9); rect(c, 'wood2', hx + 4, hb - 6, 3, 6);
        for (let r = 0; r < 4; r++) rect(c, 'ink', hx - 2 + r, hb - 11 - r, 14 - r * 2, 1), rect(c, 'teal', hx - 1 + r, hb - 11 - r, Math.max(0, 12 - r * 2), 1);
      }
    },
    wreck(c, x0, y0, l, t, lights) { // an old wreck half sunk in a sand dune: 1 a ladder and a lamp; 2 lived in (door, lit window); 3 a flag and a chimney
      const by = y0 + 30, st = l.stage || 0;
      for (let r = 0; r < 12; r++) { // the hull, tipped over, bow up on the right
        const xs = x0 + 3 + Math.round(r * r * 0.1), xe = x0 + 44 - Math.round(r * 0.6), y = by - 18 + r - Math.round((12 - r) * 0.2);
        rect(c, 'ink', xs - 1, y, xe - xs + 2, 1);
        rect(c, r % 3 === 1 ? 'wood4' : r === 0 ? 'wood' : 'wood2', xs, y, xe - xs, 1);
      }
      for (let k = 0; k < 4; k++) { const gx = x0 + 10 + k * 8 + (k % 2) * 2; rect(c, 'ink', gx, by - 16 + (k % 2), 3, 3 + (k % 2)); }
      for (let k = 0; k < 4; k++) rect(c, 'wood2', x0 + 8 + k * 9, by - 23 + (k % 2), 1, 6);
      rect(c, 'ink', x0 + 43, by - 26, 4, 10); rect(c, 'wood', x0 + 44, by - 25, 2, 8);
      for (let i = 0; i < 20; i++) px(c, 'wood2', x0 + 20 + Math.round(i * 0.55), by - 18 - i); // the broken mast
      for (let yy = 0; yy <= 9; yy++) { // the dune that buries the lower hull, flat on top, ragged at the ends
        const hw = Math.min(25, 12 + yy * 2) + Math.round(C.h2(yy, l.tileX, 51) * 2), y = by - 10 + yy;
        rect(c, 'ink', x0 + 24 - hw - 1, y, hw * 2 + 2, 1); rect(c, yy < 2 ? 'sand' : yy > 7 ? 'sand2' : 'sand', x0 + 24 - hw, y, hw * 2, 1);
      }
      rect(c, 'sand', x0 + 13, by - 11, 22, 1);
      for (let i = 0; i < 5; i++) px(c, 'sand3', x0 + 8 + i * 8, by - 5 + (i % 2));
      px(c, 'moss', x0 + 12, by - 7); px(c, 'moss', x0 + 30, by - 6); px(c, 'stone3', x0 + 6, by - 2);
      if (st >= 1) {
        for (let yy = by - 17; yy < by - 2; yy++) { px(c, 'wood3', x0 + 4, yy); px(c, 'wood3', x0 + 7, yy); }
        for (let yy = by - 15; yy < by - 2; yy += 3) rect(c, 'wood3', x0 + 4, yy, 4, 1);
        rect(c, 'ink', x0 + 38, by - 22, 3, 3); px(c, 'lantern', x0 + 39, by - 21); glow(lights, x0 + 39, by - 21, 12);
      }
      if (st >= 2) { rect(c, 'ink', x0 + 24, by - 13, 6, 11); rect(c, 'teal', x0 + 25, by - 12, 4, 10); px(c, 'gold', x0 + 28, by - 7); rect(c, 'lanternhi', x0 + 34, by - 14, 3, 3); glow(lights, x0 + 35, by - 13, 10); }
      if (st >= 3) {
        rect(c, 'ink', x0 + 14, by - 26, 4, 8); rect(c, 'stone', x0 + 15, by - 25, 2, 7);
        for (let i = 0; i < 4; i++) { const ph = (t * 0.6 + i / 4) % 1; px(c, i % 2 ? 'fog' : 'fog2', x0 + 16 + Math.round(Math.sin(ph * 6 + i) * 2), by - 28 - Math.round(ph * 12)); }
        rect(c, 'ink', x0 + 30, by - 39, 1, 21); const w = Math.round(Math.sin(t * 3) * 1);
        rect(c, 'ember', x0 + 31, by - 38, 6, 2); rect(c, 'gold', x0 + 31, by - 36 + w, 6, 2);
      }
    },
    wishtree(c, x0, y0, l, t, lights) { // a huge old tree hung with ribbons: 1 many more ribbons; 2 lanterns; 3 a ring bench
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 6, by - 22, 12, 22); rect(c, 'wood', cx - 5, by - 22, 10, 22); rect(c, 'wood2', cx + 1, by - 22, 4, 22); rect(c, 'wood4', cx - 2, by - 14, 2, 4);
      for (const [dx, k] of [[-9, -1], [9, 1]]) for (let i = 0; i < 8; i++) px(c, 'wood2', cx + k * 4 + Math.round(dx * i / 8), by - 20 - i);
      rect(c, 'ink', cx - 9, by - 2, 18, 2); rect(c, 'wood', cx - 8, by - 2, 4, 1); rect(c, 'wood', cx + 5, by - 2, 4, 1);
      blob(c, 'pine', cx, by - 34, 20, 12); blob(c, 'moss2', cx - 2, by - 37, 16, 9, null); blob(c, 'moss', cx - 5, by - 40, 9, 5, null);
      for (let i = 0; i < 10; i++) px(c, 'grass', cx - 14 + i * 3, by - 41 + (i % 3) * 3);
      const COLS = ['ember', 'gold', 'rose', 'sea3', 'white', 'plum', 'teal', 'cream'];
      const n = st >= 1 ? 12 : 5;
      for (let i = 0; i < n; i++) {
        const rx = cx - 17 + Math.floor(C.h2(i, l.tileX, 61) * 34), ry = by - 26 + Math.floor(C.h2(i, l.tileY, 62) * 4), len = 3 + (i % 3);
        for (let k = 0; k < len; k++) px(c, COLS[i % COLS.length], rx + Math.round(Math.sin(t * 2 + i + k * 0.5) * (k / 3)), ry + k);
      }
      if (st >= 2) for (let i = 0; i < 4; i++) { const lx = cx - 14 + i * 9, ly = by - 25 + (i % 2) * 2; px(c, 'ink', lx + 1, ly - 1); rect(c, 'lantern', lx, ly, 3, 3); px(c, 'lanternhi', lx + 1, ly + 1); glow(lights, lx + 1, ly + 1, 12); }
      if (st >= 3) { rect(c, 'ink', cx - 13, by - 5, 26, 4); rect(c, 'wood3', cx - 12, by - 4, 24, 1); rect(c, 'wood', cx - 12, by - 3, 24, 1); for (const x of [cx - 11, cx + 10]) rect(c, 'wood2', x, by - 2, 1, 2); }
    },
    oven(c, x0, y0, l, t, lights) { // a stone bread oven: 1 a fire and smoke; 2 a table with loaves; 3 a roof over it
      const cx = x0 + 14, by = y0 + 30, st = l.stage || 0;
      rect(c, 'ink', cx - 13, by - 8, 26, 8); rect(c, 'stone', cx - 12, by - 7, 24, 7); rect(c, 'stone2', cx - 12, by - 4, 24, 1);
      for (let yy = -11; yy <= 0; yy++) { const hw = Math.round(12 * Math.sqrt(1 - (yy / 12) ** 2)); rect(c, 'ink', cx - hw - 1, by - 8 + yy, hw * 2 + 3, 1); rect(c, yy < -8 ? 'stone3' : 'sand2', cx - hw, by - 8 + yy, hw * 2 + 1, 1); }
      for (let i = 0; i < 6; i++) px(c, 'sand3', cx - 8 + i * 3, by - 14 + (i % 2) * 3);
      for (let yy = 0; yy < 7; yy++) { const hw = Math.round(4 * Math.sqrt(1 - ((7 - yy) / 8) ** 2)) + 1; rect(c, 'ink', cx - hw, by - 15 + yy, hw * 2, 1); }
      rect(c, 'ink', cx + 5, by - 24, 4, 6); rect(c, 'stone2', cx + 6, by - 23, 2, 5);
      if (st >= 1) {
        const f = Math.floor(t * 8) % 3;
        rect(c, 'ember', cx - 3, by - 11, 6, 3); rect(c, f ? 'lantern' : 'lanternhi', cx - 2, by - 12 + (f % 2), 4, 2); glow(lights, cx, by - 11, 16);
        for (let i = 0; i < 4; i++) { const ph = (t * 0.6 + i / 4) % 1; px(c, i % 2 ? 'fog' : 'fog2', cx + 7 + Math.round(Math.sin(ph * 6 + i) * 2), by - 26 - Math.round(ph * 14)); }
      }
      if (st >= 2) { const tx = x0 + 22; rect(c, 'ink', tx - 1, by - 8, 10, 3); rect(c, 'wood3', tx, by - 7, 8, 1); rect(c, 'wood2', tx, by - 5, 1, 5); rect(c, 'wood2', tx + 7, by - 5, 1, 5); for (const bx of [tx + 1, tx + 4]) { rect(c, 'ink', bx - 1, by - 11, 4, 3); rect(c, 'wood3', bx, by - 10, 2, 2); px(c, 'sand', bx, by - 10); } }
      if (st >= 3) { for (const px0 of [cx - 15, cx + 15]) rect(c, 'wood2', px0, by - 26, 1, 26); for (let r = 0; r < 5; r++) rect(c, 'ink', cx - 18 + r, by - 27 - r, 36 - r * 2, 1), rect(c, 'ember2', cx - 17 + r, by - 27 - r, Math.max(0, 34 - r * 2), 1); }
    },
    lookout(c, x0, y0, l, t, lights) { // a wooden lookout tower on four legs: 1 a roof; 2 a lantern; 3 a flag and someone keeping watch
      const cx = x0 + 16, by = y0 + 30, st = l.stage || 0, top = by - 36;
      for (const [a, b] of [[cx - 12, cx - 8], [cx + 12, cx + 8]]) for (let yy = 0; yy <= 36; yy++) { const x = Math.round(a + (b - a) * (yy / 36)); rect(c, 'ink', x - 1, by - yy, 3, 1); px(c, 'wood', x, by - yy); }
      for (const yy of [by - 10, by - 22]) { const hw = Math.round(11 - ((by - yy) / 36) * 4); rect(c, 'wood2', cx - hw, yy, hw * 2, 1); for (let i = 0; i < hw * 2; i++) px(c, 'wood2', cx - hw + i, yy - 10 + Math.round((i / (hw * 2)) * 10)); }
      for (let yy = by - 34; yy < by; yy += 3) rect(c, 'wood3', cx - 1, yy, 3, 1);
      rect(c, 'ink', cx - 12, top - 1, 24, 4); rect(c, 'wood3', cx - 11, top, 22, 1); rect(c, 'wood', cx - 11, top + 1, 22, 1);
      for (let x = cx - 11; x <= cx + 10; x += 3) rect(c, 'wood2', x, top - 6, 1, 5); rect(c, 'ink', cx - 12, top - 7, 24, 2); rect(c, 'wood3', cx - 11, top - 7, 22, 1);
      if (st >= 3) { rect(c, 'ink', cx + 2, top - 13, 5, 7); rect(c, 'sea2', cx + 3, top - 9, 3, 3); rect(c, 'skin2', cx + 3, top - 12, 3, 3); rect(c, 'ink', cx - 2, top - 11, 5, 1); }
      if (st >= 1) { for (const px0 of [cx - 11, cx + 10]) rect(c, 'wood2', px0, top - 18, 1, 12); for (let r = 0; r < 6; r++) rect(c, 'ink', cx - 14 + r, top - 19 - r, 28 - r * 2, 1), rect(c, 'ember', cx - 13 + r, top - 19 - r, Math.max(0, 26 - r * 2), 1); }
      if (st >= 2) { rect(c, 'lantern', cx - 9, top - 16, 2, 3); glow(lights, cx - 8, top - 15, 16); }
      if (st >= 3) { rect(c, 'ink', cx, top - 34, 1, 10); const w = Math.round(Math.sin(t * 3) * 1); rect(c, 'gold', cx + 1, top - 33, 5, 2); rect(c, 'ember', cx + 1, top - 31 + w, 5, 1); }
    },
    apiary(c, x0, y0, l, t, lights) { // straw beehives on a bench: 1 more hives; 2 a honey stall; 3 flowers all round
      const by = y0 + 14, st = l.stage || 0;
      rect(c, 'ink', x0 + 1, by - 5, 46, 3); rect(c, 'wood3', x0 + 2, by - 4, 44, 1);
      for (const x of [x0 + 3, x0 + 23, x0 + 44]) rect(c, 'wood2', x, by - 2, 1, 2);
      const hives = st >= 1 ? [6, 15, 24, 33] : [9, 21, 33], R = st >= 1 ? 3 : 4;
      for (const hx of hives) {
        const x = x0 + hx;
        for (let r = 0; r < 8; r++) { const hw = Math.round(R * Math.sqrt(1 - ((7 - r) / 8) ** 2)); rect(c, 'ink', x - hw - 1, by - 13 + r, hw * 2 + 3, 1); rect(c, r % 2 ? 'gold2' : 'gold', x - hw, by - 13 + r, hw * 2 + 1, 1); }
        rect(c, 'ink', x, by - 7, 1, 2);
      }
      for (let i = 0; i < 5; i++) { const bt = t * 2.5 + i * 1.7; px(c, 'ink', x0 + 24 + Math.round(Math.sin(bt) * 20), by - 16 + Math.round(Math.cos(bt * 1.4) * 4)); }
      if (st >= 2) { const sx = x0 + 40; for (let k = 0; k < 3; k++) { rect(c, 'ink', sx + k * 3 - 1 - 2, by - 10, 3, 4); px(c, 'gold', sx + k * 3 - 2, by - 9); px(c, 'lantern', sx + k * 3 - 2, by - 8); } }
      if (st >= 3) for (let i = 0; i < 12; i++) { const fx = x0 + 1 + i * 4, fy = by + 1 + (i % 2); px(c, 'moss2', fx, fy + 1); px(c, ['rose', 'white', 'plum', 'gold'][i % 4], fx, fy); }
    },
    maze(c, x0, y0, l, t, lights) { // a hedge maze: 0 young low hedges; 1 grown; 2 a gold statue in the middle; 3 lanterns at the way in
      const st = l.stage || 0, N = 5, S = 9, mx = x0 + 1, my = y0 + 3, k = st >= 1 ? ['pine', 'moss2'] : ['moss2', 'moss'], th = st >= 1 ? 3 : 2;
      rect(c, 'sand', mx, my, N * S + 1, N * S + 1);
      const hw = (x, y, w) => { rect(c, 'ink', x - 1, y - th, w + 2, th + 2); rect(c, k[0], x, y - th + 1, w, th); rect(c, k[1], x, y - th + 1, w, 1); };
      const vw = (x, y, h) => { rect(c, 'ink', x - 1, y - th, 4, h + th + 1); rect(c, k[0], x, y - th + 1, 2, h + th - 1); };
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const north = j > 0 && (i === N - 1 || C.h2(i + l.tileX * 3, j + l.tileY * 5, 71) < 0.5);
        if (j > 0 && !north) hw(mx + i * S, my + j * S, S);
        if (i < N - 1 && (j === 0 || north)) vw(mx + (i + 1) * S - 1, my + j * S, S);
      }
      hw(mx, my, N * S + 1); vw(mx - 1, my, N * S); vw(mx + N * S - 1, my, N * S);
      const gate = mx + 2 * S;
      hw(mx, my + N * S, 2 * S); hw(gate + S, my + N * S, 2 * S + 1);
      if (st >= 2) { const sx = mx + 2 * S + 4, sy = my + 3 * S - 1; rect(c, 'ink', sx - 2, sy - 9, 5, 10); rect(c, 'gold', sx - 1, sy - 8, 3, 6); rect(c, 'gold2', sx, sy - 8, 1, 6); rect(c, 'stone', sx - 2, sy - 2, 5, 2); }
      if (st >= 3) for (const lx of [gate - 2, gate + S + 1]) { rect(c, 'ink', lx, my + N * S - 10, 1, 12); rect(c, 'lantern', lx - 1, my + N * S - 12, 3, 3); glow(lights, lx, my + N * S - 11, 12); }
    },
    sundial(c, x0, y0, l, t, lights) { // a stone sundial whose shadow turns: 1 a ring of flowers; 2 a gold dial
      const cx = x0 + 8, by = y0 + 15, st = l.stage || 0;
      rect(c, 'ink', cx - 4, by - 9, 8, 9); rect(c, 'stone', cx - 3, by - 8, 6, 8); rect(c, 'stone3', cx - 3, by - 8, 2, 8); rect(c, 'ink', cx - 5, by - 1, 10, 1);
      rect(c, 'ink', cx - 7, by - 13, 14, 5); rect(c, st >= 2 ? 'gold' : 'stone3', cx - 6, by - 12, 12, 3);
      const a = t * 0.4; for (let r = 1; r <= 5; r++) px(c, 'stone2', cx + Math.round(Math.cos(a) * r), by - 11 + Math.round(Math.sin(a) * r * 0.3));
      rect(c, 'ink', cx - 1, by - 16, 1, 4); px(c, 'ink', cx, by - 14);
      if (st >= 1) for (let i = 0; i < 8; i++) { const fa = (i / 8) * Math.PI * 2, fx = cx + Math.round(Math.cos(fa) * 7), fy = by - 1 + Math.round(Math.sin(fa) * 2); px(c, 'moss2', fx, fy + 1); px(c, ['rose', 'gold', 'white', 'plum'][i % 4], fx, fy); }
    },
    totem(c, x0, y0, l, t, lights) { // a carved pole of faces with wings on top: 1 painted; 2 eyes that glow at night; 3 ribbons
      const cx = x0 + 8, by = y0 + 15, st = l.stage || 0;
      const P = st >= 1 ? [['ember', 'ember2'], ['teal', 'teal2'], ['gold', 'gold2']] : [['wood3', 'wood'], ['wood', 'wood2'], ['wood3', 'wood']];
      for (let k = 0; k < 3; k++) {
        const y = by - 10 - k * 10, [a, b] = P[k];
        rect(c, 'ink', cx - 5, y - 1, 10, 11); rect(c, a, cx - 4, y, 8, 10); rect(c, b, cx + 2, y, 2, 10);
        rect(c, st >= 2 ? 'lanternhi' : 'ink', cx - 3, y + 3, 2, 2); rect(c, st >= 2 ? 'lanternhi' : 'ink', cx + 1, y + 3, 2, 2);
        rect(c, 'ink', cx - 2, y + 7, 4, 1); if (k === 1) rect(c, 'ink', cx - 1, y + 5, 2, 2);
      }
      if (st >= 2) glow(lights, cx, by - 22, 14);
      const wy = by - 34;
      rect(c, 'ink', cx - 12, wy - 1, 24, 4); rect(c, st >= 1 ? 'sea3' : 'wood3', cx - 11, wy, 22, 2); px(c, 'ink', cx - 12, wy - 2); px(c, 'ink', cx + 11, wy - 2);
      rect(c, 'ink', cx - 3, wy - 5, 6, 5); rect(c, st >= 1 ? 'ember' : 'wood', cx - 2, wy - 4, 4, 4);
      if (st >= 3) for (let i = 0; i < 2; i++) { const s = i ? 1 : -1; for (let k = 0; k < 7; k++) px(c, i ? 'rose' : 'gold', cx + s * (12 + Math.round(Math.sin(t * 3 + k * 0.6) * 1)), wy + 2 + k); }
    },
  };
  function drawLandmark(c, l, t, lights) {
    const fn = LANDMARK_DRAW[l.type];
    if (fn) fn(c, l.tileX * T, l.tileY * T, l, t, lights);
    if ((l.stage || 0) >= 4 && l.type !== 'clearing') landmarkDressing(c, l, t, lights);
  }
  // Stages 4-6 of any landmark: it has become a proper place of the village. 4: a banner on a pole;
  // 5: lanterns on both sides; 6: a rope fence with posts in front (a site people visit).
  function landmarkDressing(c, l, t, lights) {
    const s = LH.map.LANDMARKS[l.type];
    const x0 = l.tileX * T, w = Math.max(1, s.w) * T, by = (l.tileY + Math.max(1, s.h)) * T;
    const wave = Math.round(Math.sin(t * 3 + l.tileX) * 1);
    rect(c, 'ink', x0 - 5, by - 26, 2, 26); rect(c, 'wood2', x0 - 5, by - 26, 1, 26);
    for (let i = 0; i < 7; i++) rect(c, i % 2 ? 'gold' : 'ember', x0 - 3 + i, by - 25 + (i > 3 ? wave : 0), 1, 6);
    if ((l.stage || 0) >= 5) for (const lx of [x0 - 9, x0 + w + 4]) { rect(c, 'ink', lx, by - 14, 1, 14); rect(c, 'lantern', lx - 1, by - 16, 3, 3); glow(lights, lx, by - 15, 12); }
    if ((l.stage || 0) >= 6) {
      for (let x = x0 - 2; x <= x0 + w + 2; x += 8) { rect(c, 'wood2', x, by - 1, 2, 6); }
      for (let x = x0 - 2; x < x0 + w + 2; x++) px(c, 'sand2', x, by + 1 + Math.round(Math.sin((x - x0) / 8 * Math.PI) * 1));
    }
  }
  function drawStump(c, x, y) {
    rect(c, 'ink', x - 3, y - 4, 7, 4); rect(c, 'wood', x - 2, y - 3, 5, 3); rect(c, 'wood3', x - 2, y - 4, 5, 1); px(c, 'wood2', x, y - 4);
  }

  // One follower's tent (base centre x, y). k picks the cloth colour and details; every 9th tent has a
  // small campfire in front that glows at night.
  const TENT_CLOTH = [['cream', 'sand2'], ['ember', 'ember2'], ['sea2', 'sea'], ['moss', 'moss2'], ['gold', 'gold2'], ['teal', 'teal2'], ['plum', 'plum2'], ['wood3', 'wood'], ['rose', 'rose2'], ['white', 'stone3']];
  // lit (world.story.tentLights, 2026-11-11, a viewer's idea): a small lantern on a pole beside every tent
  // without a campfire, glowing at dusk and night
  function drawTent(c, x, y, k, t, lights, lit) {
    const [a, b] = TENT_CLOTH[C.hashStr('tent' + k) % TENT_CLOTH.length];
    x = Math.round(x); y = Math.round(y);
    for (let r = 0; r < 8; r++) {
      const half = Math.floor(r * 0.75) + 1;
      rect(c, 'ink', x - half - 1, y - 8 + r, half * 2 + 3, 1);
      rect(c, a, x - half, y - 8 + r, half, 1);
      rect(c, b, x + 1, y - 8 + r, half, 1);
    }
    rect(c, 'ink', x - 1, y - 4, 3, 4); // open flap
    px(c, 'wood2', x, y - 9);
    if (k % 9 === 4) {
      const f = Math.floor(t * 8 + k) % 2;
      rect(c, 'wood2', x + 6, y - 1, 4, 1);
      px(c, f ? 'lantern' : 'gold', x + 7, y - 2); px(c, f ? 'gold' : 'lantern', x + 8, y - 3 + f);
      if (lights) lights.push({ x: x + 8, y: y - 2, r: 10, kind: 'lamp' });
    } else if (lit) {
      const lx = x + (k % 2 ? 7 : -7), sw = Math.round(Math.sin(t * 1.7 + k) * 0.4);
      rect(c, 'wood2', lx, y - 9, 1, 9);
      rect(c, 'ink', lx - 1 + sw, y - 12, 3, 3); px(c, Math.floor(t * 3 + k) % 7 ? 'lantern' : 'lanternhi', lx + sw, y - 11);
      if (lights) lights.push({ x: lx + 0.5, y: y - 11, r: 9, kind: 'lamp' });
    }
  }

  function drawShip(c, planks, x, y, t) {
    const st = map.shipStage(planks);
    const L = 104;
    // cradle and rails
    rect(c, 'sand3', x - 6, y + 2, L + 12, 2); rect(c, 'wood2', x - 6, y + 2, L + 12, 1);
    for (let i = 0; i < 6; i++) { const bx = x + 8 + i * 17; rect(c, 'ink', bx - 1, y - 5, 7, 7); rect(c, 'wood', bx, y - 4, 5, 5); rect(c, 'wood3', bx, y - 4, 5, 1); }
    if (st.index === 0) return;
    const full = (i) => (st.index > i ? 1 : st.index === i ? st.progress : 0);
    const u = (xx) => (xx - x) / L;
    const bottom = (xx) => y - 5 - 6 * Math.pow(Math.abs(2 * u(xx) - 1), 3) - 16 * C.smooth(0.82, 1.02, u(xx));
    const top = (xx) => y - 30 - 4 * Math.pow(Math.abs(2 * u(xx) - 1), 2) - 3 * C.smooth(0.8, 1, u(xx));
    // keel + posts
    rect(c, 'ink', x - 1, y - 8, L + 2, 4); rect(c, 'wood2', x, y - 7, L, 2);
    rect(c, 'ink', x - 1, y - 34, 4, 28); rect(c, 'wood2', x, y - 33, 2, 26); // sternpost
    // stem: follows the bow curve
    for (let xx = x + L - 18; xx <= x + L + 2; xx++) { const yy = Math.round(bottom(Math.min(xx, x + L - 3))); px(c, 'ink', xx, yy - 1); px(c, 'wood2', xx, yy); px(c, 'wood2', xx, yy + 1); px(c, 'ink', xx, yy + 2); }
    for (let yy = Math.round(top(x + L - 2)); yy < bottom(x + L - 3); yy++) { px(c, 'ink', x + L + 1, yy); px(c, 'wood2', x + L + 2, yy); px(c, 'ink', x + L + 3, yy); }
    // ribs
    const ribs = st.index > 2 ? 12 : st.index === 2 ? 2 + Math.floor(st.progress * 10) : 0;
    for (let i = 0; i < ribs; i++) {
      const xx = x + 8 + Math.round(i * (L - 22) / 11);
      const b = bottom(xx), tp = top(xx);
      rect(c, 'ink', xx - 1, tp - 1, 4, b - tp + 2);
      rect(c, 'wood', xx, tp, 2, b - tp); px(c, 'wood3', xx, tp);
    }
    // ribbands: thin battens along the hull so the skeleton reads as a boat
    if (st.index === 2 && ribs >= 4) {
      const last = x + 8 + Math.round((ribs - 1) * (L - 22) / 11);
      for (const k of [0, 0.45]) for (let xx = x + 2; xx <= Math.max(last + 2, x + L * 0.3); xx++) {
        const yy = Math.round(top(xx) + (bottom(xx) - top(xx)) * k);
        px(c, 'ink', xx, yy); px(c, 'wood3', xx, yy + 1);
      }
    }
    // hull planking from the keel up
    const hp = full(3);
    if (hp > 0) {
      for (let xx = x + 2; xx < x + L - 2; xx++) {
        const b = bottom(xx), tp = top(xx);
        const fillTo = b - (b - tp) * hp;
        for (let yy = Math.ceil(fillTo); yy < b; yy++) px(c, Math.floor((b - yy) / 3) % 2 ? 'wood3' : 'wood', xx, yy);
        px(c, 'ink', xx, Math.ceil(fillTo) - 1); px(c, 'ink', xx, Math.round(b));
        if (hp >= 1) px(c, 'wood2', xx, Math.round(tp) + 2);
      }
      if (hp >= 1) for (let i = 0; i < 4; i++) { const px0 = x + 26 + i * 16; rect(c, 'ink', px0 - 1, top(px0) + 6, 5, 5); rect(c, 'night', px0, top(px0) + 7, 3, 3); }
    }
    // deck rail
    const dp = full(4);
    if (dp > 0) for (let xx = x + 2; xx < x + 2 + (L - 4) * dp; xx++) { px(c, 'ink', xx, Math.round(top(xx)) - 1); px(c, 'wood2', xx, Math.round(top(xx))); if ((xx - x) % 7 === 0) rect(c, 'wood2', xx, top(xx) - 4, 1, 4), px(c, 'ink', xx, top(xx) - 5); }
    // mast
    const mp = full(5);
    const mx = x + 48, mTop = top(mx) - 8 - 56 * mp;
    if (mp > 0) {
      rect(c, 'ink', mx - 2, mTop - 1, 5, top(mx) - mTop + 1); rect(c, 'wood2', mx - 1, mTop, 3, top(mx) - mTop); rect(c, 'wood', mx - 1, mTop, 1, top(mx) - mTop);
      if (mp >= 1) for (const yy of [mTop + 6, mTop + 26]) { rect(c, 'ink', mx - 20, yy - 1, 41, 3); rect(c, 'wood2', mx - 19, yy, 39, 1); }
    }
    // sails
    const sp = full(6);
    if (sp > 0) {
      const n = sp >= 1 ? 2 : sp > 0.5 ? 2 : 1;
      for (let s = 0; s < n; s++) {
        const y0 = mTop + 7 + s * 20, h = s === 0 ? 18 : 22;
        const billow = Math.sin(t * 1.1 + s) * 1.2;
        for (let yy = 0; yy < h; yy++) {
          const bulge = Math.round(Math.sin((yy / h) * Math.PI) * (2.5 + billow));
          rect(c, 'ink', mx - 19 - bulge, y0 + yy, 39 + bulge * 2, 1);
          rect(c, yy % 6 === 5 ? 'sand' : 'cream', mx - 18 - bulge, y0 + yy, 37 + bulge * 2, 1);
        }
      }
    }
    // flag
    if (full(7) > 0) {
      const f = Math.floor(t * 4) % 2;
      rect(c, 'ink', mx, mTop - 12, 1, 12);
      for (let i = 0; i < 10; i++) rect(c, i < 5 ? 'ember' : 'ember2', mx + 1 + i, mTop - 12 + (f && i > 4 ? 1 : 0), 1, 5 - Math.floor(i / 4));
    }
    // a ladder while building
    if (st.index >= 2 && st.index < 6) { for (let i = 0; i < 20; i++) { px(c, 'wood2', x + L - 30 + Math.floor(i / 3), y - 4 - i); px(c, 'wood2', x + L - 25 + Math.floor(i / 3), y - 4 - i); if (i % 4 === 0) rect(c, 'wood2', x + L - 30 + Math.floor(i / 3), y - 4 - i, 6, 1); } }
  }

  function drawGull(c, x, y, f) {
    if (f) { px(c, 'white', x - 2, y); px(c, 'white', x - 1, y - 1); px(c, 'stone3', x, y); px(c, 'white', x + 1, y - 1); px(c, 'white', x + 2, y); }
    else { px(c, 'white', x - 2, y - 1); px(c, 'white', x - 1, y); px(c, 'stone3', x, y); px(c, 'white', x + 1, y); px(c, 'white', x + 2, y - 1); }
  }

  // ---------------------------------------------------------------- fog wall
  // fast (website): the fog's noise is worked out once per 2x2 block (4x fewer noise calls; the
  // pixel-art dithering stays per pixel). Episodes use the exact per-pixel version.
  function drawFog(c, x0, y0, w, h, t, fast) {
    const fogTop = map.FOG_Y * T;
    const maxEdge = fogTop + 30;
    if (y0 > maxEdge + 50) return;
    const rows = Math.min(h, Math.ceil(maxEdge + 50 - y0));
    if (rows <= 0) return;
    const F2 = rgb('fog2'), F = rgb('fog'), F3 = rgb('fog3'), WH = rgb('white');
    const noiseAt = (wx, wy) => C.vnoise(wx * 0.03 + t * 0.22, wy * 0.05, 5) * 0.6 + C.vnoise(wx * 0.09 - t * 0.17, wy * 0.12 + t * 0.05, 6) * 0.4;
    if (fast) return drawFogHalf(c, x0, y0, w, rows, t, fogTop, noiseAt, [F2, F, F3, WH]);
    const img = c.getImageData(0, 0, w, rows);
    const d = img.data;
    for (let xi = 0; xi < w; xi++) {
      const wx = x0 + xi;
      const edge = fogTop + 12 * Math.sin(wx * 0.021 + t * 0.12) + 7 * Math.sin(wx * 0.057 - t * 0.21) + 6 * C.vnoise(wx * 0.05 + t * 0.3, t * 0.1, 4);
      for (let yi = 0; yi < rows; yi++) {
        const wy = y0 + yi;
        const below = wy - edge;
        if (below >= 40) break; // nothing below the wall's ragged edge in this column
        const n = noiseAt(wx, wy);
        let a;
        if (below < -26) a = 1;
        else if (below < 0) a = bayer(wx, wy) < (-below / 26) * 0.85 + 0.15 ? 1 : 0;
        else if (below < 40) a = n > 0.56 && bayer(wx, wy) < 0.45 * (1 - below / 40) ? 0.85 : 0;
        else a = 0;
        if (!a) continue;
        const deep = Math.min(1, Math.max(0, (-below - 26) / 140)); // whiter further into the wall
        const m = n + deep * 0.25;
        const cc = m > 0.56 ? WH : m > 0.3 ? F2 : below > -34 && m < 0.22 ? F3 : F;
        const o = (yi * w + xi) * 4;
        d[o] = d[o] * (1 - a) + cc[0] * a; d[o + 1] = d[o + 1] * (1 - a) + cc[1] * a; d[o + 2] = d[o + 2] * (1 - a) + cc[2] * a;
      }
    }
    c.putImageData(img, 0, 0);
  }
  // The same fog at half resolution (website): every value is worked out for 2x2 pixels at once into
  // a small see-through layer, which is then stretched over the scene (a quarter of the work).
  let fogLayer = null;
  function drawFogHalf(c, x0, y0, w, rows, t, fogTop, noiseAt, [F2, F, F3, WH]) {
    const w2 = Math.ceil(w / 2) + 1, r2 = Math.ceil(rows / 2) + 1, ox = x0 & 1, oy = y0 & 1; // even world pixels
    if (!fogLayer || fogLayer.width !== w2 || fogLayer.height !== r2) fogLayer = canvas(w2, r2);
    const g = fogLayer.getContext('2d');
    const img = g.createImageData(w2, r2), d = img.data;
    for (let xi = 0; xi < w2; xi++) {
      const wx = x0 - ox + xi * 2;
      const edge = fogTop + 12 * Math.sin(wx * 0.021 + t * 0.12) + 7 * Math.sin(wx * 0.057 - t * 0.21) + 6 * C.vnoise(wx * 0.05 + t * 0.3, t * 0.1, 4);
      for (let yi = 0; yi < r2; yi++) {
        const wy = y0 - oy + yi * 2, below = wy - edge;
        if (below >= 40) break;
        const n = noiseAt(wx, wy);
        let a;
        if (below < -26) a = 1;
        else if (below < 0) a = bayer(wx >> 1, wy >> 1) < (-below / 26) * 0.85 + 0.15 ? 1 : 0;
        else a = n > 0.56 && bayer(wx >> 1, wy >> 1) < 0.45 * (1 - below / 40) ? 0.85 : 0;
        if (!a) continue;
        const m = n + Math.min(1, Math.max(0, (-below - 26) / 140)) * 0.25;
        const cc = m > 0.56 ? WH : m > 0.3 ? F2 : below > -34 && m < 0.22 ? F3 : F;
        const o = (yi * w2 + xi) * 4;
        d[o] = cc[0]; d[o + 1] = cc[1]; d[o + 2] = cc[2]; d[o + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(fogLayer, -ox, -oy, w2 * 2, r2 * 2);
  }

  // ---------------------------------------------------------------- the scene
  let buf = null;

  // Is there a tree on tile (tx, ty)? { x, y, kind } (base pixel), { stump } inside a clearing, or null.
  function treeAt(tx, ty, busy, cleared, districts) {
    if (busy.has(tx + ',' + ty)) return null;
    const g = map.ground(tx, ty, districts);
    if (g !== 'grass' && g !== 'darkgrass' && g !== 'rockgrass') return null;
    if (ty < map.coastY(tx) + 3) return null;
    if (map.RESERVED.some((r) => tx >= r[0] - 1 && tx <= r[2] + 1 && ty >= r[1] - 1 && ty <= r[3] + 1)) return null;
    const dist = map.biomeAt(tx, ty, districts);
    // natural woods (2026-11-10, user: the forest was an even grid of pines): the density follows smooth
    // noise, so trees stand in thick groves with glades between them, thinning out towards the edge of
    // the forest; each tree sits anywhere in its tile, and the forest mixes in some round trees
    const n = C.vnoise(tx / 6, ty / 6, 14) * 0.7 + C.vnoise(tx / 2.2, ty / 2.2, 15) * 0.3;
    const dens = dist === 'forest' ? Math.max(0, Math.min(0.85, (n - 0.18) * 1.25)) : dist === 'cliffs' || dist === 'lighthouse' ? 0.06 : 0.04 + Math.max(0, n - 0.55) * 0.5;
    if (C.h2(tx, ty, 11) >= dens) return null;
    const kind = dist === 'forest' ? (C.h2(tx, ty, 12) < 0.82 || n > 0.7 ? 'pine' : 'round') : dist === 'cliffs' || dist === 'fogbeach' || C.h2(tx, ty, 12) < 0.3 ? 'pine' : 'round';
    const x = tx * T + 8 + Math.round((C.h2(tx, ty, 13) - 0.5) * 12), y = ty * T + 10 + Math.round(C.h2(tx, ty, 16) * 8);
    return cleared.has(tx + ',' + ty) ? { x, y, stump: true } : { x, y, kind };
  }
  const TREE_PAD = 48; // tree pieces reach this far above their tiles (tall pines)

  // Website ground cache (renderWorld o.fast): the land never changes for a given world, so it is
  // drawn once into 32x32-tile pieces (with every home's paths and plots, not only the ones on
  // screen), plus a list of the water tiles in each piece, which are still drawn every frame.
  const groundCaches = new WeakMap();
  // Winding lanes (2026-11-10, user: roads were straight lines on a grid). Roads and footpaths stay on
  // the same tiles (walking and placement are unchanged) but each path tile is drawn as a narrower band
  // that wanders a little and changes width, joined to its neighbours, with a soft ragged edge; every
  // door gets its own short path down to the lane. Tiles are composed once and cached.
  const LANES = ['path', 'road', 'footpath', 'footpath-dark', 'stonepath', 'stonepath-dark'];
  const laneCache = new Map(), pixCache = new Map(), spurCache = new WeakMap();
  function tilePixels(type, variant) {
    const k = type + '|' + variant;
    let d = pixCache.get(k);
    if (!d) { d = tileCanvas(type, variant).getContext('2d').getImageData(0, 0, T, T).data; pixCache.set(k, d); }
    return d;
  }
  // door paths: for each tile, the doors whose path crosses it ({x, y0}: door x, house front y)
  function doorSpurs(world) {
    let m = spurCache.get(world.villagers);
    if (m) return m;
    m = new Map();
    const put = (tx, ty, sp) => { const k = tx + ',' + ty; if (!m.has(k)) m.set(k, []); m.get(k).push(sp); };
    for (const v of worldIndex(world).housed) {
      const L = map.homeLayout(v.home), hx = v.home.tileX, hy = v.home.tileY;
      const x = (hx + 1) * T + L.dx + L.door * 8, y0 = hy * T + 30 + L.dy;
      const sp = { x, y0, s: C.h2(hx, hy, 91) * 6.28 };
      // where the door path ends: the lane in front, or the road one row further down when no lane
      // may run in front (map.frontPathOK)
      const dt = Math.floor(x / T), toRoad = !map.frontPathOK(dt, hy + 2) && map.isRoad(dt, hy + 3);
      for (const tx of new Set([Math.floor((x - 5) / T), dt, Math.floor((x + 5) / T)])) { put(tx, hy + 1, sp); put(tx, hy + 2, sp); if (toRoad) put(tx, hy + 3, sp); }
    }
    spurCache.set(world.villagers, m);
    return m;
  }
  const isRoadLane = (g) => g === 'path' || g === 'road';
  // centre line of a horizontal lane in tile row ty at world x (and of a vertical one in column tx at y)
  const laneMidY = (wx, ty, road) => ty * T + 8 + (road ? 1.6 : 2.8) * Math.sin(wx * 0.09 + ty * 1.7) + (road ? 0.6 : 1) * Math.sin(wx * 0.27 + ty * 0.6);
  const laneMidX = (wy, tx, road) => tx * T + 8 + (road ? 1.6 : 2.8) * Math.sin(wy * 0.09 + tx * 1.3) + (road ? 0.6 : 1) * Math.sin(wy * 0.23 + tx * 0.8);
  const laneHalf = (w, k, road) => (road ? 5.2 : 3.6) + (road ? 0.8 : 0.9) * Math.sin(w * 0.15 + k * 2.1);
  const spurTile = (world, g, base, tx, ty) => laneTile(world, g, base, tx, ty, null);
  function laneTile(world, g, base, tx, ty, gAt) {
    const only = !gAt; // a grass tile that only a door path crosses
    const lane = (x, y) => !only && LANES.includes(gAt(x, y));
    const nL = lane(tx - 1, ty), nR = lane(tx + 1, ty), nU = lane(tx, ty - 1), nD = lane(tx, ty + 1);
    const spurs = doorSpurs(world).get(tx + ',' + ty) || [];
    const variant = Math.floor(C.h2(tx, ty, 1) * 4);
    const key = tx + ',' + ty + '|' + g + '|' + base + '|' + (+only) + (+nL) + (+nR) + (+nU) + (+nD) + '|' + spurs.map((p) => p.x + ':' + p.y0).join(',');
    let cv = laneCache.get(key);
    if (cv) return cv;
    const road = isRoadLane(g);
    const P = tilePixels(g, variant), G = tilePixels(base, variant);
    cv = canvas(T, T);
    const ctx = cv.getContext('2d'), img = ctx.createImageData(T, T), o = img.data;
    const horiz = nL || nR || !(nU || nD), vert = nU || nD;
    const strip = g.startsWith('footpath') || g.startsWith('stonepath');
    for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
      const wx = tx * T + lx + 0.5, wy = ty * T + ly + 0.5;
      let d = -Infinity; // how far inside the lane this pixel is (px), > 0 = on the lane
      if (!only && horiz) {
        const my = laneMidY(wx, ty, road), hw = laneHalf(wx, ty, road);
        let dd = hw - Math.abs(wy - my);
        const cx = vert ? laneMidX(wy, tx, road) : tx * T + 8;
        if (!nL && wx < cx) dd = Math.min(dd, hw - (cx - wx)); // rounded end on the left
        if (!nR && wx > cx) dd = Math.min(dd, hw - (wx - cx));
        d = Math.max(d, dd);
      }
      if (!only && vert) {
        const mx = laneMidX(wy, tx, road), hw = laneHalf(wy, tx, road);
        let dd = hw - Math.abs(wx - mx);
        const cy = horiz ? laneMidY(wx, ty, road) : ty * T + 8;
        if (!nU && wy < cy) dd = Math.min(dd, hw - (cy - wy));
        if (!nD && wy > cy) dd = Math.min(dd, hw - (wy - cy));
        d = Math.max(d, dd);
      }
      for (const sp of spurs) { // a door's own path, from the house front down to the lane, wandering
        const end = only ? Infinity : laneMidY(sp.x, ty, road);
        if (wy < sp.y0 - 1 || wy > end) continue;
        const k = wy - sp.y0, cx = sp.x + 2.2 * Math.sin(k * 0.22 + sp.s) * Math.min(1, k / 6);
        d = Math.max(d, 2.3 + 0.6 * Math.sin(wy * 0.37 + sp.s) - Math.abs(wx - cx));
      }
      const rag = (C.h2(Math.floor(wx), Math.floor(wy), 47) - 0.5) * 1.4;
      const on = d + rag > 0;
      // footpath and flagstone tiles only hold the path in their middle rows (7-11): sample those, so
      // a lane that wanders up or down, or a door path, is path all the way
      const i = (ly * T + lx) * 4, j = strip ? ((7 + (((ly - 7) % 5) + 5) % 5) * T + lx) * 4 : i;
      if (on) { o[i] = P[j]; o[i + 1] = P[j + 1]; o[i + 2] = P[j + 2]; } else { o[i] = G[i]; o[i + 1] = G[i + 1]; o[i + 2] = G[i + 2]; }
      o[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    laneCache.set(key, cv);
    return cv;
  }

  // Soft borders between kinds of land (2026-11-10): where grass, forest grass, rocky grass and sand
  // meet, each tile lets the other kind creep in for a few pixels in ragged clumps, so areas run into
  // each other instead of meeting on a straight tile edge. Composed once per tile and cached.
  const BLEND = ['grass', 'darkgrass', 'rockgrass', 'sand', 'field'];
  const tileVariant = (g, x, y) => g === 'field' ? map.fieldKind(x, y) : Math.floor(C.h2(x, y, 1) * 4);
  const blendCache = new Map();
  function blendTile(g, tx, ty, gAt) {
    const nb = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([sx, sy]) => { const n = gAt(tx + sx, ty + sy); return BLEND.includes(n) && n !== g ? n : null; });
    if (!nb.some(Boolean)) return null;
    const variant = tileVariant(g, tx, ty);
    const key = tx + ',' + ty + '|' + g + '|' + variant + '|' + nb.join(',');
    let cv = blendCache.get(key);
    if (cv) return cv;
    const own = tilePixels(g, variant);
    const other = nb.map((n, i) => n && tilePixels(n, tileVariant(n, tx + [0, 0, -1, 1][i], ty + [-1, 1, 0, 0][i])));
    cv = canvas(T, T);
    const ctx = cv.getContext('2d'), img = ctx.createImageData(T, T), o = img.data;
    const reach = (n) => (n === 'sand' || g === 'sand' ? 7 : 9);
    for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
      const wx = tx * T + lx, wy = ty * T + ly;
      let src = own;
      const z = C.vnoise(wx / 2.6, wy / 2.6, 71) * 0.75 + C.h2(wx, wy, 72) * 0.25;
      let best = 0;
      nb.forEach((n, i) => {
        if (!n) return;
        const dist = [ly, T - 1 - ly, lx, T - 1 - lx][i] + 0.5;
        const pull = 0.55 - dist / reach(n);
        if (pull > best && z < pull) { best = pull; src = other[i]; }
      });
      const k = (ly * T + lx) * 4;
      o[k] = src[k]; o[k + 1] = src[k + 1]; o[k + 2] = src[k + 2]; o[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    blendCache.set(key, cv);
    return cv;
  }

  // A ragged coastline (2026-11-10): on a water tile next to the beach the sand creeps in for a few
  // pixels in uneven clumps (rounder in the inside corners), with a line of foam along it, so the coast
  // is no longer a staircase of tiles. Drawn over the water; cached per tile.
  const shoreCache = new Map();
  function shoreTile(tx, ty, gAt) {
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const sand = dirs.map(([sx, sy]) => gAt(tx + sx, ty + sy) === 'sand');
    if (!sand.some(Boolean)) return null;
    const key = tx + ',' + ty + '|' + sand.map((b) => +b).join('');
    if (shoreCache.has(key)) return shoreCache.get(key);
    const S = tilePixels('sand', Math.floor(C.h2(tx, ty, 1) * 4));
    const on = new Uint8Array(T * T);
    for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
      const wx = tx * T + lx, wy = ty * T + ly;
      const z = C.vnoise(wx / 3.2, wy / 3.2, 81) * 0.8 + C.h2(wx, wy, 82) * 0.2;
      let pull = -1;
      dirs.forEach(([sx, sy], i) => {
        if (!sand[i]) return;
        const ex = sx < 0 ? lx + 0.5 : sx > 0 ? T - 0.5 - lx : 0, ey = sy < 0 ? ly + 0.5 : sy > 0 ? T - 0.5 - ly : 0;
        const dist = sx && sy ? Math.hypot(ex, ey) : ex + ey;
        pull = Math.max(pull, (sx && sy ? 0.42 : 0.6) - dist / 10);
      });
      // inside corners (sand on two sides) fill in further, so the coast rounds off
      if ((sand[0] || sand[1]) && (sand[2] || sand[3])) pull += 0.12;
      if (z < pull) on[ly * T + lx] = 1;
    }
    let cv = null;
    if (on.some(Boolean)) {
      cv = canvas(T, T);
      const ctx = cv.getContext('2d'), img = ctx.createImageData(T, T), o = img.data;
      const FOAM = [236, 244, 240];
      for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
        const i = ly * T + lx, k = i * 4;
        if (on[i]) { o[k] = S[k]; o[k + 1] = S[k + 1]; o[k + 2] = S[k + 2]; o[k + 3] = 255; continue; }
        const near = (lx > 0 && on[i - 1]) || (lx < T - 1 && on[i + 1]) || (ly > 0 && on[i - T]) || (ly < T - 1 && on[i + T]);
        if (near) { o[k] = FOAM[0]; o[k + 1] = FOAM[1]; o[k + 2] = FOAM[2]; o[k + 3] = 150; }
      }
      ctx.putImageData(img, 0, 0);
    }
    shoreCache.set(key, cv);
    return cv;
  }

  function groundCacheFor(world, districts, openDistricts, makeGroundAt, landTile) {
    let gc = groundCaches.get(world);
    if (gc) return gc;
    const paths = new Set(), busy = new Set();
    const mark = (s, x, y) => s.add(x + ',' + y);
    const { occupied, housed } = worldIndex(world);
    for (const v of housed) {
      const hx = v.home.tileX, hy = v.home.tileY;
      for (let dx = -1; dx < 4; dx++) for (let dy = -1; dy < 4; dy++) mark(busy, hx + dx, hy + dy);
    }
    for (const k of map.homePaths(world)) paths.add(k); // the footpath network (map.homePaths)
    for (const b of world.buildings || []) for (let dx = -1; dx < (b.w || 2) + 1; dx++) for (let dy = -1; dy < (b.h || 2) + 1; dy++) mark(busy, b.tileX + dx, b.tileY + dy);
    for (const p of world.props || []) if (p.by != null) mark(busy, Math.floor(p.x), Math.floor(p.y));
    const cleared = new Set();
    for (const l of world.landmarks || []) {
      const s = map.LANDMARKS[l.type];
      if (!s) continue;
      if (l.type === 'clearing') {
        const r = map.clearingRadius(l);
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) if (dx * dx + dy * dy <= r * r) mark(cleared, l.tileX + dx, l.tileY + dy);
        mark(busy, l.tileX, l.tileY);
      } else for (let dx = -1; dx <= s.w; dx++) for (let dy = -1; dy <= s.h; dy++) mark(busy, l.tileX + dx, l.tileY + dy);
    }
    // the commons (wells, gardens) that get decorated near homes keep trees away too
    const { near } = worldIndex(world);
    const seen = new Set();
    for (const v of housed) for (let ty = v.home.tileY - 8; ty <= v.home.tileY + 8; ty++) for (let tx = v.home.tileX - 8; tx <= v.home.tileX + 8; tx++) {
      const k = tx + ',' + ty;
      if (seen.has(k)) continue;
      seen.add(k);
      if (map.isCommon(tx, ty) && near(tx, ty) && map.commonFree(world, tx, ty)) for (let dx = -1; dx < 4; dx++) for (let dy = -1; dy < 4; dy++) mark(busy, tx + dx, ty + dy);
    }
    const gAt = makeGroundAt(paths, busy);
    const N = 32, pieces = new Map(), treePieces = new Map();
    gc = {
      // the trees of a piece, drawn once (no sway), reaching TREE_PAD pixels above it; null if none
      trees(cx, cy, districts) {
        const k = cx + ',' + cy;
        if (treePieces.has(k)) return treePieces.get(k);
        let cv = null, g2 = null;
        for (let ty = cy * N; ty < (cy + 1) * N; ty++) for (let tx = cx * N; tx < (cx + 1) * N; tx++) {
          const tr = treeAt(tx, ty, busy, cleared, districts);
          if (!tr) continue;
          if (!cv) { cv = canvas(N * T, N * T + TREE_PAD); g2 = cv.getContext('2d'); g2.translate(-cx * N * T, -cy * N * T + TREE_PAD); }
          if (tr.stump) drawStump(g2, tr.x, tr.y); else drawTree(g2, tr.x, tr.y, tr.kind, tx * 31 + ty, 0);
        }
        treePieces.set(k, cv);
        return cv;
      },
      piece(cx, cy) {
        const k = cx + ',' + cy;
        let p = pieces.get(k);
        if (p) return p;
        const cv = canvas(N * T, N * T), g2 = cv.getContext('2d'), water = [];
        for (let ty = cy * N; ty < (cy + 1) * N; ty++) for (let tx = cx * N; tx < (cx + 1) * N; tx++) if (!landTile(g2, gAt, tx, ty, cx * N * T, cy * N * T)) { water.push([tx, ty]); const sh = shoreTile(tx, ty, gAt); if (sh) g2.drawImage(sh, tx * T - cx * N * T, ty * T - cy * N * T); }
        p = { canvas: cv, water };
        pieces.set(k, p);
        return p;
      },
    };
    groundCaches.set(world, gc);
    return gc;
  }

  // Per-world data that does not change between frames, built once per villager list:
  // occupied plots, villagers with a home, and near(tx, ty) = "a home within 8 tiles" (buckets of 9).
  const indexCache = new WeakMap();
  function worldIndex(world) {
    let ix = indexCache.get(world.villagers);
    if (ix) return ix;
    const occupied = new Set(), housed = [], buckets = new Map();
    for (const v of world.villagers) {
      if (!v.home || v.home.tileX == null) continue;
      const hx = v.home.tileX, hy = v.home.tileY;
      occupied.add(hx + ',' + hy);
      housed.push(v);
      const k = Math.floor(hx / 9) + ',' + Math.floor(hy / 9);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push([hx, hy]);
    }
    const near = (tx, ty) => {
      const bx = Math.floor(tx / 9), by = Math.floor(ty / 9);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const b = buckets.get((bx + i) + ',' + (by + j));
        if (b && b.some(([hx, hy]) => Math.abs(hx - tx) <= 8 && Math.abs(hy - ty) <= 8)) return true;
      }
      return false;
    };
    ix = { occupied, housed, near };
    indexCache.set(world.villagers, ix);
    return ix;
  }

  // opts: { world, cam: {x, y, z}, t, tod, planks?, hide?: Set of villager ids, cat?: [x, y] }
  // Returns { actors: [{ id, name, crew, x, y, headY, sx, sy, sHead }], toScreen(x, y) }.
  function renderWorld(ctx, o) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const { world, cam, t } = o;
    const tod = LH.TOD[o.tod || 'day'];
    const z = cam.z;
    const vw = W / z, vh = H / z;
    const x0 = cam.x - vw / 2, y0 = cam.y - vh / 2;
    const bx0 = Math.floor(x0), by0 = Math.floor(y0);
    const bw = Math.ceil(vw) + 2, bh = Math.ceil(vh) + 2;
    if (!buf || buf.width !== bw || buf.height !== bh) buf = canvas(bw, bh);
    const c = buf.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    rect(c, 'night', 0, 0, bw, bh);
    c.setTransform(1, 0, 0, 1, -bx0, -by0);

    const districts = world.districts || map.DISTRICTS;
    const openDistricts = map.unlocked(world);
    const tx0 = Math.floor(bx0 / T) - 1, tx1 = Math.floor((bx0 + bw) / T) + 1;
    const ty0 = Math.floor(by0 / T) - 1, ty1 = Math.floor((by0 + bh) / T) + 3;

    // occupied tiles (homes, fronts, buildings, commons) keep trees away; paths join the doors
    const busy = new Set();
    const paths = new Set();
    // village upgrades (map.UPGRADES): unlocked by the villager count, and each one only reaches as far
    // from the centre as the village has grown since (map.upgradeReach), so they spread outward
    const up = map.upgrades(world);
    const reach = {};
    for (const u of map.UPGRADES) reach[u.id] = map.upgradeReach(world, u.id);
    const has = (id, x, y) => map.upgradeCovers(reach[id], x, y);
    const homes = [];
    const mark = (set, x, y) => set.add(x + ',' + y);
    const { occupied, housed, near } = worldIndex(world);
    const yards = [];
    const plot = (hx, hy, home) => {
      for (let dx = -1; dx < 4; dx++) for (let dy = -1; dy < 4; dy++) mark(busy, hx + dx, hy + dy);
      if (!home) return;
      yards.push([hx, hy]);
    };
    for (const v of housed) {
      const hx = v.home.tileX, hy = v.home.tileY;
      if (hx < tx0 - 5 || hx > tx1 + 2 || hy < ty0 - 3 || hy > ty1 + 2) continue;
      plot(hx, hy, v);
      homes.push(v);
    }
    for (const k of map.homePaths(world)) paths.add(k); // the footpath network (map.homePaths)
    for (const b of world.buildings || []) for (let dx = -1; dx < (b.w || 2) + 1; dx++) for (let dy = -1; dy < (b.h || 2) + 1; dy++) mark(busy, b.tileX + dx, b.tileY + dy);
    // no tree grows on an object a viewer placed
    for (const p of world.props || []) if (p.by != null) mark(busy, Math.floor(p.x), Math.floor(p.y));
    // landmarks keep trees off their footprint (and a tile around it); a clearing turns the trees in
    // its circle into stumps
    const cleared = new Set();
    for (const l of world.landmarks || []) {
      const s = map.LANDMARKS[l.type];
      if (!s) continue;
      if (l.type === 'clearing') {
        const r = map.clearingRadius(l);
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) if (dx * dx + dy * dy <= r * r) mark(cleared, l.tileX + dx, l.tileY + dy);
        mark(busy, l.tileX, l.tileY);
      } else for (let dx = -1; dx <= s.w; dx++) for (let dy = -1; dy <= s.h; dy++) mark(busy, l.tileX + dx, l.tileY + dy);
    }
    const commons = [];
    for (let ty = ty0 - 3; ty <= ty1 + 2; ty++) for (let tx = tx0 - 3; tx <= tx1 + 1; tx++) {
      if (!map.isCommon(tx, ty) || !map.commonFree(world, tx, ty)) continue;
      if (!near(tx, ty)) continue;
      plot(tx, ty, false);
      commons.push([tx, ty]);
    }

    // ground
    const GRASSY = ['grass', 'darkgrass', 'rockgrass', 'field'];
    const makeGroundAt = (pathSet, busySet) => (tx, ty) => {
      const g = map.ground(tx, ty, districts);
      if (g === 'cobble' && !openDistricts.includes('market')) return map.isRoad(tx, ty) ? 'path' : 'grass'; // the high street runs on through the closed market
      if (g === 'path' && map.isRoad(tx, ty) && has('cobbles', tx, ty)) return 'road';
      if (GRASSY.includes(g) && pathSet.has(tx + ',' + ty)) return has('stonepaths', tx, ty) ? (g === 'darkgrass' ? 'stonepath-dark' : 'stonepath') : g === 'darkgrass' ? 'footpath-dark' : 'footpath';
      if (g === 'field' && busySet.has(tx + ',' + ty)) return 'grass';
      return g;
    };
    // one land tile (not water) with its soft edges, drawn into g2 (whose origin is world pixel ox, oy)
    const landTile = (g2, gAt, tx, ty, ox, oy) => {
      const g = gAt(tx, ty);
      if (g === 'sea' || g === 'shallow') return false;
      if (LANES.includes(g) || (GRASSY.includes(g) && g !== 'field' && doorSpurs(world).has(tx + ',' + ty))) {
        // winding lanes (laneTile): a lane tile, or a grass tile a door path crosses
        const isLane = LANES.includes(g);
        const base = isLane ? (g.endsWith('-dark') ? 'darkgrass' : 'grass') : g;
        const below = [gAt(tx, ty + 1), gAt(tx - 1, ty + 1), gAt(tx + 1, ty + 1), gAt(tx, ty + 2)].find((q) => LANES.includes(q) && !isRoadLane(q));
        const spurType = isLane ? g : below || (has('stonepaths', tx, ty) ? 'stonepath' : 'footpath');
        g2.drawImage(isLane ? laneTile(world, g, base, tx, ty, gAt) : spurTile(world, spurType, base, tx, ty), tx * T - ox, ty * T - oy);
        return true;
      }
      const soft = BLEND.includes(g) && blendTile(g, tx, ty, gAt);
      if (soft) { g2.drawImage(soft, tx * T - ox, ty * T - oy); return true; }
      g2.drawImage(tileCanvas(g, g === 'field' ? map.fieldKind(tx, ty) : Math.floor(C.h2(tx, ty, 1) * 4)), tx * T - ox, ty * T - oy);
      if (g === 'cobble') {
        // the market square is a rounded patch, not a rectangle (2026-11-10): grass outside a soft,
        // slightly ragged oval over the reserved area, with a few loose stones along the edge
        for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) {
          const wx = tx * T + xx + 0.5, wy = ty * T + yy + 0.5;
          const e = Math.abs((wx - 16) / 64) ** 2.6 + Math.abs((wy - 224) / 32) ** 2.6 + (C.h2(wx >> 1, wy >> 1, 61) - 0.5) * 0.14;
          if (e > 1) px(g2, C.h2(wx, wy, 62) < 0.12 ? 'moss' : 'grass', wx - 0.5 - ox, wy - 0.5 - oy);
          else if (e > 0.9 && C.h2(wx >> 1, wy >> 1, 63) < 0.25) px(g2, 'grass', wx - 0.5 - ox, wy - 0.5 - oy);
        }
        return true;
      }
      if (g !== 'path' && g !== 'field') return true;
      // soft grass edges where the path (or a field) meets grass; a field's edge is deeper and more
      // ragged, so fields read as patches of land, not tiles
      const deep = g === 'field' ? [0.9, 0.65, 0.4, 0.18, 0.06] : [0.75, 0.4, 0.12];
      for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const n = gAt(tx + sx, ty + sy);
        if (!GRASSY.includes(n) || (g === 'field' && n === 'field')) continue;
        const fill = n === 'darkgrass' ? 'moss' : 'grass';
        for (let i = 0; i < T; i++) for (let d = 0; d < deep.length; d++) {
          if (C.h2(tx * T + i, ty * T + d * 7 + sx * 3 + sy * 5, 41) > deep[d]) continue;
          const xx = sx === 0 ? i : sx < 0 ? d : T - 1 - d;
          const yy = sy === 0 ? i : sy < 0 ? d : T - 1 - d;
          px(g2, fill, tx * T + xx - ox, ty * T + yy - oy);
        }
      }
      return true;
    };
    if (o.fast) {
      // website: the land is drawn once per world into 32x32-tile pieces and reused every frame; only
      // the water (it moves) is drawn each frame
      const GC = groundCacheFor(world, districts, openDistricts, makeGroundAt, landTile);
      const CH = 32 * T;
      for (let cy = Math.floor(ty0 * T / CH); cy <= Math.floor((ty1 + 1) * T / CH); cy++) for (let cx = Math.floor(tx0 * T / CH); cx <= Math.floor((tx1 + 1) * T / CH); cx++) {
        const piece = GC.piece(cx, cy);
        for (const [wx, wy] of piece.water) if (wx >= tx0 && wx <= tx1 && wy >= ty0 && wy <= ty1) drawWater(c, wx, wy, t);
        c.drawImage(piece.canvas, cx * CH, cy * CH);
      }
    } else {
      const groundAt = makeGroundAt(paths, busy);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!landTile(c, groundAt, tx, ty, 0, 0)) { drawWater(c, tx, ty, t); const sh = shoreTile(tx, ty, groundAt); if (sh) c.drawImage(sh, tx * T, ty * T); }
    }

    // objects, painted back to front
    const objs = [];
    const lights = [];
    const add = (y, fn) => objs.push({ y, fn });
    for (const v of homes) add((v.home.tileY + 2) * T - 1 + map.homeLayout(v.home).dy, () => LH.bld.drawHome(c, v, districts, t, lights));
    // garden fences (map.UPGRADES 'fences', rebuilt 2026-11-10): not every home, about one in three, and
    // never across a path. A fenced home turns its side yard (right of the house) into a small flower or
    // vegetable bed with a picket fence round it, sized to the gap that is really free there: the house
    // and its neighbour are measured as drawn (roof, annex, signs, plaques), roads and their lamps and
    // viewers' objects are kept clear, and a home whose gap is too narrow simply gets no fence.
    // The 3 homes nearest the centre that have room always get one, so the unlock is visible straight
    // away (2026-11-10, user: start with 2-3 gardens, then spread outward as the village grows).
    const pens = [], fencedYard = new Set();
    if (up.has('fences')) {
      const all = worldIndex(world).housed;
      const homeAt = new Map(all.map((v) => [v.home.tileX + ',' + v.home.tileY, v]));
      const penFor = (v) => {
        const hx = v.home.tileX, hy = v.home.tileY;
        const yb = hy * T + 13, yf = hy * T + 29;
        const yd = LH.bld.yardOf(hx, hy, map.districtAt(hx + 1, hy + 1, districts));
        if (!['garden', 'bush', 'none', 'laundry', 'hay', 'tree'].includes(yd.k)) return null;
        const nb = homeAt.get((hx + 4) + ',' + hy);
        let x0 = homeExtent(v, districts)[1] + 3, x1 = (nb ? homeExtent(nb, districts)[0] : (hx + 4) * T + 1) - 3;
        for (let tx = hx + 2; tx <= hx + 4; tx++) for (const ty of [hy, hy + 1]) if (map.isRoad(tx, ty)) x1 = Math.min(x1, tx * T - 5);
        if (x1 - x0 > 24) { const m = (x0 + x1) >> 1; x0 = m - 12; x1 = m + 12; }
        if (x1 - x0 < 13) return null;
        if ((world.props || []).some((p) => p.y * T > yb - 6 && p.y * T < yf + 12 && p.x * T > x0 - 12 && p.x * T < x1 + 12)) return null;
        return { x0, x1, yb, yf, hx, hy, veg: yd.k === 'garden' || yd.k === 'hay' };
      };
      // the first ones: the 3 roomiest-enough homes nearest the centre (computed over the whole village,
      // not just what is in view, and cached per world state)
      const fkey = all.length + '|' + (world.props || []).length;
      let first = firstFences.get(world);
      if (!first || first.key !== fkey) {
        const [cx, cy] = map.UPGRADE_CENTRE;
        const byDist = all.slice().sort((p, q) => Math.hypot(p.home.tileX + 3 - cx, (p.home.tileY + 1 - cy) * 1.2) - Math.hypot(q.home.tileX + 3 - cx, (q.home.tileY + 1 - cy) * 1.2));
        const ids = new Set();
        for (const v of byDist) { if (ids.size >= 3) break; if (penFor(v)) ids.add(v.home.tileX + ',' + v.home.tileY); }
        first = { key: fkey, ids };
        firstFences.set(world, first);
      }
      for (const v of homes) {
        const hx = v.home.tileX, hy = v.home.tileY, id = hx + ',' + hy;
        if (!first.ids.has(id) && (C.h2(hx, hy, 913) >= 0.35 || !has('fences', hx + 3, hy + 1))) continue;
        const pen = penFor(v);
        if (!pen) continue;
        pens.push(pen);
        fencedYard.add(id);
      }
    }
    for (const [hx, hy] of yards) if (!fencedYard.has(hx + ',' + hy)) add(hy * T + 22, () => LH.bld.drawYard(c, hx, hy, map.districtAt(hx + 1, hy + 1, districts), t));
    if (openDistricts.includes('market') && bx0 < 5 * T + 40 && bx0 + bw > -3 * T - 40 && by0 < 16 * T + 20 && by0 + bh > 11 * T) LH.bld.marketSquare(add, c, t, lights);
    for (const [tx, ty] of commons) add(ty * T + 26, () => LH.bld.drawCommon(c, tx, ty, map.districtAt(tx + 1, ty + 1, districts), t, lights));
    for (const b of world.buildings || []) {
      const bx = b.tileX * T, by = b.tileY * T;
      if (bx < bx0 - 200 || bx > bx0 + bw + 200 || by < by0 - 120 || by > by0 + bh + 120) continue;
      if (b.type === 'lighthouse') add(by + 2 * T, () => drawLighthouse(c, bx + T, by + 2 * T, t, lights));
      else if (b.type === 'house') {
        const lay = { dx: 0, dy: 0, door: b.door || 0, seed: C.hashStr(b.id || b.type) };
        add(by + 2 * T - 1, () => LH.bld.drawBuilding(c, bx, by, LH.bld.spec(b.style || 'hut', b.kind || 'house', lay), t, lights, lay));
      }
    }
    const ship = world.ship || { planks: 0 };
    const planks = o.planks != null ? o.planks : ship.planks;
    if (ship.x != null) add(ship.y + 3, () => drawShip(c, planks, ship.x, ship.y, t));
    for (const p of world.props || []) {
      const fn = PROPS[p.type];
      if (!fn) throw new Error('unknown prop ' + p.type);
      const x = p.x * T, y = p.y * T;
      if (x < bx0 - 120 || x > bx0 + bw + 120 || y < by0 - 120 || y > by0 + bh + 140) continue;
      add(p.type === 'dock' ? y - (p.len || 4) * T : y, () => fn(c, x, y, p, t, lights, world));
    }
    // village upgrades (map.UPGRADES): street lamps and planters along the main roads, but only as far
    // as people live (so they spread as the village grows) (the garden fences are laid out above)
    if (up.size && housed.length) {
      let hx0 = Infinity, hx1 = -Infinity, hy1 = -Infinity;
      for (const v of housed) { hx0 = Math.min(hx0, v.home.tileX); hx1 = Math.max(hx1, v.home.tileX + 2); hy1 = Math.max(hy1, v.home.tileY + 2); }
      const inView = (x, y) => x >= bx0 - 40 && x <= bx0 + bw + 40 && y >= by0 - 20 && y <= by0 + bh + 60;
      const free = (tx, ty) => !busy.has(tx + ',' + ty) && !map.isRoad(tx, ty) && !map.RESERVED.some((r) => tx >= r[0] && tx <= r[2] && ty >= r[1] && ty <= r[3]);
      // lamps stand on the edge of the road itself (the verge is usually someone's garden): along the
      // south side of the coast road every 5 tiles, and both sides of the high street, alternating
      const doorAt = (tx, ty) => paths.has(tx + ',' + ty);
      if (up.has('lamps')) {
        const spots = [];
        for (let x = Math.max(-42, hx0 - 2); x <= Math.min(34, hx1 + 2); x++) if (((x % 5) + 5) % 5 === 3 && x !== 2 && !doorAt(x, 6) && has('lamps', x, 5)) spots.push([x * T + 8, 6 * T, x]);
        for (let y = 8; y <= Math.min(40, hy1 + 2); y += 4) if (has('lamps', 2, y)) spots.push([y % 8 ? 3 * T + 1 : 2 * T - 1, y * T + 10]);
        for (const [x, y] of spots) if (inView(x, y)) add(y, () => PROPS.lamppost(c, x, y, {}, t, lights));
      }
      if (up.has('planters')) {
        for (let y = 10; y <= Math.min(40, hy1 + 2); y += 4) {
          const x = y % 8 ? 2 * T - 6 : 3 * T + 6, yy = y * T + 8; // opposite the lamps
          if (!inView(x, yy) || !has('planters', 2, y)) continue;
          if ((y / 6 | 0) % 2) add(yy, () => PROPS.bench(c, x, yy));
          else add(yy, () => { rect(c, 'ink', x - 7, yy - 6, 14, 6); rect(c, 'wood', x - 6, yy - 5, 12, 4); rect(c, 'wood3', x - 6, yy - 5, 12, 1); for (let i = 0; i < 5; i++) { px(c, 'moss2', x - 5 + i * 2.5, yy - 7); px(c, ['rose', 'gold', 'white', 'plum', 'ember'][(i + y) % 5], x - 5 + i * 2.5, yy - 8); } });
        }
      }
      for (const pen of pens) {
        const district = map.districtAt(pen.hx + 1, pen.hy + 1, districts);
        add(pen.yb, () => LH.bld.drawGarden(c, pen, district, t, 'back'));
        add(pen.yf, () => LH.bld.drawGarden(c, pen, district, t, 'front'));
      }
    }
    // the followers' camp on the beach: one tent per follower (see map.camp)
    const followers = o.followers != null ? o.followers : (world.story && world.story.followers) || 0;
    const tentLit = !!(world.story && world.story.tentLights);
    for (const [cx, cy, k] of map.camp(map.tentsFor(world, followers))) {
      const x = cx * T, y = cy * T;
      if (x < bx0 - 40 || x > bx0 + bw + 40 || y < by0 - 40 || y > by0 + bh + 40) continue;
      add(y, () => drawTent(c, x, y, k, t, lights, tentLit));
    }
    // trees (zoomed far out on the website they come from the cached pieces instead: drawn once, no sway)
    const treesCached = o.fast && z <= 2;
    if (treesCached) {
      const GC = groundCaches.get(world), CH = 32 * T;
      for (let cy = Math.floor(ty0 * T / CH); cy <= Math.floor((ty1 + 3) * T / CH); cy++) for (let cx = Math.floor(tx0 * T / CH); cx <= Math.floor((tx1 + 1) * T / CH); cx++) {
        const p = GC.trees(cx, cy, districts);
        if (p) add(cy * CH - 1e6, () => c.drawImage(p, cx * CH, cy * CH - TREE_PAD)); // under everything else
      }
    } else for (let ty = ty0; ty <= ty1 + 2; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const tr = treeAt(tx, ty, busy, cleared, districts);
      if (!tr) continue;
      if (tr.stump) add(tr.y, () => drawStump(c, tr.x, tr.y));
      else add(tr.y, () => drawTree(c, tr.x, tr.y, tr.kind, tx * 31 + ty, t));
    }
    for (const l of world.landmarks || []) {
      const s = map.LANDMARKS[l.type];
      if (!s) continue;
      const lx = l.tileX * T, ly = (l.tileY + Math.max(1, s.h)) * T;
      if (lx < bx0 - 80 || lx > bx0 + bw + 40 || ly < by0 - 40 || ly > by0 + bh + 80) continue;
      add(ly - 1, () => drawLandmark(c, l, t, lights));
    }
    const actors = [];
    const hide = o.hide || new Set();
    const people = [];
    for (const f of world.founders || []) if (f.pos && f.appearance) people.push({ id: f.id, name: f.displayName, crew: false, x: f.pos[0], y: f.pos[1], app: f.appearance, founder: true });
    const still = o.still || new Set(); // episodes keep their subjects in place
    const working = o.working || new Set(); // episodes: villagers shown at their work spot, working
    for (const v of world.villagers) {
      if (hide.has(v.id) || !v.home || v.home.tileX == null) continue;
      const [hx, hy] = v.pos || map.homeSpot(v);
      // daily work (map.WORKS): by day the work props stay at the spot; the villager walks there and back
      const wp = !v.pos && map.workOf(v) ? workPlan(world, v) : null;
      if (wp && (wp.spot.x > bx0 - 80 && wp.spot.x < bx0 + bw + 80 && wp.spot.y > by0 - 40 && wp.spot.y < by0 + bh + 60)) add(wp.spot.y - 2, () => drawWorkProps(c, wp.spot, v.id, t));
      if (wp && working.has(v.id)) {
        const [sx, sy] = wp.spot.stops[0];
        people.push({ id: v.id, name: v.displayName, crew: !!v.crew, patron: v.patron === true, x: sx, y: sy, app: v.appearance, walk: false, face: wp.spot.face, work: wp.spot.work, u: t });
        continue;
      }
      if (wp && !still.has(v.id) && o.walk !== false && o.tod !== 'night') {
        const st = runPlan(wp, t);
        people.push({ id: v.id, name: v.displayName, crew: !!v.crew, patron: v.patron === true, x: st.x, y: st.y, app: v.appearance, walk: st.walk, face: st.face, work: st.work, u: st.u, carry: st.carry });
        continue;
      }
      const st = v.pos || still.has(v.id) || o.walk === false ? { dx: 0, dy: 0, walk: false, face: 1 } : stroll(v.id, t);
      people.push({ id: v.id, name: v.displayName, crew: !!v.crew, patron: v.patron === true, x: hx + st.dx, y: hy + (st.dy || 0), app: v.appearance, walk: st.walk, face: st.face });
    }
    const offsets = o.offsets || {};
    for (const p of people) {
      if (p.x < bx0 - 40 || p.x > bx0 + bw + 40 || p.y < by0 - 10 || p.y > by0 + bh + 60) continue;
      const lift = offsets[p.id] || 0;
      add(p.y, () => {
        const dip = p.work ? workDip(p.work, p.u) : 0;
        const head = drawVillager(c, p.app, p.id, p.x, p.y - lift, t, lights, { walk: p.walk, face: p.face, dip });
        if (p.work) drawWork(c, p.work, p.x, p.y - lift, head, p.face || 1, t, p.u, p.id);
        if (p.carry) { rect(c, 'ink', p.x - 11, head - 5, 22, 4); rect(c, 'wood3', p.x - 10, head - 4, 20, 2); }
        actors.push({ ...p, headY: head });
      });
    }
    for (const e of o.extras || []) add(e.y, () => e.draw(c, lights));
    if (o.cat) add(o.cat[1], () => { const s = petSprite('cat'); const f = animFrame('the-cat', 0.7, t); c.drawImage(s.frames[f], Math.round(o.cat[0] - s.w / 2), Math.round(o.cat[1] - s.h + 1)); });
    objs.sort((a, b) => a.y - b.y);
    for (const ob of objs) ob.fn();

    // gulls over the sea
    for (let i = 0; i < 5; i++) {
      const span = 900;
      const gx = ((((i * 211 + t * (14 + i * 3)) % span) + span) % span) - 300;
      const gy = -7 * T - i * 18 + 10 * Math.sin(t * 0.7 + i * 2);
      drawGull(c, Math.round(gx), Math.round(gy), Math.floor(t * 3 + i) % 2);
    }

    // fog wall
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawFog(c, bx0, by0, bw, bh, t, o.fast);

    // time of day
    if (tod.tint) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = tod.tint;
      c.fillRect(0, 0, bw, bh);
      c.globalCompositeOperation = 'source-over';
    }
    c.setTransform(1, 0, 0, 1, -bx0, -by0);
    if (tod.lights > 0) {
      for (const l of lights) {
        if (l.kind === 'window') {
          if (C.h2(l.seed, 5) > 0.85 && o.tod !== 'night') continue; // a few homes still dark at dusk
          rect(c, 'lantern', l.win[0], l.win[1], l.win[2], l.win[3]);
          rect(c, 'lanternhi', l.win[0] + 1, l.win[1] + 1, l.win[2] - 2, l.win[3] - 2);
        }
      }
      c.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const flick = 0.85 + 0.15 * Math.sin(t * 9 + l.x * 0.7) * Math.sin(t * 5.3 + l.y);
        const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        const a = 0.42 * tod.lights * flick;
        g.addColorStop(0, 'rgba(242,163,60,' + a + ')');
        g.addColorStop(1, 'rgba(242,163,60,0)');
        c.fillStyle = g;
        c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      const lh = lights.find((l) => l.kind === 'lighthouse');
      if (lh && tod.beam > 0) {
        const ang = -Math.PI / 2 + Math.sin(t * 0.45) * 1.25;
        const len = 420, spread = 0.13;
        const g = c.createRadialGradient(lh.x, lh.y, 4, lh.x, lh.y, len);
        g.addColorStop(0, 'rgba(255,217,138,' + 0.38 * tod.beam + ')');
        g.addColorStop(1, 'rgba(255,217,138,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(lh.x, lh.y);
        c.lineTo(lh.x + Math.cos(ang - spread) * len, lh.y + Math.sin(ang - spread) * len);
        c.lineTo(lh.x + Math.cos(ang + spread) * len, lh.y + Math.sin(ang + spread) * len);
        c.closePath();
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }

    // blit, nearest neighbour
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, (bx0 - x0) * z, (by0 - y0) * z, bw * z, bh * z);
    const toScreen = (x, y) => [(x - x0) * z, (y - y0) * z];
    for (const a of actors) { [a.sx, a.sy] = toScreen(a.x, a.y); a.sHead = toScreen(a.x, a.headY)[1]; }
    return { actors, toScreen };
  }

  LH.draw = { villagerSprite, petSprite, drawVillager, renderWorld, gridToCanvas, composeGrid };
})();
