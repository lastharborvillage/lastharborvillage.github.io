// Homes, trade buildings and village commons. Every house is built from parameters picked by a
// seeded rng per plot (width, storeys, roof shape, door, windows, shutters, chimney, annex, props),
// so no two neighbours look alike but a house never changes between frames or episodes.
// The villager's home kind (forge, bakery, ...) overrides some parameters and adds a hanging
// sign with an icon and a trade prop, so the village stays readable when it is big.
(function () {
  const LH = globalThis.LH;
  const { PAL, SPR } = LH;
  const C = LH.core;
  const T = 16;

  const col = (n) => { if (!PAL[n]) throw new Error('unknown palette colour ' + n); return PAL[n]; };
  function rect(c, n, x, y, w, h) { if (w <= 0 || h <= 0) return; c.fillStyle = col(n); c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  const px = (c, n, x, y) => rect(c, n, x, y, 1, 1);
  const box = (c, n, x, y, w, h) => { rect(c, 'ink', x - 1, y - 1, w + 2, h + 2); rect(c, n, x, y, w, h); };
  function grid(c, rows, x, y, extra = {}) {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch === '.' || ch === ' ') continue; const n = extra[ch] || SPR.FIXED[ch]; if (!n) throw new Error('unknown icon letter ' + ch); px(c, n, x + i, y + j); } });
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[(((Math.round(y) % 4) + 4) % 4) * 4 + (((Math.round(x) % 4) + 4) % 4)];

  // Sign icons (7 wide max). Letters as in sprites.js.
  const ICONS = {
    hammer: ['.ggggg.', '.gjjjg.', '...d...', '...d...', '...d...'],
    bread: ['..nnn..', '.nNNNn.', 'nNnNnNn', 'nNNNNNn', '.nnnnn.'],
    fish: ['.QQQ..Q', 'QkQQQQQ', 'QQQQQQQ', '.QQQ..Q'],
    mug: ['WWWW...', 'UUUUkk.', 'UuUU..k', 'UUUUkk.', 'kkkk...'],
    book: ['rRRRRRr', 'rRWWWRr', 'rRWWWRr', 'rRRRRRr'],
    bottle: ['...k...', '...G...', '..MMM..', '.MMMMM.', '.MmMMM.', '..MMM..'],
    needle: ['kkkkk..', '.PPP...', '.PPP.g.', '.PPP..g', 'kkkkk..'],
    saw: ['DD.....', 'DDggggg', '...gjgj'],
    pot: ['.kkkk.', 'kRRRRk', 'RRRRRR', 'RrRRRR', '.RRRR.'],
    shield: ['QQQQQ', 'QWQWQ', 'QQWQQ', '.QQQ.', '..Q..'],
    bee: ['.W.W.', 'kUkUk', 'UkUkU', '.kUk.'],
    brush: ['.nnnn..', 'nRnQnn.', 'nnUnPn.', '.nnnn..'],
    wheat: ['U.U.U', '.UUU.', '..U..', '..m..', '..m..'],
    note: ['.kkkk', '.k..k', '.k..k', 'kk.kk', 'kk.kk'],
    pan: ['.kkk...', 'kgggk..', 'kgggkdd', '.kkk...'],
    // added 2026-11-08
    flower: ['.P.P.', 'PYPYP', '.PMP.', '..M..', '..M..'],
    scissors: ['G...G', '.G.G.', '..k..', '.kRk.', 'kR.Rk'],
    gear: ['.g.g.', 'ggggg', 'gg.gg', 'ggggg', '.g.g.'],
    coin: ['.UUU.', 'UuUuU', 'UUuUU', 'UuUuU', '.UUU.'],
    slate: ['kkkkkkk', 'kmmmmmk', 'kmWmWmk', 'kmmmmmk', 'kkkkkkk'],
    boat: ['...k...', '..kW...', '.kWWk..', 'ddddddd', '.ddddd.'],
    star: ['...Y...', '..YYY..', 'YYYYYYY', '..YYY..', '.Y...Y.'],
  };

  // District building styles.
  const STYLE = {
    hut: { w: [24, 26, 28, 30], storeys: [1, 1, 1, 2], walls: ['planks'], wallCols: ['wood3', 'wood3', 'cream'], roofs: ['side', 'gable', 'side', 'hip'], roofCols: ['brown', 'dark', 'teal', 'navy', 'red', 'sky'], props: ['barrel', 'net', 'woodpile', 'none', 'flowers', 'crate'] },
    workshop: { w: [28, 30, 32], storeys: [1], walls: ['vplanks'], wallCols: ['wood'], roofs: ['side', 'hip'], roofCols: ['grey', 'dark', 'brown'], props: ['woodpile', 'barrel', 'crate'] },
    timber: { w: [26, 28, 30, 32], storeys: [1, 2, 2], walls: ['beams'], wallCols: ['cream'], roofs: ['gable', 'side', 'hip'], roofCols: ['red', 'orange', 'brown', 'grey'], props: ['flowers', 'barrel', 'crate', 'none', 'pots'] },
    farmhouse: { w: [28, 30, 32], storeys: [1], walls: ['plaster'], wallCols: ['cream', 'sand'], roofs: ['thatch', 'thatch', 'gable'], roofCols: ['sand', 'brown'], props: ['hay', 'woodpile', 'flowers'] },
    stone: { w: [26, 28, 30], storeys: [1, 2], walls: ['bricks'], wallCols: ['stone3'], roofs: ['side', 'gable', 'hip'], roofCols: ['navy', 'grey', 'red'], props: ['flowers', 'barrel', 'none', 'pots'] },
    cottage: { w: [26, 28, 30], storeys: [1], walls: ['stones'], wallCols: ['stone'], roofs: ['sod', 'sod', 'gable'], roofCols: ['green', 'grey'], props: ['flowers', 'woodpile'] },
    cabin: { w: [26, 28, 30, 32], storeys: [1], walls: ['logs'], wallCols: ['wood'], roofs: ['gable', 'side'], roofCols: ['dark', 'pine', 'brown'], props: ['woodpile', 'woodpile', 'barrel'] },
    stilt: { w: [24, 26, 28], storeys: [1], walls: ['planks'], wallCols: ['wood3'], roofs: ['side', 'thatch'], roofCols: ['fog', 'teal'], props: ['net', 'barrel'], stilts: true },
  };

  // Trades: what a home kind changes. Anything not set comes from the district style.
  const TRADE = {
    house: {},
    forge: { w: 32, wall: 'bricks', wallCol: 'stone', roof: 'side', roofCol: 'dark', sign: 'hammer', chimney: 'big', smoke: 'dark', doorType: 'bay', prop: 'anvil', annex: 0 },
    bakery: { wall: 'beams', wallCol: 'cream', roof: 'gable', roofCol: 'orange', sign: 'bread', awning: 'red', smoke: 'light', chimney: 1, prop: 'breadstall' },
    fishhut: { wall: 'planks', wallCol: 'wood3', roof: 'side', roofCol: 'teal', sign: 'fish', prop: 'fishrack', net: true },
    barn: { w: 34, wall: 'vplanks', wallCol: 'ember', roof: 'gable', roofCol: 'dark', sign: 'wheat', doorType: 'barn', prop: 'hay', annex: 0, chimney: 0 },
    tavern: { w: 34, storeys: 2, wall: 'beams', wallCol: 'cream', roof: 'side', roofCol: 'red', sign: 'mug', prop: 'barrels', lantern: true, annex: 0, smoke: 'light', chimney: -1 },
    library: { w: 30, storeys: 2, wall: 'bricks', wallCol: 'stone3', roof: 'gable', roofCol: 'navy', sign: 'book', prop: 'flowers', doorType: 'arch' },
    apothecary: { wall: 'plaster', wallCol: 'cream', roof: 'hip', roofCol: 'green', sign: 'bottle', prop: 'herbs', shutters: 'green' },
    tailor: { wall: 'beams', wallCol: 'cream', roof: 'side', roofCol: 'purple', sign: 'needle', prop: 'laundry', awning: 'purple' },
    carpenter: { wall: 'vplanks', wallCol: 'wood', roof: 'side', roofCol: 'brown', sign: 'saw', prop: 'workbench' },
    pottery: { wall: 'plaster', wallCol: 'sand', roof: 'hip', roofCol: 'red', sign: 'pot', prop: 'claypots', chimney: 1, smoke: 'light' },
    watchtower: { tower: true, sign: 'shield' },
    beekeeper: { roof: 'thatch', roofCol: 'sand', sign: 'bee', prop: 'hives' },
    cookhouse: { sign: 'pan', prop: 'cauldron', smoke: 'light', chimney: -1 },
    studio: { sign: 'brush', prop: 'easel', roof: 'gable' },
    musichall: { w: 32, storeys: 2, wall: 'beams', wallCol: 'cream', roof: 'hip', roofCol: 'teal', sign: 'note', bunting: true, annex: 0 },
    // added 2026-11-08
    florist: { wall: 'plaster', wallCol: 'cream', roof: 'gable', roofCol: 'pink', sign: 'flower', prop: 'flowers', awning: 'pink', shutters: 'green' },
    barber: { wall: 'bricks', wallCol: 'stone3', roof: 'side', roofCol: 'red', sign: 'scissors', awning: 'red', prop: 'pots' },
    tinker: { w: 30, wall: 'vplanks', wallCol: 'wood', roof: 'side', roofCol: 'grey', sign: 'gear', chimney: 'big', smoke: 'dark', prop: 'crate' },
    shop: { w: 32, wall: 'beams', wallCol: 'cream', roof: 'side', roofCol: 'green', sign: 'coin', awning: 'green', prop: 'barrels', lantern: true, annex: 0 },
    school: { w: 34, storeys: 2, wall: 'bricks', wallCol: 'stone3', roof: 'hip', roofCol: 'red', sign: 'slate', doorType: 'arch', prop: 'flowers', annex: 0 },
    boathouse: { w: 32, wall: 'planks', wallCol: 'wood3', roof: 'gable', roofCol: 'navy', sign: 'boat', doorType: 'barn', prop: 'net', annex: 0, chimney: 0 },
    wizardtower: { shape: 'wizard', sign: 'star' },
    mushroom: { shape: 'mushroom' },
    // patron-only (not live yet)
    manor: { w: 34, storeys: 3, wall: 'bricks', wallCol: 'stone3', roof: 'hip', roofCol: 'navy', doorType: 'arch', lantern: true, bunting: true, prop: 'pots', annex: 0, chimney: 1, patron: true },
    castle: { shape: 'castle', patron: true },
  };
  const DOORS = ['red', 'blue', 'green', 'purple', 'teal', 'brown', 'yellow', 'navy'];
  const SHADE = { wood3: 'wood', wood: 'wood2', cream: 'sand', sand: 'sand2', stone3: 'stone', stone: 'stone2', ember: 'ember2' };

  function spec(styleId, kind, L) {
    const r = C.rng(L.seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const S = STYLE[styleId] || STYLE.hut;
    const K = TRADE[kind] || TRADE.house;
    const P = {
      kind: kind || 'house',
      w: K.w || pick(S.w),
      storeys: K.storeys || pick(S.storeys),
      wall: K.wall || pick(S.walls),
      wallCol: K.wallCol || pick(S.wallCols),
      roof: K.roof || pick(S.roofs),
      roofFam: LH.fam(K.roofCol || pick(S.roofCols)),
      doorFam: LH.fam(pick(DOORS)),
      door: L.door,
      doorType: K.doorType || (r() < 0.3 ? 'arch' : 'plain'),
      chimney: K.chimney != null ? K.chimney : r() < 0.65 ? (r() < 0.5 ? -1 : 1) : 0,
      smoke: K.smoke || (r() < 0.45 ? 'light' : null),
      shutters: K.shutters ? LH.fam(K.shutters) : r() < 0.35 ? LH.fam(pick(DOORS)) : null,
      flowerbox: r() < 0.35,
      awning: K.awning ? LH.fam(K.awning) : r() < 0.1 ? LH.fam(pick(['red', 'blue', 'green', 'yellow'])) : null,
      annex: K.annex != null ? K.annex : r() < 0.3 ? 1 : 0,
      lantern: K.lantern || r() < 0.2,
      stilts: !!S.stilts,
      sign: K.sign || null,
      prop: K.prop || pick(S.props),
      net: K.net || false,
      bunting: !!K.bunting,
      tower: !!K.tower,
      shape: K.shape || null,
      seed: L.seed,
    };
    if (P.w > 30) P.annex = 0;
    P.side = P.door !== 0 ? -P.door : r() < 0.5 ? -1 : 1; // annex / prop side: away from the door
    return P;
  }

  // ---------------------------------------------------------------- pieces
  function smoke(c, x, y, t, dark, seed) {
    for (let i = 0; i < 5; i++) {
      const p = (((t * 0.32 + i / 5 + seed * 0.137) % 1) + 1) % 1;
      const cx = x + p * 8 + Math.sin(t * 1.3 + i * 2) * 1.2, cy = y - p * 24;
      const rad = 1 + p * 2.4;
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
        if (xx * xx + yy * yy > rad * rad) continue;
        if (bayer(cx + xx, cy + yy) > 1.05 - p) continue;
        px(c, dark ? (p < 0.4 ? 'stone2' : 'stone') : p < 0.35 ? 'white' : 'fog2', cx + xx, cy + yy);
      }
    }
  }

  function windowAt(c, x, y, P, L) {
    rect(c, 'ink', x - 1, y - 1, 7, 7);
    rect(c, 'night', x, y, 5, 5);
    px(c, 'foam', x, y); px(c, 'foam', x + 1, y);
    rect(c, 'wood2', x + 2, y, 1, 5); rect(c, 'wood2', x, y + 2, 5, 1);
    if (P.shutters) { rect(c, 'ink', x - 3, y - 1, 2, 7); rect(c, P.shutters[0], x - 3, y, 1, 5); rect(c, 'ink', x + 6, y - 1, 2, 7); rect(c, P.shutters[0], x + 7, y, 1, 5); }
    if (P.flowerbox) { rect(c, 'ink', x - 1, y + 5, 7, 3); rect(c, 'wood', x, y + 6, 5, 1); px(c, 'rose', x, y + 5); px(c, 'moss', x + 1, y + 5); px(c, 'gold', x + 3, y + 5); px(c, 'moss', x + 4, y + 5); }
    if (L) L.push({ x: x + 2.5, y: y + 2.5, r: 10, kind: 'window', win: [x, y, 5, 5], seed: P.seed + x });
  }

  function wallPattern(c, P, wx, wy, w, h) {
    const sh = SHADE[P.wallCol] || 'wood2';
    if (P.wall === 'planks') for (let yy = wy + 2; yy < wy + h; yy += 3) rect(c, sh, wx, yy, w, 1);
    if (P.wall === 'vplanks') for (let xx = wx + 2; xx < wx + w; xx += 4) rect(c, sh, xx, wy, 1, h);
    if (P.wall === 'logs') for (let yy = wy + 1; yy < wy + h; yy += 3) { rect(c, sh, wx, yy + 1, w, 1); px(c, 'wood3', wx, yy); px(c, 'wood3', wx + w - 1, yy); }
    if (P.wall === 'bricks' || P.wall === 'stones') for (let yy = wy + 1; yy < wy + h; yy += 3) for (let xx = wx + (((yy - wy) / 3) % 2 ? 0 : 3); xx < wx + w; xx += 6) { rect(c, sh, xx, yy + 2, 5, 1); px(c, sh, xx + 5, yy); }
    if (P.wall === 'plaster') for (let i = 0; i < w * h / 40; i++) { const r = C.rng(P.seed + i); px(c, sh, wx + Math.floor(r() * w), wy + Math.floor(r() * h)); }
    if (P.wall === 'beams') {
      rect(c, 'wood2', wx, wy, 2, h); rect(c, 'wood2', wx + w - 2, wy, 2, h); rect(c, 'wood2', wx, wy, w, 2);
      if (P.storeys === 2) rect(c, 'wood2', wx, wy + 11, w, 2);
      if (P.storeys === 3) { rect(c, 'wood2', wx, wy + 11, w, 2); rect(c, 'wood2', wx, wy + 21, w, 2); }
      for (let i = 0; i < 6; i++) { px(c, 'wood2', wx + 2 + i, wy + 2 + i); px(c, 'wood2', wx + w - 3 - i, wy + 2 + i); }
    }
    rect(c, sh, wx, wy + h - 1, w, 1);
  }

  function roofSide(c, P, rx, ry, rw, rh, hip) {
    const [a, b] = P.roofFam;
    for (let yy = 0; yy < rh; yy++) {
      const inset = hip ? Math.max(0, 5 - yy) : 0;
      rect(c, 'ink', rx + inset, ry + yy, rw - inset * 2, 1);
      if (yy === 0 || yy === rh - 1) continue;
      rect(c, yy >= rh - 3 ? b : a, rx + inset + 1, ry + yy, rw - inset * 2 - 2, 1);
    }
    for (let yy = 4; yy < rh - 3; yy += 4) { rect(c, b, rx + 1, ry + yy, rw - 2, 1); for (let xx = rx + 3 + ((yy / 4) % 2 ? 3 : 0); xx < rx + rw - 1; xx += 6) px(c, b, xx, ry + yy - 1); }
    rect(c, P.roof === 'sod' ? 'grass' : a, rx + (hip ? 5 : 1), ry + 1, rw - (hip ? 10 : 2), 1);
    if (P.roof === 'sod') for (let i = 0; i < rw * rh / 10; i++) { const r = C.rng(P.seed * 7 + i); px(c, ['grass', 'moss2', 'moss', 'rose', 'gold'][Math.floor(r() * (i % 9 ? 3 : 5))], rx + 2 + Math.floor(r() * (rw - 4)), ry + 2 + Math.floor(r() * (rh - 5))); }
  }

  function roofThatch(c, P, rx, ry, rw, rh) {
    for (let yy = 0; yy < rh; yy++) {
      const inset = yy < 3 ? 3 - yy : 0;
      rect(c, 'ink', rx + inset, ry + yy, rw - inset * 2, 1);
      if (yy > 0) rect(c, yy > rh - 4 ? 'sand2' : 'sand', rx + inset + 1, ry + yy, rw - inset * 2 - 2, 1);
    }
    for (let yy = ry + 2; yy < ry + rh - 2; yy += 2) for (let xx = rx + 2 + ((yy - ry) % 4); xx < rx + rw - 2; xx += 4) rect(c, 'sand3', xx, yy, 1, 2);
    for (let xx = rx + 1; xx < rx + rw - 1; xx++) if ((xx * 7) % 3 !== 0) { px(c, 'sand2', xx, ry + rh); px(c, 'ink', xx, ry + rh + 1); }
  }

  // Front gable: the roof slopes run back from a pointed front wall.
  function roofGable(c, P, wx, wy, w, rx, ry, rw, rh) {
    const [a, b] = P.roofFam;
    rect(c, 'ink', rx, ry, rw, rh);
    const mid = rx + Math.floor(rw / 2);
    rect(c, b, rx + 1, ry + 1, mid - rx - 1, rh - 2);
    rect(c, a, mid, ry + 1, rx + rw - 1 - mid, rh - 2);
    for (let yy = ry + 3; yy < ry + rh - 1; yy += 3) { rect(c, a, rx + 1, yy, mid - rx - 1, 1); rect(c, b, mid + 1, yy, rx + rw - 2 - mid, 1); }
    rect(c, 'ink', mid, ry + 1, 1, rh - 2);
    const gh = Math.min(rh - 3, Math.floor(w / 2) - 3);
    const cx = wx + w / 2;
    for (let k = 0; k <= gh; k++) {
      const yy = wy - gh + k;
      const hw = Math.round((w / 2) * (k / gh));
      rect(c, b, cx - hw - 2, yy, hw * 2 + 4, 1);
      rect(c, 'ink', cx - hw - 1, yy, hw * 2 + 2, 1);
      if (hw > 0) rect(c, P.wallCol, cx - hw, yy, hw * 2, 1);
    }
    rect(c, 'ink', cx - 2, wy - Math.floor(gh / 2) - 2, 4, 4); rect(c, 'night', cx - 1, wy - Math.floor(gh / 2) - 1, 2, 2);
    return { gx: cx, gy: wy - Math.floor(gh / 2) };
  }

  function sign(c, x, y, icon) {
    rect(c, 'ink', x - 1, y - 3, 1, 3); rect(c, 'ink', x - 1, y - 3, 6, 1);
    const g = ICONS[icon];
    const w = Math.max(...g.map((r) => r.length)), h = g.length;
    const bw = w + 4, bh = h + 4;
    const bx = x + 4 - Math.floor(bw / 2);
    rect(c, 'ink', x + 3, y - 2, 1, 2);
    rect(c, 'ink', bx - 1, y - 1, bw + 2, bh + 2); rect(c, 'wood3', bx, y, bw, bh); rect(c, 'wood', bx, y + bh - 1, bw, 1);
    grid(c, g, bx + 2, y + 2);
  }

  // ---------------------------------------------------------------- props (bottom-centre at x, y)
  const PROP = {
    none() {},
    barrel(c, x, y) { box(c, 'wood', x - 3, y - 8, 6, 8); rect(c, 'wood3', x - 2, y - 8, 1, 8); rect(c, 'stone2', x - 3, y - 6, 6, 1); rect(c, 'stone2', x - 3, y - 2, 6, 1); },
    barrels(c, x, y) { PROP.barrel(c, x - 4, y); PROP.barrel(c, x + 3, y + 1); PROP.barrel(c, x, y - 7); },
    crate(c, x, y) { box(c, 'wood3', x - 4, y - 7, 8, 7); rect(c, 'wood', x - 4, y - 4, 8, 1); for (let i = 0; i < 6; i++) px(c, 'wood', x - 3 + i, y - 7 + i); },
    woodpile(c, x, y) { for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) { const lx = x - 5 + j * 4 + i * 2, ly = y - 3 - i * 3; rect(c, 'ink', lx - 1, ly - 1, 5, 4); rect(c, 'wood', lx, ly, 3, 2); px(c, 'wood3', lx + 1, ly); } },
    flowers(c, x, y, t, seed) { rect(c, 'ink', x - 6, y - 3, 12, 3); rect(c, 'wood', x - 5, y - 2, 10, 1); for (let i = 0; i < 5; i++) { px(c, 'moss2', x - 5 + i * 2, y - 4); px(c, ['rose', 'gold', 'white', 'ember'][(seed + i) % 4], x - 5 + i * 2, y - 5); } },
    pots(c, x, y) { for (const dx of [-4, 3]) { box(c, 'ember', x + dx - 2, y - 4, 4, 4); rect(c, 'moss', x + dx - 2, y - 7, 4, 2); px(c, 'moss2', x + dx, y - 8); } },
    net(c, x, y) { for (let yy = -11; yy < -2; yy++) for (let xx = -4; xx < 5; xx++) if ((xx + yy) % 3 === 0 || (xx - yy) % 3 === 0) px(c, 'sand2', x + xx, y + yy); rect(c, 'wood2', x - 5, y - 12, 11, 1); },
    hay(c, x, y) { box(c, 'gold', x - 5, y - 6, 10, 6); for (let i = 0; i < 4; i++) rect(c, 'gold2', x - 4 + i * 3, y - 5, 1, 5); rect(c, 'gold2', x - 5, y - 6, 10, 1); },
    anvil(c, x, y, t, s, L) {
      rect(c, 'ink', x - 5, y - 7, 10, 3); rect(c, 'stone2', x - 4, y - 6, 8, 1); rect(c, 'ink', x - 2, y - 4, 4, 4); rect(c, 'stone2', x - 1, y - 4, 2, 4); px(c, 'stone3', x - 3, y - 6);
      if (Math.floor(t * 3 + s) % 4 === 0) { px(c, 'lanternhi', x + 2, y - 9); px(c, 'lantern', x - 2, y - 10); px(c, 'lanternhi', x + 4, y - 11); }
    },
    breadstall(c, x, y) { rect(c, 'ink', x - 6, y - 6, 12, 2); rect(c, 'wood3', x - 5, y - 6, 10, 1); rect(c, 'wood2', x - 5, y - 4, 1, 4); rect(c, 'wood2', x + 4, y - 4, 1, 4); for (let i = 0; i < 3; i++) { rect(c, 'ink', x - 5 + i * 3, y - 9, 4, 3); rect(c, 'sand2', x - 4 + i * 3, y - 8, 2, 2); px(c, 'sand', x - 4 + i * 3, y - 8); } },
    fishrack(c, x, y, t) { rect(c, 'wood2', x - 5, y - 11, 1, 11); rect(c, 'wood2', x + 5, y - 11, 1, 11); rect(c, 'wood2', x - 5, y - 11, 11, 1); for (let i = 0; i < 4; i++) { const sw = Math.round(Math.sin(t * 2 + i) * 0.6); rect(c, 'sea3', x - 3 + i * 2 + sw, y - 10, 1, 4); px(c, 'ink', x - 3 + i * 2 + sw, y - 6); } },
    herbs(c, x, y) { for (const dx of [-4, 0, 4]) { box(c, 'wood3', x + dx - 1, y - 3, 3, 3); rect(c, dx ? 'moss' : 'moss2', x + dx - 2, y - 7, 5, 3); px(c, dx === 0 ? 'plum' : 'rose', x + dx, y - 8); } },
    laundry(c, x, y, t) { rect(c, 'wood2', x - 6, y - 12, 1, 12); rect(c, 'wood2', x + 6, y - 12, 1, 12); rect(c, 'stone3', x - 6, y - 11, 13, 1); ['rose', 'sea3', 'white', 'gold'].forEach((n, i) => { const f = Math.round(Math.sin(t * 2.4 + i) * 0.7); rect(c, n, x - 5 + i * 3, y - 10, 2, 4 + f); }); },
    workbench(c, x, y) { rect(c, 'ink', x - 6, y - 7, 13, 3); rect(c, 'wood3', x - 5, y - 6, 11, 1); rect(c, 'wood2', x - 5, y - 4, 1, 4); rect(c, 'wood2', x + 5, y - 4, 1, 4); rect(c, 'stone3', x - 3, y - 8, 5, 1); rect(c, 'wood', x + 2, y - 8, 2, 1); },
    claypots(c, x, y) { for (const [dx, h] of [[-4, 6], [1, 8], [5, 4]]) { rect(c, 'ink', x + dx - 2, y - h, 5, h); rect(c, 'ember', x + dx - 1, y - h + 1, 3, h - 1); rect(c, 'ember2', x + dx - 1, y - 2, 3, 1); } },
    hives(c, x, y, t) {
      for (const dx of [-4, 3]) { rect(c, 'ink', x + dx - 3, y - 8, 7, 8); for (let i = 0; i < 3; i++) rect(c, i % 2 ? 'gold2' : 'gold', x + dx - 2, y - 7 + i * 2, 5, 2); rect(c, 'ink', x + dx, y - 2, 1, 1); }
      for (let i = 0; i < 3; i++) px(c, 'ink', x + Math.round(Math.sin(t * 3 + i * 2) * 7), y - 11 - Math.round(Math.cos(t * 2.3 + i) * 3));
    },
    cauldron(c, x, y, t, s, L) {
      rect(c, 'ink', x - 4, y - 6, 9, 6); rect(c, 'stone2', x - 3, y - 5, 7, 4); rect(c, 'moss', x - 3, y - 6, 7, 1);
      px(c, Math.floor(t * 6) % 2 ? 'lantern' : 'lanternhi', x - 1, y); px(c, 'ember', x + 1, y);
      for (let i = 0; i < 3; i++) { const p = ((t * 0.6 + i / 3) % 1); if (bayer(x + i, y - 8 - p * 10) < 1 - p) px(c, 'white', x - 1 + i + Math.round(Math.sin(t + i) * 1), y - 8 - p * 10); }
      if (L) L.push({ x, y: y - 1, r: 8, kind: 'lamp' });
    },
    easel(c, x, y) { rect(c, 'wood2', x - 3, y - 12, 1, 12); rect(c, 'wood2', x + 3, y - 12, 1, 12); rect(c, 'ink', x - 5, y - 13, 11, 8); rect(c, 'white', x - 4, y - 12, 9, 6); px(c, 'sea3', x - 3, y - 11); rect(c, 'moss', x - 3, y - 9, 4, 2); px(c, 'gold', x + 2, y - 11); rect(c, 'sea2', x - 4, y - 7, 9, 1); },
  };

  // ---------------------------------------------------------------- buildings
  // A founder's plaque: a small gold plate with a star, on the wall beside the door ((x, y) top-left, 5x4).
  function founderPlaque(c, x, y, t, k) {
    const glint = Math.floor(t * 1.5 + (k || 0) / 7) % 6 === 0;
    rect(c, 'ink', x, y, 5, 4); rect(c, 'gold2', x + 1, y + 1, 3, 2); px(c, 'gold', x + 1, y + 1);
    px(c, glint ? 'white' : 'lanternhi', x + 2, y + 1); px(c, 'lanternhi', x + 2, y + 2);
  }
  // Draws a building whose 2x2 plot has its top-left at (x, y) world px. L = lights list.
  function drawBuilding(c, x, y, P, t, Lights, lay = { dx: 0, dy: 0, door: 0 }) {
    const cx = x + 16 + lay.dx;
    const by = y + 30 + lay.dy;
    // one-shape homes: their door is centred on cx (map.homeLayout gives them door 0); plaque right of it
    const one = P.tower ? [drawTower, 3] : P.shape === 'wizard' ? [drawWizardTower, 3] : P.shape === 'mushroom' ? [drawMushroom, 3] : P.shape === 'castle' ? [drawCastle, 5] : null;
    if (one) { one[0](c, cx, by, P, t, Lights); if (P.founder) founderPlaque(c, cx + one[1], by - 9, t, x); return; }
    const lift = P.stilts ? 5 : 0;
    const wallH = P.storeys === 3 ? 33 : P.storeys === 2 ? 25 : 17;
    const roofH = (P.storeys === 3 ? 10 : P.storeys === 2 ? 11 : 18) - lift;
    const w = P.w, wx = Math.round(cx - w / 2), wb = by - lift, wy = wb - wallH;
    c.globalAlpha = 0.25; rect(c, 'ink', wx + 1, by, w + 3, 2); c.globalAlpha = 1;
    if (P.stilts) for (const sx of [wx + 1, wx + Math.floor(w / 2) - 1, wx + w - 3]) { rect(c, 'ink', sx - 1, wb - 1, 4, lift + 2); rect(c, 'wood2', sx, wb - 1, 2, lift + 1); }

    // lean-to annex on the side away from the door
    if (P.annex) {
      const aw = 9, ax = P.side > 0 ? wx + w - 1 : wx - aw + 1, ah = wallH - 6;
      rect(c, 'ink', ax - 1, wb - ah - 1, aw + 2, ah + 2); rect(c, P.wallCol, ax, wb - ah, aw, ah);
      wallPattern(c, { ...P, storeys: 1, wall: P.wall === 'beams' ? 'plaster' : P.wall }, ax, wb - ah, aw, ah);
      for (let i = 0; i < 6; i++) { const yy = wb - ah - 6 + i; rect(c, 'ink', ax - 1, yy, aw + 2, 1); if (i) rect(c, i > 3 ? P.roofFam[1] : P.roofFam[0], ax, yy, aw, 1); }
      rect(c, 'ink', ax + Math.floor(aw / 2) - 2, wb - 6, 4, 6); rect(c, 'wood2', ax + Math.floor(aw / 2) - 1, wb - 5, 2, 5);
    }

    // wall
    rect(c, 'ink', wx - 1, wy, w + 2, wallH + 1);
    rect(c, P.wallCol, wx, wy, w, wallH);
    wallPattern(c, P, wx, wy, w, wallH);

    // door
    const dw = P.doorType === 'barn' ? 12 : P.doorType === 'bay' ? 12 : 6;
    const dcx = Math.round(cx + P.door * 8);
    const dx0 = Math.round(Math.min(wx + w - dw - 2, Math.max(wx + 2, dcx - dw / 2)));
    const dh = P.doorType === 'barn' ? 13 : 10, dy0 = wb - dh;
    rect(c, 'ink', dx0 - 1, dy0 - 1, dw + 2, dh + 1);
    if (P.doorType === 'bay') {
      rect(c, 'wood4', dx0, dy0, dw, dh);
      const f = Math.floor(t * 8) % 3;
      rect(c, 'stone2', dx0 + 2, dy0 + 5, 8, 5); rect(c, 'ember', dx0 + 3, dy0 + 6, 6, 3);
      rect(c, f ? 'lantern' : 'lanternhi', dx0 + 4, dy0 + 6 - (f === 2 ? 1 : 0), 4, 2); px(c, 'lanternhi', dx0 + 5 + f, dy0 + 5);
      if (Lights) Lights.push({ x: dx0 + 6, y: dy0 + 7, r: 18, kind: 'fire' });
    } else if (P.doorType === 'barn') {
      rect(c, P.doorFam[1] === 'ink' ? 'wood' : 'wood3', dx0, dy0, dw, dh);
      for (let i = 0; i < dh; i++) { px(c, 'wood2', dx0 + Math.round(i * (dw - 1) / (dh - 1)), dy0 + i); px(c, 'wood2', dx0 + dw - 1 - Math.round(i * (dw - 1) / (dh - 1)), dy0 + i); }
      rect(c, 'wood2', dx0 + dw / 2, dy0, 1, dh);
    } else {
      rect(c, P.doorFam[0], dx0, dy0, dw, dh); rect(c, P.doorFam[1], dx0 + 3, dy0, 1, dh); px(c, 'gold', dx0 + 4, dy0 + 5);
      if (P.doorType === 'arch') { px(c, 'ink', dx0, dy0); px(c, 'ink', dx0 + dw - 1, dy0); rect(c, 'ink', dx0 + 1, dy0 - 2, dw - 2, 1); rect(c, P.doorFam[0], dx0 + 1, dy0 - 1, dw - 2, 1); }
    }
    const plq = P.founder ? (dx0 + dw + 7 <= wx + w ? dx0 + dw + 2 : dx0 - 7) : null;
    if (plq != null) founderPlaque(c, plq, dy0 + 1, t, x);
    rect(c, 'stone', dx0 - 1, wb, dw + 2, 1);
    // a doorstep; the path itself is drawn on the ground (draw.js door paths, 2026-11-10: was a straight sand strip)
    if (!P.stilts) { rect(c, 'ink', dx0 - 1, wb + 1, dw + 2, 2); rect(c, 'stone', dx0, wb + 1, dw, 1); }

    // windows: avoid the door; upper floor gets a row too
    const rows = P.storeys === 3 ? [wy + 3, wy + 13, wy + 23] : P.storeys === 2 ? [wy + 3, wy + 14] : [wy + 4];
    for (const ry of rows) {
      const lower = ry === rows[rows.length - 1];
      const n = w >= 32 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const xx = Math.round(wx + 4 + i * (w - 13) / (n - 1));
        if (lower && xx + 5 + (P.shutters ? 2 : 0) > dx0 - 2 && xx - (P.shutters ? 2 : 0) < dx0 + dw + 2) continue;
        if (lower && plq != null && xx + 5 + (P.shutters ? 2 : 0) > plq - 1 && xx - (P.shutters ? 2 : 0) < plq + 6) continue;
        if (lower && P.awning && Math.abs(xx + 2 - (dx0 + dw / 2)) < 9) continue;
        windowAt(c, xx, ry, P, Lights);
      }
    }
    if (P.net) PROP.net(c, wx + (P.side > 0 ? w - 7 : 6), wb - 1);

    // roof
    const rx = wx - 2, rw = w + 4, ry = wy - roofH, rh = roofH + 2;
    if (P.roof === 'gable') roofGable(c, P, wx, wy, w, rx, ry, rw, rh);
    else if (P.roof === 'thatch') roofThatch(c, P, rx, ry, rw, rh);
    else roofSide(c, P, rx, ry, rw, rh, P.roof === 'hip');
    if (P.chimney) {
      const big = P.chimney === 'big', chW = big ? 6 : 4, chH = big ? 10 : 7;
      const chimX = big ? wx + w - 11 : P.chimney < 0 ? wx + 4 : wx + w - 8;
      const top = ry + 5 - chH;
      rect(c, 'ink', chimX - 1, top - 1, chW + 2, chH + 1); rect(c, big ? 'stone' : 'stone2', chimX, top, chW, chH); rect(c, 'stone3', chimX, top, chW, 1);
      if (P.smoke) smoke(c, chimX + chW / 2, top - 2, t, P.smoke === 'dark', P.seed % 97);
    }
    if (P.bunting) for (let i = 0; i < w; i += 3) { const yy = wy + 1 + Math.round(Math.sin((i / w) * Math.PI) * 2); px(c, ['ember', 'gold', 'sea3', 'rose'][(i / 3) % 4], wx + i, yy); px(c, ['ember', 'gold', 'sea3', 'rose'][(i / 3) % 4], wx + i, yy + 1); }

    // awning over the door
    if (P.awning) {
      const ax = dx0 - 4, aw = dw + 8, ay = dy0 - 5;
      rect(c, 'ink', ax - 1, ay - 1, aw + 2, 5);
      for (let i = 0; i < aw; i++) rect(c, Math.floor(i / 2) % 2 ? 'white' : P.awning[0], ax + i, ay, 1, 3);
      for (let i = 0; i < aw; i += 2) px(c, P.awning[1], ax + i, ay + 3);
    }
    // hanging sign beside the door
    if (P.sign) {
      const sx = P.door >= 0 ? Math.min(dx0 + dw + 2, wx + w - 9) : Math.max(dx0 - 11, wx + 1);
      sign(c, sx, wb - 15, P.sign);
    }
    // door lantern
    if (P.lantern) {
      const lx = P.sign ? (P.door >= 0 ? dx0 - 3 : dx0 + dw + 2) : dx0 + dw + 2;
      rect(c, 'ink', lx - 1, dy0 - 1, 3, 4); px(c, 'lantern', lx, dy0); px(c, 'lanternhi', lx, dy0 + 1);
      if (Lights) Lights.push({ x: lx + 0.5, y: dy0 + 1, r: 12, kind: 'lamp' });
    }
    // trade or garden prop against the wall, away from the door
    const pf = PROP[P.prop];
    if (!pf) throw new Error('unknown building prop ' + P.prop);
    pf(c, cx + P.side * (w / 2 - 5), by + 4, t, P.seed % 13, Lights);
  }

  // ---- special shapes (added 2026-11-08) ----
  // A wizard's tower: narrow stone, a glowing round window, a tall purple cone roof with stars.
  function drawWizardTower(c, cx, by, P, t, Lights) {
    const x = cx - 8, w = 16, h = 30;
    c.globalAlpha = 0.25; rect(c, 'ink', x, by, w + 4, 2); c.globalAlpha = 1;
    rect(c, 'ink', x - 1, by - h, w + 2, h + 1); rect(c, 'stone', x, by - h, w, h);
    wallPattern(c, { ...P, wall: 'stones', wallCol: 'stone' }, x, by - h, w, h);
    rect(c, 'ink', x + 5, by - 10, 6, 10); rect(c, 'plum2', x + 6, by - 9, 4, 9); px(c, 'gold', x + 9, by - 5);
    const f = Math.floor(t * 2) % 2;
    rect(c, 'ink', x + 5, by - 23, 6, 6); rect(c, f ? 'lanternhi' : 'lantern', x + 6, by - 22, 4, 4); px(c, 'ink', x + 5, by - 23); px(c, 'ink', x + 10, by - 23);
    if (Lights) Lights.push({ x: x + 8, y: by - 20, r: 14, kind: 'lamp' });
    const top = by - h, ch = 24;
    for (let k = 0; k <= ch; k++) {
      const hw = Math.round(12 * (k / ch)) + 1, yy = top - ch + k;
      rect(c, 'ink', cx - hw - 1, yy, hw * 2 + 2, 1);
      if (k > 0) rect(c, k > ch - 3 ? 'plum2' : 'plum', cx - hw, yy, hw * 2, 1);
    }
    for (const [dx, dy] of [[-3, 8], [4, 13], [-6, 18], [1, 20]]) px(c, Math.floor(t * 3 + dx) % 3 ? 'gold' : 'lanternhi', cx + dx, top - ch + dy);
    px(c, 'lanternhi', cx, top - ch - 1);
    sign(c, x + w + 2, by - 15, 'star');
  }

  // A mushroom house (fairies, gnomes): a cream stem with a round door and a red spotted cap.
  function drawMushroom(c, cx, by, P, t, Lights) {
    c.globalAlpha = 0.25; rect(c, 'ink', cx - 10, by, 22, 2); c.globalAlpha = 1;
    rect(c, 'ink', cx - 8, by - 17, 16, 18); rect(c, 'cream', cx - 7, by - 16, 14, 16); rect(c, 'sand', cx + 3, by - 16, 4, 16);
    rect(c, 'ink', cx - 3, by - 9, 6, 9); rect(c, 'wood', cx - 2, by - 8, 4, 8); px(c, 'ink', cx - 3, by - 9); px(c, 'ink', cx + 2, by - 9); px(c, 'gold', cx + 1, by - 4);
    rect(c, 'ink', cx - 6, by - 15, 4, 4); rect(c, 'lanternhi', cx - 5, by - 14, 2, 2);
    if (Lights) Lights.push({ x: cx - 4, y: by - 13, r: 10, kind: 'lamp' });
    const capY = by - 17, R = 18, H = 14;
    for (let k = 0; k <= H; k++) {
      const hw = Math.round(R * Math.sqrt(Math.max(0, 1 - ((H - k) / (H + 0.5)) ** 2)));
      rect(c, 'ink', cx - hw - 1, capY - H + k, hw * 2 + 2, 1);
      if (k > 0) rect(c, k > H - 3 ? 'ember2' : 'ember', cx - hw, capY - H + k, hw * 2, 1);
    }
    rect(c, 'ink', cx - R, capY + 1, R * 2, 1); rect(c, 'sand2', cx - R + 2, capY, R * 2 - 4, 1);
    for (const [dx, dy, s] of [[-10, 6, 3], [-2, 3, 4], [7, 7, 3], [12, 11, 2], [-14, 11, 2], [2, 10, 2]]) rect(c, 'white', cx + dx, capY - H + dy, s, s - 1);
    PROP.flowers(c, cx + 13, by + 3, t, P.seed % 13);
  }

  // A small castle (patron-only): a stone keep with battlements, two round towers, gold flags.
  function drawCastle(c, cx, by, P, t, Lights) {
    c.globalAlpha = 0.25; rect(c, 'ink', cx - 22, by, 46, 2); c.globalAlpha = 1;
    const kx = cx - 12, kw = 24, kh = 24;
    rect(c, 'ink', kx - 1, by - kh, kw + 2, kh + 1); rect(c, 'stone3', kx, by - kh, kw, kh);
    wallPattern(c, { ...P, wall: 'bricks', wallCol: 'stone3' }, kx, by - kh, kw, kh);
    for (let i = 0; i < kw; i += 4) { rect(c, 'ink', kx + i - 1, by - kh - 4, 4, 5); rect(c, 'stone3', kx + i, by - kh - 3, 2, 3); }
    rect(c, 'ink', cx - 4, by - 12, 8, 12); rect(c, 'wood2', cx - 3, by - 11, 6, 11); px(c, 'ink', cx - 4, by - 12); px(c, 'ink', cx + 3, by - 12);
    for (let i = 0; i < 3; i++) rect(c, 'stone2', cx - 3, by - 9 + i * 3, 6, 1);
    for (const wx of [kx + 4, kx + kw - 9]) { rect(c, 'ink', wx - 1, by - 21, 7, 7); rect(c, 'lanternhi', wx, by - 20, 5, 5); rect(c, 'wood2', wx + 2, by - 20, 1, 5); if (Lights) Lights.push({ x: wx + 2.5, y: by - 17.5, r: 10, kind: 'lamp' }); }
    const wv = Math.floor(t * 3) % 2;
    for (const tx of [kx - 9, kx + kw + 1]) {
      const tw = 9, th = 32;
      rect(c, 'ink', tx - 1, by - th, tw + 2, th + 1); rect(c, 'stone', tx, by - th, tw, th);
      wallPattern(c, { ...P, wall: 'bricks', wallCol: 'stone' }, tx, by - th, tw, th);
      rect(c, 'ink', tx + 3, by - 22, 3, 5); rect(c, 'night', tx + 4, by - 21, 1, 3);
      for (let k = 0; k <= 9; k++) { const hw = Math.round(6 * (k / 9)); rect(c, 'ink', tx + 4 - hw - 1, by - th - 10 + k, hw * 2 + 3, 1); if (k) rect(c, 'sea', tx + 4 - hw,by - th - 10 + k, hw * 2 + 1, 1); }
      rect(c, 'ink', tx + 4, by - th - 17, 1, 7); rect(c, 'gold', tx + 5, by - th - 17 + wv, 4, 2); rect(c, 'gold2', tx + 5, by - th - 15 + wv, 3, 1);
    }
    PROP.pots(c, cx + 9, by + 3);
  }

  // The guard's watchtower: a narrow stone tower with a wooden lookout and a flag.
  function drawTower(c, cx, by, P, t, Lights) {
    const x = cx - 7, w = 14, h = 28; // door (x+4..x+10) centred on cx, where the path starts
    c.globalAlpha = 0.25; rect(c, 'ink', x, by, w + 4, 2); c.globalAlpha = 1;
    rect(c, 'ink', x - 1, by - h, w + 2, h + 1); rect(c, 'stone3', x, by - h, w, h);
    wallPattern(c, { ...P, wall: 'bricks', wallCol: 'stone3' }, x, by - h, w, h);
    rect(c, 'ink', x + 4, by - 10, 6, 10); rect(c, 'wood2', x + 5, by - 9, 4, 9);
    rect(c, 'ink', x + 5, by - 21, 4, 5); rect(c, 'night', x + 6, by - 20, 2, 3);
    rect(c, 'ink', x - 3, by - h - 6, w + 6, 7); rect(c, 'wood', x - 2, by - h - 5, w + 4, 5);
    for (let i = 0; i < w + 4; i += 3) rect(c, 'wood3', x - 2 + i, by - h - 5, 1, 5);
    rect(c, 'ink', x - 3, by - h - 9, w + 6, 4); rect(c, 'ember', x - 2, by - h - 8, w + 4, 2);
    rect(c, 'ink', x + w - 2, by - h - 20, 1, 12);
    const f = Math.floor(t * 4) % 2;
    for (let i = 0; i < 6; i++) rect(c, 'sea2', x + w - 1 + i, by - h - 20 + (f && i > 2 ? 1 : 0), 1, 4 - Math.floor(i / 3));
    if (Lights) Lights.push({ x: x + w / 2, y: by - h - 4, r: 16, kind: 'lamp' });
    sign(c, x + w + 2, by - 15, 'shield');
  }

  function drawHome(c, v, districts, t, Lights) {
    const h = v.home;
    const style = (districts[h.district] || {}).style || 'hut';
    const lay = LH.map.homeLayout(h);
    const P = spec(style, h.kind, lay);
    // A home grows with its owner's story (home.stage, set by the writer): 1 flower box and a lantern,
    // 2 an annex, 3 a second storey, 4 bunting and an awning. Stage 0 / none = the house as it was built.
    const st = h.stage || 0;
    if (st >= 1) { P.flowerbox = true; P.lantern = true; }
    if (st >= 2 && P.w <= 30) P.annex = 1;
    if (st >= 3) P.storeys = 2;
    if (st >= 4) { P.bunting = true; if (!P.awning) P.awning = LH.fam('yellow'); }
    // floors asked for (home.floors 2-3, a villager's own request): taller, never lower
    if (h.floors && h.floors > P.storeys) P.storeys = Math.min(3, h.floors);
    // a founder (one of the village's first 100) has a small gold plaque with a star on the wall beside the
    // door (2026-11-11, was a gold sign on a post in the yard)
    P.founder = LH.map.isFounder(v);
    drawBuilding(c, h.tileX * T, h.tileY * T, P, t, Lights, lay);
    // a patron's home has a little gold pennant by the door (only when "patron": true; not live yet)
    if (v.patron === true) {
      const [hx, hy] = LH.map.homeSpot(v);
      const fx = Math.round(hx - 12), fy = Math.round(hy - 2), wv = Math.floor(t * 3) % 2;
      rect(c, 'ink', fx - 1, fy - 17, 3, 17); rect(c, 'wood2', fx, fy - 16, 1, 16);
      rect(c, 'gold', fx + 1, fy - 16 + wv, 5, 2); rect(c, 'gold2', fx + 1, fy - 14 + wv, 4, 1); px(c, 'lanternhi', fx, fy - 18);
    }
  }

  // Commons: plots that never get a house. Decorated once the village reaches them.
  function drawCommon(c, tx, ty, district, t, Lights) {
    const x = tx * T + 16, y = ty * T + 26;
    const r = C.rng(C.hashStr('common|' + tx + ',' + ty));
    const kinds = district === 'farms' ? ['haystacks', 'garden', 'garden', 'pond'] : district === 'market' ? ['well', 'benches', 'flowerbed', 'well'] : ['well', 'garden', 'pond', 'flowerbed', 'benches'];
    const k = kinds[Math.floor(r() * kinds.length)];
    if (k === 'well') {
      c.globalAlpha = 0.25; rect(c, 'ink', x - 8, y, 17, 2); c.globalAlpha = 1;
      rect(c, 'ink', x - 8, y - 9, 16, 10); rect(c, 'stone', x - 7, y - 8, 14, 8); for (let i = 0; i < 3; i++) rect(c, 'stone2', x - 7 + (i % 2) * 3, y - 6 + i * 2, 14, 1);
      rect(c, 'ink', x - 6, y - 10, 12, 3); rect(c, 'sea', x - 5, y - 9, 10, 1);
      rect(c, 'wood2', x - 7, y - 20, 1, 11); rect(c, 'wood2', x + 6, y - 20, 1, 11);
      // roof: narrow at the top, wide at the eaves (2026-11-11: it was drawn upside down)
      rect(c, 'ink', x - 3, y - 26, 6, 1);
      for (let i = 0; i < 5; i++) { const w = 4 + i * 4; rect(c, 'ink', x - w / 2 - 1, y - 25 + i, w + 2, 1); rect(c, i === 4 ? 'ember2' : 'ember', x - w / 2, y - 25 + i, w, 1); }
      rect(c, 'ink', x - 11, y - 20, 22, 1);
      rect(c, 'wood', x - 1, y - 18, 2, 4);
    } else if (k === 'garden') {
      rect(c, 'ink', x - 14, y - 16, 28, 17); rect(c, 'wood', x - 13, y - 15, 26, 15);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) { px(c, 'moss2', x - 11 + j * 4, y - 13 + i * 4); px(c, (i + j) % 3 ? 'moss' : i % 2 ? 'ember' : 'gold', x - 11 + j * 4, y - 14 + i * 4); }
      for (let i = -14; i <= 13; i += 3) { rect(c, 'wood3', x + i, y - 18, 1, 4); }
      rect(c, 'wood3', x - 14, y - 17, 28, 1);
    } else if (k === 'pond') {
      for (let yy = -8; yy <= 0; yy++) for (let xx = -13; xx <= 13; xx++) {
        const d = (xx * xx) / 169 + ((yy + 4) * (yy + 4)) / 20;
        if (d > 1.15) continue;
        px(c, d > 0.9 ? 'ink' : d > 0.7 ? 'sea3' : 'sea2', x + xx, y + yy);
      }
      px(c, 'moss', x - 5, y - 4); px(c, 'moss', x - 4, y - 4); px(c, 'rose', x - 4, y - 5); px(c, 'moss', x + 4, y - 2);
      const f = Math.floor(t * 1.2) % 4; if (f === 0) px(c, 'foam', x + 2, y - 5);
      rect(c, 'moss2', x + 9, y - 10, 1, 4); rect(c, 'wood', x + 9, y - 12, 1, 2); rect(c, 'moss2', x + 11, y - 9, 1, 3);
    } else if (k === 'flowerbed') {
      rect(c, 'ink', x - 12, y - 8, 24, 8); rect(c, 'wood', x - 11, y - 7, 22, 6);
      for (let i = 0; i < 10; i++) { px(c, 'moss', x - 10 + i * 2, y - 6); px(c, ['rose', 'gold', 'white', 'plum', 'ember'][i % 5], x - 10 + i * 2, y - 7 - (i % 2)); }
    } else if (k === 'haystacks') {
      for (const [dx, dy] of [[-7, 0], [6, -3]]) { for (let i = 0; i < 9; i++) { const hw = Math.round(Math.sqrt(1 - ((i - 5) / 6) ** 2) * 7); rect(c, 'ink', x + dx - hw - 1, y + dy - 9 + i, hw * 2 + 2, 1); rect(c, i > 5 ? 'gold2' : 'gold', x + dx - hw, y + dy - 9 + i, hw * 2, 1); } }
    } else if (k === 'benches') {
      for (const dx of [-8, 8]) { rect(c, 'ink', x + dx - 6, y - 5, 12, 3); rect(c, 'wood3', x + dx - 5, y - 4, 10, 1); rect(c, 'wood2', x + dx - 4, y - 2, 1, 2); rect(c, 'wood2', x + dx + 3, y - 2, 1, 2); }
      rect(c, 'ink', x - 1, y - 18, 3, 18); rect(c, 'wood2', x, y - 18, 1, 18); rect(c, 'ink', x - 3, y - 24, 7, 7); rect(c, 'lantern', x - 2, y - 23, 5, 5); rect(c, 'lanternhi', x - 1, y - 22, 3, 3);
      if (Lights) Lights.push({ x: x + 0.5, y: y - 20, r: 14, kind: 'lamp' });
    }
  }

  // Side yard of an occupied plot (tiles x+2..x+3): a tree, a vegetable patch, a shed...
  function bush(c, x, y, a, b) {
    for (let yy = -6; yy <= 0; yy++) for (let xx = -5; xx <= 5; xx++) {
      const d = (xx * xx) / 25 + ((yy + 3) * (yy + 3)) / 10;
      if (d > 1) continue;
      px(c, d > 0.75 ? 'ink' : xx + yy < -3 ? a : b, x + xx, y + yy);
    }
  }
  // what stands in a home's side yard (right of the house) and where; drawYard draws it, and the garden
  // fences (draw.js) need to know it too
  function yardOf(tx, ty, district) {
    const r = C.rng(C.hashStr('yard|' + tx + ',' + ty));
    const x = (tx + 3) * T + 2 + Math.round(r() * 4 - 2), y = ty * T + 22 + Math.round(r() * 4 - 2);
    const opts = {
      harbour: ['boat', 'crates', 'tree', 'bush', 'none', 'laundry', 'garden'],
      shipyard: ['woodpile', 'crates', 'shed', 'tree', 'none'],
      market: ['garden', 'bush', 'tree', 'laundry', 'shed', 'none'],
      farms: ['garden', 'garden', 'hay', 'tree', 'shed', 'none'],
      lighthouse: ['bush', 'rocks', 'tree', 'none', 'garden'],
      cliffs: ['rocks', 'bush', 'tree', 'none'],
      forest: ['tree', 'tree', 'woodpile', 'shed', 'bush'],
      fogbeach: ['boat', 'rocks', 'none', 'crates'],
    }[district] || ['tree', 'bush', 'none'];
    return { k: opts[Math.floor(r() * opts.length)], x, y, r };
  }
  // Fenced gardens (village upgrade 'fences', laid out in draw.js). Each one is picked from the home's
  // plot so it always looks the same. The fence (2026-11-10: 16 kinds, each area favours its own):
  // brown, white or painted pickets (tall or short, flat or pointed, close or wide), split rails, a
  // lattice, solid planks, an iron railing, rope on posts, driftwood, stacked logs, woven wattle, a
  // mortared or a dry-stone wall, a hedge (sometimes in flower) or a low pebble border; most have a
  // gate (open or shut). What grows inside: mixed flowers, rows of tulips, vegetables, pumpkins,
  // sunflowers, a beehive, or herbs round a birdbath. Drawn in two parts so people and plants sort
  // right: 'back' (back fence and the bed) and 'front' (sides, front fence and gate).
  const GARDEN_FENCES = ['picket', 'white', 'painted', 'rail', 'lattice', 'plank', 'iron', 'rope', 'driftwood', 'log', 'wattle', 'stone', 'drystone', 'hedge', 'flowerhedge', 'pebble'];
  const FENCE_BY = {
    harbour: ['rope', 'driftwood', 'white', 'picket', 'painted', 'stone', 'pebble'],
    shipyard: ['plank', 'rail', 'picket', 'rope', 'wattle', 'log'],
    market: ['white', 'painted', 'iron', 'picket', 'hedge', 'lattice', 'flowerhedge'],
    farms: ['rail', 'wattle', 'hedge', 'picket', 'drystone', 'lattice', 'flowerhedge'],
    lighthouse: ['stone', 'drystone', 'white', 'hedge', 'iron', 'painted'],
    cliffs: ['drystone', 'stone', 'wattle', 'rail', 'pebble'],
    forest: ['log', 'wattle', 'rail', 'hedge', 'plank', 'lattice'],
    fogbeach: ['driftwood', 'rope', 'pebble', 'drystone'],
  };
  const FENCE_PAINT = [['sea2', 'sea'], ['teal', 'teal2'], ['ember', 'ember2'], ['moss', 'moss2'], ['gold', 'gold2'], ['rose', 'rose2'], ['sea3', 'sea2'], ['plum', 'plum2']];
  const GARDEN_BEDS = ['flowers', 'tulips', 'veg', 'pumpkins', 'sunflowers', 'beehive', 'herbs'];
  function gardenLook(pen, district) {
    const r = C.rng(C.hashStr('garden|' + pen.hx + ',' + pen.hy));
    const own = FENCE_BY[district] || GARDEN_FENCES;
    // one in four ignores the area, so every part of the village has a few surprises
    const pool = r() < 0.25 ? GARDEN_FENCES : own;
    const fence = pool[Math.floor(r() * pool.length)];
    const beds = district === 'farms' ? ['veg', 'veg', 'pumpkins', 'sunflowers', 'beehive'] : pen.veg ? ['veg', 'pumpkins', 'herbs', 'flowers'] : GARDEN_BEDS;
    return {
      fence, bed: beds[Math.floor(r() * beds.length)], gate: fence !== 'pebble' && r() < 0.65, open: r() < 0.45, hue: Math.floor(r() * 5), seed: Math.floor(r() * 1e9),
      paint: FENCE_PAINT[Math.floor(r() * FENCE_PAINT.length)], tall: r() < 0.4, pointed: r() < 0.5, gap: r() < 0.35 ? 2 : 3,
    };
  }
  function drawGarden(c, pen, district, t, part) {
    const { x0, x1, yf } = pen, yb = pen.yb + 3, L = gardenLook(pen, district);
    const W = x1 - x0, mid = (x0 + x1) >> 1, F = L.fence;
    const h2 = (x, y, s) => C.h2(x, y, s + pen.hx * 7 + pen.hy * 13);
    // a fence run along y (its foot), from a to b
    const run = (y, a, b) => {
      if (b < a) return;
      const len = b - a + 1;
      if (F === 'picket' || F === 'white' || F === 'painted') {
        const [pk, sh] = F === 'white' ? ['cream', 'fog'] : F === 'painted' ? L.paint : ['wood3', 'wood'];
        const h = L.tall ? 6 : 5;
        for (let x = a; x <= b; x += L.gap) {
          rect(c, 'ink', x - 1, y - h, 3, h + 1); rect(c, pk, x, y - h, 1, h); px(c, sh, x, y - 1);
          if (L.pointed) px(c, 'ink', x, y - h - 1);
        }
        rect(c, F === 'white' ? 'fog' : sh, a, y - 3, len, 1);
        if (L.tall) rect(c, F === 'white' ? 'fog' : sh, a, y - 5, len, 1);
      } else if (F === 'rail') { // split rails between posts
        for (const ry of [y - 5, y - 2]) { rect(c, 'ink', a, ry - 1, len, 3); rect(c, 'wood3', a, ry, len, 1); }
        for (let x = a; x <= b; x += 7) { rect(c, 'ink', x - 1, y - 7, 3, 8); rect(c, 'wood', x, y - 7, 1, 7); px(c, 'wood3', x, y - 7); }
        rect(c, 'ink', b - 1, y - 7, 3, 8); rect(c, 'wood', b, y - 7, 1, 7);
      } else if (F === 'lattice') { // criss-cross slats between a top and a bottom rail
        const k = L.pointed ? 'cream' : 'wood3';
        rect(c, 'ink', a, y - 7, len, 8);
        for (let x = a; x <= b; x++) for (let yy = 1; yy <= 4; yy++) if ((x - a + yy) % 4 === 0 || (x - a - yy + 40) % 4 === 0) px(c, k, x, y - 1 - yy);
        rect(c, k, a, y - 6, len, 1); rect(c, k, a, y - 1, len, 1);
        for (let x = a; x <= b; x += 8) { rect(c, 'ink', x - 1, y - 8, 3, 9); rect(c, 'wood', x, y - 7, 1, 7); }
      } else if (F === 'plank') { // solid boards, a little uneven on top
        for (let x = a; x <= b; x++) {
          const h = (L.tall ? 5 : 4) + (Math.floor((x - a) / 3) % 2 === 0 ? 0 : -1) - (h2(Math.floor((x - a) / 3), 1, 5) < 0.2 ? 1 : 0);
          rect(c, 'ink', x, y - h - 1, 1, h + 2);
          if ((x - a) % 3 !== 2) rect(c, (x - a) % 3 === 0 ? 'wood3' : 'wood', x, y - h, 1, h);
        }
        rect(c, 'wood2', a, y - 3, len, 1);
      } else if (F === 'iron') { // black railing with spear tips and gold knobs on the posts
        rect(c, 'ink', a, y - 6, len, 1); rect(c, 'ink', a, y - 2, len, 1);
        for (let x = a; x <= b; x += 2) { rect(c, 'ink', x, y - 7, 1, 8); px(c, 'stone2', x, y - 7); }
        for (let x = a; x <= b; x += 8) { rect(c, 'ink', x - 1, y - 8, 3, 9); rect(c, 'stone2', x, y - 7, 1, 7); px(c, 'gold', x, y - 9); }
      } else if (F === 'rope') { // short posts with a sagging rope (and now and then a float)
        for (let x = a; x <= b; x++) { const p = (x - a) % 7; px(c, 'sand2', x, y - 5 + Math.round(Math.sin((p / 7) * Math.PI) * 2)); }
        for (let x = a; x <= b; x += 7) { rect(c, 'ink', x - 1, y - 6, 3, 7); rect(c, 'wood', x, y - 6, 1, 6); px(c, 'wood3', x, y - 6); }
        if (len > 14 && L.pointed) { const fx = a + 10; rect(c, 'ink', fx - 1, y - 5, 4, 4); rect(c, 'ember', fx, y - 4, 2, 2); px(c, 'white', fx, y - 4); }
      } else if (F === 'driftwood') { // grey, uneven boards with a rail
        for (let x = a; x <= b; x += 2) {
          const h = 3 + Math.floor(h2(x, y, 77) * 4), k = ['stone3', 'fog', 'wood3', 'stone3'][Math.floor(h2(x, y, 78) * 4)];
          rect(c, 'ink', x - 1, y - h - 1, 3, h + 2); rect(c, k, x, y - h, 1, h);
        }
        rect(c, 'stone2', a, y - 2, len, 1);
      } else if (F === 'log') { // two logs on top of each other, posts at the ends
        rect(c, 'ink', a, y - 7, len, 8);
        for (const ly of [y - 6, y - 3]) { rect(c, 'wood', a, ly, len, 2); rect(c, 'wood3', a, ly, len, 1); }
        for (let x = a + 3; x < b; x += 5) px(c, 'wood2', x, y - 5 + ((x >> 2) % 2) * 3);
        for (const x of [a, b]) { rect(c, 'ink', x - 1, y - 9, 3, 10); rect(c, 'wood2', x, y - 8, 1, 8); }
      } else if (F === 'wattle') {
        rect(c, 'ink', a, y - 4, len, 5);
        for (let i = 0; i < 3; i++) for (let x = a; x <= b; x++) px(c, (x + i * 2) % 4 < 2 ? 'wood3' : 'wood', x, y - 3 + i);
        for (let x = a; x <= b; x += 6) { rect(c, 'ink', x, y - 6, 1, 2); }
      } else if (F === 'stone') {
        for (let x = a, i = 0; x <= b; x += 4, i++) {
          const w = Math.min(4, b - x + 1), k = i % 3 === 1 ? 'stone2' : 'stone';
          rect(c, 'ink', x, y - 3, w, 4); rect(c, k, x + 1, y - 3, w - 2, 2); px(c, 'stone3', x + 1, y - 3); px(c, 'stone2', x + 1, y - 1);
        }
      } else if (F === 'drystone') { // stacked field stones of all sizes, moss on some
        rect(c, 'ink', a, y - 4, len, 5);
        for (let x = a, i = 0; x <= b; i++) {
          const w = 2 + Math.floor(h2(x, i, 31) * 3), hh = 2 + Math.floor(h2(x, i, 32) * 3), k = ['stone', 'stone3', 'stone2', 'stone'][Math.floor(h2(x, i, 33) * 4)];
          const ww = Math.min(w, b - x + 1);
          rect(c, 'ink', x, y - hh - 1, ww, hh + 2); if (ww > 1) rect(c, k, x, y - hh, ww - 1, hh);
          if (h2(x, i, 34) < 0.3) px(c, 'moss', x, y - hh);
          x += w;
        }
      } else if (F === 'pebble') { // a low border of white stones
        for (let x = a; x <= b; x += 3) { rect(c, 'ink', x - 1, y - 2, 4, 3); rect(c, ['white', 'stone3', 'cream'][Math.floor(h2(x, y, 41) * 3)], x, y - 1, 2, 1); }
      } else { // hedge: dark green, round on top (in flower: dots of colour)
        for (let x = a; x <= b; x++) {
          const hh = 4 + (Math.floor((x - a) / 3) % 2) + (L.tall ? 1 : 0);
          rect(c, 'ink', x, y - hh - 1, 1, hh + 2); rect(c, 'pine', x, y - hh, 1, hh); px(c, 'pine2', x, y - 1); if ((x + y) % 3 === 0) px(c, 'moss2', x, y - hh);
          if (F === 'flowerhedge' && (x * 7 + y) % 4 === 0) px(c, ['rose', 'white', 'gold', 'plum'][(L.hue + x) % 4], x, y - hh + 1 + ((x >> 1) % 2));
        }
      }
    };
    // the sides are seen from above, so they stay thin
    const side = (x) => {
      if (F === 'pebble') { for (let y = yb; y < yf - 1; y += 3) { px(c, 'ink', x, y); px(c, 'stone3', x, y + 1); } return; }
      const k = F === 'hedge' || F === 'flowerhedge' ? 'pine' : F === 'stone' || F === 'drystone' ? 'stone' : F === 'white' ? 'fog' : F === 'painted' ? L.paint[1]
        : F === 'iron' ? 'stone2' : F === 'rope' ? 'sand2' : F === 'driftwood' ? 'stone3' : F === 'log' ? 'wood' : 'wood2';
      rect(c, 'ink', x - 1, yb, 3, yf - yb - 1); rect(c, k, x, yb, 1, yf - yb - 1);
    };
    if (part === 'back') {
      run(yb, x0, x1);
      const r = C.rng(L.seed), a = x0 + 3, b = x1 - 3, top = yb + 3, bot = yf - 4;
      const FL = ['rose', 'gold', 'white', 'plum', 'ember', 'teal'];
      const flower = (x, y, k) => { px(c, 'moss2', x, y + 1); px(c, k, x, y); };
      const soilRow = (y) => rect(c, 'wood2', a, y, b - a + 1, 1);
      if (L.bed === 'flowers') {
        for (let y = top; y <= bot; y += 2) for (let x = a + (y & 2 ? 1 : 0); x <= b; x += 3) if (r() < 0.8) flower(x, y, FL[Math.floor(r() * FL.length)]);
      } else if (L.bed === 'tulips') {
        for (let y = top + 1, row = 0; y <= bot; y += 3, row++) { soilRow(y + 1); for (let x = a; x <= b; x += 2) flower(x, y, FL[(L.hue + row) % 4]); }
      } else if (L.bed === 'veg') {
        for (let y = top + 1, row = 0; y <= bot; y += 4, row++) {
          soilRow(y + 1);
          if (row % 2 === 0) for (let x = a + 1; x <= b - 1; x += 4) { rect(c, 'pine', x - 1, y - 1, 3, 2); px(c, 'moss2', x, y - 1); } // cabbages
          else for (let x = a; x <= b; x += 2) { px(c, 'moss2', x, y - 1); px(c, 'grass', x, y - 2); px(c, 'ember', x, y); } // carrots
        }
      } else if (L.bed === 'pumpkins') {
        for (let x = a; x <= b; x++) px(c, x % 3 ? 'moss2' : 'pine', x, top + 4 + Math.round(Math.sin(x * 0.9) * 1.5));
        const n = W > 18 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const x = a + Math.round((b - a - 4) * (i / (n - 1))), y = top + 3 + (i % 2) * 3;
          rect(c, 'ink', x, y - 1, 5, 5); rect(c, 'ink', x - 1, y, 7, 3);
          rect(c, 'ember', x, y, 5, 3); rect(c, 'ember', x + 1, y - 1 + 1, 3, 3); px(c, 'ember2', x + 2, y); px(c, 'ember2', x + 2, y + 1); px(c, 'gold', x, y);
          px(c, 'pine', x + 2, y - 2);
        }
      } else if (L.bed === 'sunflowers') {
        for (let y = bot - 2; y <= bot; y += 2) for (let x = a + (y & 2 ? 1 : 0); x <= b; x += 3) flower(x, y, 'gold');
        for (let x = a + 1; x <= b - 1; x += 5) {
          const sw = Math.round(Math.sin(t * 1.3 + x) * 0.6), y = top + 1;
          rect(c, 'moss2', x, y, 1, bot - y); px(c, 'moss', x + 1, y + 4);
          px(c, 'gold', x + sw, y - 3); px(c, 'gold', x - 1 + sw, y - 2); px(c, 'wood', x + sw, y - 2); px(c, 'gold', x + 1 + sw, y - 2); px(c, 'gold2', x + sw, y - 1);
        }
      } else if (L.bed === 'beehive') {
        for (let y = top; y <= bot; y += 2) for (let x = a + (y & 2 ? 1 : 0); x <= b; x += 3) if (Math.abs(x - mid) > 4 || y > top + 6) flower(x, y, FL[(((x + y) % 4) + 4) % 4]);
        const hx = mid - 2, hy = top + 5;
        rect(c, 'ink', hx - 1, hy - 5, 7, 6); rect(c, 'ink', hx, hy - 6, 5, 1);
        rect(c, 'gold', hx, hy - 5, 5, 5); rect(c, 'gold2', hx, hy - 3, 5, 1); rect(c, 'gold2', hx, hy - 1, 5, 1); px(c, 'ink', hx + 2, hy - 1);
        for (let i = 0; i < 2; i++) { const bt = t * 2 + i * 2.6; px(c, 'ink', Math.round(mid + Math.sin(bt) * (W / 2 - 4)), Math.round(top + Math.cos(bt * 1.3) * 2)); }
      } else { // herbs round a birdbath
        for (let i = 0; i < 4; i++) { const x = i % 2 ? b - 1 : a + 1, y = i < 2 ? top + 1 : bot; rect(c, 'pine', x - 1, y - 1, 3, 2); px(c, i === 1 ? 'plum' : i === 2 ? 'white' : 'moss2', x, y - 1); }
        const y = (top + bot) >> 1;
        rect(c, 'ink', mid - 3, y - 2, 7, 2); rect(c, 'sea2', mid - 2, y - 2, 5, 1); px(c, 'stone', mid - 3, y - 2); px(c, 'stone', mid + 3, y - 2);
        rect(c, 'stone2', mid, y, 1, 3); rect(c, 'ink', mid - 1, y + 3, 3, 1);
      }
      return;
    }
    side(x0); side(x1);
    if (!L.gate || W < 16) { run(yf, x0, x1); return; }
    // a gate in the middle of the front: two posts and a leaf, shut or swung open into the garden
    const gw = 5, gx = mid - 2;
    run(yf, x0, gx - 2); run(yf, gx + gw + 1, x1);
    const stony = F === 'stone' || F === 'drystone';
    for (const p of [gx - 1, gx + gw]) {
      rect(c, 'ink', p - 1, yf - 8, 3, 9); rect(c, stony ? 'stone' : F === 'iron' ? 'stone2' : 'wood', p, yf - 7, 1, 7);
      px(c, stony ? 'stone3' : F === 'iron' ? 'gold' : 'wood3', p, yf - 8);
    }
    const leaf = F === 'iron' ? 'stone2' : F === 'white' ? 'cream' : F === 'painted' ? L.paint[0] : 'wood3';
    if (L.open) { rect(c, 'ink', gx, yf - 9, 2, 7); rect(c, leaf, gx, yf - 8, 1, 5); }
    else {
      rect(c, 'ink', gx, yf - 6, gw, 6);
      rect(c, leaf, gx, yf - 5, gw, 1); rect(c, leaf, gx, yf - 2, gw, 1);
      for (let i = 0; i < gw; i++) px(c, leaf, gx + i, yf - 2 - Math.round((i * 3) / (gw - 1)));
    }
  }
  function drawYard(c, tx, ty, district, t) {
    const { k, x, y, r } = yardOf(tx, ty, district);
    c.globalAlpha = 0.22;
    if (k !== 'none' && k !== 'garden') rect(c, 'ink', x - 7, y, 14, 2);
    c.globalAlpha = 1;
    if (k === 'tree') {
      rect(c, 'ink', x - 2, y - 6, 4, 6); rect(c, 'wood', x - 1, y - 6, 2, 6);
      for (let yy = -7; yy <= 7; yy++) for (let xx = -7; xx <= 7; xx++) {
        const d = Math.sqrt(xx * xx + yy * yy * 1.2);
        if (d > 7) continue;
        px(c, d > 6.2 ? 'ink' : xx + yy < -3 ? 'grass' : xx + yy > 4 ? 'moss2' : 'moss', x + xx + Math.round(Math.sin(t * 0.8 + tx) * 0.5 * (yy < -2)), y - 12 + yy);
      }
      if (r() < 0.4) { px(c, 'ember', x - 2, y - 13); px(c, 'ember', x + 3, y - 10); px(c, 'ember', x + 1, y - 16); }
    } else if (k === 'bush') { bush(c, x - 4, y, 'grass', 'moss'); bush(c, x + 4, y + 1, 'moss', 'moss2'); px(c, 'rose', x - 5, y - 4); px(c, 'gold', x + 5, y - 3); }
    else if (k === 'garden') {
      rect(c, 'ink', x - 10, y - 10, 20, 11); rect(c, 'wood', x - 9, y - 9, 18, 9);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) { px(c, 'moss2', x - 8 + j * 4, y - 7 + i * 3); px(c, (i + j) % 3 ? 'moss' : 'ember', x - 8 + j * 4, y - 8 + i * 3); }
      for (let i = -10; i <= 9; i += 3) rect(c, 'wood3', x + i, y - 12, 1, 3);
      rect(c, 'wood3', x - 10, y - 11, 20, 1);
    } else if (k === 'shed') {
      rect(c, 'ink', x - 7, y - 9, 14, 10); rect(c, 'wood', x - 6, y - 8, 12, 8); for (let i = 0; i < 12; i += 3) rect(c, 'wood2', x - 6 + i, y - 8, 1, 8);
      rect(c, 'ink', x - 2, y - 6, 5, 6); rect(c, 'wood2', x - 1, y - 5, 3, 5);
      for (let i = 0; i < 5; i++) { rect(c, 'ink', x - 8, y - 14 + i, 16, 1); if (i) rect(c, i > 2 ? 'stone2' : 'stone', x - 7, y - 14 + i, 14, 1); }
    } else if (k === 'laundry') {
      rect(c, 'wood2', x - 8, y - 13, 1, 13); rect(c, 'wood2', x + 8, y - 13, 1, 13); rect(c, 'stone3', x - 8, y - 12, 17, 1);
      ['rose', 'sea3', 'white', 'gold', 'moss'].forEach((n, i) => rect(c, n, x - 7 + i * 3, y - 11, 2, 4 + Math.round(Math.sin(t * 2.4 + i + tx) * 0.7)));
    } else if (k === 'boat') {
      rect(c, 'ink', x - 9, y - 6, 18, 6); rect(c, 'wood', x - 8, y - 5, 16, 4); rect(c, 'wood3', x - 8, y - 5, 16, 1); rect(c, 'sea2', x - 6, y - 2, 12, 1);
      rect(c, 'wood2', x + 4, y - 9, 1, 4);
    } else if (k === 'crates') {
      for (const [dx, dy] of [[-4, 0], [4, 1], [0, -6]]) { rect(c, 'ink', x + dx - 4, y + dy - 7, 8, 7); rect(c, 'wood3', x + dx - 3, y + dy - 6, 6, 5); rect(c, 'wood', x + dx - 3, y + dy - 4, 6, 1); }
    } else if (k === 'woodpile') {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4 - i; j++) { const lx = x - 8 + j * 4 + i * 2, ly = y - 3 - i * 3; rect(c, 'ink', lx - 1, ly - 1, 5, 4); rect(c, 'wood', lx, ly, 3, 2); px(c, 'wood3', lx + 1, ly); }
    } else if (k === 'hay') {
      for (let i = 0; i < 9; i++) { const hw = Math.round(Math.sqrt(1 - ((i - 5) / 6) ** 2) * 7); rect(c, 'ink', x - hw - 1, y - 9 + i, hw * 2 + 2, 1); rect(c, i > 5 ? 'gold2' : 'gold', x - hw, y - 9 + i, hw * 2, 1); }
    } else if (k === 'rocks') {
      for (const [dx, s] of [[-4, 4], [3, 3]]) { rect(c, 'ink', x + dx - s, y - s - 1, s * 2, s + 1); rect(c, 'stone', x + dx - s + 1, y - s, s * 2 - 2, s - 1); rect(c, 'stone3', x + dx - s + 1, y - s, s - 1, 1); }
    }
  }

  // The market square (tiles -3..4, 12..15): a fountain and stalls, once the market is unlocked.
  function stall(c, x, y, awn, goods) {
    c.globalAlpha = 0.22; rect(c, 'ink', x - 11, y, 23, 2); c.globalAlpha = 1;
    rect(c, 'wood2', x - 10, y - 16, 1, 16); rect(c, 'wood2', x + 10, y - 16, 1, 16);
    rect(c, 'ink', x - 11, y - 8, 23, 6); rect(c, 'wood3', x - 10, y - 7, 21, 2); rect(c, 'wood', x - 10, y - 5, 21, 3);
    goods.forEach((g, i) => { rect(c, 'ink', x - 9 + i * 5, y - 10, 5, 3); rect(c, g, x - 8 + i * 5, y - 10, 3, 2); });
    const a = LH.fam(awn);
    rect(c, 'ink', x - 13, y - 22, 27, 7);
    for (let i = 0; i < 25; i++) rect(c, Math.floor(i / 3) % 2 ? 'white' : a[0], x - 12 + i, y - 21, 1, 5);
    for (let i = 0; i < 25; i += 3) px(c, a[1], x - 12 + i, y - 16);
  }
  // a market stall with a plain cloth canopy sloping forward and a fringe, baskets on the table
  function canopyStall(c, x, y, cloth, goods) {
    const f = LH.fam(cloth);
    c.globalAlpha = 0.22; rect(c, 'ink', x - 10, y, 21, 2); c.globalAlpha = 1;
    rect(c, 'wood2', x - 9, y - 15, 1, 15); rect(c, 'wood2', x + 9, y - 15, 1, 15);
    rect(c, 'ink', x - 10, y - 7, 21, 5); rect(c, 'wood', x - 9, y - 6, 19, 3);
    goods.forEach((g, i) => { const bx = x - 8 + i * 6; rect(c, 'ink', bx - 1, y - 10, 6, 4); rect(c, 'wood3', bx, y - 8, 4, 2); rect(c, g, bx, y - 10, 4, 2); });
    for (let i = 0; i < 5; i++) rect(c, 'ink', x - 11 - (i < 1 ? 0 : 0), y - 21 + i, 23, 1);
    rect(c, f[0], x - 10, y - 20, 21, 3); rect(c, f[1], x - 10, y - 17, 21, 1);
    for (let i = 0; i < 21; i += 2) px(c, f[1], x - 10 + i, y - 16);
  }
  // a hand cart with two big wheels and a load of produce
  function cart(c, x, y, goods) {
    c.globalAlpha = 0.22; rect(c, 'ink', x - 10, y, 20, 2); c.globalAlpha = 1;
    rect(c, 'ink', x + 7, y - 6, 8, 2); rect(c, 'wood2', x + 8, y - 6, 7, 1); // handles
    rect(c, 'ink', x - 9, y - 10, 17, 7); rect(c, 'wood3', x - 8, y - 9, 15, 2); rect(c, 'wood', x - 8, y - 7, 15, 3);
    goods.forEach((g, i) => { rect(c, 'ink', x - 8 + i * 4, y - 13, 4, 4); rect(c, g, x - 7 + i * 4, y - 12, 2, 2); });
    for (const wx of [x - 6, x + 4]) { rect(c, 'ink', wx - 3, y - 6, 6, 6); rect(c, 'wood2', wx - 2, y - 5, 4, 4); px(c, 'ink', wx - 1 + 0, y - 3); }
  }
  // crates and barrels stacked by a stall
  function goodsPile(c, x, y) {
    c.globalAlpha = 0.22; rect(c, 'ink', x - 9, y, 18, 2); c.globalAlpha = 1;
    rect(c, 'ink', x - 9, y - 7, 8, 7); rect(c, 'wood3', x - 8, y - 6, 6, 5); rect(c, 'wood', x - 8, y - 4, 6, 1);
    rect(c, 'ink', x - 6, y - 13, 7, 6); rect(c, 'wood3', x - 5, y - 12, 5, 4); rect(c, 'ember', x - 4, y - 13, 3, 1);
    rect(c, 'ink', x, y - 9, 8, 9); rect(c, 'wood', x + 1, y - 8, 6, 7); rect(c, 'stone3', x + 1, y - 6, 6, 1); rect(c, 'stone3', x + 1, y - 3, 6, 1);
  }
  // The market square (2026-11-10, user: not a rectangle with a stall on each corner): a rounded patch
  // of cobbles (map.ground) with the fountain off centre and stalls of different kinds scattered round
  // it, a cart and a pile of goods. The high street (x 2) is kept clear to walk through.
  function marketSquare(add, c, t, Lights) {
    const fx = 0.6 * T, fy = 14.3 * T;
    add(fy, () => {
      for (let yy = -7; yy <= 0; yy++) for (let xx = -13; xx <= 13; xx++) {
        const d = (xx * xx) / 169 + ((yy + 3.5) * (yy + 3.5)) / 16;
        if (d > 1) continue;
        px(c, d > 0.8 ? 'ink' : d > 0.6 ? 'stone3' : 'sea3', fx + xx, fy + yy);
      }
      rect(c, 'ink', fx - 2, fy - 14, 4, 11); rect(c, 'stone3', fx - 1, fy - 13, 2, 10);
      for (let i = 0; i < 6; i++) { const p = ((t * 1.2 + i / 6) % 1); const s = i % 2 ? 1 : -1; px(c, p < 0.5 ? 'foam2' : 'foam', fx + s * Math.round(p * 7), fy - 14 + Math.round(-6 * p + 14 * p * p)); }
    });
    add(13.0 * T, () => stall(c, -1.4 * T, 13.0 * T, 'red', ['sea3', 'sea3', 'stone3', 'sea3']));
    add(13.5 * T, () => canopyStall(c, 4.35 * T, 13.5 * T, 'yellow', ['sand2', 'gold', 'sand']));
    add(15.7 * T, () => canopyStall(c, -1.9 * T, 15.7 * T, 'green', ['moss', 'ember', 'gold']));
    add(15.4 * T, () => stall(c, 4.4 * T, 15.4 * T, 'blue', ['rose', 'plum', 'cream', 'teal']));
    add(15.9 * T, () => cart(c, 0.4 * T, 15.9 * T, ['ember', 'gold', 'moss', 'ember']));
    add(12.7 * T, () => goodsPile(c, 0.6 * T, 12.7 * T));
  }

  LH.bld = { STYLE, TRADE, ICONS, spec, drawBuilding, drawHome, drawCommon, drawYard, yardOf, drawGarden, gardenLook, marketSquare };
})();
