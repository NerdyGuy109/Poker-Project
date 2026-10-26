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

test('5-card Omaha (PLO5 and Big O) still uses exactly two hole cards', () => {
  // Three hearts in hand plus two on board: only two hole cards play, so no flush.
  assert.deepEqual(omaha('Ah Kh Qh 7c 2d', '9h 8h 3s Js 4c', 'plo5').categories, ['ace-high']);
  assert.ok(omaha('Ah Kh Qc 7c 2d', '9h 8h 3h Js 4c', 'plo5').categories.includes('flush'));
  // Big O lows need two hole cards too.
  const r = omaha('Ac 3d Ks Qh Jh', '2c 5d 8h Kc 9s', 'bigo');
  assert.equal(P.lowToString(r.low), '8-5-3-2-A low');
  assert.ok(r.categories.includes('nut-low'));
  assert.ok(!omaha('Ac 3d Ks Qh Jh', '2c 5d 8h Kc 9s', 'plo5').categories.includes('any-low'));
});

test('analyzeBoard counts every 5-card hand once and can rebuild any hand', () => {
  const a = P.analyzeBoard(cards('9h 8h 2c'), 'bigo');
  assert.equal(a.total, 1906884);
  const madeTotal = P.GAMES.bigo.categoryIds.filter((id) => P.CATEGORIES.find((c) => c.id === id).group === 'made')
    .reduce((n, id) => n + a.counts[id], 0);
  assert.equal(madeTotal, 1906884);
  for (const i of [0, 1, 777777, 1906883]) {
    const hand = a.cardsOf(i);
    assert.equal(new Set(hand).size, 5);
    assert.deepEqual(a.categoriesOf(i), omaha(hand.map(P.cardToString).join(' '), '9h 8h 2c', 'bigo').categories);
  }
  // Lexicographic order: the first hand is the five highest live cards.
  assert.deepEqual(a.cardsOf(0).map(P.cardToString), ['Ac', 'Ad', 'Ah', 'As', 'Kc']);
});

test('scoreCards agrees with evaluate', () => {
  for (let i = 0; i < 5000; i++) {
    const n = 5 + (i % 3);
    const cs = P.drawCards(n);
    assert.equal(P.scoreCards(cs, n), P.evaluate(cs).score, cs.map(P.cardToString).join(' '));
  }
});

const equity = (hands, board, game) =>
  P.createEquityJob(hands.map((h) => (h ? cards(h) : null)), board ? cards(board) : [], game || 'nlhe').run();

test('exact hold\'em equity matches known results', () => {
  const r = equity(['As Ks', 'Qd Qc']); // a classic race
  assert.ok(r.exact);
  assert.equal(r.runouts, 1712304);
  assert.ok(Math.abs(r.players[0].equity - 0.4621) < 0.001);
  const flop = equity(['As Ah', 'Kd Kc'], 'Kh 7d 2c');
  assert.equal(flop.runouts, 990);
  assert.equal(flop.players[1].equity.toFixed(4), (905 / 990).toFixed(4)); // the aces mostly need one of the two remaining aces
  const total = flop.players[0].equity + flop.players[1].equity;
  assert.ok(Math.abs(total - 1) < 1e-9);
  // A chopped board: everyone plays the royal flush.
  const chop = equity(['2c 3d', '4h 5s'], 'As Ks Qs Js Ts');
  assert.deepEqual(chop.players.map((p) => p.equity), [0.5, 0.5]);
  assert.equal(chop.players[0].tie, 1);
});

test('equity against a random hand is simulated', () => {
  const r = equity(['As Ah', null]);
  assert.ok(!r.exact);
  assert.ok(Math.abs(r.players[0].equity - 0.852) < 0.01);
});

test('Omaha equity uses exactly two hole cards, and hi-lo splits the pot', () => {
  // Hold'em would give the ace-high flush; in Omaha the single heart can't play.
  const r = equity(['Ah Kc Qd Jc', '7s 7d 2c 3d'], '9h 5h 2h Th 7c', 'plo');
  assert.deepEqual(r.players.map((p) => p.equity), [0, 1]);
  // Player 1 has the only low and player 2 the high: an exact split.
  const split = equity(['As 2d Kc Kd', 'Qs Qd Jc Jh'], 'Qh 7c 4s 8d 9h', 'plo8');
  assert.deepEqual(split.players.map((p) => p.equity), [0.5, 0.5]);
  assert.equal(split.players[0].low, 1);
  assert.equal(split.players[1].high, 1);
  // No qualifying low: the high hand scoops.
  const scoop = equity(['As 2d Kc Kd', 'Qs Qd Jc Jh'], 'Qh Tc 4s 8d 9h', 'plo8');
  assert.deepEqual(scoop.players.map((p) => p.equity), [0, 1]);
  assert.equal(scoop.players[1].win, 1);
});

