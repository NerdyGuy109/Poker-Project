/*
 * Tournament buy-ins: photograph a receipt, read it on the device (Tesseract OCR) to fill in the
 * venue, event, date, amounts, table and seat, and keep a log with the photo as proof.
 * Entries and photos are saved in this browser (IndexedDB), with JSON and CSV export. Finished
 * tournaments are archived to the Results tab. Uses window.Receipt for reading the text and
 * window.Results for result helpers.
 */
(function () {
  'use strict';

  const DB_NAME = 'poker-analyzer-buyins';
  const OCR_SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  const OCR_PATHS = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
  };
  const GAMES = [['', '–'], ['nlhe', 'NL Hold’em'], ['omaha', 'Omaha'], ['mixed', 'Mixed / other']];
  const ENTRY_TYPES = [['entry', 'First entry'], ['reentry', 'Re-entry'], ['addon', 'Add-on']];

  const state = {
    entries: [],
    editing: null, // the entry in the form, or null for the list
    photo: null, // the form's photo (Blob)
    isNew: false,
    ocr: '', // status line while reading
    year: '',
    dbError: '',
    returnTo: '', // the tab to go back to after editing ('results' when opened from there)
  };
  let el = null;
  const urls = new Map(); // photo object URLs by entry id

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(+x) ? '' : '$' + (+x).toLocaleString(undefined, { minimumFractionDigits: +x % 1 ? 2 : 0, maximumFractionDigits: 2 }));
  const pad = (n) => String(n).padStart(2, '0');
  const localStamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const nice = (stamp) => {
    if (!stamp) return '';
    const d = new Date(stamp.length <= 16 ? stamp + (stamp.length === 10 ? 'T00:00' : '') : stamp);
    if (isNaN(d)) return stamp;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + (stamp.length > 10 ? ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
  };

  // ---------------------------------------------------------------------------
  // Storage (IndexedDB: entries, and photos by entry id)
  // ---------------------------------------------------------------------------

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('This browser can’t save data (private mode?).')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('entries', { keyPath: 'id' });
          req.result.createObjectStore('photos');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const getAll = () => tx('entries', 'readonly', (s) => s.getAll());
  const getPhoto = (id) => tx('photos', 'readonly', (s) => s.get(id));
  const putEntry = (e) => tx('entries', 'readwrite', (s) => s.put(e));
  const putPhoto = (id, blob) => tx('photos', 'readwrite', (s) => s.put(blob, id));
  const delEntry = async (id) => { await tx('entries', 'readwrite', (s) => s.delete(id)); await tx('photos', 'readwrite', (s) => s.delete(id)); };

  async function load() {
    try {
      state.entries = (await getAll()).map(upgrade);
      state.dbError = '';
    } catch (e) {
      state.entries = [];
      state.dbError = e.message || 'Saving isn’t available in this browser.';
    }
  }

  async function photoURL(id) {
    if (urls.has(id)) return urls.get(id);
    const blob = await getPhoto(id).catch(() => null);
    if (!blob) return '';
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    return u;
  }

  // ---------------------------------------------------------------------------
  // Photos and reading them
  // ---------------------------------------------------------------------------

  // Shrinks a camera photo to at most 2000px on the long side (plenty for reading and proof).
  async function shrink(file) {
    let img;
    try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {
      img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That file isn’t a photo this browser can open.')); i.src = URL.createObjectURL(file); });
    }
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
  }

  let ocrWorker = null;
  function loadOcr() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OCR_SCRIPT;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Couldn’t download the text reader. Check your connection, or fill in the details by hand.'));
      document.head.appendChild(s);
    });
  }

  async function readPhoto(blob, onStatus) {
    onStatus('Getting the text reader ready (first time only, a few MB)…');
    await loadOcr();
    if (!ocrWorker) {
      ocrWorker = await window.Tesseract.createWorker('eng', 1, Object.assign({
        logger: (m) => { if (m.status === 'recognizing text') onStatus('Reading the receipt… ' + Math.round(100 * m.progress) + '%'); },
      }, OCR_PATHS));
    }
    onStatus('Reading the receipt…');
    const r = await ocrWorker.recognize(blob);
    return r.data.text || '';
  }

  // Where you are now, for proof of where you bought in (asks permission the first time).
  function locate() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), accuracy: Math.round(p.coords.accuracy), at: new Date().toISOString() }),
        () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }

  // Older entries kept the finish as text ("22nd of 640"): split it into place and entrants.
  function upgrade(e) {
    if (typeof e.place === 'string' && e.place && !/^\d+$/.test(e.place)) {
      const r = window.Results.parsePlace(e.place);
      e.place = r.place;
      if (e.entrants === undefined || e.entrants === '') e.entrants = r.entrants;
    }
    if (e.entrants === undefined) e.entrants = '';
    if (e.archived === undefined) e.archived = false;
    if (!ENTRY_TYPES.some((t) => t[0] === e.entryType)) e.entryType = 'entry';
    return e;
  }

  function newEntry() {
    const now = new Date();
    return {
      id: 'b' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
      created: now.toISOString(), photoTaken: '', date: localStamp(now),
      venue: '', location: '', event: '', game: '', entryType: 'entry',
      buyIn: '', fee: '', total: '', payment: '', table: '', seat: '', stack: '', receiptNo: '', player: '',
      cashed: '', place: '', entrants: '', archived: false, finishedAt: '', notes: '', geo: null, hasPhoto: false, ocrText: '',
    };
  }

  // Fills the form's empty fields from the receipt text (keeps anything already typed).
  function applyReceipt(e, text) {
    const r = window.Receipt.parseReceipt(text);
    e.ocrText = text;
    const filled = [];
    for (const k of ['venue', 'location', 'event', 'game', 'table', 'seat', 'stack', 'receiptNo', 'payment', 'player']) {
      if (r[k] && !e[k]) { e[k] = r[k]; filled.push(k); }
    }
    for (const k of ['buyIn', 'fee', 'total']) if (r[k] !== null && e[k] === '') { e[k] = r[k]; filled.push(k); }
    if (r.entryType !== 'entry' && e.entryType === 'entry') { e.entryType = r.entryType; filled.push('entryType'); }
    if (r.date) { e.date = r.date.length === 10 ? r.date + e.date.slice(10) : r.date; filled.push('date'); }
    return filled;
  }

  async function startFromPhoto(file) {
    const e = newEntry();
    e.photoTaken = file.lastModified ? new Date(file.lastModified).toISOString() : '';
    if (e.photoTaken) e.date = localStamp(new Date(file.lastModified));
    state.editing = e;
    state.isNew = true;
    state.ocr = 'Preparing the photo…';
    state.filled = [];
    try {
      state.photo = await shrink(file);
      e.hasPhoto = true;
    } catch (ex) {
      state.ocr = ex.message;
      renderForm();
      return;
    }
    renderForm();
    locate().then((g) => { if (state.editing === e && g) { e.geo = g; renderProof(); } });
    try {
      const text = await readPhoto(state.photo, (s) => { if (state.editing === e) { state.ocr = s; const st = el.querySelector('#bi-ocr'); if (st) st.textContent = s; } });
      if (state.editing !== e) return;
      syncForm();
      state.filled = applyReceipt(e, text);
      state.ocr = state.filled.length ? 'Filled in ' + state.filled.length + ' detail' + (state.filled.length === 1 ? '' : 's') + ' from the receipt. Check them, then save.' : 'Couldn’t find any details in the text. Fill them in by hand; the photo is still saved.';
    } catch (ex) {
      state.ocr = ex.message || 'Couldn’t read the receipt.';
    }
    if (state.editing === e) renderForm();
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  const visibleEntries = () => state.entries.filter((e) => !e.archived && (!state.year || (e.date || '').startsWith(state.year)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created.localeCompare(a.created));

  function totals(list) {
    const spent = list.reduce((s, e) => s + (+e.total || 0), 0);
    const cashed = list.reduce((s, e) => s + (+e.cashed || 0), 0);
    return { count: list.length, spent, cashed, profit: cashed - spent, roi: spent ? (cashed - spent) / spent : null };
  }

  function render(container) {
    el = container;
    if (!el.dataset.ready) {
      el.dataset.ready = '1';
      bind();
    }
    load().then(() => {
      if (state.pendingOpen) {
        const id = state.pendingOpen;
        state.pendingOpen = '';
        if (openForm(id)) return;
        state.returnTo = '';
      }
      if (state.editing) renderForm(); else renderList();
    });
  }

  function renderList() {
    const list = visibleEntries();
    const t = totals(list);
    const years = [...new Set(state.entries.filter((e) => !e.archived).map((e) => (e.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const archived = state.entries.filter((e) => e.archived).length;
    el.innerHTML =
      '<div class="panel-head"><h2>Tournament buy-ins</h2><span class="hint">Photos and details are saved on this device only &middot; export to back them up</span></div>' +
      (state.dbError ? '<p class="board-error">' + esc(state.dbError) + '</p>' : '') +
      '<div class="bi-actions">' +
        '<label class="primary bi-btn">&#128247; Scan a receipt<input type="file" accept="image/*" capture="environment" id="bi-camera" hidden></label>' +
        '<label class="bi-btn">Choose a photo<input type="file" accept="image/*" id="bi-file" hidden></label>' +
        '<button type="button" class="ghost" data-act="manual">+ Add by hand</button>' +
      '</div>' +
      '<p class="hint">Take a picture of the receipt or table assignment. The app reads it on your device to fill in the venue, event, date and time, buy-in, fee, table and seat, and keeps the photo as proof. ' +
        'When a tournament is over, open it, add your finish and cash, and move it to Results.</p>' +
      '<h3 class="bi-h">Active buy-ins</h3>' +
      '<div class="bi-totals">' +
        '<label class="mn-field">Year<select id="bi-year"><option value="">All</option>' + years.map((y) => '<option' + (y === state.year ? ' selected' : '') + '>' + y + '</option>').join('') + '</select></label>' +
        '<div class="mn-stat"><span>Entries</span><strong>' + t.count + '</strong></div>' +
        '<div class="mn-stat"><span>Spent</span><strong>' + (money(t.spent) || '$0') + '</strong></div>' +
        '<div class="mn-stat"><span>Cashed</span><strong>' + (money(t.cashed) || '$0') + '</strong></div>' +
        '<div class="mn-stat"><span>Profit</span><strong class="' + (t.profit < 0 ? 'neg' : t.profit > 0 ? 'pos' : '') + '">' + (t.profit < 0 ? '−' : '') + (money(Math.abs(t.profit)) || '$0') + '</strong></div>' +
        '<div class="mn-stat"><span>ROI</span><strong>' + (t.roi === null ? '–' : (100 * t.roi).toFixed(0) + '%') + '</strong></div>' +
      '</div>' +
      (list.length ? '<ul class="bi-list">' + list.map((e) =>
        '<li><button type="button" class="bi-item" data-open="' + e.id + '">' +
          (e.hasPhoto ? '<img class="bi-thumb" data-thumb="' + e.id + '" alt="">' : '<span class="bi-thumb bi-nophoto">No photo</span>') +
          '<span class="bi-main"><span class="bi-date">' + esc(nice(e.date)) + '</span>' +
            '<span class="bi-venue">' + esc(e.venue || 'Unknown venue') + (e.location ? ' <span class="muted">&middot; ' + esc(e.location) + '</span>' : '') + '</span>' +
            (e.event ? '<span class="bi-event">' + esc(e.event) + '</span>' : '') +
            '<span class="bi-tags">' + (e.entryType !== 'entry' ? '<span class="pl-badge">' + ENTRY_TYPES.find((x) => x[0] === e.entryType)[1] + '</span>' : '') +
              (e.table ? '<span class="pl-badge">Table ' + esc(e.table) + (e.seat ? ', seat ' + esc(e.seat) : '') + '</span>' : '') +
              (+e.cashed ? '<span class="pl-badge bi-cash">Cashed ' + money(e.cashed) + '</span>' : '') +
              (e.place ? '<span class="pl-badge">' + window.Results.ordinal(+e.place) + (e.entrants ? ' of ' + e.entrants : '') + '</span>' : '') + '</span>' +
          '</span><span class="bi-amt">' + (money(e.total) || '–') + '</span></button></li>').join('') + '</ul>'
        : '<p class="bi-empty">No active buy-ins' + (state.year ? ' in ' + state.year : '') + '.</p>') +
      (archived ? '<p class="bi-archived">' + archived + ' finished buy-in' + (archived === 1 ? ' is' : 's are') + ' in <button type="button" class="link" data-act="go-results">Results</button>.</p>' : '') +
      '<div class="pl-io"><button type="button" class="ghost" data-act="export">Backup (with photos)</button>' +
        '<button type="button" class="ghost" data-act="csv">Spreadsheet (CSV)</button>' +
        '<label class="pl-import ghost">Import backup<input type="file" id="bi-import" accept="application/json,.json" hidden></label></div>' +
      '<p class="hint" id="bi-msg"></p>';
    el.querySelectorAll('[data-thumb]').forEach(async (img) => { img.src = await photoURL(img.dataset.thumb); });
  }

  function renderForm() {
    const e = state.editing;
    const f = (k, label, type, ph, extra) => '<label class="mn-field' + (state.filled && state.filled.includes(k) ? ' bi-filled' : '') + '">' + label +
      '<input data-f="' + k + '" type="' + (type || 'text') + '" value="' + esc(e[k]) + '" placeholder="' + esc(ph || '') + '"' + (extra || '') + '></label>';
    const sel = (k, label, opts) => '<label class="mn-field' + (state.filled && state.filled.includes(k) ? ' bi-filled' : '') + '">' + label + '<select data-f="' + k + '">' +
      opts.map(([v, n]) => '<option value="' + v + '"' + (e[k] === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>';
    const money$ = ' inputmode="decimal" step="0.01" min="0"';
    el.innerHTML =
      '<div class="bi-nav"><button type="button" class="link" data-act="cancel">&larr; ' + (state.returnTo === 'results' ? 'Results' : 'All buy-ins') + '</button></div>' +
      '<h2 class="bi-title">' + (state.isNew ? 'New buy-in' : esc(e.venue || 'Buy-in')) + (e.archived ? ' <span class="pl-badge">In Results</span>' : '') + '</h2>' +
      '<div class="bi-form">' +
        '<div class="bi-photo">' + (e.hasPhoto ? '<a id="bi-photo-link" target="_blank" rel="noopener"><img id="bi-photo" alt="Receipt photo"></a><span class="hint">Tap the photo to see it full size.</span>' : '<p class="hint">No photo.</p>') +
          '<label class="bi-btn ghost">' + (e.hasPhoto ? 'Replace photo' : 'Add a photo') + '<input type="file" accept="image/*" capture="environment" id="bi-replace" hidden></label></div>' +
        '<div class="bi-fields">' +
          (state.ocr ? '<p class="bi-ocr" id="bi-ocr" role="status">' + esc(state.ocr) + '</p>' : '') +
          '<div class="bi-grid">' +
            f('date', 'Date and time', 'datetime-local') + f('venue', 'Venue', 'text', 'e.g. Bellagio') + f('location', 'City / location', 'text', 'e.g. Las Vegas, NV') +
            f('event', 'Event', 'text', 'e.g. Event #12 $600 NLH Deepstack', ' class="bi-wide"') + sel('game', 'Game', GAMES) + sel('entryType', 'Entry', ENTRY_TYPES) +
            f('buyIn', 'Buy-in (prize pool)', 'number', '', money$) + f('fee', 'Fee / rake', 'number', '', money$) + f('total', 'Total paid', 'number', '', money$) +
            f('payment', 'Paid with', 'text', 'Cash, card…') + f('table', 'Table', 'text') + f('seat', 'Seat', 'text') + f('stack', 'Starting stack', 'text') +
            f('receiptNo', 'Receipt / ticket #', 'text') + f('player', 'Name on receipt', 'text') +
          '</div>' +
          '<fieldset class="bi-result"><legend>Result</legend><div class="bi-grid">' +
            f('place', 'Finished (place)', 'number', 'e.g. 14', ' inputmode="numeric" min="1" step="1"') + f('entrants', 'Entrants', 'number', 'e.g. 312', ' inputmode="numeric" min="1" step="1"') +
            f('cashed', 'Cashed ($)', 'number', '0', money$) +
          '</div><p class="hint">For re-entries, put the result on any one of the entries.</p></fieldset>' +
          '<label class="mn-field pl-area">Notes<textarea data-f="notes" rows="2" placeholder="Anything else: bag number, late reg, who was at the table…">' + esc(e.notes) + '</textarea></label>' +
          '<div class="bi-proof" id="bi-proof"></div>' +
          (e.ocrText ? '<details class="bi-raw"><summary>Text read from the photo</summary><pre>' + esc(e.ocrText) + '</pre></details>' : '') +
          '<div class="pl-foot"><button type="button" class="primary" data-act="save">Save</button>' +
            (e.archived ? '<button type="button" data-act="unarchive">Move back to Buy-ins</button>' : '<button type="button" data-act="archive">Save &amp; move to Results</button>') +
            '<button type="button" class="ghost" data-act="cancel">Cancel</button>' +
            (state.isNew ? '' : '<button type="button" class="ghost" data-act="delete">Delete</button>') + '</div>' +
        '</div>' +
      '</div>';
    renderProof();
    if (e.hasPhoto) {
      const show = (u) => { const img = el.querySelector('#bi-photo'); if (img) { img.src = u; el.querySelector('#bi-photo-link').href = u; } };
      if (state.photo) { const u = URL.createObjectURL(state.photo); state.formURL && URL.revokeObjectURL(state.formURL); state.formURL = u; show(u); } else photoURL(e.id).then(show);
    }
  }

  // The proof box: when the photo was taken, when it was logged, and where you were.
  function renderProof() {
    const box = el && el.querySelector('#bi-proof');
    if (!box || !state.editing) return;
    const e = state.editing;
    const g = e.geo;
    box.innerHTML = '<h4>Proof</h4><dl>' +
      (e.photoTaken ? '<dt>Photo taken</dt><dd>' + esc(nice(e.photoTaken)) + '</dd>' : '') +
      '<dt>Logged</dt><dd>' + esc(nice(e.created)) + '</dd>' +
      '<dt>Your location</dt><dd>' + (g ? esc(g.lat + ', ' + g.lon) + ' <span class="muted">(&plusmn;' + g.accuracy + ' m)</span> &middot; <a href="https://www.openstreetmap.org/?mlat=' + g.lat + '&mlon=' + g.lon + '#map=17/' + g.lat + '/' + g.lon + '" target="_blank" rel="noopener">map</a>'
        : 'Not saved') + '</dd></dl>' +
      '<p><button type="button" class="ghost" data-act="geo">' + (g ? 'Update my location' : 'Add my current location') + '</button>' +
      (g ? '<button type="button" class="link" data-act="nogeo">Remove location</button>' : '') + '</p>';
  }

  // Copies the form's inputs into the entry.
  function syncForm() {
    const e = state.editing;
    if (!e || !el.querySelector('.bi-form')) return;
    el.querySelectorAll('[data-f]').forEach((i) => { e[i.dataset.f] = i.value.trim(); });
  }

  // archive: true moves the entry (and its re-entries into the same event) to Results, false moves it back.
  async function save(archive) {
    syncForm();
    const e = state.editing;
    for (const k of ['buyIn', 'fee', 'total', 'cashed', 'place', 'entrants']) e[k] = e[k] === '' || !Number.isFinite(+e[k]) ? '' : +e[k];
    const siblings = [];
    if (archive !== undefined) {
      e.archived = archive;
      e.finishedAt = archive ? new Date().toISOString() : '';
      const key = window.Results.groupKey(e);
      for (const o of state.entries) if (o.id !== e.id && o.archived !== archive && window.Results.groupKey(o) === key) siblings.push(Object.assign({}, o, { archived: archive, finishedAt: e.finishedAt }));
    }
    if (e.total === '' && (e.buyIn !== '' || e.fee !== '')) e.total = (+e.buyIn || 0) + (+e.fee || 0);
    try {
      if (state.photo) {
        await putPhoto(e.id, state.photo);
        if (urls.has(e.id)) { URL.revokeObjectURL(urls.get(e.id)); urls.delete(e.id); }
      }
      await putEntry(e);
      for (const o of siblings) await putEntry(o);
    } catch (ex) {
      state.ocr = 'Couldn’t save: ' + (ex.message || ex);
      renderForm();
      return;
    }
    closeForm();
    if (leave()) return;
    await load();
    renderList();
  }

  // After editing an entry opened from Results, go back there.
  function leave() {
    const back = state.returnTo;
    state.returnTo = '';
    if (back !== 'results') return false;
    const tab = document.querySelector('[data-view="results"]');
    if (tab) tab.click();
    return !!tab;
  }

  function closeForm() {
    state.editing = null;
    state.photo = null;
    state.ocr = '';
    state.filled = [];
  }

  // ----- Export / import -----

  const blobToDataURL = (b) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(b); });
  function download(name, type, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function exportJSON() {
    const out = [];
    for (const e of state.entries) {
      const photo = e.hasPhoto ? await getPhoto(e.id).catch(() => null) : null;
      out.push(Object.assign({}, e, { photo: photo ? await blobToDataURL(photo) : null }));
    }
    download('poker-buyins-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json',
      JSON.stringify({ app: 'poker-board-analyzer', kind: 'buyins', version: 1, exported: new Date().toISOString(), entries: out }));
  }

  function exportCSV() {
    const cols = [['date', 'Date'], ['venue', 'Venue'], ['location', 'Location'], ['event', 'Event'], ['game', 'Game'], ['entryType', 'Entry'], ['buyIn', 'Buy-in'], ['fee', 'Fee'],
      ['total', 'Total paid'], ['payment', 'Paid with'], ['table', 'Table'], ['seat', 'Seat'], ['stack', 'Starting stack'], ['receiptNo', 'Receipt #'], ['cashed', 'Cashed'], ['place', 'Finish'], ['entrants', 'Entrants'], ['archived', 'In Results'],
      ['photoTaken', 'Photo taken'], ['created', 'Logged'], ['lat', 'Latitude'], ['lon', 'Longitude'], ['notes', 'Notes']];
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const label = (list, v) => (list.find((x) => x[0] === v) || [v, v])[1];
    const value = (e, k) => (k === 'lat' || k === 'lon' ? (e.geo ? e.geo[k] : '') : k === 'game' ? (e.game ? label(GAMES, e.game) : '') : k === 'entryType' ? label(ENTRY_TYPES, e.entryType) : k === 'archived' ? (e.archived ? 'Yes' : 'No') : e[k]);
    const rows = state.entries.filter((e) => !state.year || (e.date || '').startsWith(state.year)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => cols.map(([k]) => cell(value(e, k))).join(','));
    download('poker-buyins' + (state.year ? '-' + state.year : '') + '.csv', 'text/csv', [cols.map((c) => c[1]).join(',')].concat(rows).join('\n'));
  }

  async function importJSON(file) {
    const msg = () => el.querySelector('#bi-msg');
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(list)) throw new Error('not a buy-ins backup');
      const have = new Set(state.entries.map((e) => e.id));
      let added = 0;
      for (const raw of list) {
        if (!raw || !raw.id || have.has(raw.id)) continue;
        const e = upgrade(Object.assign(newEntry(), raw));
        delete e.photo;
        if (raw.photo) { const blob = await (await fetch(raw.photo)).blob(); await putPhoto(e.id, blob); e.hasPhoto = true; }
        await putEntry(e);
        added++;
      }
      await load();
      renderList();
      if (msg()) msg().textContent = 'Imported ' + added + ' buy-in' + (added === 1 ? '' : 's') + (list.length - added ? ' (' + (list.length - added) + ' already here)' : '') + '.';
    } catch (ex) {
      if (msg()) msg().textContent = 'Couldn’t import that file: ' + ex.message;
    }
  }

  // ----- Events -----

  function bind() {
    el.addEventListener('change', (ev) => {
      const t = ev.target;
      if ((t.id === 'bi-camera' || t.id === 'bi-file') && t.files[0]) { startFromPhoto(t.files[0]); t.value = ''; } else if (t.id === 'bi-replace' && t.files[0]) {
        syncForm();
        const e = state.editing;
        const file = t.files[0];
        shrink(file).then(async (blob) => {
          state.photo = blob;
          e.hasPhoto = true;
          e.photoTaken = file.lastModified ? new Date(file.lastModified).toISOString() : e.photoTaken;
          state.ocr = 'Reading the new photo…';
          renderForm();
          try {
            const text = await readPhoto(blob, (s) => { const st = el.querySelector('#bi-ocr'); if (st) st.textContent = s; });
            syncForm();
            state.filled = applyReceipt(e, text);
            state.ocr = state.filled.length ? 'Filled in ' + state.filled.length + ' empty detail' + (state.filled.length === 1 ? '' : 's') + ' from the new photo.' : 'Nothing new found in the photo.';
          } catch (ex) { state.ocr = ex.message; }
          if (state.editing === e) renderForm();
        }).catch((ex) => { state.ocr = ex.message; renderForm(); });
      } else if (t.id === 'bi-year') { state.year = t.value; renderList(); } else if (t.id === 'bi-import' && t.files[0]) { importJSON(t.files[0]); t.value = ''; }
    });
    el.addEventListener('click', async (ev) => {
      const open = ev.target.closest('[data-open]');
      if (open) { state.returnTo = ''; openForm(open.dataset.open); return; }
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'manual') { state.editing = newEntry(); state.isNew = true; state.photo = null; state.ocr = ''; state.filled = []; renderForm(); } else if (act === 'save') save();
      else if (act === 'archive') save(true);
      else if (act === 'unarchive') save(false);
      else if (act === 'go-results') { const tab = document.querySelector('[data-view="results"]'); if (tab) tab.click(); } else if (act === 'cancel') { closeForm(); if (!leave()) renderList(); } else if (act === 'delete') {
        if (!confirm('Delete this buy-in and its photo?')) return;
        await delEntry(state.editing.id).catch(() => {});
        closeForm();
        if (leave()) return;
        await load();
        renderList();
      } else if (act === 'geo') {
        syncForm();
        b.disabled = true;
        b.textContent = 'Finding you…';
        const g = await locate();
        if (state.editing) { if (g) state.editing.geo = g; renderProof(); }
        if (!g) { const p = el.querySelector('#bi-proof p'); if (p) p.insertAdjacentHTML('beforeend', '<span class="board-error">Location not available (permission denied or no signal).</span>'); }
      } else if (act === 'nogeo') { state.editing.geo = null; renderProof(); } else if (act === 'export') exportJSON();
      else if (act === 'csv') exportCSV();
    });
  }

  function openForm(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return false;
    state.editing = Object.assign({}, e);
    state.isNew = false;
    state.photo = null;
    state.ocr = '';
    state.filled = [];
    renderForm();
    el.scrollIntoView({ block: 'start' });
    return true;
  }

  // Opens an entry's form from another tab (Results); `returnTo` is the tab to go back to.
  function openEntry(id, returnTo) {
    closeForm();
    state.pendingOpen = id;
    state.returnTo = returnTo || '';
    const tab = document.querySelector('[data-view="buyins"]');
    if (tab) tab.click(); else if (el) render(el);
  }

  window.BuyIns = { render, openEntry, store: { getAll: () => getAll().then((list) => list.map(upgrade)) } };
})();
