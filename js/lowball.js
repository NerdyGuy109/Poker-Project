/*
 * 2-7 lowball (Kansas City): five cards, lowest hand wins, aces are high only, and straights and
 * flushes count against you. The best hand is 7-5-4-3-2 of mixed suits.
 *
 * Cards use the same numbering as poker.js: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
 * No DOM access, so it runs in the browser (as window.Lowball) and in Node (require).
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const NOT_LOW = 99;

  // Targets for "X low or better", as rank indexes: 7 = 5, 8 = 6, 9 = 7, T = 8.
  const TARGETS = [
    { id: '7', name: '7 or better', rank: 5 },
    { id: '8', name: '8 or better', rank: 6 },
    { id: '9', name: '9 or better', rank: 7 },
    { id: 'T', name: '10 or better', rank: 8 },
  ];

  // Top card of a 2-7 low, or NOT_LOW for a pair, straight or flush (no wheel: A-2-3-4-5 is ace-high).
  function lowTop(cards) {
    let mask = 0;
    const suit = cards[0] & 3;
    let flush = true;
    for (let i = 0; i < 5; i++) {
      const c = cards[i];
      const bit = 1 << (c >> 2);
      if (mask & bit) return NOT_LOW;
      mask |= bit;
      if ((c & 3) !== suit) flush = false;
    }
    if (flush) return NOT_LOW;
    if (mask / (mask & -mask) === 31) return NOT_LOW; // five consecutive ranks
    return 31 - Math.clz32(mask);
  }

  // Comparable 2-7 value: lower is better. Ranks hands like high poker with aces high and no wheel.
  function value27(cards) {
    const counts = new Array(13).fill(0);
    let mask = 0;
    const suit = cards[0] & 3;
    let flush = true;
    for (const c of cards) {
      counts[c >> 2]++;
      mask |= 1 << (c >> 2);
      if ((c & 3) !== suit) flush = false;
    }
    const straight = counts.every((n) => n <= 1) && mask / (mask & -mask) === 31;
    const groups = [];
    for (let r = 12; r >= 0; r--) if (counts[r]) groups.push([counts[r], r]);
    groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let cat;
    const shape = groups.map((g) => g[0]).join('');
    if (straight && flush) cat = 8;
    else if (shape === '41') cat = 7;
    else if (shape === '32') cat = 6;
    else if (flush) cat = 5;
    else if (straight) cat = 4;
    else if (shape === '311') cat = 3;
    else if (shape === '221') cat = 2;
    else if (shape === '2111') cat = 1;
    else cat = 0;
    // Always five rank slots, so the category decides first whatever the hand's shape.
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 13 + (i < groups.length ? groups[i][1] : 0);
    return v;
  }

  const RANK_WORDS = ['Deuce', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
  const RANK_PLURALS = ['Deuces', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
  const rankText = (r) => (r === 8 ? '10' : RANKS[r]);

  // { valid, top, text: "8-6-5-3-2", name: "8-6 low" } or a description of why it's not a low.
  function describe27(cards) {
    const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
    const text = ranks.map(rankText).join('-');
    const top = lowTop(cards);
    if (top !== NOT_LOW) {
      const name = ranks.join() === '5,3,2,1,0' ? 'Number one (the nuts)'
        : rankText(ranks[0]) + '-' + rankText(ranks[1]) + ' low';
      return { valid: true, top, text, name };
    }
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.entries(counts).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const flush = cards.every((c) => (c & 3) === (cards[0] & 3));
    let name;
    if (groups[0][0] === 4) name = 'Four ' + RANK_PLURALS[groups[0][1]].toLowerCase();
    else if (groups[0][0] === 3 && groups[1][0] === 2) name = 'Full house';
    else if (groups[0][0] === 3) name = 'Three ' + RANK_PLURALS[groups[0][1]].toLowerCase();
    else if (groups[0][0] === 2 && groups[1][0] === 2) name = 'Two pair';
    else if (groups[0][0] === 2) name = 'Pair of ' + RANK_PLURALS[groups[0][1]].toLowerCase();
    else if (flush) name = 'Flush';
    else name = 'Straight';
    if (flush && groups.length === 5 && name === 'Straight') name = 'Straight flush';
    return { valid: false, top: NOT_LOW, text, name: name + ' (counts against you)' };
  }

  // Which cards to keep (by index) when drawing toward `targetRank`: one card per rank at or below
  // the target. If that keeps all five yet misses (a straight or flush), break the highest card.
  function policyKeep(hand, targetRank) {
    const seen = new Set();
    const keep = [];
    const order = [0, 1, 2, 3, 4].sort((a, b) => (hand[a] >> 2) - (hand[b] >> 2));
    for (const i of order) {
      const r = hand[i] >> 2;
      if (r <= targetRank && !seen.has(r)) {
        seen.add(r);
        keep.push(i);
      }
    }
    if (keep.length === 5) keep.pop(); // sorted low to high, so this drops the highest card
    return keep;
  }

  // Small seeded generator. Giving every option the same seed means they all face the same shuffles,
  // so differences between options come from the choice, not from luck.
  function seededRandom(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

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

  // Exact chances of finishing at or under each target after ONE draw.
  // kept: cards kept; deck: cards that can be drawn. Returns { '7': p, '8': p, '9': p, 'T': p }.
  function singleDrawOdds(kept, deck) {
    const need = 5 - kept.length;
    const out = Object.fromEntries(TARGETS.map((t) => [t.id, 0]));
    // Keeping a pair, or a card above 10, can never reach any target.
    const keptRanks = new Set(kept.map((c) => c >> 2));
    if (keptRanks.size !== kept.length || kept.some((c) => (c >> 2) > 8)) return out;
    const tops = new Array(14).fill(0);
    let total = 0;
    const hand = kept.slice();
    combinationsOf(deck.length, need, (idx) => {
      for (let i = 0; i < need; i++) hand[kept.length + i] = deck[idx[i]];
      const t = lowTop(hand);
      tops[t === NOT_LOW ? 13 : t]++;
      total++;
    });
    for (const t of TARGETS) {
      let n = 0;
      for (let r = 0; r <= t.rank; r++) n += tops[r];
      out[t.id] = n / total;
    }
    return out;
  }

  // Simulated chance of finishing at or under target over `draws` draws, starting by keeping `kept`
  // for the first draw, then following policyKeep (stand pat once the target is made).
  function multiDrawOdds(kept, deck, draws, targetRank, trials, rng) {
    rng = rng || Math.random;
    const d = deck.slice();
    const hand = new Array(5);
    let wins = 0;
    for (let t = 0; t < trials; t++) {
      let pos = 0;
      const deal = () => {
        const j = pos + Math.floor(rng() * (d.length - pos));
        const c = d[j];
        d[j] = d[pos];
        d[pos] = c;
        pos++;
        return c;
      };
      for (let i = 0; i < kept.length; i++) hand[i] = kept[i];
      for (let i = kept.length; i < 5; i++) hand[i] = deal();
      for (let draw = 1; draw < draws; draw++) {
        if (lowTop(hand) <= targetRank) break;
        const keep = policyKeep(hand, targetRank);
        const next = keep.map((i) => hand[i]);
        for (let i = 0; i < 5; i++) hand[i] = i < next.length ? next[i] : deal();
      }
      if (lowTop(hand) <= targetRank) wins++;
    }
    return wins / trials;
  }

  // Every way to play a dealt hand: all 32 keep/discard choices with their chances.
  // draws = 1 gives exact results; more draws are simulated with `trials` runs per choice and target.
  function analyzeHand(hand, draws, trials) {
    const dead = new Set(hand);
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
    const options = [];
    for (let mask = 0; mask < 32; mask++) {
      const kept = hand.filter((_, i) => mask & (1 << i));
      const discards = hand.filter((_, i) => !(mask & (1 << i)));
      let probs;
      if (draws === 1) {
        probs = kept.length === 5 ? Object.fromEntries(TARGETS.map((t) => [t.id, lowTop(hand) <= t.rank ? 1 : 0])) : singleDrawOdds(kept, deck);
      } else {
        probs = {};
        for (const t of TARGETS) probs[t.id] = multiDrawOdds(kept, deck, draws, t.rank, trials || 4000, seededRandom(2727));
      }
      options.push({ mask, kept, discards, draw: discards.length, probs });
    }
    return options;
  }

  // Cards for a starting-draw chart entry: the given ranks in mixed suits (never a flush).
  function sampleCards(ranks) {
    return ranks.map((r, i) => (r << 2) | (i % 4));
  }

  const api = {
    RANKS,
    NOT_LOW,
    TARGETS,
    lowTop,
    value27,
    describe27,
    policyKeep,
    singleDrawOdds,
    multiDrawOdds,
    analyzeHand,
    sampleCards,
    seededRandom,
    rankText,
    RANK_WORDS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lowball = api;
})(typeof self !== 'undefined' ? self : this);
