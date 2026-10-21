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
    drawsFirst: false,
    highlight: {}, // category id -> { on, color }
    texture: { suits: 'any', pairing: 'any' },
    pickerSlot: null, // 'flop-0' | 'flop-1' | 'flop-2' | 'turn' | 'river' while the card picker is open
  };

  const $ = (id) => document.getElementById(id);
  const catById = Object.fromEntries(P.CATEGORIES.map((c) => [c.id, c]));

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
    state.drawsFirst = !!saved.drawsFirst;
    const t = saved.texture || {};
    if (P.textureIsPossible(t.suits, t.pairing)) state.texture = { suits: t.suits || 'any', pairing: t.pairing || 'any' };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ highlight: state.highlight, drawsFirst: state.drawsFirst, texture: state.texture }));
    } catch (e) { /* storage unavailable */ }
  }

  // Categories in priority order for coloring.
  function priorityOrder() {
    const made = P.CATEGORIES.filter((c) => c.group === 'made');
    const draws = P.CATEGORIES.filter((c) => c.group === 'draw');
    return state.drawsFirst ? draws.concat(made) : made.concat(draws);
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
      a.total.toLocaleString() + ' possible hole-card combos ' +
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
    const groups = [
      { id: 'made', title: 'Made hands', note: 'Each combo is counted in exactly one made-hand group.' },
      { id: 'draw', title: 'Draws', note: a && boardCards().length === 5 ? 'No draws on the river.' : 'A combo can have several draws, or a draw plus a made hand.' },
    ];

    $('category-tables').innerHTML = groups.map((g) => {
      const rows = P.CATEGORIES.filter((c) => c.group === g.id).map((cat) => {
        const h = state.highlight[cat.id];
        const n = a ? a.counts[cat.id] : 0;
        return '<tr class="' + (h.on ? 'on' : '') + (n ? '' : ' zero') + '">' +
          '<td><input type="checkbox" data-toggle="' + cat.id + '"' + (h.on ? ' checked' : '') + ' aria-label="Highlight ' + cat.name + '"></td>' +
          '<td><input type="color" data-color="' + cat.id + '" value="' + h.color + '" aria-label="Color for ' + cat.name + '"></td>' +
          '<td class="name" data-toggle-row="' + cat.id + '">' + cat.name + '</td>' +
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
        '<table class="cat-table"><thead><tr><th></th><th></th><th>Group</th><th class="num">Combos</th><th class="num">%</th><th></th></tr></thead>' +
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
    const on = new Set(Object.keys(state.highlight).filter((id) => state.highlight[id].on));
    const n = a.combos.filter((c) => c.categories.some((id) => on.has(id))).length;
    $('highlight-total').innerHTML = 'Highlighted: <strong>' + n + '</strong> of ' + a.total + ' combos <span class="muted">(' + pct(n, a.total) + ')</span>';
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
        return '<span class="chip' + (h.on ? ' on' : '') + '" style="--chip:' + h.color + '">' + catById[id].name + '</span>';
      }).join('');
      return '<li><span class="combo-cards">' + combo.cards.map((c) => cardHTML(c, true)).join('') + '</span>' + chips + '</li>';
    }).join('');
    el.innerHTML = '<h3>' + cell.label + ' <span class="muted">&middot; ' + cell.combos.length + ' of ' + cell.max + ' combos live</span></h3>' +
      '<ul class="combo-list">' + items + '</ul>';
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function update() {
    state.analysis = flopComplete() ? P.analyzeBoard(boardCards()) : null;
    $('board-text').value = boardCards().map(P.cardToString).join(' ');
    $('board-error').textContent = '';
    renderBoard();
    renderCategories();
    renderGrid();
  }

  function refreshHighlights() {
    saveSettings();
    renderCategories();
    renderGrid();
  }

  function setGroup(group, on) {
    for (const cat of P.CATEGORIES) if (cat.group === group) state.highlight[cat.id].on = on;
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

    $('draws-first').checked = state.drawsFirst;
    $('draws-first').addEventListener('change', (e) => {
      state.drawsFirst = e.target.checked;
      saveSettings();
      renderGrid();
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
        renderGrid();
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
