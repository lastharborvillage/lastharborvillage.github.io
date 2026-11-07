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

  // Animation frame (0/1) of a sprite at time t, phase-shifted per id so a crowd is not in sync.
  const animFrame = (id, rate, t) => Math.floor(t * rate + C.h2(C.hashStr(String(id)), 3) * 2) % 2;

  // Draws a villager with feet at (x, y). Returns head-top y.
  function drawVillager(c, app, id, x, y, t, lights, o = {}) {
    const s = villagerSprite(app);
    // walking (o.walk): quicker steps with a small bob; o.face -1 = facing left (mirrored)
    const f = o.frame != null ? o.frame : o.walk ? Math.floor(t * 6) % 2 : animFrame(id, s.rate, t);
    const bob = o.walk ? Math.floor(t * 6) % 2 : 0;
    c.globalAlpha = 0.28; rect(c, 'ink', x - 5, y - 1, 11, 2); c.globalAlpha = 1;
    const dx = Math.round(x - s.w / 2), dy = Math.round(y - s.h + 1) - bob;
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
  function drawTent(c, x, y, k, t, lights) {
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
    const dist = map.districtAt(tx, ty, districts);
    const dens = dist === 'forest' ? 0.5 : dist === 'cliffs' || dist === 'lighthouse' ? 0.06 : 0.1;
    if (C.h2(tx, ty, 11) >= dens) return null;
    const kind = dist === 'forest' || dist === 'cliffs' || dist === 'fogbeach' || C.h2(tx, ty, 12) < 0.3 ? 'pine' : 'round';
    const x = tx * T + 8 + Math.floor(C.h2(tx, ty, 13) * 5) - 2, y = ty * T + 14;
    return cleared.has(tx + ',' + ty) ? { x, y, stump: true } : { x, y, kind };
  }
  const TREE_PAD = 48; // tree pieces reach this far above their tiles (tall pines)

  // Website ground cache (renderWorld o.fast): the land never changes for a given world, so it is
  // drawn once into 32x32-tile pieces (with every home's paths and plots, not only the ones on
  // screen), plus a list of the water tiles in each piece, which are still drawn every frame.
  const groundCaches = new WeakMap();
  function groundCacheFor(world, districts, openDistricts, makeGroundAt, landTile) {
    let gc = groundCaches.get(world);
    if (gc) return gc;
    const paths = new Set(), busy = new Set();
    const mark = (s, x, y) => s.add(x + ',' + y);
    const { occupied, housed } = worldIndex(world);
    for (const v of housed) {
      const hx = v.home.tileX, hy = v.home.tileY;
      for (let dx = -1; dx < 4; dx++) for (let dy = -1; dy < 4; dy++) mark(busy, hx + dx, hy + dy);
      mark(paths, hx, hy + 2); mark(paths, hx + 1, hy + 2);
      if (occupied.has((hx + 4) + ',' + hy)) { mark(paths, hx + 2, hy + 2); mark(paths, hx + 3, hy + 2); }
    }
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
      if (map.isCommon(tx, ty) && near(tx, ty)) for (let dx = -1; dx < 4; dx++) for (let dy = -1; dy < 4; dy++) mark(busy, tx + dx, ty + dy);
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
        for (let ty = cy * N; ty < (cy + 1) * N; ty++) for (let tx = cx * N; tx < (cx + 1) * N; tx++) if (!landTile(g2, gAt, tx, ty, cx * N * T, cy * N * T)) water.push([tx, ty]);
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
      mark(paths, hx, hy + 2); mark(paths, hx + 1, hy + 2);
      if (occupied.has((hx + 4) + ',' + hy)) { mark(paths, hx + 2, hy + 2); mark(paths, hx + 3, hy + 2); }
      yards.push([hx, hy]);
    };
    for (const v of housed) {
      const hx = v.home.tileX, hy = v.home.tileY;
      if (hx < tx0 - 5 || hx > tx1 + 2 || hy < ty0 - 3 || hy > ty1 + 2) continue;
      plot(hx, hy, true);
      homes.push(v);
    }
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
      if (!map.isCommon(tx, ty)) continue;
      if (!near(tx, ty)) continue;
      plot(tx, ty, false);
      commons.push([tx, ty]);
    }

    // ground
    const GRASSY = ['grass', 'darkgrass', 'rockgrass', 'field'];
    const makeGroundAt = (pathSet, busySet) => (tx, ty) => {
      const g = map.ground(tx, ty, districts);
      if (g === 'cobble' && !openDistricts.includes('market')) return 'grass';
      if (g === 'path' && map.isRoad(tx, ty) && has('cobbles', tx, ty)) return 'road';
      if (GRASSY.includes(g) && pathSet.has(tx + ',' + ty)) return has('stonepaths', tx, ty) ? (g === 'darkgrass' ? 'stonepath-dark' : 'stonepath') : g === 'darkgrass' ? 'footpath-dark' : 'footpath';
      if (g === 'field' && busySet.has(tx + ',' + ty)) return 'grass';
      return g;
    };
    // one land tile (not water) with its soft edges, drawn into g2 (whose origin is world pixel ox, oy)
    const landTile = (g2, gAt, tx, ty, ox, oy) => {
      const g = gAt(tx, ty);
      if (g === 'sea' || g === 'shallow') return false;
      g2.drawImage(tileCanvas(g, g === 'field' ? map.fieldKind(tx, ty) : Math.floor(C.h2(tx, ty, 1) * 4)), tx * T - ox, ty * T - oy);
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
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!landTile(c, groundAt, tx, ty, 0, 0)) drawWater(c, tx, ty, t);
    }

    // objects, painted back to front
    const objs = [];
    const lights = [];
    const add = (y, fn) => objs.push({ y, fn });
    for (const v of homes) add((v.home.tileY + 2) * T - 1 + map.homeLayout(v.home).dy, () => LH.bld.drawHome(c, v, districts, t, lights));
    for (const [hx, hy] of yards) add(hy * T + 22, () => LH.bld.drawYard(c, hx, hy, map.districtAt(hx + 1, hy + 1, districts), t));
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
    // as people live (so they spread as the village grows), and garden fences in front of the homes
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
      if (up.has('fences')) {
        for (const v of homes) {
          const hx = v.home.tileX, hy = v.home.tileY, fy = (hy + 3) * T - 3;
          if (!inView(hx * T, fy) || !has('fences', hx + 1, hy + 2)) continue;
          // a picket fence along the front of the plot with a gate gap at the front path, and short sides
          add(fy, () => {
            const seg = (x0, x1) => { rect(c, 'wood2', x0, fy - 3, x1 - x0, 1); rect(c, 'wood2', x0, fy - 1, x1 - x0, 1); for (let x = x0; x <= x1; x += 3) { rect(c, 'ink', x, fy - 5, 1, 6); px(c, 'wood3', x, fy - 5); } };
            seg((hx - 1) * T + 3, hx * T - 1);
            seg((hx + 2) * T + 1, (hx + 3) * T - 3);
            for (const sx of [(hx - 1) * T + 3, (hx + 3) * T - 3]) rect(c, 'wood2', sx, fy - 12, 1, 9);
          });
        }
      }
    }
    // the followers' camp on the beach: one tent per follower (see map.camp)
    const followers = o.followers != null ? o.followers : (world.story && world.story.followers) || 0;
    for (const [cx, cy, k] of map.camp(map.tentsFor(world, followers))) {
      const x = cx * T, y = cy * T;
      if (x < bx0 - 40 || x > bx0 + bw + 40 || y < by0 - 40 || y > by0 + bh + 40) continue;
      add(y, () => drawTent(c, x, y, k, t, lights));
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
    for (const v of world.villagers) {
      if (hide.has(v.id) || !v.home || v.home.tileX == null) continue;
      const [hx, hy] = v.pos || map.homeSpot(v);
      const st = v.pos || still.has(v.id) || o.walk === false ? { dx: 0, dy: 0, walk: false, face: 1 } : stroll(v.id, t);
      people.push({ id: v.id, name: v.displayName, crew: !!v.crew, x: hx + st.dx, y: hy + (st.dy || 0), app: v.appearance, walk: st.walk, face: st.face });
    }
    const offsets = o.offsets || {};
    for (const p of people) {
      if (p.x < bx0 - 40 || p.x > bx0 + bw + 40 || p.y < by0 - 10 || p.y > by0 + bh + 60) continue;
      const lift = offsets[p.id] || 0;
      add(p.y, () => { const head = drawVillager(c, p.app, p.id, p.x, p.y - lift, t, lights, { walk: p.walk, face: p.face }); actors.push({ ...p, headY: head }); });
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
