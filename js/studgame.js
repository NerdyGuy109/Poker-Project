/*
 * The stud view (stud, stud 8, razz): hand odds by seventh street, equity, a starting-hand chart
 * and strategy notes. Uses window.Poker, window.Stud and window.StudCharts.
 */
(function () {
  'use strict';

  const P = window.Poker;
  const S = window.Stud;

  const state = {
    game: null,
    handText: '',
    deadText: '',
    players: ['', ''],
    eqDead: '',
    sort: null,
    token: 0,
  };
  let root = null;

  const HIGH_NAMES = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];
  const COLORS = ['#3d7bff', '#ff7a45', '#10c48a', '#b14cff', '#e0b100', '#ff2d95'];
  const pct = (x) => (100 * x).toFixed(1) + '%';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const game = () => S.GAMES[state.game];

  function cardHTML(c, small) {
    const suit = P.SUITS[P.suitOf(c)];
    const rank = P.RANKS[P.rankOf(c)];
    return '<span class="card suit-' + suit + (small ? ' small' : '') + '" aria-label="' + P.cardToString(c) + '">' +
      '<span class="rank">' + (rank === 'T' ? '10' : rank) + '</span><span class="pip">' + P.SUIT_SYMBOLS[suit] + '</span></span>';
  }

  const parseCards = (text) => (text.trim() ? P.parseCardList(text) : []);

  // ---------------------------------------------------------------------------
  // Your hand
  // ---------------------------------------------------------------------------

  function analyzeYourHand() {
    const out = root.querySelector('#sg-odds');
    const err = root.querySelector('#sg-error');
    err.textContent = '';
    let cards;
    let dead;
    try {
      cards = parseCards(state.handText);
      dead = parseCards(state.deadText);
      if (cards.length < 3 || cards.length > 7) throw new Error('Enter your cards: 3 on third street, up to 7 on seventh.');
    } catch (e) {
      err.textContent = e.message;
      out.innerHTML = '';
      return;
    }
    out.innerHTML = '<p class="hint">Counting every way the hand can finish&hellip;</p>';
    setTimeout(() => {
      let a;
      try {
        a = S.analyzeHand(cards, dead, state.game);
      } catch (e) {
        err.textContent = e.message;
        out.innerHTML = '';
        return;
      }
      const start = cards.length === 3 ? S.describeStart(cards, state.game) : '';
      const rows = [];
      if (a.low) {
        const keys = state.game === 'razz' ? ['5', '6', '7', '8', '9', '10'] : ['5', '6', '7', '8'];
        rows.push('<tr class="sg-group"><td colspan="2">' + (state.game === 'razz' ? 'Low by seventh street' : 'Low (8 or better) by seventh street') + '</td></tr>');
        for (const k of keys) rows.push(oddsRow(k === '5' ? '5-low (A-2-3-4-5)' : k + '-low or better', a.low[k]));
      }
      if (a.high) {
        rows.push('<tr class="sg-group"><td colspan="2">High hand by seventh street</td></tr>');
        for (let cat = 2; cat <= 8; cat++) rows.push(oddsRow(HIGH_NAMES[cat] + ' or better', a.high[cat]));
      }
      out.innerHTML =
        '<div class="dg-cards">' + cards.map((c, i) => '<span class="sg-card' + (i < 2 || i === 6 ? ' down' : '') + '">' + cardHTML(c) +
          '<span class="dg-card-tag">' + (i < 2 || i === 6 ? 'Down' : 'Up') + '</span></span>').join('') + '</div>' +
        (start ? '<p class="dg-desc"><strong>' + start + '</strong></p>' : '') +
        '<div class="mn-table-wrap"><table class="mn-table sg-odds"><tbody>' + rows.join('') + '</tbody></table></div>' +
        '<p class="hint">Exact: every one of the ' + a.runouts.toLocaleString() + ' ways the remaining ' + (7 - cards.length) + ' card' + (7 - cards.length === 1 ? '' : 's') +
        ' can come, with your cards' + (dead.length ? ' and the ' + dead.length + ' dead card' + (dead.length === 1 ? '' : 's') : '') + ' removed. ' +
        'Opponents’ unseen cards are treated as unknown.</p>';
    }, 20);
  }

  function oddsRow(label, p) {
    return '<tr><td>' + label + '</td><td class="num"><strong>' + pct(p) + '</strong></td><td class="dg-bar-cell"><span class="dg-bar" style="width:' + (100 * p).toFixed(1) + '%"></span></td></tr>';
  }

  // ---------------------------------------------------------------------------
  // Equity
  // ---------------------------------------------------------------------------

  function renderPlayers() {
    root.querySelector('#sg-players').innerHTML = state.players.map((text, i) =>
      '<div class="eq-row" style="--player:' + COLORS[i] + '">' +
        '<label class="eq-label" for="sg-p' + i + '"><span class="eq-dot"></span>Player ' + (i + 1) + '</label>' +
        '<div class="eq-inputs"><input id="sg-p' + i + '" data-sg-player="' + i + '" type="text" value="' + esc(text) + '" placeholder="Known cards, e.g. As Kd 9c" autocomplete="off" spellcheck="false" autocapitalize="off">' +
        '<button type="button" class="ghost eq-remove" data-sg-remove="' + i + '" aria-label="Remove player ' + (i + 1) + '"' + (state.players.length <= 2 ? ' disabled' : '') + '>&times;</button></div>' +
        '<div class="eq-result" id="sg-r' + i + '"></div></div>').join('');
    root.querySelector('#sg-add').disabled = state.players.length >= 6;
  }

  function runEquity() {
    const token = ++state.token;
    const status = root.querySelector('#sg-status');
    let players;
    let dead;
    try {
      players = state.players.map((t, i) => {
        try { return parseCards(t); } catch (e) { throw new Error('Player ' + (i + 1) + ': ' + e.message); }
      });
      dead = parseCards(state.eqDead);
    } catch (e) {
      status.textContent = e.message;
      return;
    }
    let job;
    try {
      job = S.createEquityJob(players, dead, state.game);
    } catch (e) {
      status.textContent = e.message;
      return;
    }
    status.textContent = job.exact ? 'Checking all ' + job.totalDeals.toLocaleString() + ' ways to deal the missing cards…' : 'Simulating random deals…';
    const tick = () => {
      if (token !== state.token) return;
      const finished = job.step(40);
      const r = job.results();
      r.players.forEach((p, i) => {
        const el = root.querySelector('#sg-r' + i);
        if (!el) return;
        const details = r.hiLo
          ? 'Scoop ' + pct(p.win) + ' &middot; Wins high ' + pct(p.high) + ' &middot; Wins low ' + pct(p.low)
          : 'Win ' + pct(p.win) + ' &middot; Tie ' + pct(p.tie);
        el.className = 'eq-result';
        el.innerHTML = '<div class="eq-bar"><span style="width:' + (100 * p.equity).toFixed(2) + '%"></span></div>' +
          '<div class="eq-numbers"><strong>' + (100 * p.equity).toFixed(2) + '%</strong> <span class="muted">equity</span><span class="eq-details">' + details + '</span></div>';
      });
      if (!finished) { setTimeout(tick, 0); return; }
      if (r.exact) status.textContent = 'Exact: checked every one of ' + r.runouts.toLocaleString() + ' deals.';
      else {
        const margin = 1.96 * Math.max(...r.players.map((p) => p.error));
        status.textContent = 'Simulated ' + r.runouts.toLocaleString() + ' random deals; results are within about ±' + (100 * margin).toFixed(1) + '%.';
      }
    };
    tick();
  }

  // ---------------------------------------------------------------------------
  // Starting hands
  // ---------------------------------------------------------------------------

  function renderChart() {
    const el = root.querySelector('#sg-chart');
    const data = window.StudCharts;
    if (state.game === 'stud') {
      const cols = [[2, 'Two pair+'], [3, 'Trips+'], [4, 'Straight+'], [5, 'Flush+'], [6, 'Full house+']];
      el.innerHTML = '<div class="mn-table-wrap"><table class="mn-table"><thead><tr><th>Start</th><th>Example</th>' +
        cols.map(([, n]) => '<th class="num">' + n + '</th>').join('') + '</tr></thead><tbody>' +
        data.studStarts.map((s) => '<tr><td><strong>' + s.kind + '</strong></td><td><span class="combo-cards">' +
          P.parseCards(s.hand).map((c) => cardHTML(c, true)).join('') + '</span></td>' +
          cols.map(([cat]) => '<td class="num">' + pct(s.high[cat]) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div><p class="hint">Chance of finishing with at least each hand by seventh street, exact, assuming none of your cards are dead. ' +
        'Pairs of any rank improve at the same rate; what changes is how good the finished hand is.</p>';
      return;
    }
    const razz = state.game === 'razz';
    const cols = razz ? [['5', '5-low'], ['6', '6 or better'], ['7', '7 or better'], ['8', '8 or better'], ['9', '9 or better'], ['10', '10 or better']]
      : [['low6', '6-low+'], ['low7', '7-low+'], ['low8', 'Low (8+)'], ['twoPair', 'Two pair+ (high)'], ['straight', 'Straight+ (high)']];
    const sortKey = state.sort && cols.some((c) => c[0] === state.sort) ? state.sort : (razz ? '8' : 'low8');
    const get = (e, k) => (razz ? e.razz[k] : e.stud8[k]);
    const ties = [sortKey].concat(cols.map((c) => c[0]).filter((k) => k !== sortKey));
    // Final tie-break: lower cards first, comparing from the top card down.
    const LOWS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const rankList = (e) => e.start.split('-').map((r) => LOWS.indexOf(r));
    const list = data.lowStarts.slice().sort((a, b) => {
      for (const k of ties) { const d = get(b, k) - get(a, k); if (Math.abs(d) > 1e-9) return d; }
      const ra = rankList(a);
      const rb = rankList(b);
      for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    });
    const shown = state.chartAll ? list : list.slice(0, 20);
    el.innerHTML = '<div class="mn-table-wrap"><table class="mn-table dg-table"><thead><tr><th>Start</th>' +
      cols.map(([k, n]) => '<th class="num"><button type="button" class="link' + (k === sortKey ? ' active' : '') + '" data-sg-sort="' + k + '">' + n + '</button></th>').join('') +
      '</tr></thead><tbody>' + shown.map((e) => '<tr><td><strong>' + e.start + '</strong></td>' +
        cols.map(([k]) => '<td class="num' + (k === sortKey ? ' sorted' : '') + '">' + pct(get(e, k)) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' +
      '<p class="hint">Every unpaired three-card start from ace to ten, exact by seventh street, mixed suits, no dead cards. ' +
        'The chance of reaching a target only depends on how many of your cards are at or below it, so many starts tie; ties go to the stricter columns, then to lower cards. Click a column to sort.</p>' +
      '<button type="button" class="link" id="sg-chart-all">' + (state.chartAll ? 'Show top 20' : 'Show all ' + list.length) + '</button>';
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  const NOTES = {
    common: [
      ['The deal', 'Two cards down and one up (third street), then one up on each of fourth, fifth and sixth street, and the last card down (seventh street). There are no community cards; you play your best five of seven.'],
      ['Live cards', 'Everyone’s up cards are information. If the cards you need are showing in other hands (or were folded), your hand is less live and worth less; enter them as dead cards to see the effect.'],
      ['Read the boards', 'Opponents’ up cards limit what they can have. Ask what their visible cards make likely, and what they would have to hold underneath.'],
      ['Usually fixed-limit', 'Stud games are normally played fixed-limit with an ante and a forced bring-in, so starting-hand selection and position on later streets (determined by the up cards) matter most.'],
    ],
    stud: [
      ['Starting hands', 'Rolled-up trips are the best start; big pairs (especially hidden ones) are next. Three to a flush or straight needs live cards and should usually be played cheaply.'],
      ['Pair rank matters', 'Any pair makes two pair or better about 61% of the time, but a pair of kings beats a pair of fives when both improve, so big pairs play far better.'],
      ['Kickers and door cards', 'A big kicker gives you bigger two pair. A high door card lets you represent a big pair when stealing the antes.'],
      ['Bring-in', 'The lowest up card brings it in on third street; the highest showing hand acts first on later streets.'],
    ],
    razz: [
      ['How hands rank', 'Lowest hand wins, aces are low and straights and flushes don’t count. A-2-3-4-5 is the best hand; compare from the highest card down.'],
      ['Starting hands', 'Three different cards 8 or lower are the minimum; aces and wheel cards (A to 5) are best. Any three different low cards make an 8-low about 48% of the time; lower cards make better lows.'],
      ['Door cards and steals', 'The highest up card brings it in. A low door card facing high door cards is a strong stealing position; a high door card looks weak and gets attacked.'],
      ['Pairing and bricks', 'Catching a pair or a high card on fourth street hurts badly. Compare boards street by street: the player with the better visible low usually has the betting lead.'],
    ],
    stud8: [
      ['Split pot', 'The best high hand and the best low (five different cards 8 or lower, aces low) split the pot; with no qualifying low the high takes it all. Scooping both halves is the goal.'],
      ['Two-way starts', 'Three low cards, especially with an ace and suited or connected (A-2-3 suited), can win both ways. The ace is the key card: best for low and best for high.'],
      ['High-only hands', 'Big pairs are worth less than in stud because they rarely scoop; they need to improve or face only high hands. Middle cards (9 to K) are often trap cards.'],
      ['Counterfeit risk', 'Making a low early doesn’t guarantee winning the low half; pairing your low cards or a better low showing elsewhere can leave you with half or nothing.'],
    ],
  };

  function notesHTML(list) {
    return '<dl class="dg-notes">' + list.map(([t, d]) => '<dt>' + t + '</dt><dd>' + d + '</dd>').join('') + '</dl>';
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  const RULES = {
    stud: 'The best five-card high hand from seven cards wins.',
    razz: 'The lowest five-card hand wins: aces are low, and straights and flushes don’t count. The best hand is A-2-3-4-5.',
    stud8: 'The pot splits between the best high hand and the best low (five different cards 8 or lower, aces low). With no qualifying low, the high hand scoops.',
  };

  function render(container, gameId) {
    const changed = root !== container || state.game !== gameId;
    root = container;
    state.game = gameId;
    if (!changed && root.hasChildNodes()) return;
    state.sort = null;
    state.chartAll = false;
    state.token++;

    root.innerHTML =
      '<div class="panel-head"><h2>' + game().name + '</h2><span class="hint">Seven cards each: three down, four up</span></div>' +
      '<p class="dg-rules">' + RULES[gameId] + '</p>' +

      '<h3 class="tell-section">Your hand</h3>' +
      '<p class="hint">Enter your cards in the order dealt (two down, then up cards). Add any dead cards you’ve seen (folded or in other players’ hands) to make the odds reflect what’s left.</p>' +
      '<form class="sg-form" id="sg-form">' +
        '<label class="mn-field">Your cards<input id="sg-hand" type="text" value="' + esc(state.handText) + '" placeholder="e.g. As 2d 3c" autocomplete="off" spellcheck="false" autocapitalize="off"></label>' +
        '<label class="mn-field">Dead cards<input id="sg-dead" type="text" value="' + esc(state.deadText) + '" placeholder="optional, e.g. 4h 4s 8c" autocomplete="off" spellcheck="false" autocapitalize="off"></label>' +
        '<button type="submit">Analyze</button><button type="button" class="primary" id="sg-random">Random start</button>' +
      '</form>' +
      '<p class="board-error dg-error" id="sg-error" role="alert"></p>' +
      '<div id="sg-odds"></div>' +

      '<h3 class="tell-section">Equity</h3>' +
      '<p class="hint">Enter whatever you know of each hand (your cards, their up cards). Missing cards are dealt from what’s left, so everyone ends with seven.</p>' +
      '<div class="equity-players" id="sg-players"></div>' +
      '<div class="sg-dead-row"><label class="mn-field">Dead cards<input id="sg-eqdead" type="text" value="' + esc(state.eqDead) + '" placeholder="optional" autocomplete="off" spellcheck="false" autocapitalize="off"></label></div>' +
      '<div class="equity-actions"><button type="button" class="ghost" id="sg-add">+ Add player</button><button type="button" class="primary" id="sg-run">Calculate</button></div>' +
      '<p class="equity-status" id="sg-status"></p>' +

      '<h3 class="tell-section">Starting hands</h3>' +
      '<div id="sg-chart"></div>' +

      '<h3 class="tell-section">Strategy notes</h3>' +
      notesHTML(NOTES.common) +
      '<h4 class="dg-notes-head">' + game().name + '</h4>' + notesHTML(NOTES[gameId]);

    renderPlayers();
    renderChart();
    bind();
    if (state.handText) analyzeYourHand();
  }

  function bind() {
    root.querySelector('#sg-form').addEventListener('submit', (e) => {
      e.preventDefault();
      state.handText = root.querySelector('#sg-hand').value;
      state.deadText = root.querySelector('#sg-dead').value;
      analyzeYourHand();
    });
    root.querySelector('#sg-random').addEventListener('click', () => {
      let dead = [];
      try { dead = parseCards(root.querySelector('#sg-dead').value); } catch (e) { /* ignore */ }
      const cards = P.drawCards(3, dead);
      state.handText = cards.map(P.cardToString).join(' ');
      state.deadText = root.querySelector('#sg-dead').value;
      root.querySelector('#sg-hand').value = state.handText;
      analyzeYourHand();
    });
    root.querySelector('#sg-add').addEventListener('click', () => {
      if (state.players.length >= 6) return;
      state.players.push('');
      renderPlayers();
    });
    root.querySelector('#sg-run').addEventListener('click', runEquity);
    root.querySelector('#sg-eqdead').addEventListener('input', (e) => { state.eqDead = e.target.value; });
    const players = root.querySelector('#sg-players');
    players.addEventListener('input', (e) => {
      if (e.target.dataset.sgPlayer !== undefined) state.players[+e.target.dataset.sgPlayer] = e.target.value;
    });
    players.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.sgPlayer !== undefined) runEquity();
    });
    players.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sg-remove]');
      if (!b || b.disabled) return;
      state.players.splice(+b.dataset.sgRemove, 1);
      renderPlayers();
    });
    root.querySelector('#sg-chart').addEventListener('click', (e) => {
      const s = e.target.closest('[data-sg-sort]');
      if (s) { state.sort = s.dataset.sgSort; renderChart(); return; }
      if (e.target.id === 'sg-chart-all') { state.chartAll = !state.chartAll; renderChart(); }
    });
  }

  window.StudGame = { render };
})();
