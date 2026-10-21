(function () {
  'use strict';

  const P = window.Poker;
  const STORAGE_KEY = 'poker-analyzer-highlights-v1';
  const DEFAULT_ON = new Set(['straight-flush', 'quads', 'full-house', 'flush', 'straight', 'set', 'trips', 'two-pair', 'overpair', 'top-pair']);

  const state = {
    flop: [null, null, null],
    turn: null,
    river: null,
    analysis: null,
    selectedCell: null,
    game: 'nlhe',
    priorityGroup: 'made', // which section of hand groups gets color first
    exampleCat: null,
    checkText: '',
    highlight: {}, // category id -> { on, color }
    texture: { suits: 'any', pairing: 'any' },
    pickerSlot: null, // 'flop-0' | 'flop-1' | 'flop-2' | 'turn' | 'river' while the card picker is open
  };

  const $ = (id) => document.getElementById(id);
  const catById = Object.fromEntries(P.CATEGORIES.map((c) => [c.id, c]));
  const game = () => P.GAMES[state.game];
  const isOmaha = () => state.game !== 'nlhe';
  const catName = (id) => P.categoryName(id, state.game);
  const gameCategories = () => game().categoryIds.map((id) => catById[id]);
  const handWord = () => (isOmaha() ? 'hands' : 'combos');

  const GAME_NOTES = {
    nlhe: 'Two hole cards; your best five cards can use one, both or neither of them.',
    plo: 'Four hole cards; every hand must use exactly two of them with three board cards.',
    plo8: 'Four hole cards, exactly two used for each half. The pot splits between the best high and the best low (five different cards 8 or lower, aces low).',
    plo5: 'Five hole cards; every hand must still use exactly two of them with three board cards.',
    bigo: 'Five hole cards, exactly two used for each half. Split pot like PLO8: best high and best low (five different cards 8 or lower, aces low).',
  };

  // ---------------------------------------------------------------------------
  // Settings (remembered per browser)
  // ---------------------------------------------------------------------------

  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) { /* storage unavailable */ }
    for (const cat of P.CATEGORIES) {
      const s = (saved.highlight || {})[cat.id] || {};
      state.highlight[cat.id] = {
        on: typeof s.on === 'boolean' ? s.on : DEFAULT_ON.has(cat.id),
        color: s.color || cat.color,
      };
    }
    if (P.GAMES[saved.game]) state.game = saved.game;
    state.priorityGroup = ['made', 'draw', 'low'].includes(saved.priorityGroup) ? saved.priorityGroup
      : saved.drawsFirst ? 'draw' : 'made';
    const t = saved.texture || {};
    if (P.textureIsPossible(t.suits, t.pairing)) state.texture = { suits: t.suits || 'any', pairing: t.pairing || 'any' };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ highlight: state.highlight, priorityGroup: state.priorityGroup, texture: state.texture, game: state.game }));
    } catch (e) { /* storage unavailable */ }
  }

  // Categories in priority order for coloring.
  function priorityOrder() {
    const cats = gameCategories();
    const first = cats.some((c) => c.group === state.priorityGroup) ? state.priorityGroup : 'made';
    return cats.filter((c) => c.group === first).concat(cats.filter((c) => c.group !== first));
  }

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------

  const flopComplete = () => state.flop.every((c) => c !== null);

  // All cards currently on the board, in order (a partly chosen flop skips its empty slots).
  const boardCards = () => state.flop.filter((c) => c !== null).concat(
    state.turn === null ? [] : [state.turn],
    state.river === null ? [] : [state.river]);

  function newFlop() {
    // The turn and river belong to the old hand, so they go too.
    state.flop = P.drawFlop(state.texture);
    state.turn = null;
    state.river = null;
    update();
  }

  function clearFlop() {
    state.flop = [null, null, null];
    state.turn = null;
    state.river = null;
    update();
  }

  function newTurn() {
    if (!flopComplete()) return;
    state.turn = P.drawCards(1, state.flop.concat(state.river === null ? [] : [state.river]))[0];
    update();
  }

  function clearTurn() {
    state.turn = null;
    state.river = null; // a river without a turn makes no sense
    update();
  }

  function newRiver() {
    if (state.turn === null) return;
    state.river = P.drawCards(1, state.flop.concat([state.turn]))[0];
    update();
  }

  function clearRiver() {
    state.river = null;
    update();
  }

  function slotCard(slot) {
    if (slot.startsWith('flop-')) return state.flop[+slot.slice(5)];
    return state[slot];
  }

  function setSlot(slot, card) {
    if (slot.startsWith('flop-')) {
      state.flop[+slot.slice(5)] = card;
      // Swapping a flop card keeps the turn and river so you can compare; removing one starts over.
      if (card === null) {
        state.turn = null;
        state.river = null;
      }
    } else if (slot === 'turn') {
      state.turn = card;
      if (card === null) state.river = null;
    } else {
      state.river = card;
    }
    update();
  }

  function setBoardFromText(text) {
    let cards;
    try {
      cards = P.parseBoard(text);
    } catch (e) {
      $('board-error').textContent = e.message;
      return;
    }
    state.flop = cards.slice(0, 3);
    state.turn = cards.length > 3 ? cards[3] : null;
    state.river = cards.length > 4 ? cards[4] : null;
    update();
  }

  function cardHTML(c, small) {
    const suit = P.SUITS[P.suitOf(c)];
    const rank = P.RANKS[P.rankOf(c)];
    const cls = 'card suit-' + suit + (small ? ' small' : '');
    return '<span class="' + cls + '" aria-label="' + P.cardToString(c) + '">' +
      '<span class="rank">' + (rank === 'T' ? '10' : rank) + '</span>' +
      '<span class="pip">' + P.SUIT_SYMBOLS[suit] + '</span></span>';
  }

  const SLOT_NAMES = { 'flop-0': 'first flop card', 'flop-1': 'second flop card', 'flop-2': 'third flop card', turn: 'turn', river: 'river' };

  function slotHTML(slot, card, disabled) {
    const label = (card === null ? 'Choose the ' : 'Change the ') + SLOT_NAMES[slot];
    return '<button type="button" class="slot" data-slot="' + slot + '" aria-label="' + label + '" title="' + label + '"' +
      (disabled ? ' disabled' : '') + '>' +
      (card === null ? '<span class="card empty"><span class="plus">+</span></span>' : cardHTML(card)) + '</button>';
  }

  function renderBoard() {
    $('flop-cards').innerHTML = state.flop.map((c, i) => slotHTML('flop-' + i, c, false)).join('');
    $('turn-cards').innerHTML = slotHTML('turn', state.turn, !flopComplete());
    $('river-cards').innerHTML = slotHTML('river', state.river, state.turn === null);

    $('clear-flop').disabled = boardCards().length === 0;
    $('new-turn').disabled = !flopComplete();
    $('clear-turn').disabled = state.turn === null;
    $('new-river').disabled = state.turn === null;
    $('clear-river').disabled = state.river === null;

    $('flop-suits').value = state.texture.suits;
    $('flop-pairing').value = state.texture.pairing;
    for (const opt of $('flop-suits').options) opt.disabled = !P.textureIsPossible(opt.value, state.texture.pairing);
    for (const opt of $('flop-pairing').options) opt.disabled = !P.textureIsPossible(state.texture.suits, opt.value);

    const a = state.analysis;
    if (!a) {
      $('summary').innerHTML = 'Pick all three flop cards, or deal a new flop, to see the analysis.';
      return;
    }
    const street = state.river !== null ? 'River' : state.turn !== null ? 'Turn' : 'Flop';
    const t = P.flopTexture(state.flop);
    const textureText = { monotone: 'Monotone', 'two-tone': 'Two-tone', rainbow: 'Rainbow' }[t.suits] +
      (t.pairing === 'unpaired' ? '' : t.pairing === 'paired' ? ', paired' : ', trips');
    $('summary').innerHTML = '<strong>' + street + '</strong> &middot; ' + textureText + ' flop &middot; ' +
      a.total.toLocaleString() + (isOmaha() ? ' possible ' + game().holeCards + '-card hands ' : ' possible hole-card combos ') +
      '<span class="muted">(' + (52 - boardCards().length) + ' unseen cards)</span>';
  }

  // ---------------------------------------------------------------------------
  // Card picker
  // ---------------------------------------------------------------------------

  function openPicker(slot) {
    state.pickerSlot = slot;
    const current = slotCard(slot);
    const dead = new Set(boardCards().filter((c) => c !== current));
    $('picker-title').textContent = (current === null ? 'Choose the ' : 'Change the ') + SLOT_NAMES[slot];

    const html = [];
    for (const suit of [0, 1, 2, 3]) {
      for (let rank = 12; rank >= 0; rank--) {
        const c = P.makeCard(rank, suit);
        const used = dead.has(c);
        html.push('<button type="button" class="pick' + (c === current ? ' current' : '') + '" data-card="' + c + '"' +
          (used ? ' disabled title="Already on the board"' : '') + ' aria-label="' + P.cardToString(c) + '">' +
          cardHTML(c, true) + '</button>');
      }
    }
    $('picker-grid').innerHTML = html.join('');
    $('picker-remove').disabled = current === null;
    $('picker').showModal();
  }

  function pickCard(card) {
    const slot = state.pickerSlot;
    $('picker').close();
    if (slot) setSlot(slot, card);
  }

  function pickRandom() {
    const current = slotCard(state.pickerSlot);
    const exclude = boardCards().concat(current === null ? [] : [current]);
    pickCard(P.drawCards(1, exclude)[0]);
  }

  // ---------------------------------------------------------------------------
  // Category tables
  // ---------------------------------------------------------------------------

  const pct = (n, total) => (total ? (100 * n / total).toFixed(1) : '0.0') + '%';

  function renderCategories() {
    const a = state.analysis;
    const river = a && boardCards().length === 5;
    const groups = [
      { id: 'made', title: 'Made hands', note: 'Each ' + handWord().slice(0, -1) + ' is counted in exactly one made-hand group.' },
      { id: 'draw', title: 'Draws', note: river ? 'No draws on the river.'
        : isOmaha() ? 'Draws need two hole cards: one suited card is never a flush draw. Straight outs are counted as unseen cards.'
          : 'A combo can have several draws, or a draw plus a made hand.' },
    ];
    if (game().hiLo) {
      groups.push({ id: 'low', title: 'Low (8 or better)', note: 'Nut low is the best low possible on this board. A low draw can make a low with the next card.' });
    }

    $('category-tables').innerHTML = groups.map((g) => {
      const rows = gameCategories().filter((c) => c.group === g.id).map((cat) => {
        const h = state.highlight[cat.id];
        const n = a ? a.counts[cat.id] : 0;
        return '<tr class="' + (h.on ? 'on' : '') + (n ? '' : ' zero') + '">' +
          '<td><input type="checkbox" data-toggle="' + cat.id + '"' + (h.on ? ' checked' : '') + ' aria-label="Highlight ' + catName(cat.id) + '"></td>' +
          '<td><input type="color" data-color="' + cat.id + '" value="' + h.color + '" aria-label="Color for ' + catName(cat.id) + '"></td>' +
          '<td class="name" data-toggle-row="' + cat.id + '">' + catName(cat.id) + '</td>' +
          '<td class="num">' + n + '</td>' +
          '<td class="num pct">' + pct(n, a ? a.total : 0) + '</td>' +
          '<td class="bar-cell"><span class="bar" style="width:' + (a && a.total ? 100 * n / a.total : 0) + '%;background:' + h.color + '"></span></td>' +
          '</tr>';
      }).join('');
      return '<div class="cat-group">' +
        '<div class="cat-group-head"><h3>' + g.title + '</h3>' +
        '<span class="group-buttons"><button type="button" class="link" data-group-all="' + g.id + '">All</button>' +
        '<button type="button" class="link" data-group-none="' + g.id + '">None</button></span></div>' +
        '<p class="hint">' + g.note + '</p>' +
        '<table class="cat-table"><thead><tr><th></th><th></th><th>Group</th><th class="num">' + (isOmaha() ? 'Hands' : 'Combos') + '</th><th class="num">%</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
    }).join('');

    renderHighlightTotal();
  }

  function renderHighlightTotal() {
    const a = state.analysis;
    if (!a) {
      $('highlight-total').innerHTML = '';
      return;
    }
    let n;
    if (isOmaha()) {
      const pos = omahaPriority();
      n = 0;
      for (let i = 0; i < a.total; i++) if (omahaColorIndex(i, pos) >= 0) n++;
    } else {
      const on = new Set(Object.keys(state.highlight).filter((id) => state.highlight[id].on));
      n = a.combos.filter((c) => c.categories.some((id) => on.has(id))).length;
    }
    $('highlight-total').innerHTML = 'Highlighted: <strong>' + n.toLocaleString() + '</strong> of ' + a.total.toLocaleString() + ' ' + handWord() +
      ' <span class="muted">(' + pct(n, a.total) + ')</span>';
  }

  // ---------------------------------------------------------------------------
  // Hand grid
  // ---------------------------------------------------------------------------

  // Which highlighted group colors this combo, or null.
  function comboColorCategory(combo, order) {
    for (const cat of order) {
      if (state.highlight[cat.id].on && combo.categories.includes(cat.id)) return cat.id;
    }
    return null;
  }

  function cellsFromAnalysis() {
    const cells = [];
    for (let r = 0; r < 13; r++) {
      cells.push([]);
      for (let c = 0; c < 13; c++) {
        const hi = P.RANKS[12 - Math.min(r, c)];
        const lo = P.RANKS[12 - Math.max(r, c)];
        const label = r === c ? hi + lo : hi + lo + (r < c ? 's' : 'o');
        cells[r].push({ row: r, col: c, label, max: r === c ? 6 : r < c ? 4 : 12, combos: [] });
      }
    }
    for (const combo of state.analysis.combos) cells[combo.row][combo.col].combos.push(combo);
    return cells;
  }

  function renderGrid() {
    if (!state.analysis) {
      $('hand-grid').innerHTML = '<p class="grid-empty">The grid fills in once the flop is complete.</p>';
      $('cell-detail').innerHTML = '';
      return;
    }
    const order = priorityOrder();
    const cells = cellsFromAnalysis();
    const html = [];
    for (const row of cells) {
      for (const cell of row) {
        const live = cell.combos.length;
        let style = '';
        let lit = 0;
        if (live) {
          const tally = {};
          for (const combo of cell.combos) {
            const id = comboColorCategory(combo, order);
            if (id) { tally[id] = (tally[id] || 0) + 1; lit++; }
          }
          const stops = [];
          let acc = 0;
          for (const cat of order) {
            if (!tally[cat.id]) continue;
            const start = acc;
            acc += 100 * tally[cat.id] / live;
            const color = state.highlight[cat.id].color;
            stops.push(color + ' ' + start.toFixed(2) + '%', color + ' ' + acc.toFixed(2) + '%');
          }
          if (stops.length) {
            stops.push('var(--cell-bg) ' + acc.toFixed(2) + '%', 'var(--cell-bg) 100%');
            style = ' style="background:linear-gradient(to top,' + stops.join(',') + ')"';
          }
        }
        const classes = ['cell'];
        if (cell.row === cell.col) classes.push('pair');
        if (!live) classes.push('dead');
        if (lit * 2 >= live && lit) classes.push('lit');
        if (state.selectedCell === cell.label) classes.push('selected');
        html.push('<button type="button" role="gridcell" class="' + classes.join(' ') + '" data-cell="' + cell.label + '"' + style +
          ' title="' + cell.label + ': ' + live + ' live combo' + (live === 1 ? '' : 's') + (lit ? ', ' + lit + ' highlighted' : '') + '">' +
          '<span class="cell-label">' + cell.label + '</span>' +
          '<span class="cell-count">' + live + (live !== cell.max ? '/' + cell.max : '') + '</span></button>');
      }
    }
    $('hand-grid').innerHTML = html.join('');
    renderCellDetail(cells);
  }

  function renderCellDetail(cells) {
    const el = $('cell-detail');
    if (!state.selectedCell) {
      el.innerHTML = '<p class="hint">Select a cell to list its combos.</p>';
      return;
    }
    const cell = cells.flat().find((c) => c.label === state.selectedCell);
    if (!cell.combos.length) {
      el.innerHTML = '<h3>' + cell.label + '</h3><p class="hint">Every combo is blocked by the board.</p>';
      return;
    }
    const items = cell.combos.map((combo) => {
      const chips = combo.categories.map((id) => {
        const h = state.highlight[id];
        return '<span class="chip' + (h.on ? ' on' : '') + '" style="--chip:' + h.color + '">' + catName(id) + '</span>';
      }).join('');
      return '<li><span class="combo-cards">' + combo.cards.map((c) => cardHTML(c, true)).join('') + '</span>' + chips + '</li>';
    }).join('');
    el.innerHTML = '<h3>' + cell.label + ' <span class="muted">&middot; ' + cell.combos.length + ' of ' + cell.max + ' combos live</span></h3>' +
      '<ul class="combo-list">' + items + '</ul>';
  }

  // ---------------------------------------------------------------------------
  // Omaha view: distribution bar, a hand checker and example hands
  // ---------------------------------------------------------------------------

  // For fast per-hand coloring: priority position of each made index and flag bit, or -1 if not highlighted.
  function omahaPriority() {
    const a = state.analysis;
    const order = priorityOrder().map((c) => c.id);
    const posOf = (id) => (state.highlight[id].on ? order.indexOf(id) : -1);
    return { order, made: a.madeIds.map(posOf), flags: a.flagIds.map(posOf) };
  }

  // Priority position of the group that colors hand i, or -1.
  function omahaColorIndex(i, pos) {
    const a = state.analysis;
    let best = pos.made[a.made[i]];
    if (best < 0) best = Infinity;
    for (let f = a.flags[i], b = 0; f; f >>>= 1, b++) {
      if ((f & 1) && pos.flags[b] >= 0 && pos.flags[b] < best) best = pos.flags[b];
    }
    return best === Infinity ? -1 : best;
  }

  function chipsHTML(ids) {
    return ids.map((id) => {
      const h = state.highlight[id];
      return '<span class="chip' + (h.on ? ' on' : '') + '" style="--chip:' + h.color + '">' + catName(id) + '</span>';
    }).join('');
  }

  function renderOmaha() {
    const a = state.analysis;
    if (!a) {
      $('dist-bar').innerHTML = '';
      $('dist-legend').innerHTML = '<li class="hint">The distribution fills in once the flop is complete.</li>';
      $('example-list').innerHTML = '';
      $('check-result').innerHTML = '';
      return;
    }

    const pos = omahaPriority();
    const tally = new Array(pos.order.length).fill(0);
    for (let i = 0; i < a.total; i++) {
      const p = omahaColorIndex(i, pos);
      if (p >= 0) tally[p]++;
    }
    const segments = pos.order.map((id, p) => ({ id, n: tally[p] })).filter((s) => s.n);
    $('dist-bar').innerHTML = segments.map((s) =>
      '<span class="dist-seg" style="flex-grow:' + s.n + ';background:' + state.highlight[s.id].color + '" title="' +
      catName(s.id) + ': ' + s.n.toLocaleString() + ' hands (' + pct(s.n, a.total) + ')"></span>').join('') +
      '<span class="dist-seg rest" style="flex-grow:' + (a.total - segments.reduce((n, s) => n + s.n, 0)) + '"></span>';
    $('dist-legend').innerHTML = segments.length
      ? segments.map((s) => '<li><span class="swatch" style="background:' + state.highlight[s.id].color + '"></span>' +
        catName(s.id) + ' <span class="muted">' + pct(s.n, a.total) + '</span></li>').join('')
      : '<li class="hint">Tick some hand groups to see their share here.</li>';

    renderExamples(false);
    renderCheck();
  }

  // Keeps the same sample while only colors or highlights change; reshuffle draws a new one.
  let examplePicks = { analysis: null, cat: null, picks: [] };

  function renderExamples(reshuffle) {
    const a = state.analysis;
    const options = gameCategories().filter((c) => a.counts[c.id] > 0);
    if (!options.some((c) => c.id === state.exampleCat)) {
      const firstLit = options.find((c) => state.highlight[c.id].on);
      state.exampleCat = (firstLit || options[0]).id;
    }
    $('example-cat').innerHTML = options.map((c) =>
      '<option value="' + c.id + '"' + (c.id === state.exampleCat ? ' selected' : '') + '>' +
      catName(c.id) + ' (' + a.counts[c.id].toLocaleString() + ')</option>').join('');

    if (reshuffle || examplePicks.analysis !== a || examplePicks.cat !== state.exampleCat) {
      examplePicks = { analysis: a, cat: state.exampleCat, picks: sampleHands(a, state.exampleCat, 12) };
    }
    $('example-list').innerHTML = examplePicks.picks.map((i) =>
      '<li><span class="combo-cards">' + a.cardsOf(i).map((c) => cardHTML(c, true)).join('') + '</span>' +
      chipsHTML(a.categoriesOf(i)) + '</li>').join('');
  }

  // Reservoir-samples up to n random hand indexes from one group.
  function sampleHands(a, catId, n) {
    const made = a.madeIds.indexOf(catId);
    const bit = 1 << a.flagIds.indexOf(catId);
    const picks = [];
    let seen = 0;
    for (let i = 0; i < a.total; i++) {
      if (made >= 0 ? a.made[i] !== made : !(a.flags[i] & bit)) continue;
      seen++;
      if (picks.length < n) picks.push(i);
      else {
        const j = Math.floor(Math.random() * seen);
        if (j < n) picks[j] = i;
      }
    }
    return picks;
  }

  function renderCheck() {
    const el = $('check-result');
    const text = state.checkText.trim();
    if (!text || !state.analysis) {
      el.innerHTML = '';
      return;
    }
    let hand;
    try {
      hand = P.parseCardList(text);
      const need = game().holeCards;
      if (hand.length !== need) throw new Error('Enter exactly ' + need + ' cards.');
      const onBoard = hand.filter((c) => boardCards().includes(c));
      if (onBoard.length) throw new Error(onBoard.map(P.cardToString).join(', ') + ' is already on the board.');
    } catch (e) {
      el.innerHTML = '<p class="check-error">' + e.message + '</p>';
      return;
    }
    const r = P.classifyOmaha(hand, boardCards(), state.game);
    let lowLine = '';
    if (game().hiLo) {
      lowLine = '<div><span class="muted">Low:</span> ' + (r.low === P.NO_LOW ? 'none' : P.lowToString(r.low) + (r.isNutLow ? ' (the nuts)' : '')) + '</div>';
    }
    el.innerHTML = '<div class="combo-list"><div class="check-row"><span class="combo-cards">' +
      hand.slice().sort((x, y) => y - x).map((c) => cardHTML(c, true)).join('') + '</span>' + chipsHTML(r.categories) + '</div></div>' +
      '<div><span class="muted">Best high hand:</span> ' + P.HAND_NAMES[r.high.category] + '</div>' + lowLine;
  }

  function renderRange() {
    if (isOmaha()) renderOmaha();
    else renderGrid();
  }

  function renderGame() {
    for (const tab of document.querySelectorAll('[data-game]')) {
      const on = tab.dataset.game === state.game;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    $('game-note').innerHTML = '<strong>' + game().name + ':</strong> ' + GAME_NOTES[state.game];
    $('check-text').placeholder = game().holeCards === 5 ? 'e.g. As Ks Qd Jd 9c' : 'e.g. As Ks Qd Jd';
    $('grid-panel').hidden = isOmaha();
    $('omaha-panel').hidden = !isOmaha();
    const lowOpt = $('color-priority').querySelector('option[value="low"]');
    lowOpt.hidden = lowOpt.disabled = !game().hiLo;
    $('color-priority').value = state.priorityGroup === 'low' && !game().hiLo ? 'made' : state.priorityGroup;
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  let updateToken = 0;

  function update() {
    $('board-text').value = boardCards().map(P.cardToString).join(' ');
    $('board-error').textContent = '';
    const token = ++updateToken;
    // 5-card Omaha means ~2 million hands: show the new board first, then count.
    if (flopComplete() && game().holeCards >= 5) {
      state.analysis = null;
      renderGame();
      renderBoard();
      $('summary').innerHTML = 'Counting every ' + game().holeCards + '-card hand&hellip;';
      document.body.classList.add('busy');
      requestAnimationFrame(() => setTimeout(() => {
        if (token === updateToken) finishUpdate();
      }, 0));
      return;
    }
    finishUpdate();
  }

  function finishUpdate() {
    state.analysis = flopComplete() ? P.analyzeBoard(boardCards(), state.game) : null;
    document.body.classList.remove('busy');
    renderGame();
    renderBoard();
    renderCategories();
    renderRange();
  }

  function refreshHighlights() {
    saveSettings();
    renderCategories();
    renderRange();
  }

  function setGroup(group, on) {
    for (const cat of gameCategories()) if (cat.group === group) state.highlight[cat.id].on = on;
    refreshHighlights();
  }

  function bind() {
    $('new-flop').addEventListener('click', newFlop);
    $('clear-flop').addEventListener('click', clearFlop);
    $('new-turn').addEventListener('click', newTurn);
    $('clear-turn').addEventListener('click', clearTurn);
    $('new-river').addEventListener('click', newRiver);
    $('clear-river').addEventListener('click', clearRiver);

    for (const id of ['flop-suits', 'flop-pairing']) {
      $(id).addEventListener('change', () => {
        state.texture = { suits: $('flop-suits').value, pairing: $('flop-pairing').value };
        saveSettings();
        renderBoard();
      });
    }

    $('board-form').addEventListener('submit', (e) => {
      e.preventDefault();
      setBoardFromText($('board-text').value);
    });

    document.querySelector('.board').addEventListener('click', (e) => {
      const slot = e.target.closest('[data-slot]');
      if (slot && !slot.disabled) openPicker(slot.dataset.slot);
    });
    $('picker-grid').addEventListener('click', (e) => {
      const pick = e.target.closest('[data-card]');
      if (pick && !pick.disabled) pickCard(+pick.dataset.card);
    });
    $('picker-random').addEventListener('click', pickRandom);
    $('picker-remove').addEventListener('click', () => pickCard(null));
    $('picker-close').addEventListener('click', () => $('picker').close());
    // Clicking the dimmed backdrop closes the picker.
    $('picker').addEventListener('click', (e) => {
      if (e.target === $('picker')) $('picker').close();
    });

    for (const tab of document.querySelectorAll('[data-game]')) {
      tab.addEventListener('click', () => {
        if (state.game === tab.dataset.game) return;
        state.game = tab.dataset.game;
        state.selectedCell = null;
        saveSettings();
        update();
      });
    }

    $('color-priority').addEventListener('change', (e) => {
      state.priorityGroup = e.target.value;
      refreshHighlights();
    });

    $('example-cat').addEventListener('change', (e) => {
      state.exampleCat = e.target.value;
      renderExamples(true);
    });
    $('example-shuffle').addEventListener('click', () => renderExamples(true));
    $('check-form').addEventListener('submit', (e) => {
      e.preventDefault();
      state.checkText = $('check-text').value;
      renderCheck();
    });

    const tables = $('category-tables');
    tables.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.toggle) {
        state.highlight[t.dataset.toggle].on = t.checked;
        refreshHighlights();
      }
    });
    // Live color preview while dragging the picker; full refresh when it closes.
    tables.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.color) {
        state.highlight[t.dataset.color].color = t.value;
        saveSettings();
        renderRange();
      }
    });
    tables.addEventListener('change', (e) => {
      if (e.target.dataset.color) renderCategories();
    });
    tables.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.toggleRow) {
        const h = state.highlight[t.dataset.toggleRow];
        h.on = !h.on;
        refreshHighlights();
      } else if (t.dataset.groupAll) {
        setGroup(t.dataset.groupAll, true);
      } else if (t.dataset.groupNone) {
        setGroup(t.dataset.groupNone, false);
      }
    });

    $('hand-grid').addEventListener('click', (e) => {
      const cell = e.target.closest('[data-cell]');
      if (!cell) return;
      state.selectedCell = state.selectedCell === cell.dataset.cell ? null : cell.dataset.cell;
      renderGrid();
    });
  }

  loadSettings();
  bind();
  newFlop();
})();