test('createEquityJob rejects bad input', () => {
  assert.throws(() => P.createEquityJob([cards('As Ks')], [], 'nlhe'), /two players/);
  assert.throws(() => P.createEquityJob([cards('As Ks'), cards('As Qd')], [], 'nlhe'), /twice/);
  assert.throws(() => P.createEquityJob([cards('As Ks'), cards('Qd Qc')], [], 'plo'), /exactly 4/);
});

test('boardChangeTags describes what a new card does to the board', () => {
  const tags = (board, card, hiLo) => P.boardChangeTags(cards(board), P.parseCard(card), hiLo);
  assert.deepEqual(tags('Ah Kh 7h', '2c'), ['blank']);
  assert.deepEqual(tags('Ah Kh 7h', 'Qh'), ['flush4', 'straight3']);
  assert.deepEqual(tags('Ah Kh 7h', '7c'), ['pair']);
  assert.deepEqual(tags('Ah Kh 7h 7c', 'Kd'), ['two-pair']);
  assert.deepEqual(tags('Ah Kh 7h 7c', '7d'), ['trips']);
  assert.deepEqual(tags('Ah Kh 7h 7c', 'Kd').includes('full-house'), false);
  assert.deepEqual(tags('Ah 7h 7c 7d', 'Ac'), ['full-house']);
  assert.deepEqual(tags('9c 4d 2s', 'Ks'), ['flush-draw', 'overcard']);
  // On a two-tone flop, two of a second suit is a second flush draw, not the first.
  assert.deepEqual(tags('Ah Kh 7c', '2c'), ['flush-draw-2']);
  assert.deepEqual(tags('Ah Kh 7c', '2h'), ['flush3']);
  assert.deepEqual(tags('Ah Kh 7c', '2d'), ['blank']);
  assert.deepEqual(tags('9c 4d 2s 8h', 'Kh'), ['overcard']); // no flush draw on the river
  assert.deepEqual(tags('9c 8d 2s', '7h'), ['straight3']);
  assert.deepEqual(tags('9c 8d 7s', '6h'), ['straight4']);
  assert.ok(tags('Kc 7d 2s', '5h', true).includes('low'));
  assert.ok(!tags('Kc 7d 2s', '5h', false).includes('low'));
});

test('runoutTree branches add up and match simple card counting', () => {
  const tree = P.runoutTree(cards('Ah Kh 7h'));
  assert.equal(tree.street, 'turn');
  assert.equal(tree.unseen, 49);
  assert.equal(tree.groups.reduce((n, g) => n + g.count, 0), 49);
  assert.equal(tree.tagTotals.pair, 9 / 49); // three each of A, K and 7
  assert.equal(tree.tagTotals.flush4, 10 / 49); // the ten other hearts
  let overall = 0;
  for (const g of tree.groups) {
    const given = g.river.reduce((n, r) => n + r.prob, 0);
    assert.ok(Math.abs(given - 1) < 1e-9);
    overall += g.river.reduce((n, r) => n + r.overall, 0);
  }
  assert.ok(Math.abs(overall - 1) < 1e-9);
  const turn = P.runoutTree(cards('Ah Kh 7h 2c'));
  assert.equal(turn.street, 'river');
  assert.equal(turn.unseen, 48);
  assert.equal(turn.groups[0].river, undefined);
  assert.throws(() => P.runoutTree(cards('Ah Kh 7h 2c 3d')), /flop or a turn/);
});

test('flopTextureOdds matches the known flop texture frequencies', () => {
  const odds = P.flopTextureOdds();
  const count = (suits, pairing) => odds.filter((o) => (!suits || o.suits === suits) && (!pairing || o.pairing === pairing))
    .reduce((n, o) => n + o.count, 0);
  assert.equal(count(), 22100);
  assert.equal(count('monotone'), 1144);
  assert.equal(count(null, 'paired'), 3744);
  assert.equal(count(null, 'trips'), 52);
  assert.equal(count('rainbow'), 8788);
});

