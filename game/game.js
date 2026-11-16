/* Dragon Cube — browser game */
(() => {
  const R = window.DragonRules;
  const $ = s => document.querySelector(s);
  const stage = $('#stage');
  const dieSrc = f => `assets/die${f}.png`;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const euro = v => v.toFixed(2) + '€';
  const money = v => Math.round(v * 100) / 100;

  // ---------- persistence (per-browser demo wallet) ----------
  const START_BALANCE = 100;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('dragoncube.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('dragoncube.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = {
    balance: store.get('balance', START_BALANCE),
    stakeIdx: store.get('stakeIdx', 0),
    collections: store.get('collections', {}), // stakeIdx -> [faces]
    lastWin: 0,
    phase: 'idle', // idle | rolling | place | busy | bonus
    mode: 'base', // base | free | wild
    freeLeft: 0, freeTotal: 0, freeCount: 0,
    grids: R.emptyGrids(),
    column: null,
    left: 0,
    sound: store.get('sound', true),
    evalPrev: null,
    auto: null, // { left: number | Infinity } while autoplay runs
  };
  const stake = () => R.STAKES[state.stakeIdx];
  const collected = () => new Set(state.collections[state.stakeIdx] || []);
  const saveCollected = set => { state.collections[state.stakeIdx] = [...set].sort(); store.set('collections', state.collections); };
  const collecting = () => state.mode === 'base';

  // ---------- scaling ----------
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `scale(${s})`;
    stage.style.left = (window.innerWidth - 1920 * s) / 2 + 'px';
    stage.style.top = (window.innerHeight - 1080 * s) / 2 + 'px';
    state.scale = s;
  }
  window.addEventListener('resize', fit); fit();

  // ---------- sound (tiny WebAudio synth) ----------
  let ac;
  const audio = () => { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); return ac; };
  function tone(freq, dur = .08, type = 'square', vol = .06, delay = 0, slideTo = 0) {
    if (!state.sound) return;
    try {
      const a = audio(), t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
    } catch { /* audio unavailable */ }
  }
  function roar() {
    if (!state.sound) return;
    try {
      const a = audio(), len = a.sampleRate * 1.6, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(900, a.currentTime); f.frequency.exponentialRampToValueAtTime(120, a.currentTime + 1.6);
      g.gain.value = .5; src.connect(f).connect(g).connect(a.destination); src.start();
      tone(110, 1.4, 'sawtooth', .08, 0, 55);
    } catch { /* audio unavailable */ }
  }
  const sfx = {
    tick: () => tone(300 + Math.random() * 400, .03, 'square', .025),
    place: () => { tone(140, .12, 'triangle', .15); tone(90, .15, 'sine', .15, .02); },
    line: i => [523, 659, 784].forEach((f, k) => tone(f * (1 + i * .12), .14, 'triangle', .08, k * .07)),
    collect: () => [784, 1046, 1318, 1568].forEach((f, k) => tone(f, .12, 'sine', .08, k * .05)),
    win: () => [523, 659, 784, 1046, 1318].forEach((f, k) => tone(f, .22, 'triangle', .09, k * .1)),
    lose: () => [392, 330, 262].forEach((f, k) => tone(f, .2, 'sine', .07, k * .12)),
    fanfare: () => [392, 523, 659, 784, 1046, 784, 1046, 1318].forEach((f, k) => tone(f, .18, 'sawtooth', .05, k * .09)),
    click: () => tone(660, .05, 'triangle', .08),
    whoosh: () => tone(200, .6, 'sawtooth', .05, 0, 1600),
  };

  // ---------- build UI ----------
  // pay table
  const ptRows = [
    { faces: [7, 7, 7], label: '120', hitFaces: [7] },
    { faces: [6, 6, 6], alt: 5, label: '60', hitFaces: [5, 6] },
    { faces: [4, 4, 4], alt: 3, label: '40', hitFaces: [3, 4] },
    { faces: [2, 2, 2], alt: 1, label: '20', hitFaces: [1, 2] },
  ];
  $('#pt-rows').innerHTML = ptRows.map((r, i) => `
    <div class="pt-row" data-i="${i}">
      ${r.alt ? `<img src="${dieSrc(r.alt)}" alt=""><span class="alt">/</span>` : ''}
      ${r.faces.map(f => `<img src="${dieSrc(f)}" alt="">`).join('')}
      <span class="pts">${r.label}</span>
    </div>`).join('');
  function flashPaytable(face) {
    const i = ptRows.findIndex(r => r.hitFaces.includes(face));
    const el = document.querySelector(`.pt-row[data-i="${i}"]`);
    if (!el) return; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  }

  // collection meter
  $('#collect-dice').innerHTML = R.STAR_FACES.map(f => `<img src="${dieSrc(f)}" data-f="${f}" alt="${f} stars">`).join('');
  const meterDie = f => document.querySelector(`#collect-dice img[data-f="${f}"]`);
  function renderCollection(newFace) {
    const got = collected();
    R.STAR_FACES.forEach(f => {
      const el = meterDie(f); el.classList.toggle('got', got.has(f)); el.classList.remove('glow');
      if (f === newFace) { el.classList.remove('new'); void el.offsetWidth; el.classList.add('new'); }
    });
    $('#collect').classList.toggle('paused', !collecting());
  }

  // fields
  const FIELD_X = [62, 461, 860, 1259];
  const fieldsEl = $('#fields');
  const fields = FIELD_X.map((x, g) => {
    const el = document.createElement('div');
    el.className = 'field'; el.style.left = x + 'px'; el.dataset.g = g;
    el.innerHTML = `<div class="well"></div><div class="cells"></div>
      <svg class="lines" viewBox="0 0 297 297"></svg>
      <img class="frame" src="assets/frame.png" alt=""><div class="fpts"></div>`;
    const cellsEl = el.querySelector('.cells');
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const d = document.createElement('div'); d.className = 'cell';
      d.dataset.r = r; d.dataset.c = c; cellsEl.appendChild(d); cells.push(d);
    }
    fieldsEl.appendChild(el);
    el.addEventListener('click', () => onFieldClick(g));
    el.addEventListener('mouseenter', () => showGhost(g));
    el.addEventListener('mouseleave', () => clearGhost(g));
    return { el, cells, svg: el.querySelector('svg'), pts: el.querySelector('.fpts') };
  });
  const cellEl = (g, r, c) => fields[g].cells[r * 3 + c];

  // ladder
  $('#ladder').innerHTML = R.PRIZE_LADDER.map(([p]) => `<div class="lad" data-p="${p}"><span>${p}</span><span class="amt"></span></div>`).join('');

  // hold dice
  const IDLE_FACES = [7, 7, 7];
  const holdEls = IDLE_FACES.map(f => {
    const img = document.createElement('img'); img.className = 'die'; img.src = dieSrc(f); img.alt = '';
    $('#hold-dice').appendChild(img); return img;
  });

  // ---------- rendering ----------
  function renderMeters() {
    $('#balance').textContent = euro(state.balance);
    $('#lastwin').textContent = euro(state.lastWin);
    $('#stake').textContent = euro(stake());
    document.querySelectorAll('.lad').forEach(el => {
      const p = +el.dataset.p; const m = R.PRIZE_LADDER.find(x => x[0] === p)[1];
      el.querySelector('.amt').textContent = euro(money(m * stake()));
    });
    $('#sound-btn').classList.toggle('off', !state.sound);
    const idle = state.phase === 'idle';
    $('#stake-btn').disabled = !idle || !!state.auto;
    $('#play-btn').disabled = !!state.auto || !(idle || state.phase === 'place');
    const ab = $('#auto-btn'), ac = $('#auto-count');
    ab.classList.toggle('on', !!state.auto);
    ab.disabled = false; // autoplay can be switched on or off at any time
    ab.title = state.auto ? 'Stop autoplay' : 'Autoplay';
    ac.classList.toggle('hidden', !state.auto);
    if (state.auto) ac.textContent = state.auto.left === Infinity ? '∞' : state.auto.left;
    const badge = $('#mode-badge');
    badge.classList.toggle('hidden', state.mode === 'base');
    badge.classList.toggle('wild', state.mode === 'wild');
    if (state.mode !== 'base') {
      badge.textContent = `${state.mode === 'wild' ? 'Wild game' : 'Free game'} ${state.freeCount}/${state.freeCount + state.freeLeft} · ${euro(state.freeTotal)}`;
    }
    store.set('balance', state.balance); store.set('stakeIdx', state.stakeIdx); store.set('sound', state.sound);
  }
  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  function say(t) { $('#message').innerHTML = t; }

  function renderPoints(ev) {
    const pts = ev ? ev.total : 0;
    $('#points').textContent = pts;
    $('#mult').textContent = ev && ev.multiplier > 1 ? '×' + ev.multiplier : '';
    const reached = R.PRIZE_LADDER.find(([p]) => pts >= p);
    const nextUp = [...R.PRIZE_LADDER].reverse().find(([p]) => pts < p);
    document.querySelectorAll('.lad').forEach(el => {
      const p = +el.dataset.p;
      el.classList.toggle('on', !!reached && reached[0] === p);
      el.classList.toggle('next', !!nextUp && nextUp[0] === p);
    });
  }

  function clearBoard() {
    fields.forEach(f => {
      f.cells.forEach(c => { c.innerHTML = ''; c.className = 'cell'; });
      f.svg.innerHTML = ''; f.pts.classList.remove('show'); f.pts.textContent = '';
      f.el.classList.remove('full', 'suggest', 'selectable');
    });
  }

  function lineSVG(idx) {
    const centre = i => 47.5 + i * 101;
    const pts = R.LINES[idx].map(([r, c]) => [centre(c), centre(r)]);
    const ext = (a, b, k) => [a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k];
    const p0 = ext(pts[0], pts[2], .18), p1 = ext(pts[2], pts[0], .18);
    return `<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}"/>`;
  }

  // ---------- dice drop animations ----------
  const DROP_MS = 560;
  const tilt = () => (Math.random() < .5 ? -1 : 1) * (14 + Math.random() * 16) + 'deg';
  function restart(el, cls) { el.classList.remove('drop', 'fallout', 'pop', 'rolling'); void el.offsetWidth; el.classList.add(cls); }
  // items: [{ el, dy, delay }]; resolves when the last die has landed
  function dropIn(items, gap, heavy = false) {
    let last = 0;
    items.forEach(({ el, dy, delay }) => {
      el.style.setProperty('--dy', dy + 'px');
      el.style.setProperty('--rot', tilt());
      el.style.setProperty('--delay', delay + 'ms');
      el.style.visibility = 'visible';
      restart(el, 'drop');
      const land = delay + DROP_MS * .66;
      setTimeout(() => heavy ? tone(120 + Math.random() * 40, .1, 'triangle', .12) : tone(260 + Math.random() * 120, .05, 'triangle', .07), land);
      last = Math.max(last, delay + DROP_MS);
    });
    return wait(last);
  }
  function dropOut(els) {
    els.forEach((el, i) => {
      el.style.setProperty('--rot', tilt());
      el.style.setProperty('--delay', (2 - i) * 40 + 'ms');
      restart(el, 'fallout');
    });
    return wait(380).then(() => els.forEach(el => { el.style.visibility = 'hidden'; el.classList.remove('fallout'); }));
  }

  // ---------- hero power-up (lightning) ----------
  // The sparks video is keyed to black. Each frame is drawn to a canvas and
  // black is turned into transparency, so the lightning stays visible on the bright sky.
  // (If the canvas can't be read, e.g. when opened from file://, the video is shown
  // with screen blending instead.)
  function keyedLayer(wrap, scale) {
    const video = wrap.querySelector('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    wrap.appendChild(canvas);
    let running = false, ok = true;
    const frame = () => {
      if (!running) return;
      if (video.readyState >= 2) {
        const w = canvas.width = Math.round(video.videoWidth * scale), h = canvas.height = Math.round(video.videoHeight * scale);
        try {
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h), p = img.data;
          for (let i = 0; i < p.length; i += 4) {
            const m = Math.max(p[i], p[i + 1], p[i + 2]);
            if (m < 20) { p[i + 3] = 0; continue; }
            const k = 255 / m;
            p[i] *= k; p[i + 1] *= k; p[i + 2] *= k;
            p[i + 3] = Math.min(255, (m - 20) * 1.4);
          }
          ctx.putImageData(img, 0, 0);
        } catch {
          ok = false; running = false; wrap.classList.add('blend'); return;
        }
      }
      requestAnimationFrame(frame);
    };
    return {
      start() { video.play().catch(() => {}); if (ok && !running) { running = true; requestAnimationFrame(frame); } },
      stop() { running = false; video.pause(); },
    };
  }
  const sparksEl = $('#sparks'), heroEl = $('#hero');
  const sparksFx = keyedLayer(sparksEl, 1);
  let auraT;
  function auraBoost(ms = 2200, level = 1) {
    clearTimeout(auraT);
    sparksFx.start(); sparksEl.classList.add('on');
    sparksEl.classList.toggle('strong', level > 1);
    heroEl.classList.remove('powered'); void heroEl.offsetWidth; heroEl.classList.add('powered');
    tone(90, .5, 'sawtooth', .05, 0, 180);
    auraT = setTimeout(() => {
      sparksEl.classList.remove('on'); heroEl.classList.remove('powered');
      setTimeout(() => { if (!sparksEl.classList.contains('on')) sparksFx.stop(); }, 400);
    }, ms);
  }
  window.__dragonCube = { auraBoost }; // handy for testing effects from the console

  // electric outline around winning dice: re-seed the noise so it crackles
  const noise = document.getElementById('electric-noise');
  setInterval(() => { if (document.querySelector('.cell.win')) noise.setAttribute('seed', 1 + Math.floor(Math.random() * 99)); }, 70);

  function stageRect(el) {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(), k = state.scale;
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
  }

  function showResult(title, sub) {
    const resEl = $('#result');
    resEl.querySelector('.result-title').textContent = title;
    resEl.querySelector('.result-sub').textContent = sub;
    resEl.classList.remove('hidden', 'fade'); clearTimeout(state.resT);
    state.resT = setTimeout(() => resEl.classList.add('fade'), 3200);
    resEl.style.animation = 'none'; void resEl.offsetWidth; resEl.style.animation = '';
  }

  // ---------- game flow ----------
  function setPhase(p) { state.phase = p; renderMeters(); updateSelectable(); }

  function updateSelectable() {
    fields.forEach((f, g) => {
      const free = R.nextFreeCol(state.grids[g]) >= 0;
      f.el.classList.toggle('selectable', state.phase === 'place' && free);
      f.el.classList.toggle('full', !free && state.phase !== 'idle');
      f.el.classList.toggle('suggest', state.phase === 'place' && g === state.suggest);
    });
  }

  async function startGame() {
    if (state.phase !== 'idle') return;
    if (state.mode === 'base') {
      if (state.balance + 1e-9 < stake()) {
        say('Not enough balance. <u style="cursor:pointer" id="refill">Tap here to refill 100€ demo credit</u>');
        const r = $('#refill'); if (r) r.onclick = () => { state.balance = START_BALANCE; renderMeters(); say('Credit refilled. Press play!'); };
        if (state.auto) { state.auto = null; renderMeters(); }
        return;
      }
      if (state.auto && state.auto.left !== Infinity) state.auto.left--;
      state.balance = money(state.balance - stake());
      bump($('#balance'));
    } else {
      state.freeLeft--; state.freeCount++;
    }
    sfx.click();
    $('#result').classList.add('hidden');
    state.grids = R.emptyGrids();
    state.left = R.COLUMNS_PER_GAME;
    state.evalPrev = R.evaluateAll(state.grids);
    clearBoard(); renderPoints(null); renderCollection();
    nextColumn();
  }

  async function nextColumn() {
    setPhase('rolling');
    $('#hold-count').textContent = `${state.left} left`;
    say(state.mode === 'wild' ? 'The dragon rolls… watch for wild dragon dice!' : 'The dragon rolls…');
    const col = R.rollColumn(state.mode === 'wild' ? 'wild' : 'base');
    // dice still sitting in the column (the idle dice) fall out first
    if (holdEls.some(e => e.style.visibility !== 'hidden' && !e.classList.contains('fallout'))) {
      await dropOut(holdEls);
    }
    // new dice tumble in from the top of the column, bottom slot first
    await dropIn(holdEls.map((e, i) => {
      e.src = dieSrc(col[i]);
      return { el: e, dy: -(i * 122 + 150), delay: (2 - i) * 110 };
    }), 110);
    state.column = col;
    state.suggest = R.bestGrid(state.grids, col, collecting() ? collected() : null);
    setPhase('place');
    say(col.includes(R.DRAGON) ? 'Dragon dice are wild! Choose a field' : 'Choose a field for your dice');
    const hovered = fields.findIndex(f => f.el.matches(':hover'));
    if (hovered >= 0) showGhost(hovered);
    if (state.auto) {
      await wait(350);
      if (state.auto && state.phase === 'place' && state.column === col) onFieldClick(state.suggest);
    }
  }

  function showGhost(g) {
    if (state.phase !== 'place') return;
    const c = R.nextFreeCol(state.grids[g]); if (c < 0) return;
    for (let r = 0; r < 3; r++) {
      const el = cellEl(g, r, c); el.classList.add('ghost');
      el.innerHTML = `<img src="${dieSrc(state.column[r])}" alt="">`;
    }
  }
  function clearGhost(g) {
    fields[g].cells.forEach(el => { if (el.classList.contains('ghost')) { el.classList.remove('ghost'); el.innerHTML = ''; } });
  }

  async function onFieldClick(g) {
    if (state.phase !== 'place') return;
    const c = R.nextFreeCol(state.grids[g]); if (c < 0) return;
    setPhase('busy');
    clearGhost(g);
    const col = state.column;
    // the dice drop out of the bottom of the hold column…
    const out = dropOut(holdEls);
    await wait(180);
    // …and tumble into the chosen column of the field from above, bottom die first
    state.grids[g][c] = col;
    const items = [0, 1, 2].map(r => {
      const el = cellEl(g, r, c); el.className = 'cell';
      el.innerHTML = `<img class="die" src="${dieSrc(col[r])}" alt="">`;
      return { el: el.querySelector('img'), dy: -(r * 101 + 140), delay: (2 - r) * 90 };
    });
    await Promise.all([out, dropIn(items, 90, true)]);
    await showNewWins(g);
    state.left--;
    if (state.left > 0) nextColumn();
    else finishGame();
  }

  async function showNewWins(g) {
    const ev = R.evaluateAll(state.grids);
    const before = state.evalPrev.per[g], after = ev.per[g];
    const newLines = after.lines.filter(l => !before.lines.some(b => b.idx === l.idx));
    for (let i = 0; i < newLines.length; i++) {
      const l = newLines[i];
      R.LINES[l.idx].forEach(([r, c]) => cellEl(g, r, c).classList.add('win'));
      flashPaytable(l.face);
      sfx.line(i);
      auraBoost(l.face === 7 ? 3000 : 2200, l.face === 7 ? 2 : 1);
      let msg = `Line! +${l.points} points`;
      if (collecting()) {
        const got = collected();
        if (!got.has(l.face)) {
          got.add(l.face); saveCollected(got); renderCollection(l.face); sfx.collect();
          auraBoost(got.size === 7 ? 4000 : 2200, 2);
          msg += got.size === 7
            ? ' · <span style="color:#ffd84a">All 7 dice! The dragon awakens…</span>'
            : ` · <span style="color:#ffd84a">${l.face}-star die collected (${got.size}/7)</span>`;
        }
      }
      say(msg);
      await wait(420);
    }
    if (after.full && !before.full) { say('Full field! +200 points'); sfx.win(); auraBoost(3000, 2); await wait(500); }
    if (after.points > 0) { fields[g].pts.textContent = '+' + after.points; fields[g].pts.classList.add('show'); }
    if (newLines.length && ev.winningGrids >= 3 && ev.multiplier !== state.evalPrev.multiplier) {
      say(`Wins in ${ev.winningGrids} fields: points ×${ev.multiplier}!`);
      auraBoost(3000, 2);
    }
    state.evalPrev = ev;
    renderPoints(ev);
  }

  async function finishGame() {
    setPhase('busy');
    $('#hold-count').textContent = 'done';
    holdEls.forEach(e => { e.style.visibility = 'hidden'; });
    const ev = R.evaluateAll(state.grids);
    renderPoints(ev);
    const win = money(R.prizeFor(ev.total) * stake());
    await wait(500);
    state.balance = money(state.balance + win);
    if (state.mode !== 'base') state.freeTotal = money(state.freeTotal + win);
    const ptsText = `${ev.total} points${ev.multiplier > 1 ? ' (×' + ev.multiplier + ')' : ''}`;
    if (win > 0) {
      state.lastWin = state.mode === 'base' ? win : state.freeTotal;
      showResult(win >= stake() * 10 ? 'Dragon win!' : 'You win!', `${ptsText} · ${euro(win)}`);
      sfx.win(); bump($('#lastwin')); bump($('#balance'));
      auraBoost(win >= stake() * 4 ? 3500 : 2000, win >= stake() * 4 ? 2 : 1);
      say(`You won ${euro(win)}!`);
    } else {
      if (state.mode === 'base') state.lastWin = 0;
      sfx.lose();
      say(`${ptsText}. You need 100.`);
    }
    renderMeters();

    if (state.mode !== 'base') {
      if (state.freeLeft > 0) {
        await wait(1800);
        setPhase('idle');
        return startGame(); // free games roll on by themselves
      }
      await wait(1500);
      const total = state.freeTotal, wasWild = state.mode === 'wild';
      state.mode = 'base'; state.lastWin = total;
      showResult(wasWild ? 'Wilds over!' : 'Free games over!', `Total win ${euro(total)}`);
      sfx.fanfare(); bump($('#lastwin'));
      say(`Your wish brought you ${euro(total)}. Press play to continue`);
    } else if (collected().size === 7) {
      if (state.auto) { state.auto = null; renderMeters(); }
      await wait(1200);
      await summon();
    } else {
      say(win > 0 ? `You won ${euro(win)}! Press play for a new game` : `${ptsText}. You need 100. Press play to try again`);
    }
    holdEls.forEach((e, i) => { e.src = dieSrc(IDLE_FACES[i]); });
    dropIn(holdEls.map((e, i) => ({ el: e, dy: -(i * 122 + 150), delay: (2 - i) * 110 })), 110);
    $('#hold-count').textContent = '12 left';
    renderCollection();
    setPhase('idle');
    if (state.mode !== 'base') startGame(); // a free/wild wish was chosen: start it
    else scheduleAuto();
  }

  // ---------- autoplay ----------
  let autoTimer = null;
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (!state.auto) return;
    if (state.auto.left <= 0) { stopAuto('Autoplay finished'); return; }
    autoTimer = setTimeout(() => { if (state.auto && state.phase === 'idle') startGame(); }, 1200);
  }
  function stopAuto(msg) {
    clearTimeout(autoTimer);
    if (!state.auto) return;
    state.auto = null; renderMeters();
    if (msg) say(msg);
  }
  function startAuto(n) {
    $('#auto-menu').classList.add('hidden');
    $('#auto-btn').classList.remove('kick');
    state.auto = { left: n }; sfx.click(); renderMeters();
    if (state.phase === 'idle') startGame();
    else if (state.phase === 'place') onFieldClick(state.suggest); // mid-game: take over right away
    // rolling/busy: the next column is placed automatically
  }

  // ---------- dragon summon ----------
  async function summon() {
    setPhase('bonus');
    $('#result').classList.add('hidden');
    const ov = $('#summon'), ritual = $('#ritual'), dragon = $('#summon-dragon');
    const title = $('#wish-title'), wishesEl = $('#wishes');
    ritual.innerHTML = ''; wishesEl.innerHTML = ''; title.classList.remove('show'); dragon.classList.remove('show');
    ritual.className = ''; ov.className = '';

    // 1. the 7 dice glow
    say('<span style="color:#ffd84a">The 7 dragon dice are glowing…</span>');
    R.STAR_FACES.forEach(f => meterDie(f).classList.add('glow'));
    sfx.fanfare();
    await wait(1600);

    // 2. whip: the whole screen smears downwards (vertical motion blur), then speed lines
    auraBoost(5000, 2);
    sfx.whoosh();
    const vb = document.getElementById('vblur-g');
    stage.classList.add('whip');
    await new Promise(done => {
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / 650);
        vb.setAttribute('stdDeviation', `0 ${(t * t * 60).toFixed(1)}`);
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    ov.classList.add('dark');
    await wait(30);
    ov.classList.add('lines');
    await wait(450);
    stage.classList.remove('whip'); vb.setAttribute('stdDeviation', '0 0');
    await wait(250);

    // 3. the dice fly into a circle and spin
    const centre = { x: 960, y: 470 }, radius = 230;
    const dice = R.STAR_FACES.map((f, i) => {
      const from = stageRect(meterDie(f));
      const img = document.createElement('img'); img.src = dieSrc(f); img.alt = '';
      // start on top of the meter die
      const sx = from.x + from.w / 2 - centre.x, sy = from.y + from.h / 2 - centre.y;
      img.style.transform = `translate(${sx}px, ${sy}px) scale(.35)`;
      ritual.appendChild(img);
      meterDie(f).classList.remove('glow', 'got');
      return { img, angle: -Math.PI / 2 + i * 2 * Math.PI / 7 };
    });
    await wait(40);
    dice.forEach(({ img, angle }, i) => {
      img.style.transitionDelay = i * 70 + 'ms';
      img.style.transform = `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)`;
      setTimeout(() => tone(500 + i * 90, .15, 'triangle', .07), i * 70);
    });
    await wait(1100);
    dice.forEach(({ img }) => { img.style.transition = 'filter .4s'; img.style.transitionDelay = '0ms'; });
    ritual.classList.add('charge');
    // spin, faster and faster, then pull into the centre
    await new Promise(done => {
      const t0 = performance.now(), T = 2600;
      let spin = 0, last = t0;
      const step = now => {
        const t = Math.min(1, (now - t0) / T), dt = (now - last) / 1000; last = now;
        spin += dt * (1.5 + 16 * t * t);
        const r = radius * (t < .75 ? 1 : 1 - (t - .75) / .25 * .9);
        dice.forEach(({ img, angle }) => {
          const a = angle + spin;
          img.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) rotate(${spin * 40}deg) scale(${1 - .4 * Math.max(0, t - .75) / .25})`;
        });
        if (Math.random() < .3) sfx.tick();
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });

    // 4. flash — the dragon appears
    const flash = $('#flash'); flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    ritual.innerHTML = '';
    roar();
    dragon.classList.add('show');
    ov.classList.remove('shake'); void ov.offsetWidth; ov.classList.add('shake');
    say('<span style="color:#ffd84a">The dragon has been summoned!</span>');
    await wait(1700);

    // 5. the wish
    title.textContent = 'I will grant you one wish!';
    title.classList.add('show');
    tone(220, .5, 'sine', .1); tone(330, .5, 'sine', .08, .15);
    await wait(700);
    const s = stake();
    const wishes = [
      { id: 'free', icon: 'assets/repeat.png', name: '10 Free Games', text: `Play ${R.FREE_GAMES} games for free at your stake of ${euro(s)}. Your skill decides the wins.` },
      { id: 'treasure', icon: 'assets/money.png', name: "Dragon's Treasure", text: `Take it or not: up to ${R.TREASURE_ROUNDS} offers of gold, up to ${euro(money(50 * s))}. Refuse to see the next one.` },
      { id: 'wild', icon: 'assets/die8.png', name: 'Dragon Wilds', text: `${R.WILD_GAMES} free games where dragon dice appear. They count as any die. Fewer games, bigger wins.` },
    ];
    const choice = await new Promise(pick => {
      wishes.forEach((w, i) => {
        const b = document.createElement('button'); b.className = 'wish';
        b.innerHTML = `<img src="${w.icon}" alt=""><h3>${w.name}</h3><p>${w.text}</p>`;
        b.onclick = () => {
          if (wishesEl.dataset.done) return; wishesEl.dataset.done = '1';
          [...wishesEl.children].forEach(x => x.classList.add(x === b ? 'chosen' : 'dim'));
          sfx.fanfare(); pick(w.id);
        };
        wishesEl.appendChild(b);
        setTimeout(() => { b.classList.add('show'); tone(660 + i * 110, .12, 'triangle', .07); }, 250 * i);
      });
      say('Make your wish!');
    });
    delete wishesEl.dataset.done;
    await wait(1100);

    // reset the collection for this stake, close the summon screen
    saveCollected(new Set());
    renderCollection();
    ov.classList.add('hidden'); ov.className = 'hidden';
    dragon.classList.remove('show'); title.classList.remove('show');

    if (choice === 'treasure') {
      const prize = money(await runTreasure());
      state.balance = money(state.balance + prize); state.lastWin = prize;
      renderMeters(); bump($('#balance')); bump($('#lastwin'));
      showResult('Treasure!', `The dragon gave you ${euro(prize)}`);
      say(`The dragon's treasure: ${euro(prize)}! Press play to continue`);
    } else {
      state.mode = choice;
      state.freeLeft = choice === 'free' ? R.FREE_GAMES : R.WILD_GAMES;
      state.freeTotal = 0; state.freeCount = 0;
      say(choice === 'free' ? `${R.FREE_GAMES} free games! Place your dice well` : `${R.WILD_GAMES} wild games! Dragon dice count as any face`);
      await wait(900);
    }
  }

  // ---------- Dragon's Treasure: take it or not ----------
  function runTreasure() {
    return new Promise(resolve => {
      const ov = $('#bonus'); ov.classList.remove('hidden');
      const dr = $('#bonus-dragon'); dr.style.animation = 'none'; void dr.offsetWidth; dr.style.animation = '';
      const roundsEl = $('#bonus-rounds'), offerEl = $('#bonus-offer'), histEl = $('#bonus-history');
      const takeBtn = $('#take-btn'), notBtn = $('#not-btn');
      const history = [];
      let round = 0, offer = 0;
      $('.bonus-title').textContent = 'Take it or not?';

      const show = async () => {
        roundsEl.innerHTML = Array.from({ length: R.TREASURE_ROUNDS }, (_, i) => `<span class="${i < round ? 'used' : i === round ? 'cur' : ''}"></span>`).join('');
        takeBtn.disabled = notBtn.disabled = true;
        for (let i = 0; i < 10; i++) { offerEl.textContent = euro(money(R.rollOffer() * stake())); sfx.tick(); await wait(60); }
        offer = money(R.rollOffer() * stake());
        offerEl.textContent = euro(offer);
        offerEl.classList.remove('flip'); void offerEl.offsetWidth; offerEl.classList.add('flip');
        tone(880, .2, 'triangle', .08);
        histEl.textContent = history.length ? 'Refused: ' + history.map(euro).join(' · ') : '';
        const last = round === R.TREASURE_ROUNDS - 1;
        notBtn.disabled = last; takeBtn.disabled = false;
        takeBtn.textContent = last ? 'Collect' : 'Take it';
        say(last ? 'Last offer! You have to take this one' : `Offer ${round + 1} of ${R.TREASURE_ROUNDS}: take it or not?`);
      };
      takeBtn.onclick = async () => {
        takeBtn.disabled = notBtn.disabled = true; sfx.win();
        say(`You took ${euro(offer)}!`);
        await wait(900);
        ov.classList.add('hidden');
        resolve(offer);
      };
      notBtn.onclick = () => { sfx.click(); history.push(offer); round++; show(); };
      show();
    });
  }

  // ---------- controls ----------
  $('#play-btn').addEventListener('click', () => {
    if (state.auto) return;
    const ab = $('#auto-btn');
    if (state.phase === 'idle' || state.phase === 'place') { ab.classList.remove('kick'); void ab.offsetWidth; ab.classList.add('kick'); }
    if (state.phase === 'idle') startGame();
    else if (state.phase === 'place') onFieldClick(state.suggest);
  });
  $('#auto-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (state.auto) { stopAuto(state.phase === 'place' ? 'Autoplay stopped. Choose a field' : 'Autoplay stopped'); return; }
    sfx.click(); $('#auto-menu').classList.toggle('hidden');
  });
  document.querySelectorAll('#auto-menu [data-n]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); startAuto(b.dataset.n === 'inf' ? Infinity : +b.dataset.n);
  }));
  $('#auto-menu').addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => $('#auto-menu').classList.add('hidden'));
  $('#stake-btn').addEventListener('click', () => {
    if (state.phase !== 'idle' || state.mode !== 'base') return;
    state.stakeIdx = (state.stakeIdx + 1) % R.STAKES.length; sfx.click();
    renderMeters(); renderCollection(); bump($('#stake'));
    say(`Stake ${euro(stake())} per game · ${collected().size}/7 dragon dice collected at this stake`);
  });
  $('#sound-btn').addEventListener('click', () => { state.sound = !state.sound; renderMeters(); });
  $('#info-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
  $('#rules-close').addEventListener('click', () => $('#rules').classList.add('hidden'));
  $('#rules').addEventListener('click', e => { if (e.target.id === 'rules') $('#rules').classList.add('hidden'); });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || document.documentElement.classList.contains('locked')) return;
    if (e.code === 'Escape') { $('#auto-menu').classList.add('hidden'); if (state.auto) stopAuto('Autoplay stopped'); }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); $('#play-btn').click(); }
    if (state.phase === 'place' && /^Digit[1-4]$/.test(e.code)) onFieldClick(+e.code.slice(5) - 1);
  });

  // ---- TEMPORARY test helper: summon the dragon right away (button or the D key) ----
  async function testSummon() {
    if (state.phase !== 'idle' || state.mode !== 'base') { say('Test summon works only between games'); return; }
    stopAuto();
    saveCollected(new Set(R.STAR_FACES)); renderCollection();
    await summon();
    renderCollection();
    setPhase('idle');
    if (state.mode !== 'base') startGame();
  }
  $('#test-summon').addEventListener('click', testSummon);
  window.addEventListener('keydown', e => { if (e.code === 'KeyD' && !e.repeat && e.target.tagName !== 'INPUT' && !document.documentElement.classList.contains('locked')) testSummon(); });

  // testing helper: open with #summon to start with 6 of 7 dice collected
  if (location.hash === '#summon') saveCollected(new Set([1, 2, 3, 4, 5, 6]));

  renderMeters(); renderPoints(null); renderCollection();
})();
