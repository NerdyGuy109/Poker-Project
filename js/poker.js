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

  // Parses a board typed by a person: "As Kd 7c", "AsKd7c", "10h 9h 2c", "A♠ K♦ 7♣" all work.
  // Throws an Error with a readable message if the text isn't 3-5 distinct cards.
  function parseBoard(text) {
    const cards = parseCardList(text);
    if (cards.length < 3 || cards.length > 5) throw new Error('Enter 3 to 5 cards (flop, plus an optional turn and river).');
    return cards;
  }

  // Parses any number of typed cards (same formats as parseBoard), rejecting junk and duplicates.
  function parseCardList(text) {
    const symbols = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
    const normalized = text.replace(/[♠♥♦♣]/g, (m) => symbols[m]).replace(/10/g, 'T');
    const tokens = normalized.match(/[2-9tjqka][shdc]/gi) || [];
    const leftover = normalized.replace(/[2-9tjqka][shdc]/gi, '').replace(/[\s,]+/g, '');
    if (leftover) throw new Error('Couldn’t read "' + leftover + '". Use cards like As, Kd, 7c or 10h.');
    const cards = tokens.map(parseCard);
    if (new Set(cards).size !== cards.length) throw new Error('The same card appears twice.');
    return cards;
  }

  // ---------------------------------------------------------------------------
  // Flop textures
  // ---------------------------------------------------------------------------

  // suits: 'monotone' | 'two-tone' | 'rainbow'; pairing: 'unpaired' | 'paired' | 'trips'
  function flopTexture(flop) {
    const suitCount = new Set(flop.map(suitOf)).size;
    const rankCount = new Set(flop.map(rankOf)).size;
    return {
      suits: suitCount === 1 ? 'monotone' : suitCount === 2 ? 'two-tone' : 'rainbow',
      pairing: rankCount === 3 ? 'unpaired' : rankCount === 2 ? 'paired' : 'trips',
    };
  }

  // Cards of the same rank always have different suits, so some combinations can't exist.
  function textureIsPossible(suits, pairing) {
    suits = suits || 'any';
    pairing = pairing || 'any';
    if (suits === 'monotone') return pairing === 'any' || pairing === 'unpaired';
    if (suits === 'two-tone') return pairing !== 'trips';
    return true;
  }

  // Deals a random flop matching { suits, pairing } (either may be 'any' or omitted).
  // Returns null if the texture is impossible.
  function drawFlop(texture, exclude, rng) {
    const suits = (texture && texture.suits) || 'any';
    const pairing = (texture && texture.pairing) || 'any';
    if (!textureIsPossible(suits, pairing)) return null;
    // Rejection sampling: even the rarest texture (trips, ~0.2%) takes a few hundred draws at most.
    for (let i = 0; i < 100000; i++) {
      const flop = drawCards(3, exclude, rng);
      const t = flopTexture(flop);
      if ((suits === 'any' || t.suits === suits) && (pairing === 'any' || t.pairing === pairing)) return flop;
    }
    return null;
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
    { id: 'wrap', name: 'Wrap (9+ straight outs)', group: 'draw', color: '#19e6c1' },

    { id: 'nut-low', name: 'Nut low', group: 'low', color: '#e85dff' },
    { id: 'any-low', name: 'Any made low', group: 'low', color: '#a78bfa' },
    { id: 'low-draw', name: 'Low draw', group: 'low', color: '#f5a3c7' },
  ];

  const MADE_IDS = CATEGORIES.filter((c) => c.group === 'made').map((c) => c.id);

  const GAMES = {
    nlhe: {
      id: 'nlhe',
      name: 'No-limit hold’em',
      short: 'NLHE',
      holeCards: 2,
      categoryIds: MADE_IDS.concat(['combo-draw', 'flush-draw', 'nut-flush-draw', 'oesd', 'gutshot', 'overcards', 'backdoor-flush-draw']),
      names: {},
    },
    plo: {
      id: 'plo',
      name: 'Pot-limit Omaha',
      short: 'PLO',
      holeCards: 4,
      categoryIds: MADE_IDS.concat(['combo-draw', 'flush-draw', 'nut-flush-draw', 'wrap', 'oesd', 'gutshot', 'backdoor-flush-draw']),
      names: { oesd: 'Open-ended (5–8 straight outs)', gutshot: 'Gutshot (1–4 straight outs)' },
    },
    plo8: {
      id: 'plo8',
      name: 'Pot-limit Omaha hi-lo (8 or better)',
      short: 'PLO8',
      holeCards: 4,
      hiLo: true,
      categoryIds: MADE_IDS.concat(['combo-draw', 'flush-draw', 'nut-flush-draw', 'wrap', 'oesd', 'gutshot', 'backdoor-flush-draw', 'nut-low', 'any-low', 'low-draw']),
      names: { oesd: 'Open-ended (5–8 straight outs)', gutshot: 'Gutshot (1–4 straight outs)' },
    },
    plo5: {
      id: 'plo5',
      name: '5-card PLO',
      short: 'PLO5',
      holeCards: 5,
      categoryIds: MADE_IDS.concat(['combo-draw', 'flush-draw', 'nut-flush-draw', 'wrap', 'oesd', 'gutshot', 'backdoor-flush-draw']),
      names: { oesd: 'Open-ended (5\u20138 straight outs)', gutshot: 'Gutshot (1\u20134 straight outs)' },
    },
    bigo: {
      id: 'bigo',
      name: 'Big O (5-card PLO hi-lo)',
      short: 'Big O',
      holeCards: 5,
      hiLo: true,
      categoryIds: MADE_IDS.concat(['combo-draw', 'flush-draw', 'nut-flush-draw', 'wrap', 'oesd', 'gutshot', 'backdoor-flush-draw', 'nut-low', 'any-low', 'low-draw']),
      names: { oesd: 'Open-ended (5\u20138 straight outs)', gutshot: 'Gutshot (1\u20134 straight outs)' },
    },
    // Draw games have no board, so none of the board analysis applies; js/lowball.js handles them.
    '27sd': { id: '27sd', name: '2-7 single draw', short: '2-7 SD', holeCards: 5, draw: 1, categoryIds: [], names: {} },
    '27td': { id: '27td', name: '2-7 triple draw', short: '2-7 TD', holeCards: 5, draw: 3, categoryIds: [], names: {} },
    // Stud games: seven cards each and no board; js/stud.js handles them.
    stud: { id: 'stud', name: 'Seven-card stud', short: 'Stud', holeCards: 7, stud: true, categoryIds: [], names: {} },
    stud8: { id: 'stud8', name: 'Stud hi-lo (8 or better)', short: 'Stud 8', holeCards: 7, stud: true, categoryIds: [], names: {} },
    razz: { id: 'razz', name: 'Razz', short: 'Razz', holeCards: 7, stud: true, categoryIds: [], names: {} },
  };

  function categoryName(id, gameId) {
    const game = GAMES[gameId || 'nlhe'];
    return game.names[id] || CATEGORIES.find((c) => c.id === id).name;
  }

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

  // Classifies every starting hand that doesn't collide with the board, for the given game.
  function analyzeBoard(board, gameId) {
    if (gameId && gameId !== 'nlhe') return analyzeOmaha(board, gameId);
    return analyzeHoldem(board);
  }

  function analyzeHoldem(board) {
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
    return { game: 'nlhe', combos, counts, total: combos.length };
  }

  // ---------------------------------------------------------------------------
  // Omaha (PLO and PLO8)
  //
  // An Omaha hand must use exactly two hole cards and three board cards. Every 4-card hand
  // holds six 2-card pairs, so we work out once per board what each pair can do with three
  // board cards (best high hand, straight outs, low), then combine the six pairs of each hand.
  // ---------------------------------------------------------------------------

  const NO_LOW = 0x7fffffff;

  // Low value of a rank for 8-or-better (ace = 1), or 0 if the rank is too high.
  const lowValueOfRank = (r) => (r === 12 ? 1 : r <= 6 ? r + 2 : 0);

  // Five ranks -> a comparable low value (smaller is better), or NO_LOW if they don't qualify.
  function lowValue(ranks) {
    const vals = ranks.map(lowValueOfRank);
    if (vals.includes(0) || new Set(vals).size !== 5) return NO_LOW;
    vals.sort((a, b) => b - a);
    return vals.reduce((acc, v) => acc * 9 + v, 0);
  }

  function lowToString(value) {
    if (value === NO_LOW) return 'No low';
    const vals = [];
    for (let i = 0; i < 5; i++) {
      vals.unshift(value % 9);
      value = Math.floor(value / 9);
    }
    return vals.map((v) => (v === 1 ? 'A' : String(v))).join('-') + ' low';
  }

  function combinations(items, k) {
    const out = [];
    const pick = (start, acc) => {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (let i = start; i < items.length; i++) {
        acc.push(items[i]);
        pick(i + 1, acc);
        acc.pop();
      }
    };
    pick(0, []);
    return out;
  }

  function maskOfRanks(ranks) {
    let m = 0;
    for (const r of ranks) m |= 1 << r;
    return m;
  }

  // Per-pair data, indexed by hi * 52 + lo for two cards hi > lo.
  function buildPairTable(board, pairs) {
    const madeIndex = Object.fromEntries(MADE_IDS.map((id, i) => [id, i]));
    const triples = combinations(board, 3);
    const boardRanks = board.map(rankOf);
    const drawsPossible = board.length < 5;
    // Board rank triples once one more card of rank r arrives (for straight and low outs).
    const nextTriples = [];
    if (drawsPossible) {
      for (let r = 0; r < 13; r++) nextTriples.push(combinations(boardRanks.concat([r]), 3));
    }

    const table = {
      made: new Uint8Array(2704),
      straightOuts: new Uint16Array(2704),
      low: new Int32Array(2704),
      lowOuts: new Uint16Array(2704),
    };

    for (const [hi, lo] of pairs) {
      const idx = hi * 52 + lo;
      const hole = [hi, lo];
      let best = null;
      let low = NO_LOW;
      for (const t of triples) {
        const ev = evaluate(hole.concat(t));
        if (!best || ev.score > best.score) best = ev;
        const lv = lowValue([rankOf(hi), rankOf(lo)].concat(t.map(rankOf)));
        if (lv < low) low = lv;
      }
      table.made[idx] = madeIndex[madeCategory(hole, board, best)];
      table.low[idx] = low;

      if (drawsPossible) {
        const r1 = rankOf(hi);
        const r2 = rankOf(lo);
        let straightOuts = 0;
        let lowOuts = 0;
        for (let r = 0; r < 13; r++) {
          for (const t of nextTriples[r]) {
            const ranks = [r1, r2, t[0], t[1], t[2]];
            const m = maskOfRanks(ranks);
            // Five different ranks are needed for a straight.
            if (!(straightOuts & (1 << r)) && popcount(m) === 5 && straightHigh(m) >= 0) straightOuts |= 1 << r;
            if (!(lowOuts & (1 << r)) && lowValue(ranks) !== NO_LOW) lowOuts |= 1 << r;
          }
        }
        table.straightOuts[idx] = straightOuts;
        table.lowOuts[idx] = lowOuts;
      }
    }
    return table;
  }

  function popcount(m) {
    let n = 0;
    while (m) { m &= m - 1; n++; }
    return n;
  }

  // Shared per-board facts for combining pairs into hands.
  function omahaContext(board, gameId) {
    const game = GAMES[gameId];
    const flagIds = game.categoryIds.filter((id) => !MADE_IDS.includes(id));
    const bit = Object.fromEntries(flagIds.map((id, i) => [id, 1 << i]));
    const boardSuit = [0, 0, 0, 0];
    const boardRankCount = new Array(13).fill(0);
    for (const c of board) {
      boardSuit[suitOf(c)]++;
      boardRankCount[rankOf(c)]++;
    }
    // Highest card of each suit that isn't on the board (holding it means a nut flush draw).
    const nutRank = [0, 1, 2, 3].map((s) => {
      let r = 12;
      while (board.some((c) => suitOf(c) === s && rankOf(c) === r)) r--;
      return r;
    });
    return {
      game,
      flagIds,
      bit,
      boardSuit,
      boardRankCount,
      nutRank,
      street: board.length,
      flushIdx: MADE_IDS.indexOf('flush'),
      straightIdx: MADE_IDS.indexOf('straight'),
      nutLow: game.hiLo ? nutLowOf(board) : NO_LOW,
    };
  }

  // The best low any two live hole cards can make with this board.
  function nutLowOf(board) {
    const dead = new Set(board);
    const triples = combinations(board.map(rankOf), 3);
    let best = NO_LOW;
    for (let a = 12; a >= 0; a--) {
      for (let b = a - 1; b >= 0; b--) {
        // Only ranks matter; check that some card of each rank is still live.
        const live = (r) => [0, 1, 2, 3].some((s) => !dead.has(makeCard(r, s)));
        if (!live(a) || !live(b)) continue;
        for (const t of triples) {
          const lv = lowValue([a, b].concat(t));
          if (lv < best) best = lv;
        }
      }
    }
    return best;
  }

  function binomial(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return Math.round(r);
  }

  // Walks every k-card hand from `live` (sorted high to low) in lexicographic order and calls
  // onHand(made, flags) for each. Pair results are folded in as each card is added, so the
  // innermost level only looks up the new card's pairs.
  function enumerateOmaha(live, k, table, ctx, onHand) {
    const n = live.length;
    const bit = ctx.bit;
    const cards = new Array(k);
    const aggMade = new Uint8Array(k + 1);
    const aggLow = new Int32Array(k + 1);
    const aggStraight = new Uint16Array(k + 1);
    const aggLowOuts = new Uint16Array(k + 1);
    const handSuit = new Uint8Array(4);
    const handRankCount = new Uint8Array(13);
    const inHand = new Uint8Array(52);
    aggMade[0] = 255;
    aggLow[0] = NO_LOW;

    function finish(made, low, straightOuts, lowOuts) {
      let flags = 0;
      if (ctx.street < 5) {
        let flushDraw = false;
        for (let s = 0; s < 4; s++) {
          if (handSuit[s] < 2) continue;
          if (ctx.boardSuit[s] === 2) {
            flushDraw = true;
            flags |= bit['flush-draw'];
            if (inHand[makeCard(ctx.nutRank[s], s)]) flags |= bit['nut-flush-draw'];
          } else if (ctx.boardSuit[s] === 1 && ctx.street === 3) {
            flags |= bit['backdoor-flush-draw'];
          }
        }

        let straightDraw = false;
        if (made > ctx.straightIdx && straightOuts) {
          let outs = 0;
          for (let r = 0; r < 13; r++) {
            if (straightOuts & (1 << r)) outs += 4 - ctx.boardRankCount[r] - handRankCount[r];
          }
          if (outs >= 9) flags |= bit.wrap;
          else if (outs >= 5) flags |= bit.oesd;
          else if (outs >= 1) flags |= bit.gutshot;
          straightDraw = outs > 0;
        }
        if (flushDraw && straightDraw) flags |= bit['combo-draw'];

        if (ctx.game.hiLo && low === NO_LOW && lowOuts) flags |= bit['low-draw'];
      }
      if (ctx.game.hiLo && low !== NO_LOW) {
        flags |= bit['any-low'];
        if (low === ctx.nutLow) flags |= bit['nut-low'];
      }
      onHand(made, flags, low);
    }

    function walk(start, depth) {
      const last = n - (k - depth);
      for (let i = start; i <= last; i++) {
        const c = live[i];
        cards[depth] = c;
        let made = aggMade[depth];
        let low = aggLow[depth];
        let straightOuts = aggStraight[depth];
        let lowOuts = aggLowOuts[depth];
        for (let j = 0; j < depth; j++) {
          const idx = cards[j] * 52 + c; // cards[j] > c because live is sorted high to low
          if (table.made[idx] < made) made = table.made[idx];
          if (table.low[idx] < low) low = table.low[idx];
          straightOuts |= table.straightOuts[idx];
          lowOuts |= table.lowOuts[idx];
        }
        handSuit[suitOf(c)]++;
        handRankCount[rankOf(c)]++;
        inHand[c] = 1;
        if (depth + 1 === k) {
          finish(made, low, straightOuts, lowOuts);
        } else {
          aggMade[depth + 1] = made;
          aggLow[depth + 1] = low;
          aggStraight[depth + 1] = straightOuts;
          aggLowOuts[depth + 1] = lowOuts;
          walk(i + 1, depth + 1);
        }
        handSuit[suitOf(c)]--;
        handRankCount[rankOf(c)]--;
        inHand[c] = 0;
      }
    }
    walk(0, 0);
  }

  function analyzeOmaha(board, gameId) {
    const ctx = omahaContext(board, gameId);
    const k = ctx.game.holeCards;
    const dead = new Set(board);
    const live = [];
    for (let c = 51; c >= 0; c--) if (!dead.has(c)) live.push(c);

    const pairs = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) pairs.push([live[i], live[j]]);
    const table = buildPairTable(board, pairs);

    const n = live.length;
    const total = binomial(n, k);
    // Hands aren't stored (5-card Omaha has ~1.9 million); hand i is rebuilt from its index.
    const made = new Uint8Array(total);
    const flags = new Uint16Array(total);
    const madeCounts = new Array(MADE_IDS.length).fill(0);
    const flagCounts = new Array(ctx.flagIds.length).fill(0);

    let idx = 0;
    enumerateOmaha(live, k, table, ctx, (m, f) => {
      made[idx] = m;
      flags[idx] = f;
      madeCounts[m]++;
      for (let b = 0; f; f >>>= 1, b++) if (f & 1) flagCounts[b]++;
      idx++;
    });

    const counts = {};
    for (const cat of CATEGORIES) counts[cat.id] = 0;
    MADE_IDS.forEach((id, i) => { counts[id] = madeCounts[i]; });
    ctx.flagIds.forEach((id, i) => { counts[id] = flagCounts[i]; });

    // Inverse of the lexicographic enumeration order.
    function cardsOf(i) {
      const out = [];
      let x = 0;
      for (let slot = 0; slot < k; slot++) {
        for (;;) {
          const below = binomial(n - x - 1, k - slot - 1);
          if (i < below) break;
          i -= below;
          x++;
        }
        out.push(live[x]);
        x++;
      }
      return out;
    }

    return {
      game: gameId,
      holeCards: k,
      total,
      counts,
      made,
      flags,
      madeIds: MADE_IDS,
      flagIds: ctx.flagIds,
      nutLow: ctx.nutLow,
      cardsOf,
      categoriesOf: (i) => [MADE_IDS[made[i]]].concat(ctx.flagIds.filter((id, b) => flags[i] & (1 << b))),
    };
  }

  // Classifies one Omaha hand (4 or 5 cards) on a board. Returns { categories, high, low, isNutLow }.
  function classifyOmaha(hand, board, gameId) {
    const cards = hand.slice().sort((a, b) => b - a);
    const ctx = omahaContext(board, gameId);
    const pairs = combinations(cards, 2);
    const table = buildPairTable(board, pairs);
    let result = null;
    enumerateOmaha(cards, cards.length, table, ctx, (made, flags, low) => { result = { made, flags, low }; });
    let high = null;
    for (const [hi, lo] of pairs) {
      for (const t of combinations(board, 3)) {
        const ev = evaluate([hi, lo].concat(t));
        if (!high || ev.score > high.score) high = ev;
      }
    }
    return {
      categories: [MADE_IDS[result.made]].concat(ctx.flagIds.filter((id, b) => result.flags & (1 << b))),
      high,
      low: result.low,
      isNutLow: result.low !== NO_LOW && result.low === ctx.nutLow,
    };
  }

  // ---------------------------------------------------------------------------
  // Runout tree: how each possible turn / river card changes the board
  // ---------------------------------------------------------------------------

  // Tags in display order. A card gets every tag that applies; cards with the same tags share a branch.
  // Names say what happens on the board; `about` explains it in a sentence.
  const RUNOUT_TAGS = [
    { id: 'flush5', name: 'Five-flush (5 of a suit)', about: 'All five board cards are one suit, so every player has at least that flush.' },
    { id: 'flush4', name: 'Four-flush (4 of a suit)', about: 'Four board cards share a suit: any single card of that suit makes a flush.' },
    { id: 'flush3', name: 'Flush possible (3 of a suit)', about: 'A third card of one suit: hands with two of that suit now have a flush.' },
    { id: 'flush-draw', name: 'Goes two-tone (new flush draw)', about: 'No suit had two cards on the board before; now one does. Hands with two of that suit turn their backdoor flush draw into a real flush draw.' },
    { id: 'flush-draw-2', name: 'Second flush draw (2 of another suit)', about: 'The board was already two-tone; this card makes two of a second suit, so a second flush draw appears (a backdoor draw in that suit becomes a real one).' },
    { id: 'straight5', name: 'Straight on board', about: 'The five board cards make a straight by themselves.' },
    { id: 'straight4', name: 'Four to a straight (one-card straight)', about: 'Four board cards fit in a five-card straight, so a single card can make a straight.' },
    { id: 'straight3', name: 'Straight now possible', about: 'For the first time, three board cards fit in a five-card straight, so two hole cards can make one.' },
    { id: 'quads', name: 'Quads on board', about: 'The fourth card of a rank: four of a kind on the board.' },
    { id: 'full-house', name: 'Full house on board', about: 'The board itself now makes a full house.' },
    { id: 'trips', name: 'Trips on board', about: 'Matches a pair on the board: three of a kind on the board.' },
    { id: 'two-pair', name: 'Second pair on board', about: 'The board was already paired; this card pairs another rank.' },
    { id: 'pair', name: 'Pairs the board', about: 'Matches the rank of a board card on an unpaired board.' },
    { id: 'low', name: 'Low now possible (3 low cards)', about: 'Hi-lo only: the board now has three different cards 8 or lower, so a low can be made.' },
    { id: 'overcard', name: 'Overcard (new high card)', about: 'Higher than every card already on the board.' },
    { id: 'blank', name: 'Blank (no change)', about: 'Changes none of the above.' },
  ];
  const RUNOUT_TAG_NAMES = Object.fromEntries(RUNOUT_TAGS.map((t) => [t.id, t.name]));
  const RUNOUT_TAG_ORDER = Object.fromEntries(RUNOUT_TAGS.map((t, i) => [t.id, i]));

  // Most board ranks inside any five-rank straight window (aces play high and low).
  function maxStraightWindow(board) {
    let m = 0;
    for (const c of board) m |= 1 << rankOf(c);
    const ext = (m << 1) | ((m >> 12) & 1); // bit 0 = ace-low
    let best = 0;
    for (let lo = 0; lo <= 9; lo++) best = Math.max(best, popcount((ext >> lo) & 0x1f));
    return best;
  }

  const distinctLowRanks = (board) => new Set(board.map((c) => lowValueOfRank(rankOf(c))).filter(Boolean)).size;

  // Tags describing what adding `card` does to `board`.
  function boardChangeTags(board, card, hiLo) {
    const tags = [];
    const after = board.concat([card]);
    const finalCard = after.length === 5;

    const suitAfter = after.filter((c) => suitOf(c) === suitOf(card)).length;
    if (suitAfter === 5) tags.push('flush5');
    else if (suitAfter === 4) tags.push('flush4');
    else if (suitAfter === 3) tags.push('flush3');
    else if (suitAfter === 2 && !finalCard) {
      const alreadyTwoTone = [0, 1, 2, 3].some((st) => st !== suitOf(card) && board.filter((c) => suitOf(c) === st).length >= 2);
      tags.push(alreadyTwoTone ? 'flush-draw-2' : 'flush-draw');
    }

    const before = maxStraightWindow(board);
    const now = maxStraightWindow(after);
    if (now > before && now >= 3) tags.push(now >= 5 ? 'straight5' : now === 4 ? 'straight4' : 'straight3');

    const counts = new Array(13).fill(0);
    for (const c of after) counts[rankOf(c)]++;
    const r = rankOf(card);
    const pairsOnBoard = counts.filter((n) => n >= 2).length;
    if (counts[r] === 4) tags.push('quads');
    else if (counts[r] === 3) tags.push(counts.some((n, i) => i !== r && n >= 2) ? 'full-house' : 'trips');
    else if (counts[r] === 2) tags.push(counts.some((n, i) => i !== r && n >= 3) ? 'full-house' : pairsOnBoard >= 2 ? 'two-pair' : 'pair');
    else if (board.every((c) => rankOf(c) < r)) tags.push('overcard');

    if (hiLo && distinctLowRanks(board) < 3 && distinctLowRanks(after) >= 3) tags.push('low');

    if (!tags.length) tags.push('blank');
    return tags.sort((a, b) => RUNOUT_TAG_ORDER[a] - RUNOUT_TAG_ORDER[b]);
  }

  const tagKey = (tags) => tags.join('+');
  const tagLabel = (tags) => tags.map((t) => RUNOUT_TAG_NAMES[t]).join(' + ');

  // Groups the next cards for a board by what they change.
  // Returns { unseen, groups: [{ key, tags, label, cards, count, prob }], tagTotals: { tag: prob } }.
  function nextCardGroups(board, hiLo) {
    const dead = new Set(board);
    const byKey = new Map();
    const tagCounts = {};
    let unseen = 0;
    for (let c = 51; c >= 0; c--) {
      if (dead.has(c)) continue;
      unseen++;
      const tags = boardChangeTags(board, c, hiLo);
      const key = tagKey(tags);
      if (!byKey.has(key)) byKey.set(key, { key, tags, label: tagLabel(tags), cards: [] });
      byKey.get(key).cards.push(c);
      for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    const groups = [...byKey.values()].map((g) => ({ ...g, count: g.cards.length, prob: g.cards.length / unseen }));
    groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const tagTotals = {};
    for (const t of RUNOUT_TAGS) if (tagCounts[t.id]) tagTotals[t.id] = tagCounts[t.id] / unseen;
    return { unseen, groups, tagTotals };
  }

  // The runout tree for a flop or turn board. On a flop each turn branch also gets the river
  // branches that follow it, as probabilities given that turn branch (`prob`) and overall (`overall`).
  function runoutTree(board, gameId) {
    const hiLo = !!(GAMES[gameId || 'nlhe'].hiLo);
    if (board.length < 3 || board.length > 4) throw new Error('The runout tree needs a flop or a turn.');
    const next = nextCardGroups(board, hiLo);
    if (board.length === 3) {
      for (const g of next.groups) {
        const byKey = new Map();
        let total = 0;
        for (const turn of g.cards) {
          const river = nextCardGroups(board.concat([turn]), hiLo);
          for (const rg of river.groups) {
            if (!byKey.has(rg.key)) byKey.set(rg.key, { key: rg.key, tags: rg.tags, label: rg.label, count: 0 });
            byKey.get(rg.key).count += rg.count;
          }
          total += river.unseen;
        }
        g.river = [...byKey.values()].map((rg) => ({ ...rg, prob: rg.count / total, overall: g.prob * rg.count / total }));
        g.river.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      }
    }
    return { street: board.length === 3 ? 'turn' : 'river', ...next };
  }

  // Before the flop: how often each flop texture comes up (all 22,100 flops).
  function flopTextureOdds() {
    const counts = new Map();
    let total = 0;
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        for (let c = b + 1; c < 52; c++) {
          const t = flopTexture([a, b, c]);
          const key = t.suits + '|' + t.pairing;
          counts.set(key, (counts.get(key) || 0) + 1);
          total++;
        }
      }
    }
    return [...counts.entries()].map(([key, count]) => {
      const [suits, pairing] = key.split('|');
      return { suits, pairing, count, prob: count / total };
    }).sort((x, y) => y.count - x.count);
  }

  // ---------------------------------------------------------------------------
  // Equity calculator
  // ---------------------------------------------------------------------------

  // Allocation-free version of evaluate(): returns the same score for the first n cards.
  const scratchCounts = new Uint8Array(13);
  const scratchSuitMask = new Int32Array(4);
  const scratchSuitCount = new Uint8Array(4);
  const scratchSingles = new Int8Array(8);

  function pack(cat, k0, k1, k2, k3, k4) {
    return ((((cat * 15 + k0 + 1) * 15 + k1 + 1) * 15 + k2 + 1) * 15 + k3 + 1) * 15 + k4 + 1;
  }

  function scoreCards(cards, n) {
    scratchCounts.fill(0);
    scratchSuitMask.fill(0);
    scratchSuitCount.fill(0);
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const c = cards[i];
      const r = c >> 2;
      const s = c & 3;
      scratchCounts[r]++;
      scratchSuitMask[s] |= 1 << r;
      scratchSuitCount[s]++;
      mask |= 1 << r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (scratchSuitCount[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sf = straightHigh(scratchSuitMask[flushSuit]);
      if (sf >= 0) return pack(HAND.STRAIGHT_FLUSH, sf, -1, -1, -1, -1);
    }

    let quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1, p3 = -1, ns = 0;
    for (let r = 12; r >= 0; r--) {
      const c = scratchCounts[r];
      if (c === 4) quad = r;
      else if (c === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
      else if (c === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; else if (p3 < 0) p3 = r; }
      else if (c === 1) scratchSingles[ns++] = r;
    }
    for (let i = ns; i < 5; i++) scratchSingles[i] = -1;
    const s0 = scratchSingles[0], s1 = scratchSingles[1], s2 = scratchSingles[2], s3 = scratchSingles[3], s4 = scratchSingles[4];

    if (quad >= 0) return pack(HAND.QUADS, quad, Math.max(t1, p1, s0), -1, -1, -1);
    if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return pack(HAND.FULL_HOUSE, t1, Math.max(t2, p1), -1, -1, -1);
    if (flushSuit >= 0) {
      const fm = scratchSuitMask[flushSuit];
      let f = 0;
      for (let r = 12; r >= 0 && f < 5; r--) if (fm & (1 << r)) scratchSingles[f++] = r;
      return pack(HAND.FLUSH, scratchSingles[0], scratchSingles[1], scratchSingles[2], scratchSingles[3], scratchSingles[4]);
    }
    const st = straightHigh(mask);
    if (st >= 0) return pack(HAND.STRAIGHT, st, -1, -1, -1, -1);
    if (t1 >= 0) return pack(HAND.TRIPS, t1, s0, s1, -1, -1);
    if (p2 >= 0) return pack(HAND.TWO_PAIR, p1, p2, Math.max(p3, s0), -1, -1);
    if (p1 >= 0) return pack(HAND.PAIR, p1, s0, s1, s2, -1);
    return pack(HAND.HIGH_CARD, s0, s1, s2, s3, s4);
  }

  // 8-or-better lows as bitmasks of low values (bit 1 = ace ... bit 8 = eight). Five bits set is a
  // qualifying low, and a numerically smaller mask is a better low (it compares the top card first).
  const lowBitOfCard = (c) => {
    const v = lowValueOfRank(rankOf(c));
    return v ? 1 << v : 0;
  };

  function lowMaskOf(cardsList) {
    let m = 0;
    for (const c of cardsList) {
      const b = lowBitOfCard(c);
      if (!b || (m & b)) return 0;
      m |= b;
    }
    return m;
  }

  const BOARD_TRIPLES = combinations([0, 1, 2, 3, 4], 3);

  // Per-player data that doesn't depend on the board: hole pairs and their low masks (Omaha).
  function prepareHand(hand, omaha) {
    if (!omaha) return { hand };
    const pairs = combinations(hand, 2);
    return { hand, pairs, pairLow: pairs.map(lowMaskOf) };
  }

  const scratchHand = new Array(7);

  // Scores one complete runout. Fills hi[] (higher is better) and lo[] (lower is better, Infinity = none).
  function scoreRunout(players, board, omaha, hiLo, hi, lo) {
    if (!omaha) {
      for (let i = 0; i < 5; i++) scratchHand[i] = board[i];
      for (let p = 0; p < players.length; p++) {
        scratchHand[5] = players[p].hand[0];
        scratchHand[6] = players[p].hand[1];
        hi[p] = scoreCards(scratchHand, 7);
        lo[p] = Infinity;
      }
      return;
    }
    const triples = BOARD_TRIPLES.map((t) => [board[t[0]], board[t[1]], board[t[2]]]);
    const tripleLow = hiLo ? triples.map(lowMaskOf) : null;
    for (let p = 0; p < players.length; p++) {
      const { pairs, pairLow } = players[p];
      let best = -1;
      let bestLow = Infinity;
      for (let a = 0; a < pairs.length; a++) {
        scratchHand[0] = pairs[a][0];
        scratchHand[1] = pairs[a][1];
        for (let t = 0; t < 10; t++) {
          scratchHand[2] = triples[t][0];
          scratchHand[3] = triples[t][1];
          scratchHand[4] = triples[t][2];
          const sc = scoreCards(scratchHand, 5);
          if (sc > best) best = sc;
          if (hiLo && pairLow[a] && tripleLow[t] && !(pairLow[a] & tripleLow[t])) {
            const m = pairLow[a] | tripleLow[t];
            if (m < bestLow) bestLow = m;
          }
        }
      }
      hi[p] = best;
      lo[p] = bestLow;
    }
  }

  const EXACT_LIMIT = 5e6; // max hand evaluations for an exact answer
  const TRIAL_LIMIT = { nlhe: 400000, omaha: 100000 };
  const TIME_LIMIT_MS = 2500;

  // ---------------------------------------------------------------------------
  // Hold'em ranges: "JJ+, ATo+, A7s+, KQ, T9s-65s, AsKs"
  // ---------------------------------------------------------------------------

  const RANK_RE = '[2-9TJQKA]';

  // The 13x13 hand labels ("AA", "AKs", "AKo") ordered like the grid.
  const HAND_LABELS = (() => {
    const out = [];
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const hi = RANKS[12 - Math.min(r, c)];
        const lo = RANKS[12 - Math.max(r, c)];
        out.push(r === c ? hi + lo : hi + lo + (r < c ? 's' : 'o'));
      }
    }
    return out;
  })();

  // All combos (pairs of card numbers, high card first) for a label like "AKs", "AKo" or "QQ".
  function combosForLabel(label) {
    const r1 = RANKS.indexOf(label[0]);
    const r2 = RANKS.indexOf(label[1]);
    const out = [];
    if (r1 === r2) {
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([makeCard(r1, b), makeCard(r1, a)]);
    } else if (label[2] === 's') {
      for (let a = 0; a < 4; a++) out.push([makeCard(r1, a), makeCard(r2, a)]);
    } else {
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([makeCard(r1, a), makeCard(r2, b)]);
    }
    return out;
  }

  const labelOf = (hi, lo, kind) => RANKS[hi] + RANKS[lo] + (hi === lo ? '' : kind);

  // Labels for an unpaired token, expanding "s/o" absence to both.
  function unpairedLabels(hi, lo, kind) {
    return kind ? [labelOf(hi, lo, kind)] : [labelOf(hi, lo, 's'), labelOf(hi, lo, 'o')];
  }

  // Parses a hold'em range. Returns { labels: Set, combos: [[c1, c2], ...] } (no duplicates).
  // Throws with a readable message for anything it doesn't understand.
  function parseRange(text) {
    const labels = new Set();
    const combos = new Map(); // "c1,c2" -> [c1, c2]
    const addCombo = (a, b) => {
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      combos.set(hi + ',' + lo, [hi, lo]);
    };
    const addLabel = (label) => {
      labels.add(label);
      for (const [a, b] of combosForLabel(label)) addCombo(a, b);
    };
    const tokens = text.replace(/\s*-\s*/g, '-').split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) throw new Error('Enter a range, e.g. JJ+, ATo+, A7s+.');
    const rank = (ch) => RANKS.indexOf(ch.toUpperCase());

    for (const raw of tokens) {
      const t = raw.replace(/10/g, 'T');
      let m;
      if (/^(any|random|100%)$/i.test(t)) {
        HAND_LABELS.forEach(addLabel);
      } else if ((m = t.match(new RegExp('^(' + RANK_RE + ')([shdc])(' + RANK_RE + ')([shdc])$', 'i')))) {
        const a = makeCard(rank(m[1]), SUITS.indexOf(m[2].toLowerCase()));
        const b = makeCard(rank(m[3]), SUITS.indexOf(m[4].toLowerCase()));
        if (a === b) throw new Error('"' + raw + '" uses the same card twice.');
        addCombo(a, b);
      } else if ((m = t.match(new RegExp('^(' + RANK_RE + ')(' + RANK_RE + ')([so]?)(\\+?)$', 'i')))) {
        let hi = rank(m[1]);
        let lo = rank(m[2]);
        const kind = m[3].toLowerCase();
        if (hi < lo) [hi, lo] = [lo, hi];
        if (hi === lo) {
          if (kind) throw new Error('"' + raw + '": pairs can’t be suited or offsuit.');
          for (let r = hi; r <= (m[4] ? 12 : hi); r++) addLabel(labelOf(r, r));
        } else {
          for (let k = lo; k <= (m[4] ? hi - 1 : lo); k++) unpairedLabels(hi, k, kind).forEach(addLabel);
        }
      } else if ((m = t.match(new RegExp('^(' + RANK_RE + ')(' + RANK_RE + ')([so]?)-(' + RANK_RE + ')(' + RANK_RE + ')([so]?)$', 'i')))) {
        const kind = (m[3] || m[6]).toLowerCase();
        if (m[3] && m[6] && m[3].toLowerCase() !== m[6].toLowerCase()) throw new Error('"' + raw + '" mixes suited and offsuit.');
        let [a1, a2, b1, b2] = [rank(m[1]), rank(m[2]), rank(m[4]), rank(m[5])];
        if (a1 < a2) [a1, a2] = [a2, a1];
        if (b1 < b2) [b1, b2] = [b2, b1];
        if (a1 === a2 && b1 === b2) {
          // Pair run: 22-66
          for (let r = Math.min(a1, b1); r <= Math.max(a1, b1); r++) addLabel(labelOf(r, r));
        } else if (a1 === b1 && a1 !== a2 && b1 !== b2) {
          // Same top card: A2s-A5s
          for (let k = Math.min(a2, b2); k <= Math.max(a2, b2); k++) unpairedLabels(a1, k, kind).forEach(addLabel);
        } else if (a1 - a2 === b1 - b2 && a1 !== a2) {
          // Same gap: T9s-65s
          const gap = a1 - a2;
          for (let top = Math.min(a1, b1); top <= Math.max(a1, b1); top++) unpairedLabels(top, top - gap, kind).forEach(addLabel);
        } else {
          throw new Error('Couldn’t read the range "' + raw + '".');
        }
      } else {
        throw new Error('Couldn’t read "' + raw + '". Try forms like JJ+, 22-55, ATo+, A7s+, KQ, T9s-65s or AsKs.');
      }
    }
    return { labels, combos: [...combos.values()] };
  }

  // Writes a set of grid labels back as short range notation, e.g. "JJ+, 55-22, ATs+, KQo".
  function rangeToText(labelSet) {
    const parts = [];
    const pairs = [];
    for (let r = 12; r >= 0; r--) if (labelSet.has(labelOf(r, r))) pairs.push(r);
    // Runs of consecutive ranks (descending input).
    const runs = (ranks) => {
      const out = [];
      for (const r of ranks) {
        const last = out[out.length - 1];
        if (last && last[last.length - 1] === r + 1) last.push(r);
        else out.push([r]);
      }
      return out;
    };
    for (const run of runs(pairs)) {
      const top = run[0];
      const bottom = run[run.length - 1];
      if (run.length === 1) parts.push(labelOf(top, top));
      else if (top === 12) parts.push(labelOf(bottom, bottom) + '+');
      else parts.push(labelOf(top, top) + '-' + labelOf(bottom, bottom));
    }
    const runText = (hi, run, kind) => {
      const top = run[0];
      const bottom = run[run.length - 1];
      if (run.length === 1) return labelOf(hi, top, kind);
      if (top === hi - 1) return labelOf(hi, bottom, kind) + '+';
      return labelOf(hi, top, kind) + '-' + labelOf(hi, bottom, kind);
    };
    for (let hi = 12; hi >= 1; hi--) {
      const kickers = { s: [], o: [] };
      for (let lo = hi - 1; lo >= 0; lo--) {
        for (const kind of ['s', 'o']) if (labelSet.has(labelOf(hi, lo, kind))) kickers[kind].push(lo);
      }
      const sRuns = runs(kickers.s).map((r) => runText(hi, r, 's'));
      const oRuns = runs(kickers.o).map((r) => runText(hi, r, 'o'));
      // Where the suited and offsuit runs match exactly, write them once without s/o.
      const strip = (x) => x.replace(/[so]/g, '');
      const both = sRuns.filter((x) => oRuns.some((y) => strip(y) === strip(x)));
      for (const x of both) parts.push(strip(x));
      for (const x of sRuns) if (!both.includes(x)) parts.push(x);
      for (const x of oRuns) if (!both.some((b) => strip(b) === strip(x))) parts.push(x);
    }
    return parts.join(', ');
  }

  // Builds an equity calculation. hands[i] is a card array, null for a random hand, or
  // { combos: [[c1, c2], ...] } for a hold'em range (every valid deal is equally likely).
  // Call step(ms) until it returns true (lets a page stay responsive), or run() to finish at once.
  function createEquityJob(hands, board, gameId) {
    const game = GAMES[gameId];
    const omaha = game.holeCards > 2;
    const hiLo = !!game.hiLo;
    const k = game.holeCards;
    const nPlayers = hands.length;
    if (nPlayers < 2) throw new Error('Equity needs at least two players.');
    if (board.length > 5) throw new Error('The board has too many cards.');

    const isRange = (h) => h && !Array.isArray(h);
    const known = board.slice();
    for (const h of hands) {
      if (!h || isRange(h)) continue;
      if (h.length !== k) throw new Error('Each hand needs exactly ' + k + ' cards.');
      known.push(...h);
    }
    if (new Set(known).size !== known.length) throw new Error('The same card is used twice.');
    const knownSet = new Set(known);
    const deck = [];
    for (let c = 0; c < 52; c++) if (!knownSet.has(c)) deck.push(c);

    // Ranges lose every combo that uses a known card.
    const rangeSeats = [];
    const rangeCombos = hands.map((h, i) => {
      if (!isRange(h)) return null;
      if (omaha) throw new Error('Ranges are only supported for hold’em.');
      const live = h.combos.filter(([a, b]) => !knownSet.has(a) && !knownSet.has(b));
      if (!live.length) throw new Error('Player ' + (i + 1) + '’s range has no hands left once the known cards are removed.');
      rangeSeats.push(i);
      return live;
    });

    const randomSeats = hands.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);
    const need = 5 - board.length;
    if (deck.length < need + (randomSeats.length * k) + rangeSeats.length * 2) throw new Error('Not enough cards left in the deck.');

    const players = hands.map((h) => (h && !isRange(h) ? prepareHand(h, omaha) : null));
    const evalsPerPlayer = omaha ? binomial(k, 2) * 10 : 1;
    const runoutsPerDeal = binomial(deck.length - rangeSeats.length * 2, need);

    // Exact mode: list every valid way to deal the ranges (when there aren't too many), then every runout.
    let assignments = null;
    if (randomSeats.length === 0) {
      const product = rangeSeats.reduce((n, i) => n * rangeCombos[i].length, 1);
      if (product * runoutsPerDeal * nPlayers * evalsPerPlayer <= EXACT_LIMIT) {
        assignments = [];
        const pick = (depth, used, acc) => {
          if (depth === rangeSeats.length) { assignments.push(acc.slice()); return; }
          for (const combo of rangeCombos[rangeSeats[depth]]) {
            if (used.has(combo[0]) || used.has(combo[1])) continue;
            used.add(combo[0]); used.add(combo[1]); acc.push(combo);
            pick(depth + 1, used, acc);
            used.delete(combo[0]); used.delete(combo[1]); acc.pop();
          }
        };
        pick(0, new Set(), []);
        if (!assignments.length) throw new Error('The ranges block each other completely.');
      }
    }
    const exact = assignments !== null;
    const totalExact = exact ? assignments.length * runoutsPerDeal : 0;
    const maxTrials = exact ? totalExact : TRIAL_LIMIT[omaha ? 'omaha' : 'nlhe'];

    const stats = hands.map(() => ({ share: 0, win: 0, tie: 0, high: 0, low: 0 }));
    const hi = new Float64Array(nPlayers);
    const lo = new Float64Array(nPlayers);
    const fullBoard = board.concat(new Array(need).fill(0));
    let done = 0;
    let started = 0;
    let finished = false;

    function settle() {
      scoreRunout(players, fullBoard, omaha, hiLo, hi, lo);
      let bestHi = -1;
      let hiCount = 0;
      let bestLo = Infinity;
      let loCount = 0;
      for (let p = 0; p < nPlayers; p++) {
        if (hi[p] > bestHi) { bestHi = hi[p]; hiCount = 1; } else if (hi[p] === bestHi) hiCount++;
        if (lo[p] < bestLo) { bestLo = lo[p]; loCount = 1; } else if (lo[p] === bestLo && lo[p] !== Infinity) loCount++;
      }
      const lowPot = hiLo && bestLo !== Infinity ? 0.5 : 0;
      const highPot = 1 - lowPot;
      for (let p = 0; p < nPlayers; p++) {
        let share = 0;
        if (hi[p] === bestHi) { share += highPot / hiCount; stats[p].high++; }
        if (lowPot && lo[p] === bestLo) { share += lowPot / loCount; stats[p].low++; }
        stats[p].share += share;
        if (share > 0.999999) stats[p].win++;
        else if (share > 0) stats[p].tie++;
      }
      done++;
    }

    // Exact enumeration state: which range deal, and which runout within it.
    let dealIndex = -1;
    let dealDeck = null;
    const combo = Array.from({ length: need }, (_, i) => i);
    let comboDone = true;

    function startDeal() {
      dealIndex++;
      if (dealIndex >= assignments.length) return false;
      const used = new Set();
      assignments[dealIndex].forEach((c, j) => {
        players[rangeSeats[j]] = prepareHand(c, omaha);
        used.add(c[0]);
        used.add(c[1]);
      });
      dealDeck = deck.filter((c) => !used.has(c));
      for (let i = 0; i < need; i++) combo[i] = i;
      comboDone = false;
      return true;
    }

    function nextExact() {
      if (comboDone && !startDeal()) return false;
      for (let i = 0; i < need; i++) fullBoard[board.length + i] = dealDeck[combo[i]];
      settle();
      // Advance to the next combination of `need` deck indexes.
      let i = need - 1;
      while (i >= 0 && combo[i] === dealDeck.length - need + i) i--;
      if (i < 0) comboDone = true;
      else {
        combo[i]++;
        for (let j = i + 1; j < need; j++) combo[j] = combo[j - 1] + 1;
      }
      return true;
    }

    // Random deals: ranges first (rejecting deals where they collide, so every valid deal is equally
    // likely), then random hands and the board from what's left.
    const usedMark = new Uint8Array(52);
    function nextRandom() {
      let picked;
      for (let attempt = 0; ; attempt++) {
        picked = rangeSeats.map((i) => rangeCombos[i][Math.floor(Math.random() * rangeCombos[i].length)]);
        const seen = new Set();
        let clash = false;
        for (const [a, b] of picked) {
          if (seen.has(a) || seen.has(b)) { clash = true; break; }
          seen.add(a); seen.add(b);
        }
        if (!clash) break;
        if (attempt > 10000) throw new Error('The ranges block each other almost completely.');
      }
      picked.forEach((c, j) => {
        players[rangeSeats[j]] = prepareHand(c, omaha);
        usedMark[c[0]] = 1;
        usedMark[c[1]] = 1;
      });
      let pos = 0;
      const take = () => {
        for (;;) {
          const j = pos + Math.floor(Math.random() * (deck.length - pos));
          const c = deck[j];
          deck[j] = deck[pos];
          deck[pos] = c;
          pos++;
          if (!usedMark[c]) return c;
        }
      };
      for (const seat of randomSeats) {
        const hand = [];
        for (let i = 0; i < k; i++) hand.push(take());
        players[seat] = prepareHand(hand, omaha);
      }
      for (let i = 0; i < need; i++) fullBoard[board.length + i] = take();
      settle();
      picked.forEach((c) => {
        usedMark[c[0]] = 0;
        usedMark[c[1]] = 0;
      });
    }

    function step(ms) {
      if (finished) return true;
      if (!started) started = Date.now();
      const until = Date.now() + ms;
      while (Date.now() < until) {
        for (let i = 0; i < 200; i++) {
          if (exact) {
            if (!nextExact()) { finished = true; return true; }
          } else {
            nextRandom();
            if (done >= maxTrials) { finished = true; return true; }
          }
        }
        if (!exact && Date.now() - started > TIME_LIMIT_MS) { finished = true; return true; }
      }
      return false;
    }

    function results() {
      return {
        exact,
        hiLo,
        runouts: done,
        progress: Math.min(1, exact ? done / maxTrials : Math.max(done / maxTrials, started ? (Date.now() - started) / TIME_LIMIT_MS : 0)),
        players: stats.map((s) => ({
          equity: done ? s.share / done : 0,
          win: done ? s.win / done : 0,
          tie: done ? s.tie / done : 0,
          high: done ? s.high / done : 0,
          low: done ? s.low / done : 0,
          // Standard error of the equity estimate (0 for exact answers).
          error: exact || !done ? 0 : Math.sqrt(Math.max(s.share / done * (1 - s.share / done), 1e-9) / done),
        })),
      };
    }

    return {
      exact,
      totalRunouts: exact ? totalExact : null,
      liveCombos: rangeCombos.map((c) => (c ? c.length : null)),
      step,
      results,
      run() {
        while (!step(1000));
        return results();
      },
    };
  }

  const HAND_NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

  const api = {
    RANKS,
    SUITS,
    SUIT_SYMBOLS,
    HAND,
    HAND_NAMES,
    CATEGORIES,
    GAMES,
    NO_LOW,
    categoryName,
    lowToString,
    classifyOmaha,
    parseCardList,
    scoreCards,
    createEquityJob,
    HAND_LABELS,
    combosForLabel,
    parseRange,
    rangeToText,
    RUNOUT_TAGS,
    boardChangeTags,
    runoutTree,
    flopTextureOdds,
    rankOf,
    suitOf,
    makeCard,
    cardToString,
    parseCard,
    parseCards,
    drawCards,
    parseBoard,
    flopTexture,
    textureIsPossible,
    drawFlop,
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
