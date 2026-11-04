// The sprite part library. Villagers are layered from these grids:
//   body -> outfit -> (neck accessory) -> beard -> hair -> (face accessory) -> hat -> tool, plus a pet.
// Parts are drawn in BODY coordinates: 16 wide, 20 tall, head at rows 3-10, hands at (4,14) and
// (11,14), feet at row 19. A part is { y, rows } ('.' or ' ' = leave the pixel alone).
//
// Letters (fixed):  k E ink · W white · T cream · Y lantern · y lanternhi · U gold · u gold2
//   G stone3 · g stone · j stone2 · w wood3 · d wood · D wood2 · N sand · n sand2
//   F foam · Q sea3 · R ember · r ember2 · P rose · M moss · m moss2 · V fog
// Letters (from the appearance):  S s skin · H h hair · O o outfit · L legs · B boots
//   A a accent: the part's own colour, set per part with "name:colour" (e.g. "beanie:red"),
//   otherwise the part's default `accent`.
//
// GROWING THE LIBRARY: add new parts with new names. Never edit or delete an existing part or
// change what a letter means: every villager who already uses it would change.
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const FIXED = {
    k: 'ink', E: 'ink', W: 'white', T: 'cream', Y: 'lantern', y: 'lanternhi', U: 'gold', u: 'gold2',
    G: 'stone3', g: 'stone', j: 'stone2', w: 'wood3', d: 'wood', D: 'wood2', N: 'sand', n: 'sand2',
    F: 'foam', Q: 'sea3', R: 'ember', r: 'ember2', P: 'rose', M: 'moss', m: 'moss2', V: 'fog',
  };

  const BODY = [
    '................',
    '................',
    '................',
    '.....kkkkkk.....',
    '....kSSSSSSk....',
    '....kSSSSSSk....',
    '....kSSSSSSk....',
    '....kSESSESk....',
    '....kSSSSSSk....',
    '....ksSSSSsk....',
    '.....kkkkkk.....',
    '.....kOOOOk.....',
    '...kOOOOOOOOk...',
    '...kOkOOOOkOk...',
    '...kSkooookSk...',
    '....kkLLLLkk....',
    '.....kLLLLk.....',
    '.....kLkkLk.....',
    '.....kBkkBk.....',
    '......k..k......',
  ];
  const HAND = [11, 14]; // the hand that holds tools (screen right)

  const HAIR = {
    none: { y: 0, rows: [] },
    bald: { y: 4, rows: ['......W.........'] },
    short: { y: 2, rows: [
      '.....kkkkkk.....',
      '....kHHHHHHk....',
      '...kHHHHHHHHk...',
      '...kHhHHHHhHk...',
      '...kH......Hk...',
    ] },
    messy: { y: 1, rows: [
      '.....k..k.k.....',
      '....kHkkHkHk....',
      '...kHHHHHHHHk...',
      '..kHHHHHHHHHHk..',
      '...kHhHhHHhHk...',
      '...kH.h....Hk...',
    ] },
    long: { y: 2, rows: [
      '.....kkkkkk.....',
      '....kHHHHHHk....',
      '...kHHHHHHHHk...',
      '...kHHhHHhHHk...',
      '...kHh....hHk...',
      '...kHk....kHk...',
      '...kHk....kHk...',
      '...kHk....kHk...',
      '...kHhk..khHk...',
      '....kk....kk....',
    ] },
    braids: { y: 2, accent: 'red', rows: [
      '.....kkkkkk.....',
      '....kHHHHHHk....',
      '...kHHHHHHHHk...',
      '...kHHhHHhHHk...',
      '...kHh....hHk...',
      '...kHk....kHk...',
      '...kHk....kHk...',
      '...kHk....kHk...',
      '...kHk....kHk...',
      '...kHk....kHk...',
      '...kAk....kAk...',
      '....k......k....',
    ] },
    ponytail: { y: 2, rows: [
      '.....kkkkkk.....',
      '....kHHHHHHk....',
      '...kHHHHHHHHkk..',
      '...kHhHHHHhHkHk.',
      '...kH......HkHk.',
      '...........kHhk.',
      '............kk..',
    ] },
    bun: { y: 0, rows: [
      '......kkkk......',
      '.....kHhHHk.....',
      '....kkHHHHkk....',
      '....kHHHHHHk....',
      '...kHHHHHHHHk...',
      '...kHhHHHHhHk...',
      '...kH......Hk...',
    ] },
    curly: { y: 1, rows: [
      '....kk.kk.kk....',
      '...kHHkHHkHHk...',
      '..kHHHHHHHHHHk..',
      '..kHHhHHHHhHHk..',
      '..kHHHhHHhHHHk..',
      '..kHH......HHk..',
      '..kHk......kHk..',
      '...k........k...',
    ] },
    mohawk: { y: 0, rows: [
      '.......kk.......',
      '......kHHk......',
      '......kHhk......',
      '.....kkHHkk.....',
      '.......Hh.......',
    ] },
  };

  const BEARD = {
    none: { y: 0, rows: [] },
    stubble: { y: 9, rows: ['....khshhshk....'] },
    mustache: { y: 8, rows: ['......HHHH......'] },
    bigmustache: { y: 7, rows: [
      '...H........H...',
      '...HHHHHHHHHH...',
      '....h......h....',
    ] },
    full: { y: 8, rows: [
      '....kH....Hk....',
      '....kHHhhHHk....',
      '....kHHHHHHk....',
      '.....kHHHHk.....',
      '......kHHk......',
    ] },
    long: { y: 8, rows: [
      '....kH....Hk....',
      '....kHHhhHHk....',
      '....kHHHHHHk....',
      '.....kHHHHk.....',
      '.....kHHHHk.....',
      '.....kHhHHk.....',
      '......kHHk......',
      '.......kk.......',
    ] },
    goatee: { y: 9, rows: [
      '.......HH.......',
      '......kHHk......',
      '.......kk.......',
    ] },
    chops: { y: 6, rows: [
      '....kH....Hk....',
      '....kH....Hk....',
      '....kHH..HHk....',
      '....kHh..hHk....',
    ] },
  };

  const HAT = {
    none: { y: 0, rows: [] },
    cap: { y: 1, accent: 'navy', rows: [
      '......kkkk......',
      '.....kAAAAk.....',
      '....kAAAAAAk....',
      '...kAAAAAAAAk...',
      '...kkkkkkkkkkk..',
    ] },
    beanie: { y: 1, accent: 'red', rows: [
      '......kWWk......',
      '.....kAAAAk.....',
      '....kAAAAAAk....',
      '...kAaAaAaAak...',
      '...kkkkkkkkkk...',
    ] },
    straw: { y: 1, rows: [
      '......kkkk......',
      '.....kNNNNk.....',
      '.....kRRRRk.....',
      '.kkkkNNNNNNkkkk.',
      'kNNNNNNNNNNNNNNk',
      '.kkkkkkkkkkkkkk.',
    ] },
    souwester: { y: 1, accent: 'yellow', rows: [
      '......kkkk......',
      '.....kAAAAk.....',
      '....kAAAAAAk....',
      '...kAaAAAAaAk...',
      '..kaaaaaaaaaak..',
    ] },
    keeper: { y: 1, accent: 'navy', rows: [
      '.....kkkkkk.....',
      '....kAAAAAAk....',
      '....kAAYYAAk....',
      '...kWWWWWWWWk...',
      '...kkkkkkkkkk...',
    ] },
    tricorn: { y: 1, accent: 'black', rows: [
      '..k..........k..',
      '..kAk.kkkk.kAk..',
      '...kAkAAAAkAk...',
      '...kAAAAAAAAk...',
      '....kkkkkkkk....',
    ] },
    chef: { y: -1, rows: [
      '.....kkkkkk.....',
      '....kWWWWWWk....',
      '....kWWWWWWk....',
      '....kWWWWWWk....',
      '.....kWWWWk.....',
      '....kTTTTTTk....',
      '....kkkkkkkk....',
    ] },
    helmet: { y: 1, rows: [
      '.......kk.......',
      '.....kkGGkk.....',
      '....kGGGGGGk....',
      '...kGgGGGGgGk...',
      '...kggggggggk...',
    ] },
    flowers: { y: 3, rows: ['....PMYMPMYM....'] },
    crown: { y: 0, rows: [
      '....k.k..k.k....',
      '....kUkUUkUk....',
      '....kUUUUUUk....',
      '....kuUuUuUk....',
    ] },
    hood: { y: 2, accent: 'fog', rows: [
      '.....kkkkkk.....',
      '....kAAAAAAk....',
      '...kAAAAAAAAk...',
      '...kAa....aAk...',
      '...kA......Ak...',
      '...kA......Ak...',
      '...kA......Ak...',
      '...kAa....aAk...',
      '...kAAkkkkAAk...',
    ] },
    wizard: { y: -3, accent: 'purple', rows: [
      '.........kk.....',
      '........kAk.....',
      '.......kAAk.....',
      '......kAAAk.....',
      '......kAYAAk....',
      '.....kAAAAAk....',
      '....kAAAAAAAk...',
      '.kaaaaaaaaaaaak.',
      '..kkkkkkkkkkkk..',
    ] },
    bandana: { y: 4, accent: 'red', rows: [
      '...kAAAAAAAAk...',
      '...kAaAaAaAakAk.',
    ] },
    tophat: { y: -2, accent: 'black', rows: [
      '.....kkkkkk.....',
      '.....kAAAAk.....',
      '.....kAAAAk.....',
      '.....kRRRRk.....',
      '.....kAAAAk.....',
      '...kkkkkkkkkk...',
    ] },
    catears: { y: 0, accent: 'black', rows: [
      '....k......k....',
      '...kAk....kAk...',
      '...kPAk..kAPk...',
      '....kkkkkkkk....',
    ] },
  };

  // Accessories: layer 'face' is drawn after hair, 'neck' before the beard.
  const ACCESSORY = {
    none: { y: 0, rows: [] },
    glasses: { y: 7, layer: 'face', rows: ['....kkFkkFkk....'] },
    sunglasses: { y: 7, layer: 'face', rows: ['....kkkkkkkk....'] },
    monocle: { y: 6, layer: 'face', accent: 'yellow', rows: [
      '.........k......',
      '........kFk.....',
      '.........k......',
      '..........A.....',
      '..........A.....',
    ] },
    eyepatch: { y: 5, layer: 'face', rows: [
      '....kkkkkkkk....',
      '.....kkk........',
      '.....kkk........',
    ] },
    scarf: { y: 10, layer: 'neck', accent: 'red', rows: [
      '.....kAAAAk.....',
      '....kAAAAAAk....',
      '........Aa......',
      '........aA......',
    ] },
    earring: { y: 9, layer: 'face', accent: 'yellow', rows: ['...........A....'] },
    flower: { y: 2, layer: 'face', rows: [
      '...........P....',
      '..........PYP...',
      '...........P....',
    ] },
    necklace: { y: 11, layer: 'neck', accent: 'yellow', rows: [
      '......AAAA......',
      '.......AA.......',
    ] },
    medal: { y: 12, layer: 'neck', rows: ['........Y.......'] },
    bowtie: { y: 11, layer: 'neck', accent: 'red', rows: ['......AkkA......'] },
  };

  // Outfits are drawn over the body. legs/boots: colour family, or 'accent' / 'outfit'.
  const OUTFIT = {
    tunic: { y: 15, legs: 'grey', boots: 'dark', rows: ['....kkDYDDkk....'] },
    apron: { y: 11, legs: 'dark', boots: 'dark', accent: 'white', rows: [
      '......A..A......',
      '......AAAA......',
      '......AAAA......',
      '......AaaA......',
      '......AAAA......',
      '......AAAA......',
    ] },
    overalls: { y: 11, legs: 'accent', boots: 'dark', accent: 'blue', rows: [
      '......A..A......',
      '......A..A......',
      '......AAAA......',
      '......AaaA......',
    ] },
    coat: { y: 12, legs: 'dark', boots: 'black', rows: [
      '...kOOOOkOOOk...',
      '...kOkOOYOkOk...',
      '...kSkoOYokSk...',
      '....kOOOOOOk....',
      '....kOoOOoOk....',
    ] },
    sweater: { y: 12, legs: 'navy', boots: 'dark', accent: 'cream', rows: [
      '....AAAAAAAA....',
      '................',
      '......AAAA......',
    ] },
    vest: { y: 11, legs: 'brown', boots: 'dark', rows: [
      '.......TT.......',
      '.......TT.......',
      '.......TT.......',
      '.......TT.......',
    ] },
    dress: { y: 14, legs: 'outfit', boots: 'dark', rows: [
      '...kSkOOOOkSk...',
      '....kOOOOOOk....',
      '...kOoOOOOoOk...',
      '...kkkkkkkkkk...',
    ] },
    armor: { y: 12, legs: 'grey', boots: 'black', rows: [
      '...kGGGGGGGGk...',
      '...kGkGgGGkGk...',
      '...kSkggggkSk...',
      '....kkDDDDkk....',
    ] },
    robe: { y: 15, legs: 'outfit', boots: 'dark', rows: [
      '....kOOOOOOk....',
      '....kOOOOOOk....',
      '....kOoOOoOk....',
      '....kkBkkBkk....',
    ] },
  };

  // Tools: two frames, each a grid with its grip point (ax, ay) placed on the hand.
  // rate = frame switches per second; bob = the body bobs on frame 2; glow = light at [x, y] of frame 1.
  const TOOL = {
    none: { rate: 1.2, bob: true, frames: [{ rows: [], ax: 0, ay: 0 }, { rows: [], ax: 0, ay: 0 }] },
    hammer: { rate: 3, bob: true, frames: [
      { ax: 1, ay: 3, rows: ['GGG', 'GgG', '.d.', '.d.'] },
      { ax: 0, ay: 0, rows: ['ddGG', '..Gg'] },
    ] },
    axe: { rate: 2.5, bob: true, frames: [
      { ax: 1, ay: 3, rows: ['GG.', 'Gd.', '.d.', '.d.'] },
      { ax: 0, ay: 0, rows: ['dddG', '..GG'] },
    ] },
    net: { rate: 1.4, bob: true, frames: [
      { ax: 0, ay: 0, rows: ['n.n', 'nnn', 'n.n'] },
      { ax: 0, ay: 1, rows: ['.n.n.n.', 'nnnnnnn', '.n.n.n.', 'nnnnnnn'] },
    ] },
    rod: { rate: 0.8, bob: false, frames: [
      { ax: 0, ay: 5, rows: ['.....k', '....d.', '...d..', '..d...', '.d....', 'd.....'] },
      { ax: 0, ay: 2, rows: ['....dk', '..dd..', 'dd....'] },
    ] },
    rollingpin: { rate: 3, bob: true, frames: [
      { ax: 1, ay: 0, rows: ['kddk'] },
      { ax: 2, ay: 0, rows: ['kddk'] },
    ] },
    broom: { rate: 2.5, bob: true, frames: [
      { ax: 1, ay: 2, rows: ['.d.', '.d.', '.d.', '.d.', 'nnn', 'n.n'] },
      { ax: 0, ay: 2, rows: ['.d.', '.d.', '.d.', '.d.', 'nnn', 'n.n'] },
    ] },
    lute: { rate: 4, bob: true, frames: [
      { ax: 4, ay: 3, rows: ['d.....', '.d....', '..wddk', '..dwdk', '...kk.'] },
      { ax: 4, ay: 2, rows: ['d.....', '.d....', '..wddk', '..dwdk', '...kk.'] },
    ] },
    pitchfork: { rate: 2, bob: true, frames: [
      { ax: 2, ay: 5, rows: ['g.g.g', 'ggggg', '..d..', '..d..', '..d..', '..d..', '..d..'] },
      { ax: 2, ay: 4, rows: ['g.g.g', 'ggggg', '..d..', '..d..', '..d..', '..d..', '..d..'] },
    ] },
    spear: { rate: 1, bob: true, frames: [
      { ax: 2, ay: 6, rows: ['..G..', '.GgG.', '..d..', '..d..', '..d..', '..d..', '..d..', '..d..', '..d..'] },
      { ax: 2, ay: 6, rows: ['..G..', '.GgG.', '..d..', '..d..', '..d..', '..d..', '..d..', '..d..', '..d..'] },
    ] },
    book: { rate: 1.2, bob: false, frames: [
      { ax: 5, ay: 1, rows: ['kTTkTTk', 'kTTkTTk', 'kkkkkkk'] },
      { ax: 5, ay: 1, rows: ['kTTkWWk', 'kTTkWWk', 'kkkkkkk'] },
    ] },
    lantern: { rate: 3, bob: false, glow: [2, 2], frames: [
      { ax: 2, ay: 0, rows: ['..k..', '.kYk.', '.YyY.', '.kYk.'] },
      { ax: 2, ay: 0, rows: ['..k..', '.kyk.', '.yYy.', '.kYk.'] },
    ] },
    basket: { rate: 1.2, bob: true, frames: [
      { ax: 0, ay: 0, rows: ['kddk', 'dnnd', '.dd.'] },
      { ax: 0, ay: 0, rows: ['kddk', 'dnRd', '.dd.'] },
    ] },
    bucket: { rate: 1.2, bob: true, frames: [
      { ax: 1, ay: 0, rows: ['.k.k', 'kggk', 'kQQk', 'kggk'] },
      { ax: 1, ay: 0, rows: ['.k.k', 'kggk', 'kFQk', 'kggk'] },
    ] },
    shovel: { rate: 2, bob: true, frames: [
      { ax: 1, ay: 1, rows: ['.d.', '.d.', '.d.', 'ggg', '.g.'] },
      { ax: 1, ay: 0, rows: ['.d.', '.d.', '.d.', 'ggg', '.g.'] },
    ] },
    paintbrush: { rate: 2.5, bob: false, frames: [
      { ax: 0, ay: 3, rows: ['..R', '..d', '.d.', 'd..'] },
      { ax: 1, ay: 3, rows: ['..R', '..d', '.d.', 'd..'] },
    ] },
    fish: { rate: 2, bob: true, frames: [
      { ax: 0, ay: 1, rows: ['.....k', 'kQQQQk', '.....k'] },
      { ax: 0, ay: 1, rows: ['......', 'kQQQQk', '....kk'] },
    ] },
    oar: { rate: 1.5, bob: true, frames: [
      { ax: 2, ay: 2, rows: ['d....', '.d...', '..d..', '...dd', '...dd'] },
      { ax: 1, ay: 2, rows: ['d....', '.d...', '..d..', '...dd', '...dd'] },
    ] },
    ladle: { rate: 2, bob: true, frames: [
      { ax: 0, ay: 2, rows: ['..gg', '.d..', 'd...'] },
      { ax: 0, ay: 1, rows: ['.d..', 'd.gg'] },
    ] },
  };

  // Pets stand next to their villager. Bottom-centre anchored, two frames.
  const PET = {
    cat: { accent: 'black', frames: [[
      'k.....k..',
      'kAk.kAk..',
      'kAAAAAk..',
      'kAYAYAk..',
      'kAAaAAk..',
      '.kAAAk.k.',
      'kAAAAAkAk',
      'kAAAAAkk.',
      '.kkkkk...',
    ], [
      'k.....k..',
      'kAk.kAk..',
      'kAAAAAk..',
      'kAkAkAk..',
      'kAAaAAk..',
      '.kAAAk..k',
      'kAAAAAk.k',
      'kAAAAAkk.',
      '.kkkkk...',
    ]] },
    dog: { accent: 'tan', frames: [[
      '.kkk.......',
      'kAAAk......',
      'kEAAak.....',
      'kkAAak...k.',
      '.kAAAkkkkAk',
      '..kAAAAAAk.',
      '..kAAAAAAk.',
      '..kAkkkAk..',
      '..kk...kk..',
    ], [
      '.kkk.......',
      'kAAAk......',
      'kEAAak....k',
      'kkAAak...kA',
      '.kPAAkkkkk.',
      '..kAAAAAAk.',
      '..kAAAAAAk.',
      '..kAkkkAk..',
      '..kk...kk..',
    ]] },
    chicken: { frames: [[
      '.R.....',
      'kRk....',
      'YkWk...',
      'kWWWkkk',
      '.kWWWWk',
      '.kWWWk.',
      '..Y.Y..',
    ], [
      '.R.....',
      'kRk....',
      'YkWk...',
      'kWWWkkk',
      '.kWWWWk',
      '.kWWWk.',
      '.Y...Y.',
    ]] },
    crab: { accent: 'red', frames: [[
      'kk....kk',
      'kAk..kAk',
      '.kAAAAk.',
      'kAEAAEAk',
      'k.k..k.k',
    ], [
      'kAk..kAk',
      'kk....kk',
      '.kAAAAk.',
      'kAEAAEAk',
      '.k.kk.k.',
    ]] },
    goat: { frames: [[
      'k.k.......',
      'kgkk......',
      'kWWWk.....',
      'kWEWWkkkk.',
      '.kWWWWWWWk',
      '..kWWWWWWk',
      '..kWkkkWk.',
      '..kWk.kWk.',
      '..kk..kk..',
    ], [
      'k.k.......',
      'kgkk......',
      'kWWWk.....',
      'kWEWWkkkk.',
      '.kWWWWWWWk',
      '..kWWWWWWk',
      '..kWkkkWk.',
      '.kWk...kWk',
      '.kk....kk.',
    ]] },
    cow: { accent: 'ginger', frames: [[
      'G.....G........',
      'kG...Gk........',
      '.kGGGk.kkkkkk..',
      'kaAaAaakAAAAAAk',
      'kAaAaAAAAaAAaAk',
      'kAAAAAAAAAAAAAk',
      'kNNNAAAAaAAAaAk',
      '.kNNkAAAAAAAAk.',
      '..kk.kAAkkkAAk.',
      '.....kAk...kAk.',
      '.....kk....kk..',
    ], [
      'G.....G........',
      'kG...Gk........',
      '.kGGGk.kkkkkk..',
      'kaAaAaakAAAAAAk',
      'kAaAaAAAAaAAaAkA',
      'kAAAAAAAAAAAAAk',
      'kNNNAAAAaAAAaAk',
      '.kNNkAAAAAAAAk.',
      '..kk.kAAkkkAAk.',
      '....kAk.....kAk',
      '....kk......kk.',
    ]] },
    duck: { accent: 'white', frames: [[
      '.kk....',
      'kAEk...',
      'YkAk...',
      'kAAAAkk',
      'kAAaAAk',
      '.kkkkk.',
    ], [
      '.kk....',
      'kAEk...',
      'YkAk..k',
      'kAAAAkk',
      'kAAaAAk',
      '.kkkkk.',
    ]] },
    parrot: { accent: 'green', frames: [[
      '.kkk...',
      'kAEAk..',
      'YkAAk..',
      '.kAaAk.',
      '.kAaAk.',
      '..kAAk.',
      '...kAk.',
      '..Y.Y..',
    ], [
      '.kkk...',
      'kAEAk..',
      'YkAAkk.',
      '.kAaAAk',
      '.kAaAk.',
      '..kAAk.',
      '...kAk.',
      '..Y.Y..',
    ]] },
    sheep: { accent: 'white', frames: [[
      '....kkkkkk.',
      '.kkkAATAAAk',
      'kEEkATAAAAk',
      'kEWEkAAAATk',
      '.kEEkAAAAAk',
      '..kkAAATAAk',
      '...kkkkkkk.',
      '...kEk.kEk.',
      '...kk..kk..',
    ], [
      '....kkkkkk.',
      '.kkkAATAAAk',
      'kEEkATAAAAk',
      'kEWEkAAAATk',
      '.kEEkAAAAAk',
      '..kkAAATAAk',
      '...kkkkkkk.',
      '..kEk...kEk',
      '..kk....kk.',
    ]] },
  };

  // Founder looks (story characters, not viewers).
  const FOUNDERS = {
    morten: { body: 'tall', skin: 2, hair: 'short', hairColor: 'white', beard: 'full', hat: 'keeper:navy', outfit: 'coat', outfitColor: 'navy', accessory: 'none', tool: 'lantern' },
    bram: { body: 'stout', skin: 3, hair: 'bald', hairColor: 'grey', beard: 'bigmustache', hat: 'none', outfit: 'apron:tan', outfitColor: 'red', accessory: 'none', tool: 'hammer' },
  };

  LH.SPR = { FIXED, BODY, HAND, HAIR, BEARD, HAT, ACCESSORY, OUTFIT, TOOL, PET, FOUNDERS };
})();