test('every tell has complete guide content', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/tells.js'), 'utf8'), sandbox);
  const tells = sandbox.window.Tells.TELLS;
  assert.ok(tells.length >= 10);
  assert.equal(new Set(tells.map((t) => t.id)).size, tells.length);
  for (const t of tells) {
    assert.ok(['strong', 'weak'].includes(t.side), t.id);
    assert.ok([1, 2, 3].includes(t.reliability), t.id);
    for (const key of ['title', 'look', 'why', 'caveat', 'area']) assert.ok(t[key], t.id + ' ' + key);
  }
  assert.ok(tells.some((t) => t.side === 'strong') && tells.some((t) => t.side === 'weak'));
});

test('poker math helpers', () => {
  const M = require('../js/mathnotes.js');
  const half = M.potOdds(100, 50);
  assert.equal(half.ratio, 3);
  assert.equal(half.equity, 0.25);
  assert.equal(half.foldNeeded, 1 / 3);
  assert.equal(half.mdf, 2 / 3);
  assert.equal(M.potOdds(100, 100).equity, 1 / 3);
  // Nine outs: 19.1% on the turn, 35.0% by the river.
  assert.equal(M.outsEquity(9).turn.toFixed(3), '0.191');
  assert.equal(M.outsEquity(9).turnAndRiver.toFixed(3), '0.350');
  assert.equal(M.spr(97.5, 5.5).toFixed(1), '17.7');
  const d = M.stackDepth({ stack: 24000, sb: 500, bb: 1000, ante: 1000, players: 9, bbAnte: true });
  assert.equal(d.bbs, 24);
  assert.equal(d.m, 9.6);
  assert.ok(Math.abs(d.effectiveM - 8.64) < 1e-9);
  assert.equal(M.stackDepth({ stack: 9000, sb: 50, bb: 100, ante: 10, players: 9, bbAnte: false }).orbit, 240);
  // Geometric sizing: SPR 4 over two streets is pot-sized twice; the plan ends exactly all in.
  assert.ok(Math.abs(M.geometricFraction(10, 40, 2) - 1) < 1e-12);
  assert.equal(Math.round(M.geometricFraction(1, 4, 3) * 100), 54);
  const plan = M.geometricPlan(10, 45, 3);
  assert.ok(Math.abs(plan.rows[2].stackAfter) < 1e-9);
  const f = plan.fraction;
  plan.rows.forEach((r) => assert.ok(Math.abs(r.bet / r.pot - f) < 1e-9));
});

const L = require('../js/lowball.js');

test('2-7 lowball ranks hands with aces high and no wheel', () => {
  const v = (s) => L.value27(cards(s));
  assert.equal(L.lowTop(cards('7s 5d 4c 3h 2s')), 5);
  assert.equal(L.describe27(cards('7s 5d 4c 3h 2s')).name, 'Number one (the nuts)');
  assert.equal(L.lowTop(cards('As 2d 3c 4h 5s')), 12); // ace-high, not a straight
  assert.equal(L.lowTop(cards('2s 3d 4c 5h 6s')), L.NOT_LOW); // straight
  assert.equal(L.lowTop(cards('2s 4s 6s 8s 9s')), L.NOT_LOW); // flush
  assert.equal(L.lowTop(cards('9s 9d 4c 3h 2s')), L.NOT_LOW); // pair
  assert.ok(v('7s 5d 4c 3h 2s') < v('7s 6d 4c 3h 2s'));
  assert.ok(v('7s 6d 5c 4h 2s') < v('8s 5d 4c 3h 2s'));
  assert.ok(v('8s 5d 4c 3h 2s') < v('8s 6d 4c 3h 2s'));
  assert.ok(v('As Kd Qc Jh 9s') < v('2s 2d 3c 4h 5s')); // any unpaired hand beats a pair
  assert.ok(v('2s 2d 3c 4h 5s') < v('2s 3d 4c 5h 6s')); // a pair beats a straight
  assert.ok(v('2s 3d 4c 5h 6s') < v('2s 4s 6s 8s 9s')); // a straight beats a flush
});

