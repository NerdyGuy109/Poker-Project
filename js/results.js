/*
 * Tournament results: the archive of finished buy-ins, grouped into tournaments (re-entries
 * into the same event count as one tournament), with filters (in the money, final table, wins,
 * busts), sorting (date, ROI, cash, profit, finish), totals and a cumulative profit graph.
 * The data helpers at the top have no DOM access, so tests can load them in Node.
 * The page reads entries saved by the Buy-ins tab (window.BuyIns.store).
 */
(function (root) {
  'use strict';

  // "22nd of 640", "3/112", "won", "FT 5th" → { place, entrants } (numbers, or '' when unknown).
  function parsePlace(text) {
    const t = String(text == null ? '' : text).trim().toLowerCase();
    if (!t) return { place: '', entrants: '' };
    const field = /(?:of|out of|\/)\s*(\d+)/.exec(t);
    if (/^(won|win|winner|champion)\b/.test(t)) return { place: 1, entrants: field ? +field[1] : '' };
    const m = /(\d+)(?:st|nd|rd|th)?\s*(?:(?:of|out of|\/)\s*(\d+))?/.exec(t);
    if (!m) return { place: '', entrants: '' };
    return { place: +m[1] || '', entrants: m[2] ? +m[2] : '' };
  }

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const num = (x) => (x === '' || x === null || x === undefined || !Number.isFinite(+x) ? 0 : +x);

  // Re-entries into the same event on the same day share a key.
  function groupKey(e) {
    const ev = String(e.event || '').trim().toLowerCase();
    if (!ev) return 'id:' + e.id;
    return (e.date || '').slice(0, 10) + '|' + String(e.venue || '').trim().toLowerCase() + '|' + ev;
  }

  // Entries → tournaments: { key, ids, date, venue, location, event, game, entries, spent, cashed,
  // profit, roi, place, entrants, itm, finalTable, won, firstId }. `ftSize` = players at the final table.
  function groupTournaments(entries, ftSize) {
    ftSize = ftSize || 9;
    const groups = new Map();
    for (const e of entries) {
      const k = groupKey(e);
      let g = groups.get(k);
      if (!g) {
        g = { key: k, ids: [], date: e.date || '', venue: e.venue || '', location: e.location || '', event: e.event || '', game: e.game || '', entries: 0, spent: 0, cashed: 0, place: '', entrants: '', firstId: e.id, hasPhoto: false };
        groups.set(k, g);
      }
      g.ids.push(e.id);
      g.entries++;
      g.spent += num(e.total);
      g.cashed += num(e.cashed);
      if (e.date && e.date < g.date) { g.date = e.date; g.firstId = e.id; }
      for (const f of ['venue', 'location', 'game']) if (!g[f] && e[f]) g[f] = e[f];
      const pl = num(e.place);
      if (pl > 0 && (g.place === '' || pl < g.place)) g.place = pl;
      const en = num(e.entrants);
      if (en > 0 && (g.entrants === '' || en > g.entrants)) g.entrants = en;
      if (e.hasPhoto) g.hasPhoto = true;
    }
    return [...groups.values()].map((g) => Object.assign(g, {
      profit: g.cashed - g.spent,
      roi: g.spent > 0 ? (g.cashed - g.spent) / g.spent : null,
      itm: g.cashed > 0,
      finalTable: g.place !== '' && g.place <= ftSize,
      won: g.place === 1,
      // Share of the field you outlasted (1 = won), when the field size is known.
      percentile: g.place !== '' && g.entrants > 1 ? 1 - (g.place - 1) / (g.entrants - 1) : null,
    }));
  }

  // filter: { result: 'all' | 'itm' | 'ft' | 'win' | 'bust', year, game, venue, text }
  function filterTournaments(list, filter) {
    const f = filter || {};
    const q = String(f.text || '').trim().toLowerCase();
    return list.filter((t) => {
      if (f.result === 'itm' && !t.itm) return false;
      if (f.result === 'ft' && !t.finalTable) return false;
      if (f.result === 'win' && !t.won) return false;
      if (f.result === 'bust' && t.itm) return false;
      if (f.year && !t.date.startsWith(f.year)) return false;
      if (f.game && t.game !== f.game) return false;
      if (f.venue && t.venue.trim().toLowerCase() !== f.venue.trim().toLowerCase()) return false;
      if (q && !(t.venue + ' ' + t.location + ' ' + t.event).toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // by: 'date' (newest), 'roi', 'cash', 'profit', 'finish' (deepest run first), 'buyin'.
  function sortTournaments(list, by) {
    const out = list.slice();
    const byDate = (a, b) => b.date.localeCompare(a.date);
    const nullsLast = (x) => (x === null || x === '' ? -Infinity : x);
    if (by === 'roi') out.sort((a, b) => nullsLast(b.roi) - nullsLast(a.roi) || byDate(a, b));
    else if (by === 'cash') out.sort((a, b) => b.cashed - a.cashed || byDate(a, b));
    else if (by === 'profit') out.sort((a, b) => b.profit - a.profit || byDate(a, b));
    else if (by === 'buyin') out.sort((a, b) => b.spent - a.spent || byDate(a, b));
    else if (by === 'finish') {
      // Field share when known, else the place itself (unknown places last).
      const score = (t) => (t.percentile !== null ? 1 + t.percentile : t.place !== '' ? 1 / t.place : -1);
      out.sort((a, b) => score(b) - score(a) || byDate(a, b));
    } else out.sort(byDate);
    return out;
  }

  function resultStats(list) {
    const spent = list.reduce((s, t) => s + t.spent, 0);
    const cashed = list.reduce((s, t) => s + t.cashed, 0);
    const n = list.length;
    const itm = list.filter((t) => t.itm).length;
    const best = list.filter((t) => t.place !== '').sort((a, b) => a.place - b.place)[0] || null;
    return {
      tournaments: n,
      entries: list.reduce((s, t) => s + t.entries, 0),
      spent, cashed,
      profit: cashed - spent,
      roi: spent > 0 ? (cashed - spent) / spent : null,
      itm, itmRate: n ? itm / n : null,
      finalTables: list.filter((t) => t.finalTable).length,
      wins: list.filter((t) => t.won).length,
      avgBuyIn: n ? spent / n : 0,
      biggestCash: list.reduce((m, t) => Math.max(m, t.cashed), 0),
      bestFinish: best,
    };
  }

  // Running profit, oldest first: [{ date, profit (running total), t (the tournament) }].
  function profitSeries(list) {
    let run = 0;
    return list.slice().sort((a, b) => a.date.localeCompare(b.date)).map((t) => {
      run += t.profit;
      return { date: t.date, profit: run, t };
    });
  }

  const api = { parsePlace, ordinal, groupKey, groupTournaments, filterTournaments, sortTournaments, resultStats, profitSeries };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  const GAMES = [['', 'All games'], ['nlhe', 'NL Hold’em'], ['omaha', 'Omaha'], ['mixed', 'Mixed / other']];
  const RESULTS = [['all', 'All'], ['itm', 'In the money'], ['ft', 'Final table'], ['win', 'Wins'], ['bust', 'No cash']];
  const SORTS = [['date', 'Newest'], ['roi', 'Best ROI'], ['profit', 'Most profit'], ['cash', 'Biggest cash'], ['finish', 'Deepest run'], ['buyin', 'Biggest buy-in']];
  const STORE_KEY = 'poker-analyzer-results-v1';

  const state = { entries: [], filter: { result: 'all', year: '', game: '', venue: '', text: '' }, sort: 'date', ftSize: 9, error: '' };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* storage unavailable */ }
  let el = null;

  const saveUI = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ filter: state.filter, sort: state.sort, ftSize: state.ftSize })); } catch (e) { /* storage unavailable */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (x) => (x < 0 ? '−' : '') + '$' + Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: Math.abs(x) % 1 ? 2 : 0, minimumFractionDigits: Math.abs(x) % 1 ? 2 : 0 });
  const pct = (x) => (x === null ? '–' : Math.round(100 * x) + '%');
  const niceDate = (d) => {
    const x = new Date((d || '').slice(0, 10) + 'T12:00');
    return isNaN(x) ? '' : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  async function render(container) {
    el = container;
    if (!el.dataset.ready) { el.dataset.ready = '1'; bind(); }
    try {
      state.entries = (await root.BuyIns.store.getAll()).filter((e) => e.archived);
      state.error = '';
    } catch (e) {
      state.entries = [];
      state.error = e.message || 'Saving isn’t available in this browser.';
    }
    draw();
  }

  function draw() {
    const all = groupTournaments(state.entries, state.ftSize);
    const list = sortTournaments(filterTournaments(all, state.filter), state.sort);
    const s = resultStats(list);
    const years = [...new Set(all.map((t) => t.date.slice(0, 4)).filter(Boolean))].sort().reverse();
    const venues = [...new Map(all.filter((t) => t.venue).map((t) => [t.venue.trim().toLowerCase(), t.venue.trim()])).values()].sort((a, b) => a.localeCompare(b));
    const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    const f = state.filter;
    el.innerHTML =
      '<div class="panel-head"><h2>Results</h2><span class="hint">Finished tournaments from Buy-ins. Re-entries into the same event count as one tournament.</span></div>' +
      (state.error ? '<p class="board-error">' + esc(state.error) + '</p>' : '') +
      (all.length ? '' : '<p class="bi-empty">No results yet. In <button type="button" class="link" data-act="go-buyins">Buy-ins</button>, open a tournament, enter your finish and cash, and tap <strong>Save &amp; move to Results</strong>.</p>') +
      (all.length ?
        '<div class="rs-chips" role="group" aria-label="Show">' + RESULTS.map(([k, n]) => '<button type="button" data-result="' + k + '"' + (f.result === k ? ' class="on"' : '') + '>' + n +
          (k === 'ft' ? ' <span class="muted">(top ' + state.ftSize + ')</span>' : '') + '</button>').join('') + '</div>' +
        '<div class="rs-filters">' +
          '<label class="mn-field">Year<select id="rs-year">' + opt('', 'All years', f.year) + years.map((y) => opt(y, y, f.year)).join('') + '</select></label>' +
          '<label class="mn-field">Game<select id="rs-game">' + GAMES.map(([k, n]) => opt(k, n, f.game)).join('') + '</select></label>' +
          '<label class="mn-field">Venue<select id="rs-venue">' + opt('', 'All venues', f.venue) + venues.map((v) => opt(v, v, f.venue)).join('') + '</select></label>' +
          '<label class="mn-field">Sort<select id="rs-sort">' + SORTS.map(([k, n]) => opt(k, n, state.sort)).join('') + '</select></label>' +
          '<label class="mn-field">Final table<select id="rs-ft">' + [9, 8, 7, 6, 10].map((n) => opt(String(n), 'Top ' + n, String(state.ftSize))).join('') + '</select></label>' +
          '<label class="mn-field rs-search">Search<input type="search" id="rs-text" value="' + esc(f.text) + '" placeholder="Event, venue, city"></label>' +
        '</div>' +
        '<div class="bi-totals rs-stats">' +
          stat('Tournaments', s.tournaments + (s.entries > s.tournaments ? ' <small>(' + s.entries + ' entries)</small>' : '')) +
          stat('Spent', money(s.spent)) + stat('Cashed', money(s.cashed)) +
          stat('Profit', '<span class="' + (s.profit < 0 ? 'neg' : s.profit > 0 ? 'pos' : '') + '">' + money(s.profit) + '</span>') +
          stat('ROI', pct(s.roi)) + stat('In the money', s.itm + (s.tournaments ? ' <small>(' + pct(s.itmRate) + ')</small>' : '')) +
          stat('Final tables', s.finalTables) + stat('Wins', s.wins) + stat('Avg buy-in', money(Math.round(s.avgBuyIn))) + stat('Biggest cash', money(s.biggestCash)) +
          (s.bestFinish ? stat('Best finish', ordinal(s.bestFinish.place) + (s.bestFinish.entrants ? ' <small>of ' + s.bestFinish.entrants + '</small>' : '')) : '') +
        '</div>' +
        (list.length >= 2 ? '<div class="mn-figure"><p class="mn-figure-title">Running profit</p><div id="rs-chart"></div><p class="hint">Each dot is a tournament (green when you cashed). Uses the filters above.</p></div>' : '') +
        (list.length ? '<ul class="rs-list">' + list.map(row).join('') + '</ul>' : '<p class="bi-empty">No tournaments match these filters.</p>') +
        '<p class="hint">Tap a tournament to edit it or move it back to Buy-ins.</p>'
        : '');
    if (list.length >= 2) chart(el.querySelector('#rs-chart'), profitSeries(list));
  }

  const stat = (label, value) => '<div class="mn-stat"><span>' + label + '</span><strong>' + value + '</strong></div>';

  function row(t) {
    const finish = t.place !== '' ? ordinal(t.place) + (t.entrants ? ' of ' + t.entrants.toLocaleString() : '') : '';
    return '<li><button type="button" class="rs-item" data-open="' + esc(t.firstId) + '">' +
      '<span class="bi-main"><span class="bi-date">' + esc(niceDate(t.date)) + (t.location ? ' &middot; ' + esc(t.location) : '') + '</span>' +
        '<span class="bi-venue">' + esc(t.venue || 'Unknown venue') + '</span>' +
        (t.event ? '<span class="bi-event">' + esc(t.event) + '</span>' : '') +
        '<span class="bi-tags">' +
          (t.won ? '<span class="pl-badge rs-win">&#127942; Won</span>' : t.finalTable ? '<span class="pl-badge rs-ft">Final table</span>' : '') +
          (t.itm ? '<span class="pl-badge bi-cash">In the money</span>' : '') +
          (finish ? '<span class="pl-badge">' + finish + '</span>' : '') +
          (t.entries > 1 ? '<span class="pl-badge">' + t.entries + ' entries</span>' : '') +
        '</span></span>' +
      '<span class="rs-nums"><span class="rs-profit ' + (t.profit < 0 ? 'neg' : t.profit > 0 ? 'pos' : '') + '">' + money(t.profit) + '</span>' +
        '<span class="rs-sub">' + money(t.spent) + ' in' + (t.cashed ? ' &middot; ' + money(t.cashed) + ' out' : '') + '</span>' +
        '<span class="rs-sub">ROI ' + pct(t.roi) + '</span></span></button></li>';
  }

  // Running-profit line with a zero line and one dot per tournament.
  function chart(box, series) {
    const W = Math.max(300, Math.min(900, box.clientWidth || 640));
    const H = W < 520 ? 210 : 250, L = 58, R = 14, T = 12, B = 30;
    const ys = series.map((p) => p.profit).concat([0]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const n = series.length;
    const sx = (i) => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - R);
    const sy = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const step = niceStep((hi - lo) / 4);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mn-chart rs-chart" role="img" aria-label="Running profit over ' + n + ' tournaments, ending at ' + money(series[n - 1].profit) + '">';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/>' +
        '<text class="tick" x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + shortMoney(v) + '</text>';
    }
    svg += '<line class="rs-zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(0) + '" y2="' + sy(0) + '"/>';
    const labelIdx = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of [...new Set(labelIdx)]) {
      svg += '<text class="tick" x="' + sx(i) + '" y="' + (H - 10) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + esc(niceDate(series[i].date)) + '</text>';
    }
    svg += '<polyline class="rs-line" points="' + series.map((p, i) => sx(i).toFixed(1) + ',' + sy(p.profit).toFixed(1)).join(' ') + '"/>';
    svg += series.map((p, i) => '<circle class="rs-dot' + (p.t.itm ? ' cash' : '') + '" cx="' + sx(i).toFixed(1) + '" cy="' + sy(p.profit).toFixed(1) + '" r="' + (n > 60 ? 2.5 : 4) + '"><title>' +
      esc(niceDate(p.date) + ' · ' + (p.t.venue || '') + (p.t.event ? ' · ' + p.t.event : '') + '\n' + (p.t.profit >= 0 ? '+' : '') + money(p.t.profit) + ' (running ' + money(p.profit) + ')') + '</title></circle>').join('');
    box.innerHTML = svg + '</svg>';
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  const shortMoney = (v) => (v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0) + 'k' : Math.round(Math.abs(v)));

  function bind() {
    el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-result]');
      if (r) { state.filter.result = r.dataset.result; saveUI(); draw(); return; }
      const o = e.target.closest('[data-open]');
      if (o) { root.BuyIns.openEntry(o.dataset.open, 'results'); return; }
      if (e.target.closest('[data-act="go-buyins"]')) { const tab = document.querySelector('[data-view="buyins"]'); if (tab) tab.click(); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'rs-year') state.filter.year = t.value;
      else if (t.id === 'rs-game') state.filter.game = t.value;
      else if (t.id === 'rs-venue') state.filter.venue = t.value;
      else if (t.id === 'rs-sort') state.sort = t.value;
      else if (t.id === 'rs-ft') state.ftSize = +t.value;
      else return;
      saveUI();
      draw();
    });
    el.addEventListener('input', (e) => {
      if (e.target.id !== 'rs-text') return;
      state.filter.text = e.target.value;
      saveUI();
      const pos = e.target.selectionStart;
      draw();
      const box = el.querySelector('#rs-text');
      if (box) { box.focus(); box.setSelectionRange(pos, pos); }
    });
  }

  root.Results = Object.assign({ render }, api);
})(typeof self !== 'undefined' ? self : this);
