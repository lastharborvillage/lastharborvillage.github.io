// Screen-space UI drawn over the scaled world: name tags (pixel font on a dark plate).
(function () {
  const LH = globalThis.LH;
  const { PAL } = LH;

  // Pixel anchor badge for crew members (drawn at 3x).
  const ANCHOR = [
    '..kkk..',
    '..kGk..',
    '..kkk..',
    '...G...',
    'kGGGGGk',
    '...G...',
    'G..G..G',
    'GG.G.GG',
    '.GGGGG.',
  ];

  function plate(ctx, x, y, w, h, a = 0.88) {
    ctx.fillStyle = 'rgba(27,23,36,' + a + ')';
    ctx.fillRect(x + 4, y, w - 8, h);
    ctx.fillRect(x, y + 4, w, h - 8);
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }

  // Draws a name tag whose pointer tip is at (sx, sy). Returns its box {x, y, w, h}.
  function nameTag(ctx, text, sx, sy, o = {}) {
    const fs = o.size || 26;
    ctx.font = (o.weight || 600) + ' ' + fs + 'px "Pixelify Sans"';
    const tw = Math.ceil(ctx.measureText(text).width);
    const pad = Math.round(fs * 0.35), badge = o.crew ? Math.round(fs * 0.95) : 0;
    const w = tw + pad * 2 + badge, h = Math.round(fs * 1.35);
    const x = Math.round(sx - w / 2), y = Math.round(sy - h - 8);
    plate(ctx, x, y, w, h, o.alpha);
    // a patron's name tag has a gold edge (o.patron; only villagers with "patron": true)
    if (o.patron) { ctx.fillStyle = PAL.gold; ctx.fillRect(x + 4, y, w - 8, 2); ctx.fillRect(x + 4, y + h - 2, w - 8, 2); ctx.fillRect(x, y + 4, 2, h - 8); ctx.fillRect(x + w - 2, y + 4, 2, h - 8); }
    ctx.fillStyle = 'rgba(27,23,36,0.88)';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(sx) - 4 + i, y + h + i * 2 - 1, 8 - i * 2, 2);
    if (o.crew) {
      const s = Math.max(2, Math.round(fs / 9));
      ANCHOR.forEach((row, r) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        ctx.fillStyle = ch === 'k' ? PAL.lantern : PAL.lanternhi;
        ctx.fillRect(x + pad - 2 + i * s, y + (h - 9 * s) / 2 + r * s, s, s);
      }));
    }
    ctx.fillStyle = o.color || PAL.cream;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad + badge, y + h / 2 + 1);
    return { x, y, w, h: h + 8 };
  }

  LH.ui = { nameTag, plate };
})();
