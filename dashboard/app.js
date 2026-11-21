(function () {
  'use strict';
  const data = window.RADAR_DATA;
  if (!data || !Array.isArray(data.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="5">Board data is unavailable.</td></tr>';
    return;
  }
  const rows = data.rows;
  const summary = data.summary;
  const bySlug = new Map(rows.map(row => [row.slug, row]));
  const originalRanks = new Map(rows.map(row => [row.slug, row.rank]));
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const money = value => '$' + fmt.format(value || 0);
  const pct = value => (100 * value).toFixed(1) + '%';
  const safe = value => String(value ?? '—').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const el = id => document.getElementById(id);
  const pre = rows.filter(row => row.token_status === 'pre-token');
  const cats = [...new Set(rows.map(row => row.category || 'Uncategorized'))].sort();
  el('asof').textContent = data.as_of;
  el('universe').textContent = fmt.format(summary.universe);
  el('pretoken').textContent = fmt.format(summary.pre_token);
  el('median').textContent = money(summary.median_expected_value_usd);
  const count = summary.verdict_counts;
  el('verdicts').textContent = count.FARM + ' / ' + count.THIN + ' / ' + count.SKIP;
  el('verdictCaption').textContent = 'FARM / THIN / SKIP · eligible candidates';
  el('accounted').textContent = summary.rows_accounted + ' / ' + summary.universe;
  el('audited').textContent = summary.audited_count + ' / ' + summary.universe;
  el('hash').textContent = summary.snapshot_sha256;
  el('checks').textContent = summary.self_test.passed + ' / ' + summary.self_test.total;
  el('lambda').textContent = summary.ridge.selected_lambda;
  const ridge = summary.ridge;
  el('cv').textContent = ridge.repeated_cv_band_factor.toFixed(2) + '×';
  el('loo').textContent = ridge.loo.median_factor_error.toFixed(2) + '×';
  el('loco').textContent = ridge.loco.median_factor_error.toFixed(2) + '×';
  el('time').textContent = ridge.time_split.r2.toFixed(3);
  el('logloss').textContent = summary.listing_odds.mean_log_loss.toFixed(3) + ' / ' +
    (100 * summary.listing_odds.mean_accuracy).toFixed(0) + '%';
  el('validationFoot').textContent = 'Selected λ=' + ridge.selected_lambda +
    ' · walk-forward ' + ridge.walk_forward.median_factor_error.toFixed(2) + '× median error / R² ' +
    ridge.walk_forward.r2.toFixed(3) + ' (n=' + ridge.walk_forward.n + ') · P(list) holdouts: ' +
    summary.listing_odds.held_out_20_percent_twice.map(x => (100 * x.accuracy).toFixed(0) + '% accuracy').join(' / ') +
    ' · current-token-record proxy, not future launch timing.';
  cats.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    el('filterCategory').appendChild(option);
  });
  const stateFromHash = () => {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('detail=')) return { detail: decodeURIComponent(hash.slice(7)), verdict: '' };
    if (hash.startsWith('verdict=')) return { detail: '', verdict: decodeURIComponent(hash.slice(8)) };
    return { detail: '', verdict: '' };
  };
  const state = stateFromHash();
  el('filterVerdict').value = state.verdict;
  let sortKey = 'rank', sortDirection = 1;
  function filtered() {
    const verdict = el('filterVerdict').value;
    const category = el('filterCategory').value;
    const minValue = Number(el('minValue').value) || 0;
    const minOdds = Number(el('minOdds').value) || 0;
    return rows.filter(row => {
      const isLive = row.token_status === 'token-recorded';
      const excluded = row.token_status === 'excluded-product';
      const rowVerdict = isLive ? 'LIVE' : excluded ? 'EXCLUDED' : row.farm_plan.verdict;
      return (!verdict || verdict === rowVerdict) &&
        (!category || category === (row.category || 'Uncategorized')) &&
        row.expected_value_usd >= minValue && row.p_list >= minOdds;
    }).sort((a, b) => {
      const left = a[sortKey], right = b[sortKey];
      if (typeof left === 'number' && typeof right === 'number') return sortDirection * (left - right) || a.slug.localeCompare(b.slug);
      return sortDirection * String(left ?? '').localeCompare(String(right ?? '')) || a.slug.localeCompare(b.slug);
    });
  }
  function renderTable() {
    const visible = filtered();
    el('resultCount').textContent = fmt.format(visible.length) + ' rows';
    el('rows').innerHTML = visible.slice(0, 250).map(row => {
      const live = row.token_status === 'token-recorded';
      const excluded = row.token_status === 'excluded-product';
      const verdict = live ? 'LIVE' : excluded ? 'EXCLUDED' : row.farm_plan.verdict;
      const active = location.hash === '#detail=' + encodeURIComponent(row.slug);
      return '<tr data-slug="' + safe(row.slug) + '" class="' + (active ? 'selected' : '') + '">' +
      '<td class="rank">' + originalRanks.get(row.slug) + '</td><td><span class="protocol">' + safe(row.name) +
        '</span><span class="category">' + safe(row.category || 'Uncategorized') + '</span></td>' +
        '<td class="money">' + money(row.expected_value_usd) + '</td><td class="odds">' +
        pct(row.p_list) + '</td><td><span class="tag ' + verdict + '">' + verdict + '</span></td></tr>';
    }).join('') || '<tr><td colspan="5">No protocols match these filters.</td></tr>';
    el('rows').querySelectorAll('tr[data-slug]').forEach(tr => tr.addEventListener('click', () => {
      location.hash = 'detail=' + encodeURIComponent(tr.dataset.slug);
    }));
  }
  function detail(row) {
    if (!row) {
      el('detail').innerHTML = '<div class="detail-empty"><span>RADAR DETAIL / 01</span><h3>Select a protocol</h3>' +
        '<p>Choose a row to inspect its fitted value, listing odds and farm plan.</p></div>';
      return;
    }
    const coefficients = ridge.coefficients;
    const ageYears = row.listed_at
      ? Math.max(1 / 365, Math.floor((Date.parse(data.as_of) - Date.parse(row.listed_at)) / 86400000) / 365)
      : 1;
    const logTvl = Math.log10(Math.max(1, row.tvl_usd));
    const change = (row.change_7d || 0) / 100;
    const logAge = Math.log10(ageYears);
    const logEstimate = coefficients.intercept + coefficients.log10_tvl * logTvl +
      coefficients.change_7d_fraction * change + coefficients.log10_age_years * logAge;
    const plan = row.farm_plan;
    const live = row.token_status === 'token-recorded';
    const excluded = row.token_status === 'excluded-product';
    const verdict = plan ? plan.verdict : live ? 'LIVE' : 'EXCLUDED';
    const drivers = row.listing_drivers;
    const expectedEquation = live ? (row.value_basis === 'recorded_market_cap'
      ? 'Observed value = recorded market cap ' + money(row.mcap_usd)
      : 'Market cap is absent; use fitted peer value ' + money(row.fitted_launch_value_usd)) :
      excluded ? 'Excluded: no independent launch value assigned.' :
        'Expected = fitted launch value × P(list) × own-token share';
    const farm = plan ? '<div class="detail-section"><h4>FARM PLAN / ' + safe(verdict) + '</h4>' +
      '<div class="farmline"><div><small>DEPOSIT</small><b>' + money(plan.deposit_size_usd) +
      '</b></div><div><small>GAS + FEES</small><b>' + money(plan.gas_fees_usd) +
      '</b></div><div><small>NET / HOUR</small><b>' + money(plan.expected_net_value_per_hour_usd) +
      '</b></div></div><p class="detail-note">Time to farm: about ' + plan.time_to_farm_hours +
      ' active hours. ' + safe(plan.reward_scenario) + '</p><ol class="steps">' +
      plan.steps.map(step => '<li>' + safe(step) + '</li>').join('') + '</ol><p class="detail-note">' +
      safe(plan.threshold_rule) + ' ' + safe(plan.verdict_reason) + ' ' +
      safe(plan.own_token_assumption) + '</p></div>' :
      (live ? '<div class="detail-section"><h4>LIVE TOKEN RECORD</h4><p class="detail-note">A token identifier is present. The board shows recorded market cap when available; listing odds are retained as an input check, not a forecast of a second listing.</p></div>' :
        '<div class="detail-section"><h4>DEPENDENT PRODUCT EXCLUDED</h4><p class="detail-note">No token fields are recorded, but this wrapped, staked, exchange, bridge, or versioned product is not treated as an independent launch candidate.</p></div>');
    el('detail').innerHTML = '<div class="detail-top"><div><span class="detail-label">RANK ' +
      String(row.rank).padStart(3, '0') + ' / ' + safe(verdict) + '</span><h3>' + safe(row.name) +
      '</h3><span class="detail-sub">' + safe(row.category || 'Uncategorized') + ' · ' +
      safe(row.chains.join(', ')) + '</span></div><span class="tag ' + safe(verdict) + '">' +
      safe(verdict) + '</span></div><div class="detail-value">' + money(row.expected_value_usd) +
      '</div><div class="detail-meta">EXPECTED VALUE · P(list) ' + pct(row.p_list) +
      ' · OWN-TOKEN SHARE ' + row.own_token_share.toFixed(2) + '</div>' +
      farm + '<div class="detail-section">' +
      '<h4>FITTED LAUNCH VALUE · RIDGE λ=' + ridge.selected_lambda + '</h4><div class="equation">log10(value) = ' +
      coefficients.intercept.toFixed(4) + ' + ' + coefficients.log10_tvl.toFixed(4) + '·log10(TVL) + ' +
      coefficients.change_7d_fraction.toFixed(4) + '·(Δ7d/100) + ' + coefficients.log10_age_years.toFixed(4) +
      '·log10(age years)<br>10^' + logEstimate.toFixed(3) + ' ≈ ' +
      money(row.fitted_launch_value_usd) + '<br><b>' + safe(expectedEquation) + '</b></div></div>' +
      '<div class="detail-section"><h4>P(LIST) MODEL DRIVERS</h4><div class="driver-grid">' +
      '<span>TVL<b>' + money(drivers.tvl_usd) + '</b></span><span>RECORD AGE<b>' +
      (drivers.age_days === null ? 'not reported' : fmt.format(drivers.age_days) + ' days') +
      '</b></span><span>7D TRAJECTORY<b>' + (drivers.change_7d === null ? 'not reported' : drivers.change_7d.toFixed(2) + '%') +
      '</b></span><span>CATEGORY<b>' + safe(drivers.category || 'Uncategorized') +
      '</b></span><span>30D / AUDIT<b>not in snapshot</b></span><span>OWN SHARE<b>1.00 assumption</b></span></div>' +
      '<p class="detail-note">Logistic model trained on the full snapshot to distinguish token-recorded peers. 20% holdouts are shown above; P(list) is a peer-record proxy, not a time-to-launch forecast.</p></div>' +
      '<div class="detail-section"><h4>VERDICT BASIS</h4><div class="equation">' +
      (plan ? safe(verdict) + ' · ' + money(plan.expected_net_value_per_hour_usd) +
        '/hour · P(list) ' + pct(row.p_list) + '<br>' + safe(plan.verdict_reason) +
        '<br>' + safe(plan.threshold_rule) :
        (live ? 'Existing token metadata; no pre-launch farming verdict.' :
          'Excluded dependent product; no independent launch valuation or farming verdict.')) +
      '</div></div>';
  }
  function update() {
    renderTable();
    const state = stateFromHash();
    document.body.classList.toggle('detail-route', Boolean(state.detail));
    document.body.classList.toggle('filtered-route', Boolean(state.verdict));
    const selected = state.detail ? bySlug.get(state.detail) :
      state.verdict ? filtered()[0] : null;
    detail(selected || null);
  }
  ['filterVerdict', 'filterCategory', 'minValue', 'minOdds'].forEach(id =>
    el(id).addEventListener('input', renderTable));
  document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sortDirection = sortKey === key ? -sortDirection : 1;
    sortKey = key;
    document.querySelectorAll('th[data-sort]').forEach(item => item.classList.toggle('sorted', item === th));
    renderTable();
  }));
  el('reset').addEventListener('click', () => {
    el('filterVerdict').value = ''; el('filterCategory').value = '';
    el('minValue').value = '0'; el('minOdds').value = '0'; location.hash = '';
    renderTable();
  });
  window.addEventListener('hashchange', update);
  if (state.verdict === 'FARM') el('filterVerdict').value = 'FARM';
  update();
})();
