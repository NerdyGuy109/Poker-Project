const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/poker.js');

const cards = P.parseCards;
const evalCat = (str) => P.evaluate(cards(str)).category;
const classify = (hole, board) => P.classify(cards(hole), cards(board));

test('evaluates hand categories', () => {
  assert.equal(evalCat('As Ks Qs Js Ts 2d 3c'), P.HAND.STRAIGHT_FLUSH);
  assert.equal(evalCat('Ah 2h 3h 4h 5h'), P.HAND.STRAIGHT_FLUSH);
  assert.equal(evalCat('9c 9d 9h 9s 2c'), P.HAND.QUADS);
  assert.equal(evalCat('9c 9d 9h 2s 2c 2d Ac'), P.HAND.FULL_HOUSE);
  assert.equal(evalCat('2c 7c 9c Jc Kc Ad'), P.HAND.FLUSH);
  assert.equal(evalCat('As 2d 3c 4h 5s'), P.HAND.STRAIGHT);
  assert.equal(evalCat('Qs Kd Ac 2h 3s'), P.HAND.HIGH_CARD); // no wraparound straights
  assert.equal(evalCat('7s 7d 7c Ah 2s'), P.HAND.TRIPS);
  assert.equal(evalCat('7s 7d 2c 2h As'), P.HAND.TWO_PAIR);
  assert.equal(evalCat('7s 7d 2c 3h As'), P.HAND.PAIR);
  assert.equal(evalCat('7s 9d 2c 3h As'), P.HAND.HIGH_CARD);
});

test('compares hands within a category', () => {
  const score = (s) => P.evaluate(cards(s)).score;
  assert.ok(score('6s 2d 3c 4h 5s') > score('As 2d 3c 4h 5s')); // six-high beats the wheel
  assert.ok(score('As Ad Kc 7h 2s') > score('As Ad Qc Jh Ts'));
  assert.ok(score('Kc Kd Kh 2s 2c') > score('Qc Qd Qh As Ac'));
  assert.equal(score('Ac Kc 9c 7c 5c 2c'), score('Ac Kc 9c 7c 5c 3d'));
});

test('classifies made hands from the hole cards point of view', () => {
  assert.equal(classify('Ah Ad', 'Kc 7d 2s').made, 'overpair');
  assert.equal(classify('Kh Qd', 'Kc 7d 2s').made, 'top-pair');
  assert.equal(classify('7h 6h', 'Kc 7d 2s').made, 'middle-pair');
  assert.equal(classify('2h 3h', 'Kc 7d 2s').made, 'weak-pair');
  assert.equal(classify('9h 9d', 'Kc 7d 2s').made, 'pp-below-top');
  assert.equal(classify('7h 7s', 'Kc 7d 2s').made, 'set');
  assert.equal(classify('Kh 7h', 'Kc 7d 2s').made, 'two-pair');
  assert.equal(classify('Ah 3h', 'Kc 7d 2s').made, 'ace-high');
  assert.equal(classify('Qh Jh', 'Kc 7d 2s').made, 'no-made-hand');
  assert.equal(classify('Kh Qd', 'Kc Kd 2s').made, 'trips');
  assert.equal(classify('7h 6d', 'Kc Kd 7s').made, 'middle-pair'); // board pair doesn't count
  assert.equal(classify('Kh 7d', 'Kc Kd 7s').made, 'full-house');
  assert.equal(classify('5h 4h', '3c 2d As').made, 'straight');
  assert.equal(classify('Ah 4h', 'Kh 7h 2h').made, 'flush');
});

test('classifies draws', () => {
  assert.deepEqual(classify('Ah 5h', 'Kh 7h 2c').draws.sort(), ['flush-draw', 'nut-flush-draw']);
  assert.deepEqual(classify('Qh 5h', 'Kh 7h 2c').draws, ['flush-draw']);
  assert.deepEqual(classify('9c 8d', '7s 6h 2c').draws, ['oesd', 'overcards']);
  assert.deepEqual(classify('9c 5d', '7s 6h 2c').draws, ['gutshot']);
  assert.deepEqual(classify('9c 5d', '7c 6h Kc').draws, ['backdoor-flush-draw', 'gutshot']);
  assert.ok(classify('9h 8h', '7h 6c 2h').draws.includes('combo-draw'));
  assert.deepEqual(classify('Ad Qs', 'Jh 7c 2s').draws, ['overcards']);
  // A double gutshot (6 or T here) counts as an 8-out straight draw.
  assert.deepEqual(classify('9c 7d', 'Js 5h 8c 2d').draws, ['oesd']);
  assert.deepEqual(classify('Qh Td', 'Kc 9s 2d').draws.includes('oesd'), false);
  // No draws once the river is out.
  assert.deepEqual(classify('Ah 5h', 'Kh 7h 2c 3d 9s').draws, []);
});

