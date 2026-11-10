// Terrain, districts, house slots and the ship. Pure functions shared by the renderer and the
// node scripts (placement, world-check). Tile coordinates: x east, y south; the harbour is
// near (0, 0); the coast runs east-west; the sea and the fog wall are north (negative y).
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});
  const { smooth, h2, vnoise } = LH.core;

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

  // Farmland: irregular fields instead of a grid. The land is cut into patches around jittered points
  // (each patch is the area nearest to its point, a little wider than tall), with a ragged grass lane
  // where two patches meet. Each patch is a meadow (about one in five) or a field with its own crop
  // and row direction. Returns null (grass) or { crop, dir }.
  const FIELD_CELL = 6;
  const FIELD_CROPS = ['wheat', 'green', 'plowed', 'cabbage', 'lavender', 'wheat', 'green', 'barley'];
  function fieldAt(x, y) {
    const gx = Math.floor(x / FIELD_CELL), gy = Math.floor(y / FIELD_CELL);
    let b1 = Infinity, b2 = Infinity, s = null;
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) {
      const sx = (i + 0.5 + (h2(i, j, 201) - 0.5) * 0.9) * FIELD_CELL, sy = (j + 0.5 + (h2(i, j, 202) - 0.5) * 0.9) * FIELD_CELL;
      const d = (x + 0.5 - sx) ** 2 + ((y + 0.5 - sy) * 1.25) ** 2;
      if (d < b1) { b2 = b1; b1 = d; s = [i, j]; } else if (d < b2) b2 = d;
    }
    if (Math.sqrt(b2) - Math.sqrt(b1) < 0.8 + h2(x, y, 203) * 0.6) return null; // the lane between fields
    if (h2(s[0], s[1], 204) < 0.2) return null; // a meadow
    return { crop: FIELD_CROPS[Math.floor(h2(s[0], s[1], 205) * FIELD_CROPS.length)], dir: h2(s[0], s[1], 206) < 0.55 ? 'h' : 'v' };
  }
  // a field tile needs at least two neighbours of the same field (no lonely one-tile scraps)
  function isField(x, y) {
    const f = fieldAt(x, y);
    if (!f) return false;
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const g = fieldAt(x + dx, y + dy); if (g && g.crop === f.crop && g.dir === f.dir) n++; }
    return n >= 2;
  }
  const fieldKind = (x, y) => { const f = fieldAt(x, y); return f ? f.crop + '-' + f.dir : 'plowed-h'; };

  // Which district's land (biome) a tile looks like: the nearest district, but measured from a point
  // pushed around by smooth noise, so the borders between forest, hills and beach wander instead of
  // running straight (2026-11-10). Only for how the land looks; homes use their own district.
  function biomeAt(x, y, districts = DISTRICTS) {
    const n = (s) => (vnoise(x / 7, y / 7, s) - 0.5) * 9 + (vnoise(x / 2.5, y / 2.5, s + 5) - 0.5) * 2.5;
    return districtAt(x + n(301), y + n(302), districts);
  }
  // Ground type of a land/sea tile.
  function ground(x, y, districts = DISTRICTS) {
    const c = coastY(x);
    if (y < c) return c - y <= 2 ? 'shallow' : 'sea';
    const d = y - c;
    const dist = biomeAt(x, y, districts);
    // the beach is sand all along (the rocky strip by the cliffs is gone, 2026-11-10) and its inland
    // edge wanders: one row deeper here and there, wider on Fog Beach
    const beach = dist === 'fogbeach' ? 3 + Math.floor(vnoise(x / 4, 7, 311) * 2.99) : 1 + (vnoise(x / 3.5, 3, 312) > 0.62 ? 1 : 0);
    if (d <= 1 || (d <= beach && !isRoad(x, y))) return 'sand';
    if (inRect(x, y, [-7, 0, 7, 3])) return 'boards';
    if (inRect(x, y, [8, 0, 23, 3])) return 'yard';
    if (inRect(x, y, [-3, 12, 4, 15])) return 'cobble'; // drawn with a rounded edge (draw.js landTile)
    if (y === 5 && x >= -42 && x <= 34) return 'path'; // coast road
    if (x === 2 && y >= 4 && y <= 40) return 'path'; // high street
    if (dist === 'farms' && isField(x, y)) return 'field';
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
  // Does the front path of the home at hx,hy run on to its right-hand neighbour? Not always (about 1 in
  // 3 rows break), so the lanes are not one long straight line per row (2026-11-10).
  const linksRight = (hx, hy) => h2(hx, hy, 555) >= 0.33;
  // May a home's front path run along tile tx,ty? Not on a road or right beside one (it would run
  // alongside the road as a second, overlapping lane); those homes' door paths go to the road instead.
  const frontPathOK = (tx, ty) => !isRoad(tx, ty) && !isRoad(tx, ty - 1) && !isRoad(tx, ty + 1);
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
    'carpenter', 'pottery', 'watchtower', 'beekeeper', 'cookhouse', 'studio', 'musichall',
    // added 2026-11-08
    'florist', 'barber', 'tinker', 'shop', 'school', 'boathouse', 'wizardtower', 'mushroom',
    // patron-only (only for villagers with "patron": true; not live yet)
    'manor', 'castle'];
  const PATRON_HOME_KINDS = ['manor', 'castle'];

  // Small fixed offsets per plot so houses do not line up perfectly; door -1 left, 0 centre, 1 right.
  function homeLayout(h) {
    const r = LH.core.rng(LH.core.hashStr('plot|' + h.tileX + ',' + h.tileY));
    // dy -8..+1 (2026-11-10, was -2..2): homes sit at different depths in their plot, so a row of
    // houses no longer stands on one line (never further forward: the lane runs in front)
    const dx = Math.round(r() * 12 - 6), dy = Math.round(r() * 9 - 8);
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
      // Distance counts sideways 1.5x (2026-11-08): new homes fill inland below the centre before the
      // row stretches far left and right, so the village grows round, which fills a tall phone frame.
      // Only new homes use this; homes never move.
      list = allSlots.map((s) => ({ x: s.x, y: s.y, d: ((s.x + 1 - c[0]) * 1.5) ** 2 + (s.y + 1 - c[1]) ** 2, a: Math.atan2(s.y + 1 - c[1], s.x + 1 - c[0]) }));
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
  // New homes are placed off the grid (2026-11-10, user: the village looked like a grid). Homes that
  // already have a spot never move (the first villages' homes stay on the old 4x4 plots). A home's
  // "core" is its 2x2 house, the front row below it and the 2x2 yard to its right (x..x+3, y..y+2).
  // A new home's core must be on open land (not the waterline, a reserved area or a road, except the
  // front row may meet a road) and keep one free tile all round from every other core, building,
  // landmark and object. Candidates near the district centre come first (sideways counts 1.5x, so the
  // village grows round), with some noise in the order so homes do not line up in rows.
  let siteList = null;
  const siteCache = new Map();
  const siteOK = (x, y) => {
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 3; dy++) {
      const tx = x + dx, ty = y + dy;
      if (!isLand(tx, ty) || ty < coastY(tx) + 2 || reserved(tx, ty)) return false;
      if (dy < 2 && isRoad(tx, ty)) return false;
    }
    return y > FOG_Y + 4;
  };
  function sites(districtId, districts = DISTRICTS) {
    const d = districts[districtId];
    if (!d) return [];
    const key = d.center.join(',');
    let list = siteCache.get(key);
    if (!list) {
      if (!siteList) {
        siteList = [];
        for (let y = -24; y <= 300; y++) for (let x = -240; x <= 240; x++) if (siteOK(x, y)) siteList.push({ x, y });
      }
      const c = d.center;
      list = siteList.map((q) => ({ x: q.x, y: q.y, d: Math.hypot((q.x + 1 - c[0]) * 1.5, q.y + 1 - c[1]) + h2(q.x, q.y, 401) * 3.2 }));
      list.sort((p, q) => p.d - q.d || p.y - q.y || p.x - q.x);
      siteCache.set(key, list);
    }
    return list;
  }
  const coreTiles = (x, y) => footprint(x, y, 4, 3);
  function placeAll(world) {
    const ds = world.districts || DISTRICTS;
    const used = new Set(); // tiles no new home's core (or the free ring round it) may touch
    const add = (keys) => keys.forEach((k) => used.add(k));
    for (const v of world.villagers) if (v.home && v.home.tileX != null) add(coreTiles(v.home.tileX, v.home.tileY));
    for (const b of world.buildings || []) add(footprint(b.tileX, b.tileY, b.w || 2, b.h || 2));
    for (const l of world.landmarks || []) add(landmarkTiles(l)); // a cave is never built over
    for (const q of world.props || []) add([Math.floor(q.x) + ',' + Math.floor(q.y)]);
    const free = (x, y) => { for (let dx = -1; dx <= 4; dx++) for (let dy = -1; dy <= 3; dy++) if (used.has((x + dx) + ',' + (y + dy))) return false; return true; };
    const from = new Map(); // per district: candidates before this index are taken for good
    const placed = [];
    world.villagers.forEach((v, i) => {
      if (v.home && v.home.tileX != null) return;
      v.home = v.home || {};
      const open = unlocked(world, i + 1);
      if (!v.home.district || !ds[v.home.district] || !open.includes(v.home.district)) v.home.district = 'harbour';
      const list = sites(v.home.district, ds);
      let k = from.get(v.home.district) || 0;
      while (k < list.length && !free(list[k].x, list[k].y)) k++;
      from.set(v.home.district, k);
      if (k >= list.length) throw new Error('no free spot in ' + v.home.district);
      const s = list[k];
      v.home.tileX = s.x; v.home.tileY = s.y;
      add(coreTiles(s.x, s.y));
      placed.push(v.id);
    });
    return placed;
  }

  // The footpaths between the homes, as a set of tiles "x,y" (cached per list of villagers). Every home
  // has a lane along its front row (not on or right beside a road) that always passes its door; homes
  // on the old grid with a right-hand neighbour mostly link to it (linksRight). A home whose lane does
  // not touch the network yet gets a path of its own to the nearest lane, road or the market square,
  // found on the tiles between the houses (2026-11-10, for homes off the grid).
  const pathCache = new WeakMap();
  function homePaths(world) {
    let set = pathCache.get(world.villagers);
    if (set) return set;
    set = new Set();
    const homes = world.villagers.filter((v) => v.home && v.home.tileX != null);
    const occupied = new Set(homes.map((v) => v.home.tileX + ',' + v.home.tileY));
    const blocked = new Set();
    for (const v of homes) footprint(v.home.tileX, v.home.tileY, 4, 2).forEach((k) => blocked.add(k)); // house and yard
    for (const b of world.buildings || []) footprint(b.tileX, b.tileY, b.w || 2, b.h || 2).forEach((k) => blocked.add(k));
    for (const l of world.landmarks || []) landmarkTiles(l).forEach((k) => blocked.add(k));
    const fronts = homes.map((v) => {
      const hx = v.home.tileX, hy = v.home.tileY, L = homeLayout(v.home);
      const door = Math.floor(((hx + 1) * T + L.dx + L.door * 8) / T);
      const own = [];
      const fp = (x) => { if (frontPathOK(x, hy + 2) && !own.includes(x)) own.push(x); };
      fp(hx); fp(hx + 1); fp(door);
      if (occupied.has((hx + 4) + ',' + hy) && linksRight(hx, hy)) { fp(hx + 2); fp(hx + 3); }
      return { v, hy, door, own };
    });
    for (const f of fronts) for (const x of f.own) set.add(x + ',' + (f.hy + 2));
    const isNet = (x, y) => isRoad(x, y) || inRect(x, y, [-3, 12, 4, 15]);
    for (const f of fronts) {
      const y = f.hy + 2;
      const mine = new Set(f.own.map((x) => x + ',' + y));
      const start = f.own.length ? f.own.map((x) => [x, y]) : [[f.door, y]];
      // already joined? (a road beside the door path, or a neighbour's lane touching ours)
      const touches = start.some(([x, yy]) => [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([dx, dy]) => { const k = (x + dx) + ',' + (yy + dy); return isNet(x + dx, yy + dy) || (set.has(k) && !mine.has(k)); }));
      if (touches) continue;
      const prev = new Map(start.map(([x, yy]) => [x + ',' + yy, null]));
      const todo = start.slice();
      let hit = null;
      for (let i = 0; i < todo.length && !hit && i < 3000; i++) {
        const [x, yy] = todo[i];
        // try down/up first, so paths head for the lanes and roads between the rows
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = x + dx, ny = yy + dy, k = nx + ',' + ny;
          if (prev.has(k)) continue;
          if (Math.abs(nx - f.door) > 14 || Math.abs(ny - y) > 12) continue;
          if (blocked.has(k) || !isLand(nx, ny) || ny < coastY(nx) + 1) continue;
          prev.set(k, x + ',' + yy);
          if (isNet(nx, ny) || (set.has(k) && !mine.has(k))) { hit = k; break; }
          todo.push([nx, ny]);
        }
      }
      if (!hit) continue;
      for (let k = prev.get(hit); k; k = prev.get(k)) {
        const [x, yy] = k.split(',').map(Number);
        if (!isRoad(x, yy)) set.add(k);
      }
    }
    pathCache.set(world.villagers, set);
    return set;
  }

  // May the common (well, pond, garden...) on grid plot tx,ty be drawn? Not when a home off the grid
  // stands on it or right beside it.
  const coreCache = new WeakMap();
  function commonFree(world, tx, ty) {
    let set = coreCache.get(world.villagers);
    if (!set) {
      set = new Set();
      for (const v of world.villagers) if (v.home && v.home.tileX != null) footprint(v.home.tileX, v.home.tileY, 4, 3).forEach((k) => set.add(k));
      coreCache.set(world.villagers, set);
    }
    for (let dx = -1; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) if (set.has((tx + dx) + ',' + (ty + dy))) return false;
    return true;
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
  // villagers + the founders' planks + the planks of villagers who left (the ship never shrinks)
  // planks: one per villager, the founders' planks, planks kept by villagers who left, and shared planks
  // (Instagram: every share of an episode adds SHARE_PLANKS; apply.mjs sets ship.sharePlanks)
  const SHARE_PLANKS = 5;
  const planksFor = (world) => world.villagers.length + ((world.ship && world.ship.founderPlanks) || 0) + ((world.ship && world.ship.keptPlanks) || 0) + ((world.ship && world.ship.sharePlanks) || 0);

  // Founders: the first FOUNDER_LIMIT villagers of a village (v0001-v0100) get a gold plaque by their door,
  // forever. Ids are never reused, so a spot never comes back.
  const FOUNDER_LIMIT = 100;
  const idNum = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  const isFounder = (v) => idNum(v.id) >= 1 && idNum(v.id) <= FOUNDER_LIMIT;
  const foundersLeft = (world) => Math.max(0, FOUNDER_LIMIT - Math.max(0, ...world.villagers.map((v) => idNum(v.id)), ...((world.left || []).map((l) => idNum(l.id)))));

  // The district race: homes per open district (the first to story.race.goal wins story.race.reward)
  function raceCounts(world) {
    const ds = world.districts || DISTRICTS;
    return unlocked(world).map((id) => ({ id, name: ds[id].name, homes: world.villagers.filter((v) => v.home && v.home.district === id).length })).sort((a, b) => b.homes - a.homes);
  }

  // Objects viewers can ask for (each has a drawer in engine/draw.js PROPS). New kinds are added here
  // and in PROPS together.
  const PROP_TYPES = ['sign', 'flag', 'bench', 'lamppost', 'barrel', 'crate', 'netrack', 'plankpile', 'sawhorse', 'rowboat', 'buoy'];
  // Is tile (x, y) inside any house plot (house, front path and yard: 2x3 from a plot origin)?
  const inPlot = (x, y) => {
    for (let ox = x - 1; ox <= x; ox++) for (let oy = y - 2; oy <= y; oy++) if (isPlot(ox, oy)) return true;
    return false;
  };
  // Named spots an object can be asked for, in tiles.
  const PLACES = { harbour: [0, 6], quay: [0, 6], board: [1, 6], shipyard: [15, 6], beach: [-10, 1], lighthouse: [27, -1], market: [0, 11], village: [3, 9] };

  // A free tile for a new object near (ax, ay): on land (not the waterline), not on a road, a house
  // plot (a future home must never land on it) or a reserved area, and at least 2 tiles from homes,
  // buildings and other objects. Spirals outward up to 8 tiles; null if nothing is free.
  function freeSpot(world, ax, ay) {
    const taken = [];
    for (const v of world.villagers) if (v.home && v.home.tileX != null) taken.push([v.home.tileX + 0.5, v.home.tileY + 0.5]);
    for (const b of world.buildings || []) taken.push([b.tileX + 0.5, b.tileY + 0.5]);
    for (const p of world.props || []) taken.push([p.x, p.y]);
    const near = (x, y) => taken.some(([tx, ty]) => Math.abs(tx - x) < 2 && Math.abs(ty - y) < 2);
    // never on a home's yard or front row (homes off the grid are not covered by inPlot)
    const cores = new Set();
    for (const v of world.villagers) if (v.home && v.home.tileX != null) footprint(v.home.tileX, v.home.tileY, 4, 3).forEach((k) => cores.add(k));
    const cand = [];
    for (let dx = -8; dx <= 8; dx++) for (let dy = -8; dy <= 8; dy++) cand.push([ax + dx, ay + dy, dx * dx + dy * dy]);
    cand.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    for (const [x, y] of cand) {
      if (!isLand(x, y) || y < coastY(x) + 2 || isRoad(x, y) || reserved(x, y) || inPlot(x, y) || cores.has(x + ',' + y)) continue;
      if (y <= FOG_Y + 2 || near(x + 0.5, y + 0.85)) continue;
      return [x, y];
    }
    return null;
  }

  // Village upgrades: as more villagers move in, the village itself gets better. Each unlocks at a
  // villager count and stays (drawn by renderWorld; the writer is told which one comes next).
  const UPGRADES = [
    { at: 10, id: 'lamps', name: 'street lamps along the main roads' },
    { at: 20, id: 'stonepaths', name: 'stone paths to every door' },
    { at: 30, id: 'fences', name: 'fenced flower and vegetable gardens beside some of the homes' },
    { at: 50, id: 'cobbles', name: 'cobbled main roads' },
    { at: 80, id: 'planters', name: 'benches and flower planters along the high street' },
  ];
  const upgrades = (world) => new Set(UPGRADES.filter((u) => (world.villagers || []).length >= u.at).map((u) => u.id));
  const nextUpgrade = (world) => UPGRADES.find((u) => (world.villagers || []).length < u.at) || null;
  // Upgrades start in the centre (the harbour crossroads) and spread outward: when one unlocks it
  // reaches 6 tiles from the centre, and half a tile further for every villager after that (so with
  // 40 more villagers it covers about 26 tiles). 0 = not started.
  const UPGRADE_CENTRE = [2, 7];
  function upgradeReach(world, id) {
    const u = UPGRADES.find((q) => q.id === id), n = (world.villagers || []).length;
    return u && n >= u.at ? 6 + (n - u.at) * 0.5 : 0;
  }
  const upgradeCovers = (reach, x, y) => reach > 0 && Math.hypot(x - UPGRADE_CENTRE[0], (y - UPGRADE_CENTRE[1]) * 1.2) <= reach;

  // Landmarks: the big changes the story makes to the map ("Slaxx found a cave", "the woodcutters
  // started clearing the forest"). Each has a footprint in tiles (w x h, top-left at tileX/tileY) that
  // no home may ever take; a clearing has none: it only removes trees in a circle that grows with its
  // stage. stage 0 = just found; higher stages mean explored / in use / bigger (drawn differently).
  const LANDMARKS = {
    cave: { w: 3, h: 2 }, clearing: { w: 0, h: 0 }, ruins: { w: 3, h: 3 }, stones: { w: 3, h: 3 },
    mine: { w: 2, h: 2 }, tower: { w: 2, h: 2 }, shrine: { w: 2, h: 2 }, pond: { w: 3, h: 2 },
    garden: { w: 3, h: 2 }, campfire: { w: 2, h: 2 }, pit: { w: 2, h: 2 }, statue: { w: 1, h: 1 },
    // added 2026-11-07 (like-goal rewards and more story places)
    beacon: { w: 2, h: 2 }, windmill: { w: 2, h: 2 }, well: { w: 1, h: 1 }, festival: { w: 3, h: 2 },
    greenhouse: { w: 3, h: 2 }, observatory: { w: 2, h: 2 }, fountain: { w: 2, h: 2 }, belltower: { w: 2, h: 2 },
    treehouse: { w: 2, h: 2 }, balloon: { w: 2, h: 2 }, fishracks: { w: 3, h: 1 }, orchard: { w: 3, h: 3 },
    gate: { w: 2, h: 1 }, maypole: { w: 1, h: 1 }, boat: { w: 3, h: 2 },
    // added 2026-11-10 (by hand, at the user's request: more landmarks)
    bandstand: { w: 2, h: 2 }, hotspring: { w: 3, h: 2 }, wreck: { w: 3, h: 2 }, wishtree: { w: 2, h: 2 }, oven: { w: 2, h: 2 },
    lookout: { w: 2, h: 2 }, apiary: { w: 3, h: 1 }, maze: { w: 3, h: 3 }, sundial: { w: 1, h: 1 }, totem: { w: 1, h: 1 },
  };
  const LANDMARK_TYPES = Object.keys(LANDMARKS);
  // Where landmarks can be asked for (tiles): the places above plus the wild edges of the map.
  const LANDMARK_PLACES = { ...PLACES, forest: [17, 21], cliffs: [-21, 5], farms: [-17, 15], fogbeach: [-36, 3], hill: [29, 6], north: [4, 26] };
  const clearingRadius = (l) => Math.min(11, 2 + (l.stage || 0) * 1.5);
  const landmarkTiles = (l) => {
    const s = LANDMARKS[l.type];
    return s && s.w ? footprint(l.tileX, l.tileY, s.w, s.h) : [];
  };
  // A free top-left tile for a new landmark of this type near (ax, ay): on dry land away from the
  // waterline (the camp lives there), off roads, reserved areas and commons, and with a tile of space
  // around homes (their whole plot), buildings, objects and other landmarks. May take empty house
  // plots: future homes go to the next free one. Spirals out up to 14 tiles; null if nothing fits.
  function landmarkSpot(world, type, ax, ay) {
    const s = LANDMARKS[type];
    if (!s) return null;
    const w = Math.max(1, s.w), h = Math.max(1, s.h);
    const taken = new Set();
    const take = (x0, y0, ww, hh, m) => { for (let x = x0 - m; x < x0 + ww + m; x++) for (let y = y0 - m; y < y0 + hh + m; y++) taken.add(x + ',' + y); };
    for (const v of world.villagers) if (v.home && v.home.tileX != null) take(v.home.tileX - 1, v.home.tileY - 1, 5, 5, 0);
    for (const b of world.buildings || []) take(b.tileX, b.tileY, b.w || 2, b.h || 2, 1);
    for (const p of world.props || []) take(Math.floor(p.x), Math.floor(p.y), 1, 1, 1);
    for (const l of world.landmarks || []) { const q = LANDMARKS[l.type]; if (q && q.w) take(l.tileX, l.tileY, q.w, q.h, 1); }
    const isCommonTile = (x, y) => { for (let ox = x - 1; ox <= x; ox++) for (let oy = y - 2; oy <= y; oy++) if (isCommon(ox, oy)) return true; return false; };
    const ok = (x, y) => isLand(x, y) && y >= coastY(x) + 3 && y > FOG_Y + 3 && !isRoad(x, y) && !reserved(x, y) && !taken.has(x + ',' + y) && !isCommonTile(x, y);
    // nearest first; when the area is crowded the search widens (the map has room far beyond the village)
    for (const R of [14, 30, 60]) {
      const cand = [];
      for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) cand.push([ax + dx, ay + dy, dx * dx + dy * dy]);
      cand.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
      for (const [x, y] of cand) {
        let fits = true;
        for (let i = 0; i < w && fits; i++) for (let j = 0; j < h && fits; j++) if (!ok(x + i, y + j)) fits = false;
        if (fits) return [x, y];
      }
    }
    return null;
  }
  // "frontier-west" / "frontier-east" / "frontier-inland": just past the edge of everything built so far
  // (homes and landmarks), so the story can push the map outward: "beyond the forest we found...".
  function frontier(world, dir) {
    let x0 = -12, x1 = 20, y1 = 14;
    for (const v of world.villagers) if (v.home && v.home.tileX != null) { x0 = Math.min(x0, v.home.tileX); x1 = Math.max(x1, v.home.tileX + 2); y1 = Math.max(y1, v.home.tileY + 2); }
    for (const l of world.landmarks || []) { x0 = Math.min(x0, l.tileX); x1 = Math.max(x1, l.tileX + 3); y1 = Math.max(y1, l.tileY + 3); }
    if (dir === 'west') return [x0 - 8, 8];
    if (dir === 'east') return [x1 + 8, 10];
    if (dir === 'inland') return [4, y1 + 8];
    return null;
  }

  // The followers' camp: every follower (YouTube: subscriber) lives in a tent on the beach, on the two
  // sand rows at the waterline where no house can ever be built. It starts next to the harbour and
  // fills the beach westward, one stretch of coast at a time: the first stretch (x -8..-42) gets one
  // tent per sand tile and then a second pass fills the gaps; then the next stretch further west, all
  // the way along the coast, then the coast east of the lighthouse. Returns up to n spots [x, y, k] in
  // world tiles (k: a stable tent index); fixed order, so a tent never moves when more arrive. The
  // camp grows with the map (about 1,600 tents); beyond CAMP_MAX the counter still shows everyone.
  const CAMP_STRETCHES = [[-8, -42], [-43, -80], [-81, -120], [-121, -160], [-161, -200], [-201, -240], [35, 70], [71, 110], [111, 150], [151, 190], [191, 230]];
  let campSpots = null;
  function buildCamp() {
    const out = [];
    for (const [a, b] of CAMP_STRETCHES) {
      const step = b < a ? -1 : 1;
      for (const [ox0, ox1] of [[0.5, 0.15], [0.0, 0.65]]) {
        for (let x = a; step < 0 ? x >= b : x <= b; x += step) {
          for (const [r, ox] of [[1, ox0], [0, ox1]]) {
            const y = coastY(x) + r;
            if (!isLand(x, y) || reserved(x, y)) continue;
            out.push([x + ox + 0.25, y + 0.75 + (h2(x, r, 61) - 0.5) * 0.15, out.length]);
          }
        }
      }
    }
    return out;
  }
  // How many tents: followers who do not have a house yet. Villagers moved out of their tent into a
  // house (most villagers follow too; the platforms do not say which followers commented).
  const tentsFor = (world, followers) => Math.max(0, (followers || 0) - ((world && world.villagers) || []).length);
  function camp(n) {
    if (!campSpots) campSpots = buildCamp();
    return campSpots.slice(0, Math.max(0, Math.min(n || 0, campSpots.length)));
  }
  const CAMP_MAX = buildCamp().length;

  // Daily work (2026-11-08): villagers walk off to a work spot, work there a while and walk home again
  // (engine/draw.js workPlan). A villager's `work` is one of WORK_TYPES (set from a comment: "I set fish
  // traps" -> "traps"); without it the work follows from their `job` words (fisher -> fishing), and
  // "none" means they only potter about at home. Nobody works at night.
  const WORKS = {
    traps: { at: 'shore', label: 'sets and hauls fish traps in the shallows' },
    fishing: { at: 'shore', label: 'fishes with a rod from the beach' },
    beachcomb: { at: 'shore', label: 'combs the beach for shells and driftwood' },
    farm: { at: 'field', label: 'hoes the fields' },
    haul: { at: 'shipyard', label: 'carries planks to the shipyard' },
    chop: { at: 'home', label: 'chops firewood in the yard' },
    laundry: { at: 'home', label: 'hangs out the washing' },
    garden: { at: 'home', label: 'waters the herb and flower beds' },
    sweep: { at: 'home', label: 'sweeps the path' },
    music: { at: 'home', label: 'plays music on a stool outside' },
    patrol: { at: 'road', label: 'walks the coast road on watch' },
  };
  const WORK_TYPES = Object.keys(WORKS);
  const WORK_WORDS = [
    [/trap|lobster|crab/, 'traps'], [/fish|angler/, 'fishing'],
    [/farm|vegetable|crop|harvest|shepherd|orchard/, 'farm'], [/wood ?chop|woodcut|lumber|forester|logger/, 'chop'],
    [/carpenter|shipwright|builder|joiner|mason|sailor|dock/, 'haul'],
    [/herb|healer|apothecar|witch|druid|beekeep|gardener|florist|botan/, 'garden'],
    [/bard|music|singer|lute|minstrel|drummer|piper|fiddl/, 'music'], [/tailor|seamstress|weaver|laundr|washer/, 'laundry'],
    [/guard|watch(?!maker)|soldier|sellsword|knight|\branger|hunter|sheriff|patrol|sentry/, 'patrol'],
    [/collector|scaveng|beachcomb|treasure|explorer|pirate|shell/, 'beachcomb'],
    [/innkeep|tavern|baker|cook|cleaner|maid|caretaker|janitor|butler/, 'sweep'],
  ];
  function workOf(v) {
    if (!v || v.work === 'none') return null;
    if (WORKS[v.work]) return v.work;
    const j = String(v.job || '').toLowerCase();
    const m = WORK_WORDS.find(([re]) => re.test(j));
    return m ? m[1] : null;
  }
  // Where the work happens, in world pixels (feet): { x, y, stops: [[x, y], ...] (where they work), face }.
  // Shore work is at the waterline: the harbour beach between the docks first, then the camp beach
  // (never on a dock, the slipway or the headland); field work in the nearest field; home work beside
  // their own door; patrol along the coast road.
  const SHORE_X = [];
  for (let x = -60; x <= 60; x++) if (!(x >= -4 && x <= -3) && !(x >= 3 && x <= 4) && !(x >= 9 && x <= 33)) SHORE_X.push(x);
  function workSpot(world, v, work = workOf(v)) {
    if (!work || !v.home || v.home.tileX == null) return null;
    const r = LH.core.rng(LH.core.hashStr('workspot|' + v.id + '|' + work));
    const [hx, hy] = homeSpot(v);
    const htx = Math.floor(hx / T);
    const side = r() < 0.5 ? -1 : 1;
    const at = WORKS[work].at;
    if (at === 'shore') {
      const xs = SHORE_X.slice().sort((a, b) => Math.abs(a - htx) - Math.abs(b - htx) || a - b);
      const x = xs[Math.floor(r() * 6)];
      const px0 = x * T + 8, py0 = coastY(x) * T + 3;
      const stops = work === 'beachcomb' ? [[px0, py0 + 6], [px0 - 18, coastY(x - 1) * T + 9], [px0 - 34, coastY(x - 2) * T + 7]] : work === 'traps' ? [[px0, py0], [px0 + 14, coastY(x + 1) * T + 3]] : [[px0, py0]];
      return { x: px0, y: py0, stops, face: work === 'fishing' ? side : 1, work };
    }
    if (at === 'field') {
      const ds = world.districts || DISTRICTS;
      for (let R = 1; R <= 40; R++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== R) continue;
        const x = htx + dx, y = Math.floor(hy / T) + dy;
        if (ground(x, y, ds) !== 'field' || inPlot(x, y) || ground(x + 1, y, ds) !== 'field') continue;
        if (r() < 0.6) continue; // not everyone in the same corner of the field
        return { x: x * T + 8, y: y * T + 10, stops: [[x * T + 8, y * T + 10], [x * T + 24, y * T + 10]], face: 1, work };
      }
      return { x: hx + side * 20, y: hy, stops: [[hx + side * 20, hy]], face: -side, work }; // no field near: the yard
    }
    if (at === 'shipyard') {
      const x = (9 + Math.floor(r() * 6)) * T + 8, y = 4 * T + 10;
      return { x, y, stops: [[x, y]], face: 1, work };
    }
    if (at === 'road') {
      const a = hx - (4 + r() * 4) * T, b = hx + (4 + r() * 4) * T, y = 5 * T + 10;
      return { x: a, y, stops: [[a, y], [b, y]], face: 1, work };
    }
    // at home: beside the door (the front path and the side lane are always free)
    const x = hx + side * 20;
    const stops = work === 'sweep' ? [[hx - 14, hy + 2], [hx + 14, hy + 2]] : [[x, hy]];
    return { x, y: hy, stops, face: -side, work };
  }
  // A walking route between two points (world pixels) around houses, buildings, landmarks and water:
  // a breadth-first search over tiles, returned as the corner points (pixels) from a to b.
  function route(world, a, b) {
    const ta = [Math.floor(a[0] / T), Math.floor(a[1] / T)], tb = [Math.floor(b[0] / T), Math.floor(b[1] / T)];
    const blocked = new Set();
    for (const v of world.villagers || []) if (v.home && v.home.tileX != null) footprint(v.home.tileX, v.home.tileY).forEach((k) => blocked.add(k));
    for (const q of world.buildings || []) footprint(q.tileX, q.tileY, q.w || 2, q.h || 2).forEach((k) => blocked.add(k));
    for (const l of world.landmarks || []) landmarkTiles(l).forEach((k) => blocked.add(k));
    const x0 = Math.min(ta[0], tb[0]) - 8, x1 = Math.max(ta[0], tb[0]) + 8, y0 = Math.min(ta[1], tb[1]) - 6, y1 = Math.max(ta[1], tb[1]) + 6;
    const free = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && !blocked.has(x + ',' + y) && (y >= coastY(x) || (x === tb[0] && y === tb[1]));
    const key = (x, y) => x + ',' + y;
    const prev = new Map([[key(ta[0], ta[1]), null]]);
    const todo = [ta];
    let found = ta[0] === tb[0] && ta[1] === tb[1];
    for (let i = 0; i < todo.length && !found; i++) {
      const [x, y] = todo[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (prev.has(k) || !free(nx, ny)) continue;
        prev.set(k, key(x, y));
        if (nx === tb[0] && ny === tb[1]) { found = true; break; }
        todo.push([nx, ny]);
      }
    }
    if (!found) return [a, b];
    const tiles = [];
    for (let k = key(tb[0], tb[1]); k; k = prev.get(k)) tiles.unshift(k.split(',').map(Number));
    const pts = [a];
    for (let i = 1; i < tiles.length - 1; i++) {
      const [px0, py0] = tiles[i - 1], [px1, py1] = tiles[i], [px2, py2] = tiles[i + 1];
      if (px1 - px0 !== px2 - px1 || py1 - py0 !== py2 - py1) pts.push([px1 * T + 8, py1 * T + 10]); // a corner
    }
    pts.push(b);
    return pts;
  }

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
      if (!isSlot(h.tileX, h.tileY) && !siteOK(h.tileX, h.tileY)) p.push(who + ': home ' + h.tileX + ',' + h.tileY + ' is not a valid house spot'); // old grid plot or a spot off the grid
      if (h.kind && !HOME_KINDS.includes(h.kind)) p.push(who + ': unknown home kind "' + h.kind + '" (' + HOME_KINDS.join(', ') + ')');
      claim(footprint(h.tileX, h.tileY), who);
    });
    const planks = planksFor(world);
    if (!world.ship || world.ship.planks !== planks) p.push('ship.planks is ' + (world.ship && world.ship.planks) + ' but villagers + founder planks = ' + planks);
    else if (world.ship.stage !== shipStage(planks).id) p.push('ship.stage should be ' + shipStage(planks).id);
    return p;
  }

  LH.map = { commonFree, homePaths, frontPathOK, biomeAt, linksRight, T, FOG_Y, PLOT, DISTRICTS, RESERVED, coastY, isLand, districtAt, ground, slots, isSlot, isPlot, isCommon, isRoad, HOME_KINDS, PATRON_HOME_KINDS, homeLayout, footprint, unlocked, placeAll, homeSpot, SHIP_STAGES, SHIP_GOAL, shipStage, planksFor, SHARE_PLANKS, FOUNDER_LIMIT, isFounder, foundersLeft, raceCounts, check, PROP_TYPES, PLACES, inPlot, freeSpot, camp, tentsFor, CAMP_MAX, LANDMARKS, LANDMARK_TYPES, LANDMARK_PLACES, landmarkSpot, landmarkTiles, clearingRadius, frontier, LANDMARK_MAX_STAGE: 6, fieldAt, fieldKind, UPGRADES, upgrades, nextUpgrade, upgradeReach, upgradeCovers, UPGRADE_CENTRE, WORKS, WORK_TYPES, workOf, workSpot, route };
})();