test('2-7 single draw odds are exact', () => {
  // Drawing one to 7-4-3-2 (mixed suits): a 5 or 6 makes a 7, an 8 makes an 8, a 9 makes a 9.
  const kept = cards('7s 4d 3c 2h');
  const deck = [];
  for (let c = 0; c < 52; c++) if (!kept.includes(c)) deck.push(c);
  const o = L.singleDrawOdds(kept, deck);
  assert.equal(o['7'], 8 / 48);
  assert.equal(o['8'], 12 / 48);
  assert.equal(o['9'], 16 / 48);
  // Keeping a pair or a face card can never get there.
  assert.equal(L.singleDrawOdds(cards('7s 7d 3c 2h'), deck)['T'], 0);
  // A dealt hand: drawing one to 8-6-5-3 from 47 unseen cards.
  const options = L.analyzeHand(cards('8s 6d 5c 3h Ks'), 1);
  assert.equal(options.length, 32);
  const drawOne = options.find((x) => x.kept.length === 4 && !x.kept.includes(P.parseCard('Ks')));
  assert.equal(drawOne.probs['8'], 12 / 47); // a deuce, four or seven
  const pat = options.find((x) => x.draw === 0);
  assert.equal(pat.probs['T'], 0); // king-high
});

test('2-7 triple draw simulation and policy', () => {
  const hand = cards('7s 6d 5c 4h 3s'); // a straight: break the top card
  assert.deepEqual(L.policyKeep(hand, 5).map((i) => P.cardToString(hand[i])).sort(), ['3s', '4h', '5c', '6d']);
  const kept = cards('7s 5d 3c 2h');
  const deck = [];
  for (let c = 0; c < 52; c++) if (!kept.includes(c)) deck.push(c);
  // Twelve outs (4, 6, 8) per draw over three draws: about 1 - (36/48)^3 = 58%.
  const p = L.multiDrawOdds(kept, deck, 3, 6, 20000);
  assert.ok(Math.abs(p - (1 - Math.pow(36 / 48, 3))) < 0.02, String(p));
  const charts = require('../js/drawcharts.js');
  assert.equal(charts.entries.length, 246);
  assert.ok(charts.entries.every((e) => e.triple['T'] >= e.triple['7'] && e.single['T'] >= e.single['7']));
});

test('hold\'em ranges parse, count combos and write back compactly', () => {
  const count = (t) => P.parseRange(t).combos.length;
  assert.equal(count('JJ+'), 24);
  assert.equal(count('ATo+'), 48);
  assert.equal(count('A7s+'), 28);
  assert.equal(count('JJ+, ATo+, A7s+'), 100);
  assert.equal(count('22-55'), 24);
  assert.equal(count('A5s-A2s'), 16);
  assert.equal(count('KQ'), 16);
  assert.equal(count('T9s-65s'), 20);
  assert.equal(count('AsKs'), 1);
  assert.equal(count('any'), 1326);
  assert.equal(count('AKs, AKs, AsKs'), 4); // duplicates collapse
  assert.throws(() => P.parseRange('AXs'), /Couldn/);
  assert.throws(() => P.parseRange('AAs'), /pairs/);
  const text = (t) => P.rangeToText(P.parseRange(t).labels);
  assert.equal(text('JJ+, ATo+, A7s+'), 'JJ+, A7s+, ATo+');
  assert.equal(text('22-55, 99'), '99, 55-22');
  assert.equal(text('AJs+, AJo+'), 'AJ+');
  assert.equal(text('A5s-A2s, KQo'), 'A5s-A2s, KQo');
  // Round trip for every hand on the grid.
  assert.equal(P.parseRange(text('any')).combos.length, 1326);
});

test('equity with ranges', () => {
  const job = (hands, board) => P.createEquityJob(hands.map((h) => (h === null ? null : /^[2-9TJQKA][shdc]\s+[2-9TJQKA][shdc]$/i.test(h) ? cards(h) : { combos: P.parseRange(h).combos })),
    board ? cards(board) : [], 'nlhe');
  // A one-combo range behaves exactly like the hand.
  const a = job(['As Ah', 'Kd Kc'], 'Kh 7d 2c').run();
  const b = job(['AsAh', 'KdKc'], 'Kh 7d 2c').run();
  assert.equal(a.players[0].equity, b.players[0].equity);
  // Blockers: with the queen of spades on board, QQ has 3 combos left; every deal is counted.
  const q = job(['Ah Kh', 'QQ'], 'Qs 7d 2c 4h');
  assert.ok(q.exact);
  assert.deepEqual(q.liveCombos, [null, 3]);
  assert.equal(q.run().runouts, 3 * 44);
  // Range vs range exactly on the turn adds up to 100%.
  const rr = job(['JJ+', 'AKs'], 'Qs 7d 2c 4h').run();
  assert.ok(rr.exact);
  assert.ok(Math.abs(rr.players[0].equity + rr.players[1].equity - 1) < 1e-9);
  // Preflop ranges are simulated: AA vs KK is about 82%.
  const pre = job(['AA', 'KK']).run();
  assert.ok(!pre.exact);
  assert.ok(Math.abs(pre.players[0].equity - 0.82) < 0.01);
  assert.throws(() => P.createEquityJob([{ combos: P.parseRange('AA').combos }, null], [], 'plo'), /hold/);
});