test('analyzeBoard counts every combo exactly once per made category', () => {
  const flop = P.analyzeBoard(cards('Kc 7d 2s'));
  assert.equal(flop.total, 1176);
  const madeTotal = P.CATEGORIES.filter((c) => c.group === 'made').reduce((n, c) => n + flop.counts[c.id], 0);
  assert.equal(madeTotal, 1176);
  assert.equal(flop.counts.set, 9);
  assert.equal(flop.counts.overpair, 6);
  assert.equal(flop.counts['two-pair'], 27);
  assert.equal(P.analyzeBoard(cards('Kc 7d 2s 3h')).total, 1128);
  assert.equal(P.analyzeBoard(cards('Kc 7d 2s 3h 9c')).total, 1081);
});

test('drawCards never returns excluded or duplicate cards', () => {
  const exclude = cards('As Ks Qs');
  for (let i = 0; i < 200; i++) {
    const drawn = P.drawCards(5, exclude);
    assert.equal(new Set(drawn).size, 5);
    for (const c of drawn) assert.ok(!exclude.includes(c));
  }
});

test('parseBoard accepts common ways of typing cards', () => {
  const expected = cards('As Kd 7c');
  assert.deepEqual(P.parseBoard('As Kd 7c'), expected);
  assert.deepEqual(P.parseBoard('askd7C'), expected);
  assert.deepEqual(P.parseBoard('A♠, K♦, 7♣'), expected);
  assert.deepEqual(P.parseBoard('10h 9h 2c Td'), cards('Th 9h 2c Td'));
  // "T" and "10" mean the same rank, in any case, with or without spaces, and can be mixed.
  const tens = cards('Td Th 9c');
  for (const text of ['Td Th 9c', '10d 10h 9c', 'td th 9c', '10D10H9C', 'Td 10h 9c', '10\u2666 T\u2665 9\u2663']) {
    assert.deepEqual(P.parseBoard(text), tens, text);
  }
  assert.throws(() => P.parseBoard('Tc 10c 9c'), /twice/);
  assert.throws(() => P.parseBoard('As Kd'), /3 to 5/);
  assert.throws(() => P.parseBoard('As Kd 7c 2h 3h 4h'), /3 to 5/);
  assert.throws(() => P.parseBoard('As As 7c'), /twice/);
  assert.throws(() => P.parseBoard('As Kx 7c'), /Couldn/);
});

test('flopTexture describes suits and pairing', () => {
  assert.deepEqual(P.flopTexture(cards('As Ks 7s')), { suits: 'monotone', pairing: 'unpaired' });
  assert.deepEqual(P.flopTexture(cards('As Ks 7d')), { suits: 'two-tone', pairing: 'unpaired' });
  assert.deepEqual(P.flopTexture(cards('As Kh 7d')), { suits: 'rainbow', pairing: 'unpaired' });
  assert.deepEqual(P.flopTexture(cards('As Ah 7s')), { suits: 'two-tone', pairing: 'paired' });
  assert.deepEqual(P.flopTexture(cards('As Ah Ad')), { suits: 'rainbow', pairing: 'trips' });
});

test('drawFlop deals the requested texture, or null when impossible', () => {
  const suitsOpts = ['any', 'monotone', 'two-tone', 'rainbow'];
  const pairingOpts = ['any', 'unpaired', 'paired', 'trips'];
  for (const suits of suitsOpts) {
    for (const pairing of pairingOpts) {
      const possible = P.textureIsPossible(suits, pairing);
      for (let i = 0; i < 25; i++) {
        const flop = P.drawFlop({ suits, pairing });
        if (!possible) { assert.equal(flop, null); break; }
        assert.equal(new Set(flop).size, 3);
        const t = P.flopTexture(flop);
        if (suits !== 'any') assert.equal(t.suits, suits);
        if (pairing !== 'any') assert.equal(t.pairing, pairing);
      }
    }
  }
  assert.equal(P.textureIsPossible('monotone', 'paired'), false);
  assert.equal(P.textureIsPossible('two-tone', 'trips'), false);
  assert.equal(P.textureIsPossible('rainbow', 'trips'), true);
});

