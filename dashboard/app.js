// Token Radar v2 dashboard: a static page, no network. It reads window.RADAR (data.js, written by
// main.ts from the same board that board.json carries), so the screenshots and the code agree.
//
// Views, all from the same rows: the board (sortable, filterable), a detail view for each protocol
// (click a row: model breakdown, three comparables, an 8-step mechanism-aware farm plan), and the
// live-token view (the comparables the model is fitted on). State lives in the URL hash so a
// screenshot can open one view directly: #detail=<slug>, #watchlist=1, #category=<name>,
// #verdict=FARM|THIN|SKIP, #q=<text>, #sort=<key>.

(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  // The watchlist slugs are the snapshot's own list; the board marks them from the model's data.
  var WL = {};
  (R.watchlist_slugs || []).forEach(function (s) { WL[s] = true; });

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var v = (Math.round(n * 100) / 100).toFixed(1);
    return (n > 0 ? '+' : '') + v + '%';
  }
  function ageFmt(d) {
    if (d === null || d === undefined) return '—';
    if (d < 365) return d + 'd';
    return (d / 365).toFixed(1) + 'y';
  }
  function num2(n) {
    if (n === null || n === undefined) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function hashState() {
    var h = (location.hash || '').replace(/^#/, '');
    var out = { detail: null, watchlist: false, category: '', verdict: '', q: '', sort: 'rank', dir: 1 };
    h.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p.length !== 2) return;
      var k = decodeURIComponent(p[0]);
      var v = decodeURIComponent(p[1]);
      if (k === 'detail') out.detail = v;
      if (k === 'watchlist' && v === '1') out.watchlist = true;
      if (k === 'category') out.category = v;
      if (k === 'verdict') out.verdict = v;
      if (k === 'q') out.q = v;
      if (k === 'sort') out.sort = v;
    });
    return out;
  }
  function setHash(s) {
    var parts = [];
    if (s.detail) parts.push('detail=' + encodeURIComponent(s.detail));
    if (s.watchlist) parts.push('watchlist=1');
    if (s.category) parts.push('category=' + encodeURIComponent(s.category));
    if (s.verdict) parts.push('verdict=' + s.verdict);
    if (s.q) parts.push('q=' + encodeURIComponent(s.q));
    if (s.sort && s.sort !== 'rank') parts.push('sort=' + s.sort);
    var h = parts.join('&');
    if (('' + location.hash).replace(/^#/, '') !== h) history.replaceState(null, '', h ? '#' + h : '#');
  }

  var state = hashState();
  var categories = [];
  R.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
  });
  categories.sort();

  function filteredRows() {
    var rows = R.rows.filter(function (r) {
      if (state.watchlist && !WL[r.slug]) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -9999 : a.change_7d; bv = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'farmer') { av = a.farm_value_per_farmer_usd; bv = b.farm_value_per_farmer_usd; }
      else { av = a.rank; bv = b.rank; }
      return (av - bv) * dir;
    });
    return rows;
  }

  function badge(v) { return '<span class="badge ' + v + '">' + v + '</span>'; }

  function headerHtml() {
    var farm = R.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
    var thin = R.rows.filter(function (r) { return r.verdict === 'THIN'; }).length;
    var skip = R.rows.filter(function (r) { return r.verdict === 'SKIP'; }).length;
    return '<header class="hero"><h1>Token Radar<span class="dot">.</span></h1>' +
      '<p class="sub">Every protocol in the sealed DefiLlama snapshot that records no token, ranked by ' +
      'what its launch would be worth if its record stayed as it is — and what one farmer should do ' +
      'about it. The implied value is this entry&rsquo;s own claim, never make.fun&rsquo;s.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + R.board_size + '</b><span>ranked rows</span></div>' +
      '<div class="stat"><b>' + R.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + R.pre_token_total + '</b><span>record no token</span></div>' +
      '<div class="stat"><b>' + R.fit.comps_n + '</b><span>token families fitted</span></div>' +
      '<div class="stat"><b>' + farm + ' / ' + thin + ' / ' + skip + '</b><span>farm / thin / skip</span></div>' +
      '<div class="stat"><b>' + esc(R.as_of) + '</b><span>snapshot date</span></div>' +
      '</div></header>';
  }

  function modelHtml() {
    var f = R.fit;
    var c = f.coefficients;
    var adj = Object.keys(f.category_adjustments).sort(function (a, b) {
      return Math.abs(f.category_adjustments[b]) - Math.abs(f.category_adjustments[a]);
    }).slice(0, 6).map(function (cat) {
      var v = f.category_adjustments[cat];
      return esc(cat) + ' ' + (v >= 0 ? '+' : '') + v.toFixed(2);
    }).join(' &middot; ');
    return '<section class="panel"><h2>How the value is fitted <span class="tag">model ' + esc(R.model_version) + '</span></h2>' +
      '<div class="formula">log10(mcap) = ' + c[0] + ' + ' + c[1] + ' &middot; log10(TVL) + ' + c[2] +
      ' &middot; chg7d + ' + c[3] + ' &middot; log10(age_days) + category\n' +
      'fitted on the ' + f.comps_n + ' token families that already trade; chg7d clipped to the comps&rsquo; own range, &minus;40%..+30%</div>' +
      '<p>TVL, seven-day growth and how long a protocol has run with no token are the only inputs, ' +
      'all from the snapshot itself — and growth and age are fitted, not hand-set: v1 multiplied the ' +
      'curve by a hand-picked growth weight and maturity ramp, this version lets the data set both ' +
      'slopes. The growth slope is negative (' + c[2] + '): at the same TVL, a protocol whose TVL just ' +
      'spiked trades lower, because incentive-driven TVL does not come with market cap. No protocol ' +
      'name is ever special-cased.</p>' +
      '<div class="fitgrid">' +
      '<div><b>' + f.r_squared + '</b><span>R&sup2;, in sample</span></div>' +
      '<div><b>' + f.oos_r_squared + '</b><span>R&sup2;, 5-fold out of sample</span></div>' +
      '<div><b>&plusmn;' + f.oos_median_factor + '&times;</b><span>band: 5-fold OOS median error</span></div>' +
      '<div><b>&plusmn;' + f.oos_p80_factor + '&times;</b><span>band: 5-fold OOS 80th percentile</span></div>' +
      '<div><b>' + num2(f.time_split_r_squared) + '</b><span>R&sup2;, time split (' + f.time_split_n_test + ' tested)</span></div>' +
      '<div><b>' + f.slope_bootstrap_p5 + ' – ' + f.slope_bootstrap_p95 + '</b><span>TVL slope, bootstrap 90%</span></div>' +
      '</div>' +
      '<table class="valid"><thead><tr><th>Check</th><th>What it does</th><th style="text-align:right">Result</th></tr></thead><tbody>' +
      '<tr><td>5-fold cross-validation</td><td>Each family predicted from a curve fitted without its fold, category adjustment refitted too</td><td class="num">&plusmn;' + f.oos_median_factor + '&times; median, R&sup2; ' + f.oos_r_squared + '</td></tr>' +
      '<tr><td>Time split</td><td>Fitted on protocols listed before 2024-06-01, tested on the ' + f.time_split_n_test + ' listed after</td><td class="num">R&sup2; ' + num2(f.time_split_r_squared) + ', &plusmn;' + num2(f.time_split_median_factor) + '&times; median</td></tr>' +
      '<tr><td>Bootstrap (200 draws)</td><td>The TVL slope refitted on resampled families, seeded so it reproduces exactly</td><td class="num">' + f.slope_bootstrap_p5 + ' – ' + f.slope_bootstrap_p95 + '</td></tr>' +
      '<tr><td>Fixed-multiple baseline</td><td>The global median mcap/TVL ratio, leave-one-out, for the same families</td><td class="num">&plusmn;' + f.fixed_ratio_loo_factor + '&times; median</td></tr>' +
      '</tbody></table>' +
      '<p class="small">The fit is weak and the dashboard says so: TVL, growth and age explain only ' +
      f.r_squared + ' of log market cap, and the time split explains about none of it (R&sup2; ' +
      num2(f.time_split_r_squared) + '). What survives is the ranking: median error &plusmn;' + f.oos_median_factor +
      '&times; against &plusmn;' + f.fixed_ratio_loo_factor + '&times; for a fixed multiple. Every implied ' +
      'value carries the &plusmn;' + f.oos_median_factor + '&times; band. Largest category adjustments ' +
      '(log10, shrunk, capped &plusmn;0.2): ' + adj + '. ' + f.comps_excluded_zero_mcap +
      ' token records carry a market cap of zero or less and are excluded from the fit.</p>' +
      '<p class="small">One farmer&rsquo;s economics, netted to the dollar: the low end of the band, 5% of it ' +
      'to farmers, split across TVL &divide; $10,000 estimated farmers. FARM at 3&times; the farm&rsquo;s ' +
      'cost, THIN at 1&times;, else SKIP. Rank is the launch&rsquo;s size; the verdict is one wallet&rsquo;s economics.</p>' +
      '</section>';
  }

  function controlsHtml(rows) {
    var opts = '<option value="">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug&hellip;" value="' + esc(state.q) + '" aria-label="Search">' +
      '<select id="cat" aria-label="Category">' + opts + '</select>' +
      '<select id="verdict" aria-label="Verdict"><option value="">All verdicts</option>' +
      ['FARM', 'THIN', 'SKIP'].map(function (v) {
        return '<option' + (state.verdict === v ? ' selected' : '') + '>' + v + '</option>';
      }).join('') + '</select>' +
      '<label class="chk"><input type="checkbox" id="wl"' + (state.watchlist ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + R.rows.length + ' rows</span>' +
      '</div>';
  }

  function sortArrow(key) {
    if (state.sort !== key) return '';
    return state.dir === 1 ? ' ▲' : ' ▼';
  }

  function boardHtml(rows) {
    if (rows.length === 0) return '<div class="empty">No protocols match this filter.</div>';
    var body = rows.map(function (r) {
      var g = r.change_7d === null ? '<span class="num">—</span>' : '<span class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      var wl = WL[r.slug] ? ' <span class="badge WL">WL</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span>' + wl + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td>' + g + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num">' + money(r.implied_value_usd) + '<br><span style="color:var(--muted);font-size:12px">' + money(r.implied_low_usd) + '–' + money(r.implied_high_usd) + '</span></td>' +
        '<td class="num">$' + r.farm_value_per_farmer_usd.toFixed(2) + '</td>' +
        '<td>' + badge(r.verdict) + '</td></tr>';
    }).join('');
    return '<table class="board"><thead><tr>' +
      '<th data-sort="rank"># ' + sortArrow('rank') + '</th>' +
      '<th>Protocol</th><th>Category</th>' +
      '<th data-sort="tvl">TVL' + sortArrow('tvl') + '</th>' +
      '<th data-sort="growth">7d' + sortArrow('growth') + '</th>' +
      '<th data-sort="age">Age' + sortArrow('age') + '</th>' +
      '<th data-sort="implied">Implied value' + sortArrow('implied') + '</th>' +
      '<th data-sort="farmer">Per farmer' + sortArrow('farmer') + '</th>' +
      '<th>Verdict</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function detailHtml(r) {
    var steps = r.farm_steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('');
    var comps = (r.comparables || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.tvl_usd) + '</td>' +
        '<td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + (c.mcap_usd / c.tvl_usd).toFixed(2) + '&times;</td></tr>';
    }).join('');
    var c = R.fit.coefficients;
    return '<section class="panel detail"><h2>#' + r.rank + ' ' + esc(r.name) + ' ' + badge(r.verdict) + '</h2>' +
      '<p>' + esc(r.slug) + ' &middot; ' + esc(r.category || 'no category') + ' &middot; ' + esc(r.chains.join(', ') || 'no chains listed') +
      ' &middot; tracked since ' + esc(r.listed_at || 'unknown') + (WL[r.slug] ? ' &middot; <span class="badge WL">on the watchlist</span>' : '') + '</p>' +
      '<div class="grid">' +
      '<div><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</b><span>backtested band</span></div>' +
      '<div><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div><b>' + pct(r.change_7d) + '</b><span>TVL change, 7 days</span></div>' +
      '<div><b>' + ageFmt(r.age_days) + '</b><span>tracked, no token</span></div>' +
      '<div><b>$' + r.farm_value_per_farmer_usd.toFixed(2) + '</b><span>one farmer&rsquo;s low-end share</span></div>' +
      '<div><b>~' + r.farmers_estimate.toLocaleString('en-US') + '</b><span>estimated farmers</span></div>' +
      '<div><b>$' + r.farm_cost_usd + '</b><span>farm cost, gas</span></div>' +
      '</div>' +
      '<h3 style="margin:12px 0 4px;font-size:15px;color:var(--accent)">How the value is built</h3>' +
      '<p class="small">log10(mcap) = ' + c[0] + ' + ' + c[1] + ' &middot; log10(' + moneyFull(r.tvl_usd) + ') + ' + c[2] +
      ' &middot; ' + (r.growth_pct_clipped / 100).toFixed(2) + ' (7d change, clipped to &minus;40%..+30%) + ' + c[3] +
      ' &middot; log10(' + r.age_days_used + ' days)' + (r.category_adjustment_log10 ? ' + ' + r.category_adjustment_log10 + ' for ' + esc(r.category || '') : ', no category adjustment') +
      ' = ' + money(r.curve_value_usd) + '. The band is the 5-fold out-of-sample median error of &plusmn;' + R.fit.oos_median_factor + '&times;.</p>' +
      '<h3 style="margin:12px 0 4px;font-size:15px;color:var(--accent)">Nearest comparables that already trade</h3>' +
      '<table class="comps"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>mcap / TVL</th></tr></thead>' +
      '<tbody>' + comps + '</tbody></table>' +
      '<p class="small">The three token families nearest this protocol&rsquo;s TVL, same category first. ' +
      'They are what the curve is fitted on — read the implied value against them before trusting it.</p>' +
      '<h3 style="margin:12px 0 4px;font-size:15px;color:var(--accent)">Farm plan — 8 steps, netted to the dollar</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p><a href="#" id="closeDetail">Back to the board</a></p></section>';
  }

  function liveHtml() {
    var rows = R.live.map(function (p) {
      return '<tr><td>' + esc(p.name) + '<br><span style="color:var(--muted)">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + (p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '&times;' : '—') + '</td></tr>';
    }).join('');
    return '<section class="panel"><h2>Live tokens — the comparables <span class="tag">top ' + R.live.length + ' by market cap</span></h2>' +
      '<p>These already trade, so the board shows the market&rsquo;s own value for them, never a model&rsquo;s. ' +
      'The ' + R.fit.comps_n + ' token families the curve is fitted on are every family with a positive ' +
      'market cap — the size curve is about size, so no family is thrown out for its category.</p>' +
      '<table class="live"><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>mcap / TVL</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }

  function methodHtml() {
    var f = R.fit;
    var c = f.coefficients;
    return '<section class="panel method"><h2>Method, in full</h2>' +
      '<h3>1. The universe</h3><p>The sealed snapshot holds 758 protocols at or above $5,000,000 of TVL, ' +
      'fetched once from DefiLlama&rsquo;s public API (' + esc(R.source) + '). ' + R.pre_token_total +
      ' of them record no token; ' + R.excluded_total + ' of those are versioned pools or wrapped, staked ' +
      'or bridged products of tokens that already trade, so they are audited but not ranked. The board ' +
      'ranks the clean ' + R.board_size + ', including all ' + R.watchlist_size + ' of the watchlist. ' +
      'A protocol below the $50,000,000 floor is no worse a subject than one on it.</p>' +
      '<h3>2. The value model</h3><p>One curve, fitted on the snapshot&rsquo;s own comparables: log10(market cap) = ' +
      c[0] + ' + ' + c[1] + ' &middot; log10(TVL) + ' + c[2] + ' &middot; seven-day change + ' + c[3] +
      ' &middot; log10(age in days), ordinary least squares on the ' + f.comps_n + ' token families with a ' +
      'positive market cap. A category adjustment — the median log-residual of the protocol&rsquo;s category, ' +
      'shrunk toward zero and capped at &plusmn;0.2 — is added after the curve. Growth is clipped to the ' +
      'comps&rsquo; own range (&minus;40%..+30%) because one pre-token protocol prints +4,448% in seven days ' +
      'and no slope may be extrapolated to that. Unknown age is the comps&rsquo; median, 1,000 days. ' +
      'The same function scores every row.</p>' +
      '<h3>3. The backtest</h3><p>Three checks, all computed from the snapshot at run time. 5-fold ' +
      'cross-validation gives the band: median error &plusmn;' + f.oos_median_factor + '&times;, 80th percentile ' +
      '&plusmn;' + f.oos_p80_factor + '&times;, R&sup2; ' + f.oos_r_squared + '. The time split — fitted before ' +
      '2024-06-01, tested on the ' + f.time_split_n_test + ' families listed after — gives R&sup2; ' +
      num2(f.time_split_r_squared) + ' and median &plusmn;' + num2(f.time_split_median_factor) +
      '&times;: the curve does not predict a later era, and the page says so. The bootstrap (200 seeded ' +
      'draws) puts the TVL slope at ' + f.slope_bootstrap_p5 + ' – ' + f.slope_bootstrap_p95 + ', stably ' +
      'positive. A fixed mcap/TVL multiple would err by &plusmn;' + f.fixed_ratio_loo_factor + '&times; ' +
      'leave-one-out, worse than the curve on every check.</p>' +
      '<h3>4. The farm verdict</h3><p>One farmer&rsquo;s low-end share is the low end of the band, 5% of it to ' +
      'farmers, split across TVL &divide; $10,000 estimated farmers. FARM at 3&times; the farm&rsquo;s gas cost, ' +
      'THIN at 1&times;, else SKIP. Rank answers &ldquo;how big is this launch&rdquo;; the verdict answers ' +
      '&ldquo;does it pay for one wallet&rdquo;. They are different questions, and the board keeps them apart. ' +
      'Each plan&rsquo;s steps follow the protocol&rsquo;s mechanism — a DEX farm swaps and provides liquidity, ' +
      'a lending farm supplies and borrows, a perps farm posts margin and hedges — and one step names ' +
      'what can go wrong with that mechanism.</p>' +
      '<h3>5. What this is not</h3><p>The board does not predict whether or when a token is issued. ' +
      'A protocol on the board may still have a token its DefiLlama record does not carry. The implied ' +
      'value is this entry&rsquo;s own claim, and the farm plan is a starting point, not financial advice.</p>' +
      '</section>';
  }

  function render() {
    var rows = filteredRows();
    var detail = state.detail ? R.rows.filter(function (r) { return r.slug === state.detail; })[0] : null;
    var html = '<div class="wrap">' + headerHtml();
    // When a detail is open it renders first, right under the header, so the protocol's detail is
    // at the top of the page by construction — no scrolling needed to see it.
    if (detail) html += detailHtml(detail);
    html += '<section class="panel" id="board"><h2>The board <span class="tag">click a row for its detail</span></h2>' +
      controlsHtml(rows) + boardHtml(rows) + '</section>';
    html += modelHtml();
    html += liveHtml() + methodHtml();
    html += '<footer>Source: ' + esc(R.source) + '. Snapshot date ' + esc(R.as_of) +
      '. Implied values are this entry&rsquo;s own model claim. No network is used: every number on this page ' +
      'comes from the sealed snapshot and the fitted curve.</footer></div>';
    app.innerHTML = html;
    app.removeAttribute('aria-busy');
    bind(rows);
  }

  function bind(rows) {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; state.detail = null; setHash(state); render(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; state.detail = null; setHash(state); render(); });
    var ver = document.getElementById('verdict');
    if (ver) ver.addEventListener('change', function () { state.verdict = ver.value; state.detail = null; setHash(state); render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.watchlist = wl.checked; state.detail = null; setHash(state); render(); });
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        setHash(state); render();
      });
    });
    document.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        setHash(state); render();
      });
    });
    var close = document.getElementById('closeDetail');
    if (close) close.addEventListener('click', function (e) {
      e.preventDefault();
      state.detail = null; setHash(state); render();
      var b = document.getElementById('board');
      if (b) b.scrollIntoView();
    });
  }

  window.addEventListener('hashchange', function () {
    state = hashState();
    render();
  });

  render();
})();
