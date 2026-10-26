#!/usr/bin/env node
/*
 * Builds docs/flop-runout-cheatsheet.pdf: exact, generic turn and river odds for each flop type,
 * laid out for memorizing. Needs Playwright with Chromium (used only to print the HTML to PDF).
 *
 *   node tools/build-runout-pdf.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/poker.js');
const { build, flopOdds } = require('./runout-sheet-data.js');

const d = build();
const pct = (x, digits) => (100 * x).toFixed(digits === undefined ? 1 : digits) + '%';
const oneIn = (x) => (x > 0 ? '1 in ' + (1 / x).toFixed(1) : '–');
const cards = (x, n) => Math.round(x * n);
const avg = (cls, part, key) => (d[cls][part][key] ? d[cls][part][key].avg : 0);
const range = (cls, part, key) => {
  const s = d[cls][part][key];
  return s && Math.abs(s.max - s.min) > 1e-9 ? pct(s.min, 0) + '–' + pct(s.max, 0) : '';
};

function row(event, p, n, note) {
  return '<tr><td>' + event + (note ? '<span class="note">' + note + '</span>' : '') + '</td>' +
    '<td class="num">' + (n === null ? '' : n) + '</td><td class="num big">' + pct(p) + '</td><td class="num muted">' + oneIn(p) + '</td></tr>';
}
function table(head, rows, unit) {
  return '<table><thead><tr><th>' + head + '</th><th class="num">' + (unit || 'Cards') + '</th><th class="num">Chance</th><th class="num">Odds</th></tr></thead><tbody>' +
    rows.join('') + '</tbody></table>';
}
function riverRow(event, p, note) {
  return row(event, p, cards(p, 1176), note);
}

// One flop type per row: its name, then the turn table and the by-the-river table side by side.
function typeCard(title, example, turnRows, riverRows) {
  return '<div class="typecard"><h4>' + title + ' <span class="ex">' + example + '</span></h4>' +
    table('Turn card', turnRows) + table('By the river', riverRows, 'Pairs') + '</div>';
}

// ---- Flop frequencies ----
const types = [
  ['rainbow', 'unpaired'], ['two-tone', 'unpaired'], ['monotone', 'unpaired'],
  ['rainbow', 'paired'], ['two-tone', 'paired'], ['rainbow', 'trips'],
];
const label = (s, p) => s[0].toUpperCase() + s.slice(1) + ', ' + p;
const freq = '<table class="freq"><thead><tr><th>Flop type</th><th class="num">Flops</th><th class="num">How often</th><th class="num">Odds</th></tr></thead><tbody>' +
  types.map(([s, p]) => { const c = d['type:' + s + '|' + p]; return '<tr><td>' + label(s, p) + '</td><td class="num">' + c.count.toLocaleString() + '</td><td class="num big">' + pct(c.share) + '</td><td class="num muted">' + oneIn(c.share) + '</td></tr>'; }).join('') +
  '<tr class="total"><td>Rainbow / two-tone / monotone</td><td></td><td class="num" colspan="2">' + ['rainbow', 'two-tone', 'monotone'].map((s) => pct(d['suit:' + s].share)).join(' / ') + '</td></tr>' +
  '<tr class="total"><td>Unpaired / paired / trips</td><td></td><td class="num" colspan="2">' + ['unpaired', 'paired', 'trips'].map((s) => pct(d['pair:' + s].share)).join(' / ') + '</td></tr>' +
  '</tbody></table>';

// ---- Suits ----
const T = (cls, key) => avg(cls, 'turn', key);
const R = (cls, key) => avg(cls, 'river', key);
const suits =
  typeCard('Rainbow flop', 'K\u2660 8\u2665 3\u2666', [
    row('Goes two-tone (matches a flop suit)', T('suit:rainbow', 'twoTone'), 36),
    row('Fourth suit (stays rainbow)', T('suit:rainbow', 'newSuit'), 13),
  ], [
    riverRow('Flush possible (runner-runner)', R('suit:rainbow', 'flush3plus')),
  ]) +
  typeCard('Two-tone flop', 'K\u2665 8\u2665 3\u2666', [
    row('Third card of the suit: flush possible', T('suit:two-tone', 'flush3'), 11),
    row('Second card of the other suit (2nd flush draw)', T('suit:two-tone', 'secondDraw'), 12),
    row('Neither suit', T('suit:two-tone', 'newSuit'), 26),
  ], [
    riverRow('Flush possible', R('suit:two-tone', 'flush3plus')),
    riverRow('Four of the suit on board', R('suit:two-tone', 'flush4plus')),
  ]) +
  typeCard('Monotone flop', 'K\u2665 8\u2665 3\u2665', [
    row('Fourth of the suit: four-flush', T('suit:monotone', 'flush4'), 10),
    row('Off-suit', T('suit:monotone', 'newSuit'), 39),
  ], [
    riverRow('Four or five of the suit', R('suit:monotone', 'flush4plus')),
    riverRow('Five of the suit (board flush)', R('suit:monotone', 'flush5')),
  ]);

// ---- Pairing ----
const pairs =
  typeCard('Unpaired flop', 'K 8 3', [
    row('Pairs the board', T('pair:unpaired', 'pairs'), 9),
  ], [
    riverRow('Board paired (or better)', R('pair:unpaired', 'paired')),
    riverRow('Two pair on board', R('pair:unpaired', 'twoPair')),
    riverRow('Trips on board', R('pair:unpaired', 'tripsPlus')),
  ]) +
  typeCard('Paired flop', 'K K 3', [
    row('Trips on board (a case king)', T('pair:paired', 'tripsBoard'), 2),
    row('Pairs the 3: two pair on board', T('pair:paired', 'twoPairBoard'), 3),
  ], [
    riverRow('Trips (or better) on board', R('pair:paired', 'tripsPlus')),
    riverRow('Two pair on board', R('pair:paired', 'twoPair')),
    riverRow('Full house on board', R('pair:paired', 'fullHouse')),
  ]) +
  typeCard('Trips flop', 'K K K', [
    row('Quads on board', T('pair:trips', 'quads'), 1),
  ], [
    riverRow('Quads on board', R('pair:trips', 'quads')),
    riverRow('Full house on board', R('pair:trips', 'fullHouse')),
  ]);

// ---- Straights ----
const conn = [
  ['conn:3', 'Straight already possible', '9-8-6, J-T-7, 5-4-A', [['Four to a straight on the turn', 'turn', 'fourStraight'], ['Four to a straight by the river', 'river', 'fourStraight'], ['Five-card straight on board by the river', 'river', 'straightOnBoard']]],
  ['conn:2', 'Two cards connect', 'K-8-7, Q-9-3, A-T-4', [['Turn makes a straight possible', 'turn', 'straightPossible'], ['Straight possible by the river', 'river', 'straightPossible'], ['Four to a straight by the river', 'river', 'fourStraight']]],
  ['conn:1', 'Nothing connects', 'K-7-2, Q-7-2, A-8-3', [['Straight possible by the river', 'river', 'straightPossible']]],
];
const connTable = '<table><thead><tr><th>Unpaired flop</th><th class="num">How often</th><th>Event</th><th class="num">Average</th><th class="num">Range</th></tr></thead><tbody>' +
  conn.map(([cls, name, ex, events]) => events.map(([ev, part, key], i) =>
    '<tr' + (i === 0 ? ' class="group"' : '') + '>' + (i === 0 ? '<td rowspan="' + events.length + '"><strong>' + name + '</strong><span class="note">e.g. ' + ex + '</span></td><td class="num" rowspan="' + events.length + '">' + pct(d[cls].count / d['pair:unpaired'].count) + '</td>' : '') +
    '<td>' + ev + '</td><td class="num big">' + pct(avg(cls, part, key)) + '</td><td class="num muted">' + range(cls, part, key) + '</td></tr>').join('')).join('') +
  '</tbody></table>';

const gapExamples = [
  ['Touching (8-7)', '2c 8h 7d', 24],
  ['One gap (9-7)', '2c 9h 7d', 20],
  ['Two gaps (T-7)', '2c Th 7d', 16],
  ['Three gaps (J-7)', '2c Jh 7d', 12],
];
const gapTable = '<table><thead><tr><th>Two connecting cards</th><th class="num">Turn cards</th><th class="num">Turn</th><th class="num">By the river</th></tr></thead><tbody>' +
  gapExamples.map(([name, flop, n]) => {
    const o = flopOdds(P.parseCards(flop));
    return '<tr><td>' + name + '<span class="note">flop ' + flop.split(' ').map((c) => c[0]).join('-') + '</span></td><td class="num">' + n + '</td><td class="num big">' + pct(o.turn.straightPossible) + '</td><td class="num">' + pct(o.river.straightPossible) + '</td></tr>';
  }).join('') + '</tbody></table>';

// ---- Summary by flop type ----
// One card per flop type: how often it comes, then four labelled numbers.
const stat = (label, desc, p) => '<div class="stat"><span class="lbl">' + label + '</span><span class="val">' + desc + ' <b>' + p + '</b></span></div>';
const summaryRows = [
  ['rainbow', 'unpaired', ['Two-tone', pct(T('suit:rainbow', 'twoTone'))], ['Pairs', pct(T('pair:unpaired', 'pairs'))], ['Flush possible', pct(R('suit:rainbow', 'flush3plus'))], ['Paired', pct(R('pair:unpaired', 'paired'))]],
  ['two-tone', 'unpaired', ['Flush possible', pct(T('suit:two-tone', 'flush3'))], ['Pairs', pct(T('pair:unpaired', 'pairs'))], ['Flush possible', pct(R('suit:two-tone', 'flush3plus'))], ['Paired', pct(R('pair:unpaired', 'paired'))]],
  ['monotone', 'unpaired', ['Four-flush', pct(T('suit:monotone', 'flush4'))], ['Pairs', pct(T('pair:unpaired', 'pairs'))], ['Four-flush+', pct(R('suit:monotone', 'flush4plus'))], ['Paired', pct(R('pair:unpaired', 'paired'))]],
  ['rainbow', 'paired', ['Two-tone', pct(T('suit:rainbow', 'twoTone'))], ['Trips', pct(T('pair:paired', 'tripsBoard'))], ['Flush possible', pct(R('suit:rainbow', 'flush3plus'))], ['Trips+', pct(R('pair:paired', 'tripsPlus'))]],
  ['two-tone', 'paired', ['Flush possible', pct(T('suit:two-tone', 'flush3'))], ['Trips', pct(T('pair:paired', 'tripsBoard'))], ['Flush possible', pct(R('suit:two-tone', 'flush3plus'))], ['Trips+', pct(R('pair:paired', 'tripsPlus'))]],
  ['rainbow', 'trips', ['Two-tone', pct(T('suit:rainbow', 'twoTone'))], ['Quads', pct(T('pair:trips', 'quads'))], ['Flush possible', pct(R('suit:rainbow', 'flush3plus'))], ['Quads', pct(R('pair:trips', 'quads'))]],
];
const summary = summaryRows.map(([s, p, tf, tp, rf, rp]) =>
  '<div class="sumcard"><div class="sum-name"><strong>' + label(s, p) + '</strong><span>' + pct(d['type:' + s + '|' + p].share) + ' of flops</span></div>' +
  '<div class="sum-stats">' + stat('Turn &middot; flush', tf[0], tf[1]) + stat('Turn &middot; pairing', tp[0], tp[1]) +
  stat('River &middot; flush', rf[0], rf[1]) + stat('River &middot; pairing', rp[0], rp[1]) + '</div></div>').join('') +
  '<p class="muted">&ldquo;River&rdquo; means by the river (after both the turn and river). Paired flops can also become two pair on board: ' + pct(T('pair:paired', 'twoPairBoard')) + ' on the turn.</p>';

// ---- Test yourself ----
const quiz = [
  ['Turn pairs an unpaired flop', pct(T('pair:unpaired', 'pairs')) + ' (9 cards)'],
  ['Unpaired flop is paired by the river', pct(R('pair:unpaired', 'paired'))],
  ['Two-tone flop: turn is a third flush card', pct(T('suit:two-tone', 'flush3')) + ' (11 cards)'],
  ['Two-tone flop: flush possible by the river', pct(R('suit:two-tone', 'flush3plus'))],
  ['Rainbow flop: flush possible by the river', pct(R('suit:rainbow', 'flush3plus'))],
  ['Monotone flop: turn is a fourth flush card', pct(T('suit:monotone', 'flush4')) + ' (10 cards)'],
  ['Monotone flop: four or more of the suit by the river', pct(R('suit:monotone', 'flush4plus'))],
  ['Paired flop: turn makes trips on board', pct(T('pair:paired', 'tripsBoard')) + ' (2 cards)'],
  ['Paired flop: trips or better by the river', pct(R('pair:paired', 'tripsPlus'))],
  ['Touching cards (8-7): turn makes a straight possible', '49.0% (24 cards)'],
  ['Straight-possible flop: turn gives four to a straight', pct(avg('conn:3', 'turn', 'fourStraight')) + ' on average'],
  ['How often is the flop two-tone?', pct(d['suit:two-tone'].share)],
  ['How often is the flop paired?', pct(d['pair:paired'].share)],
  ['How often is the flop monotone?', pct(d['suit:monotone'].share)],
];
const quizTable = '<table class="quiz"><thead><tr><th>#</th><th>Question</th><th class="num">Answer (cover me)</th></tr></thead><tbody>' +
  quiz.map(([q, a], i) => '<tr><td class="muted">' + (i + 1) + '</td><td>' + q + '</td><td class="num big">' + a + '</td></tr>').join('') + '</tbody></table>';

// Every page is a fixed-height sheet; before printing, each sheet's text is grown to the largest
// size that still fits (see fitPages below), so pages fill up and read well on a phone.
const sheets = [
  `<h1>Flop runout cheat sheet</h1>
<p class="sub">Exact turn and river odds for every kind of flop &middot; Texas hold’em (and any game with a flop, turn and river)</p>
<div class="box">
  <p><strong>How to read it.</strong> Turn odds count the 49 cards not on the flop; river odds (&ldquo;by the river&rdquo;) count all 1,176 possible turn + river pairs. The board is all that’s known: hole cards aren’t removed, so each relevant card in your own hand moves a turn number by about 2%.</p>
  <p><strong>Suit and pairing odds are the same for every flop of that type</strong>, which is what makes them worth memorizing. Straight odds depend on the ranks, so they’re given as averages with a range.</p>
</div>
<div class="anchor">
  <div><strong>2.04%</strong><span>each turn card (1 in 49)</span></div>
  <div><strong>9 cards</strong><span>pair an unpaired flop: 18.4%</span></div>
  <div><strong>11 cards</strong><span>third flush card on two-tone: 22.4%</span></div>
  <div><strong>10 cards</strong><span>four-flush on monotone: 20.4%</span></div>
</div>
<h2>1 &middot; How often each flop comes</h2>
${freq}
<div class="box"><p><strong>Out of 22,100 possible flops.</strong> More than half of all flops are two-tone, and about 1 in 6 is paired. Monotone flops come about 1 time in 19; trips about 1 in 425. Every number in this sheet is exact, counted over every flop, turn and river.</p></div>`,
  `<h2>2 &middot; Flush runouts</h2>${suits}`,
  `<h2>3 &middot; Pairing runouts</h2>${pairs}`,
  `<h2>4 &middot; Straight runouts</h2>
<p>Straight odds depend on how connected the ranks are, so these are averages over every unpaired flop of each kind, with the lowest and highest value in that group. &ldquo;Straight possible&rdquo; means three board cards fit in one five-card straight, so two hole cards can make it.</p>
${connTable}
<h4>Counting rule for two connecting cards</h4>
<p>With exactly two flop cards that could share a straight, in the middle of the deck, the turn makes a straight possible with <strong>4 cards for each rank that fits</strong>: 24 cards when they touch, then 4 fewer for each gap.</p>
${gapTable}`,
  `<h2>5 &middot; One line per flop type</h2>${summary}`,
  `<h2>Memory tips</h2>
<ul>
  <li><strong>Count cards, then double:</strong> on the turn each card is about 2% (exactly 2.04%). 9 cards &asymp; 18%, 11 &asymp; 22%, 12 &asymp; 24.5%, 36 &asymp; 73.5%.</li>
  <li><strong>The board pairs by the river about 39% of the time</strong> (38.8%) on any unpaired flop, roughly 2 times in 5.</li>
  <li><strong>Two-tone flops bring a flush-possible board by the river 45.8% of the time</strong>, nearly half; rainbow flops only 16.8% (runner-runner), about 1 in 6.</li>
  <li><strong>Monotone flops:</strong> the turn is a fourth flush card 1 time in 5 (20.4%); by the river a fourth (or fifth) flush card lands 37% of the time.</li>
  <li><strong>Paired flops:</strong> the case card (trips) arrives 4.1% on the turn and 8.3% by the river; the board becomes two pair 6.1% on the turn.</li>
</ul>
<div class="box"><p><strong>Study tip:</strong> learn the card counts (9, 11, 10, 12, 36 on the turn) and the four &ldquo;by the river&rdquo; anchors: <strong>38.8%</strong> paired, <strong>45.8%</strong> two-tone flush, <strong>16.8%</strong> rainbow flush, <strong>37%</strong> monotone four-flush. Most other numbers follow from them.</p></div>`,
  `<h2>Test yourself</h2>
<p class="muted">Cover the right-hand column and answer from memory.</p>
${quizTable}
<p class="foot">Generated by tools/build-runout-pdf.js in the Poker Board Analyzer project. All figures are exact counts over 22,100 flops, 49 turn cards and 1,176 turn + river pairs per flop.</p>`,
];

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Flop Runout Cheat Sheet</title><style>
@page { size: Letter; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1d2125; line-height: 1.35; margin: 0; }
/* Sizes are in em so one font size per page scales everything on it. */
.sheet { height: 254mm; overflow: hidden; break-after: page; }
.sheet:last-child { break-after: auto; }
.fit { font-size: 12px; }
h1 { font-size: 2.1em; margin: 0; letter-spacing: -0.01em; }
.sub { color: #5b6168; margin: 0.2em 0 0.9em; font-size: 1.1em; }
h2 { font-size: 1.4em; margin: 0 0 0.5em; padding-bottom: 0.2em; border-bottom: 2px solid #127a4f; color: #127a4f; }
.fit > h2:not(:first-child), .fit > h4 { margin-top: 1em; }
h4 { margin: 0 0 0.3em; font-size: 1.1em; }
p { margin: 0 0 0.6em; }
.ex { font-weight: 400; color: #5b6168; font-size: 0.95em; }
table { width: 100%; border-collapse: collapse; margin: 0 0 0.6em; }
th { text-align: left; font-size: 0.78em; color: #5b6168; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.3em 0.4em; border-bottom: 1px solid #cfd2cc; }
td { padding: 0.35em 0.4em; border-bottom: 1px solid #ecede9; vertical-align: top; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.big { font-weight: 700; font-size: 1.1em; color: #127a4f; }
.muted { color: #6b7178; }
.note { display: block; color: #6b7178; font-size: 0.8em; }
tr.total td { font-size: 0.9em; color: #3d4248; border-bottom: 0; }
tr.group td { border-top: 1.5px solid #cfd2cc; }
.typecard { border: 1px solid #dfe1dc; border-radius: 0.5em; padding: 0.6em 0.8em 0.1em; margin-bottom: 0.8em; }
.typecard h4 { margin: 0 0 0.3em; }
.typecard table { margin-bottom: 0.5em; }
.sumcard { display: grid; grid-template-columns: 8.5em 1fr; gap: 0.8em; align-items: center; border: 1px solid #dfe1dc; border-radius: 0.5em; padding: 0.6em 0.8em; margin-bottom: 0.6em; }
.sum-name span { display: block; color: #6b7178; font-size: 0.85em; }
.sum-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5em; }
.stat { background: #f4f6f3; border-radius: 0.4em; padding: 0.35em 0.5em; }
.stat .lbl { display: block; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7178; }
.stat .val { font-size: 0.9em; }
.stat b { display: block; color: #127a4f; font-size: 1.25em; white-space: nowrap; }
.box { background: #f1f6f2; border-left: 4px solid #127a4f; border-radius: 4px; padding: 0.6em 0.9em; margin: 0.7em 0; }
.box p:last-child { margin-bottom: 0; }
.anchor { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.7em; margin: 0.7em 0 1em; }
.anchor div { border: 1px solid #dfe1dc; border-radius: 0.5em; padding: 0.5em 0.6em; text-align: center; }
.anchor strong { display: block; font-size: 1.6em; color: #127a4f; }
.anchor span { font-size: 0.85em; color: #5b6168; }
.quiz td { padding-top: 0.45em; padding-bottom: 0.45em; }
ul { margin: 0.3em 0 0.6em 1.2em; padding: 0; }
li { margin-bottom: 0.35em; }
.foot { color: #8a9096; font-size: 0.75em; margin-top: 0.8em; }
</style></head><body>
${sheets.map((h) => '<section class="sheet"><div class="fit">' + h + '</div></section>').join('\n')}
</body></html>`;

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'flop-runout-cheatsheet.html'), html);

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.error('Playwright is needed to print the PDF; the HTML was written to docs/flop-runout-cheatsheet.html.');
    process.exit(1);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  // Lay out at the printed page width, then grow each page's text as far as it will go.
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: Math.round((215.9 - 24) / 25.4 * 96), height: 1200 });
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.sheet')].map((sheet) => {
    const fit = sheet.querySelector('.fit');
    let lo = 8;
    let hi = 34; // cap so a short page doesn't get comically large
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      fit.style.fontSize = mid + 'px';
      if (fit.scrollHeight <= sheet.clientHeight && fit.scrollWidth <= sheet.clientWidth + 1) lo = mid;
      else hi = mid;
    }
    fit.style.fontSize = lo + 'px';
    return Math.round(lo * 10) / 10;
  }));
  console.error('font size per page (px): ' + sizes.join(', '));
  await page.pdf({ path: path.join(outDir, 'flop-runout-cheatsheet.pdf'), format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.error('wrote docs/flop-runout-cheatsheet.pdf');
})();
