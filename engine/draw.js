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

  // Animation frame (0/1) of a sprite at time t, phase-shifted per id so a crowd is not in sync.
  const animFrame = (id, rate, t) => Math.floor(t * rate + C.h2(C.hashStr(String(id)), 3) * 2) % 2;

  // Draws a villager with feet at (x, y). Returns head-top y.
  function drawVillager(c, app, id, x, y, t, lights, o = {}) {
    const s = villagerSprite(app);
    const f = o.frame != null ? o.frame : animFrame(id, s.rate, t);
    c.globalAlpha = 0.28; rect(c, 'ink', x - 5, y - 1, 11, 2); c.globalAlpha = 1;
    const dx = Math.round(x - s.w / 2), dy = Math.round(y - s.h + 1);
    c.drawImage(s.frames[f], dx, dy);
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
      rect(g, 'wood', 0, 0, T, T);
      for (let x = 1; x < T; x += 3) { rect(g, 'moss2', x, 0, 2, T); for (let y = (x + variant) % 3; y < T; y += 3) px(g, variant % 2 ? 'gold' : 'grass', x, y); }
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
  function drawFog(c, x0, y0, w, h, t) {
    const fogTop = map.FOG_Y * T;
    const maxEdge = fogTop + 30;
    if (y0 > maxEdge + 50) return;
    const rows = Math.min(h, Math.ceil(maxEdge + 50 - y0));
    if (rows <= 0) return;
    const img = c.getImageData(0, 0, w, rows);
    const d = img.data;
    const F2 = rgb('fog2'), F = rgb('fog'), F3 = rgb('fog3'), WH = rgb('white');
    for (let xi = 0; xi < w; xi++) {
      const wx = x0 + xi;
      const edge = fogTop + 12 * Math.sin(wx * 0.021 + t * 0.12) + 7 * Math.sin(wx * 0.057 - t * 0.21) + 6 * C.vnoise(wx * 0.05 + t * 0.3, t * 0.1, 4);
      for (let yi = 0; yi < rows; yi++) {
        const wy = y0 + yi;
        const below = wy - edge;
        const n = C.vnoise(wx * 0.03 + t * 0.22, wy * 0.05, 5) * 0.6 + C.vnoise(wx * 0.09 - t * 0.17, wy * 0.12 + t * 0.05, 6) * 0.4;
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

  // ---------------------------------------------------------------- the scene
  let buf = null;

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
    const commons = [];
    for (let ty = ty0 - 3; ty <= ty1 + 2; ty++) for (let tx = tx0 - 3; tx <= tx1 + 1; tx++) {
      if (!map.isCommon(tx, ty)) continue;
      if (!near(tx, ty)) continue;
      plot(tx, ty, false);
      commons.push([tx, ty]);
    }

    // ground
    const GRASSY = ['grass', 'darkgrass', 'rockgrass', 'field'];
    const groundAt = (tx, ty) => {
      const g = map.ground(tx, ty, districts);
      if (g === 'cobble' && !openDistricts.includes('market')) return 'grass';
      if (GRASSY.includes(g) && paths.has(tx + ',' + ty)) return g === 'darkgrass' ? 'footpath-dark' : 'footpath';
      if (g === 'field' && busy.has(tx + ',' + ty)) return 'grass';
      return g;
    };
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const g = groundAt(tx, ty);
      if (g === 'sea' || g === 'shallow') { drawWater(c, tx, ty, t); continue; }
      c.drawImage(tileCanvas(g, Math.floor(C.h2(tx, ty, 1) * 4)), tx * T, ty * T);
      if (g !== 'path') continue;
      // soft grass edges where the path meets grass
      for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const n = groundAt(tx + sx, ty + sy);
        if (!GRASSY.includes(n)) continue;
        const fill = n === 'darkgrass' ? 'moss' : 'grass';
        for (let i = 0; i < T; i++) for (let d = 0; d < 3; d++) {
          if (C.h2(tx * T + i, ty * T + d * 7 + sx * 3 + sy * 5, 41) > [0.75, 0.4, 0.12][d]) continue;
          const xx = sx === 0 ? i : sx < 0 ? d : T - 1 - d;
          const yy = sy === 0 ? i : sy < 0 ? d : T - 1 - d;
          px(c, fill, tx * T + xx, ty * T + yy);
        }
      }
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
    // the followers' camp on the beach: one tent per follower (see map.camp)
    const followers = o.followers != null ? o.followers : (world.story && world.story.followers) || 0;
    for (const [cx, cy, k] of map.camp(followers)) {
      const x = cx * T, y = cy * T;
      if (x < bx0 - 40 || x > bx0 + bw + 40 || y < by0 - 40 || y > by0 + bh + 40) continue;
      add(y, () => drawTent(c, x, y, k, t, lights));
    }
    for (let ty = ty0; ty <= ty1 + 2; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (busy.has(tx + ',' + ty)) continue;
      const g = map.ground(tx, ty, districts);
      if (g !== 'grass' && g !== 'darkgrass' && g !== 'rockgrass') continue;
      if (ty < map.coastY(tx) + 3) continue;
      if (map.RESERVED.some((r) => tx >= r[0] - 1 && tx <= r[2] + 1 && ty >= r[1] - 1 && ty <= r[3] + 1)) continue;
      const dist = map.districtAt(tx, ty, districts);
      const dens = dist === 'forest' ? 0.5 : dist === 'cliffs' || dist === 'lighthouse' ? 0.06 : 0.1;
      if (C.h2(tx, ty, 11) >= dens) continue;
      const kind = dist === 'forest' || dist === 'cliffs' || dist === 'fogbeach' || C.h2(tx, ty, 12) < 0.3 ? 'pine' : 'round';
      const x = tx * T + 8 + Math.floor(C.h2(tx, ty, 13) * 5) - 2, y = ty * T + 14;
      add(y, () => drawTree(c, x, y, kind, tx * 31 + ty, t));
    }
    const actors = [];
    const hide = o.hide || new Set();
    const people = [];
    for (const f of world.founders || []) if (f.pos && f.appearance) people.push({ id: f.id, name: f.displayName, crew: false, x: f.pos[0], y: f.pos[1], app: f.appearance, founder: true });
    for (const v of world.villagers) {
      if (hide.has(v.id) || !v.home || v.home.tileX == null) continue;
      const [x, y] = v.pos || map.homeSpot(v);
      people.push({ id: v.id, name: v.displayName, crew: !!v.crew, x, y, app: v.appearance });
    }
    const offsets = o.offsets || {};
    for (const p of people) {
      if (p.x < bx0 - 40 || p.x > bx0 + bw + 40 || p.y < by0 - 10 || p.y > by0 + bh + 60) continue;
      const lift = offsets[p.id] || 0;
      add(p.y, () => { const head = drawVillager(c, p.app, p.id, p.x, p.y - lift, t, lights); actors.push({ ...p, headY: head }); });
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
    drawFog(c, bx0, by0, bw, bh, t);

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
