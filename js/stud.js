/*
 * Seven-card stud games: stud (high), stud 8 (high-low split, 8 or better) and razz (A-5 low).
 * Each player ends with seven cards and plays the best five. Needs poker.js for the high evaluator.
 * No DOM access, so it runs in the browser (as window.Stud) and in Node (require).
 */
(function (root) {
  'use strict';

  const P = typeof module !== 'undefined' && module.exports ? require('./poker.js') : root.Poker;

  const GAMES = {
    stud: { id: 'stud', name: 'Seven-card stud', short: 'Stud', high: true, low: null },
    stud8: { id: 'stud8', name: 'Stud hi-lo (8 or better)', short: 'Stud 8', high: true, low: 'eight' },
    razz: { id: 'razz', name: 'Razz', short: 'Razz', high: false, low: 'razz' },
  };

  const HIGH_UNIT = Math.pow(15, 5); // scoreCards() packs the category above five 15-based kicker slots
  const highCategory = (score) => Math.floor(score / HIGH_UNIT);

  // Ace-low rank value: A = 0, 2 = 1, ... K = 12.
  const lowRank = (c) => ((c >> 2) + 1) % 13;
  const LOW_NAMES = 'A23456789TJQK';

  // ---------------------------------------------------------------------------
  // Razz: best A-5 low from up to seven cards. Lower value is better.
  // Straights and flushes don't count; pairs do (a paired hand loses to any unpaired one).
  // ---------------------------------------------------------------------------

  const razzCounts = new Uint8Array(13);

  function value5Low(ranks) {
    const counts = new Array(13).fill(0);
    for (const r of ranks) counts[r]++;
    const groups = [];
    for (let r = 12; r >= 0; r--) if (counts[r]) groups.push([counts[r], r]);
    groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const shape = groups.map((g) => g[0]).join('');
    const cat = { 11111: 0, 2111: 1, 221: 2, 311: 3, 32: 4, 41: 5 }[shape];
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 13 + (i < groups.length ? groups[i][1] : 0);
    return v;
  }

  const RAZZ_UNIT = Math.pow(13, 5);

  function razzValue(cards, n) {
    n = n || cards.length;
    razzCounts.fill(0);
    let distinct = 0;
    for (let i = 0; i < n; i++) {
      const r = lowRank(cards[i]);
      if (!razzCounts[r]++) distinct++;
    }
    if (distinct >= 5) {
      // Fast path: the five lowest different ranks.
      const picked = [];
      for (let r = 0; r < 13 && picked.length < 5; r++) if (razzCounts[r]) picked.push(r);
      let v = 0;
      for (let i = 4; i >= 0; i--) v = v * 13 + picked[i];
      return v;
    }
    // Fewer than five different ranks: try every five-card subset.
    const ranks = [];
    for (let i = 0; i < n; i++) ranks.push(lowRank(cards[i]));
    let best = Infinity;
    const pick = (start, acc) => {
      if (acc.length === 5) { best = Math.min(best, value5Low(acc)); return; }
      for (let i = start; i < ranks.length; i++) { acc.push(ranks[i]); pick(i + 1, acc); acc.pop(); }
    };
    pick(0, []);
    return best;
  }

  // Top card of an unpaired razz low (0 = ace ... 12 = king), or -1 if the best hand is paired.
  const razzTop = (value) => (value < RAZZ_UNIT ? Math.floor(value / Math.pow(13, 4)) : -1);

  function describeRazz(value) {
    if (value >= RAZZ_UNIT) return 'Paired';
    const ranks = [];
    let v = value;
    for (let i = 0; i < 5; i++) { ranks.unshift(v % 13); v = Math.floor(v / 13); }
    return ranks.map((r) => (r === 9 ? '10' : LOW_NAMES[r])).join('-');
  }

  // ---------------------------------------------------------------------------
  // Stud 8 low: five different cards 8 or lower (aces low), as a bitmask where a smaller number is
  // a better low (bit 1 = ace ... bit 8 = eight). Infinity when there's no qualifying low.
  // ---------------------------------------------------------------------------

  function eightLow(cards, n) {
    n = n || cards.length;
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const v = lowRank(cards[i]) + 1; // ace = 1 ... king = 13
      if (v <= 8) mask |= 1 << v;
    }
    let low = 0;
    let count = 0;
    for (let v = 1; v <= 8 && count < 5; v++) {
      if (mask & (1 << v)) { low |= 1 << v; count++; }
    }
    return count === 5 ? low : Infinity;
  }

  const lowMaskTop = (mask) => 31 - Math.clz32(mask); // 5 = five-low (wheel), 8 = eight-low

  // ---------------------------------------------------------------------------
  // Hand analysis: exact odds of how a hand finishes by seventh street
  // ---------------------------------------------------------------------------

  function combinationsOf(n, k, visit) {
    if (k === 0) { visit([]); return; }
    const idx = Array.from({ length: k }, (_, i) => i);
    for (;;) {
      visit(idx);
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) return;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  function checkCards(known, dead) {
    const all = known.concat(dead);
    if (new Set(all).size !== all.length) throw new Error('The same card is used twice.');
    if (known.length < 1 || known.length > 7) throw new Error('Enter between 1 and 7 of your cards.');
  }

  // Returns { runouts, high: [p of each category or better] (stud/stud8),
  //           low: { '5'..'10': p of that low or better, qualify } (razz/stud8) }.
  function analyzeHand(known, dead, gameId) {
    const game = GAMES[gameId];
    checkCards(known, dead);
    const used = new Set(known.concat(dead));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    const need = 7 - known.length;
    if (deck.length < need) throw new Error('Not enough cards left in the deck.');

    const highCounts = new Array(9).fill(0);
    const lowTops = new Array(14).fill(0); // by top card, 13 = no low / paired
    let runouts = 0;
    const hand = known.concat(new Array(need).fill(0));
    combinationsOf(deck.length, need, (idx) => {
      for (let i = 0; i < need; i++) hand[known.length + i] = deck[idx[i]];
      if (game.high) highCounts[highCategory(P.scoreCards(hand, 7))]++;
      if (game.low === 'razz') {
        const t = razzTop(razzValue(hand, 7));
        lowTops[t < 0 ? 13 : t]++;
      } else if (game.low === 'eight') {
        const m = eightLow(hand, 7);
        lowTops[m === Infinity ? 13 : lowMaskTop(m) - 1]++;
      }
      runouts++;
    });

    const out = { runouts };
    if (game.high) {
      // "Category or better": add up from the top.
      out.high = new Array(9).fill(0);
      let acc = 0;
      for (let cat = 8; cat >= 0; cat--) { acc += highCounts[cat]; out.high[cat] = acc / runouts; }
    }
    if (game.low) {
      // Top card indexes: 4 = five-high ... 9 = ten-high.
      out.low = {};
      let acc = 0;
      for (let t = 0; t <= 12; t++) {
        acc += lowTops[t];
        if (t >= 4 && t <= 9) out.low[LOW_NAMES[t] === 'T' ? '10' : LOW_NAMES[t]] = acc / runouts;
      }
      out.low.qualify = game.low === 'eight' ? out.low['8'] : 1 - lowTops[13] / runouts;
    }
    return out;
  }

  // What kind of start three cards are (the first two are the hole cards, the third the door card).
  function describeStart(cards, gameId) {
    if (cards.length !== 3) return '';
    const ranks = cards.map((c) => c >> 2);
    const suited = cards.every((c) => (c & 3) === (cards[0] & 3));
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const pairRank = +Object.keys(counts).find((r) => counts[r] >= 2);
    const RANK_PLURALS = ['deuces', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];
    const name = (r) => (r === 8 ? '10' : P.RANKS[r]);
    if (gameId === 'razz' || gameId === 'stud8') {
      const lows = cards.map(lowRank);
      const unpaired = new Set(lows).size === 3;
      const sorted = lows.slice().sort((a, b) => b - a).map((r) => (r === 9 ? '10' : LOW_NAMES[r])).join('-');
      if (gameId === 'razz') {
        if (!unpaired) return 'Paired start (' + sorted + '): weak in razz';
        const top = Math.max(...lows);
        return (top <= 4 ? 'Three to a wheel' : 'Three to ' + (top === 7 ? 'an ' : 'a ') + (top === 9 ? '10' : LOW_NAMES[top])) + ' (' + sorted + ')';
      }
      const lowCount = lows.filter((r) => r <= 7).length;
      if (counts[pairRank] === 3) return 'Rolled-up ' + RANK_PLURALS[pairRank] + ' (high only)';
      if (unpaired && lowCount === 3) return 'Three low cards (' + sorted + ')' + (suited ? ', suited' : '') + ': a two-way start';
      if (counts[pairRank] === 2) return 'Pair of ' + RANK_PLURALS[pairRank] + (lowCount >= 2 ? ' with low cards' : '') + ' (' + sorted + ')';
      return lowCount + ' low card' + (lowCount === 1 ? '' : 's') + ' (' + sorted + ')' + (suited ? ', suited' : '');
    }
    if (counts[pairRank] === 3) return 'Rolled-up ' + RANK_PLURALS[pairRank];
    if (counts[pairRank] === 2) {
      const split = ranks[2] === pairRank;
      return (split ? 'Split' : 'Buried') + ' pair of ' + RANK_PLURALS[pairRank] + (split ? ' (one shows)' : ' (hidden)');
    }
    const highs = ranks.map((r) => [r, r === 12 ? -1 : r]); // aces also play low in straights
    const span = (vals) => Math.max(...vals) - Math.min(...vals);
    const straighty = span(ranks) <= 4 || span(highs.map((h) => h[1])) <= 4;
    const sorted = ranks.slice().sort((a, b) => b - a).map(name).join('-');
    if (suited && straighty) return 'Three to a straight flush (' + sorted + ')';
    if (suited) return 'Three to a flush (' + sorted + ')';
    if (straighty) return 'Three to a straight (' + sorted + ')';
    return 'No pair, no draw (' + sorted + ')';
  }

  // ---------------------------------------------------------------------------
  // Equity: players with any known cards (each ends with seven), plus dead cards
  // ---------------------------------------------------------------------------

  const EXACT_DEALS = 1500000;
  const TRIAL_LIMIT = 150000;
  const TIME_LIMIT_MS = 2500;

  function multinomialDeals(deckSize, needs) {
    let total = 1;
    let left = deckSize;
    for (const k of needs) {
      let c = 1;
      for (let i = 1; i <= k; i++) c = c * (left - k + i) / i;
      total *= Math.round(c);
      left -= k;
    }
    return total;
  }

  function createEquityJob(players, dead, gameId) {
    const game = GAMES[gameId];
    if (players.length < 2) throw new Error('Equity needs at least two players.');
    const known = [].concat(...players, dead);
    if (new Set(known).size !== known.length) throw new Error('The same card is used twice.');
    players.forEach((p, i) => { if (p.length > 7) throw new Error('Player ' + (i + 1) + ' has more than seven cards.'); });
    const knownSet = new Set(known);
    const deck = [];
    for (let c = 0; c < 52; c++) if (!knownSet.has(c)) deck.push(c);
    const needs = players.map((p) => 7 - p.length);
    const totalNeed = needs.reduce((a, b) => a + b, 0);
    if (totalNeed > deck.length) throw new Error('Not enough cards left for everyone to get seven.');

    const totalDeals = multinomialDeals(deck.length, needs);
    const exact = totalDeals <= EXACT_DEALS;
    const n = players.length;
    const hands = players.map((p) => p.concat(new Array(7 - p.length).fill(0)));
    const stats = players.map(() => ({ share: 0, win: 0, tie: 0, high: 0, low: 0 }));
    const hi = new Float64Array(n);
    const lo = new Float64Array(n);
    let done = 0;
    let started = 0;
    let finished = false;

    function settle() {
      for (let p = 0; p < n; p++) {
        hi[p] = game.high ? P.scoreCards(hands[p], 7) : -razzValue(hands[p], 7); // razz: higher = better
        lo[p] = game.low === 'eight' ? eightLow(hands[p], 7) : Infinity;
      }
      let bestHi = -Infinity;
      let hiCount = 0;
      let bestLo = Infinity;
      let loCount = 0;
      for (let p = 0; p < n; p++) {
        if (hi[p] > bestHi) { bestHi = hi[p]; hiCount = 1; } else if (hi[p] === bestHi) hiCount++;
        if (lo[p] < bestLo) { bestLo = lo[p]; loCount = 1; } else if (lo[p] === bestLo && lo[p] !== Infinity) loCount++;
      }
      const lowPot = bestLo !== Infinity ? 0.5 : 0;
      const highPot = 1 - lowPot;
      for (let p = 0; p < n; p++) {
        let share = 0;
        if (hi[p] === bestHi) { share += highPot / hiCount; stats[p].high++; }
        if (lowPot && lo[p] === bestLo) { share += lowPot / loCount; stats[p].low++; }
        stats[p].share += share;
        if (share > 0.999999) stats[p].win++;
        else if (share > 0) stats[p].tie++;
      }
      done++;
    }

    // Exact: every way to hand out the missing cards, player by player.
    function* exactDeals(seat, pool) {
      if (seat === n) { yield; return; }
      const k = needs[seat];
      if (k === 0) { yield* exactDeals(seat + 1, pool); return; }
      const idx = Array.from({ length: k }, (_, i) => i);
      for (;;) {
        const taken = new Set();
        for (let i = 0; i < k; i++) {
          hands[seat][players[seat].length + i] = pool[idx[i]];
          taken.add(idx[i]);
        }
        yield* exactDeals(seat + 1, pool.filter((_, j) => !taken.has(j)));
        let i = k - 1;
        while (i >= 0 && idx[i] === pool.length - k + i) i--;
        if (i < 0) return;
        idx[i]++;
        for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
      }
    }
    const gen = exact ? exactDeals(0, deck) : null;

    function randomDeal() {
      let pos = 0;
      for (let p = 0; p < n; p++) {
        for (let i = 0; i < needs[p]; i++) {
          const j = pos + Math.floor(Math.random() * (deck.length - pos));
          const c = deck[j];
          deck[j] = deck[pos];
          deck[pos] = c;
          pos++;
          hands[p][players[p].length + i] = c;
        }
      }
      settle();
    }

    function step(ms) {
      if (finished) return true;
      if (!started) started = Date.now();
      const until = Date.now() + ms;
      while (Date.now() < until) {
        for (let i = 0; i < 200; i++) {
          if (exact) {
            if (gen.next().done) { finished = true; return true; }
            settle();
          } else {
            randomDeal();
            if (done >= TRIAL_LIMIT) { finished = true; return true; }
          }
        }
        if (!exact && Date.now() - started > TIME_LIMIT_MS) { finished = true; return true; }
      }
      return false;
    }

    function results() {
      return {
        exact,
        hiLo: game.low === 'eight',
        runouts: done,
        progress: Math.min(1, exact ? done / totalDeals : Math.max(done / TRIAL_LIMIT, started ? (Date.now() - started) / TIME_LIMIT_MS : 0)),
        players: stats.map((s) => ({
          equity: done ? s.share / done : 0,
          win: done ? s.win / done : 0,
          tie: done ? s.tie / done : 0,
          high: done ? s.high / done : 0,
          low: done ? s.low / done : 0,
          error: exact || !done ? 0 : Math.sqrt(Math.max(s.share / done * (1 - s.share / done), 1e-9) / done),
        })),
      };
    }

    return {
      exact,
      totalDeals: exact ? totalDeals : null,
      step,
      results,
      run() {
        while (!step(1000));
        return results();
      },
    };
  }

  const api = {
    GAMES,
    highCategory,
    razzValue,
    razzTop,
    describeRazz,
    eightLow,
    lowMaskTop,
    analyzeHand,
    describeStart,
    createEquityJob,
    LOW_NAMES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stud = api;
})(typeof self !== 'undefined' ? self : this);
