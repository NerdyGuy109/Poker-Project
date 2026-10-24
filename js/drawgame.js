/*
 * The 2-7 draw view: hand analyzer, starting-draw chart and strategy notes.
 * Uses window.Poker (card parsing), window.Lowball (2-7 math) and window.DrawCharts (precomputed odds).
 */
(function () {
  'use strict';

  const P = window.Poker;
  const L = window.Lowball;

  const state = {
    game: null,
    hand: null, // five cards
    keepMask: null, // cards the player chose to keep (bit per card), or null
    target: '8',
    options: null,
    showAll: false,
    chartDraw: 1,
    chartAll: false,
    text: '',
  };
  let root = null;

  const isTriple = () => state.game === '27td';
  const draws = () => (isTriple() ? 3 : 1);
  const pct = (x) => (100 * x).toFixed(1) + '%';
  const targetName = (id) => L.TARGETS.find((t) => t.id === id).name;

  function cardHTML(c, small, extraClass) {
    const suit = P.SUITS[P.suitOf(c)];
    const rank = P.RANKS[P.rankOf(c)];
    return '<span class="card suit-' + suit + (small ? ' small' : '') + (extraClass ? ' ' + extraClass : '') + '" aria-label="' + P.cardToString(c) + '">' +
      '<span class="rank">' + (rank === 'T' ? '10' : rank) + '</span><span class="pip">' + P.SUIT_SYMBOLS[suit] + '</span></span>';
  }

  // Sort by the chosen target, breaking ties with the tighter targets, then by drawing fewer cards.
  function compareBy(target, probsOf, drawOf) {
    const order = L.TARGETS.map((t) => t.id);
    const ties = [target].concat(order.filter((id) => id !== target));
    return (a, b) => {
      for (const id of ties) {
        const d = probsOf(b)[id] - probsOf(a)[id];
        if (Math.abs(d) > 1e-9) return d;
      }
      return drawOf ? drawOf(a) - drawOf(b) : 0;
    };
  }

  // ---------------------------------------------------------------------------
  // Hand analyzer
  // ---------------------------------------------------------------------------

  function analyze() {
    if (!state.hand) return;
    const out = root.querySelector('#dg-options');
    out.innerHTML = '<p class="hint">Working out all 32 ways to draw&hellip;</p>';
    setTimeout(() => {
      state.options = L.analyzeHand(state.hand, draws(), 4000);
      if (state.keepMask === null) {
        const best = state.options.slice().sort(compareBy(state.target, (o) => o.probs, (o) => o.draw))[0];
        state.keepMask = best.mask;
      }
      renderHand();
    }, 20);
  }

  function setHand(cards) {
    state.hand = cards;
    state.keepMask = null;
    state.options = null;
    state.showAll = false;
    state.text = cards.map(P.cardToString).join(' ');
    renderHand();
    analyze();
  }

  function renderHand() {
    const el = root.querySelector('#dg-hand');
    const opts = root.querySelector('#dg-options');
    if (!state.hand) {
      el.innerHTML = '';
      opts.innerHTML = '<p class="hint">Deal a random hand or type five cards to see every way to draw.</p>';
      return;
    }
    const d = L.describe27(state.hand);
    const keep = state.keepMask === null ? 31 : state.keepMask;
    el.innerHTML =
      '<div class="dg-cards">' + state.hand.map((c, i) => {
        const kept = keep & (1 << i);
        return '<button type="button" class="dg-card' + (kept ? '' : ' discard') + '" data-card-index="' + i + '" aria-pressed="' + (kept ? 'false' : 'true') + '" title="Tap to ' + (kept ? 'discard' : 'keep') + '">' +
          cardHTML(state.hand[i]) + '<span class="dg-card-tag">' + (kept ? 'Keep' : 'Draw') + '</span></button>';
      }).join('') + '</div>' +
      '<p class="dg-desc"><strong>' + d.text + '</strong> &middot; ' + d.name + '</p>' +
      '<p class="hint">Tap cards to choose what to throw away; the table shows every option.</p>';

    if (!state.options) return;
    const sorted = state.options.slice().sort(compareBy(state.target, (o) => o.probs, (o) => o.draw));
    const best = {};
    for (const t of L.TARGETS) best[t.id] = Math.max(...state.options.map((o) => o.probs[t.id]));
    const chosen = state.options.find((o) => o.mask === state.keepMask);
    const rows = (state.showAll ? sorted : sorted.slice(0, 8));
    if (chosen && !rows.includes(chosen)) rows.push(chosen);

    const rowHTML = (o) => {
      const keepText = o.kept.length ? o.kept.slice().sort((a, b) => b - a).map((c) => cardHTML(c, true)).join('') : '<span class="muted">nothing</span>';
      return '<tr class="' + (o === chosen ? 'chosen' : '') + '" data-mask="' + o.mask + '"><td><span class="combo-cards">' + keepText + '</span></td>' +
        '<td>' + (o.draw ? 'Draw ' + o.draw : isTriple() ? 'Pat now' : 'Pat') + '</td>' +
        L.TARGETS.map((t) => '<td class="num' + (t.id === state.target ? ' sorted' : '') + (o.probs[t.id] > 0 && Math.abs(o.probs[t.id] - best[t.id]) < 1e-9 ? ' best' : '') + '">' + pct(o.probs[t.id]) + '</td>').join('') + '</tr>';
    };

    opts.innerHTML =
      (chosen ? '<p class="dg-choice">' + (chosen.draw ? 'Keeping these and drawing ' + chosen.draw : isTriple() ? 'Standing pat on this draw' : 'Standing pat') + ': <strong>' + pct(chosen.probs[state.target]) + '</strong> to finish with ' + targetName(state.target).replace(' or better', ' low or better') +
        (sorted[0] !== chosen && sorted[0].probs[state.target] > chosen.probs[state.target] + 1e-9 ? ' <span class="muted">(best option: ' + pct(sorted[0].probs[state.target]) + ')</span>' : ' <span class="dg-good">best option</span>') + '</p>' : '') +
      '<div class="mn-table-wrap"><table class="mn-table dg-table"><thead><tr><th>Keep</th><th>Draw</th>' +
        L.TARGETS.map((t) => '<th class="num"><button type="button" class="link' + (t.id === state.target ? ' active' : '') + '" data-target="' + t.id + '">' + t.name + '</button></th>').join('') +
      '</tr></thead><tbody>' + rows.map(rowHTML).join('') + '</tbody></table></div>' +
      '<p class="hint">' + (isTriple()
        ? 'Chance of finishing with each low or better after all three draws, from 4,000 simulated runs per option (every option sees the same shuffles; gaps under about 1% are noise). After the first draw it stands pat once it reaches the target, otherwise it keeps one card of each rank at or below the target.'
        : 'Exact chance of each low or better after the one draw, counting every possible card from the 47 you haven’t seen.') +
      ' Click a column to sort by it; click a row to pick that option.</p>' +
      (state.options.length > 8 ? '<button type="button" class="link" id="dg-show-all">' + (state.showAll ? 'Show top 8' : 'Show all 32 options') + '</button>' : '');
  }

  // ---------------------------------------------------------------------------
  // Starting-draw chart
  // ---------------------------------------------------------------------------

  function renderChart() {
    const el = root.querySelector('#dg-chart');
    const data = window.DrawCharts;
    const mode = isTriple() ? 'triple' : 'single';
    const list = data.entries.filter((e) => e.draw === state.chartDraw)
      .sort(compareBy(state.target, (e) => e[mode]));
    const shown = state.chartAll ? list : list.slice(0, 20);
    const max = list.length ? list[0][mode][state.target] : 1;
    el.innerHTML =
      '<div class="tell-filter">' + [1, 2, 3].map((n) =>
        '<button type="button" data-chart-draw="' + n + '" class="' + (n === state.chartDraw ? 'active' : '') + '">Drawing ' + n + ' (keep ' + (5 - n) + ')</button>').join('') + '</div>' +
      '<div class="mn-table-wrap"><table class="mn-table dg-table"><thead><tr><th>Keep</th>' +
        L.TARGETS.map((t) => '<th class="num"><button type="button" class="link' + (t.id === state.target ? ' active' : '') + '" data-target="' + t.id + '">' + t.name + '</button></th>').join('') +
        '<th></th></tr></thead><tbody>' +
        shown.map((e) => '<tr><td><strong>' + e.keep + '</strong></td>' +
          L.TARGETS.map((t) => '<td class="num' + (t.id === state.target ? ' sorted' : '') + '">' + pct(e[mode][t.id]) + '</td>').join('') +
          '<td class="dg-bar-cell"><span class="dg-bar" style="width:' + (max ? 100 * e[mode][state.target] / max : 0).toFixed(1) + '%"></span></td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="hint">' + (isTriple()
        ? 'Chance of finishing with each low or better over three draws, keeping these cards for the first draw (' + data.trials.toLocaleString() + ' simulated runs each, same drawing rule as above).'
        : 'Exact chance of each low or better after one draw, keeping these cards.') +
      ' Suits are mixed and the cards you threw away are ignored.</p>' +
      (list.length > 20 ? '<button type="button" class="link" id="dg-chart-all">' + (state.chartAll ? 'Show top 20' : 'Show all ' + list.length) + '</button>' : '');
  }

  // ---------------------------------------------------------------------------
  // Strategy notes
  // ---------------------------------------------------------------------------

  const NOTES_COMMON = [
    ['How hands rank', 'Compare the highest card first, then the next: <strong>7-5-4-3-2</strong> (&ldquo;number one&rdquo;) beats 7-6-4-3-2, which beats 7-6-5-3-2, and so on; any 7 beats any 8. 8-5-4-3-2 beats 8-6-4-3-2. Pairs, straights and flushes rank above every unpaired hand, so they lose to it.'],
    ['Aces are high', 'An ace is the highest card, so A-2-3-4-5 is just an ace-high hand, not a straight and not a good low. Throw aces away.'],
    ['Deuces and sevens', 'Every 7-low contains both a 2 and a 7, so they are the key cards. Holding them makes your hand better and also removes cards your opponents need.'],
    ['Smoothness', 'After the top card, lower is better: 8-5-3-2 is a much stronger draw than 8-7-6-2. A rough hand (like 9-8-7-6-2) is barely better than a 9-high and loses to most smooth 9s.'],
    ['Straight danger', 'Connected cards like 3-4-5-6 are poor: both a 2 and a 7 make a straight. Gapped draws such as 2-3-5-7 or 2-4-5-7 have more good cards to catch.'],
    ['Count the draws', 'How many cards each player draws is the main information you get. Drawing fewer cards than your opponent is usually an edge; standing pat tells them you have a hand (or are bluffing).'],
    ['Snowing', 'Standing pat with a bad hand as a bluff. It works best against players drawing several cards and is more powerful when bets are big.'],
  ];

  const NOTES_SINGLE = [
    ['One draw only', 'There is just one draw, so made hands are strong: a pat 9 or 10 often wins heads-up, and even a good one-card draw is an underdog to a pat 9 (it makes a 9 or better only about a third of the time).'],
    ['Usually no-limit', 'Single draw is usually played no-limit, so position, bet sizing and bluffs (including snowing) matter more than in triple draw.'],
    ['One-card draws', 'Drawing one to 2-3-4-7 or 2-3-5-7 hits a 9 or better about a third of the time; check the chart for the exact odds of each draw.'],
    ['Pat or draw?', 'Breaking a made hand is rarely right with only one draw: stand pat on decent 9s and 10s and draw only with hands that are clearly worse.'],
  ];

  const NOTES_TRIPLE = [
    ['Three draws', 'With three draws, draws are worth far more: a one-card draw makes an 8 or better about 59% of the time by the end. Starting draws, not made hands, are what you play preflop.'],
    ['Usually limit', 'Triple draw is usually fixed-limit, so the game is about entering pots with good draws, drawing efficiently and value betting made hands.'],
    ['Good starts', 'Two-card draws with a deuce and a seven or eight (2-3-7, 2-4-7, 2-3-8) are strong opens; the best three-card draws are 2-7 and 2-8. Avoid starts with pairs, aces and face cards.'],
    ['Breaking made hands', 'With draws left, breaking a rough made hand (say 9-8 or 10-high) to draw one to a smooth 7 or 8 is often right, especially in position or against an opponent drawing more cards.'],
    ['Position', 'Acting last lets you see how many cards your opponent draws before you decide whether to stand pat, draw or break.'],
  ];

  function notesHTML(list) {
    return '<dl class="dg-notes">' + list.map(([t, d]) => '<dt>' + t + '</dt><dd>' + d + '</dd>').join('') + '</dl>';
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  function render(container, gameId) {
    const changed = root !== container || state.game !== gameId;
    root = container;
    state.game = gameId;
    if (!changed && root.hasChildNodes()) return;
    state.options = null;

    const name = isTriple() ? '2-7 triple draw' : '2-7 single draw';
    root.innerHTML =
      '<div class="panel-head"><h2>' + name + '</h2><span class="hint">Lowest hand wins &middot; aces high &middot; straights and flushes count against you</span></div>' +
      '<p class="dg-rules">Each player gets five cards, then ' + (isTriple() ? 'there are <strong>three draws</strong> (usually played fixed-limit)' : 'there is <strong>one draw</strong> (usually played no-limit)') +
        ': throw away any cards and get new ones. The best hand is <strong>7-5-4-3-2</strong> of mixed suits.</p>' +

      '<h3 class="tell-section">Your hand</h3>' +
      '<form class="dg-input" id="dg-form"><input id="dg-text" type="text" placeholder="e.g. 8s 6d 5c 3h Ks" autocomplete="off" spellcheck="false" autocapitalize="off" value="' + state.text.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">' +
        '<button type="submit">Analyze</button><button type="button" class="primary" id="dg-random">Random hand</button></form>' +
      '<p class="board-error dg-error" id="dg-error" role="alert"></p>' +
      '<div id="dg-hand"></div>' +
      '<div id="dg-options"></div>' +

      '<h3 class="tell-section">Starting draws</h3>' +
      '<p class="hint">How often each starting draw ends up at each target, so you can compare draws at a glance.</p>' +
      '<div id="dg-chart"></div>' +

      '<h3 class="tell-section">Strategy notes</h3>' +
      notesHTML(NOTES_COMMON) +
      '<h4 class="dg-notes-head">' + (isTriple() ? 'Triple draw' : 'Single draw') + '</h4>' +
      notesHTML(isTriple() ? NOTES_TRIPLE : NOTES_SINGLE);

    bind();
    renderHand();
    renderChart();
    if (state.hand) analyze();
  }

  function bind() {
    root.querySelector('#dg-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = root.querySelector('#dg-error');
      err.textContent = '';
      try {
        const cards = P.parseCardList(root.querySelector('#dg-text').value);
        if (cards.length !== 5) throw new Error('Enter exactly 5 cards.');
        setHand(cards);
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    root.querySelector('#dg-random').addEventListener('click', () => {
      root.querySelector('#dg-error').textContent = '';
      const cards = P.drawCards(5).sort((a, b) => b - a);
      root.querySelector('#dg-text').value = cards.map(P.cardToString).join(' ');
      setHand(cards);
    });
    root.addEventListener('click', (e) => {
      const card = e.target.closest('[data-card-index]');
      if (card) {
        const keep = state.keepMask === null ? 31 : state.keepMask;
        state.keepMask = keep ^ (1 << +card.dataset.cardIndex);
        renderHand();
        return;
      }
      const target = e.target.closest('[data-target]');
      if (target) {
        state.target = target.dataset.target;
        renderHand();
        renderChart();
        return;
      }
      const row = e.target.closest('tr[data-mask]');
      if (row) {
        state.keepMask = +row.dataset.mask;
        renderHand();
        return;
      }
      if (e.target.id === 'dg-show-all') {
        state.showAll = !state.showAll;
        renderHand();
      } else if (e.target.closest('[data-chart-draw]')) {
        state.chartDraw = +e.target.closest('[data-chart-draw]').dataset.chartDraw;
        state.chartAll = false;
        renderChart();
      } else if (e.target.id === 'dg-chart-all') {
        state.chartAll = !state.chartAll;
        renderChart();
      }
    });
  }

  window.DrawGame = { render };
})();
