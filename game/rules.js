/* Dragon Cube — game rules (shared by the browser game and the balance simulator).
 *
 * Belgian skill-dice format (as in Spirit Sisters / Take It or Not):
 *  - Pay a stake, then receive 12 columns of 3 dice, one at a time.
 *  - Skill: you choose which of the 4 grids (3x3) each column goes into.
 *    A column fills the next free column of that grid, left to right.
 *  - Winning lines: 3 identical dice on a row (3) or a diagonal (2) of a grid.
 *  - Points are added up; at least 100 points pays a prize from the prize ladder.
 *  - Winning lines in 3 grids x1.5, in all 4 grids x2. A grid of 9 identical dice +200.
 *
 * Dragon summon (bonus):
 *  - Every die face (1..7 stars) that is part of a winning line is collected.
 *    The collection carries over between games (kept per stake).
 *  - With all 7 faces collected the dragon is summoned after the game and grants a wish:
 *      free    : 10 free games at the same stake
 *      treasure: "Take it or not" — up to 5 offers, take one or refuse for the next
 *      wild    : 5 free games in which dragon dice appear and count as any face
 *  - No collecting during free games.
 */
(function (root) {
  const DRAGON = 8; // dragon die: only appears in Dragon Wilds games, where it is wild
  const FACES = [1, 2, 3, 4, 5, 6, 7, 8];
  const STAR_FACES = [1, 2, 3, 4, 5, 6, 7];
  // Relative odds of each face per game mode.
  const WEIGHTS = {
    base: { 1: 14, 2: 14, 3: 14, 4: 14, 5: 14, 6: 14, 7: 3.5, 8: 0 },
    wild: { 1: 14, 2: 14, 3: 14, 4: 14, 5: 14, 6: 14, 7: 3.5, 8: 5 },
  };
  const LINE_POINTS = { 1: 20, 2: 20, 3: 40, 4: 40, 5: 60, 6: 60, 7: 120 };
  const FULL_GRID_BONUS = 200;
  const GRIDS = 4;
  const COLUMNS_PER_GAME = 12;
  // points -> prize as a multiple of the stake
  const PRIZE_LADDER = [
    [1000, 100], [700, 40], [500, 15], [400, 6], [300, 3.75],
    [250, 2.5], [200, 1.5], [150, 1], [100, 0.5],
  ];
  const STAKES = [0.25, 0.5, 1, 2, 5];

  // ---- wishes ----
  const FREE_GAMES = 10;
  const WILD_GAMES = 5;
  const TREASURE_ROUNDS = 5;
  // offers as a multiple of the stake, with relative odds
  const TREASURE_OFFERS = [
    [1, 22], [2, 20], [3, 16], [4, 13], [5, 10], [6, 8], [8, 5], [10, 3], [15, 2], [25, 1], [50, 0.6],
  ];
  const WISHES = ['free', 'treasure', 'wild'];

  const LINES = [
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 1], [2, 2]],
    [[2, 0], [1, 1], [0, 2]],
  ];

  function weightedPick(pairs, rnd) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = rnd() * total;
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  const pairsFor = mode => FACES.map(f => [f, WEIGHTS[mode][f]]).filter(p => p[1] > 0);
  function rollDie(mode = 'base', rnd = Math.random) { return weightedPick(pairsFor(mode), rnd); }
  function rollColumn(mode = 'base', rnd = Math.random) { return [rollDie(mode, rnd), rollDie(mode, rnd), rollDie(mode, rnd)]; }
  function rollOffer(rnd = Math.random) { return weightedPick(TREASURE_OFFERS, rnd); }

  // grid[col] = [top, mid, bottom] or null while the column is empty
  function emptyGrids() { return Array.from({ length: GRIDS }, () => [null, null, null]); }
  function nextFreeCol(grid) { return grid.findIndex(c => c === null); }
  function cell(grid, r, c) { return grid[c] ? grid[c][r] : null; }

  // The face a set of dice forms, or null. Dragons are wild; all dragons count as 7 stars.
  function matchFace(vals) {
    if (vals.some(v => v === null)) return null;
    const real = vals.filter(v => v !== DRAGON);
    if (real.length === 0) return 7;
    return real.every(v => v === real[0]) ? real[0] : null;
  }

  function evaluateGrid(grid) {
    const lines = [];
    let points = 0;
    LINES.forEach((line, idx) => {
      const face = matchFace(line.map(([r, c]) => cell(grid, r, c)));
      if (face !== null) {
        lines.push({ idx, face, points: LINE_POINTS[face] });
        points += LINE_POINTS[face];
      }
    });
    let full = false;
    if (grid.every(c => c !== null)) {
      full = matchFace(grid.flat()) !== null;
      if (full) points += FULL_GRID_BONUS;
    }
    return { lines, points, full };
  }

  function evaluateAll(grids) {
    const per = grids.map(evaluateGrid);
    const base = per.reduce((s, g) => s + g.points, 0);
    const winningGrids = per.filter(g => g.points > 0).length;
    const multiplier = winningGrids >= 4 ? 2 : winningGrids === 3 ? 1.5 : 1;
    const total = Math.round(base * multiplier);
    const faces = new Set();
    per.forEach(g => g.lines.forEach(l => faces.add(l.face)));
    return { per, base, winningGrids, multiplier, total, faces };
  }

  function prizeFor(points) {
    for (const [p, x] of PRIZE_LADDER) if (points >= p) return x;
    return 0;
  }

  // ---- placement hint (also used by the simulator) ----
  // collected: Set of faces already collected (or null when not collecting)
  function scorePlacement(grids, g, column, collected) {
    const grid = grids[g];
    const c = nextFreeCol(grid);
    if (c < 0) return -Infinity;
    const trial = grid.slice(); trial[c] = column;
    const before = evaluateGrid(grid), after = evaluateGrid(trial);
    let s = after.points - before.points;
    const newFaceValue = collected ? 12 + 10 * collected.size : 0; // closer to a summon = worth more
    if (collected) {
      const had = new Set(before.lines.map(l => l.face));
      after.lines.forEach(l => { if (!had.has(l.face) && !collected.has(l.face)) s += newFaceValue; });
    }
    LINES.forEach(line => {
      const v = line.map(([r, cc]) => cell(trial, r, cc));
      const filled = v.filter(x => x !== null);
      if (filled.length === 0 || filled.length === 3) return;
      const real = filled.filter(x => x !== DRAGON);
      if (real.length && !real.every(x => x === real[0])) return;
      const f = real.length ? real[0] : 7;
      let val = LINE_POINTS[f];
      if (collected && !collected.has(f)) val += newFaceValue;
      s += (filled.length === 2 ? 0.35 : 0.08) * val;
    });
    if (before.points === 0 && after.points > 0) s += 25; // multiplier value
    return s;
  }
  function bestGrid(grids, column, collected = null) {
    let best = -1, bestS = -Infinity;
    for (let g = 0; g < grids.length; g++) {
      const s = scorePlacement(grids, g, column, collected);
      if (s > bestS) { bestS = s; best = g; }
    }
    return best;
  }

  const api = {
    FACES, STAR_FACES, DRAGON, WEIGHTS, LINE_POINTS, FULL_GRID_BONUS, GRIDS, COLUMNS_PER_GAME,
    PRIZE_LADDER, STAKES, FREE_GAMES, WILD_GAMES, TREASURE_ROUNDS, TREASURE_OFFERS, WISHES, LINES,
    rollDie, rollColumn, rollOffer, emptyGrids, nextFreeCol, matchFace, evaluateGrid, evaluateAll,
    prizeFor, scorePlacement, bestGrid,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DragonRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
