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
    view: 'range', // 'range' (hand groups) or 'equity'
    equity: { hands: ['', ''], ran: false },
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
    if (saved.view === 'equity' || saved.view === 'runouts') state.view = saved.view;
    state.priorityGroup = ['made', 'draw', 'low'].includes(saved.priorityGroup) ? saved.priorityGroup
      : saved.drawsFirst ? 'draw' : 'made';
    const t = saved.texture || {};
    if (P.textureIsPossible(t.suits, t.pairing)) state.texture = { suits: t.suits || 'any', pairing: t.pairing || 'any' };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ highlight: state.highlight, priorityGroup: state.priorityGroup, texture: state.texture, game: state.game, view: state.view }));
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

  // In the equity view, cards in the players' hands can't be dealt to the board.
  function heldCards() {
    if (state.view !== 'equity') return [];
    const held = [];
    for (const text of state.equity.hands) {
      try { held.push(...P.parseCardList(text)); } catch (e) { /* a half-typed hand holds nothing */ }
    }
    return held;
  }

  function newFlop() {
    // The turn and river belong to the old hand, so they go too.
    state.flop = P.drawFlop(state.texture, heldCards()) || P.drawFlop({}, heldCards());
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
    state.turn = P.drawCards(1, state.flop.concat(state.river === null ? [] : [state.river], heldCards()))[0];
    update();
  }

  function clearTurn() {
    state.turn = null;
    state.river = null; // a river without a turn makes no sense
    update();
  }

  function newRiver() {
    if (state.turn === null) return;
    state.river = P.drawCards(1, state.flop.concat([state.turn], heldCards()))[0];
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

    const street = state.river !== null ? 'River' : state.turn !== null ? 'Turn' : 'Flop';
    if (state.view === 'runouts') {
      const shown = boardCards().length;
      $('summary').innerHTML = shown === 0 ? '<strong>Preflop</strong> &middot; how often each flop texture comes up'
        : !flopComplete() ? '<strong>Partial flop</strong> &middot; pick all three flop cards for the runout tree'
          : '<strong>' + street + '</strong> &middot; ' + (shown === 5 ? 'all board cards are out' : (52 - shown) + ' unseen cards');
      return;
    }
    if (state.view === 'equity') {
      const shown = boardCards().length;
      $('summary').innerHTML = shown === 0
        ? '<strong>Preflop</strong> &middot; equity over all five board cards to come'
        : '<strong>' + (flopComplete() ? street : 'Partial flop') + '</strong> &middot; ' +
          (shown === 5 ? 'all board cards are out' : 'equity over the ' + (5 - shown) + ' board card' + (shown === 4 ? '' : 's') + ' to come');
      return;
    }
    const a = state.analysis;
    if (!a) {
      $('summary').innerHTML = 'Pick all three flop cards, or deal a new flop, to see the analysis.';
      return;
    }
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
    const dead = new Set(boardCards().filter((c) => c !== current).concat(heldCards()));
    $('picker-title').textContent = (current === null ? 'Choose the ' : 'Change the ') + SLOT_NAMES[slot];

    const html = [];
    for (const suit of [0, 1, 2, 3]) {
      for (let rank = 12; rank >= 0; rank--) {
        const c = P.makeCard(rank, suit);
        const used = dead.has(c);
        html.push('<button type="button" class="pick' + (c === current ? ' current' : '') + '" data-card="' + c + '"' +
          (used ? ' disabled title="Already in use"' : '') + ' aria-label="' + P.cardToString(c) + '">' +
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
    const exclude = boardCards().concat(current === null ? [] : [current], heldCards());
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
    for (const tab of document.querySelectorAll('[data-view]')) {
      const on = tab.dataset.view === state.view;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    $('range-layout').hidden = state.view !== 'range';
    $('equity-panel').hidden = state.view !== 'equity';
    $('runout-panel').hidden = state.view !== 'runouts';
    $('grid-panel').hidden = isOmaha();
    $('omaha-panel').hidden = !isOmaha();
    const lowOpt = $('color-priority').querySelector('option[value="low"]');
    lowOpt.hidden = lowOpt.disabled = !game().hiLo;
    $('color-priority').value = state.priorityGroup === 'low' && !game().hiLo ? 'made' : state.priorityGroup;
  }

  // ---------------------------------------------------------------------------
  // Equity calculator
  // ---------------------------------------------------------------------------

  const PLAYER_COLORS = ['#3d7bff', '#ff7a45', '#10c48a', '#b14cff', '#e0b100', '#ff2d95'];
  const MAX_PLAYERS = 6;
  let equityToken = 0;

  function renderEquityPlayers() {
    const n = game().holeCards;
    const example = { 2: 'As Kd', 4: 'As Kd Qh Jc', 5: 'As Kd Qh Jc 9s' }[n];
    const hands = state.equity.hands;
    $('equity-players').innerHTML = hands.map((text, i) =>
      '<div class="eq-row" style="--player:' + PLAYER_COLORS[i] + '">' +
        '<label class="eq-label" for="eq-input-' + i + '"><span class="eq-dot"></span>Player ' + (i + 1) + '</label>' +
        '<div class="eq-inputs">' +
          '<input id="eq-input-' + i + '" data-eq-input="' + i + '" type="text" value="' + text.replace(/"/g, '&quot;') + '"' +
          ' placeholder="Blank = random hand" title="Type ' + n + ' cards, e.g. ' + example + '" autocomplete="off" spellcheck="false" autocapitalize="off">' +
          '<button type="button" data-eq-random="' + i + '">Random</button>' +
          '<button type="button" class="ghost eq-remove" data-eq-remove="' + i + '" aria-label="Remove player ' + (i + 1) + '"' +
          (hands.length <= 2 ? ' disabled' : '') + '>&times;</button>' +
        '</div>' +
        '<div class="eq-result" id="eq-result-' + i + '"></div>' +
      '</div>').join('');
    $('equity-add').disabled = hands.length >= MAX_PLAYERS;
  }

  // Parses every player's hand. Returns { hands, errors } where hands[i] is null for a random hand.
  function readEquityHands() {
    const need = game().holeCards;
    const board = new Set(boardCards());
    const used = new Map();
    const hands = [];
    const errors = [];
    state.equity.hands.forEach((text, i) => {
      if (!text.trim()) { hands.push(null); return; }
      try {
        const cards = P.parseCardList(text);
        if (cards.length !== need) throw new Error('Enter exactly ' + need + ' cards, or leave it blank for a random hand.');
        for (const c of cards) {
          if (board.has(c)) throw new Error(P.cardToString(c) + ' is on the board.');
          if (used.has(c)) throw new Error(P.cardToString(c) + ' is already in Player ' + (used.get(c) + 1) + '’s hand.');
        }
        cards.forEach((c) => used.set(c, i));
        hands.push(cards);
      } catch (e) {
        hands.push(null);
        errors[i] = e.message;
      }
    });
    return { hands, errors };
  }

  function randomHandFor(i) {
    const dead = boardCards().slice();
    state.equity.hands.forEach((text, j) => {
      if (j === i || !text.trim()) return;
      try { dead.push(...P.parseCardList(text)); } catch (e) { /* ignore a half-typed hand */ }
    });
    const hand = P.drawCards(game().holeCards, dead).sort((a, b) => b - a);
    state.equity.hands[i] = hand.map(P.cardToString).join(' ');
    $('eq-input-' + i).value = state.equity.hands[i];
    runEquity();
  }

  const pctText = (x, digits) => (100 * x).toFixed(digits === undefined ? 1 : digits) + '%';

  function renderEquityResults(r) {
    r.players.forEach((p, i) => {
      const el = $('eq-result-' + i);
      if (!el) return;
      const details = r.hiLo
        ? 'Scoop ' + pctText(p.win) + ' &middot; Wins high ' + pctText(p.high) + ' &middot; Wins low ' + pctText(p.low)
        : 'Win ' + pctText(p.win) + ' &middot; Tie ' + pctText(p.tie);
      el.classList.remove('stale', 'error');
      el.innerHTML = '<div class="eq-bar"><span style="width:' + (100 * p.equity).toFixed(2) + '%"></span></div>' +
        '<div class="eq-numbers"><strong>' + pctText(p.equity, 2) + '</strong> <span class="muted">equity</span>' +
        '<span class="eq-details">' + details + '</span></div>';
    });
  }

  function runEquity() {
    const token = ++equityToken;
    const { hands, errors } = readEquityHands();
    state.equity.hands.forEach((t, i) => {
      const el = $('eq-result-' + i);
      if (errors[i]) {
        el.className = 'eq-result error';
        el.textContent = errors[i];
      }
    });
    if (errors.length) {
      $('equity-status').textContent = 'Fix the highlighted hands to calculate.';
      $('equity-progress').hidden = true;
      return;
    }

    let job;
    try {
      job = P.createEquityJob(hands, boardCards(), state.game);
    } catch (e) {
      $('equity-status').textContent = e.message;
      return;
    }
    state.equity.ran = true;
    $('equity-progress').hidden = false;
    $('equity-progress-bar').style.width = '0%';
    $('equity-status').textContent = job.exact
      ? 'Checking all ' + job.totalRunouts.toLocaleString() + ' runouts…'
      : 'Simulating random runouts…';

    const tick = () => {
      if (token !== equityToken) return; // a newer calculation took over
      const finished = job.step(40);
      const r = job.results();
      renderEquityResults(r);
      $('equity-progress-bar').style.width = (100 * r.progress).toFixed(1) + '%';
      if (!finished) {
        setTimeout(tick, 0);
        return;
      }
      $('equity-progress').hidden = true;
      if (r.exact) {
        $('equity-status').textContent = 'Exact: checked every one of ' + r.runouts.toLocaleString() + ' runout' + (r.runouts === 1 ? '' : 's') + '.';
      } else {
        const margin = 1.96 * Math.max(...r.players.map((p) => p.error));
        $('equity-status').textContent = 'Simulated ' + r.runouts.toLocaleString() + ' random runouts' +
          (hands.includes(null) ? ' and random hands' : '') + '; results are within about ±' + (100 * margin).toFixed(1) + '%.';
      }
    };
    tick();
  }

  // Marks results out of date while a hand is being edited.
  function markEquityStale() {
    equityToken++;
    $('equity-progress').hidden = true;
    for (const el of document.querySelectorAll('.eq-result')) if (el.innerHTML) el.classList.add('stale');
    $('equity-status').textContent = 'Press Calculate (or Enter) to update.';
  }

  // ---------------------------------------------------------------------------
  // Runout tree
  // ---------------------------------------------------------------------------

  // Branch colors by the kind of change that leads the branch's label.
  const RUNOUT_COLORS = {
    flush5: '#2f5bd8', flush4: '#3d7bff', flush3: '#6d9bff', 'flush-draw': '#9ab8ff',
    straight5: '#0d9488', straight4: '#14b8a6', straight3: '#5eead4',
    quads: '#c2410c', 'full-house': '#ea580c', trips: '#f97316', 'two-pair': '#fb923c', pair: '#fdba74',
    low: '#e85dff', overcard: '#a78bfa', blank: '#9ca3af',
  };
  const runoutColor = (tags) => RUNOUT_COLORS[tags[0]];
  const SUIT_TEXT = { monotone: 'Monotone', 'two-tone': 'Two-tone', rainbow: 'Rainbow' };
  const PAIRING_TEXT = { unpaired: 'unpaired', paired: 'paired', trips: 'trips' };

  function nodeHTML(label, color, prob, extra) {
    return '<span class="node-bar"><span style="width:' + (100 * prob).toFixed(1) + '%;background:' + color + '"></span></span>' +
      '<span class="node-label"><span class="swatch" style="background:' + color + '"></span>' + label + '</span>' +
      '<span class="node-pct">' + pctFine(prob) + '</span>' + (extra ? '<span class="node-extra">' + extra + '</span>' : '');
  }

  // One decimal, or two for rare branches so they don't read "0.0%".
  const pctFine = (x) => (x >= 0.001 || x === 0 ? (100 * x).toFixed(1) : (100 * x).toFixed(2)) + "%";

  function renderRunouts() {
    const body = $('runout-body');
    const board = boardCards();

    if (board.length === 0) {
      $('runout-hint').textContent = 'Deal or pick a flop to see the turn and river tree.';
      const odds = P.flopTextureOdds();
      body.innerHTML = '<h3 class="runout-sub">Flop textures before the flop</h3><ul class="tree root">' + odds.map((o) =>
        '<li><div class="node leaf">' + nodeHTML(SUIT_TEXT[o.suits] + ', ' + PAIRING_TEXT[o.pairing], '#6d9bff', o.prob,
          o.count.toLocaleString() + ' of 22,100 flops') + '</div></li>').join('') + '</ul>';
      return;
    }
    if (!flopComplete()) {
      $('runout-hint').textContent = '';
      body.innerHTML = '<p class="hint">Pick all three flop cards to see the runout tree.</p>';
      return;
    }
    if (board.length === 5) {
      $('runout-hint').textContent = '';
      body.innerHTML = '<p class="hint">All five board cards are out. Clear the river (or the turn) to see what could have come.</p>';
      return;
    }

    const tree = P.runoutTree(board, state.game);
    const nextName = tree.street === 'turn' ? 'turn' : 'river';
    $('runout-hint').textContent = 'Out of the ' + tree.unseen + ' unseen cards (players’ hole cards aren’t removed). ' +
      'Click a card to deal it.';

    const totals = P.RUNOUT_TAGS.filter((t) => tree.tagTotals[t.id] && t.id !== 'blank').map((t) =>
      '<li><span class="swatch" style="background:' + RUNOUT_COLORS[t.id] + '"></span>' + t.name + ' <strong>' + pctFine(tree.tagTotals[t.id]) + '</strong></li>').join('');

    const branches = tree.groups.map((g) => {
      const cardsHTML = '<div class="node-cards">' + g.cards.map((c) =>
        '<button type="button" class="pick" data-runout-card="' + c + '" title="Deal ' + P.cardToString(c) + ' as the ' + nextName + '">' +
        cardHTML(c, true) + '</button>').join('') + '</div>';
      const river = g.river ? '<ul class="tree">' + g.river.map((r) =>
        '<li><div class="node leaf">' + nodeHTML(r.label, runoutColor(r.tags), r.prob, pctFine(r.overall) + ' overall') + '</div></li>').join('') + '</ul>' : '';
      return '<li><details class="node"><summary>' +
        nodeHTML(g.label, runoutColor(g.tags), g.prob, g.count + ' of ' + tree.unseen + ' cards') + '</summary>' +
        cardsHTML + (river ? '<p class="runout-sub">Then on the river <span class="muted">(chance given this turn &middot; overall)</span></p>' + river : '') +
        '</details></li>';
    }).join('');

    body.innerHTML =
      '<div class="runout-totals"><span class="muted">Any ' + nextName + ' card that&hellip;</span><ul class="dist-legend">' + totals + '</ul></div>' +
      '<p class="runout-root">' + (tree.street === 'turn' ? 'Flop' : 'Turn') + ' <span class="combo-cards">' +
        board.map((c) => cardHTML(c, true)).join('') + '</span> &rarr; ' + nextName + ' cards:' +
        (tree.street === 'turn' ? ' <button type="button" class="link" id="runout-expand">Expand all</button>' : '') + '</p>' +
      '<ul class="tree root">' + branches + '</ul>';
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  let updateToken = 0;

  function update() {
    $('board-text').value = boardCards().map(P.cardToString).join(' ');
    $('board-error').textContent = '';
    const token = ++updateToken;
    if (state.view !== 'range') {
      // The hand-group analysis isn't on screen, so skip it; it's redone when switching back.
      state.analysis = null;
      document.body.classList.remove('busy');
      renderGame();
      renderBoard();
      if (state.view === 'equity' && state.equity.ran) runEquity();
      if (state.view === 'runouts') renderRunouts();
      return;
    }
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
        renderEquityPlayers();
        update();
      });
    }

    for (const tab of document.querySelectorAll('[data-view]')) {
      tab.addEventListener('click', () => {
        if (state.view === tab.dataset.view) return;
        state.view = tab.dataset.view;
        saveSettings();
        update();
      });
    }

    $('equity-add').addEventListener('click', () => {
      if (state.equity.hands.length >= MAX_PLAYERS) return;
      state.equity.hands.push('');
      renderEquityPlayers();
      if (state.equity.ran) runEquity();
    });
    $('equity-run').addEventListener('click', runEquity);

    $('runout-body').addEventListener('click', (e) => {
      const card = e.target.closest('[data-runout-card]');
      if (card) {
        setSlot(state.turn === null ? 'turn' : 'river', +card.dataset.runoutCard);
        return;
      }
      if (e.target.id === 'runout-expand') {
        const all = [...$('runout-body').querySelectorAll('details')];
        const open = !all.every((d) => d.open);
        for (const d of all) d.open = open;
        e.target.textContent = open ? 'Collapse all' : 'Expand all';
      }
    });
    const players = $('equity-players');
    players.addEventListener('input', (e) => {
      const i = e.target.dataset.eqInput;
      if (i === undefined) return;
      state.equity.hands[+i] = e.target.value;
      markEquityStale();
    });
    players.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.eqInput !== undefined) runEquity();
    });
    players.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.eqRandom !== undefined) randomHandFor(+t.dataset.eqRandom);
      else if (t.dataset.eqRemove !== undefined) {
        state.equity.hands.splice(+t.dataset.eqRemove, 1);
        renderEquityPlayers();
        if (state.equity.ran) runEquity();
      }
    });

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
  renderEquityPlayers();
  bind();
  newFlop();
})();
