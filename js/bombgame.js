/*
 * The double-board bomb pot view: deal two boards, find the hands strongest on both, simulate
 * their equity against the field, check your own hand, and strategy notes.
 * Uses window.Poker and window.BombPot.
 */
(function () {
  'use strict';

  const P = window.Poker;
  const B = window.BombPot;

  const state = {
    b1: [],
    b2: [],
    opponents: 5,
    analysis: null,
    candidates: [], // [{ index, combos, source }]
    sim: null,
    heroText: '',
    token: 0,
  };
  let root = null;

  const pct = (x) => (100 * x).toFixed(1) + '%';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const TRIALS = 2000;

  function cardHTML(c, small) {
    const suit = P.SUITS[P.suitOf(c)];
    const rank = P.RANKS[P.rankOf(c)];
    return '<span class="card suit-' + suit + (small ? ' small' : '') + '" aria-label="' + P.cardToString(c) + '">' +
      '<span class="rank">' + (rank === 'T' ? '10' : rank) + '</span><span class="pip">' + P.SUIT_SYMBOLS[suit] + '</span></span>';
  }
  const emptySlot = '<span class="card empty"></span>';

  function chips(ids) {
    return ids.map((id, i) => '<span class="chip' + (i === 0 ? ' on' : '') + (id === 'backdoor-flush-draw' ? ' minor' : '') +
      '" style="--chip:' + (i === 0 ? '#127a4f' : '#6d9bff') + '">' + P.categoryName(id, 'plo') + '</span>').join('');
  }

  // ---------------------------------------------------------------------------
  // Boards
  // ---------------------------------------------------------------------------

  function renderBoards() {
    for (const [k, board] of [['1', state.b1], ['2', state.b2]]) {
      const slots = [];
      for (let i = 0; i < 5; i++) slots.push(i < board.length ? cardHTML(board[i]) : emptySlot);
      root.querySelector('#bp-board' + k).innerHTML = slots.join('');
      root.querySelector('#bp-text' + k).value = board.map(P.cardToString).join(' ');
      const t = board.length >= 3 ? P.flopTexture(board.slice(0, 3)) : null;
      root.querySelector('#bp-tex' + k).textContent = t ? { monotone: 'Monotone', 'two-tone': 'Two-tone', rainbow: 'Rainbow' }[t.suits] +
        (t.pairing === 'unpaired' ? '' : ', ' + t.pairing) + ' flop' : '';
    }
    const n = state.b1.length;
    root.querySelector('#bp-turn').disabled = n !== 3;
    root.querySelector('#bp-river').disabled = n !== 4;
    root.querySelector('#bp-back').disabled = n <= 3;
    root.querySelector('#bp-street').textContent = n === 0 ? '' : n === 3 ? 'Flops' : n === 4 ? 'Turns' : 'Rivers';
  }

  function setBoards(b1, b2) {
    state.b1 = b1;
    state.b2 = b2;
    renderBoards();
    analyze();
  }

  // ---------------------------------------------------------------------------
  // Strongest hands
  // ---------------------------------------------------------------------------

  function analyze() {
    const token = ++state.token;
    const out = root.querySelector('#bp-best');
    state.sim = null;
    out.innerHTML = '<p class="hint">Rating every possible hand on both boards&hellip;</p>';
    setTimeout(() => {
      if (token !== state.token) return;
      state.analysis = B.analyzeBoards(state.b1, state.b2);
      const r = B.rankHands(state.analysis, 8);
      const seen = new Set();
      state.candidates = [];
      for (const [list, source] of [[r.made, 'Made hand'], [r.draws, 'Draws']]) {
        for (const g of list) {
          if (seen.has(g.index)) continue;
          seen.add(g.index);
          state.candidates.push({ index: g.index, combos: g.combos, source });
        }
      }
      renderBest();
      runSim(token);
      renderHero();
    }, 30);
  }

  function runSim(token) {
    const an = state.analysis;
    const sim = B.createSimulation(state.candidates.map((c) => an.cardsOf(c.index)), state.b1, state.b2, state.opponents, TRIALS);
    const progress = root.querySelector('#bp-progress');
    progress.hidden = false;
    const tick = () => {
      if (token !== state.token) return;
      const done = sim.step(40);
      root.querySelector('#bp-progress span').style.width = (100 * sim.progress()).toFixed(1) + '%';
      if (!done) { setTimeout(tick, 0); return; }
      progress.hidden = true;
      state.sim = sim.results();
      renderBest();
    };
    tick();
  }

  function renderBest() {
    const an = state.analysis;
    const out = root.querySelector('#bp-best');
    let rows = state.candidates.map((c, i) => ({ ...c, sim: state.sim ? state.sim[i] : null }));
    if (state.sim) rows.sort((a, b) => b.sim.equity - a.sim.equity);
    const river = state.b1.length === 5;
    out.innerHTML =
      '<div class="mn-table-wrap"><table class="mn-table bp-table"><thead><tr><th>Hand</th><th>Board 1</th><th>Board 2</th>' +
      '<th class="num">Equity</th><th class="num">Scoop</th><th class="num">Wins B1</th><th class="num">Wins B2</th></tr></thead><tbody>' +
      rows.map((r) => {
        const cats = an.categoriesOf(r.index);
        const s = r.sim;
        const simCell = (v) => '<td class="num">' + (s ? pct(v) : '<span class="muted">&hellip;</span>') + '</td>';
        return '<tr><td><span class="combo-cards">' + an.cardsOf(r.index).map((c) => cardHTML(c, true)).join('') + '</span>' +
          '<span class="bp-sub">' + r.source + (r.combos > 1 ? ' &middot; ' + r.combos + ' combos play the same' : '') + '</span></td>' +
          [0, 1].map((bi) => '<td><div class="bp-cats">' + chips(cats[bi]) + '</div><span class="bp-sub">beats ' + pct(an.pct[bi][r.index]) + ' of hands now</span></td>').join('') +
          '<td class="num"><strong>' + (s ? pct(s.equity) : '<span class="muted">&hellip;</span>') + '</strong></td>' +
          simCell(s && s.scoop) + simCell(s && s.win1) + simCell(s && s.win2) + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint">Candidates are the strongest made hands' + (river ? '' : ' and the best draws') + ' on <em>both</em> boards (the weaker board counts most), out of all ' +
      an.total.toLocaleString() + ' possible hands. Equity is the average share of the pot against ' + state.opponents + ' random opponent' + (state.opponents === 1 ? '' : 's') +
      (river ? '' : ', running out both boards') + ', with each board worth half; ' + TRIALS.toLocaleString() + ' simulated deals per hand (about &plusmn;2%). ' +
      'Scoop means winning both boards outright.</p>';
  }

  // ---------------------------------------------------------------------------
  // Your hand
  // ---------------------------------------------------------------------------

  function renderHero() {
    const out = root.querySelector('#bp-hero-out');
    const text = state.heroText.trim();
    if (!text || !state.analysis) { out.innerHTML = ''; return; }
    let hand;
    try {
      hand = P.parseCardList(text);
      if (hand.length !== 4) throw new Error('Enter exactly 4 cards.');
      const onBoard = hand.filter((c) => state.b1.includes(c) || state.b2.includes(c));
      if (onBoard.length) throw new Error(onBoard.map(P.cardToString).join(', ') + (onBoard.length === 1 ? ' is' : ' are') + ' already on a board.');
    } catch (e) {
      out.innerHTML = '<p class="check-error">' + e.message + '</p>';
      return;
    }
    const cats = [state.b1, state.b2].map((b) => P.classifyOmaha(hand, b, 'plo').categories);
    // Find this hand's rating among all hands.
    const an = state.analysis;
    const sorted = hand.slice().sort((a, b) => b - a);
    const pos = new Map(an.live.map((c, i) => [c, i]));
    const idx = B.comboIndex(sorted.map((c) => pos.get(c)), an.live.length);
    out.innerHTML = '<div class="bp-hero"><span class="combo-cards">' + sorted.map((c) => cardHTML(c, true)).join('') + '</span>' +
      [0, 1].map((bi) => '<div><span class="bp-sub">Board ' + (bi + 1) + ' &middot; beats ' + pct(an.pct[bi][idx]) + ' of hands now</span><div class="bp-cats">' + chips(cats[bi]) + '</div></div>').join('') +
      '</div><p id="bp-hero-eq" class="hint">Simulating against ' + state.opponents + ' opponent' + (state.opponents === 1 ? '' : 's') + '&hellip;</p>';
    const token = state.token;
    const sim = B.createSimulation([sorted], state.b1, state.b2, state.opponents, 6000);
    const tick = () => {
      if (token !== state.token || !root.querySelector('#bp-hero-eq')) return;
      if (!sim.step(40)) { setTimeout(tick, 0); return; }
      const r = sim.results()[0];
      root.querySelector('#bp-hero-eq').innerHTML = '<strong class="bp-eq">' + pct(r.equity) + ' equity</strong> against ' + state.opponents + ' random opponent' + (state.opponents === 1 ? '' : 's') +
        ' &middot; scoop ' + pct(r.scoop) + ' &middot; wins board 1 ' + pct(r.win1) + ' &middot; wins board 2 ' + pct(r.win2) +
        ' <span class="muted">(6,000 simulated deals, about &plusmn;1.3%; a fair share is ' + pct(1 / (state.opponents + 1)) + ')</span>';
    };
    tick();
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  const NOTES = [
    ['How it works', 'Everyone puts in the bomb (say $10 each) and there is no preflop betting: two flops come out at once. Each player plays Omaha (exactly two hole cards and three board cards) on each board, and each board wins half the pot.'],
    ['Scoop or bust', 'Half the pot is often not enough to justify a big bet, so value hands that are strong on both boards, or the nuts on one with a big draw on the other. Winning one board while losing the other only gets your money back if the pot was big already.'],
    ['Many players, nutty hands', 'With five or more players in every pot, second-best hands lose often: a non-nut flush or the low end of a straight is a much weaker hand than it looks. The equity column against several opponents shows this.'],
    ['Low stack-to-pot ratio', 'The bomb makes the pot big relative to stacks (for example $60 in the middle with $200 stacks is an SPR near 3), so decisions to commit come on the flop. Know before you bet whether you can call a shove.'],
    ['Blockers twice over', 'Cards that block the nuts matter on both boards: the ace of a flush suit, or the cards that complete a straight, make your bluffs and calls better on whichever board they apply to.'],
    ['Hands that play two boards', 'Pairs that can make sets on either board, and connected suited hands that can make draws on both, do well. Hands built around one specific card often hit only one board.'],
  ];

  function render(container) {
    const fresh = root !== container || !container.hasChildNodes();
    root = container;
    if (!fresh) return;

    root.innerHTML =
      '<div class="panel-head"><h2>Double-board bomb pot (PLO)</h2><span class="hint">Two boards &middot; four cards each &middot; each board wins half</span></div>' +
      '<p class="dg-rules">Everyone antes the bomb and two flops come out with no preflop betting. Each player plays pot-limit Omaha on both boards; the best hand on each board wins half the pot.</p>' +

      '<div class="bp-felt">' +
        '<div class="bp-row"><span class="bp-label">Board 1<span id="bp-tex1"></span></span><div class="street-cards" id="bp-board1"></div></div>' +
        '<div class="bp-row"><span class="bp-label">Board 2<span id="bp-tex2"></span></span><div class="street-cards" id="bp-board2"></div></div>' +
        '<div class="bp-controls">' +
          '<button type="button" class="primary" id="bp-new">New flops</button>' +
          '<button type="button" id="bp-turn">Deal turns</button>' +
          '<button type="button" id="bp-river">Deal rivers</button>' +
          '<button type="button" class="ghost" id="bp-back">Back to flops</button>' +
          '<span class="bp-street" id="bp-street"></span>' +
        '</div>' +
        '<form class="bp-type" id="bp-form">' +
          '<label>Board 1<input id="bp-text1" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="e.g. Kh 9h 4c"></label>' +
          '<label>Board 2<input id="bp-text2" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="e.g. Js Ts 2d"></label>' +
          '<button type="submit">Set boards</button>' +
        '</form>' +
        '<p class="board-error" id="bp-error" role="alert"></p>' +
      '</div>' +

      '<h3 class="tell-section">Strongest hands on both boards</h3>' +
      '<div class="bp-opts"><label class="mn-field">Opponents<select id="bp-opp">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<option value="' + n + '"' + (n === state.opponents ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></label><button type="button" id="bp-rerun">Re-run simulation</button></div>' +
      '<div class="equity-progress" id="bp-progress" hidden><span></span></div>' +
      '<div id="bp-best"></div>' +

      '<h3 class="tell-section">Your hand</h3>' +
      '<form class="check-hand bp-hero-form" id="bp-hero-form"><div class="input-row"><input id="bp-hero" type="text" value="' + esc(state.heroText) +
        '" placeholder="e.g. Ah Kh Qs Js" autocomplete="off" spellcheck="false" autocapitalize="off"><button type="submit">Check</button></div></form>' +
      '<div id="bp-hero-out"></div>' +

      '<h3 class="tell-section">Strategy notes</h3>' +
      '<dl class="dg-notes">' + NOTES.map(([t, d]) => '<dt>' + t + '</dt><dd>' + d + '</dd>').join('') + '</dl>';

    bind();
    if (state.b1.length) { renderBoards(); analyze(); } else {
      const [b1, b2] = B.dealBoards([], [], 3, 3);
      setBoards(b1, b2);
    }
  }

  function bind() {
    const err = root.querySelector('#bp-error');
    root.querySelector('#bp-new').addEventListener('click', () => {
      err.textContent = '';
      const [b1, b2] = B.dealBoards([], [], 3, 3);
      setBoards(b1, b2);
    });
    root.querySelector('#bp-turn').addEventListener('click', () => {
      const [b1, b2] = B.dealBoards(state.b1, state.b2, 1, 1);
      setBoards(b1, b2);
    });
    root.querySelector('#bp-river').addEventListener('click', () => {
      const [b1, b2] = B.dealBoards(state.b1, state.b2, 1, 1);
      setBoards(b1, b2);
    });
    root.querySelector('#bp-back').addEventListener('click', () => setBoards(state.b1.slice(0, 3), state.b2.slice(0, 3)));
    root.querySelector('#bp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const b1 = P.parseCardList(root.querySelector('#bp-text1').value);
        const b2 = P.parseCardList(root.querySelector('#bp-text2').value);
        if (b1.length !== b2.length) throw new Error('Give both boards the same number of cards (3, 4 or 5).');
        B.checkBoards(b1, b2);
        setBoards(b1, b2);
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    root.querySelector('#bp-opp').addEventListener('change', (e) => {
      state.opponents = +e.target.value;
      if (state.analysis) { state.sim = null; renderBest(); runSim(++state.token); renderHero(); }
    });
    root.querySelector('#bp-rerun').addEventListener('click', () => {
      if (state.analysis) { state.sim = null; renderBest(); runSim(++state.token); }
    });
    root.querySelector('#bp-hero-form').addEventListener('submit', (e) => {
      e.preventDefault();
      state.heroText = root.querySelector('#bp-hero').value;
      renderHero();
    });
  }

  window.BombGame = { render };
})();
