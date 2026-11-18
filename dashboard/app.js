// Token Radar v3 dashboard: a static page, no network. It reads window.RADAR (data.js, written by
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
    var f = R.fit;
    var counts = R.verdict_counts;
    var kpis = [
      [R.protocol_total, 'Protocols'], [R.board_size, 'Ranked'], [R.watchlist_size, 'Watchlist'],
      [R.live_size, 'Live-token records'], [R.excluded_total, 'Audited outside board'],
      ['±' + f.oos_median_factor + '×', 'Value band'], [f.oos_r_squared, '5-fold OOS R²'],
      [f.walk_forward_pooled.median_factor + '×', 'Walk-forward median'],
      [counts.FARM + '/' + counts.THIN + '/' + counts.SKIP, 'FARM / THIN / SKIP']
    ];
    return '<header class="hero"><h1>Token Radar<span class="dot">.</span></h1>' +
      '<p class="sub">Pre-token launch values and farm economics · ' + esc(R.as_of) +
      ' · <a href="#accounted">Universe audit</a></p><div class="stats">' +
      kpis.map(function (item) {
        return '<div class="stat"><b>' + item[0] + '</b><span>' + item[1] + '</span></div>';
      }).join('') + '</div></header>';
  }

  function metricRow(label, m) {
    return '<tr><td>' + esc(label) + '</td><td>' + m.n_test + '</td><td>' +
      m.median_factor + '×</td><td>' + m.r_squared + '</td></tr>';
  }

  function modelHtml() {
    var f = R.fit;
    var c = f.coefficients;
    var terms = ['growth', 'age', 'category'];
    var dropped = terms.filter(function (term) { return !f.selected_terms.includes(term); });
    var headings = '<thead><tr><th>Prediction set</th><th>Test n</th><th>Median factor</th><th>R²</th></tr></thead>';
    return '<section class="panel"><h2>Validation · ' + esc(R.model_version) + '</h2>' +
      '<div class="formula">log₁₀(mcap) = ' + c[0] + ' + ' + c[1] + ' × log₁₀(TVL) − ' +
      Math.abs(c[2]) + ' × clipped 7d growth</div>' +
      '<p>OLS on ' + f.comps_n + ' token families. Curve R² in sample: ' + f.r_squared +
      '. The selected model has a 5-fold median error of ' + f.oos_median_factor + '× (R² ' +
      f.oos_r_squared + '). The wide band and weak chronological scores limit pricing precision.</p>' +
      '<table class="valid"><caption>Walk-forward · families with listing dates</caption>' + headings + '<tbody>' +
      f.walk_forward.map(function (w) {
        return metricRow('Earliest ' + w.n_train + ' train → next window', w.validation);
      }).join('') + metricRow('Pooled', f.walk_forward_pooled) + '</tbody></table>' +
      '<table class="valid"><caption>Term ablation · same five held-out folds</caption>' + headings + '<tbody>' +
      Object.keys(f.ablation).map(function (key) { return metricRow(key, f.ablation[key]); }).join('') +
      '</tbody></table><p>Kept: ' + esc(f.selected_terms.join(', ') || 'TVL only') + '. Dropped: ' +
      esc(dropped.join(', ') || 'none') + '. A term survives when its removal from the full model raises the median error factor. ' +
      'The selected model’s five-fold score reuses the selection folds.</p>' +
      '<p class="small">Full candidate TVL slope p5–p95: ' + f.slope_bootstrap_p5 + '–' + f.slope_bootstrap_p95 +
      ' across ' + R.model.bootstrap_draws + ' seeded refits. Fixed-ratio leave-one-out median: ' +
      f.fixed_ratio_loo_factor + '×. Earlier fixed date split: R² ' + num2(f.time_split_r_squared) + '.</p></section>';
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
        '<td>' + badge(r.verdict) + '</td><td class="num">' + r.rank_p10 + '–' + r.rank_p90 + '</td></tr>';
    }).join('');
    return '<table class="board"><thead><tr>' +
      '<th data-sort="rank"># ' + sortArrow('rank') + '</th>' +
      '<th>Protocol</th><th>Category</th>' +
      '<th data-sort="tvl">TVL' + sortArrow('tvl') + '</th>' +
      '<th data-sort="growth">7d' + sortArrow('growth') + '</th>' +
      '<th data-sort="age">Age' + sortArrow('age') + '</th>' +
      '<th data-sort="implied">Implied value' + sortArrow('implied') + '</th>' +
      '<th data-sort="farmer">Per farmer' + sortArrow('farmer') + '</th>' +
      '<th>Verdict</th><th title="10th to 90th percentile across seeded refits">Rank range</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function detailHtml(r) {
    var steps = r.farm_steps.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
    var comps = (r.comparables || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.tvl_usd) + '</td>' +
        '<td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + (c.mcap_usd / c.tvl_usd).toFixed(2) + '&times;</td></tr>';
    }).join('');
    var c = R.fit.coefficients;
    return '<section class="panel detail"><h2>#' + r.rank + ' ' + esc(r.name) + ' ' + badge(r.verdict) + '</h2>' +
      '<p>' + esc(r.slug) + ' &middot; ' + esc(r.category || 'no category') + ' &middot; ' + esc(r.chains.join(', ') || 'no chains listed') +
      ' &middot; tracked since ' + esc(r.listed_at || 'unknown') + (WL[r.slug] ? ' &middot; <span class="badge WL">on the watchlist</span>' : '') + '</p>' +
      '<p>Rank ' + r.rank + ', typically ' + r.rank_p10 + '–' + r.rank_p90 + ' across ' +
      R.model.bootstrap_draws + ' refits (median ' + r.rank_p50 + ').</p><div class="grid">' +
      '<div><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</b><span>backtested band</span></div>' +
      '<div><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div><b>' + pct(r.change_7d) + '</b><span>TVL change, 7 days</span></div>' +
      '<div><b>' + ageFmt(r.age_days) + '</b><span>tracked, no token</span></div>' +
      '<div><b>$' + r.farm_value_per_farmer_usd.toFixed(2) + '</b><span>one farmer&rsquo;s low-end share</span></div>' +
      '<div><b>~' + r.farmers_estimate.toLocaleString('en-US') + '</b><span>estimated farmers</span></div>' +
      '<div><b>$' + r.farm_cost_usd + '</b><span>farm cost, gas</span></div>' +
      '<div><b>' + moneyFull(r.break_even_implied_usd) + '</b><span>Break-even low-end value</span></div>' +
      '<div><b>' + (r.net_per_hour_usd < 0 ? '−' : '') + '$' + Math.abs(r.net_per_hour_usd).toFixed(2) +
      '</b><span>Net per active hour</span></div>' +
      '</div>' +
      '<h3 style="margin:12px 0 4px;font-size:15px;color:var(--accent)">How the value is built</h3>' +
      '<p class="small">log10(mcap) = ' + c[0] + (c[1] < 0 ? ' − ' : ' + ') + Math.abs(c[1]) + ' &middot; log10(' + moneyFull(r.tvl_usd) + ')' + (c[2] < 0 ? ' − ' : ' + ') + Math.abs(c[2]) +
      ' &middot; ' + (r.growth_pct_clipped / 100).toFixed(2) + ' (7d change, clipped to &minus;40%..+30%)' +
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
      return '<tr><td>' + esc(p.slug) + '</td><td>' + esc(p.name) + '</td><td>' +
        esc(p.category || '—') + '</td><td class="num">' + moneyFull(p.mcap_usd) +
        '</td><td>' + (p.mcap_usd > 0 ? 'Traded' : 'Non-positive reported cap') + '</td></tr>';
    }).join('');
    var excluded = R.excluded.map(function (p) {
      return '<tr><td>' + esc(p.slug) + '</td><td>' + esc(p.name) + '</td><td>' +
        esc(p.category || '—') + '</td><td>' + esc(p.reason) + '</td></tr>';
    }).join('');
    return '<section class="panel" id="accounted"><h2>All ' + R.protocol_total + ' protocols accounted for</h2>' +
      '<p><a href="#board">' + R.board_size + ' ranked on the board</a> · ' + R.live_size +
      ' with reported market caps · ' + R.excluded_total + ' audited outside both lists.</p>' +
      '<details><summary>Live-token records · ' + R.live_size + '</summary><div class="table-scroll">' +
      '<table class="live"><thead><tr><th>Slug</th><th>Protocol</th><th>Category</th><th>Reported cap</th><th>Status</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></details>' +
      '<details><summary>Audited, unranked · ' + R.excluded_total + '</summary><div class="table-scroll">' +
      '<table class="live"><thead><tr><th>Slug</th><th>Protocol</th><th>Category</th><th>Reason</th></tr></thead><tbody>' +
      excluded + '</tbody></table></div></details></section>';
  }

  function methodHtml() {
    return '<section class="panel method"><h2>Method · ' + esc(R.model_version) + '</h2>' +
      '<p>One comparable per CoinGecko family with a positive market cap and TVL, keeping the highest-TVL record. ' +
      'Growth is clipped to −40%…+30%. Five-fold validation uses slug order modulo five. ' +
      'Walk-forward trains first on the earliest half, then on the earliest three quarters of dated families. ' +
      'Rank ranges give p10–p90 from refitting the full candidate, including category adjustments, on seeded family resamples. ' +
      'They capture sensitivity to resampling and to using the full specification.</p>' +
      '<p>One wallet gets a modeled share of 5% of low-end implied value divided by the estimated number of farmers ' +
      '(TVL divided by $10,000, rounded, minimum one). FARM starts at three times estimated gas cost, THIN at cost. ' +
      'Break-even low-end value divides cost by that wallet’s allocation fraction. Net per active hour divides the ' +
      'share minus gas by 15 minutes of setup, 10 minutes per hold week (rounded up), and 10 minutes for risk and claim review.</p>' +
      '<p>Launch timing, eligibility and token issuance are unknown. Model values are scenarios based on the sealed snapshot.</p></section>';
  }
  function render() {
    var rows = filteredRows();
    var detail = state.detail ? R.rows.filter(function (r) { return r.slug === state.detail; })[0] : null;
    var html = '<div class="wrap">' + headerHtml();
    // When a detail is open it renders first, right under the header, so the protocol's detail is
    // at the top of the page by construction — no scrolling needed to see it.
    if (detail) html += detailHtml(detail);
    html += '<section class="panel" id="board"><h2>The board <span class="tag">click a row for its detail</span></h2>' +
      controlsHtml(rows) + '<div class="table-scroll">' + boardHtml(rows) + '</div></section>';
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
    if (location.hash === '#accounted' || location.hash === '#board') return;
    state = hashState();
    render();
  });

  render();
})();