const S = require('../js/stud.js');

test('razz and stud 8 lows', () => {
  const razz = (s) => S.razzValue(cards(s));
  assert.equal(S.describeRazz(razz('As 2d 3c 4h 5s Kd Kc')), '5-4-3-2-A');
  assert.equal(S.describeRazz(razz('8s 7d 6c 4h 2s Ad 3c')), '6-4-3-2-A');
  assert.equal(S.describeRazz(razz('Ks Kd Kc Qh Qs Jd Jc')), 'Paired');
  assert.ok(razz('As 2d 3c 4h 5s') < razz('As 2d 3c 4h 6s'));
  assert.ok(razz('Ks Qd Jc Th 9s') < razz('As Ad 2c 3h 4s')); // any unpaired hand beats a pair
  assert.ok(razz('2s 3s 4s 5s 6s') < razz('As 2d 3c 4h 7s')); // flushes and straights don't count
  assert.equal(S.lowMaskTop(S.eightLow(cards('As 2d 3c 4h 5s Kd Kc'))), 5);
  assert.equal(S.lowMaskTop(S.eightLow(cards('8s 7d 6c 4h 2s Kd Kc'))), 8);
  assert.equal(S.eightLow(cards('As 2d 3c 9h Ts Kd Kc')), Infinity);
});

test('stud hand odds by seventh street', () => {
  // Rolled-up trips make a full house or better about 40% of the time.
  const trips = S.analyzeHand(cards('7s 7d 7c'), [], 'stud');
  assert.equal(trips.runouts, 211876);
  assert.ok(Math.abs(trips.high[P.HAND.FULL_HOUSE] - 0.40) < 0.02);
  // Three different low cards in razz: two more different cards 8 or lower in four cards (48.3%).
  const razz = S.analyzeHand(cards('As 2d 3c'), [], 'razz');
  assert.equal(razz.low['8'].toFixed(4), '0.4827');
  // Dead cards matter: with the fours, fives and sixes gone, an 8-low is much harder.
  const dead = S.analyzeHand(cards('As 2d 3c'), cards('4s 4h 4d 4c 5s 5h 5d 5c 6s 6h'), 'razz');
  assert.ok(dead.low['8'] < razz.low['8'] - 0.2);
  assert.equal(S.describeStart(cards('Ks 4d Kc'), 'stud'), 'Split pair of kings (one shows)');
  assert.equal(S.describeStart(cards('9h 8h 7h'), 'stud'), 'Three to a straight flush (9-8-7)');
  assert.throws(() => S.analyzeHand(cards('As 2d 3c'), cards('As'), 'razz'), /twice/);
});

test('stud equity', () => {
  const eq = (ps, g) => S.createEquityJob(ps.map(cards), [], g).run();
  // Six cards each: 40 x 39 ways to finish, all checked; the made flush wins every time.
  const late = eq(['As Ad Kc Qd 7h 2s', 'Qh Jh Th 9h 2h 3c'], 'stud');
  assert.ok(late.exact);
  assert.equal(late.runouts, 40 * 39);
  assert.deepEqual(late.players.map((p) => p.equity), [0, 1]);
  // Seventh street, everything known: one deal.
  const done = eq(['As 2d 3c 4h 5s Kd Kc', '6s 6d 7c 8h 9s Qd Jc'], 'razz');
  assert.equal(done.runouts, 1);
  assert.deepEqual(done.players.map((p) => p.equity), [1, 0]);
  // Stud 8: wheel scoops (best low and a straight for high) against two pair.
  const split = eq(['As 2d 3c 4h 5s Kd Qc', 'Ks Kh Qd Qh 9s 9d 8c'], 'stud8');
  assert.deepEqual(split.players.map((p) => p.equity), [1, 0]);
  assert.equal(split.players[0].win, 1);
  const charts = require('../js/studcharts.js');
  assert.equal(charts.lowStarts.length, 120);
});
