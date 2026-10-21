/*
 * Core poker logic: cards, deck, hand evaluation, and hand classification.
 * No DOM access here, so it runs in the browser (as window.Poker) and in Node (require).
 *
 * A card is an integer 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };

  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const makeCard = (rank, suit) => (rank << 2) | suit;

  function cardToString(c) {
    return RANKS[rankOf(c)] + SUITS[suitOf(c)];
  }

  function parseCard(str) {
    const rank = RANKS.indexOf(str[0].toUpperCase());
    const suit = SUITS.indexOf(str[1].toLowerCase());
    if (rank < 0 || suit < 0) throw new Error('Bad card: ' + str);
    return makeCard(rank, suit);
  }

  const parseCards = (str) => str.trim().split(/\s+/).filter(Boolean).map(parseCard);

  // Draws `n` distinct random cards that are not in `exclude`.
  function drawCards(n, exclude, rng) {
    rng = rng || Math.random;
    const dead = new Set(exclude || []);
    const live = [];
    for (let c = 0; c < 52; c++) if (!dead.has(c)) live.push(c);
    const out = [];
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rng() * (live.length - i));
      [live[i], live[j]] = [live[j], live[i]];
      out.push(live[i]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Hand evaluation
  // ---------------------------------------------------------------------------

  const HAND = {
    HIGH_CARD: 0,
    PAIR: 1,
    TWO_PAIR: 2,
    TRIPS: 3,
    STRAIGHT: 4,
    FLUSH: 5,
    FULL_HOUSE: 6,
    QUADS: 7,
    STRAIGHT_FLUSH: 8,
  };

  // Returns the rank of the top card of the highest straight in a 13-bit rank mask, or -1.
  // A wheel (A-2-3-4-5) returns 3 (the five).
  function straightHigh(mask) {
    const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace-low, bit r+1 = rank r
    for (let hi = 13; hi >= 4; hi--) {
      if (((m >> (hi - 4)) & 0x1f) === 0x1f) return hi - 1;
    }
    return -1;
  }

  function topRanksOfMask(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }

  function scored(category, kickers) {
    let score = category;
    for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] === undefined ? 0 : kickers[i] + 1);
    return { category, kickers, score };
  }

  // Evaluates the best 5-card hand out of 5 to 7 cards.
  // Returns { category, kickers, score } where a higher score is a better hand.
  function evaluate(cards) {
    const counts = new Array(13).fill(0);
    const suitMasks = [0, 0, 0, 0];
    const suitCounts = [0, 0, 0, 0];
    let mask = 0;
    for (const c of cards) {
      const r = rankOf(c);
      const s = suitOf(c);
      counts[r]++;
      suitMasks[s] |= 1 << r;
      suitCounts[s]++;
      mask |= 1 << r;
    }

    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;

    if (flushSuit >= 0) {
      const sf = straightHigh(suitMasks[flushSuit]);
      if (sf >= 0) return scored(HAND.STRAIGHT_FLUSH, [sf]);
    }

    const quads = [];
    const trips = [];
    const pairs = [];
    const singles = [];
    for (let r = 12; r >= 0; r--) {
      if (counts[r] === 4) quads.push(r);
      else if (counts[r] === 3) trips.push(r);
      else if (counts[r] === 2) pairs.push(r);
      else if (counts[r] === 1) singles.push(r);
    }

    if (quads.length) {
      const kicker = Math.max(trips[0] ?? -1, pairs[0] ?? -1, singles[0] ?? -1);
      return scored(HAND.QUADS, kicker >= 0 ? [quads[0], kicker] : [quads[0]]);
    }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      return scored(HAND.FULL_HOUSE, [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]);
    }
    if (flushSuit >= 0) return scored(HAND.FLUSH, topRanksOfMask(suitMasks[flushSuit], 5));

    const st = straightHigh(mask);
    if (st >= 0) return scored(HAND.STRAIGHT, [st]);

    if (trips.length) return scored(HAND.TRIPS, [trips[0], ...singles.slice(0, 2)]);
    if (pairs.length >= 2) {
      const kicker = Math.max(pairs[2] ?? -1, singles[0] ?? -1);
      return scored(HAND.TWO_PAIR, kicker >= 0 ? [pairs[0], pairs[1], kicker] : [pairs[0], pairs[1]]);
    }
    if (pairs.length) return scored(HAND.PAIR, [pairs[0], ...singles.slice(0, 3)]);
    return scored(HAND.HIGH_CARD, singles.slice(0, 5));
  }

  // ---------------------------------------------------------------------------
  // Hand classification relative to the board
  // ---------------------------------------------------------------------------

  // Every hole-card combo gets exactly one "made" category, plus any number of "draw" categories.
  const CATEGORIES = [
    { id: 'straight-flush', name: 'Straight flush', group: 'made', color: '#ff2d95' },
    { id: 'quads', name: 'Quads', group: 'made', color: '#b14cff' },
    { id: 'full-house', name: 'Full house', group: 'made', color: '#7a5cff' },
    { id: 'flush', name: 'Flush', group: 'made', color: '#3d7bff' },
    { id: 'straight', name: 'Straight', group: 'made', color: '#14b8d4' },
    { id: 'set', name: 'Set', group: 'made', color: '#10c48a' },
    { id: 'trips', name: 'Trips', group: 'made', color: '#5fd068' },
    { id: 'two-pair', name: 'Two pair', group: 'made', color: '#b6e03a' },
    { id: 'overpair', name: 'Overpair', group: 'made', color: '#ffd23f' },
    { id: 'top-pair', name: 'Top pair', group: 'made', color: '#ffa53a' },
    { id: 'pp-below-top', name: 'Pocket pair below top card', group: 'made', color: '#ff7a45' },
    { id: 'middle-pair', name: 'Middle pair', group: 'made', color: '#f2545b' },
    { id: 'weak-pair', name: 'Weak pair', group: 'made', color: '#c2416b' },
    { id: 'ace-high', name: 'Ace high', group: 'made', color: '#8d8f99' },
    { id: 'no-made-hand', name: 'No made hand', group: 'made', color: '#55575f' },

    { id: 'combo-draw', name: 'Combo draw (flush + straight draw)', group: 'draw', color: '#ff4fd8' },
    { id: 'flush-draw', name: 'Flush draw', group: 'draw', color: '#4f8dff' },
    { id: 'nut-flush-draw', name: 'Nut flush draw', group: 'draw', color: '#2fd3ff' },
    { id: 'oesd', name: 'Open-ended / double gutshot', group: 'draw', color: '#3ee08f' },
    { id: 'gutshot', name: 'Gutshot', group: 'draw', color: '#c4ec5a' },
    { id: 'overcards', name: 'Two overcards', group: 'draw', color: '#ffb547' },
    { id: 'backdoor-flush-draw', name: 'Backdoor flush draw', group: 'draw', color: '#9aa8ff' },
  ];

  const MADE_FROM_HAND = {
    [HAND.STRAIGHT_FLUSH]: 'straight-flush',
    [HAND.QUADS]: 'quads',
    [HAND.FULL_HOUSE]: 'full-house',
    [HAND.FLUSH]: 'flush',
    [HAND.STRAIGHT]: 'straight',
  };

  // Strong hands use the 7-card evaluation. Below that, pairs are judged only by what the
  // hole cards add: on K-K-7, holding 7-x counts as a middle pair, not "two pair".
  function madeCategory(hole, board, ev) {
    if (MADE_FROM_HAND[ev.category]) return MADE_FROM_HAND[ev.category];

    const boardRanks = [...new Set(board.map(rankOf))].sort((a, b) => b - a);
    const boardTop = boardRanks[0];
    const r1 = Math.max(rankOf(hole[0]), rankOf(hole[1]));
    const r2 = Math.min(rankOf(hole[0]), rankOf(hole[1]));
    const m1 = boardRanks.includes(r1);
    const m2 = boardRanks.includes(r2);

    if (r1 === r2) {
      if (m1) return 'set';
      return r1 > boardTop ? 'overpair' : 'pp-below-top';
    }
    if (ev.category === HAND.TRIPS && (m1 || m2)) return 'trips';
    if (m1 && m2) return 'two-pair';
    if (m1 || m2) {
      const idx = boardRanks.indexOf(m1 ? r1 : r2);
      if (idx === 0) return 'top-pair';
      if (idx === 1) return 'middle-pair';
      return 'weak-pair';
    }
    return r1 === 12 ? 'ace-high' : 'no-made-hand';
  }

  // Draws only exist before the river, and the hole cards must contribute to them.
  function drawCategories(hole, board, ev, made) {
    const draws = [];
    if (board.length >= 5) return draws;

    const cards = hole.concat(board);
    const madeFlush = ev.category === HAND.FLUSH || ev.category === HAND.STRAIGHT_FLUSH;
    let flushDraw = false;

    if (!madeFlush) {
      for (let s = 0; s < 4; s++) {
        const holeInSuit = hole.filter((c) => suitOf(c) === s);
        if (!holeInSuit.length) continue;
        const boardInSuit = board.filter((c) => suitOf(c) === s);
        const total = holeInSuit.length + boardInSuit.length;
        if (total === 4) {
          flushDraw = true;
          draws.push('flush-draw');
          // Nut flush draw: we hold the highest card of the suit that is not on the board.
          let nutRank = 12;
          while (boardInSuit.some((c) => rankOf(c) === nutRank)) nutRank--;
          if (holeInSuit.some((c) => rankOf(c) === nutRank)) draws.push('nut-flush-draw');
        } else if (total === 3 && board.length === 3) {
          draws.push('backdoor-flush-draw');
        }
      }
    }

    let allMask = 0;
    for (const c of cards) allMask |= 1 << rankOf(c);
    let boardMask = 0;
    for (const c of board) boardMask |= 1 << rankOf(c);

    let straightDraw = false;
    if (straightHigh(allMask) < 0) {
      let outRanks = 0;
      for (let r = 0; r < 13; r++) {
        const bit = 1 << r;
        if (allMask & bit) continue;
        if (straightHigh(allMask | bit) >= 0 && straightHigh(boardMask | bit) < 0) outRanks++;
      }
      if (outRanks >= 2) draws.push('oesd');
      else if (outRanks === 1) draws.push('gutshot');
      straightDraw = outRanks > 0;
    }

    if (flushDraw && straightDraw) draws.push('combo-draw');

    if (made === 'ace-high' || made === 'no-made-hand') {
      const boardTop = Math.max(...board.map(rankOf));
      if (Math.min(rankOf(hole[0]), rankOf(hole[1])) > boardTop) draws.push('overcards');
    }

    return draws;
  }

  function classify(hole, board) {
    const ev = evaluate(hole.concat(board));
    const made = madeCategory(hole, board, ev);
    const draws = drawCategories(hole, board, ev, made);
    return { made, draws, categories: [made, ...draws], evaluation: ev };
  }

  // ---------------------------------------------------------------------------
  // Range analysis
  // ---------------------------------------------------------------------------

  // The 13x13 starting-hand grid label for a combo, e.g. "AKs", "T9o", "77".
  function handLabel(c1, c2) {
    const r1 = Math.max(rankOf(c1), rankOf(c2));
    const r2 = Math.min(rankOf(c1), rankOf(c2));
    if (r1 === r2) return RANKS[r1] + RANKS[r2];
    return RANKS[r1] + RANKS[r2] + (suitOf(c1) === suitOf(c2) ? 's' : 'o');
  }

  // Grid position: row/col 0 = ace. Suited hands above the diagonal, offsuit below.
  function gridPosition(c1, c2) {
    const hi = 12 - Math.max(rankOf(c1), rankOf(c2));
    const lo = 12 - Math.min(rankOf(c1), rankOf(c2));
    if (hi === lo || suitOf(c1) === suitOf(c2)) return { row: hi, col: lo };
    return { row: lo, col: hi };
  }

  // Classifies every hole-card combo that doesn't collide with the board.
  function analyzeBoard(board) {
    const dead = new Set(board);
    const combos = [];
    const counts = {};
    for (const cat of CATEGORIES) counts[cat.id] = 0;

    for (let a = 51; a >= 0; a--) {
      if (dead.has(a)) continue;
      for (let b = a - 1; b >= 0; b--) {
        if (dead.has(b)) continue;
        const hole = [a, b];
        const result = classify(hole, board);
        for (const id of result.categories) counts[id]++;
        combos.push({ cards: hole, label: handLabel(a, b), ...gridPosition(a, b), ...result });
      }
    }
    return { combos, counts, total: combos.length };
  }

  const api = {
    RANKS,
    SUITS,
    SUIT_SYMBOLS,
    HAND,
    CATEGORIES,
    rankOf,
    suitOf,
    makeCard,
    cardToString,
    parseCard,
    parseCards,
    drawCards,
    straightHigh,
    evaluate,
    classify,
    handLabel,
    gridPosition,
    analyzeBoard,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Poker = api;
})(typeof self !== 'undefined' ? self : this);