const omaha = (hand, board, game) => P.classifyOmaha(cards(hand), cards(board), game || 'plo');

test('Omaha hands must use exactly two hole cards', () => {
  // Hold'em plays the ace of hearts for a flush; Omaha can't use one heart.
  assert.equal(classify('Ah Kd', '2h 5h 9h Th 3c').made, 'flush');
  assert.deepEqual(omaha('Ah Kd Qc Jc', '2h 5h 9h Th 3c').categories, ['ace-high']);
  assert.deepEqual(omaha('Ah Kh Qc Jc', '2h 5h 9h Th 3c').categories, ['flush']);
  // Four to a straight on board plus one hole card isn't a straight in Omaha.
  assert.equal(omaha('9c 2d 2s 3h', '5h 6c 7d 8s Kh').high.category, P.HAND.PAIR);
  assert.deepEqual(omaha('As Ah 7c 2d', 'Kh 9s 4d').categories.slice(0, 1), ['overpair']);
});

test('Omaha draws', () => {
  // The classic 20-out wrap.
  assert.ok(omaha('9c 8d 5h 4s', '7h 6c 2d').categories.includes('wrap'));
  const fd = omaha('As Ks Qd Jd', 'Ah 7s 2s').categories;
  assert.equal(fd[0], 'top-pair');
  assert.ok(fd.includes('flush-draw') && fd.includes('nut-flush-draw'));
  // A single suited card with two on board is no flush draw in Omaha.
  assert.ok(!omaha('As Kd Qc Jh', 'Ah 7s 2s').categories.includes('flush-draw'));
  assert.ok(omaha('Kc Qc 9d 4h', 'Ac 7h 2s').categories.includes('backdoor-flush-draw'));
});

test('PLO8 lows', () => {
  const r = omaha('Ac 3d Ks Qh', '2c 5d 8h Kc Js', 'plo8');
  assert.equal(P.lowToString(r.low), '8-5-3-2-A low');
  assert.ok(r.categories.includes('nut-low') && r.categories.includes('any-low'));
  const weaker = omaha('Ac 4d Ks Qh', '2c 5d 8h Kc Js', 'plo8');
  assert.ok(weaker.categories.includes('any-low') && !weaker.categories.includes('nut-low'));
  assert.ok(omaha('Ac 3d Qs Qh', '2c 5d Kh', 'plo8').categories.includes('low-draw'));
  assert.equal(omaha('Ac 3d Qs Qh', '9c Td Kh', 'plo8').low, P.NO_LOW);
  assert.ok(!omaha('Ac 3d Qs Qh', '9c Td Kh', 'plo8').categories.includes('low-draw'));
  // No low categories in plain PLO.
  assert.ok(!omaha('Ac 3d Ks Qh', '2c 5d 8h Kc Js', 'plo').categories.includes('any-low'));
});

test('analyzeBoard counts every Omaha hand once', () => {
  const flop = P.analyzeBoard(cards('Kc 7d 2s'), 'plo');
  assert.equal(flop.total, 211876);
  const madeTotal = P.GAMES.plo.categoryIds.filter((id) => P.CATEGORIES.find((c) => c.id === id).group === 'made')
    .reduce((n, id) => n + flop.counts[id], 0);
  assert.equal(madeTotal, 211876);
  // Spot check: the per-hand categories match the single-hand classifier.
  for (const i of [0, 1234, 99999, 211875]) {
    assert.deepEqual(flop.categoriesOf(i), omaha(flop.cardsOf(i).map(P.cardToString).join(' '), 'Kc 7d 2s').categories);
  }
  const river = P.analyzeBoard(cards('Kc 7d 2s 3h 4c'), 'plo8');
  assert.equal(river.total, 178365);
  assert.ok(river.counts['any-low'] >= river.counts['nut-low'] && river.counts['nut-low'] > 0);
  assert.equal(river.counts['low-draw'], 0);
});
