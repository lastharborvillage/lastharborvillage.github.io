// Core helpers shared by the browser renderer and the node scripts (loaded as a plain script;
// everything hangs off globalThis.LH). Pure functions only: no Math.random, no Date.
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const clamp01 = (x) => clamp(x, 0, 1);
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const smooth = (a, b, x) => { const p = clamp01((x - a) / (b - a)); return p * p * (3 - 2 * p); };
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  const ei = (x) => x * x * x;
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const eob = (x, s = 1.7) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);

  // mulberry32: rng(seed) -> () => 0..1
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // FNV-1a string hash.
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  // rngFor('villager-id', day) -> seeded rng keyed by any values.
  const rngFor = (...keys) => rng(hashStr(keys.join('|')));
  // Integer-lattice hash -> 0..1
  function h2(x, y, s = 0) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Smooth value noise.
  function vnoise(x, y, s = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  LH.core = { clamp, clamp01, seg, lerp, smooth, eo, ei, eio, eob, rng, hashStr, rngFor, h2, vnoise };
})();
