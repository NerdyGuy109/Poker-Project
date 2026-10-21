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
      score: new Float64Array(2704),
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
      table.score[idx] = best.score;
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

  const PAIR_SLOTS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

  // Combines the six pairs of a 4-card hand (cards sorted high to low). Returns { made, flags, score, low }.
  function combineOmaha(table, cards, ctx) {
    let made = 255;
    let score = -1;
    let low = NO_LOW;
    let straightOuts = 0;
    let lowOuts = 0;
    for (const [i, j] of PAIR_SLOTS) {
      const idx = cards[i] * 52 + cards[j];
      if (table.made[idx] < made) made = table.made[idx];
      if (table.score[idx] > score) score = table.score[idx];
      if (table.low[idx] < low) low = table.low[idx];
      straightOuts |= table.straightOuts[idx];
      lowOuts |= table.lowOuts[idx];
    }

    let flags = 0;
    const bit = ctx.bit;
    if (ctx.street < 5) {
      const handSuit = [0, 0, 0, 0];
      const handRankCount = new Array(13).fill(0);
      for (const c of cards) {
        handSuit[suitOf(c)]++;
        handRankCount[rankOf(c)]++;
      }
      let flushDraw = false;
      for (let s = 0; s < 4; s++) {
        if (handSuit[s] < 2) continue;
        if (ctx.boardSuit[s] === 2) {
          flushDraw = true;
          flags |= bit['flush-draw'];
          if (cards.includes(makeCard(ctx.nutRank[s], s))) flags |= bit['nut-flush-draw'];
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
    return { made, flags, score, low };
  }

  function analyzeOmaha(board, gameId) {
    const ctx = omahaContext(board, gameId);
    const dead = new Set(board);
    const live = [];
    for (let c = 51; c >= 0; c--) if (!dead.has(c)) live.push(c);

    const pairs = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) pairs.push([live[i], live[j]]);
    const table = buildPairTable(board, pairs);

    const n = live.length;
    const total = n * (n - 1) * (n - 2) * (n - 3) / 24;
    const hands = new Uint8Array(total * 4);
    const made = new Uint8Array(total);
    const flags = new Uint32Array(total);
    const madeCounts = new Array(MADE_IDS.length).fill(0);
    const flagCounts = new Array(ctx.flagIds.length).fill(0);
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
            const res = combineOmaha(table, cards, ctx);
            hands[k * 4] = cards[0];
            hands[k * 4 + 1] = cards[1];
            hands[k * 4 + 2] = cards[2];
            hands[k * 4 + 3] = cards[3];
            made[k] = res.made;
            flags[k] = res.flags;
            madeCounts[res.made]++;
            for (let f = res.flags, i = 0; f; f >>>= 1, i++) if (f & 1) flagCounts[i]++;
            k++;
          }
        }
      }
    }

    const counts = {};
    for (const cat of CATEGORIES) counts[cat.id] = 0;
    MADE_IDS.forEach((id, i) => { counts[id] = madeCounts[i]; });
    ctx.flagIds.forEach((id, i) => { counts[id] = flagCounts[i]; });

    return {
      game: gameId,
      total,
      counts,
      hands,
      made,
      flags,
      madeIds: MADE_IDS,
      flagIds: ctx.flagIds,
      nutLow: ctx.nutLow,
      cardsOf: (i) => Array.from(hands.subarray(i * 4, i * 4 + 4)),
      categoriesOf: (i) => [MADE_IDS[made[i]]].concat(ctx.flagIds.filter((id, b) => flags[i] & (1 << b))),
    };
  }

  // Classifies one Omaha hand (4 cards) on a board. Returns { categories, high, low }.
  function classifyOmaha(hand, board, gameId) {
    const cards = hand.slice().sort((a, b) => b - a);
    const ctx = omahaContext(board, gameId);
    const pairs = PAIR_SLOTS.map(([i, j]) => [cards[i], cards[j]]);
    const table = buildPairTable(board, pairs);
    const res = combineOmaha(table, cards, ctx);
    let high = null;
    for (const [hi, lo] of pairs) {
      for (const t of combinations(board, 3)) {
        const ev = evaluate([hi, lo].concat(t));
        if (!high || ev.score > high.score) high = ev;
      }
    }
    return {
      categories: [MADE_IDS[res.made]].concat(ctx.flagIds.filter((id, b) => res.flags & (1 << b))),
      high,
      low: res.low,
      isNutLow: res.low !== NO_LOW && res.low === ctx.nutLow,
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
