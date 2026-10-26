/*
 * Exact turn and river odds for generic flop types, by enumerating every flop (22,100), every
 * turn card (49) and every turn + river pair (1,176). Board cards only: hole cards aren't removed.
 */
'use strict';
const P = require('../js/poker.js');

const rankOf = (c) => c >> 2;
const suitOf = (c) => c & 3;

function suitTexture(board) {
  const n = new Set(board.map(suitOf)).size;
  return n === 1 ? 'monotone' : n === 2 ? 'two-tone' : 'rainbow';
}
function pairing(board) {
  const n = new Set(board.map(rankOf)).size;
  return n === board.length ? 'unpaired' : n === board.length - 1 ? 'paired' : 'trips';
}
function maxSuit(board) {
  const c = [0, 0, 0, 0];
  for (const x of board) c[suitOf(x)]++;
  return Math.max(...c);
}
// Board pairing shape: counts of each rank, largest first, e.g. [2, 2, 1].
function shape(board) {
  const c = {};
  for (const x of board) c[rankOf(x)] = (c[rankOf(x)] || 0) + 1;
  return Object.values(c).sort((a, b) => b - a);
}
// Most distinct board ranks inside one five-rank straight window (aces high and low).
function window5(board) {
  let m = 0;
  for (const x of board) m |= 1 << rankOf(x);
  const ext = (m << 1) | ((m >> 12) & 1);
  let best = 0;
  for (let lo = 0; lo <= 9; lo++) {
    let v = (ext >> lo) & 0x1f;
    let n = 0;
    while (v) { v &= v - 1; n++; }
    best = Math.max(best, n);
  }
  return best;
}

// Smallest number of ranks between two flop cards that share a straight window (0 = touching,
// 3 = three-gap), counting the ace as low too.
function closestGap(board) {
  const ranks = board.map(rankOf);
  let best = 99;
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      const hi = Math.max(ranks[i], ranks[j]);
      const lo = Math.min(ranks[i], ranks[j]);
      let d = hi - lo;
      if (hi === 12) d = Math.min(d, lo + 1); // ace as a one
      if (d >= 1 && d <= 4) best = Math.min(best, d - 1);
    }
  }
  return best;
}

// Turn events and river (board after turn + river) events for one flop, as fractions.
function flopOdds(flop) {
  const dead = new Set(flop);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
  const turn = {};
  const river = {};
  const add = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const fSuit = maxSuit(flop);
  const fWin = window5(flop);
  const flopSuits = flop.map(suitOf);
  for (const t of deck) {
    const b = flop.concat([t]);
    const ms = maxSuit(b);
    const sameSuitOnFlop = flopSuits.filter((s) => s === suitOf(t)).length;
    if (ms === 4) add(turn, 'flush4');
    if (ms === 3 && fSuit < 3) add(turn, 'flush3');
    if (sameSuitOnFlop === 1 && fSuit === 2) add(turn, 'secondDraw');
    if (sameSuitOnFlop === 1 && fSuit === 1) add(turn, 'twoTone');
    if (sameSuitOnFlop === 0) add(turn, 'newSuit');
    const sh = shape(b);
    const fsh = shape(flop);
    if (sh[0] === 4) add(turn, 'quads');
    else if (sh[0] === 3 && fsh[0] < 3) add(turn, 'tripsBoard');
    else if (sh[0] === 2 && sh[1] === 2) add(turn, 'twoPairBoard');
    else if (sh[0] === 2 && fsh[0] < 2) add(turn, 'pairs');
    const w = window5(b);
    if (w >= 3 && fWin < 3) add(turn, 'straightPossible');
    if (w >= 4 && fWin < 4) add(turn, 'fourStraight');
    if (rankOf(t) > Math.max(...flop.map(rankOf))) add(turn, 'overcard');
  }
  let pairs = 0;
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const b = flop.concat([deck[i], deck[j]]);
      pairs++;
      const ms = maxSuit(b);
      if (ms >= 3) add(river, 'flush3plus');
      if (ms >= 4) add(river, 'flush4plus');
      if (ms === 5) add(river, 'flush5');
      const sh = shape(b);
      if (sh[0] >= 2) add(river, 'paired');
      if (sh[0] === 2 && sh[1] === 2) add(river, 'twoPair');
      if (sh[0] >= 3) add(river, 'tripsPlus');
      if (sh[0] === 3 && sh[1] === 2) add(river, 'fullHouse');
      if (sh[0] === 4) add(river, 'quads');
      const w = window5(b);
      if (w >= 3) add(river, 'straightPossible');
      if (w >= 4) add(river, 'fourStraight');
      if (w === 5) add(river, 'straightOnBoard');
    }
  }
  const norm = (o, n) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / n]));
  return { turn: norm(turn, deck.length), river: norm(river, pairs) };
}

// Averages (and ranges) of flopOdds over every flop in each class.
function build() {
  const classes = {};
  const addTo = (key, odds) => {
    const c = classes[key] || (classes[key] = { count: 0, turn: {}, river: {} });
    c.count++;
    for (const part of ['turn', 'river']) {
      for (const [k, v] of Object.entries(odds[part])) {
        const s = c[part][k] || (c[part][k] = { sum: 0, min: Infinity, max: -Infinity, seen: 0 });
        s.sum += v; s.seen++; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v);
      }
    }
  };
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      for (let c = b + 1; c < 52; c++) {
        const flop = [a, b, c];
        const odds = flopOdds(flop);
        const st = suitTexture(flop);
        const pr = pairing(flop);
        addTo('suit:' + st, odds);
        addTo('pair:' + pr, odds);
        addTo('type:' + st + '|' + pr, odds);
        if (pr === 'unpaired') {
          const w = window5(flop);
          addTo('conn:' + w, odds);
          if (w === 2) addTo('gap:' + closestGap(flop), odds);
        }
      }
    }
  }
  // Turn the sums into averages; a stat missing for some flops counts as 0 there.
  const out = {};
  for (const [key, c] of Object.entries(classes)) {
    const fin = (part) => Object.fromEntries(Object.entries(c[part]).map(([k, s]) => [k, {
      avg: s.sum / c.count,
      min: s.seen < c.count ? 0 : s.min,
      max: s.max,
    }]));
    out[key] = { count: c.count, share: c.count / 22100, turn: fin('turn'), river: fin('river') };
  }
  return out;
}

module.exports = { build, flopOdds };
if (require.main === module) {
  const t = Date.now();
  const d = build();
  console.error('built in ' + Math.round((Date.now() - t) / 1000) + 's');
  console.log(JSON.stringify(d, null, 1));
}
