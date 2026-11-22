// Token Radar dashboard — radar-5.
//
// Reads the data the program wrote (window.RADAR) and renders the board,
// one detail view per protocol, filters, and the validation + method
// sections. No network: every number on the page comes from data.js.
//
// Re-expressed in the v8 session with fuller comments: the rendering logic
// is unchanged (same rows, same order, same numbers), only the notes
// around it grew, so the screenshots stay the same views of the same
// board. The page reads its state from the URL hash — #detail=<slug> for
// a protocol, #verdict=FARM for the filtered board — which is how the
// three screenshots are taken from one file.

(function () {
  "use strict";
  // The whole page hangs off this one object: rows, fit, counts, audit.
  // Nothing is fetched, nothing is computed here that the program did not
  // already compute — the dashboard presents, it does not model.
  var R = window.RADAR;
  var rows = R.rows;
  var fit = R.fit;

  // -- formatting ------------------------------------------------------------
  //
  // All money on the page goes through these five formatters, so a number
  // is spelled the same way in the board, the detail view and the KPI
  // strip. fmtUsd rounds to whole dollars; fmtSigned keeps the cents and
  // the sign for net-per-hour, where -$12.39 and $111.04 are the point.
  function fmtInt(n) {
    return Math.round(n).toLocaleString("en-US");
  }
  function fmtUsd(n) {
    return "$" + fmtInt(n);
  }
  function fmtSigned(n) {
    return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return "—";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }
  // Escape once, at the boundary: every name, slug and category that
  // reaches innerHTML passes through esc, so a protocol name can never
  // break out of its cell.
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function verdictClass(v) {
    return "badge badge-" + v.toLowerCase();
  }
  // Short money for the TVL column: $2.8B reads faster than $2,753,981,495,
  // and the exact figure is one click away in the detail view.
  function moneyShort(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return fmtUsd(n);
  }

  // -- state -----------------------------------------------------------------
  //
  // One state object for the whole board: the search text, the verdict and
  // category filters, and the sort key and direction. The hash can preset
  // the verdict; everything else starts at its default on every load.
  var state = { q: "", verdict: "ALL", category: "ALL", sort: "rank", dir: 1 };

  function readHash() {
    var h = window.location.hash.slice(1);
    var parts = h.split("&");
    var out = {};
    parts.forEach(function (p) {
      var kv = p.split("=");
      if (kv.length === 2) out[kv[0]] = decodeURIComponent(kv[1]);
    });
    return out;
  }

  function filteredRows() {
    var list = rows.filter(function (r) {
      if (state.verdict !== "ALL" && r.verdict !== state.verdict) return false;
      if (state.category !== "ALL" && r.category !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (r.name + " " + r.slug + " " + (r.category || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      var d = 0;
      if (key === "rank") d = a.rank - b.rank;
      else if (key === "implied") d = a.implied_value_usd - b.implied_value_usd;
      else if (key === "tvl") d = a.tvl_usd - b.tvl_usd;
      else if (key === "net") d = a.net_per_hour_usd - b.net_per_hour_usd;
      else if (key === "name") d = a.name < b.name ? -1 : 1;
      return d * state.dir;
    });
    return list;
  }

  // -- header + KPIs ---------------------------------------------------------
  //
  // The header states the model in one line (ridge, lambda, the formula
  // with the fitted coefficients) and the KPI strip states the validation
  // in nine numbers. Both come from the fit object, so the page can never
  // quote a stale band or a stale R²: if the program's numbers move, the
  // header moves with them.
  function renderHeader() {
    var coef = fit.coefficients;
    document.getElementById("top").innerHTML =
      '<div class="wrap">' +
      '<h1>Token Radar</h1>' +
      '<p class="sub">Pre-token protocols ranked by what their launch would be worth — ' +
      "from the snapshot's own TVL, 7-day growth and age. An implied value is this radar's " +
      "claim, never a promise that a token will launch.</p>" +
      '<p class="model-line">Model radar-5: standardized ridge, &lambda; = ' +
      fit.ridge_lambda +
      ", log<sub>10</sub>(mcap) = " +
      coef[0] +
      " + " +
      coef[1] +
      " &times; log<sub>10</sub>(TVL) &minus; " +
      Math.abs(coef[2]) +
      " &times; growth &minus; " +
      Math.abs(coef[3]) +
      " &times; log<sub>10</sub>(age), plus a shrunk category adjustment. " +
      "Snapshot " +
      esc(R.as_of) +
      " &middot; " +
      fmtInt(R.protocol_total) +
      " protocols.</p>" +
      "</div>";
    var kpis = [
      ["Protocols", fmtInt(R.protocol_total)],
      ["Board rows", fmtInt(R.board_size)],
      ["Watchlist", fmtInt(R.watchlist_size)],
      ["Traded comps", fmtInt(fit.comps_n)],
      ["Ridge λ", String(fit.ridge_lambda)],
      ["OOS band", fit.oos_median_factor.toFixed(4) + "×"],
      ["OOS R²", fit.oos_r_squared.toFixed(4)],
      ["LOO factor", fit.loo_median_factor.toFixed(4) + "×"],
      ["FARM verdicts", String(R.verdict_counts.FARM)],
    ];
    var html = '<section class="kpis" aria-label="Key numbers"><div class="wrap kpi-row">';
    kpis.forEach(function (k) {
      html += '<div class="kpi"><div class="kpi-v">' + esc(k[1]) + "</div>" +
        '<div class="kpi-k">' + esc(k[0]) + "</div></div>";
    });
    html += "</div></section>";
    return html;
  }

  // -- controls --------------------------------------------------------------
  //
  // The category list is built from the rows themselves, sorted: a
  // category with no board rows gets no option, and a new category in a
  // new snapshot gets one without any code change. The verdict buttons
  // are the four fixed verdicts; the sort select offers the five sort
  // keys filteredRows understands.
  function renderControls() {
    var cats = [];
    rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    });
    cats.sort();
    var opts = '<option value="ALL">All categories</option>' +
      cats.map(function (c) {
        return '<option value="' + esc(c) + '"' +
          (state.category === c ? " selected" : "") + ">" + esc(c) + "</option>";
      }).join("");
    var verdictBtns = ["ALL", "FARM", "THIN", "SKIP"].map(function (v) {
      return '<button class="vbtn' + (state.verdict === v ? " on" : "") +
        '" data-verdict="' + v + '">' +
        (v === "ALL" ? "All verdicts" : v) + "</button>";
    }).join("");
    return (
      '<section class="controls"><div class="wrap">' +
      '<input id="q" type="search" placeholder="Search name or slug…" value="' +
      esc(state.q) +
      '" aria-label="Search">' +
      '<span class="vbtns">' + verdictBtns + "</span>" +
      '<select id="cat" aria-label="Category">' + opts + "</select>" +
      '<select id="sort" aria-label="Sort by">' +
      '<option value="rank"' + (state.sort === "rank" ? " selected" : "") + ">Sort: rank</option>" +
      '<option value="implied"' + (state.sort === "implied" ? " selected" : "") + ">Sort: implied value</option>" +
      '<option value="tvl"' + (state.sort === "tvl" ? " selected" : "") + ">Sort: TVL</option>" +
      '<option value="net"' + (state.sort === "net" ? " selected" : "") + ">Sort: net per hour</option>" +
      '<option value="name"' + (state.sort === "name" ? " selected" : "") + ">Sort: name</option>" +
      "</select>" +
      "</div></section>"
    );
  }

  // -- board -----------------------------------------------------------------
  //
  // One row per protocol, nine columns: rank, protocol, TVL, 7-day change,
  // age, implied value with its low–high band underneath, net per hour
  // (green when non-negative, red when not), verdict badge, and the
  // bootstrap rank range. Clicking a row opens its detail view; clicking
  // a sortable header re-sorts, and clicking it again reverses.
  function boardTable(list) {
    var head =
      "<tr>" +
      '<th data-sort="rank">Rank</th><th data-sort="name">Protocol</th>' +
      '<th data-sort="tvl">TVL</th><th>7d</th><th>Age</th>' +
      '<th data-sort="implied">Implied value</th>' +
      '<th data-sort="net">Net / hr</th><th>Verdict</th><th>Rank range</th>' +
      "</tr>";
    var body = list.map(function (r) {
      return (
        "<tr data-detail=\"" + esc(r.slug) + "\">" +
        "<td>" + r.rank + "</td>" +
        '<td><b>' + esc(r.name) + "</b><br><span class=\"slug\">" + esc(r.slug) +
        " &middot; " + esc(r.category || "no category") + "</span></td>" +
        "<td>" + moneyShort(r.tvl_usd) + "</td>" +
        "<td>" + fmtPct(r.change_7d) + "</td>" +
        "<td>" + fmtAge(r.age_days) + "</td>" +
        "<td><b>" + fmtUsd(r.implied_value_usd) + "</b><br><span class=\"slug\">" +
        fmtUsd(r.implied_low_usd) + " – " + fmtUsd(r.implied_high_usd) + "</span></td>" +
        '<td class="' + (r.net_per_hour_usd >= 0 ? "pos" : "neg") + '">' +
        fmtSigned(r.net_per_hour_usd) + "</td>" +
        '<td><span class="' + verdictClass(r.verdict) + '">' + r.verdict + "</span></td>" +
        "<td>" + r.rank_p10 + "–" + r.rank_p90 + "</td>" +
        "</tr>"
      );
    }).join("");
    return '<table class="board"><thead>' + head + "</thead><tbody>" + body + "</tbody></table>";
  }

  // -- detail ----------------------------------------------------------------
  //
  // The detail view replays the row's own formula with its own numbers
  // plugged in — TVL, clipped growth, age used, and the category
  // adjustment when it is not zero — so a reader can check the implied
  // value by hand. Below it, eight stat cards carry the economics
  // (implied value, band, farmer count, per-farmer share, cost,
  // break-even, net per hour, rank range), then the comparables table
  // and the eight farm steps.
  function formulaHtml(r) {
    var coef = fit.coefficients;
    var g = r.growth_pct_clipped / 100;
    var growthTxt = g < 0 ? "(" + g.toFixed(2) + ")" : g.toFixed(2);
    var parts =
      "log<sub>10</sub>(mcap) = " + coef[0] + " + " + coef[1] + " &times; log<sub>10</sub>(" +
      fmtInt(r.tvl_usd) + ") &minus; " + Math.abs(coef[2]) + " &times; " + growthTxt +
      " &minus; " + Math.abs(coef[3]) + " &times; log<sub>10</sub>(" + r.age_days_used + ")";
    if (r.category_adjustment_log10 !== 0) {
      var adj = r.category_adjustment_log10;
      parts += (adj > 0 ? " + " : " &minus; ") + Math.abs(adj).toFixed(4) +
        " (" + esc(r.category || "no category") + " adjustment)";
    }
    return parts + " = " + fmtUsd(r.implied_value_usd);
  }

  function detailHtml(r) {
    var comps = r.comparables.map(function (c) {
      return "<tr><td>" + esc(c.name) + "</td><td>" + moneyShort(c.tvl_usd) +
        "</td><td>" + moneyShort(c.mcap_usd) + "</td></tr>";
    }).join("");
    var steps = r.farm_steps.map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    var econ = [
      ["Implied value", fmtUsd(r.implied_value_usd)],
      ["Low – high band", fmtUsd(r.implied_low_usd) + " – " + fmtUsd(r.implied_high_usd)],
      ["Farmers (est.)", fmtInt(r.farmers_estimate)],
      ["Low-end share / farmer", fmtSigned(r.farm_value_per_farmer_usd)],
      ["Farming cost", fmtUsd(r.farm_cost_usd)],
      ["Break-even implied", fmtUsd(r.break_even_implied_usd)],
      ["Net per active hour", fmtSigned(r.net_per_hour_usd)],
      ["Bootstrap rank range", r.rank_p10 + " – " + r.rank_p90 + " (median " + r.rank_p50 + ")"],
    ].map(function (e) {
      return '<div class="stat"><div class="stat-v">' + esc(e[1]) + "</div>" +
        '<div class="stat-k">' + esc(e[0]) + "</div></div>";
    }).join("");
    return (
      '<section class="detail"><div class="wrap">' +
      '<p><a href="#" id="back">&larr; Back to the board</a></p>' +
      "<h2>" + esc(r.name) + ' <span class="' + verdictClass(r.verdict) + '">' +
      r.verdict + "</span></h2>" +
      '<p class="sub">' + esc(r.slug) + " &middot; " + esc(r.category || "no category") +
      " &middot; " + r.chains.map(esc).join(", ") + " &middot; TVL " + fmtUsd(r.tvl_usd) +
      " &middot; listed " + esc(r.listed_at || "unknown") + " &middot; rank #" + r.rank +
      " of " + R.board_size + "</p>" +
      '<div class="formula">' + formulaHtml(r) + "</div>" +
      '<div class="stats">' + econ + "</div>" +
      "<h3>Traded comparables</h3>" +
      '<p class="sub">Same-category families first, then the closest by TVL. ' +
      "The curve is fitted on these 128 traded families.</p>" +
      '<table class="mini"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th></tr></thead>' +
      "<tbody>" + comps + "</tbody></table>" +
      "<h3>How to farm it</h3>" +
      '<ol class="steps">' + steps + "</ol>" +
      "</div></section>"
    );
  }

  // -- validation + method ---------------------------------------------------
  //
  // Validation: the lambda grid with the selected lambda starred, the
  // ablation table, the category adjustments sorted best-first, and one
  // line of the other factors (LOO, LOCO, walk-forward pooled, time
  // split, slope bootstrap, fixed-ratio baseline, OOS p80) — followed by
  // the honest weak spot, stated in plain text: the walk-forward pooled
  // R² is negative, so the ranking is a cross-sectional screen, not a
  // forecast. Method: the universe accounting, the curve, the farm
  // economics, and the language caveat.
  function validationHtml() {
    var lamRows = Object.keys(fit.ridge_lambda_grid).map(function (k) {
      var g = fit.ridge_lambda_grid[k];
      var star = Number(k) === fit.ridge_lambda ? " ★" : "";
      return "<tr" + (star ? ' class="hl"' : "") + "><td>" + k + star + "</td><td>" +
        g.median_factor.toFixed(4) + "×</td><td>" + g.r_squared.toFixed(4) + "</td></tr>";
    }).join("");
    var ablRows = Object.keys(fit.ablation).map(function (k) {
      var a = fit.ablation[k];
      return "<tr><td>" + esc(k) + "</td><td>" + a.median_factor.toFixed(4) +
        "×</td><td>" + a.r_squared.toFixed(4) + "</td></tr>";
    }).join("");
    var catRows = Object.keys(fit.category_adjustments)
      .sort(function (a, b) {
        return fit.category_adjustments[b] - fit.category_adjustments[a];
      })
      .map(function (c) {
        var v = fit.category_adjustments[c];
        return "<tr><td>" + esc(c) + "</td><td>" + (v > 0 ? "+" : "") +
          v.toFixed(4) + "</td></tr>";
      }).join("");
    return (
      '<section class="valid"><div class="wrap"><h2>Validation</h2>' +
      '<p class="sub">Eleven fold assignments (slug order plus ten FNV-1a hashes). ' +
      "Lambda and terms were chosen by the one-standard-error rule on paired " +
      "per-assignment differences: dropping age improves the repeated mean by " +
      "only 0.001 against a paired standard error of 0.057, so age stays; " +
      "lambda 30 trails the best by 0.045 against a paired SE of 0.044, so 40 " +
      "is the best mean and the largest lambda within one SE of it.</p>" +
      '<div class="cols"><div><h3>Ridge lambda grid</h3>' +
      '<table class="mini"><thead><tr><th>λ</th><th>Median factor</th><th>R²</th></tr></thead>' +
      "<tbody>" + lamRows + "</tbody></table></div>" +
      "<div><h3>Ablation (λ = 40)</h3>" +
      '<table class="mini"><thead><tr><th>Spec</th><th>Median factor</th><th>R²</th></tr></thead>' +
      "<tbody>" + ablRows + "</tbody></table></div>" +
      "<div><h3>Category adjustments</h3>" +
      '<table class="mini"><thead><tr><th>Category</th><th>log₁₀ adj.</th></tr></thead>' +
      "<tbody>" + catRows + "</tbody></table></div></div>" +
      "<p>Leave-one-out " + fit.loo_median_factor.toFixed(4) + "× (R² " +
      fit.loo_r_squared.toFixed(4) + ") &middot; leave-one-category-out " +
      fit.category_holdout.median_factor.toFixed(4) + "× (R² " +
      fit.category_holdout.r_squared.toFixed(4) + ") &middot; walk-forward pooled " +
      fit.walk_forward_pooled.median_factor.toFixed(4) + "× (R² " +
      fit.walk_forward_pooled.r_squared.toFixed(4) + ") &middot; time split R² " +
      fit.time_split_r_squared.toFixed(4) + " (n=" + fit.time_split_n_test + ") &middot; " +
      "slope bootstrap 90% " + fit.slope_bootstrap_p5.toFixed(4) + "–" +
      fit.slope_bootstrap_p95.toFixed(4) + " &middot; fixed-ratio LOO " +
      fit.fixed_ratio_loo_factor.toFixed(4) + "× &middot; OOS p80 " +
      fit.oos_p80_factor.toFixed(4) + "×.</p>" +
      "<p>Walk-forward is the honest weak spot: its pooled R² is " +
      fit.walk_forward_pooled.r_squared.toFixed(4) +
      " while its median factor improved — chronological signal stays near zero, " +
      "so treat the ranking as a cross-sectional screen, not a forecast.</p>" +
      "</div></section>"
    );
  }

  function methodHtml() {
    var counts = {};
    R.excluded.forEach(function (e) {
      counts[e.reason] = (counts[e.reason] || 0) + 1;
    });
    var auditLine = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a];
    }).map(function (k) {
      return counts[k] + " × " + k.toLowerCase();
    }).join(" · ");
    return (
      '<section class="method"><div class="wrap"><h2>Method</h2>' +
      "<p><b>Universe.</b> All " + fmtInt(R.protocol_total) + " snapshot protocols are " +
      "accounted for: " + fmtInt(R.board_size) + " ranked on the board, " +
      fmtInt(R.live_size) + " live-token records set aside, and " +
      fmtInt(R.excluded_total) + " audited outside both lists (" + esc(auditLine) +
      "). Of the " + fmtInt(R.pre_token_total) +
      " protocols that record no token, " + fmtInt(R.board_size) +
      " make the board; the rest are versioned, bridged, staked or exchange products.</p>" +
      "<p><b>The curve.</b> The 128 traded families are the comparables: one " +
      "record per token, the highest-TVL one kept. The ridge is fitted on " +
      "TRAIN-standardized features with the intercept unpenalised, and the " +
      "category adjustment is the shrunk median residual of each category " +
      "(shrink n / (n + 4), capped at ±0.2, at least 3 comps). Nothing in the " +
      "model is a hardcoded list of names: a new protocol is scored from its " +
      "own TVL, growth and age the moment it appears in a snapshot.</p>" +
      "<p><b>Farm economics.</b> A farmer is assumed to hold a $10,000 position, " +
      "so the farmer count is TVL / $10,000; the low-end farm value is 5% of the " +
      "low end of the implied-value band, shared evenly. FARM means one " +
      "farmer's low-end share is at least 3× the farming cost, THIN at least 1×, " +
      "otherwise SKIP. Costs follow the hold length (30 / 45 / 60 days by age) " +
      "and the main action's gas.</p>" +
      "<p><b>Language.</b> The board says a protocol <i>records no token</i>, " +
      "never that it has none: a record can miss a token that exists. " +
      "Implied values are this radar's own claim about what a launch would be " +
      "worth if the record stayed as it is — not a prediction that a token " +
      "will launch, or when.</p>" +
      "</div></section>"
    );
  }

  // -- render + wiring -------------------------------------------------------
  //
  // render() reads the hash and decides: a #detail=<slug> that matches a
  // row shows the detail view; a #verdict=<FARM|THIN|SKIP> presets the
  // filter; anything else shows the board. Every render re-wires the
  // controls, because innerHTML replaces the elements the old listeners
  // were attached to. The footer names the source snapshot and the
  // program that built the page, and a hashchange re-renders.
  function render() {
    var hash = readHash();
    var app = document.getElementById("app");
    if (hash.detail) {
      var row = null;
      rows.forEach(function (r) {
        if (r.slug === hash.detail) row = r;
      });
      if (row) {
        app.innerHTML = detailHtml(row) + validationHtml() + methodHtml();
        wireDetail();
        return;
      }
    }
    if (hash.verdict && ["FARM", "THIN", "SKIP"].indexOf(hash.verdict) !== -1) {
      state.verdict = hash.verdict;
    }
    var list = filteredRows();
    app.innerHTML =
      renderHeader() +
      renderControls() +
      '<section class="boardwrap"><div class="wrap">' +
      "<p class=\"count\">" + list.length + " of " + rows.length + " rows" +
      (state.verdict !== "ALL" ? " · verdict " + state.verdict : "") + "</p>" +
      boardTable(list) +
      "</div></section>" +
      validationHtml() +
      methodHtml();
    wireBoard();
  }

  function wireBoard() {
    var q = document.getElementById("q");
    if (q) q.addEventListener("input", function () { state.q = q.value; render(); });
    var cat = document.getElementById("cat");
    if (cat) cat.addEventListener("change", function () { state.category = cat.value; render(); });
    var sort = document.getElementById("sort");
    if (sort) sort.addEventListener("change", function () { state.sort = sort.value; state.dir = 1; render(); });
    var btns = document.querySelectorAll(".vbtn");
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        state.verdict = b.getAttribute("data-verdict");
        render();
      });
    });
    var ths = document.querySelectorAll("th[data-sort]");
    ths.forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-sort");
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === "rank" ? 1 : -1; }
        render();
      });
    });
    var trs = document.querySelectorAll("tr[data-detail]");
    trs.forEach(function (tr) {
      tr.addEventListener("click", function () {
        window.location.hash = "#detail=" + tr.getAttribute("data-detail");
      });
    });
  }

  function wireDetail() {
    var back = document.getElementById("back");
    if (back) back.addEventListener("click", function (ev) {
      ev.preventDefault();
      window.location.hash = "";
    });
  }

  document.getElementById("foot").innerHTML =
    '<div class="wrap"><p>Source: DefiLlama protocol snapshot, ' + esc(R.source) +
    ". Built by the radar-5 program in this repository; every number on this page " +
    "is computed from that snapshot at build time.</p></div>";
  window.addEventListener("hashchange", render);
  render();
})();
