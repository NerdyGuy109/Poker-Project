/*
 * Double-board bomb pots (PLO): everyone gets four cards, there are two boards, and each board's
 * best Omaha high hand wins half the pot. Needs poker.js.
 * No DOM access, so it runs in the browser (as window.BombPot) and in Node (require).
 */
(function (root) {
  'use strict';

  const P = typeof module !== 'undefined' && module.exports ? require('./poker.js') : root.Poker;

  function binomial(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return Math.round(r);
  }

  function combinations(items, k) {
    const out = [];
    const pick = (start, acc) => {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (let i = start; i < items.length; i++) { acc.push(items[i]); pick(i + 1, acc); acc.pop(); }
    };
    pick(0, []);
    return out;
  }

  // Two boards from one deck: deals `n` new cards to each board (flop = 3, then 1 and 1).
  function dealBoards(b1, b2, n1, n2) {
    const used = b1.concat(b2);
    const add = P.drawCards(n1 + n2, used);
    return [b1.concat(add.slice(0, n1)), b2.concat(add.slice(n1))];
  }

  function checkBoards(b1, b2) {
    const all = b1.concat(b2);
    if (new Set(all).size !== all.length) throw new Error('The two boards share a card.');
    for (const b of [b1, b2]) if (b.length < 3 || b.length > 5) throw new Error('Each board needs 3 to 5 cards.');
  }

  // Best Omaha high score for every pair of hole cards on one board (index hi * 52 + lo).
  function pairBest(board, live) {
    const triples = combinations(board, 3);
    const best = new Float64Array(2704);
    const five = new Array(5);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const hi = live[i];
        const lo = live[j];
        five[0] = hi;
        five[1] = lo;
        let b = -1;
        for (const t of triples) {
          five[2] = t[0]; five[3] = t[1]; five[4] = t[2];
          const s = P.scoreCards(five, 5);
          if (s > b) b = s;
        }
        best[hi * 52 + lo] = b;
      }
    }
    return best;
  }

  // Lexicographic index of a hand (positions ascending) among k-subsets of n cards, matching the
  // enumeration order poker.js uses in analyzeOmaha.
  function comboIndex(pos, n) {
    const k = pos.length;
    let r = 0;
    let prev = -1;
    for (let i = 0; i < k; i++) {
      for (let x = prev + 1; x < pos[i]; x++) r += binomial(n - x - 1, k - i - 1);
      prev = pos[i];
    }
    return r;
  }

  const DRAW_POINTS = { 'nut-flush-draw': 3, 'flush-draw': 2, wrap: 3, oesd: 2, gutshot: 1 };

  // How strong every possible 4-card hand is on both boards.
  // Returns { total, hands (Uint8Array, 4 per hand), pct: [Float32Array, Float32Array] (share of hands
  //   each one beats on that board, ties count half), draws: [Uint8Array, Uint8Array], analyses, live }.
  function analyzeBoards(b1, b2) {
    checkBoards(b1, b2);
    const dead = new Set(b1.concat(b2));
    const live = [];
    for (let c = 51; c >= 0; c--) if (!dead.has(c)) live.push(c);
    const n = live.length;
    const total = binomial(n, 4);
    const boards = [b1, b2];
    const best = boards.map((b) => pairBest(b, live));
    // Per-board categories and draws from the single-board PLO analysis.
    const analyses = boards.map((b) => P.analyzeBoard(b, 'plo'));
    const ownLive = boards.map((b) => {
      const d = new Set(b);
      const l = [];
      for (let c = 51; c >= 0; c--) if (!d.has(c)) l.push(c);
      return l;
    });
    const posIn = ownLive.map((l) => {
      const m = new Int16Array(52).fill(-1);
      l.forEach((c, i) => { m[c] = i; });
      return m;
    });
    const drawWeights = analyses.map((a) => a.flagIds.map((id) => DRAW_POINTS[id] || 0));
    const flushBits = analyses.map((a) => ['nut-flush-draw', 'flush-draw'].map((id) => a.flagIds.indexOf(id)));
    const straightBits = analyses.map((a) => ['wrap', 'oesd', 'gutshot'].map((id) => a.flagIds.indexOf(id)));

    const hands = new Uint8Array(total * 4);
    const scores = [new Float64Array(total), new Float64Array(total)];
    const draws = [new Uint8Array(total), new Uint8Array(total)];
    const madeIdx = [new Uint8Array(total), new Uint8Array(total)];
    const flags = [new Uint16Array(total), new Uint16Array(total)];
    const PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    const cards = [0, 0, 0, 0];
    let k = 0;
    for (let a = 0; a < n; a++) {
      cards[0] = live[a];
      for (let b = a + 1; b < n; b++) {
        cards[1] = live[b];
        for (let c = b + 1; c < n; c++) {
          cards[2] = live[c];
          for (let d = c + 1; d < n; d++) {
            cards[3] = live[d];
            hands.set(cards, k * 4);
            for (let bi = 0; bi < 2; bi++) {
              let s = -1;
              for (const [x, y] of PAIRS) {
                const v = best[bi][cards[x] * 52 + cards[y]];
                if (v > s) s = v;
              }
              scores[bi][k] = s;
              const an = analyses[bi];
              const idx = comboIndex(cards.map((cc) => posIn[bi][cc]), ownLive[bi].length);
              madeIdx[bi][k] = an.made[idx];
              const f = an.flags[idx];
              flags[bi][k] = f;
              // Draw points: the best flush draw plus the best straight draw on this board.
              let fp = 0;
              let sp = 0;
              for (const bit of flushBits[bi]) if (bit >= 0 && (f & (1 << bit))) fp = Math.max(fp, drawWeights[bi][bit]);
              for (const bit of straightBits[bi]) if (bit >= 0 && (f & (1 << bit))) sp = Math.max(sp, drawWeights[bi][bit]);
              draws[bi][k] = fp + sp;
            }
            k++;
          }
        }
      }
    }

    // Percentile: share of hands this one beats on the board, counting ties as half.
    const pct = scores.map((s) => {
      const sorted = Float64Array.from(s).sort();
      const out = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        let lo = 0;
        let hi = total;
        while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < s[i]) lo = m + 1; else hi = m; }
        const below = lo;
        lo = below; hi = total;
        while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= s[i]) lo = m + 1; else hi = m; }
        out[i] = (below + (lo - below - 1) / 2) / (total - 1);
      }
      return out;
    });

    const categoriesOf = (i) => [0, 1].map((bi) => {
      const an = analyses[bi];
      return [an.madeIds[madeIdx[bi][i]]].concat(an.flagIds.filter((id, b) => flags[bi][i] & (1 << b)));
    });

    return { total, hands, pct, draws, scores, categoriesOf, cardsOf: (i) => Array.from(hands.subarray(i * 4, i * 4 + 4)), live, boards };
  }

  // The strongest hands on both boards: by made hand (the weaker board decides) and by draws.
  // Hands that play the same on both boards (same best hand and the same real draws; backdoor
  // flush draws ignored) are grouped: each group is { index (a representative hand), combos }.
  function rankHands(an, count) {
    const idx = Array.from({ length: an.total }, (_, i) => i);
    const madeKey = (i) => Math.min(an.pct[0][i], an.pct[1][i]);
    const groupTop = (order) => {
      const groups = [];
      const seen = new Map();
      for (const i of order) {
        const key = an.categoriesOf(i).map((x) => x.filter((id) => id !== 'backdoor-flush-draw').join('+')).join('|') + '|' +
          an.scores[0][i] + '|' + an.scores[1][i];
        if (seen.has(key)) { seen.get(key).combos++; continue; }
        if (groups.length >= count) continue; // still count combos of groups already listed
        const g = { index: i, combos: 1 };
        seen.set(key, g);
        groups.push(g);
      }
      return groups;
    };
    const made = groupTop(idx.slice().sort((a, b) => madeKey(b) - madeKey(a) || (an.pct[0][b] + an.pct[1][b]) - (an.pct[0][a] + an.pct[1][a])));
    const drawKey = (i) => Math.min(an.draws[0][i], an.draws[1][i]);
    const anyDraws = idx.some((i) => an.draws[0][i] || an.draws[1][i]);
    const draws = anyDraws ? groupTop(idx.slice().sort((a, b) => drawKey(b) - drawKey(a) ||
      (an.draws[0][b] + an.draws[1][b]) - (an.draws[0][a] + an.draws[1][a]) || madeKey(b) - madeKey(a))) : [];
    return { made, draws };
  }

  // Simulated equity of each candidate hand against `opponents` random hands, finishing both boards.
  // Each board's best hand wins half the pot. Call step(ms) until it returns true.
  function createSimulation(candidates, b1, b2, opponents, trials, rng) {
    checkBoards(b1, b2);
    rng = rng || Math.random;
    const need1 = 5 - b1.length;
    const need2 = 5 - b2.length;
    const players = opponents + 1;
    if (10 + players * 4 > 52) throw new Error('Too many players for one deck with two boards.');
    const results = candidates.map(() => ({ share: 0, scoop: 0, win1: 0, win2: 0, n: 0 }));
    const five = new Array(5);
    const pairsOf = (h) => [[h[0], h[1]], [h[0], h[2]], [h[0], h[3]], [h[1], h[2]], [h[1], h[3]], [h[2], h[3]]];
    const TRIPLE_IDX = combinations([0, 1, 2, 3, 4], 3);

    function bestOn(pairs, board) {
      let best = -1;
      for (const [x, y] of pairs) {
        five[0] = x; five[1] = y;
        for (const t of TRIPLE_IDX) {
          five[2] = board[t[0]]; five[3] = board[t[1]]; five[4] = board[t[2]];
          const s = P.scoreCards(five, 5);
          if (s > best) best = s;
        }
      }
      return best;
    }

    let ci = 0;
    let t = 0;
    let deck = null;
    const startCandidate = () => {
      const used = new Set(b1.concat(b2, candidates[ci]));
      deck = [];
      for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    };
    if (candidates.length) startCandidate();

    function trial() {
      let pos = 0;
      const take = () => {
        const j = pos + Math.floor(rng() * (deck.length - pos));
        const c = deck[j];
        deck[j] = deck[pos];
        deck[pos] = c;
        pos++;
        return c;
      };
      const hands = [candidates[ci]];
      for (let o = 0; o < opponents; o++) hands.push([take(), take(), take(), take()]);
      const full1 = b1.slice();
      const full2 = b2.slice();
      for (let i = 0; i < need1; i++) full1.push(take());
      for (let i = 0; i < need2; i++) full2.push(take());
      let share = 0;
      let won = 0;
      for (const [board, key] of [[full1, 'win1'], [full2, 'win2']]) {
        let best = -1;
        let count = 0;
        let mine = 0;
        for (let p = 0; p < players; p++) {
          const s = bestOn(pairsOf(hands[p]), board);
          if (p === 0) mine = s;
          if (s > best) { best = s; count = 1; } else if (s === best) count++;
        }
        if (mine === best) {
          share += 0.5 / count;
          results[ci][key]++;
          if (count === 1) won++;
        }
      }
      results[ci].share += share;
      if (won === 2) results[ci].scoop++;
      results[ci].n++;
    }

    function step(ms) {
      const until = Date.now() + ms;
      while (ci < candidates.length && Date.now() < until) {
        for (let i = 0; i < 50 && t < trials; i++, t++) trial();
        if (t >= trials) {
          ci++;
          t = 0;
          if (ci < candidates.length) startCandidate();
        }
      }
      return ci >= candidates.length;
    }

    const summary = () => results.map((r) => ({
      equity: r.n ? r.share / r.n : 0,
      scoop: r.n ? r.scoop / r.n : 0,
      win1: r.n ? r.win1 / r.n : 0,
      win2: r.n ? r.win2 / r.n : 0,
      trials: r.n,
      error: r.n ? 1.96 * Math.sqrt(0.25 / r.n) : 0, // conservative 95% margin for a share in 0..1
    }));

    return {
      step,
      results: summary,
      progress: () => (candidates.length ? (ci + t / trials) / candidates.length : 1),
      run() { while (!step(1000)); return summary(); },
    };
  }

  const api = { dealBoards, checkBoards, analyzeBoards, rankHands, createSimulation, comboIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BombPot = api;
})(typeof self !== 'undefined' ? self : this);
