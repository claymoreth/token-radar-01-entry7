// Launch Radar — radar-8 dashboard. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, the stat strip,
// the methodology and evidence, and a per-protocol detail drawer with
// the model's own inputs and the protocol's farm plan. No network:
// every byte it shows is in data.js. Nothing here is left to chance:
// no unseeded randomness is used anywhere on this page.
// The listing probability is shown as what it is — the chance a ticker
// is recorded — never as the chance a token trades or launches.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var FLOOR = DATA.floorUsd || 50000000;

  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', tier: 'all', sort: 'rank', dir: -1, selected: null, deposit: 500, drop: 7, horizon: 12 };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtMoney0(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtPct2(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }
  // Age in years once it is a year or more, days when under a year.
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365.25).toFixed(1) + ' yr';
    return Math.max(0, Math.round(days)) + ' d';
  }
  function fmtAgeLong(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365.25).toFixed(1) + ' yr';
    return Math.max(0, Math.round(days)) + ' d';
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // FNV-1a over UTF-8 bytes, as 8 lowercase hex digits — the same
  // checksum main.ts writes, recomputed here from the data file.
  function fnv1aHex(str) {
    var bytes = new TextEncoder().encode(str);
    var hash = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      hash = hash ^ bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    // A hash without a row means no detail view: a link to a filter
    // state must not reopen the protocol the last page had open.
    state.selected = null;
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tier')) state.tier = params.get('tier');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('row')) state.selected = params.get('row');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tier !== 'all') params.set('tier', state.tier);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.selected) params.set('row', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function isEarly(r) { return !r.watchlist && r.tvlUsd < FLOOR; }
  function isOffList(r) { return !r.watchlist && r.tvlUsd >= FLOOR; }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.verdict !== 'all' && r.verdict.toLowerCase() !== state.verdict) return false;
      if (state.tier === 'watchlist' && !r.watchlist) return false;
      if (state.tier === 'early' && !isEarly(r)) return false;
      if (state.tier === 'offlist' && !isOffList(r)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.impliedValueUsd; bv = b.impliedValueUsd; }
      else if (key === 'tvl') { av = a.tvlUsd; bv = b.tvlUsd; }
      else if (key === 'net') { av = a.netPerHour; bv = b.netPerHour; }
      else if (key === 'age') { av = a.ageDays === null ? Infinity : a.ageDays; bv = b.ageDays === null ? Infinity : b.ageDays; }
      else if (key === 'odds') { av = a.tokenOdds; bv = b.tokenOdds; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function sortLabel() {
    return { rank: 'rank', implied: 'implied value', tvl: 'TVL', net: 'net/hour', age: 'age', odds: 'listing probability' }[state.sort] || 'rank';
  }
  function filtersActive() {
    return state.verdict !== 'all' || state.tier !== 'all' || state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all';
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function exportCsv() {
    var list = sortedRows(filteredRows());
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvlUsd', 'change7d', 'ageDays', 'tokenOdds', 'valueIfLaunches', 'impliedValueUsd', 'p25', 'p75', 'verdict', 'netFees', 'netPerHour'];
    var lines = [head.join(',')];
    list.forEach(function (r) {
      lines.push([
        r.rank, r.slug, r.name, r.category, (r.chains || []).join(';'), r.tvlUsd,
        r.change7d, r.ageDays, r.tokenOdds, r.valueIfLaunches, r.impliedValueUsd,
        r.p25, r.p75, r.verdict, r.netFees, r.netPerHour
      ].map(csvCell).join(','));
    });
    download('launch-radar-radar-8.csv', lines.join('\n') + '\n', 'text/csv');
  }
  function exportJson() {
    download('launch-radar-radar-8.json', JSON.stringify(sortedRows(filteredRows()), null, 2) + '\n', 'application/json');
  }

  function header() {
    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.impliedValueUsd; }, 0);
    var totalTvl = DATA.rows.reduce(function (s, r) { return s + r.tvlUsd; }, 0);
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Launch Radar · ' + DATA.model })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.rows.length + ' rows' }),
        el('span', { text: 'Total TVL ' + fmtUsd(totalTvl) }),
        el('span', { text: 'Total implied ' + fmtUsd(totalImplied) })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: 'Pre-token protocols, ranked by implied value' }),
      el('p', null,
        'Implied value is ', el('b', { text: 'TVL × fitted multiple × listing probability' }),
        '. The multiple is fitted from the snapshot\u2019s own priced protocols; the listing probability is the chance DefiLlama has a ticker recorded for the protocol. ',
        el('b', { text: 'That is a record of visibility, not a promise the token will trade.' }),
        ' Each row carries a costed farm verdict and a ten-step plan.'
      )
    );
  }

  function statStrip() {
    var ev = DATA.evidence;
    var v = ev.value, o = ev.odds, rg = ev.range.rows;
    var keptValue = v.terms.filter(function (t) { return t.kept === 'kept'; }).map(function (t) { return t.name; });
    var keptOdds = o.terms.filter(function (t) { return t.kept === 'kept'; }).map(function (t) { return shortGroup(t.name); });
    function shortGroup(name) {
      return { 'age (years listed)': 'age', '7-day TVL growth': '7-day growth', 'family (ridge 16, raw dummies)': 'family', 'category (ridge 16, raw dummies)': 'category', 'chain count (ln)': 'chain count' }[name] || name;
    }
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
    var watch = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    var offList = DATA.rows.filter(function (r) { return r.parentFactor; }).length;
    var early = DATA.rows.length - watch - offList;
    function pct(x) { return Math.round(x * 100) + '%'; }
    function card(label, big, sub) {
      return el('div', { class: 'card' }, el('h3', { text: label }), el('div', { class: 'big', text: big }), el('div', { class: 'sub', text: sub }));
    }
    return el('section', { class: 'strip', 'aria-label': 'Summary' },
      card('Out-of-sample miss', '×' + v.finalWf.toFixed(2),
        'leave-one-out ×' + v.finalLoo.toFixed(2) + ' · flat multiple ×' + v.baselineWf.toFixed(2) + ' walk-forward'),
      card('Range honesty', 'P25–P75 ' + pct(rg[0].wf) + ' · P10–P90 ' + pct(rg[1].wf),
        'stated 50% / 80% · leave-one-out ' + pct(rg[0].loo) + ' / ' + pct(rg[1].loo)),
      card('Listing probability', 'Brier ' + o.finalWfBrier.toFixed(3) + ' walk-forward',
        'ten-fold ' + o.finalBrier.toFixed(3) + ' · base rate ' + pct(o.baseRate) + ' · n=' + o.n),
      card('Terms that survived', keptValue.length + ' value term' + (keptValue.length === 1 ? '' : 's') + ' · ' + keptOdds.length + ' odds groups',
        (keptValue.join(', ') || 'none') + ' · ' + (keptOdds.join(', ') || 'none')),
      card('Worth farming', counts.FARM + ' FARM of ' + DATA.rows.length,
        counts.MARGINAL + ' marginal · ' + counts.SKIP + ' skip — net beats a T-bill and $25/hour'),
      card('Watchlist', watch + ' of 40 ranked',
        'plus ' + early + ' below the floor · ' + offList + ' off-list')
    );
  }

  function termTable(title, intro, head, rows) {
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { text: r[0] }),
        el('td', { class: 'num', text: r[1] }),
        el('td', { class: 'num', text: r[2] }),
        el('td', { class: 'num', text: r[3] })
      ));
    });
    return el('section', null,
      el('h3', { text: title }),
      el('p', { text: intro }),
      el('table', null,
        el('thead', null, el('tr', null, head.map(function (h, i) { return el('th', { class: i > 0 ? 'num' : '', scope: 'col', text: h }); }))),
        tbody
      )
    );
  }

  function evidenceSection() {
    var ev = DATA.evidence;
    var v = ev.value, o = ev.odds, rg = ev.range.rows;
    function pct(x) { return Math.round(x * 100) + '%'; }
    var valueRows = v.terms.map(function (t) {
      return [t.name, '×' + t.loo.toFixed(2), '×' + t.wf.toFixed(2), t.kept];
    });
    var oddsRows = o.terms.map(function (t) {
      return [t.name, t.brier.toFixed(3), t.wfBrier.toFixed(3), t.kept];
    });
    var rangeRows = rg.map(function (r) {
      return [r.label, pct(r.stated), pct(r.loo), pct(r.wf)];
    });

    // Integrity, recomputed in the browser from the data file itself.
    var rows = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
    var input = rows.map(function (r) { return r.slug + '|' + r.rank + '|' + r.impliedValueUsd; }).join('\n');
    var sum = 0, covered = 0, seq = true, dec = true;
    for (var i = 0; i < rows.length; i++) {
      sum += rows[i].impliedValueUsd;
      if (rows[i].watchlist) covered += 1;
      if (rows[i].rank !== i + 1) seq = false;
      if (i > 0 && !(rows[i].impliedValueUsd < rows[i - 1].impliedValueUsd)) dec = false;
    }
    var ig = DATA.integrity;
    var checks = [
      ['checksum', fnv1aHex(input) === ig.checksum, 'checksum ' + ig.checksum],
      ['total implied', Math.round(sum * 100) / 100 === ig.totalImplied, 'total implied ' + fmtUsd(ig.totalImplied)],
      ['watchlist covered', covered === ig.watchlistCovered, 'watchlist ' + covered + ' / ' + ig.watchlistTotal],
      ['ranks 1..N', seq, 'ranks sequential'],
      ['implied decreasing', dec, 'implied strictly decreasing'],
      ['row count', rows.length === ig.rows, rows.length + ' rows'],
    ];

    var ledger = el('div', { class: 'ledger' });
    DATA.accounting.groups.forEach(function (g) {
      ledger.appendChild(el('span', null, el('b', { text: String(g.count) }), ' ' + g.label));
    });

    return el('section', { class: 'evidence', 'aria-label': 'How the board is made' },
      el('div', null,
        el('h2', { text: 'How the board is made' }),
        el('p', null,
          'Implied value is ', el('b', { text: 'TVL × fitted multiple × listing probability' }),
          '. The multiple comes from the snapshot\u2019s own ', el('b', { text: String(v.n) + ' priced protocols' }),
          ': the target is ln(market cap / TVL), and a term is kept only when it lowers the held-out miss in ',
          el('b', { text: 'both' }),
          ' out-of-sample tests — leave-one-out and a chronological walk-forward. Only the size curve survived. The family effect cannot help held out: 127 distinct families over 128 priced rows, so a held-out row\u2019s family is almost never in its training fold. A shuffled-growth control is tested and never kept.'
        )
      ),
      termTable('Value model — which terms earned their place',
        'Final miss ×' + v.finalLoo.toFixed(2) + ' leave-one-out, ×' + v.finalWf.toFixed(2) + ' walk-forward, against a flat baseline of ×' + v.baselineLoo.toFixed(2) + ' / ×' + v.baselineWf.toFixed(2) + '.',
        ['Term', 'Leave-one-out miss', 'Walk-forward miss', 'Status'], valueRows),
      termTable('Listing probability — which groups earned their place',
        'A logistic regression on whether DefiLlama has a ticker recorded (n=' + o.n + ', base rate ' + pct(o.baseRate) + '). Final Brier ' + o.finalBrier.toFixed(3) + ' ten-fold, ' + o.finalWfBrier.toFixed(3) + ' walk-forward (' + pct(o.walkForwardCorrect) + ' of walk-forward calls right), against a base-rate baseline of ' + o.baselineBrier.toFixed(3) + ' / ' + o.baselineWfBrier.toFixed(3) + '. Read the target honestly: these odds are the chance a ticker is recorded, not the chance the token trades or launches. Because the base rate is higher than the traded-token target\u2019s 32%, every implied value is larger — this board\u2019s ' + fmtUsd(ig.totalImplied) + ' total cannot be compared with the earlier entry\u2019s $517.0M. And \u201crecorded\u201d is a low bar: it includes failed launches, illiquid placeholders and points systems that never reach price discovery, so the board can over-rank zombie protocols that are recorded but never trade. Implied value here prices the chance a ticker exists, not exit liquidity.',
        ['Group', 'Ten-fold Brier', 'Walk-forward Brier', 'Status'], oddsRows),
      termTable('Range honesty — do the stated ranges hold out of sample?',
        'A P25–P75 band should contain the truth about half the time; P10–P90 about four fifths. These are held-out hit rates, not in-sample fits. ' + ev.range.note,
        ['Range', 'Stated', 'Leave-one-out', 'Walk-forward'], rangeRows),
      el('section', null,
        el('h3', { text: 'Protocol accounting — every protocol in exactly one bucket' }),
        el('p', { text: 'All ' + DATA.accounting.total + ' protocols in the snapshot land in one bucket, so the buckets add up to the ledger total.' }),
        ledger
      ),
      el('section', null,
        el('h3', { text: 'Integrity — recomputed in this browser from the data file' }),
        el('div', { class: 'checks' }, checks.map(function (c) {
          return el('span', { class: c[1] ? 'ok' : 'bad', text: (c[1] ? 'PASS ' : 'FAIL ') + c[2] });
        }))
      )
    );
  }

  function tabButton(label, pressed, onclick) {
    return el('button', { type: 'button', 'aria-pressed': pressed ? 'true' : 'false', text: label, onclick: onclick });
  }

  var scenarioEl = null;
  function updateScenario() {
    if (scenarioEl) {
      scenarioEl.textContent = 'Scenario: $' + state.deposit.toLocaleString('en-US') + ' deposit · ' + state.drop.toFixed(1) + '% drop · ' + state.horizon + ' weeks — display only; verdicts are costed on each row\u2019s own plan.';
    }
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var sortSel = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['rank', 'Sort: rank'], ['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['odds', 'Sort: listing probability'], ['net', 'Sort: net/hour'], ['age', 'Sort: age']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; state.dir = -1; writeHash(); render(); });
    var depSel = el('select', { id: 'deposit', 'aria-label': 'Scenario deposit' },
      [100, 250, 500, 1000, 2500, 5000, 10000].map(function (d) {
        return el('option', { value: String(d), text: String(d), selected: d === state.deposit ? 'selected' : null });
      })
    );
    depSel.addEventListener('change', function () { state.deposit = Number(depSel.value); updateScenario(); });
    var dropVal = el('span', { class: 'range-val', text: state.drop.toFixed(1) + '%' });
    var dropSlider = el('input', { type: 'range', id: 'drop', min: '1', max: '14', step: '0.5', value: String(state.drop), 'aria-label': 'Scenario drop share' });
    dropSlider.addEventListener('input', function () { state.drop = Number(dropSlider.value); dropVal.textContent = state.drop.toFixed(1) + '%'; updateScenario(); });
    var horVal = el('span', { class: 'range-val', text: state.horizon + ' wk' });
    var horSlider = el('input', { type: 'range', id: 'horizon', min: '4', max: '52', step: '1', value: String(state.horizon), 'aria-label': 'Scenario horizon' });
    horSlider.addEventListener('input', function () { state.horizon = Number(horSlider.value); horVal.textContent = state.horizon + ' wk'; updateScenario(); });

    return el('div', { class: 'controls' },
      el('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter by verdict' },
        tabButton('All', state.verdict === 'all', function () { state.verdict = 'all'; writeHash(); render(); }),
        tabButton('Farm', state.verdict === 'farm', function () { state.verdict = 'farm'; writeHash(); render(); }),
        tabButton('Marginal', state.verdict === 'marginal', function () { state.verdict = 'marginal'; writeHash(); render(); }),
        tabButton('Skip', state.verdict === 'skip', function () { state.verdict = 'skip'; writeHash(); render(); })
      ),
      el('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter by tier' },
        tabButton('All tiers', state.tier === 'all', function () { state.tier = 'all'; writeHash(); render(); }),
        tabButton('Watchlist', state.tier === 'watchlist', function () { state.tier = 'watchlist'; writeHash(); render(); }),
        tabButton('Early', state.tier === 'early', function () { state.tier = 'early'; writeHash(); render(); }),
        tabButton('Off-list', state.tier === 'offlist', function () { state.tier = 'offlist'; writeHash(); render(); })
      ),
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sortSel),
      el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.tier = 'all'; state.sort = 'rank'; state.dir = -1; writeHash(); render(); } }),
      el('button', { class: 'button', type: 'button', text: 'CSV', onclick: exportCsv }),
      el('button', { class: 'button', type: 'button', text: 'JSON', onclick: exportJson }),
      el('div', { class: 'field' }, el('label', { for: 'deposit', text: 'Deposit USD' }), depSel),
      el('div', { class: 'field' }, el('label', { for: 'drop', text: 'Drop share' }), el('div', null, dropSlider, ' ', dropVal)),
      el('div', { class: 'field' }, el('label', { for: 'horizon', text: 'Horizon' }), el('div', null, horSlider, ' ', horVal))
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var totalTvl = list.reduce(function (s, r) { return s + r.tvlUsd; }, 0);
    var totalImplied = list.reduce(function (s, r) { return s + r.impliedValueUsd; }, 0);
    var wrap = el('div', null,
      el('div', { class: 'count-line', text: list.length + ' of ' + DATA.rows.length + ' rows · total TVL ' + fmtUsd(totalTvl) + ' · total implied ' + fmtUsd(totalImplied) })
    );
    if (filtersActive()) {
      var verdictLabel = state.verdict === 'all' ? 'all verdicts' : state.verdict.toUpperCase() + ' verdict';
      var tierLabel = state.tier === 'all' ? 'all tiers' : state.tier;
      wrap.appendChild(el('div', { class: 'filter-line', text: 'Filtered to ' + verdictLabel + ' · ' + tierLabel + ' · sorted by ' + sortLabel() + ' · ' + list.length + ' rows · total TVL ' + fmtUsd(totalTvl) + ' · total implied ' + fmtUsd(totalImplied) }));
    }
    if (list.length === 0) {
      wrap.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No rows match these filters' }),
        el('p', { text: 'Clear the search or pick another verdict, tier, category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.tier = 'all'; writeHash(); render(); } })
      )));
      return wrap;
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change7d === null ? '—' : fmtPct(r.change7d);
      var growthClass = r.change7d === null ? '' : r.change7d >= 0 ? 'pos' : 'neg';
      var verdictClass = r.verdict === 'FARM' ? 'v-farm' : r.verdict === 'MARGINAL' ? 'v-marginal' : 'v-skip';
      var nameCell = el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: r.category + ' · ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') })
      );
      if (r.parentFactor) {
        nameCell.appendChild(el('span', { class: 'tag', text: 'Off-List · Parent ×0.48' }));
      }
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'num', text: fmtUsd(r.bootstrapLow) + '–' + fmtUsd(r.bootstrapHigh) }),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvlUsd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.ageDays) }),
        el('td', { class: 'num', text: Math.round(r.tokenOdds * 100) + '%' }),
        el('td', { class: 'num', text: fmtUsd(r.valueIfLaunches) }),
        el('td', { class: 'num' }, el('b', { text: fmtUsd(r.impliedValueUsd) })),
        el('td', { class: 'num', text: fmtUsd(r.p25) + ' – ' + fmtUsd(r.p75) }),
        el('td', null, el('span', { class: verdictClass, text: r.verdict }), el('br'), el('span', { class: 'sub', text: '· ' + fmtMoney0(r.netFees) + ' net' })),
        el('td', { class: 'num', text: fmtMoney0(r.netPerHour) + ' / h' })
      );
      tbody.appendChild(tr);
    });
    wrap.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'board' },
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, peers and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', '#'),
            el('th', { scope: 'col', text: 'Range' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            sortHeader('tvl', 'TVL'),
            el('th', { scope: 'col', text: '7D' }),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Listing prob.'),
            el('th', { scope: 'col', text: 'If it launches' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'P25–P75' }),
            el('th', { scope: 'col', text: 'Verdict · net of fees' }),
            sortHeader('net', 'Net / hour')
          )),
          tbody
        )
      )
    ));
    wrap.appendChild(el('p', { class: 'hint', text: 'Click a row for the full work-up: how the figure is made, nearest priced peers, the costed farm verdict with its benchmarks and net grid, and the ten-step plan.' }));
    return wrap;
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function netGrid(row) {
    var shares = [0.035, 0.07, 0.14];
    var deposits = [1000, 3000, 10000, 30000];
    var nearest = deposits[0];
    deposits.forEach(function (d) {
      if (Math.abs(d - row.depositUsd) < Math.abs(nearest - row.depositUsd)) nearest = d;
    });
    var thead = el('thead', null, el('tr', null,
      el('th', { scope: 'col', text: 'Drop share' }),
      deposits.map(function (d) { return el('th', { class: 'num', scope: 'col', text: '$' + d.toLocaleString('en-US') }); })
    ));
    var tbody = el('tbody');
    shares.forEach(function (share) {
      var cells = deposits.map(function (d) {
        var v = round2((row.impliedValueUsd * share * d) / row.tvlUsd - row.feesUsd);
        var hl = share === 0.07 && d === nearest;
        return el('td', { class: 'num' + (hl ? ' hl' : ''), text: fmtMoney(v) });
      });
      tbody.appendChild(el('tr', null, el('td', { class: 'num', text: (share * 100).toFixed(1) + '%' }), cells));
    });
    return el('div', null,
      el('table', null, thead, tbody),
      el('p', { class: 'sub', text: 'Net of fees for each drop share and deposit. Fees stay fixed — the plan\u2019s transactions do not depend on size — and deposits above the $10,000 plan cap are what-if only. The highlighted cell is the grid deposit nearest this row\u2019s own plan (' + fmtMoney0(row.depositUsd) + ').' })
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var ev = DATA.evidence;
    var base = row.factors.size * row.factors.category === 0 ? 0 : row.factors.multiple / (row.factors.size * row.factors.category);
    var tbill = row.depositUsd * 0.04 * (12 / 52);
    var dropIfLaunches = row.tvlUsd > 0 ? (row.valueIfLaunches * 0.07 * row.depositUsd) / row.tvlUsd : 0;
    var shareFloor = row.impliedValueUsd * row.depositUsd > 0 ? (row.feesUsd * row.tvlUsd) / (row.impliedValueUsd * row.depositUsd) : 0;
    var oddsFloor = row.valueIfLaunches * 0.07 * row.depositUsd > 0 ? (row.feesUsd * row.tvlUsd) / (row.valueIfLaunches * 0.07 * row.depositUsd) : 0;
    var notKeptValue = ev.value.terms.filter(function (t) { return t.kept === 'tested, not kept'; }).map(function (t) { return t.name; });
    var notKeptOdds = ev.odds.terms.filter(function (t) { return t.kept === 'tested, not kept'; }).map(function (t) { return t.name; });
    var verdictText;
    if (row.verdict === 'FARM') {
      verdictText = 'It clears both bars — the net beats the T-bill and the hours beat $25.';
    } else if (row.verdict === 'MARGINAL') {
      var clearsTbill = row.netFees > tbill;
      var clearsHour = row.netPerHour >= 25;
      verdictText = 'Net clears ' + (clearsTbill && clearsHour ? 'both bars on paper, but the rounded figures put it under one of them — treat it as marginal' : clearsTbill ? 'the T-bill bar but not the $25/hour bar' : clearsHour ? 'the $25/hour bar but not the T-bill bar' : 'neither bar') + ' — farm only if the hours are already spare.';
    } else {
      verdictText = 'Gas costs more than the modelled drop — skip.';
    }

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: '#' + row.rank + ' — ' + DATA.model }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: row.category + ' · ' + (row.chains || []).join(', ') + ' · listed ' + fmtAgeLong(row.ageDays) + ' ago' + (row.watchlist ? ' · watchlist' : '') + (row.parentFactor ? ' · Off-List · Parent ×0.48 (' + row.parentName + ')' : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close ×', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'boxes' },
      el('div', { class: 'box' }, el('h3', { text: 'TVL' }), el('div', { class: 'big', text: fmtUsd(row.tvlUsd) })),
      el('div', { class: 'box' }, el('h3', { text: '7-day change' }), el('div', { class: 'big', text: fmtPct(row.change7d) })),
      el('div', { class: 'box' }, el('h3', { text: 'Listing probability' }), el('div', { class: 'big', text: fmtPct2(row.tokenOdds) })),
      el('div', { class: 'box' }, el('h3', { text: 'Bootstrap range' }), el('div', { class: 'big', text: fmtUsd(row.bootstrapLow) + '–' + fmtUsd(row.bootstrapHigh) }))
    ));
    dialog.appendChild(el('div', { class: 'implied-big', text: fmtUsd(row.impliedValueUsd) + ' implied value' }));
    dialog.appendChild(el('p', { class: 'sub', text: 'If it launches: ' + fmtUsd(row.valueIfLaunches) + ' · P25–P75 ' + fmtUsd(row.p25) + ' – ' + fmtUsd(row.p75) + ' · P10–P90 ' + fmtUsd(row.p10) + ' – ' + fmtUsd(row.p90) + ' · rank ' + row.bootstrapRankLow + '–' + row.bootstrapRankHigh + ' across 200 bootstrap refits.' }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How the figure is made' }),
      el('p', null,
        'TVL ', el('b', { text: fmtUsd(row.tvlUsd) }), ' × base multiple ', el('b', { text: base.toFixed(4) + '×' }),
        ' × size factor ', el('b', { text: row.factors.size.toFixed(4) + '×' }),
        ' × category factor ', el('b', { text: row.factors.category.toFixed(2) + '×' }),
        ' = ', el('b', { text: fmtUsd(row.valueIfLaunches) + ' if it launches' }),
        '. Base, size and category multiply once into the fitted multiple ', el('b', { text: row.factors.multiple.toFixed(4) + '×' }),
        ' — the fitted multiple already holds all three, so they are never multiplied a second time. Times listing probability ',
        el('b', { text: fmtPct2(row.tokenOdds) }),
        row.parentFactor ? ' and the 0.48 parent-line factor' : '',
        ' = ', el('b', { text: fmtUsd(row.impliedValueUsd) + ' implied' }),
        '. Value terms tested and not used: ', el('b', { text: notKeptValue.join(', ') || 'none' }),
        '. Odds groups tested and not used: ', el('b', { text: notKeptOdds.join(', ') || 'none' }),
        ' — they did not beat the baseline out of sample in their own model, so they add no value here.'
      )
    ));
    var peerBody = el('tbody');
    if (row.peers.length === 0) {
      peerBody.appendChild(el('tr', null, el('td', { colspan: '6', text: 'No priced peer in this category.' })));
    }
    row.peers.forEach(function (p) {
      peerBody.appendChild(el('tr', null,
        el('td', { text: p.name }),
        el('td', { text: p.category }),
        el('td', { class: 'num', text: fmtUsd(p.tvl) }),
        el('td', { class: 'num', text: fmtUsd(p.mcap) }),
        el('td', { class: 'num', text: p.ratio.toFixed(2) + '×' }),
        el('td', { class: 'num', text: p.heldOut.toFixed(2) + '×' })
      ));
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Nearest priced peers' }),
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Token' }),
          el('th', { scope: 'col', text: 'Category' }),
          el('th', { class: 'num', scope: 'col', text: 'TVL' }),
          el('th', { class: 'num', scope: 'col', text: 'Market cap' }),
          el('th', { class: 'num', scope: 'col', text: 'Cap / TVL' }),
          el('th', { class: 'num', scope: 'col', text: 'Model ÷ actual (LOO)' })
        )),
        peerBody
      ),
      el('p', { class: 'sub', text: 'Cap / TVL is each peer\u2019s own market cap over its TVL — the ratio the model is fitted on. Model ÷ actual is the leave-one-out prediction for that peer over its real ratio: 1.00 means the model priced the peer exactly, 2.00 means it predicted twice the real cap. Peers are the nearest priced protocols in the same category by TVL.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict — ' + row.verdict }),
      el('p', null,
        'Deposit ', el('b', { text: fmtMoney0(row.depositUsd) }), ' · expected drop ', el('b', { text: fmtMoney(row.dropUsd) }),
        ' · fees ', el('b', { text: fmtMoney(row.feesUsd) }), ' · net ', el('b', { text: fmtMoney(row.netFees) }),
        ' over ', el('b', { text: row.handsOnHours + ' hands-on hours' }), ' = ', el('b', { text: fmtMoney(row.netPerHour) + ' / hour' }),
        ', vs T-bill on the same deposit (', el('b', { text: fmtMoney(tbill) }), ') plus $25 / hour for your time. ', verdictText
      ),
      el('h3', { text: 'Benchmarks' }),
      el('p', null,
        'Same ', el('b', { text: fmtMoney0(row.depositUsd) }), ' in a 4% T-bill for 12 weeks → ', el('b', { text: fmtMoney(tbill) }),
        '. Drop if a token launches (listing probability not applied) → ', el('b', { text: fmtMoney(dropIfLaunches) }),
        '. Fees are covered while the drop share stays above ', el('b', { text: fmtPct2(shareFloor) }),
        ' (model 7.0%) and the listing probability above ', el('b', { text: fmtPct2(oddsFloor) }),
        ' (this row implies ', el('b', { text: fmtPct2(row.tokenOdds) }), '). ', row.exitRule
      ),
      el('h3', { text: 'Net by drop share × deposit' }),
      netGrid(row)
    ));
    var steps = el('ol', { class: 'steps' });
    row.farmPlan.forEach(function (s) {
      steps.appendChild(el('li', null,
        el('b', { text: s.n + '. ' + s.title + ' — ' + s.text }),
        el('span', { class: 'cost', text: s.cost + ' · ' + s.time })
      ));
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Ten-step farm plan' }),
      steps
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    // A dialog left open by an earlier view must close when the new
    // state has no row selected: removing it from the document and
    // re-appending it would otherwise leave it open on top of the board.
    if (dialog.open && !state.selected) dialog.close();
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    // The stat strip sits directly above the board table, so the first
    // screen shows the summary cards and the board together.
    shell.appendChild(statStrip());
    var boardHead = el('div', { class: 'board-head' },
      el('h2', { id: 'board-title', text: 'Board' }),
      el('span', { class: 'sub', text: 'Model ' + DATA.model + ' · snapshot ' + DATA.as_of })
    );
    shell.appendChild(boardHead);
    shell.appendChild(controls());
    scenarioEl = el('div', { class: 'scenario' });
    shell.appendChild(scenarioEl);
    updateScenario();
    shell.appendChild(boardTable());
    shell.appendChild(evidenceSection());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  // Back/forward and in-page hash links re-render from the hash, so a
  // shared link to a filter state or a protocol opens the same view.
  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
