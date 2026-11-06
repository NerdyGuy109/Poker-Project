/*
 * Reads the text of a tournament receipt (from OCR) into log fields: venue, location, event,
 * game, date and time, buy-in, fee and total, table and seat, starting stack, receipt number.
 * No DOM access, so tests can load it in Node.
 */
(function (root) {
  'use strict';

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = (n) => String(n).padStart(2, '0');

  // Common OCR slips inside numbers: O for 0, l or I for 1, S for $ before a digit.
  const fixDigits = (s) => s.replace(/[\dOo][\dOo,.]*[\dOo]/g, (t) => (/\d/.test(t) ? t.replace(/[Oo]/g, '0') : t)).replace(/(?<=\d)[lI]|[lI](?=\d{2})/g, '1').replace(/\bS(?=\s?\d)/g, '$');

  // The last money amount on a line ("$1,100.00", "340.00", "$60"), or null.
  function moneyOf(line) {
    const re = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?\b/g;
    let m;
    let best = null;
    while ((m = re.exec(line))) {
      if (!m[1] && !m[3]) continue; // a bare number (table 42) is not money
      best = parseFloat(m[2].replace(/,/g, '') + (m[3] || ''));
    }
    return best;
  }

  function dateOf(text) {
    const t = text.toLowerCase();
    let y, mo, d;
    let m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(t);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else if ((m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(t))) {
      mo = +m[1]; d = +m[2]; y = +m[3];
      if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // day first
    } else if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(t))) {
      mo = MONTHS.indexOf(m[1]) + 1; d = +m[2]; y = +m[3];
    } else if ((m = /\b(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+(\d{2,4})\b/.exec(t))) {
      d = +m[1]; mo = MONTHS.indexOf(m[2]) + 1; y = +m[3];
    } else return '';
    if (y < 100) y += 2000;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100)) return '';
    let time = '';
    const tm = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s?m?\b/.exec(t.slice(m.index)) || /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s?m?\b/.exec(t);
    if (tm) {
      let h = +tm[1];
      if (tm[3] === 'p' && h < 12) h += 12;
      if (tm[3] === 'a' && h === 12) h = 0;
      if (h < 24 && +tm[2] < 60) time = pad(h) + ':' + tm[2];
    }
    return y + '-' + pad(mo) + '-' + pad(d) + (time ? 'T' + time : '');
  }

  const VENUE_WORDS = /\b(casino|poker room|card ?room|resort|hotel|club|lounge|palace|racetrack|racino|gaming|bellagio|wynn|aria|venetian|borgata|seminole|commerce|bicycle|foxwoods|mohegan|horseshoe|caesars|harrah'?s|mgm|rio|orleans|golden nugget|hard rock|thunder valley|windsor|parx|choctaw|winstar|lucky chances|bike)\b/i;
  const CITY_LINE = /^[A-Za-z .'-]+,\s*[A-Z]{2}\b(?:\s+\d{5}(?:-\d{4})?)?$/;
  const EVENT_WORDS = /\b(event|ev|tournament|hold.?em|nlh|nlhe|plo\d?|omaha|deep ?stack|bounty|freeze ?out|turbo|mystery|championship|series|open|classic|main|festival|satellite|super ?stack|monster|daily|weekly|mega|high roller|seniors?|ladies)\b/i;
  const LABELS = {
    total: /\b(total|amount(?: paid| due)?|paid|charge[ds]?|grand total|balance)\b/i,
    fee: /\b(fee|fees|rake|admin|staff|dealer|service|approp|juice|vig)\b/i,
    buyIn: /\b(buy.?in|prize ?pool|entry amount|pool|bounty|tournament amount|bi)\b/i,
  };

  function parseReceipt(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => fixDigits(l.replace(/\s+/g, ' ').trim())).filter((l) => l && /[A-Za-z0-9]/.test(l));
    const all = lines.join('\n');
    const out = { venue: '', location: '', event: '', game: '', date: '', buyIn: null, fee: null, total: null, table: '', seat: '', stack: '', receiptNo: '', entryType: 'entry', payment: '', player: '' };

    // Money lines: buy-in parts, fees, and the total paid.
    let buyIn = 0, fee = 0, total = null, sawBuy = false, sawFee = false;
    for (const l of lines) {
      const amt = moneyOf(l);
      if (amt === null) continue;
      if (LABELS.total.test(l) && !/sub ?total/i.test(l)) total = amt;
      else if (LABELS.fee.test(l)) { fee += amt; sawFee = true; } else if (LABELS.buyIn.test(l) && !EVENT_WORDS.test(l.replace(/\bbounty\b/i, '')) || /^(?:buy.?in|prize ?pool|bounty)\b/i.test(l)) { buyIn += amt; sawBuy = true; }
    }
    if (sawBuy) out.buyIn = buyIn;
    if (sawFee) out.fee = fee;
    out.total = total !== null ? total : sawBuy || sawFee ? buyIn + fee : null;
    if (out.total === null) {
      // Only the event's price, e.g. "$600 No-Limit Hold'em".
      const ev = lines.find((l) => EVENT_WORDS.test(l) && moneyOf(l) !== null);
      if (ev) out.total = moneyOf(ev);
    }

    out.date = dateOf(all);

    // Venue: a line naming a casino or card room, else the first line of words at the top.
    const top = lines.slice(0, 6);
    const venueLine = top.find((l) => VENUE_WORDS.test(l) && !EVENT_WORDS.test(l)) || top.find((l) => /^[A-Za-z&' .-]{4,}$/.test(l) && !EVENT_WORDS.test(l) && !CITY_LINE.test(l));
    if (venueLine) out.venue = venueLine;
    const city = lines.find((l) => CITY_LINE.test(l));
    if (city) out.location = city;

    // Event: the event number and name lines (not money or table lines).
    const evLines = lines.filter((l) => EVENT_WORDS.test(l) && l !== venueLine && !/^tournament (entry|receipt|buy.?in|registration)$/i.test(l) &&
      !(LABELS.buyIn.test(l) && moneyOf(l) !== null && !/\$[\d,]+\s+[A-Za-z]/.test(l)) && !LABELS.fee.test(l) && !LABELS.total.test(l) && !/\b(table|tbl|seat)\b/i.test(l) && !/^entry\s*:/i.test(l)).slice(0, 3);
    out.event = evLines.join(' · ');

    const lower = all.toLowerCase();
    if (/\bplo\d?\b|omaha|pot.?limit/.test(lower)) out.game = 'omaha';
    else if (/hold.?em|\bnlh|\bnlhe\b|\bnl\b/.test(lower)) out.game = 'nlhe';
    else if (/mixed|\bhorse\b|8.?game|dealer'?s choice|\bstud\b|razz/.test(lower)) out.game = 'mixed';

    let m = /\b(?:table|tbl|tab)\b\.?\s*(?:#|no\.?)?\s*:?\s*(\d{1,4})\b/i.exec(all);
    if (m) out.table = m[1];
    m = /\b(?:seat|st)\b\.?\s*(?:#|no\.?)?\s*:?\s*(\d{1,2})\b/i.exec(all);
    if (m) out.seat = m[1];
    m = /\b(?:starting\s+)?(?:chips|stack)\b\s*:?\s*(\d[\d,.]*\s*k?)\b/i.exec(all);
    if (m) out.stack = m[1].replace(/\s/g, '');
    m = /\b(?:receipt|ticket|trans(?:action)?|ref(?:erence)?|confirmation|conf|order|entry)\s*(?:#|no\.?|num(?:ber)?|id)\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(all);
    if (m) out.receiptNo = m[1];
    if (/re-?\s?entry|re-?buy/i.test(all)) out.entryType = 'reentry';
    else if (/add-?on/i.test(all)) out.entryType = 'addon';
    m = /\b(cash|visa|mastercard|amex|discover|debit|credit|card|chips|voucher|comp)\b/i.exec(lines.filter((l) => /\b(paid|payment|tender|method)\b/i.test(l)).join(' '));
    if (m) out.payment = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    m = /\bplayer(?:\s*name)?\s*:?\s+([A-Za-z][A-Za-z .'-]{2,40})$/im.exec(all);
    if (m) out.player = m[1].trim();
    return out;
  }

  const api = { parseReceipt, moneyOf, dateOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof self !== 'undefined' ? self : this);
