// Terrain, districts, house slots and the ship. Pure functions shared by the renderer and the
// node scripts (placement, world-check). Tile coordinates: x east, y south; the harbour is
// near (0, 0); the coast runs east-west; the sea and the fog wall are north (negative y).
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});
  const { smooth, h2 } = LH.core;

  const T = 16; // tile size in native pixels
  const FOG_Y = -15; // tile row where the fog wall starts

  // Default districts (copied into world.json on day 1; world.json is the source of truth).
  const DISTRICTS = {
    harbour: { name: 'The Harbour', center: [0, 6], unlockAt: 0, style: 'hut' },
    shipyard: { name: 'The Shipyard', center: [15, 6], unlockAt: 0, style: 'workshop' },
    market: { name: null, center: [0, 17], unlockAt: 25, style: 'timber' },
    farms: { name: null, center: [-17, 15], unlockAt: 75, style: 'farmhouse' },
    lighthouse: { name: null, center: [29, 5], unlockAt: 150, style: 'stone' },
    cliffs: { name: null, center: [-21, 3], unlockAt: 300, style: 'cottage' },
    forest: { name: null, center: [17, 20], unlockAt: 600, style: 'cabin' },
    fogbeach: { name: null, center: [-38, 0], unlockAt: 600, style: 'stilt' },
  };

  // Areas where no house may ever be built [x0, y0, x1, y1] inclusive.
  const RESERVED = [
    [-7, -1, 7, 4], // harbour front: docks, board, boats
    [8, -1, 23, 4], // shipyard: slipway, workshop
    [24, -12, 33, -2], // lighthouse headland
    [-3, 12, 4, 15], // market square
  ];

  // Row of the first land tile in column x.
  function coastY(x) {
    const wig = 1.6 * Math.sin(x * 0.21 + 0.7) + 0.9 * Math.sin(x * 0.53 + 2.3);
    const w = Math.max(smooth(-8, -14, x), smooth(23, 26, x));
    let c = w * wig;
    c -= 8 * Math.exp(-Math.pow((x - 28) / 4, 2)); // lighthouse headland
    c -= 5 * Math.exp(-Math.pow((x + 39) / 5, 2));
    return Math.round(c);
  }
  const isLand = (x, y) => y >= coastY(x);
  const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  const reserved = (x, y) => RESERVED.some((r) => inRect(x, y, r));

  // Nearest district centre (Voronoi over all districts, locked or not, so regions never move).
  function districtAt(x, y, districts = DISTRICTS) {
    let best = null, bd = Infinity;
    for (const id in districts) {
      const c = districts[id].center;
      const d = (x - c[0]) ** 2 + (y - c[1]) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  // Ground type of a land/sea tile.
  function ground(x, y, districts = DISTRICTS) {
    const c = coastY(x);
    if (y < c) return c - y <= 2 ? 'shallow' : 'sea';
    const d = y - c;
    const dist = districtAt(x, y, districts);
    if (dist === 'fogbeach' && d <= 4) return 'sand';
    if (dist === 'cliffs' && d <= 1 && x < -14) return 'rock';
    if (d <= 1) return 'sand';
    if (inRect(x, y, [-7, 0, 7, 3])) return 'boards';
    if (inRect(x, y, [8, 0, 23, 3])) return 'yard';
    if (inRect(x, y, [-3, 12, 4, 15])) return 'cobble';
    if (y === 5 && x >= -42 && x <= 34) return 'path'; // coast road
    if (x === 2 && y >= 4 && y <= 40) return 'path'; // high street
    if (dist === 'farms' && (y % 3 !== 2) && (((x % 3) + 3) % 3 !== 2)) return 'field';
    if (dist === 'forest') return 'darkgrass';
    if (dist === 'lighthouse' || dist === 'cliffs') return h2(x, y, 7) < 0.25 ? 'rockgrass' : 'grass';
    return 'grass';
  }

  // House slots: 2x2 footprints on a 3-tile grid (lanes at x%3==2 and y%3==2 stay free).
  // A district is a neighbourhood, not a fence: its homes take the free slots nearest to its
  // centre, so every district grows outward in rings and neighbouring districts blend at the
  // edges. The order is fixed, so placement is deterministic.
  // Rows of plots are staggered (every other row shifts one tile east), so streets do not form a
  // chessboard; about one plot in six is a common (well, garden, pond...) and never gets a house.
  let allSlots = null;
  const mod = (a, n) => ((a % n) + n) % n;
  const isRoad = (x, y) => (y === 5 && x >= -42 && x <= 34) || (x === 2 && y >= 4 && y <= 40);
  // Plots are 4x4 tiles: the 2x2 house, its front path row, and room for a side yard and a back
  // garden. Every other row shifts two tiles (a brick pattern).
  const PLOT = 4;
  const isPlot = (x, y) => {
    if (mod(y - 2, PLOT) !== 0 || mod(x - mod((y - 2) / PLOT, 2) * 2, PLOT) !== 0) return false;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) {
      if (!isLand(x + dx, y + dy) || y + dy < coastY(x + dx) + 2 || reserved(x + dx, y + dy)) return false;
      if (dy < 2 && isRoad(x + dx, y + dy)) return false;
    }
    return true;
  };
  const isCommon = (x, y) => isPlot(x, y) && h2(x, y, 77) < 0.16;
  const isSlot = (x, y) => isPlot(x, y) && !isCommon(x, y);

  // Home kinds: the building a villager lives in, chosen from their job ('house' if none fits).
  const HOME_KINDS = ['house', 'forge', 'bakery', 'fishhut', 'barn', 'tavern', 'library', 'apothecary', 'tailor',
    'carpenter', 'pottery', 'watchtower', 'beekeeper', 'cookhouse', 'studio', 'musichall'];

  // Small fixed offsets per plot so houses do not line up perfectly; door -1 left, 0 centre, 1 right.
  function homeLayout(h) {
    const r = LH.core.rng(LH.core.hashStr('plot|' + h.tileX + ',' + h.tileY));
    const dx = Math.round(r() * 12 - 6), dy = Math.round(r() * 4 - 2);
    const door = h.kind === 'watchtower' ? 1 : [-1, 0, 0, 1][Math.floor(r() * 4)];
    return { dx, dy, door, seed: Math.floor(r() * 1e9) };
  }
  const slotCache = new Map();
  function slots(districtId, districts = DISTRICTS) {
    const d = districts[districtId];
    if (!d) return [];
    const key = d.center.join(',');
    let list = slotCache.get(key);
    if (!list) {
      if (!allSlots) {
        allSlots = [];
        for (let y = -24; y <= 300; y += 1) for (let x = -240; x <= 240; x += 1) if (isSlot(x, y)) allSlots.push({ x, y });
      }
      const c = d.center;
      list = allSlots.map((s) => ({ x: s.x, y: s.y, d: (s.x + 1 - c[0]) ** 2 + (s.y + 1 - c[1]) ** 2, a: Math.atan2(s.y + 1 - c[1], s.x + 1 - c[0]) }));
      list.sort((p, q) => p.d - q.d || p.a - q.a || p.x - q.x);
      slotCache.set(key, list);
    }
    return list;
  }

  // Tiles covered by a 2x2 home or building.
  const footprint = (x, y, w = 2, h = 2) => {
    const out = [];
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push((x + dx) + ',' + (y + dy));
    return out;
  };

  function unlocked(world, count = world.villagers.length) {
    const ds = world.districts || DISTRICTS;
    return Object.keys(ds).filter((id) => count >= ds[id].unlockAt);
  }

  // Gives every villager without a tile a home: the first free slot of its district (which must
  // be unlocked when the villager is added; otherwise the harbour). Never moves existing homes.
  function placeAll(world) {
    const ds = world.districts || DISTRICTS;
    const used = new Set();
    for (const v of world.villagers) if (v.home && v.home.tileX != null) footprint(v.home.tileX, v.home.tileY).forEach((k) => used.add(k));
    for (const b of world.buildings || []) footprint(b.tileX, b.tileY, b.w || 2, b.h || 2).forEach((k) => used.add(k));
    const placed = [];
    world.villagers.forEach((v, i) => {
      if (v.home && v.home.tileX != null) return;
      v.home = v.home || {};
      const open = unlocked(world, i + 1);
      if (!v.home.district || !ds[v.home.district] || !open.includes(v.home.district)) v.home.district = 'harbour';
      const s = slots(v.home.district, ds).find((p) => !footprint(p.x, p.y).some((k) => used.has(k)));
      if (!s) throw new Error('no free slot in ' + v.home.district);
      v.home.tileX = s.x; v.home.tileY = s.y;
      footprint(s.x, s.y).forEach((k) => used.add(k));
      placed.push(v.id);
    });
    return placed;
  }

  // Where a villager stands: in front of their door. World pixels (feet).
  const homeSpot = (v) => {
    const L = homeLayout(v.home);
    return [(v.home.tileX + 1) * T + L.dx + L.door * 8, (v.home.tileY + 2) * T + 9 + L.dy];
  };

  // The ship.
  const SHIP_STAGES = [
    { id: 'none', at: 0 }, { id: 'keel', at: 1 }, { id: 'ribs', at: 40 }, { id: 'hull', at: 120 },
    { id: 'deck', at: 300 }, { id: 'mast', at: 500 }, { id: 'sails', at: 700 }, { id: 'flag', at: 900 },
  ];
  const SHIP_GOAL = 1000;
  function shipStage(planks) {
    let s = 0;
    for (let i = 0; i < SHIP_STAGES.length; i++) if (planks >= SHIP_STAGES[i].at) s = i;
    const next = SHIP_STAGES[s + 1] ? SHIP_STAGES[s + 1].at : SHIP_GOAL;
    return { index: s, id: SHIP_STAGES[s].id, progress: Math.min(1, (planks - SHIP_STAGES[s].at) / Math.max(1, next - SHIP_STAGES[s].at)) };
  }
  const planksFor = (world) => world.villagers.length + ((world.ship && world.ship.founderPlanks) || 0);

  // World validation. Returns a list of problems (empty = OK).
  function check(world) {
    const p = [];
    const ds = world.districts || DISTRICTS;
    const ids = new Set();
    const tiles = new Map();
    const accounts = new Set();
    const claim = (keys, who) => keys.forEach((k) => { if (tiles.has(k)) p.push(who + ' overlaps ' + tiles.get(k) + ' at tile ' + k); else tiles.set(k, who); });
    for (const b of world.buildings || []) claim(footprint(b.tileX, b.tileY, b.w || 2, b.h || 2), 'building ' + b.type);
    world.villagers.forEach((v, i) => {
      const who = 'villager ' + v.id;
      if (!v.id) p.push('villager #' + i + ' has no id');
      if (ids.has(v.id)) p.push('duplicate villager id ' + v.id);
      ids.add(v.id);
      if (!v.displayName || v.displayName.length > 14) p.push(who + ': displayName must be 1-14 characters');
      if (!v.say) p.push(who + ': missing "say"');
      if (!v.job || !v.trait) p.push(who + ': missing job or trait');
      if (v.trait && v.trait.split(/\s+/).length > 12) p.push(who + ': trait is over 12 words');
      if (!v.appearance) p.push(who + ': missing appearance');
      const acc = v.source && v.source.authorChannelId;
      if (acc) { if (accounts.has(acc)) p.push(who + ': second villager for the same account'); accounts.add(acc); }
      const h = v.home;
      if (!h || h.tileX == null) { p.push(who + ': has no home tile (run placement)'); return; }
      if (!ds[h.district]) { p.push(who + ': unknown district ' + h.district); return; }
      if (ds[h.district].unlockAt > i + 1 && !v.founder) p.push(who + ': district ' + h.district + ' was still locked when they joined');
      if (!isSlot(h.tileX, h.tileY)) p.push(who + ': home ' + h.tileX + ',' + h.tileY + ' is not a valid house slot');
      if (h.kind && !HOME_KINDS.includes(h.kind)) p.push(who + ': unknown home kind "' + h.kind + '" (' + HOME_KINDS.join(', ') + ')');
      claim(footprint(h.tileX, h.tileY), who);
    });
    const planks = planksFor(world);
    if (!world.ship || world.ship.planks !== planks) p.push('ship.planks is ' + (world.ship && world.ship.planks) + ' but villagers + founder planks = ' + planks);
    else if (world.ship.stage !== shipStage(planks).id) p.push('ship.stage should be ' + shipStage(planks).id);
    return p;
  }

  LH.map = { T, FOG_Y, PLOT, DISTRICTS, RESERVED, coastY, isLand, districtAt, ground, slots, isSlot, isPlot, isCommon, isRoad, HOME_KINDS, homeLayout, footprint, unlocked, placeAll, homeSpot, SHIP_STAGES, SHIP_GOAL, shipStage, planksFor, check };
})();
