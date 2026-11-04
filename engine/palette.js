// The fixed Last Harbor palette. Every pixel drawn uses one of these names.
// Never add colours ad hoc: if a new colour is truly needed, add a named entry here
// (and never change an existing value, or earlier villagers change colour).
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const PAL = {
    ink: '#1b1724',
    night: '#182544', sea: '#23406e', sea2: '#2f5a8c', sea3: '#4a7fae',
    foam: '#9fd3d6', foam2: '#e4f3ee',
    lantern: '#f2a33c', lantern2: '#c4701f', lanternhi: '#ffd98a',
    ember: '#c4553a', ember2: '#8e3a2a',
    sand: '#e3cc95', sand2: '#c9a96b', sand3: '#a8874f',
    grass: '#87b45a', moss: '#6f9a4a', moss2: '#4e7a3a',
    pine: '#2d4f3d', pine2: '#1f392e',
    wood3: '#b58a5c', wood: '#8c6142', wood2: '#64432f', wood4: '#4a3022',
    fog2: '#cfc8de', fog: '#a9a1c2', fog3: '#7f7899',
    stone3: '#b9b8c4', stone: '#8d8c9c', stone2: '#5f5e72',
    cream: '#efe4cc', white: '#f8f3e8',
    rose: '#e486a6', rose2: '#b9607f',
    plum: '#6c4a86', plum2: '#4c3361',
    teal: '#3c8c88', teal2: '#2a6764',
    gold: '#e6c35c', gold2: '#bf9a3a',
    skin1: '#f5d3b5', skin1s: '#e0ae8c',
    skin2: '#e6b48a', skin2s: '#c98f66',
    skin3: '#c68b5f', skin3s: '#a26c45',
    skin4: '#94603e', skin4s: '#74462b',
    skin5: '#6a4129', skin5s: '#4e2e1c',
  };

  // Colour families an appearance can name (outfitColor, hairColor, part:colour). [base, shade]
  const FAMILY = {
    red: ['ember', 'ember2'], orange: ['lantern', 'lantern2'], yellow: ['gold', 'gold2'],
    blue: ['sea2', 'sea'], navy: ['sea', 'night'], sky: ['sea3', 'sea2'], green: ['moss', 'moss2'],
    pine: ['pine', 'pine2'], teal: ['teal', 'teal2'], purple: ['plum', 'plum2'], pink: ['rose', 'rose2'],
    brown: ['wood', 'wood2'], tan: ['wood3', 'wood'], dark: ['wood2', 'wood4'], cream: ['cream', 'sand2'],
    white: ['white', 'stone3'], grey: ['stone', 'stone2'], silver: ['stone3', 'stone'], black: ['ink', 'ink'],
    sand: ['sand', 'sand2'], fog: ['fog', 'fog3'], foam: ['foam', 'sea3'],
    // hair-only names
    blonde: ['gold', 'gold2'], ginger: ['ember', 'ember2'], auburn: ['ember2', 'wood4'],
  };
  const SKIN = { 1: ['skin1', 'skin1s'], 2: ['skin2', 'skin2s'], 3: ['skin3', 'skin3s'], 4: ['skin4', 'skin4s'], 5: ['skin5', 'skin5s'] };

  // Time-of-day grades (multiplied over the world) and how strongly lights glow.
  const TOD = {
    dawn: { tint: '#f4cdb8', lights: 0.35, beam: 0.25 },
    day: { tint: null, lights: 0, beam: 0 },
    dusk: { tint: '#dba79c', lights: 0.7, beam: 0.5 },
    night: { tint: '#4b5a92', lights: 1, beam: 1 },
  };

  LH.PAL = PAL;
  LH.FAMILY = FAMILY;
  LH.SKIN = SKIN;
  LH.TOD = TOD;
  LH.fam = (name, fallback = 'grey') => FAMILY[name] || FAMILY[fallback];
})();
