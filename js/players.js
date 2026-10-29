/*
 * Player notes ("player book"): a list of players, a read-first profile page for each (type,
 * priority, summary, key facts, leaks with exploits, tells, sizing, game plans, dated notes) and an
 * edit page. Saved in this browser (localStorage), with export/import for moving between devices.
 * The data helpers at the top have no DOM access, so tests can load them in Node.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'poker-analyzer-players-v1';
  const OLD_TELLS_KEY = 'poker-analyzer-tells-v1';

  const FORMATS = [['cash', 'Cash game'], ['tournament', 'Tournament']];
  const GAMES = [['nlhe', 'NL Hold’em'], ['omaha', 'Omaha'], ['mixed', 'Mixed games']];

  // Each style is a two-sided switch: left, right, or not set yet.
  const STYLES = [
    { id: 'looseTight', left: ['loose', 'Loose'], right: ['tight', 'Tight'], hint: 'How many hands they play' },
    { id: 'aggPass', left: ['aggressive', 'Aggressive'], right: ['passive', 'Passive'], hint: 'Bets and raises, or checks and calls' },
    { id: 'skill', left: ['smart', 'Smart'], right: ['dumb', 'Dumb'], hint: 'Thinks about the game, or doesn’t' },
    { id: 'readable', left: ['stoic', 'Stoic'], right: ['tellbox', 'Tellbox'], hint: 'Hard to read, or easy to read' },
    { id: 'honesty', left: ['bluffy', 'Bluffy'], right: ['honest', 'Honest'], hint: 'Bets mean bluffs often, or usually a hand' },
  ];

  const TENDENCIES = [
    { group: 'Preflop', items: [
      ['limps', 'Limps a lot'],
      ['opens-wide', 'Opens too many hands'],
      ['three-bets-light', '3-bets light / squeezes'],
      ['folds-to-3bet', 'Folds too often to 3-bets'],
      ['gambles-preflop', 'Straddles / gambles preflop'],
    ] },
    { group: 'Postflop', items: [
      ['raises-flush-draws', 'Raises flops with flush draws'],
      ['overplays-overpairs', 'Overplays overpairs'],
      ['calling-station', 'Calls too much / hard to bluff'],
      ['chases-draws', 'Chases draws without the odds'],
      ['cbets-always', 'C-bets almost every flop'],
      ['gives-up-turn', 'Gives up on the turn after a missed c-bet'],
      ['check-raises', 'Check-raises often'],
      ['slowplays', 'Slowplays big hands'],
      ['big-bet-strong', 'Bets big only with strong hands'],
      ['overbet-bluffs', 'Overbets as a bluff'],
      ['river-bluffs', 'Bluffs missed draws on the river'],
      ['wont-fold-top-pair', 'Won’t fold top pair'],
    ] },
    { group: 'Mental & table', items: [
      ['tilts', 'Tilts after losing a big pot'],
      ['scared-money', 'Plays scared / protects their stack'],
      ['shows-bluffs', 'Shows bluffs'],
      ['talks-in-hands', 'Talks during hands'],
      ['drinking', 'Drinks at the table'],
      ['buys-in-short', 'Buys in short'],
      ['big-stack-bully', 'Bullies with a big stack'],
    ] },
    { group: 'Tournament', items: [
      ['bubble-tight', 'Too tight near the bubble'],
      ['shoves-wide', 'Shoves too wide when short'],
      ['calls-shoves-light', 'Calls shoves too light'],
    ] },
  ];
  const TENDENCY_NAMES = Object.fromEntries(TENDENCIES.flatMap((g) => g.items));

  // Advice from the profile: how to adjust against this player.
  function adjustments(p) {
    const s = p.style;
    const t = p.tendencies;
    const out = [];
    const add = (cond, text) => { if (cond) out.push(text); };
    add(s.looseTight === 'loose' && s.aggPass === 'passive', 'Value bet thinner and bigger; skip most bluffs, they call too much.');
    add(s.looseTight === 'tight' && s.aggPass === 'passive', 'Steal their blinds and fold to their raises unless you’re strong; they rarely bluff.');
    add(s.looseTight === 'loose' && s.aggPass === 'aggressive', 'Call down lighter and let them bluff; trap with strong hands instead of raising.');
    add(s.looseTight === 'tight' && s.aggPass === 'aggressive', 'Respect their big bets on later streets; attack their c-bets when the board misses their range.');
    add(s.honesty === 'bluffy', 'Their big bets are often bluffs: bluff-catch more often.');
    add(s.honesty === 'honest', 'When they bet big they usually have it: fold your medium hands.');
    add(s.skill === 'dumb', 'Keep it simple: bet your good hands for value, don’t try fancy bluffs they won’t understand.');
    add(s.skill === 'smart', 'Mix up your play; they notice patterns and will adjust.');
    add(s.readable === 'tellbox', 'Watch them closely when they bet: their tells are reliable (log them below).');
    add(s.readable === 'stoic', 'Don’t rely on physical tells; use betting patterns and timing instead.');
    add(t['raises-flush-draws'], 'A flop raise on a two-tone board is often a flush draw: if the flush misses, they’re likely weak.');
    add(t['overplays-overpairs'], 'Value bet two pair and sets hard; they’ll pay off with one big pair.');
    add(t['calling-station'], 'Don’t bluff them; bet bigger with your value hands.');
    add(t['chases-draws'], 'Charge draws with big bets on wet boards.');
    add(t['cbets-always'], 'Float or raise their flop bets more often; many are air.');
    add(t['gives-up-turn'], 'Call flop c-bets and bet when they check the turn.');
    add(t['check-raises'], 'Check back medium hands for pot control; bet strong hands so they can check-raise.');
    add(t.slowplays, 'Be careful when they suddenly wake up on the turn or river after calling.');
    add(t['big-bet-strong'], 'Their bet size tells you their strength: fold to big bets, call small ones.');
    add(t['overbet-bluffs'], 'Overbets are often bluffs: call with good bluff-catchers.');
    add(t['river-bluffs'], 'When obvious draws miss, their river bets are often bluffs.');
    add(t['wont-fold-top-pair'], 'Value bet two pair or better on three streets; don’t bluff a board where they could have top pair.');
    add(t.limps, 'Raise their limps for value and isolation, especially in position.');
    add(t['opens-wide'], '3-bet them more, for value and as a bluff.');
    add(t['folds-to-3bet'], '3-bet them light; they give up too often.');
    add(t['three-bets-light'], 'Open tighter against them and 4-bet your strong hands; call their 3-bets with good playable hands.');
    add(t.tilts, 'After they lose a big pot, widen your value range: they’ll pay off and spew.');
    add(t['scared-money'], 'Apply pressure with big bets; they fold too much when their stack is at risk.');
    add(t['shows-bluffs'], 'They like to show bluffs: note what they show, it reveals how they think.');
    add(t['big-stack-bully'], 'Re-shove or 3-bet against their steals with good hands; don’t get pushed off.');
    add(t['bubble-tight'], 'Steal relentlessly near the bubble.');
    add(t['shoves-wide'], 'Call their short-stack shoves wider.');
    add(t['calls-shoves-light'], 'Shove tighter against them; they call too often.');
    return out;
  }

  // Player types: a label and a default game plan against that type.
  const TYPES = [
    { id: 'maniac', label: 'Maniac / splashy aggro', plan: 'Check to them and let them bluff. Call down lighter with top pair and overpairs. 3-bet/4-bet wider for value. Don’t bluff them.' },
    { id: 'lag', label: 'LAG (loose-aggressive)', plan: 'Tighten up and trap: call down lighter in position, 3-bet for value rather than as a bluff, and let them barrel into your strong hands.' },
    { id: 'tag', label: 'TAG (tight-aggressive)', plan: 'Respect their turn and river aggression. Steal when they fold too much preflop and avoid marginal spots out of position against them.' },
    { id: 'nit', label: 'Nit / rock', plan: 'Steal their blinds and limps. Fold to their big bets and raises; don’t pay them off. Bluff them when scare cards come.' },
    { id: 'station', label: 'Calling station', plan: 'Value bet thinner and bigger, and don’t bluff. When they suddenly bet or raise, believe them.' },
    { id: 'weak-tight', label: 'Weak-tight', plan: 'C-bet and bluff them often; they fold too much. Give them credit when they finally show aggression.' },
    { id: 'fish', label: 'Fish / recreational', plan: 'Isolate them preflop and value bet relentlessly. Keep it simple and friendly; no fancy plays.' },
    { id: 'reg', label: 'Solid regular', plan: 'Avoid big pots without an edge. Play straightforward and look for specific leaks before taking risks.' },
  ];
  const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  const NOTE_CATEGORIES = [
    ['tell', 'Live tell'], ['showdown', 'Showdown'], ['sizing', 'Bet sizing'], ['preflop', 'Preflop'],
    ['postflop', 'Postflop'], ['tilt', 'Tilt / mood'], ['other', 'Other'],
  ];
  const NOTE_LABEL = Object.fromEntries(NOTE_CATEGORIES);

  // Free-text sections on the profile, in display order.
  const SECTIONS = [
    ['tells', 'Live tells', 'e.g. Finger check = check-fold. Hammer-fist check = strong. Covers mouth when bluffing.'],
    ['sizing', 'Bet sizing', 'e.g. Opens $20-25 over limps, $40 with AK. Small quick bets = weak.'],
    ['preflop', 'Preflop', 'Game plan before the flop: ranges, 3-bets, how to play against them.'],
    ['postflop', 'Postflop', 'Game plan after the flop: lines they take and how to beat them.'],
    ['tilt', 'Tilt / mood', 'e.g. Tilts after losing a pot. Big ego.'],
    ['notes', 'General notes', 'Anything else worth remembering.'],
  ];

  const BLUFFS = [['', 'Not sure'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];

  // The type from the style switches, when the player has no type chosen.
  function autoTypeId(p) {
    const lt = p.style.looseTight;
    const ap = p.style.aggPass;
    if (lt === 'loose' && ap === 'aggressive') return p.style.honesty === 'bluffy' ? 'maniac' : 'lag';
    if (lt === 'tight' && ap === 'aggressive') return 'tag';
    if (lt === 'loose' && ap === 'passive') return 'station';
    if (lt === 'tight' && ap === 'passive') return 'nit';
    return '';
  }

  // The player's type: the one chosen, or one worked out from the style switches.
  function resolvedType(p) {
    const id = p.type && p.type !== 'auto' ? p.type : autoTypeId(p);
    return TYPE_BY_ID[id] || null;
  }

  function playerType(p) {
    const t = resolvedType(p);
    if (t) return t.label;
    const lt = p.style.looseTight;
    const ap = p.style.aggPass;
    return [lt, ap].filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join(', ');
  }

  // Short labels for the list.
  function typeBadge(p) {
    const t = resolvedType(p);
    if (!t) return playerType(p);
    return { maniac: 'Maniac', lag: 'LAG', tag: 'TAG', nit: 'Nit', station: 'Station', 'weak-tight': 'Weak-tight', fish: 'Fish', reg: 'Reg' }[t.id];
  }

  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function newPlayer(name) {
    const now = new Date().toISOString();
    return {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'New player',
      type: 'auto',
      priority: 0,
      summary: '',
      description: '',
      appearance: '',
      origin: '',
      venue: '',
      stakes: '',
      stack: '',
      seat: '',
      bluffs: '',
      formats: {},
      games: {},
      style: {},
      tendencies: {},
      leaks: [],
      sections: {},
      notes: '',
      log: [],
      tells: {},
      created: now,
      updated: now,
    };
  }

  // Fills in any missing fields (older saves, imports).
  function normalize(p) {
    const out = Object.assign(newPlayer(p.name), p);
    for (const k of ['formats', 'games', 'style', 'tendencies', 'tells', 'sections']) out[k] = Object.assign({}, p[k] || {});
    out.leaks = Array.isArray(p.leaks) ? p.leaks.filter((l) => l && (l.leak || l.exploit)).map((l, i) => ({ id: l.id || 'l' + i, leak: l.leak || '', exploit: l.exploit || '' })) : [];
    // Notes: every entry gets a category and a YYYY-MM-DD date (older entries stored a full timestamp).
    out.log = Array.isArray(p.log) ? p.log.filter((e) => e && e.text).map((e, i) => ({
      id: e.id || 'n' + i,
      date: String(e.date || today()).slice(0, 10),
      category: NOTE_LABEL[e.category] ? e.category : 'other',
      text: e.text,
    })) : [];
    // The general notes field now lives with the other sections.
    if (p.notes && !out.sections.notes) out.sections.notes = p.notes;
    out.notes = '';
    out.priority = Math.max(0, Math.min(5, +p.priority || 0));
    return out;
  }

  // Players from the first version of the notebook (in the Tells tab).
  function migrateOld(old) {
    if (!old || !Array.isArray(old.players)) return [];
    return old.players.map((op) => normalize({ id: op.id, name: op.name, notes: op.notes || '', tells: op.tells || {} }));
  }

  // Newest notes first (by date, then by when they were added).
  const sortedLog = (p) => p.log.map((e, i) => [e, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).map((x) => x[0]);

  // Search and filter. filter: { text, format, game }.
  function filterPlayers(players, filter) {
    const q = (filter.text || '').trim().toLowerCase();
    return players.filter((p) => {
      if (filter.format && !p.formats[filter.format]) return false;
      if (filter.game && !p.games[filter.game]) return false;
      if (!q) return true;
      const hay = [p.name, p.summary, p.description, p.appearance, p.origin, p.venue, p.stakes, p.stack, p.seat, playerType(p)]
        .concat(Object.values(p.sections), p.leaks.map((l) => l.leak + ' ' + l.exploit), p.log.map((e) => e.text)).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function sortPlayers(list, by) {
    const out = list.slice();
    if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    else if (by === 'priority') out.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name));
    else out.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    return out;
  }

  // Combines imported players with the current ones: same id keeps the more recently updated copy.
  function mergePlayers(current, incoming) {
    const byId = new Map(current.map((p) => [p.id, p]));
    for (const raw of incoming) {
      const p = normalize(raw);
      const mine = byId.get(p.id);
      if (!mine || (p.updated || '') > (mine.updated || '')) byId.set(p.id, p);
    }
    return [...byId.values()];
  }

  const api = { STYLES, TENDENCIES, TENDENCY_NAMES, TYPES, NOTE_CATEGORIES, playerType, typeBadge, resolvedType, adjustments, newPlayer, normalize, migrateOld, filterPlayers, sortPlayers, mergePlayers, sortedLog };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  const state = {
    players: [],
    selected: null,
    mode: 'view', // 'view' (profile page) or 'edit'
    filter: { text: '', format: '', game: '' },
    sort: 'updated',
    noteCategory: 'tell',
  };
  let el = null;

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dots = (n, cls) => '<span class="pb-dots ' + (cls || '') + '" title="Priority ' + n + ' of 5" aria-label="Priority ' + n + ' of 5">' +
    [1, 2, 3, 4, 5].map((i) => '<span class="' + (i <= n ? 'on' : '') + '"></span>').join('') + '</span>';

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { /* storage unavailable */ }
    if (saved && Array.isArray(saved.players)) {
      state.players = saved.players.map(normalize);
      return;
    }
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_TELLS_KEY) || 'null'); } catch (e) { /* storage unavailable */ }
    state.players = migrateOld(old);
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ players: state.players })); } catch (e) { /* storage unavailable */ }
  }

  const current = () => state.players.find((p) => p.id === state.selected) || null;
  const visible = () => sortPlayers(filterPlayers(state.players, state.filter), state.sort);

  function touch(p) {
    p.updated = new Date().toISOString();
    save();
  }

  // ----- List -----

  function renderList() {
    const list = visible();
    el.querySelector('#pl-count').textContent = list.length === state.players.length
      ? state.players.length + ' player' + (state.players.length === 1 ? '' : 's')
      : list.length + ' of ' + state.players.length + ' players';
    el.querySelector('#pl-list').innerHTML = list.length ? list.map((p) => {
      const badge = typeBadge(p);
      const sub = [p.description, p.origin].filter(Boolean).join(' · ');
      return '<li><button type="button" class="pl-item' + (p.id === state.selected ? ' active' : '') + '" data-pick="' + p.id + '">' +
        '<span class="pl-item-top"><span class="pl-name">' + esc(p.name) + '</span>' + (p.priority ? dots(p.priority, 'small') : '') + '</span>' +
        (badge ? '<span class="pl-badges"><span class="pl-badge">' + esc(badge) + '</span></span>' : '') +
        (p.summary ? '<span class="pl-summary">' + esc(p.summary) + '</span>' : sub ? '<span class="pl-desc">' + esc(sub) + '</span>' : '') +
        '<span class="pl-updated">' + p.log.length + ' note' + (p.log.length === 1 ? '' : 's') + ' &middot; updated ' + p.updated.slice(0, 10) + '</span></button></li>';
    }).join('') : '<li class="hint pl-empty">' + (state.players.length ? 'No players match.' : 'No players yet. Add your first one above.') + '</li>';
  }

  // ----- Shared header (back, position, prev/next, mode button) -----

  function navHTML(p) {
    const list = visible();
    const pos = list.findIndex((x) => x.id === p.id);
    return '<div class="pl-nav">' +
      '<button type="button" class="link pl-back" data-act="back">&larr; All players</button>' +
      '<span class="pl-pos">' + (pos >= 0 ? (pos + 1) + ' of ' + list.length : '') + '</span>' +
      '<button type="button" data-act="prev"' + (pos <= 0 ? ' disabled' : '') + ' aria-label="Previous player">&lsaquo;</button>' +
      '<button type="button" data-act="next"' + (pos < 0 || pos >= list.length - 1 ? ' disabled' : '') + ' aria-label="Next player">&rsaquo;</button>' +
      (state.mode === 'view'
        ? '<button type="button" class="ghost" data-act="edit">Edit profile</button>'
        : '<button type="button" class="primary" data-act="done">Done</button>') +
      '</div>';
  }

  // ----- Profile page (read mode) -----

  function renderProfile(p) {
    const type = resolvedType(p);
    const typeLabel = playerType(p);
    const facts = [
      ['Stack', p.stack], ['Seat', p.seat], ['Bluffs', (BLUFFS.find((b) => b[0] === p.bluffs) || [])[1] && p.bluffs ? BLUFFS.find((b) => b[0] === p.bluffs)[1] : ''],
      ['Plays', [FORMATS.filter(([k]) => p.formats[k]).map(([, n]) => n).join(', '), GAMES.filter(([k]) => p.games[k]).map(([, n]) => n).join(', ')].filter(Boolean).join(' · ')],
      ['Where', [p.venue, p.stakes].filter(Boolean).join(' · ')],
      ['Looks', p.description ? [p.description, p.appearance].filter(Boolean).join('. ') : p.appearance],
      ['From', p.origin],
      ['Updated', p.updated.slice(0, 10)],
    ].filter(([, v]) => v);
    const suggestions = adjustments(p);
    const styleChips = STYLES.filter((st) => p.style[st.id]).map((st) => (st.left[0] === p.style[st.id] ? st.left : st.right)[1])
      .concat(Object.keys(p.tendencies).filter((k) => p.tendencies[k]).map((k) => TENDENCY_NAMES[k]));
    const log = sortedLog(p);
    const tellsData = (window.Tells && window.Tells.TELLS) || [];

    return navHTML(p) +
      '<h2 class="pb-name">' + esc(p.name) + '</h2>' +
      '<div class="pb-badges">' + (typeLabel ? '<span class="pb-type">' + esc(typeLabel) + '</span>' : '') + (p.priority ? dots(p.priority) : '') + '</div>' +
      (p.summary ? '<p class="pb-summary">' + esc(p.summary) + '</p>' : '<p class="pb-summary muted">No summary yet. Tap <em>Edit profile</em> to write one.</p>') +
      '<hr class="pb-rule">' +
      '<div class="pb-facts">' + facts.map(([k, v]) => '<div><span class="pb-fact-k">' + k + '</span><span class="pb-fact-v">' + esc(v) + '</span></div>').join('') + '</div>' +

      '<h3 class="pb-h">Leaks and how to exploit them</h3>' +
      (p.leaks.length ? p.leaks.map((l) => '<div class="pb-leak"><p class="pb-leak-t">' + esc(l.leak) + '</p>' +
        (l.exploit ? '<p class="pb-exploit"><strong>Exploit:</strong> ' + esc(l.exploit) + '</p>' : '') + '</div>').join('')
        : '<p class="hint">No leaks written yet. Add them in <em>Edit profile</em>.</p>') +
      (suggestions.length ? '<details class="pb-suggest"><summary>Suggestions from their style and tendencies (' + suggestions.length + ')</summary>' +
        (styleChips.length ? '<p class="pb-chips">' + styleChips.map((c) => '<span class="pl-badge">' + esc(c) + '</span>').join('') + '</p>' : '') +
        '<ul>' + suggestions.map((t) => '<li>' + t + '</li>').join('') + '</ul></details>' : '') +

      SECTIONS.filter(([k]) => p.sections[k]).map(([k, title]) => '<h3 class="pb-h">' + title + '</h3><div class="pb-text">' + esc(p.sections[k]) + '</div>').join('') +

      (type ? '<h3 class="pb-h">Default plan for a ' + esc(type.label.split(' (')[0].toLowerCase()) + '</h3><div class="pb-plan">' + type.plan + '</div>' : '') +

      '<h3 class="pb-h">Notes (' + p.log.length + ')</h3>' +
      '<form class="pb-addnote" id="pb-addnote">' +
        '<select id="pb-note-cat" aria-label="Note type">' + NOTE_CATEGORIES.map(([k, n]) => '<option value="' + k + '"' + (k === state.noteCategory ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>' +
        '<input type="date" id="pb-note-date" value="' + today() + '" aria-label="Date">' +
        '<textarea id="pb-note-text" rows="2" placeholder="What did you see? e.g. Bet 1/3 pot river with a busted draw"></textarea>' +
        '<button type="submit" class="primary">Add note</button>' +
      '</form>' +
      (log.length ? '<ul class="pb-notes">' + log.map((e) => '<li><div class="pb-note-meta"><span class="pb-note-date">' + esc(e.date) + '</span><span class="pb-note-cat cat-' + e.category + '">' + NOTE_LABEL[e.category] + '</span>' +
        '<button type="button" class="link pb-note-del" data-del-log="' + e.id + '" aria-label="Delete this note">delete</button></div><p>' + esc(e.text) + '</p></li>').join('') + '</ul>' : '') +

      (tellsData.length ? '<details class="pl-tells"' + (Object.keys(p.tells).length ? ' open' : '') + '><summary>Tells confirmed at showdown</summary>' + tellsTable(p, tellsData) + '</details>' : '');
  }

  function tellsTable(p, tellsData) {
    return '<p class="hint">When you saw a tell and the cards were shown, tap whether they were strong or weak. After 3+ sightings a tell that matched at least 75% of the time is marked reliable.</p>' +
      '<div class="nb-table-wrap"><table class="nb-table"><tbody>' + tellsData.map((t) => {
        const c = p.tells[t.id] || { strong: 0, weak: 0 };
        const n = c.strong + c.weak;
        const way = c.strong >= c.weak ? 'strong' : 'weak';
        const lean = n >= 3 ? (Math.max(c.strong, c.weak) / n >= 0.75 ? '<span class="lean ' + way + '">Reliable: means ' + way + '</span>' : '<span class="lean mixed">Mixed</span>') : n ? '<span class="lean">Need more</span>' : '';
        return '<tr' + (n ? ' class="seen"' : '') + '><td>' + t.title + '</td>' +
          '<td class="nb-count"><button type="button" class="nb-btn strong" data-tell="' + t.id + '" data-way="strong">Strong +</button><span>' + c.strong + '</span></td>' +
          '<td class="nb-count"><button type="button" class="nb-btn weak" data-tell="' + t.id + '" data-way="weak">Weak +</button><span>' + c.weak + '</span></td><td>' + lean + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ----- Edit page -----

  function renderEdit(p) {
    const seg = (st) => '<div class="pl-style"><span class="pl-style-name">' + st.left[1] + ' / ' + st.right[1] + '<span class="hint">' + st.hint + '</span></span>' +
      '<div class="pl-seg" role="radiogroup" aria-label="' + st.left[1] + ' or ' + st.right[1] + '">' +
      [st.left, [null, 'Not sure'], st.right].map(([val, label]) =>
        '<button type="button" role="radio" aria-checked="' + ((p.style[st.id] || null) === val) + '" class="' + ((p.style[st.id] || null) === val ? 'on' : '') +
        '" data-style="' + st.id + '" data-value="' + (val || '') + '">' + label + '</button>').join('') + '</div></div>';
    const auto = TYPE_BY_ID[autoTypeId(p)];
    const field = (k, label, ph, wide) => '<label class="mn-field' + (wide ? ' pl-wide' : '') + '">' + label + '<input data-field="' + k + '" value="' + esc(p[k]) + '" placeholder="' + esc(ph) + '"></label>';
    const area = (k, label, ph, rows) => '<label class="mn-field pl-area">' + label + '<textarea data-field="' + k + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph) + '">' + esc(p[k]) + '</textarea></label>';

    return navHTML(p) +
      '<input class="pl-title" data-field="name" value="' + esc(p.name) + '" aria-label="Player name" placeholder="Player name">' +
      '<div class="pl-row">' +
        '<label class="mn-field pl-wide">Type<select data-field="type"><option value="auto">' + (auto ? 'From style: ' + auto.label : 'From style (set the switches below)') + '</option>' +
          TYPES.map((t) => '<option value="' + t.id + '"' + (p.type === t.id ? ' selected' : '') + '>' + t.label + '</option>').join('') + '</select></label>' +
        '<div class="mn-field">Priority<div class="pl-priority" role="radiogroup" aria-label="Priority">' +
          [0, 1, 2, 3, 4, 5].map((n) => '<button type="button" role="radio" aria-checked="' + (p.priority === n) + '" class="' + (p.priority === n ? 'on' : '') + '" data-priority="' + n + '">' + (n || '–') + '</button>').join('') +
        '</div><span class="hint">How much to target them (5 = top priority)</span></div>' +
      '</div>' +
      area('summary', 'Summary', 'One paragraph: who they are and how they lose money', 3) +
      '<div class="pl-row">' + field('description', 'Description', 'Seat 4, red cap', true) + field('appearance', 'Appearance', 'Build, hair, glasses, usual clothes, age range…', true) + field('origin', 'From', 'Where they’re from') + '</div>' +
      '<div class="pl-row">' + field('venue', 'Where', 'Casino or home game') + field('stakes', 'Stakes', 'e.g. 2/5, $300 MTT') + '</div>' +
      '<div class="pl-row pl-checks">' +
        '<fieldset><legend>Format</legend>' + FORMATS.map(([k, n]) => '<label><input type="checkbox" data-pl-format="' + k + '"' + (p.formats[k] ? ' checked' : '') + '> ' + n + '</label>').join('') + '</fieldset>' +
        '<fieldset><legend>Games</legend>' + GAMES.map(([k, n]) => '<label><input type="checkbox" data-pl-game="' + k + '"' + (p.games[k] ? ' checked' : '') + '> ' + n + '</label>').join('') + '</fieldset>' +
      '</div>' +

      '<h3 class="tell-section">Key facts</h3>' +
      '<div class="pl-row">' + area('stack', 'Stack', 'Buy-ins and rebuys, e.g. Buys in for $1,000, rebuys for $1-2k', 2) + area('seat', 'Seat', 'Where to sit relative to them, and why', 2) + '</div>' +
      '<label class="mn-field">Bluffs<select data-field="bluffs">' + BLUFFS.map(([k, n]) => '<option value="' + k + '"' + (p.bluffs === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +

      '<h3 class="tell-section">Leaks and how to exploit them</h3>' +
      '<div class="pl-leaks">' + p.leaks.map((l) => '<div class="pl-leak-edit">' +
        '<input data-leak="' + l.id + '" data-part="leak" value="' + esc(l.leak) + '" placeholder="The leak, e.g. Stacks off with one pair">' +
        '<textarea data-leak="' + l.id + '" data-part="exploit" rows="2" placeholder="Exploit, e.g. Raise him with two pair or better and let him shove">' + esc(l.exploit) + '</textarea>' +
        '<button type="button" class="link" data-del-leak="' + l.id + '">Remove</button></div>').join('') + '</div>' +
      '<button type="button" data-act="add-leak">+ Add a leak</button>' +

      '<h3 class="tell-section">Style</h3>' + STYLES.map(seg).join('') +

      '<h3 class="tell-section">Tendencies</h3>' +
      '<div class="pl-tend">' + TENDENCIES.filter((g) => g.group !== 'Tournament' || p.formats.tournament).map((g) =>
        '<fieldset><legend>' + g.group + '</legend>' + g.items.map(([k, n]) =>
          '<label><input type="checkbox" data-tend="' + k + '"' + (p.tendencies[k] ? ' checked' : '') + '> ' + n + '</label>').join('') + '</fieldset>').join('') + '</div>' +
      (p.formats.tournament ? '' : '<p class="hint">Tick <em>Tournament</em> above to see tournament tendencies.</p>') +

      '<h3 class="tell-section">Write-ups</h3>' +
      SECTIONS.map(([k, title, ph]) => '<label class="mn-field pl-area">' + title + '<textarea data-section="' + k + '" rows="' + (k === 'tilt' ? 2 : 5) + '" placeholder="' + esc(ph) + '">' + esc(p.sections[k] || '') + '</textarea></label>').join('') +

      '<div class="pl-foot"><span class="hint">Added ' + p.created.slice(0, 10) + ' &middot; saves automatically</span>' +
        '<button type="button" class="primary" data-act="done">Done</button>' +
        '<button type="button" class="ghost" data-act="delete">Delete player</button></div>';
  }

  function renderEditor() {
    const box = el.querySelector('#pl-editor');
    const p = current();
    el.querySelector('.pl-layout').classList.toggle('editing', !!p);
    if (!p) {
      box.innerHTML = '<div class="pl-placeholder"><p>Pick a player from the list, or add a new one.</p></div>';
      return;
    }
    box.innerHTML = state.mode === 'edit' ? renderEdit(p) : renderProfile(p);
  }

  function select(id, mode) {
    state.selected = id;
    state.mode = mode || 'view';
    renderList();
    renderEditor();
    if (id && window.matchMedia('(max-width: 900px)').matches) el.querySelector('#pl-editor').scrollIntoView({ block: 'start' });
  }

  // ----- Export / import -----

  function exportNotes() {
    const blob = new Blob([JSON.stringify({ app: 'poker-board-analyzer', version: 2, exported: new Date().toISOString(), players: state.players }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'player-notes-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importNotes(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data) ? data : data.players;
        if (!Array.isArray(incoming)) throw new Error('not a notes file');
        const before = state.players.length;
        state.players = mergePlayers(state.players, incoming);
        save();
        renderList();
        renderEditor();
        el.querySelector('#pl-io-msg').textContent = 'Imported ' + incoming.length + ' player' + (incoming.length === 1 ? '' : 's') + ' (' + (state.players.length - before) + ' new).';
      } catch (e) {
        el.querySelector('#pl-io-msg').textContent = 'That file isn’t a player notes export.';
      }
    };
    reader.readAsText(file);
  }

  // ----- Wiring -----

  function render(container) {
    if (el === container && container.hasChildNodes()) { renderList(); renderEditor(); return; }
    el = container;
    load();
    el.innerHTML =
      '<div class="panel-head"><h2>Player book</h2><span class="hint">Saved in this browser &middot; use Export to back up or move them to another device</span></div>' +
      '<div class="pl-layout">' +
        '<aside class="pl-side">' +
          '<form class="pl-add" id="pl-add"><input id="pl-new-name" placeholder="New player name" autocomplete="off" maxlength="60"><button type="submit" class="primary">Add</button></form>' +
          '<input class="pl-search" id="pl-search" type="search" placeholder="Search names and notes" autocomplete="off">' +
          '<div class="pl-filters">' +
            '<select id="pl-format" aria-label="Format"><option value="">All formats</option>' + FORMATS.map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('') + '</select>' +
            '<select id="pl-game" aria-label="Game"><option value="">All games</option>' + GAMES.map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('') + '</select>' +
            '<select id="pl-sort" aria-label="Sort"><option value="updated">Recently updated</option><option value="priority">Priority</option><option value="name">Name A–Z</option></select>' +
          '</div>' +
          '<p class="pl-count hint" id="pl-count"></p>' +
          '<ul class="pl-list" id="pl-list"></ul>' +
          '<div class="pl-io"><button type="button" class="ghost" id="pl-export">Export notes</button>' +
            '<label class="pl-import ghost">Import<input type="file" id="pl-import" accept="application/json,.json" hidden></label></div>' +
          '<p class="hint" id="pl-io-msg"></p>' +
        '</aside>' +
        '<section class="pl-editor" id="pl-editor"></section>' +
      '</div>';

    el.querySelector('#pl-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = el.querySelector('#pl-new-name');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const p = newPlayer(name);
      state.players.push(p);
      input.value = '';
      save();
      select(p.id, 'edit');
    });
    el.querySelector('#pl-search').addEventListener('input', (e) => { state.filter.text = e.target.value; renderList(); if (state.mode === 'view') renderEditor(); });
    el.querySelector('#pl-format').addEventListener('change', (e) => { state.filter.format = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-game').addEventListener('change', (e) => { state.filter.game = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) select(b.dataset.pick, 'view');
    });
    el.querySelector('#pl-export').addEventListener('click', exportNotes);
    el.querySelector('#pl-import').addEventListener('change', (e) => { if (e.target.files[0]) importNotes(e.target.files[0]); e.target.value = ''; });

    const ed = el.querySelector('#pl-editor');
    ed.addEventListener('input', (e) => {
      const p = current();
      const t = e.target;
      if (!p) return;
      if (t.dataset.field && t.tagName !== 'SELECT') p[t.dataset.field] = t.value;
      else if (t.dataset.section) p.sections[t.dataset.section] = t.value;
      else if (t.dataset.leak) { const l = p.leaks.find((x) => x.id === t.dataset.leak); if (l) l[t.dataset.part] = t.value; }
      else return;
      touch(p);
      renderList();
    });
    ed.addEventListener('change', (e) => {
      const p = current();
      const t = e.target;
      if (!p) return;
      if (t.id === 'pb-note-cat') { state.noteCategory = t.value; return; }
      if (t.tagName === 'SELECT' && t.dataset.field) { p[t.dataset.field] = t.value; touch(p); renderList(); renderEditor(); }
      else if (t.dataset.plFormat) { p.formats[t.dataset.plFormat] = t.checked; touch(p); renderList(); renderEditor(); }
      else if (t.dataset.plGame) { p.games[t.dataset.plGame] = t.checked; touch(p); renderList(); }
      else if (t.dataset.tend) { if (t.checked) p.tendencies[t.dataset.tend] = true; else delete p.tendencies[t.dataset.tend]; touch(p); renderList(); }
      else if (t.dataset.field === 'name' && !t.value.trim()) { p.name = 'Unnamed player'; touch(p); renderList(); renderEditor(); }
    });
    ed.addEventListener('submit', (e) => {
      if (e.target.id !== 'pb-addnote') return;
      e.preventDefault();
      const p = current();
      const text = el.querySelector('#pb-note-text').value.trim();
      if (!p || !text) { el.querySelector('#pb-note-text').focus(); return; }
      state.noteCategory = el.querySelector('#pb-note-cat').value;
      p.log.push({ id: 'n' + Date.now().toString(36), date: el.querySelector('#pb-note-date').value || today(), category: state.noteCategory, text });
      touch(p);
      renderEditor();
      renderList();
    });
    ed.addEventListener('click', (e) => {
      const p = current();
      const t = e.target.closest('button');
      if (!p || !t) return;
      if (t.dataset.style !== undefined) {
        const val = t.dataset.value || null;
        if (val) p.style[t.dataset.style] = val; else delete p.style[t.dataset.style];
        touch(p); renderEditor(); renderList();
      } else if (t.dataset.priority !== undefined) {
        p.priority = +t.dataset.priority;
        touch(p); renderEditor(); renderList();
      } else if (t.dataset.tell) {
        const c = p.tells[t.dataset.tell] || (p.tells[t.dataset.tell] = { strong: 0, weak: 0 });
        c[t.dataset.way]++;
        touch(p); renderEditor();
      } else if (t.dataset.delLog) {
        if (!confirm('Delete this note?')) return;
        p.log = p.log.filter((x) => x.id !== t.dataset.delLog);
        touch(p); renderEditor(); renderList();
      } else if (t.dataset.delLeak) {
        p.leaks = p.leaks.filter((x) => x.id !== t.dataset.delLeak);
        touch(p); renderEditor();
      } else if (t.dataset.act) {
        const list = visible();
        const pos = list.findIndex((x) => x.id === p.id);
        const act = t.dataset.act;
        if (act === 'back') select(null);
        else if (act === 'prev' && pos > 0) select(list[pos - 1].id, state.mode);
        else if (act === 'next' && pos >= 0 && pos < list.length - 1) select(list[pos + 1].id, state.mode);
        else if (act === 'edit') { state.mode = 'edit'; renderEditor(); }
        else if (act === 'done') { state.mode = 'view'; renderEditor(); el.querySelector('#pl-editor').scrollIntoView({ block: 'start' }); }
        else if (act === 'add-leak') {
          p.leaks.push({ id: 'l' + Date.now().toString(36), leak: '', exploit: '' });
          touch(p); renderEditor();
          const inputs = el.querySelectorAll('[data-part="leak"]');
          if (inputs.length) inputs[inputs.length - 1].focus();
        } else if (act === 'delete' && confirm('Delete ' + p.name + ' and all their notes?')) {
          state.players = state.players.filter((x) => x.id !== p.id);
          save();
          select(null);
        }
      }
    });

    renderList();
    renderEditor();
  }

  root.Players = Object.assign({ render }, api);
})(typeof self !== 'undefined' ? self : this);
