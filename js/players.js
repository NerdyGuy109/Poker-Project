/*
 * Player notes: a list of players with style, tendencies, notes, a hand log and a tells tally.
 * Saved in this browser (localStorage), with export/import for moving between devices.
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

  // A quick label from the two most important switches.
  function playerType(p) {
    const lt = p.style.looseTight;
    const ap = p.style.aggPass;
    if (lt === 'loose' && ap === 'aggressive') return p.style.honesty === 'bluffy' ? 'Maniac (loose-aggressive, bluffy)' : 'LAG (loose-aggressive)';
    if (lt === 'tight' && ap === 'aggressive') return 'TAG (tight-aggressive)';
    if (lt === 'loose' && ap === 'passive') return 'Calling station (loose-passive)';
    if (lt === 'tight' && ap === 'passive') return 'Nit (tight-passive)';
    if (lt || ap) return [lt, ap].filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join(', ');
    return '';
  }

  // Short labels for the list: LAG, TAG, Station, Nit.
  function typeBadge(p) {
    const t = playerType(p);
    return t ? t.split(' (')[0].replace('Calling station', 'Station') : '';
  }

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

  function newPlayer(name) {
    const now = new Date().toISOString();
    return {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'New player',
      description: '',
      venue: '',
      stakes: '',
      formats: {},
      games: {},
      style: {},
      tendencies: {},
      notes: '',
      log: [],
      tells: {},
      created: now,
      updated: now,
    };
  }

  // Fills in any missing fields (older saves, imports).
  function normalize(p) {
    const base = newPlayer(p.name);
    const out = Object.assign(base, p);
    for (const k of ['formats', 'games', 'style', 'tendencies', 'tells']) out[k] = Object.assign({}, p[k] || {});
    out.log = Array.isArray(p.log) ? p.log.filter((e) => e && e.text) : [];
    return out;
  }

  // Players from the first version of the notebook (in the Tells tab).
  function migrateOld(old) {
    if (!old || !Array.isArray(old.players)) return [];
    return old.players.map((op) => normalize({ id: op.id, name: op.name, notes: op.notes || '', tells: op.tells || {} }));
  }

  // Search and filter. filter: { text, format, game }.
  function filterPlayers(players, filter) {
    const q = (filter.text || '').trim().toLowerCase();
    return players.filter((p) => {
      if (filter.format && !p.formats[filter.format]) return false;
      if (filter.game && !p.games[filter.game]) return false;
      if (!q) return true;
      const hay = [p.name, p.description, p.venue, p.stakes, p.notes, playerType(p)].concat(p.log.map((e) => e.text)).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function sortPlayers(list, by) {
    const out = list.slice();
    if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
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

  const api = { STYLES, TENDENCIES, TENDENCY_NAMES, playerType, typeBadge, adjustments, newPlayer, normalize, migrateOld, filterPlayers, sortPlayers, mergePlayers };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  const state = {
    players: [],
    selected: null,
    filter: { text: '', format: '', game: '' },
    sort: 'updated',
  };
  let el = null;

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  };

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { /* storage unavailable */ }
    if (saved && Array.isArray(saved.players)) {
      state.players = saved.players.map(normalize);
      return;
    }
    // First run: bring over players from the old notebook in the Tells tab.
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
      const badges = [typeBadge(p)].concat(FORMATS.filter(([k]) => p.formats[k]).map(([, n]) => n === 'Cash game' ? 'Cash' : n),
        GAMES.filter(([k]) => p.games[k]).map(([, n]) => n.replace('NL Hold’em', 'NLHE'))).filter(Boolean);
      const tags = Object.keys(p.tendencies).filter((k) => p.tendencies[k]).slice(0, 3).map((k) => TENDENCY_NAMES[k]);
      return '<li><button type="button" class="pl-item' + (p.id === state.selected ? ' active' : '') + '" data-pick="' + p.id + '">' +
        '<span class="pl-name">' + esc(p.name) + '</span>' +
        (p.description ? '<span class="pl-desc">' + esc(p.description) + '</span>' : '') +
        (badges.length ? '<span class="pl-badges">' + badges.map((b) => '<span class="pl-badge">' + esc(b) + '</span>').join('') + '</span>' : '') +
        (tags.length ? '<span class="pl-tags">' + tags.map(esc).join(' &middot; ') + '</span>' : '') +
        '<span class="pl-updated">Updated ' + fmtDate(p.updated) + '</span></button></li>';
    }).join('') : '<li class="hint pl-empty">' + (state.players.length ? 'No players match.' : 'No players yet. Add your first one above.') + '</li>';
  }

  // ----- Editor -----

  function renderEditor() {
    const box = el.querySelector('#pl-editor');
    const p = current();
    el.querySelector('.pl-layout').classList.toggle('editing', !!p);
    if (!p) {
      box.innerHTML = '<div class="pl-placeholder"><p>Pick a player from the list, or add a new one.</p></div>';
      return;
    }
    const list = visible();
    const pos = list.findIndex((x) => x.id === p.id);
    const seg = (st) => '<div class="pl-style"><span class="pl-style-name">' + st.left[1] + ' / ' + st.right[1] + '<span class="hint">' + st.hint + '</span></span>' +
      '<div class="pl-seg" role="radiogroup" aria-label="' + st.left[1] + ' or ' + st.right[1] + '">' +
      [st.left, [null, 'Not sure'], st.right].map(([val, label]) =>
        '<button type="button" role="radio" aria-checked="' + ((p.style[st.id] || null) === val) + '" class="' + ((p.style[st.id] || null) === val ? 'on' : '') +
        '" data-style="' + st.id + '" data-value="' + (val || '') + '">' + label + '</button>').join('') + '</div></div>';
    const showTourney = !!p.formats.tournament;
    const tips = adjustments(p);
    const type = playerType(p);
    const tellsData = (window.Tells && window.Tells.TELLS) || [];

    box.innerHTML =
      '<div class="pl-nav">' +
        '<button type="button" class="ghost pl-back" data-act="back">&larr; All players</button>' +
        '<span class="pl-pos">' + (pos >= 0 ? (pos + 1) + ' of ' + list.length : '') + '</span>' +
        '<button type="button" data-act="prev"' + (pos <= 0 ? ' disabled' : '') + ' aria-label="Previous player">&lsaquo; Prev</button>' +
        '<button type="button" data-act="next"' + (pos < 0 || pos >= list.length - 1 ? ' disabled' : '') + ' aria-label="Next player">Next &rsaquo;</button>' +
      '</div>' +
      '<input class="pl-title" data-field="name" value="' + esc(p.name) + '" aria-label="Player name" placeholder="Player name">' +
      '<div class="pl-row">' +
        '<label class="mn-field">Description<input data-field="description" value="' + esc(p.description) + '" placeholder="Seat 4, red cap, always wears headphones"></label>' +
        '<label class="mn-field">Where<input data-field="venue" value="' + esc(p.venue) + '" placeholder="Casino or home game"></label>' +
        '<label class="mn-field">Stakes<input data-field="stakes" value="' + esc(p.stakes) + '" placeholder="e.g. 2/5, $300 MTT"></label>' +
      '</div>' +
      '<div class="pl-row pl-checks">' +
        '<fieldset><legend>Format</legend>' + FORMATS.map(([k, n]) => '<label><input type="checkbox" data-pl-format="' + k + '"' + (p.formats[k] ? ' checked' : '') + '> ' + n + '</label>').join('') + '</fieldset>' +
        '<fieldset><legend>Games</legend>' + GAMES.map(([k, n]) => '<label><input type="checkbox" data-pl-game="' + k + '"' + (p.games[k] ? ' checked' : '') + '> ' + n + '</label>').join('') + '</fieldset>' +
      '</div>' +

      '<h3 class="tell-section">Style</h3>' +
      STYLES.map(seg).join('') +
      (type ? '<p class="pl-type">Player type: <strong>' + type + '</strong></p>' : '') +

      '<h3 class="tell-section">Tendencies</h3>' +
      '<div class="pl-tend">' + TENDENCIES.filter((g) => g.group !== 'Tournament' || showTourney).map((g) =>
        '<fieldset><legend>' + g.group + '</legend>' + g.items.map(([k, n]) =>
          '<label><input type="checkbox" data-tend="' + k + '"' + (p.tendencies[k] ? ' checked' : '') + '> ' + n + '</label>').join('') + '</fieldset>').join('') +
      '</div>' +
      (showTourney ? '' : '<p class="hint">Tick <em>Tournament</em> above to see tournament tendencies.</p>') +

      '<div class="box pl-tips"><strong>How to play against them</strong>' +
        (tips.length ? '<ul>' + tips.map((t) => '<li>' + t + '</li>').join('') + '</ul>' : '<p class="hint">Set their style and tick some tendencies to get suggestions here.</p>') + '</div>' +

      '<h3 class="tell-section">Notes</h3>' +
      '<textarea data-field="notes" rows="4" placeholder="Anything else: how they play big pots, what they showed down, who they’re friends with…">' + esc(p.notes) + '</textarea>' +

      '<h3 class="tell-section">Hand log</h3>' +
      '<form class="pl-log-form" id="pl-log-form"><input id="pl-log-text" placeholder="e.g. Shoved river with a missed flush draw" autocomplete="off"><button type="submit">Add</button></form>' +
      (p.log.length ? '<ul class="pl-log">' + p.log.slice().reverse().map((e) => '<li><span class="pl-log-date">' + fmtDate(e.date) + '</span><span>' + esc(e.text) + '</span>' +
        '<button type="button" class="link" data-del-log="' + e.id + '" aria-label="Delete this note">delete</button></li>').join('') + '</ul>' : '<p class="hint">Dated notes about specific hands, newest first.</p>') +

      (tellsData.length ? '<details class="pl-tells"' + (Object.keys(p.tells).length ? ' open' : '') + '><summary>Tells seen at showdown</summary>' +
        '<p class="hint">When you saw a tell and the cards were shown, tap whether they were strong or weak. After 3+ sightings a tell that matched at least 75% of the time is marked reliable.</p>' +
        '<div class="nb-table-wrap"><table class="nb-table"><tbody>' + tellsData.map((t) => {
          const c = p.tells[t.id] || { strong: 0, weak: 0 };
          const n = c.strong + c.weak;
          const way = c.strong >= c.weak ? 'strong' : 'weak';
          const lean = n >= 3 ? (Math.max(c.strong, c.weak) / n >= 0.75 ? '<span class="lean ' + way + '">Reliable: means ' + way + '</span>' : '<span class="lean mixed">Mixed</span>') : n ? '<span class="lean">Need more</span>' : '';
          return '<tr' + (n ? ' class="seen"' : '') + '><td>' + t.title + '</td>' +
            '<td class="nb-count"><button type="button" class="nb-btn strong" data-tell="' + t.id + '" data-way="strong">Strong +</button><span>' + c.strong + '</span></td>' +
            '<td class="nb-count"><button type="button" class="nb-btn weak" data-tell="' + t.id + '" data-way="weak">Weak +</button><span>' + c.weak + '</span></td><td>' + lean + '</td></tr>';
        }).join('') + '</tbody></table></div></details>' : '') +

      '<div class="pl-foot"><span class="hint">Added ' + fmtDate(p.created) + ' &middot; updated ' + fmtDate(p.updated) + ' &middot; saves automatically</span>' +
        '<button type="button" class="ghost" data-act="delete">Delete player</button></div>';
  }

  function select(id) {
    state.selected = id;
    renderList();
    renderEditor();
    if (id && window.matchMedia('(max-width: 900px)').matches) el.querySelector('#pl-editor').scrollIntoView({ block: 'start' });
  }

  // ----- Export / import -----

  function exportNotes() {
    const blob = new Blob([JSON.stringify({ app: 'poker-board-analyzer', version: 1, exported: new Date().toISOString(), players: state.players }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'player-notes-' + new Date().toISOString().slice(0, 10) + '.json';
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
      '<div class="panel-head"><h2>Player notes</h2><span class="hint">Saved in this browser &middot; use Export to back up or move them to another device</span></div>' +
      '<div class="pl-layout">' +
        '<aside class="pl-side">' +
          '<form class="pl-add" id="pl-add"><input id="pl-new-name" placeholder="New player name" autocomplete="off" maxlength="60"><button type="submit" class="primary">Add</button></form>' +
          '<input class="pl-search" id="pl-search" type="search" placeholder="Search names and notes" autocomplete="off">' +
          '<div class="pl-filters">' +
            '<select id="pl-format" aria-label="Format"><option value="">All formats</option>' + FORMATS.map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('') + '</select>' +
            '<select id="pl-game" aria-label="Game"><option value="">All games</option>' + GAMES.map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('') + '</select>' +
            '<select id="pl-sort" aria-label="Sort"><option value="updated">Recently updated</option><option value="name">Name A–Z</option></select>' +
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
      select(p.id);
    });
    el.querySelector('#pl-search').addEventListener('input', (e) => { state.filter.text = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-format').addEventListener('change', (e) => { state.filter.format = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-game').addEventListener('change', (e) => { state.filter.game = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); renderEditor(); });
    el.querySelector('#pl-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) select(b.dataset.pick);
    });
    el.querySelector('#pl-export').addEventListener('click', exportNotes);
    el.querySelector('#pl-import').addEventListener('change', (e) => { if (e.target.files[0]) importNotes(e.target.files[0]); e.target.value = ''; });

    const ed = el.querySelector('#pl-editor');
    ed.addEventListener('input', (e) => {
      const p = current();
      if (!p || !e.target.dataset.field) return;
      p[e.target.dataset.field] = e.target.value;
      touch(p);
      renderList();
    });
    ed.addEventListener('change', (e) => {
      const p = current();
      const t = e.target;
      if (!p) return;
      if (t.dataset.plFormat) { p.formats[t.dataset.plFormat] = t.checked; touch(p); renderList(); renderEditor(); }
      else if (t.dataset.plGame) { p.games[t.dataset.plGame] = t.checked; touch(p); renderList(); }
      else if (t.dataset.tend) { if (t.checked) p.tendencies[t.dataset.tend] = true; else delete p.tendencies[t.dataset.tend]; touch(p); renderList(); renderEditor(); }
      else if (t.dataset.field === 'name' && !t.value.trim()) { p.name = 'Unnamed player'; touch(p); renderList(); renderEditor(); }
    });
    ed.addEventListener('submit', (e) => {
      if (e.target.id !== 'pl-log-form') return;
      e.preventDefault();
      const p = current();
      const input = el.querySelector('#pl-log-text');
      if (!p || !input.value.trim()) return;
      p.log.push({ id: 'n' + Date.now().toString(36), date: new Date().toISOString(), text: input.value.trim() });
      touch(p);
      renderEditor();
      renderList();
      el.querySelector('#pl-log-text').focus();
    });
    ed.addEventListener('click', (e) => {
      const p = current();
      const t = e.target.closest('button');
      if (!p || !t) return;
      if (t.dataset.style !== undefined) {
        const val = t.dataset.value || null;
        if (val) p.style[t.dataset.style] = val; else delete p.style[t.dataset.style];
        touch(p); renderEditor(); renderList();
      } else if (t.dataset.tell) {
        const c = p.tells[t.dataset.tell] || (p.tells[t.dataset.tell] = { strong: 0, weak: 0 });
        c[t.dataset.way]++;
        touch(p); renderEditor();
      } else if (t.dataset.delLog) {
        p.log = p.log.filter((x) => x.id !== t.dataset.delLog);
        touch(p); renderEditor(); renderList();
      } else if (t.dataset.act) {
        const list = visible();
        const pos = list.findIndex((x) => x.id === p.id);
        if (t.dataset.act === 'back') select(null);
        else if (t.dataset.act === 'prev' && pos > 0) select(list[pos - 1].id);
        else if (t.dataset.act === 'next' && pos >= 0 && pos < list.length - 1) select(list[pos + 1].id);
        else if (t.dataset.act === 'delete' && confirm('Delete ' + p.name + ' and all their notes?')) {
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
