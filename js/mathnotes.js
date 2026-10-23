/*
 * Poker math notes: pot odds, SPR, stack depth (BB and M) and geometric bet sizing.
 * The math functions at the top have no DOM access, so tests can load them in Node.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Math
  // ---------------------------------------------------------------------------

  // Facing `bet` into `pot` (the pot before the bet).
  function potOdds(pot, bet) {
    return {
      ratio: (pot + bet) / bet, // "x : 1"
      equity: bet / (pot + 2 * bet), // caller's break-even equity
      foldNeeded: bet / (pot + bet), // how often a pure bluff must work
      mdf: pot / (pot + bet), // minimum defense frequency
    };
  }

  function choose2(n) {
    return n * (n - 1) / 2;
  }

  // Chance to hit one of `outs` with the next card, or with either of the next two (from the flop).
  function outsEquity(outs) {
    return {
      turn: outs / 47,
      river: outs / 46,
      turnAndRiver: 1 - choose2(47 - outs) / choose2(47),
    };
  }

  const spr = (stack, pot) => stack / pot;

  // Harrington's M: how many orbits the stack survives. Effective M scales by table size.
  function stackDepth({ stack, sb, bb, ante, players, bbAnte }) {
    const orbit = sb + bb + (bbAnte ? ante : ante * players);
    const m = stack / orbit;
    return { bbs: stack / bb, orbit, m, effectiveM: m * players / 10 };
  }

  // Bet the same fraction of the pot on each of `streets` streets so the last bet is all-in.
  function geometricFraction(pot, stack, streets) {
    return (Math.pow(1 + 2 * stack / pot, 1 / streets) - 1) / 2;
  }

  function geometricPlan(pot, stack, streets) {
    const f = geometricFraction(pot, stack, streets);
    const rows = [];
    let p = pot;
    let s = stack;
    for (let i = 0; i < streets; i++) {
      const bet = i === streets - 1 ? s : f * p; // last bet is exactly the rest
      rows.push({ pot: p, bet, stackAfter: s - bet });
      p += 2 * bet;
      s -= bet;
    }
    return { fraction: f, rows, finalPot: p };
  }

  // ---------------------------------------------------------------------------
  // Reference content
  // ---------------------------------------------------------------------------

  const SPR_BANDS = [
    { max: 1, label: 'Under 1', color: '#c0353c', text: 'Committed. Any pair or decent draw gets it in; folding is rarely right.' },
    { max: 3, label: '1–3', color: '#eb6834', text: 'Top pair good kicker and overpairs are happy to get all in.' },
    { max: 6, label: '3–6', color: '#eda100', text: 'Top pair becomes a bluff-catcher for big pots. Two pair, sets and strong draws want to stack off.' },
    { max: 13, label: '6–13', color: '#1baf7a', text: 'Typical single-raised pots. Stacking off usually needs two pair or better; set-mining and suited connectors gain value.' },
    { max: Infinity, label: '13+', color: '#2a78d6', text: 'Deep. Play for stacks with the nuts or near-nuts; position and implied odds matter most.' },
  ];

  const M_ZONES = [
    { max: 1, label: 'Dead', range: 'M < 1', color: '#7a1f24', text: 'Move all in at the first chance; even folding into the blinds costs most of the stack.' },
    { max: 6, label: 'Red', range: 'M 1–6', color: '#c0353c', text: 'Push or fold. Shove first in with a wide range; never limp or min-raise.' },
    { max: 10, label: 'Orange', range: 'M 6–10', color: '#eb6834', text: 'Speculative hands lose value. Raise-or-fold first in, and shove over opens to re-steal.' },
    { max: 20, label: 'Yellow', range: 'M 10–20', color: '#eda100', text: 'Tighten speculative hands, steal blinds more, avoid big calls off.' },
    { max: Infinity, label: 'Green', range: 'M 20+', color: '#1baf7a', text: 'Full range of plays: set-mining, suited connectors, small-ball postflop poker.' },
  ];

  const BB_BANDS = [
    { max: 10, label: 'Under 10bb', color: '#c0353c', text: 'Push or fold (use a Nash push/fold chart).' },
    { max: 15, label: '10–15bb', color: '#eb6834', text: 'Open-shove and re-shove over opens; very few small raises.' },
    { max: 25, label: '15–25bb', color: '#eda100', text: 'Min-raise or shove first in; 3-bet shoving over late opens is the main weapon.' },
    { max: 40, label: '25–40bb', color: '#1baf7a', text: 'Standard opens; 3-bets start to commit you, so plan to 3-bet/shove or 3-bet/fold.' },
    { max: Infinity, label: '40bb+', color: '#2a78d6', text: 'Deep-stacked play: flat calls, small 3-bets and postflop maneuvering.' },
  ];

  const SPOTS = [
    { name: 'Single-raised pot: BTN opens 2.5bb, BB calls', pot: 2.5 + 2.5 + 0.5, stack: 97.5 },
    { name: 'Single-raised pot: CO opens 3bb, BTN calls', pot: 3 + 3 + 1.5, stack: 97 },
    { name: '3-bet pot in position: 3bb open, 9bb 3-bet, called', pot: 9 + 9 + 1.5, stack: 91 },
    { name: '3-bet pot out of position: BB 3-bets BTN to 11bb', pot: 11 + 11 + 0.5, stack: 89 },
    { name: '4-bet pot: 22bb 4-bet, called', pot: 22 + 22 + 1.5, stack: 78 },
  ];

  const DRAWS = {
    2: 'Pocket pair to a set',
    4: 'Gutshot',
    6: 'Two overcards',
    8: 'Open-ended straight draw',
    9: 'Flush draw',
    12: 'Flush draw + gutshot',
    15: 'Flush draw + open-ender',
  };

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  const pct = (x, d) => (100 * x).toFixed(d === undefined ? 1 : d) + '%';
  const num = (x, d) => (Number.isFinite(x) ? x.toFixed(d === undefined ? 1 : d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '–');

  function field(id, label, value, step, min) {
    return '<label class="mn-field">' + label +
      '<input type="number" id="' + id + '" value="' + value + '" step="' + (step || 'any') + '" min="' + (min === undefined ? 0 : min) + '" inputmode="decimal"></label>';
  }

  const val = (id) => {
    const v = parseFloat(document.getElementById(id).value);
    return Number.isFinite(v) ? v : 0;
  };

  // A zone strip with a marker. `bands` are ordered by `max`; positions are spread evenly per band.
  function bandStrip(bands, value) {
    const idx = bands.findIndex((b) => value < b.max);
    const lo = idx > 0 ? bands[idx - 1].max : 0;
    const hi = bands[idx].max;
    const within = Number.isFinite(hi) ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : Math.min(1, (value - lo) / Math.max(lo, 1) * 0.5);
    const pos = ((idx + within) / bands.length) * 100;
    return '<div class="mn-strip">' + bands.map((b, i) =>
      '<span class="mn-zone' + (i === idx ? ' active' : '') + '" style="--zone:' + b.color + '">' + b.label + '</span>').join('') +
      (value > 0 && Number.isFinite(value) ? '<span class="mn-marker" style="left:' + pos.toFixed(1) + '%"></span>' : '') + '</div>';
  }

  // A small SVG line chart with direct labels, a legend, and a crosshair tooltip.
  // opts: { x: [min, max], y: [min, max], series: [{ name, color, fn }], xFmt, yFmt, xTitle, yTitle, markerX, steps }
  function lineChart(el, opts) {
    // Draw at the container's real width so text stays a readable size on phones.
    const W = Math.max(320, Math.min(760, el.clientWidth || 640));
    const narrow = W < 520;
    const H = narrow ? 230 : 270, L = 44, R = narrow ? 92 : 132, T = 14, B = 40;
    const xTicks = narrow ? opts.xTicks.filter((t, i) => i % 2 === 0) : opts.xTicks;
    const sx = (x) => L + (x - opts.x[0]) / (opts.x[1] - opts.x[0]) * (W - L - R);
    const sy = (y) => T + (1 - (y - opts.y[0]) / (opts.y[1] - opts.y[0])) * (H - T - B);
    const steps = opts.steps || 120;
    const xs = Array.from({ length: steps + 1 }, (_, i) => opts.x[0] + (opts.x[1] - opts.x[0]) * i / steps);
    const yTicks = opts.yTicks;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mn-chart" role="img" aria-label="' + opts.label + '">';
    for (const t of yTicks) {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '"/>' +
        '<text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + opts.yFmt(t) + '</text>';
    }
    for (const t of xTicks) {
      svg += '<text class="tick" x="' + sx(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + opts.xFmt(t) + '</text>';
    }
    svg += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    svg += '<text class="axis-title" x="' + ((L + W - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + opts.xTitle + '</text>';

    // Direct labels at the right end, nudged apart so they don't collide.
    const ends = opts.series.map((s) => ({ s, y: sy(Math.min(opts.y[1], s.fn(opts.x[1]))) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;

    for (const s of opts.series) {
      const d = xs.map((x, i) => (i ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(Math.min(opts.y[1], s.fn(x))).toFixed(1)).join(' ');
      svg += '<path class="line" d="' + d + '" stroke="' + s.color + '"/>';
    }
    for (const e of ends) {
      svg += '<text class="direct" x="' + (W - R + 8) + '" y="' + (e.y + 4) + '">' + (narrow && e.s.short ? e.s.short : e.s.name) + '</text>';
    }
    if (opts.markerX !== undefined && opts.markerX >= opts.x[0] && opts.markerX <= opts.x[1]) {
      const mx = sx(opts.markerX);
      svg += '<line class="you" x1="' + mx + '" x2="' + mx + '" y1="' + T + '" y2="' + (H - B) + '"/>';
      for (const s of opts.series) {
        svg += '<circle class="you-dot" cx="' + mx + '" cy="' + sy(Math.min(opts.y[1], s.fn(opts.markerX))) + '" r="5" fill="' + s.color + '"/>';
      }
    }
    svg += '<line class="crosshair" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/>';
    svg += '<rect class="hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/>';
    svg += '</svg>';

    el.innerHTML = '<div class="mn-legend">' + opts.series.map((s) =>
      '<span><i style="background:' + s.color + '"></i>' + s.name + '</span>').join('') + '</div>' +
      '<div class="mn-chart-wrap">' + svg + '<div class="mn-tip" hidden></div></div>';

    const svgEl = el.querySelector('svg');
    const cross = svgEl.querySelector('.crosshair');
    const tip = el.querySelector('.mn-tip');
    const move = (e) => {
      const box = svgEl.getBoundingClientRect();
      const px = (e.clientX - box.left) / box.width * W;
      const x = Math.min(opts.x[1], Math.max(opts.x[0], opts.x[0] + (px - L) / (W - L - R) * (opts.x[1] - opts.x[0])));
      const snapped = opts.snap ? opts.snap(x) : x;
      cross.setAttribute('x1', sx(snapped));
      cross.setAttribute('x2', sx(snapped));
      cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.textContent = '';
      const head = document.createElement('div');
      head.className = 'mn-tip-head';
      head.textContent = opts.xTitle + ': ' + opts.xFmt(snapped);
      tip.appendChild(head);
      for (const s of opts.series) {
        const row = document.createElement('div');
        const key = document.createElement('i');
        key.style.background = s.color;
        const strong = document.createElement('strong');
        strong.textContent = opts.yFmt(s.fn(snapped), true);
        row.append(key, strong, document.createTextNode(' ' + s.name));
        tip.appendChild(row);
      }
      const left = sx(snapped) / W * box.width;
      tip.style.left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
    };
    const leave = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    const hit = svgEl.querySelector('.hit');
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', leave);
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

  function potOddsSection() {
    const sizes = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2];
    const outs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    return '<section class="mn-section" id="mn-potodds">' +
      '<h3>Pot odds &amp; break-even equity</h3>' +
      '<div class="mn-notes">' +
        '<p>When you face a bet, you risk the call to win everything in the middle. You break even when your equity equals your share of the final pot:</p>' +
        '<p class="mn-formula">Equity needed = call &divide; (pot + bet + call)</p>' +
        '<p>The same bet seen from the bettor’s side: a pure bluff of size <em>B</em> into pot <em>P</em> profits if it works more than <strong>B &divide; (P + B)</strong> of the time. To stop that, the defender must continue with at least <strong>P &divide; (P + B)</strong> of their range: the <em>minimum defense frequency</em> (MDF).</p>' +
      '</div>' +
      '<div class="mn-calc">' +
        field('po-pot', 'Pot before the bet', 100, 1) + field('po-bet', 'Bet to call', 50, 1) +
        '<div class="mn-out" id="po-out"></div>' +
      '</div>' +
      '<div class="mn-figure"><p class="mn-figure-title">What each bet size asks for</p><div id="po-chart"></div></div>' +
      '<div class="mn-table-wrap"><table class="mn-table"><thead><tr><th>Bet (% of pot)</th><th>Pot odds</th><th>Caller needs equity</th><th>Bluff needs folds</th><th>MDF</th></tr></thead><tbody>' +
        sizes.map((s) => {
          const o = potOdds(1, s);
          return '<tr><td>' + Math.round(s * 100) + '%</td><td>' + num(o.ratio, 2) + ' : 1</td><td>' + pct(o.equity) + '</td><td>' + pct(o.foldNeeded) + '</td><td>' + pct(o.mdf) + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<h4>Outs to equity (from the flop)</h4>' +
      '<p class="hint">Exact odds, with the quick <strong>rule of 2 and 4</strong>: outs &times; 2 for one card, outs &times; 4 for two cards (it overstates big draws, so subtract a little past 8 outs).</p>' +
      '<div class="mn-table-wrap"><table class="mn-table"><thead><tr><th>Outs</th><th>Typical draw</th><th>Turn</th><th>River (from turn)</th><th>Turn or river</th><th>Rule of 4</th></tr></thead><tbody>' +
        outs.map((o) => {
          const e = outsEquity(o);
          return '<tr' + (DRAWS[o] ? ' class="mn-key"' : '') + '><td>' + o + '</td><td>' + (DRAWS[o] || '') + '</td><td>' + pct(e.turn) + '</td><td>' + pct(e.river) + '</td><td>' + pct(e.turnAndRiver) + '</td><td>' + (o * 4) + '%</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '</section>';
  }

  function updatePotOdds() {
    const pot = val('po-pot');
    const bet = val('po-bet');
    const out = document.getElementById('po-out');
    if (pot <= 0 || bet <= 0) {
      out.innerHTML = '<p class="hint">Enter a pot and a bet above zero.</p>';
      return;
    }
    const o = potOdds(pot, bet);
    out.innerHTML =
      '<div class="mn-stat"><span>Pot odds</span><strong>' + num(o.ratio, 2) + ' : 1</strong></div>' +
      '<div class="mn-stat"><span>Equity needed to call</span><strong>' + pct(o.equity) + '</strong></div>' +
      '<div class="mn-stat"><span>Bluff needs folds</span><strong>' + pct(o.foldNeeded) + '</strong></div>' +
      '<div class="mn-stat"><span>MDF</span><strong>' + pct(o.mdf) + '</strong></div>' +
      '<p class="mn-sentence">Calling ' + num(bet) + ' to win ' + num(pot + bet) + ' needs at least <strong>' + pct(o.equity) + '</strong> equity. ' +
      'That bet is ' + Math.round(100 * bet / pot) + '% of the pot.</p>';
    lineChart(document.getElementById('po-chart'), {
      label: 'Break-even percentages by bet size',
      x: [0, 2], y: [0, 0.8],
      xTicks: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], yTicks: [0, 0.2, 0.4, 0.6, 0.8],
      xFmt: (x) => Math.round(x * 100) + '%', yFmt: (y, fine) => pct(y, fine ? 1 : 0),
      xTitle: 'Bet size (% of pot)',
      snap: (x) => Math.round(x * 100) / 100,
      markerX: bet / pot,
      series: [
        { name: 'Bluff needs folds', short: 'Bluff folds', color: SERIES[1], fn: (s) => s / (1 + s) },
        { name: 'Caller needs equity', short: 'Call equity', color: SERIES[0], fn: (s) => s / (1 + 2 * s) },
      ],
    });
  }

  function sprSection() {
    return '<section class="mn-section" id="mn-spr">' +
      '<h3>Stack-to-pot ratio (SPR)</h3>' +
      '<div class="mn-notes">' +
        '<p>SPR is the effective stack (the smaller of the two stacks) divided by the pot at the start of the flop. It tells you how many pot-sized bets are left, so it decides <strong>how strong a hand must be to play for stacks</strong>.</p>' +
        '<p class="mn-formula">SPR = effective stack &divide; pot on the flop</p>' +
        '<p>Plan the hand preflop: bigger raises and 3-bets lower the SPR, which makes one-pair hands easier to play; calling with small pairs and suited connectors wants a high SPR for implied odds.</p>' +
      '</div>' +
      '<div class="mn-calc">' +
        field('spr-stack', 'Effective stack', 97.5, 0.5) + field('spr-pot', 'Pot on the flop', 5.5, 0.5) +
        '<div class="mn-out" id="spr-out"></div>' +
      '</div>' +
      '<div class="mn-bands">' + SPR_BANDS.map((b) =>
        '<div class="mn-band" style="--zone:' + b.color + '"><strong>' + b.label + '</strong><span>' + b.text + '</span></div>').join('') + '</div>' +
      '<h4>Typical SPRs at 100bb (cash game)</h4>' +
      '<div class="mn-table-wrap"><table class="mn-table"><thead><tr><th>Spot</th><th>Pot on the flop</th><th>Stack behind</th><th>SPR</th></tr></thead><tbody>' +
        SPOTS.map((s) => '<tr><td>' + s.name + '</td><td>' + num(s.pot) + 'bb</td><td>' + num(s.stack) + 'bb</td><td><strong>' + num(spr(s.stack, s.pot)) + '</strong></td></tr>').join('') +
      '</tbody></table></div>' +
      '</section>';
  }

  function updateSpr() {
    const stack = val('spr-stack');
    const pot = val('spr-pot');
    const out = document.getElementById('spr-out');
    if (pot <= 0) {
      out.innerHTML = '<p class="hint">Enter a pot above zero.</p>';
      return;
    }
    const r = spr(stack, pot);
    const band = SPR_BANDS.find((b) => r < b.max);
    out.innerHTML = '<div class="mn-stat"><span>SPR</span><strong>' + num(r) + '</strong></div>' +
      bandStrip(SPR_BANDS, r) + '<p class="mn-sentence"><strong>' + band.label + ':</strong> ' + band.text + '</p>';
  }

  function stackSection() {
    return '<section class="mn-section" id="mn-stack">' +
      '<h3>Stack size: big blinds and M</h3>' +
      '<div class="mn-notes">' +
        '<p>In tournaments your options shrink as your stack does. Two common yardsticks:</p>' +
        '<ul><li><strong>Big blinds</strong>: stack &divide; big blind. Modern charts (push/fold, re-shove ranges) are written in big blinds.</li>' +
        '<li><strong>M</strong> (Dan Harrington): stack &divide; the cost of one orbit (small blind + big blind + all antes). It counts how many orbits you survive by folding. <strong>Effective M</strong> = M &times; players at the table &divide; 10, because blinds come around faster short-handed.</li></ul>' +
      '</div>' +
      '<div class="mn-calc">' +
        field('st-stack', 'Your stack', 24000, 100) + field('st-sb', 'Small blind', 500, 25) + field('st-bb', 'Big blind', 1000, 25) +
        field('st-ante', 'Ante', 1000, 25) + field('st-players', 'Players at the table', 9, 1, 2) +
        '<label class="mn-field mn-check"><input type="checkbox" id="st-bbante" checked> Big-blind ante (one ante per hand)</label>' +
        '<div class="mn-out" id="st-out"></div>' +
      '</div>' +
      '<div class="mn-two">' +
        '<div><h4>Harrington’s M zones</h4><div class="mn-bands">' + M_ZONES.slice().reverse().map((z) =>
          '<div class="mn-band" style="--zone:' + z.color + '"><strong>' + z.label + ' <span class="muted">' + z.range + '</span></strong><span>' + z.text + '</span></div>').join('') + '</div></div>' +
        '<div><h4>Stack depth in big blinds</h4><div class="mn-bands">' + BB_BANDS.slice().reverse().map((z) =>
          '<div class="mn-band" style="--zone:' + z.color + '"><strong>' + z.label + '</strong><span>' + z.text + '</span></div>').join('') + '</div></div>' +
      '</div>' +
      '</section>';
  }

  function updateStack() {
    const d = stackDepth({
      stack: val('st-stack'), sb: val('st-sb'), bb: val('st-bb'), ante: val('st-ante'),
      players: Math.max(2, Math.round(val('st-players'))), bbAnte: document.getElementById('st-bbante').checked,
    });
    const out = document.getElementById('st-out');
    if (!(val('st-bb') > 0)) {
      out.innerHTML = '<p class="hint">Enter a big blind above zero.</p>';
      return;
    }
    const zone = M_ZONES.find((z) => d.effectiveM < z.max);
    const bbBand = BB_BANDS.find((z) => d.bbs < z.max);
    out.innerHTML =
      '<div class="mn-stat"><span>Big blinds</span><strong>' + num(d.bbs) + 'bb</strong></div>' +
      '<div class="mn-stat"><span>Cost per orbit</span><strong>' + num(d.orbit, 0) + '</strong></div>' +
      '<div class="mn-stat"><span>M</span><strong>' + num(d.m) + '</strong></div>' +
      '<div class="mn-stat"><span>Effective M</span><strong>' + num(d.effectiveM) + '</strong></div>' +
      '<p class="mn-label">By effective M</p>' + bandStrip(M_ZONES, d.effectiveM) +
      '<p class="mn-sentence"><strong>' + zone.label + ' zone:</strong> ' + zone.text + '</p>' +
      '<p class="mn-label">By big blinds</p>' + bandStrip(BB_BANDS, d.bbs) +
      '<p class="mn-sentence"><strong>' + bbBand.label + ':</strong> ' + bbBand.text + '</p>';
  }

  function geoSection() {
    const sprs = [1, 2, 3, 4, 6, 8, 10, 13, 20];
    return '<section class="mn-section" id="mn-geo">' +
      '<h3>Geometric bet sizing</h3>' +
      '<div class="mn-notes">' +
        '<p>To get all the chips in over the remaining streets, bet the <strong>same fraction of the pot every street</strong> so the last bet is exactly all-in. It grows the pot as evenly as possible, which is how you get the most money in from hands that call each street (and it is the theoretically best way to size a polarized range).</p>' +
        '<p class="mn-formula">Bet fraction = ((1 + 2 &times; SPR)<sup>1/streets</sup> &minus; 1) &divide; 2</p>' +
        '<p>Example: SPR 4 with three streets left gives a 54% pot bet on the flop, turn and river; with two streets, it is 100% pot twice.</p>' +
      '</div>' +
      '<div class="mn-calc">' +
        field('geo-pot', 'Pot now', 10, 0.5) + field('geo-stack', 'Effective stack', 45, 0.5) +
        '<label class="mn-field">Streets left<select id="geo-streets"><option value="1">1 (river)</option><option value="2">2 (turn + river)</option><option value="3" selected>3 (flop, turn, river)</option></select></label>' +
        '<div class="mn-out" id="geo-out"></div>' +
      '</div>' +
      '<div class="mn-figure"><p class="mn-figure-title">Geometric bet size by SPR</p><div id="geo-chart"></div></div>' +
      '<div class="mn-table-wrap"><table class="mn-table"><thead><tr><th>SPR</th><th>1 street</th><th>2 streets</th><th>3 streets</th></tr></thead><tbody>' +
        sprs.map((r) => '<tr><td>' + r + '</td>' + [1, 2, 3].map((n) => '<td>' + pct(geometricFraction(1, r, n), 0) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' +
      '</section>';
  }

  function updateGeo() {
    const pot = val('geo-pot');
    const stack = val('geo-stack');
    const streets = +document.getElementById('geo-streets').value;
    const out = document.getElementById('geo-out');
    if (pot <= 0 || stack <= 0) {
      out.innerHTML = '<p class="hint">Enter a pot and a stack above zero.</p>';
      return;
    }
    const plan = geometricPlan(pot, stack, streets);
    const names = ['Flop', 'Turn', 'River'].slice(3 - streets);
    out.innerHTML =
      '<div class="mn-stat"><span>SPR</span><strong>' + num(stack / pot) + '</strong></div>' +
      '<div class="mn-stat"><span>Bet each street</span><strong>' + pct(plan.fraction, 0) + ' pot</strong></div>' +
      '<div class="mn-table-wrap"><table class="mn-table mn-plan"><thead><tr><th>Street</th><th>Pot</th><th>Bet</th><th>Stack after</th></tr></thead><tbody>' +
        plan.rows.map((r, i) => '<tr><td>' + names[i] + '</td><td>' + num(r.pot) + '</td><td><strong>' + num(r.bet) + '</strong></td><td>' + num(r.stackAfter) + '</td></tr>').join('') +
      '</tbody></table></div>';
    lineChart(document.getElementById('geo-chart'), {
      label: 'Geometric bet size as a percentage of the pot, by SPR',
      x: [0.5, 20], y: [0, 3],
      xTicks: [1, 4, 8, 12, 16, 20], yTicks: [0, 0.5, 1, 1.5, 2, 2.5, 3],
      xFmt: (x) => num(x), yFmt: (y) => pct(y, 0),
      xTitle: 'SPR',
      snap: (x) => Math.round(x * 2) / 2,
      markerX: stack / pot,
      // One street is just a shove (bet = SPR), which runs off the chart, so only 2 and 3 streets are drawn.
      series: [
        { name: '2 streets', color: SERIES[1], fn: (r) => geometricFraction(1, r, 2) },
        { name: '3 streets', color: SERIES[0], fn: (r) => geometricFraction(1, r, 3) },
      ],
    });
  }

  function render(root) {
    root.innerHTML =
      '<div class="panel-head"><h2>Poker math</h2><span class="hint">Notes, calculators and charts. Change any number and everything updates.</span></div>' +
      '<nav class="mn-toc"><a href="#mn-potodds">Pot odds</a><a href="#mn-spr">SPR</a><a href="#mn-stack">Stack size &amp; M</a><a href="#mn-geo">Geometric sizing</a></nav>' +
      potOddsSection() + sprSection() + stackSection() + geoSection();
    const updates = { po: updatePotOdds, spr: updateSpr, st: updateStack, geo: updateGeo };
    root.addEventListener('input', (e) => {
      const key = (e.target.id || '').split('-')[0];
      if (updates[key]) updates[key]();
    });
    root.addEventListener('change', (e) => {
      const key = (e.target.id || '').split('-')[0];
      if (updates[key]) updates[key]();
    });
    Object.values(updates).forEach((u) => u());
    // Charts are drawn at the container's width, so redraw them when it changes.
    let lastWidth = root.clientWidth;
    let timer = null;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!root.clientWidth || root.clientWidth === lastWidth) return;
        lastWidth = root.clientWidth;
        updatePotOdds();
        updateGeo();
      }, 150);
    });
  }

  const api = { potOdds, outsEquity, spr, stackDepth, geometricFraction, geometricPlan, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.PokerMath = api;
})();
