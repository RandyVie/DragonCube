// Balance check: node simulate.js [paid games]
// Plays a long session with the hint strategy (good skill), keeping the 7-face
// collection between games, and reports RTP for each wish choice.
const R = require('./rules.js');
const N = +process.argv[2] || 200000;

// one game; returns { prize (x stake), faces }
function game(mode, collected) {
  const grids = R.emptyGrids();
  for (let t = 0; t < R.COLUMNS_PER_GAME; t++) {
    const col = R.rollColumn(mode);
    const g = R.bestGrid(grids, col, collected);
    grids[g][R.nextFreeCol(grids[g])] = col;
  }
  const ev = R.evaluateAll(grids);
  return { prize: R.prizeFor(ev.total), faces: ev.faces };
}

// perfect play: take an offer only when it beats the expected value of continuing
const offerT = R.TREASURE_OFFERS.reduce((a, [, w]) => a + w, 0);
const keepAbove = [];
let ev = R.TREASURE_OFFERS.reduce((a, [v, w]) => a + v * w, 0) / offerT;
for (let r = R.TREASURE_ROUNDS - 2; r >= 0; r--) {
  keepAbove[r] = ev;
  ev = R.TREASURE_OFFERS.reduce((a, [v, w]) => a + Math.max(v, ev) * w, 0) / offerT;
}
function treasure() {
  for (let i = 0; i < R.TREASURE_ROUNDS; i++) {
    const o = R.rollOffer();
    if (i === R.TREASURE_ROUNDS - 1 || o >= keepAbove[i]) return o;
  }
}

function wish(kind) {
  if (kind === 'treasure') return treasure();
  let w = 0;
  const n = kind === 'free' ? R.FREE_GAMES : R.WILD_GAMES;
  for (let i = 0; i < n; i++) w += game(kind === 'free' ? 'base' : 'wild', null).prize;
  return w;
}

const out = {};
for (const kind of R.WISHES) {
  let base = 0, bonus = 0, summons = 0, hits = 0;
  const collected = new Set();
  for (let i = 0; i < N; i++) {
    const r = game('base', collected);
    base += r.prize; hits += r.prize > 0;
    r.faces.forEach(f => f <= 7 && collected.add(f));
    if (collected.size === 7) { summons++; bonus += wish(kind); collected.clear(); }
  }
  out[kind] = { base, bonus, summons, hits };
  console.log(`${kind.padEnd(8)} RTP ${(100 * (base + bonus) / N).toFixed(2)}%  (base ${(100 * base / N).toFixed(1)}% + wish ${(100 * bonus / N).toFixed(1)}%)  ` +
    `hit ${(100 * hits / N).toFixed(1)}%  summon 1 in ${(N / summons).toFixed(1)} games  avg wish ${(bonus / summons).toFixed(2)}x`);
}
