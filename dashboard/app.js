// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail view with the model's own inputs, its
// five nearest live comparables, its farm verdict and its farm plan, the live-token view, the size
// curve, and the method note with the audit and the research note. No network: every byte it
// shows is in data.js.
//
// The page recomputes a row's implied value from the snapshot figures and the fitted model and
// checks the number board.json carries, so the page's code and the board's data are visibly the
// same arithmetic: fitted = exp(intercept + category shift + slope x ln TVL), then the growth and
// maturity multipliers, capped at 5x TVL.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  app.setAttribute('aria-busy', 'false');

  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', watchOnly: false, tab: 'board', sort: 'rank', dir: 1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** The model in one function: fitted value, then growth and maturity, capped at 5x TVL. */
  function impliedOf(row) {
    var fit = DATA.fit;
    var shift = 0;
    for (var i = 0; i < fit.categories.length; i++) {
      if (fit.categories[i].category === (row.category || 'Uncategorised')) { shift = fit.categories[i].shift; break; }
    }
    var fitted = Math.exp(fit.intercept + shift + fit.slope * Math.log(row.tvl_usd));
    var growth = Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * DATA.model.growth_weight;
    var age = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
    var maturity = DATA.model.maturity_floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    return Math.max(1, Math.round(Math.min(fitted * growthMult * maturity, row.tvl_usd * DATA.model.implied_cap_multiple)));
  }

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

  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  /** Read the hash: #detail=<slug>, #cat=<category>, #tab=live|method|board. */
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var parts = h.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length !== 2) continue;
      var k = decodeURIComponent(kv[0]);
      var v = decodeURIComponent(kv[1]);
      if (k === 'detail' && bySlug(v)) state.selected = v;
      if (k === 'cat') state.category = v;
      if (k === 'tab' && (v === 'live' || v === 'method' || v === 'board')) state.tab = v;
    }
  }

  function writeHash() {
    var bits = [];
    if (state.tab !== 'board') bits.push('tab=' + encodeURIComponent(state.tab));
    if (state.category !== 'all') bits.push('cat=' + encodeURIComponent(state.category));
    if (state.selected) bits.push('detail=' + encodeURIComponent(state.selected));
    var h = bits.length ? '#' + bits.join('&') : '';
    if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
  }

  function categories() {
    var seen = {};
    var out = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      if (!seen[c]) { seen[c] = true; out.push(c); }
    });
    return out.sort();
  }

  function chains() {
    var seen = {};
    var out = [];
    DATA.rows.forEach(function (r) {
      r.chains.forEach(function (c) { if (!seen[c]) { seen[c] = true; out.push(c); } });
    });
    return out.sort();
  }

  var VERDICT_ORDER = { FARM: 0, THIN: 1, SKIP: 2 };

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -9999 : a.change_7d; bv = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'verdict') { av = VERDICT_ORDER[a.verdict]; bv = VERDICT_ORDER[b.verdict]; }
      else { av = a.rank; bv = b.rank; }
      return (av - bv) * dir || (a.rank - b.rank);
    });
    return rows;
  }

  function statCell(value, label, accent) {
    return el('div', { class: 'stat' }, el('b', { class: accent ? 'accent' : '', text: value }), el('span', { text: label }));
  }

  function renderHero() {
    var top = DATA.rows[0];
    var fit = DATA.fit;
    var vc = DATA.verdict_counts;
    return el('header', { class: 'hero' },
      el('div', { class: 'kicker', text: 'Token launch radar · DefiLlama snapshot ' + DATA.as_of }),
      el('h1', { text: 'Which protocols are worth a token?' }),
      el('p', { class: 'lede', text: 'Every protocol DefiLlama tracks that records no token, ranked by what its token would be worth if the protocol launched one today. The value is fitted from the ' + fit.comps + ' protocols whose tokens already trade — a robust log market cap on log TVL curve, one intercept shift per category — never from a list of names. Each row shows its five nearest live comparables and a farm verdict: ' + vc.FARM + ' farm, ' + vc.THIN + ' thin, ' + vc.SKIP + ' skip. The top row, ' + (top ? top.name : '—') + ', is worth about ' + fmtUsd(top ? top.implied_value_usd : 0) + ' on that fit.' }),
      el('div', { class: 'stats' },
        statCell(String(DATA.board_size), 'pre-token protocols ranked', false),
        statCell(String(DATA.watchlist_size), 'on the watchlist (TVL ≥ $50M)', false),
        statCell(fmtUsd(top ? top.implied_value_usd : 0), 'top implied value', true),
        statCell('R² ' + fit.r_squared.toFixed(2), 'comps fit, ' + fit.comps + ' live protocols', false),
        statCell('×' + fit.oos_factor.toFixed(1), 'out-of-sample median error', false),
        statCell(vc.FARM + ' farm · ' + vc.THIN + ' thin · ' + vc.SKIP + ' skip', 'farm verdicts', false)));
  }

  function renderTabs() {
    function tab(name, label) {
      return el('button', {
        class: 'tab', role: 'tab', 'aria-selected': state.tab === name ? 'true' : 'false', text: label,
        onclick: function () { state.tab = name; state.selected = null; render(); },
      });
    }
    return el('div', { class: 'tabs', role: 'tablist' },
      tab('board', 'Board · ' + DATA.board_size),
      tab('live', 'Live tokens · ' + DATA.live_size),
      tab('method', 'How the value is fitted'));
  }

  function renderControls() {
    var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function () { state.category = catSel.value; state.selected = null; render(); } });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories().forEach(function (c) {
      var o = el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Uncategorised') === c; }).length + ')' });
      if (state.category === c) o.selected = true;
      catSel.appendChild(o);
    });
    var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function () { state.chain = chainSel.value; state.selected = null; render(); } });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains().forEach(function (c) {
      var o = el('option', { value: c, text: c });
      if (state.chain === c) o.selected = true;
      chainSel.appendChild(o);
    });
    var verdictSel = el('select', { 'aria-label': 'Filter by farm verdict', onchange: function () { state.verdict = verdictSel.value; state.selected = null; render(); } });
    [['all', 'All verdicts'], ['FARM', 'Farm'], ['THIN', 'Thin'], ['SKIP', 'Skip']].forEach(function (v) {
      var o = el('option', { value: v[0], text: v[1] });
      if (state.verdict === v[0]) o.selected = true;
      verdictSel.appendChild(o);
    });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; state.selected = null; renderTable(); });
    var watch = el('label', { class: 'chk' },
      el('input', { type: 'checkbox', checked: state.watchOnly ? true : null, onchange: function (e) { state.watchOnly = e.target.checked; state.selected = null; render(); } }),
      document.createTextNode('Watchlist only'));
    var count = el('span', { class: 'count', id: 'rowcount' });
    return el('div', { class: 'controls' }, search, catSel, chainSel, verdictSel, watch, count);
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return el('button', {
      text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        renderTable();
      },
    });
  }

  function verdictBadge(v) {
    return el('span', { class: 'badge verdict-' + v.toLowerCase(), text: v });
  }

  function renderTable() {
    var host = document.getElementById('tablehost');
    if (!host) return;
    var rows = filteredRows();
    var count = document.getElementById('rowcount');
    if (count) count.textContent = rows.length + ' of ' + DATA.rows.length + ' protocols';
    host.innerHTML = '';
    if (rows.length === 0) {
      host.appendChild(el('p', { class: 'empty', text: 'No protocol matches that filter. Clear the search or pick another category.' }));
      return;
    }
    var table = el('table', { class: 'board' });
    var thead = el('thead', {},
      el('tr', {},
        el('th', { class: 'num' }, sortButton('#', 'rank')),
        el('th', {}, sortButton('Protocol', 'rank')),
        el('th', {}, document.createTextNode('Category')),
        el('th', {}, document.createTextNode('Chains')),
        el('th', { class: 'num' }, sortButton('TVL', 'tvl')),
        el('th', { class: 'num' }, sortButton('7d', 'change')),
        el('th', { class: 'num' }, sortButton('Age', 'age')),
        el('th', {}, sortButton('Verdict', 'verdict')),
        el('th', { class: 'num' }, sortButton('Implied value', 'rank'))));
    table.appendChild(thead);
    var tbody = el('tbody', {});
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { state.selected = r.slug; render(); } });
      tr.appendChild(el('td', { class: 'num rank', text: String(r.rank) }));
      var nameCell = el('td', { class: 'name' });
      nameCell.appendChild(el('b', { text: r.name }));
      var sub = document.createElement('span');
      sub.textContent = r.slug + (r.watchlist ? ' · watchlist' : '');
      nameCell.appendChild(sub);
      if (r.watchlist) nameCell.appendChild(document.createTextNode(' '));
      if (r.watchlist) nameCell.appendChild(el('span', { class: 'badge watch', text: 'WATCHLIST' }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { class: 'cat', text: r.category || '—' }));
      tr.appendChild(el('td', { class: 'cat', text: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var chg = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) });
      tr.appendChild(chg);
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', {}, verdictBadge(r.verdict)));
      var check = impliedOf(r) === r.implied_value_usd ? '' : ' ≠';
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) + check }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function renderDetail() {
    var r = state.selected ? bySlug(state.selected) : null;
    if (!r) return null;
    var recomputed = impliedOf(r);
    var fit = DATA.fit;
    var catComps = fit.categories.filter(function (c) { return c.category === (r.category || 'Uncategorised'); })[0];
    var medNear = null;
    if (r.nearest_comps && r.nearest_comps.length > 0) {
      var mults = r.nearest_comps.map(function (c) { return c.multiple; }).sort(function (a, b) { return a - b; });
      medNear = mults[Math.floor(mults.length / 2)];
    }
    var cells = [
      ['Implied value', fmtUsd(r.implied_value_usd), 'rank #' + r.rank + ' of ' + DATA.rows.length],
      ['Verdict', r.verdict, r.verdict_reason],
      ['Fitted value', fmtUsd(r.fitted_value_usd), 'multiple ' + fmtMult(r.fitted_multiple) + ' of TVL'],
      ['Growth', fmtPct(r.change_7d), 'multiplier ' + r.growth_multiplier.toFixed(2) + 'x'],
      ['Maturity', fmtAge(r.age_days), 'multiplier ' + r.maturity_multiplier.toFixed(2) + 'x'],
      ['Category fit', (r.category || 'Uncategorised'), (r.category_comps || 0) + ' live comps · shift ' + (r.category_shift >= 0 ? '+' : '') + r.category_shift.toFixed(2)],
      ['TVL', fmtUsd(r.tvl_usd), r.chains.join(', ') || 'no chain listed'],
      ['Check', recomputed === r.implied_value_usd ? 'matches' : 'differs', 'page recomputes ' + fmtUsd(recomputed)],
    ];
    var grid = el('div', { class: 'modelgrid' });
    cells.forEach(function (c) {
      grid.appendChild(el('div', { class: 'mcell' }, el('b', { text: c[1] }), el('span', { text: c[0] + ' — ' + c[2] })));
    });
    var detail = el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('h2', { text: '#' + r.rank + ' · ' + r.name }),
      el('p', { class: 'sub', text: r.slug + ' · ' + (r.category || 'Uncategorised') + ' · snapshot ' + DATA.as_of + ' · records no token (gecko_id, symbol and market cap are all null in the snapshot)' }),
      grid);
    if (r.nearest_comps && r.nearest_comps.length > 0) {
      detail.appendChild(el('h3', { text: 'Nearest live comparables' }));
      var ct = el('table', { class: 'comps' });
      ct.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'mcap / TVL' }), el('th', { text: 'From' }))));
      var cb = el('tbody', {});
      r.nearest_comps.forEach(function (l) {
        cb.appendChild(el('tr', {},
          el('td', { text: l.name }),
          el('td', { class: 'num', text: fmtUsd(l.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(l.mcap_usd) }),
          el('td', { class: 'num', text: fmtMult(l.multiple) }),
          el('td', { text: l.source === 'category' ? 'same category' : l.source === 'chain' ? 'same chain' : 'pooled' })));
      });
      ct.appendChild(cb);
      detail.appendChild(ct);
      detail.appendChild(el('p', { class: 'sub', text: 'Median multiple of the five nearest ' + fmtMult(medNear) + ' against this row’s fitted ' + fmtMult(r.fitted_multiple) + '; the size curve at this TVL commands ' + fmtMult(r.size_median_multiple) + '. Category median multiple ' + fmtMult(catComps ? catComps.median_multiple : null) + ' across ' + (catComps ? catComps.comps : 0) + ' live protocols; the pooled fit’s slope is ' + fit.slope.toFixed(3) + ' with R² ' + fit.r_squared.toFixed(2) + '.' }));
    }
    var econ = r.farm;
    detail.appendChild(el('h3', { text: 'Farm economics' }));
    detail.appendChild(el('p', { class: 'econ', text: 'Total outlay about $' + econ.total_outlay_usd + ' over ' + econ.hold_days + ' days: $' + econ.capital_usd + ' of capital locked in the position plus about $' + econ.gas_total_usd + ' of gas for setup, weekly actions and the claim check. Verdict ' + r.verdict + ' — ' + r.verdict_reason }));
    detail.appendChild(el('h3', { text: 'How to farm it' }));
    var farm = el('ol', { class: 'farm' });
    r.farm_steps.forEach(function (s) { farm.appendChild(el('li', { text: s })); });
    detail.appendChild(farm);
    return detail;
  }

  function renderLive() {
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'mcap / TVL' }), el('th', { class: 'num', text: '7d' }))));
    var tbody = el('tbody', {});
    DATA.live.forEach(function (l) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { class: 'name' }, el('b', { text: l.name }), el('span', { text: l.slug })));
      tr.appendChild(el('td', { class: 'cat', text: l.category || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(l.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(l.mcap_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtMult(l.multiple) }));
      tr.appendChild(el('td', { class: 'num ' + (l.change_7d === null ? '' : l.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(l.change_7d) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return el('div', {},
      el('p', { class: 'sub', html: 'These protocols already trade, so the board shows the market’s own value — market cap and mcap / TVL — and never mixes them into the ranking. They are also the comparables the model is fitted on.' }),
      table);
  }

  /** The size curve as an SVG scatter: every live comparable and the fitted line. */
  function renderCurve() {
    var W = 720, H = 300, PL = 56, PR = 16, PT = 14, PB = 34;
    var pts = DATA.comps.map(function (c) { return { x: Math.log10(c.tvl_usd), y: Math.log10(c.mcap_usd), name: c.name }; });
    if (pts.length === 0) return el('p', { class: 'sub', text: 'No comparables to plot.' });
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2;
    var y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    var fit = DATA.fit;
    var ln10 = Math.LN10;
    function lineY(log10tvl) {
      var lnTvl = log10tvl * ln10;
      return (fit.intercept + fit.slope * lnTvl) / ln10;
    }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Scatter of live comparables, log market cap against log TVL, with the fitted line">';
    s += '<line x1="' + X(x0) + '" y1="' + Y(y0) + '" x2="' + X(x0) + '" y2="' + Y(y1) + '" class="axis"/>';
    s += '<line x1="' + X(x0) + '" y1="' + Y(y0) + '" x2="' + X(x1) + '" y2="' + Y(y0) + '" class="axis"/>';
    s += '<line x1="' + X(x0) + '" y1="' + Y(lineY(x0)) + '" x2="' + X(x1) + '" y2="' + Y(lineY(x1)) + '" class="fitline"/>';
    pts.forEach(function (p) {
      s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3" class="dot"><title>' + esc(p.name) + '</title></circle>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 8) + '" class="axislabel">log10 TVL (USD)</text>';
    s += '<text x="14" y="' + (H / 2) + '" class="axislabel" transform="rotate(-90 14 ' + (H / 2) + ')">log10 market cap (USD)</text>';
    s += '</svg>';
    return el('div', { html: s });
  }

  function renderMethod() {
    var fit = DATA.fit;
    var a = DATA.audit;
    var items = [
      ['<b>Comparables.</b> ', 'The fit reads the ' + fit.comps + ' protocols in the snapshot that record a token with a market cap above zero, and regresses log market cap on log TVL with a Huber-robust fit, so a few protocols trading far from any curve cannot drag the slope. The pooled slope is ' + fit.slope.toFixed(3) + ' and the intercept ' + fit.intercept.toFixed(3) + '; the log-space R² is ' + fit.r_squared.toFixed(3) + '.'],
      ['<b>Category shifts.</b> ', 'Each category’s intercept shifts by its median residual, shrunk by n/(n+8) toward the pooled line, so a category with few comparables cannot drag the board. Categories with no live comparables use the pooled line. The shrinkage was picked by out-of-sample testing: the looser n/(n+4) fit scores worse out of sample.'],
      ['<b>Growth and age.</b> ', 'The fitted value is multiplied by 1 + 0.35 × clamped 7-day TVL change (−40% to +80%) and by a maturity factor from 0.70 to 1.00 over three years of tracking (365 days when DefiLlama reports no listing date), then capped at 5× TVL.'],
      ['<b>Nearest comparables.</b> ', 'Every row names its five nearest live comparables — the live protocols in its own category closest in TVL, filled from its main chain and then the whole comp set when the category is thin — so the value claim can be checked protocol by protocol. The verdict judges the fitted multiple against the size curve at the row’s own TVL, because the curve falls with size and a large protocol is nearly always below its category median even when it is rich for its size.'],
      ['<b>Verdicts.</b> ', 'FARM is a full position: fitted value at least $25M, multiple at least four fifths of what its size commands, TVL not collapsing. THIN is a small position. SKIP is the honest answer for a fitted value under $5M — the gas costs more than the position can return — or TVL falling 25% or more in a week while the multiple is already below half of what its size commands.'],
      ['<b>Validation.</b> ', 'A five-fold split by protocol slug, every parameter refit inside each fold, gives a median out-of-sample error of ×' + fit.oos_factor.toFixed(1) + ' on the deployed model, multipliers and cap included. Implied values are order-of-magnitude claims, and the board says so wherever it shows one.'],
      ['<b>Coverage and audit.</b> ', 'The board holds all ' + DATA.watchlist_size + ' watchlist protocols plus every other strictly pre-token protocol in the snapshot — ' + DATA.board_size + ' rows in all. A protocol is pre-token when its market cap, CoinGecko id and symbol are all null, and not a wrapped, staked or bridged product of a token that already trades. The audit below counts every protocol the snapshot carries.'],
      ['<b>What “records no token” means.</b> ', 'DefiLlama’s record is not proof. A protocol on this board may still carry a token its record does not show; the board says it records no token, never that it has none.'],
    ];
    var ul = el('ul', {});
    items.forEach(function (it) { ul.appendChild(el('li', { html: it[0] + it[1] })); });

    var auditTable = el('table', { class: 'comps' });
    auditTable.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Audit' }), el('th', { class: 'num', text: 'Protocols' }))));
    var ab = el('tbody', {});
    [
      ['Protocols in the snapshot', a.protocols],
      ['Record no token at all', a.loose_pre_token],
      ['— excluded: wrapped, staked or bridged category', a.rejected_excluded_category],
      ['— excluded: versioned name', a.rejected_versioned_name],
      ['— excluded: wrapped or staked word in the name', a.rejected_wrapped_word],
      ['— excluded: exchange name prefix', a.rejected_exchange_prefix],
      ['Strictly pre-token, ranked on the board', a.strict_pre_token],
      ['Already trade (market cap above zero)', a.live_with_token],
      ['Record a token but no market cap', a.token_no_mcap],
    ].forEach(function (row) {
      ab.appendChild(el('tr', {}, el('td', { text: row[0] }), el('td', { class: 'num', text: String(row[1]) })));
    });
    auditTable.appendChild(ab);

    var curveTable = el('table', { class: 'comps' });
    curveTable.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'TVL quintile' }), el('th', { class: 'num', text: 'TVL range' }), el('th', { class: 'num', text: 'Comps' }), el('th', { class: 'num', text: 'Median mcap / TVL' }))));
    var cb2 = el('tbody', {});
    fit.size_curve.forEach(function (b) {
      cb2.appendChild(el('tr', {},
        el('td', { text: 'Quintile ' + b.bin }),
        el('td', { class: 'num', text: fmtUsd(b.tvl_min_usd) + ' – ' + fmtUsd(b.tvl_max_usd) }),
        el('td', { class: 'num', text: String(b.comps) }),
        el('td', { class: 'num', text: fmtMult(b.median_multiple) })));
    });
    curveTable.appendChild(cb2);

    var note = el('div', { class: 'note' },
      el('h3', { text: 'Research note — what the snapshot says' }),
      el('p', { text: 'The size curve is the snapshot’s loudest fact: the median mcap / TVL multiple falls from about 0.65x in the smallest TVL quintile to about 0.04x in the largest, which is why the fit’s slope sits well below one and why a large protocol’s multiple must be judged against its own size, not its category. Lending is the best-covered category (' + (fit.categories.filter(function (c) { return c.category === 'Lending'; })[0] || { comps: 0 }).comps + ' live comps, median multiple ' + fmtMult((fit.categories.filter(function (c) { return c.category === 'Lending'; })[0] || { median_multiple: null }).median_multiple) + '), while bridges and basis trading sit far above the curve and liquid staking far below it — the category shifts exist for that spread. Only ' + DATA.verdict_counts.FARM + ' of the ' + DATA.board_size + ' rows earn a full farm verdict; ' + DATA.verdict_counts.SKIP + ' are not worth the gas at all, and the board says so rather than dressing every row up as an opportunity.' }),
      el('p', { text: 'What was tried and rejected, on the same five-fold splits: per-category slopes, chain shifts, growth and age as extra regressors, size-bin multiples in place of the curve, and unshrunk category multiples — every one scored worse out of sample than the robust pooled curve with shrunk shifts, so none of them is in the model. The honest error stays large: a median out-of-sample miss of ×' + fit.oos_factor.toFixed(1) + ' means any single row’s value is an order of magnitude, and the verdicts are the board’s answer to that uncertainty — farm the few rows where the value clears the cost by a wide margin, thin the middle, skip the rest.' }));

    return el('section', { class: 'method' },
      el('h2', { text: 'How the value is fitted' }),
      el('p', { text: 'The model is fitted from the snapshot on every run of the program — no multiple is typed in by hand, and no protocol name is ever special-cased. The same arithmetic runs in this page (impliedOf) and in the program that wrote board.json, and the detail view shows the page’s recomputation beside the board’s number.' }),
      ul,
      el('h3', { text: 'The size curve' }),
      renderCurve(),
      curveTable,
      el('h3', { text: 'Audit of the snapshot' }),
      auditTable,
      note,
      el('p', { html: 'Model <code>radar-3-comps</code> · snapshot ' + esc(DATA.as_of) + ' · source ' + esc(DATA.source) + ' · floor $50,000,000.' }));
  }

  function render() {
    writeHash();
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(renderHero());
    wrap.appendChild(renderTabs());
    if (state.tab === 'board') {
      wrap.appendChild(renderControls());
      wrap.appendChild(el('div', { id: 'tablehost' }));
      var detail = renderDetail();
      if (detail) wrap.appendChild(detail);
      wrap.appendChild(el('p', { class: 'warn', text: 'Implied values are the model’s claim, fitted from comparables with a median out-of-sample error of ×' + DATA.fit.oos_factor.toFixed(1) + ' — an order of magnitude, not a price target. This board does not predict whether or when any protocol issues a token.' }));
    } else if (state.tab === 'live') {
      wrap.appendChild(renderLive());
    } else {
      wrap.appendChild(renderMethod());
    }
    wrap.appendChild(el('footer', { class: 'foot', text: 'Token Radar · model radar-3-comps · snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · 198 pre-token protocols, 40 on the watchlist · rendered with no network.' }));
    app.appendChild(wrap);
    if (state.tab === 'board') renderTable();
    if (state.selected) {
      var d = document.querySelector('.detail');
      if (d && location.hash.indexOf('detail=') >= 0) d.scrollIntoView({ block: 'start' });
    }
  }

  readHash();
  render();
})();
