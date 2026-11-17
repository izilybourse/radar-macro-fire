/* ============================================================================
   ONGLET 5 : BACKTEST (Canvas, bandes de régime, métriques, alpha par régime)
   ========================================================================== */
function metricRows(m) {
  const k = [['total_return', 'pc'], ['cagr', 'pc'], ['vol', 'pc'], ['sharpe', 'n'], ['max_drawdown', 'pc'], ['win_rate_monthly', 'pc']];
  return k.map(function (x) {
    const f = function (o) { return o ? (x[1] === 'pc' ? pc(o[x[0]], 1) : nf(o[x[0]], 2)) : t('nd'); };
    return ['<b>' + esc(t('m.' + x[0])) + '</b>', f(m.portfolio), f(m.portfolio_net), f(m.vt), f(m.spy)];
  });
}
function metricTable(m) { return rtable([{ h: t('m.metric') }, { h: t('bt.radar'), n: 1 }, { h: t('bt.radar.net'), n: 1 }, { h: 'VT', n: 1 }, { h: 'S&P 500', n: 1 }], metricRows(m)); }
function btData() {
  const b = S.data.backtest, c = b.curves; let i0 = 0;
  if (S.bt.win === 'ucits' && b.metrics_ucits_window) { const st = b.metrics_ucits_window.window.start; i0 = Math.max(0, c.dates.findIndex(function (d) { return d >= st; })); }
  const sl = function (a) { const base = a[i0]; return a.slice(i0).map(function (v) { return v == null ? null : v / base * 100; }); };
  return { dates: c.dates.slice(i0), p: sl(c.portfolio), n: sl(c.portfolio_net), vt: sl(c.vt), spy: sl(c.spy) };
}
function drawBt() {
  const b = S.data.backtest; const cv = $('#bt-cv'); if (!b || !cv) return;
  const d = btData(), cfg = { x: d.dates, height: 320, series: [], bands: [], yFmt: function (v) { return nf(v, 0); }, xFmt: function (v) { return v.slice(0, 4); } };
  cfg.series.push({ color: cssv('--or'), data: d.p, w: 2.4 });
  if (S.bt.net) cfg.series.push({ color: '#ffb27a', data: d.n, dash: [5, 3], w: 1.6 });
  if (S.bt.vt) cfg.series.push({ color: '#60a5fa', data: d.vt, w: 1.6 });
  if (S.bt.spy) cfg.series.push({ color: cssv('--tx2'), data: d.spy, w: 1.4 });
  if (S.bt.bands) b.regime_bands.forEach(function (bd) {
    const i0 = d.dates.findIndex(function (x) { return x >= bd.start; }); let i1 = d.dates.findIndex(function (x) { return x >= bd.end; }); if (i1 < 0) i1 = d.dates.length - 1;
    if (i0 >= 0 && i1 > i0) cfg.bands.push({ i0: i0, i1: i1, color: RC[bd.regime] + '24' });
  });
  const geo = drawChart(cv, cfg); if (!geo) return;
  attachTip(cv, $('#bt-tip'), geo, cfg, function (i) {
    const dt = d.dates[i], bd = b.regime_bands.filter(function (x) { return x.start <= dt && dt <= x.end; })[0];
    return '<b>' + esc(dfmt(dt)) + '</b>' + (bd ? '<br>' + regBadge(bd.regime) : '') + '<br>' + esc(t('bt.radar')) + ' ' + nf(d.p[i], 0) + (S.bt.net ? '<br>' + esc(t('bt.radar.net')) + ' ' + nf(d.n[i], 0) : '') + (S.bt.vt ? '<br>VT ' + nf(d.vt[i], 0) : '') + (S.bt.spy ? '<br>S&P 500 ' + nf(d.spy[i], 0) : '');
  });
}
RENDER.backtest = function () {
  const b = S.data.backtest; if (!b) return missing('backtest');
  const ch = function (k) { return '<button type="button" class="chip' + (S.bt[k] ? ' on' : '') + '" data-act="bt-t" data-k="' + k + '">' + esc(t('bt.t.' + k)) + '</button>'; };
  let h = '<div class="card"><h2>' + esc(t('bt.title')) + '</h2><p class="mut">' + esc(t('bt.d')) + '</p><div class="note warn">' + esc(t('bt.honest')) + '</div>' +
    '<div class="chips">' + ch('net') + ch('vt') + ch('spy') + ch('bands') + '</div>' +
    (b.metrics_ucits_window ? '<label class="fld" style="max-width:360px;margin-bottom:8px">' + esc(t('bt.win')) + '<select data-ch="bt-w"><option value="full"' + (S.bt.win === 'full' ? ' selected' : '') + '>' + esc(t('bt.win.full', { a: b.period.start.slice(0, 4) })) + '</option><option value="ucits"' + (S.bt.win === 'ucits' ? ' selected' : '') + '>' + esc(t('bt.win.ucits', { a: b.metrics_ucits_window.window.start.slice(0, 4) })) + '</option></select></label>' : '') +
    '<div class="cvw"><canvas id="bt-cv" class="cv"></canvas><div class="tip" id="bt-tip"></div></div>' +
    '<div class="leg">' + Object.keys(RC).map(function (k) { return '<span><b style="background:' + RC[k] + '"></b>' + esc(regName(k)) + '</span>'; }).join('') + '</div><p class="mut">' + esc(dfmt(b.period.start)) + ' → ' + esc(dfmt(b.period.end)) + ' · ' + esc(t('updated')) + ' ' + esc(dfmt(b.generated_at)) + '</p></div>';
  h += '<div class="card"><h2>' + esc(t('bt.metrics')) + ' <span class="mut" style="font-size:13px">' + esc(dfmt(b.period.start)) + ' → ' + esc(dfmt(b.period.end)) + '</span></h2>' + metricTable(b.metrics) + '</div>';
  if (b.metrics_ucits_window) h += '<div class="card"><h2>' + esc(t('bt.metrics.u')) + ' <span class="mut" style="font-size:13px">' + esc(dfmt(b.metrics_ucits_window.window.start)) + ' → ' + esc(dfmt(b.metrics_ucits_window.window.end)) + '</span></h2><p class="mut">' + esc(t('bt.metrics.u.d')) + '</p>' + metricTable(b.metrics_ucits_window) + '</div>';
  const al = b.alpha_by_regime || {};
  h += '<div class="grid"><div class="card"><h2>' + esc(t('bt.alpha')) + '</h2>' + rtable([{ h: t('col.regime') }, { h: t('bt.share'), n: 1 }, { h: t('bt.radar'), n: 1 }, { h: 'VT', n: 1 }, { h: 'Alpha', n: 1 }],
    Object.keys(al).map(function (k) { const a = al[k]; return [regBadge(k), pc(a.share_pct, 0), pc(a.portfolio_ann, 1, true), pc(a.vt_ann, 1, true), '<b style="color:' + (a.alpha_ann >= 0 ? 'var(--ok)' : 'var(--ko)') + '">' + pc(a.alpha_ann, 1, true) + '</b>']; })) + '<p class="mut">' + esc(t('bt.alpha.d')) + '</p></div>' +
    '<div class="card"><h2>' + esc(t('bt.turn')) + '</h2><div class="grid s"><div class="kpi"><b>' + pc(b.turnover.annual_one_way_pct, 0) + '</b><span>' + esc(t('bt.turn.a')) + '</span></div><div class="kpi"><b>' + b.turnover.regime_changes + '</b><span>' + esc(t('bt.turn.c')) + '</span></div></div><p class="mut">' + esc(t('bt.turn.d')) + '</p></div></div>';
  h += '<div class="card"><h2>' + esc(t('bt.universe')) + '</h2><p class="mut">' + esc(t('bt.universe.d')) + '</p>' + rtable([{ h: t('col.sector') }, { h: 'ISIN' }, { h: t('bt.ucits.start') }, { h: t('bt.proxy') }], b.universe.map(function (u) { return [esc(t('sec.' + u.key)), esc(u.ucits_isin), u.ucits_start ? esc(dfmt(u.ucits_start)) : '<span class="badge y">' + esc(t('bt.noucits')) + '</span>', esc(u.us_proxy)]; })) + '</div>';
  h += '<div class="card"><h2>' + esc(t('bt.limits')) + '</h2>' + (b.method ? '<p class="mut">' + esc(b.method) + '</p>' : '') + '<ul>' + (b.limits || []).map(function (x) { return '<li class="mut">' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  return h;
};
RENDER.backtest_after = function () { drawBt(); };
RENDER.backtest_resize = function () { drawBt(); };
ACT['bt-t'] = function (a) { S.bt[a.dataset.k] = !S.bt[a.dataset.k]; renderTab('backtest'); };
ACT['bt-w'] = function (a) { S.bt.win = a.value; renderTab('backtest'); };

/* ============================================================================
   ONGLET 6 : HISTORIQUE DES RÉGIMES ET PROBABILITÉS DE TRANSITION
   ========================================================================== */
function matMul(A, B, regs) { const o = {}; regs.forEach(function (a) { o[a] = {}; regs.forEach(function (c) { o[a][c] = regs.reduce(function (s, b) { return s + (A[a][b] || 0) * (B[b][c] || 0); }, 0); }); }); return o; }
RENDER.history = function () {
  const s = sn(), tr = S.data.transitions, hs = S.data.history, sp = spec(), regs = sp.regimes; let h = '';
  const cur = s ? s.inertia.current : null;
  let m3 = tr && tr.matrix_3m, src = 'emp';
  if (!m3 || (cur && (!m3[cur] || m3[cur][regs[0]] == null))) { const f = sp.transition_fallback_1m; m3 = matMul(matMul(f, f, regs), f, regs); src = 'fb'; }
  h += '<div class="card"><h2>' + esc(t('hist.prob')) + '</h2>';
  if (src === 'fb') h += '<div class="note warn">' + esc(t('hist.fallback')) + '</div>';
  if (cur) {
    h += '<p class="mut">' + esc(t('hist.prob.d', { r: regName(cur) })) + '</p>' + regs.map(function (rg) { const p = m3[cur][rg] || 0; return '<div style="margin:8px 0"><div class="row" style="border:0;padding:0"><span>' + regBadge(rg) + (rg === cur ? ' <span class="mut">' + esc(t('hist.stay')) + '</span>' : '') + '</span><b>' + pc(p * 100, 0) + '</b></div><div class="meter"><i style="width:' + p * 100 + '%;background:' + RC[rg] + '"></i></div></div>'; }).join('');
    const d = s.regime.distance_to_switch;
    h += '<div class="note" style="margin-top:12px"><b>' + esc(t('hist.dist')) + ' :</b> ' + esc(t('hist.dist.d', { p: nf(d.points, 0), ax: d.axis === 'G' ? t('axis.g') : t('axis.i'), G: nf(s.regime.G, 0, true), I: nf(s.regime.I, 0, true) })) + '</div><div class="meter"><i style="width:' + Math.min(100, d.points) + '%"></i></div>';
  } else h += missing('snapshot');
  if (tr) {
    h += '<h3 style="margin-top:14px">' + esc(t('hist.matrix')) + '</h3>' + rtable([{ h: t('hist.from') }].concat(regs.map(function (r) { return { h: regName(r), n: 1 }; })), regs.map(function (a) { return [regBadge(a)].concat(regs.map(function (b) { const p = tr.matrix_3m[a] && tr.matrix_3m[a][b]; return p == null ? t('nd') : '<span class="hm" style="background:rgba(255,85,0,' + (p * .7).toFixed(2) + ')">' + pc(p * 100, 0) + '</span>'; })); })) +
      '<p class="mut">' + esc(t('hist.dur')) + ' : ' + regs.map(function (r) { return esc(regName(r)) + ' ' + nf(tr.avg_duration_days && tr.avg_duration_days[r], 0) + ' ' + esc(t('days')); }).join(' · ') + '</p><p class="mut">' + esc(tr.note || '') + '</p>';
  } else h += missing('transitions');
  h += '</div><div class="card"><h2>' + esc(t('hist.list')) + '</h2>';
  if (!hs || !hs.entries) return h + missing('history') + '</div>';
  const perf = {}; if (s) (s.history_perf || []).forEach(function (p) { perf[p.date] = p; });
  const E = hs.entries.slice().reverse();
  h += '<p class="mut">' + esc(t('hist.list.d')) + '</p>' + rtable([{ h: t('col.date') }, { h: t('hist.change') }, { h: t('hist.elapsed'), n: 1 }, { h: t('hist.spy'), n: 1 }, { h: t('hist.port'), n: 1 }],
    E.slice(0, 60).map(function (e, i) {
      const end = i === 0 ? Date.now() : Date.parse(E[i - 1].date + 'T12:00:00Z'), days = Math.round((end - Date.parse(e.date + 'T12:00:00Z')) / 864e5), p = perf[e.date];
      return [esc(dfmt(e.date)) + (e.bootstrap ? ' <span class="badge">' + esc(t('hist.boot')) + '</span>' : ''), regBadge(e.from) + ' → ' + regBadge(e.to), days + ' ' + esc(t('days')), p ? heatCell(p.spy, 10) : t('nd'), p ? heatCell(p.portfolio, 10) : t('nd')];
    })) + '<p class="mut">' + esc(t('hist.perf.d')) + '</p></div>';
  return h;
};

/* ============================================================================
   ONGLET 7 : PATRIMOINE (Google Sheets gviz JSONP ou saisie manuelle) vs cible du régime
   ========================================================================== */
const ENVS = ['PEA', 'CTO', 'AV', 'PER', 'SCPI'], CLS = ['actions', 'obligations', 'or_matieres', 'immobilier', 'cash'];
function emptyMat() { const m = {}; ENVS.forEach(function (e) { m[e] = {}; CLS.forEach(function (c) { m[e][c] = 0; }); }); return m; }
function patri() { if (!S.patri) { S.patri = store.get('patri', null) || { mat: emptyMat(), src: 'manual', ts: null }; } return S.patri; }
function normEnv(s) {
  s = String(s || '').toLowerCase();
  if (/scpi|pierre/.test(s)) return 'SCPI'; if (/\bper\b|retraite|perp|madelin|perco/.test(s)) return 'PER'; if (/assurance|\bav\b|vie|luxemb/.test(s)) return 'AV';
  if (/pea/.test(s)) return 'PEA'; if (/\bcto\b|compte.?titre|courtier|bourse/.test(s)) return 'CTO'; return null;
}
function normCls(s) {
  s = String(s || '').toLowerCase();
  if (/oblig|bond|fonds euro|taux/.test(s)) return 'obligations'; if (/\bor\b|m[eé]tal|mati[eè]re|commodit|gold/.test(s)) return 'or_matieres';
  if (/scpi|immo|pierre|reit/.test(s)) return 'immobilier'; if (/cash|liquid|livret|[eé]pargne|mon[eé]taire|fonds euro/.test(s)) return 'cash'; if (/action|etf|equity|bourse|actions/.test(s)) return 'actions'; return null;
}
function gvizLoad(id, sheet) {
  return new Promise(function (res, rej) {
    const cb = '__rmf_gv' + Date.now(); let done = false, to;
    const s = document.createElement('script');
    const cleanup = function () { clearTimeout(to); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); };
    window[cb] = function (r) { done = true; cleanup(); res(r); };
    s.onerror = function () { cleanup(); rej(new Error('network')); };
    to = setTimeout(function () { if (!done) { cleanup(); rej(new Error('timeout')); } }, 12000);
    s.src = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?tqx=out:json;responseHandler:' + cb + '&headers=1' + (sheet ? '&sheet=' + encodeURIComponent(sheet) : '');
    document.head.appendChild(s);
  });
}
function parseGviz(r) {
  if (!r || r.status === 'error' || !r.table) throw new Error((r && r.errors && r.errors[0] && r.errors[0].detailed_message) || 'gviz');
  let cols = r.table.cols.map(function (c) { return c.label || ''; }), rows = r.table.rows.map(function (x) { return (x.c || []).map(function (c) { return c ? (c.v != null ? c.v : c.f) : null; }); });
  if (cols.every(function (c) { return !c; }) && rows.length) { cols = rows[0].map(function (v) { return v == null ? '' : String(v); }); rows = rows.slice(1); }
  return { cols: cols, rows: rows };
}
function guessMap(cols) {
  const f = function (re) { const i = cols.findIndex(function (c) { return re.test(c.toLowerCase()); }); return i; };
  return { env: f(/enveloppe|compte|support|contrat|type de compte|placement/), cls: f(/classe|cat[eé]gorie|type d.actif|actif/), amt: f(/montant|valeur|total|encours|solde|capital|valorisation/) };
}
function aggregate(sheet, map) {
  const m = emptyMat(); let assumed = 0, used = 0;
  sheet.rows.forEach(function (r) {
    const env = normEnv(r[map.env]), a = parseNum(r[map.amt]); if (!env || !isFinite(a) || a <= 0) return;
    let c = map.cls >= 0 ? normCls(r[map.cls]) : null;
    if (!c) { c = env === 'SCPI' ? 'immobilier' : 'actions'; if (env === 'AV' || env === 'PER') assumed++; }
    m[env][c] += a; used++;
  });
  return { mat: m, assumed: assumed, used: used };
}
function totals(mat) { const byC = {}, byE = {}; let tot = 0; CLS.forEach(function (c) { byC[c] = 0; }); ENVS.forEach(function (e) { byE[e] = 0; CLS.forEach(function (c) { const v = mat[e][c] || 0; byC[c] += v; byE[e] += v; tot += v; }); }); return { byC: byC, byE: byE, tot: tot }; }
function targetsNow() { const s = sn(); return s ? s.allocation.asset_classes : null; }
function suggestions(mat, T, tg) {
  const sp = spec().envelopes, thr = Math.max(100, T.tot * .01), out = [];
  const gaps = CLS.map(function (c) { const target = tg[c] / 100 * T.tot; return { c: c, diff: target - T.byC[c], rem: 0 }; });
  const sur = gaps.filter(function (g) { return g.diff < -thr; }).map(function (g) { return { c: g.c, rem: -g.diff }; }).sort(function (a, b) { return b.rem - a.rem; });
  const def = gaps.filter(function (g) { return g.diff > thr; }).sort(function (a, b) { return b.diff - a.diff; });
  const avail = JSON.parse(JSON.stringify(mat));
  def.forEach(function (d) {
    let need = d.diff;
    sur.forEach(function (s_) {
      if (need < thr || s_.rem < thr) return;
      const amt = Math.min(need, s_.rem);
      const from = sp.sell_priority.filter(function (e) { return avail[e][s_.c] >= thr; })[0] || null;
      const to = (sp.buy_priority[d.c] || ENVS)[0];
      const take = from ? Math.min(amt, avail[from][s_.c]) : amt; if (from) avail[from][s_.c] -= take;
      out.push({ fromC: s_.c, fromE: from, toC: d.c, toE: to, amt: take }); s_.rem -= take; need -= take;
    });
    if (need >= thr) out.push({ fromC: null, toC: d.c, toE: (sp.buy_priority[d.c] || ENVS)[0], amt: need, flow: true });
  });
  return out;
}
function wealthResults() {
  const P = patri(), T = totals(P.mat), tg = targetsNow();
  if (T.tot <= 0) return '<div class="note">' + esc(t('we.empty')) + '</div>';
  if (!tg) return missing('snapshot');
  let h = '<h3>' + esc(t('we.gap')) + '</h3>' + rtable([{ h: t('col.class') }, { h: t('we.actual'), n: 1 }, { h: t('we.target'), n: 1 }, { h: t('we.diff'), n: 1 }, { h: t('we.diffe'), n: 1 }],
    CLS.map(function (c) { const a = T.byC[c] / T.tot * 100, d = tg[c] - a; return ['<b>' + esc(t('cls.' + c)) + '</b>', pc(a, 1) + ' <span class="mut">' + eur(T.byC[c]) + '</span>', pc(tg[c], 1), '<b style="color:' + (Math.abs(d) < 2 ? 'var(--tx)' : (d > 0 ? 'var(--ok)' : 'var(--ko)')) + '">' + pc(d, 1, true) + '</b>', eur(d / 100 * T.tot)]; }));
  const sg = suggestions(P.mat, T, tg);
  h += '<h3 style="margin-top:14px">' + esc(t('we.sugg')) + '</h3>';
  if (!sg.length) h += '<div class="note">' + esc(t('we.ok')) + '</div>';
  else {
    h += sg.map(function (x) {
      let txt = x.flow ? t('we.flow', { amt: eur(x.amt), c: t('cls.' + x.toC), e: x.toE }) : t('we.move', { amt: eur(x.amt), a: t('cls.' + x.fromC), ea: x.fromE || t('nd'), b: t('cls.' + x.toC), eb: x.toE });
      const hints = []; if (x.fromE === 'CTO') hints.push(t('we.h.cto')); if (x.toE === 'PEA') hints.push(t('we.h.pea')); if (x.toE === 'SCPI') hints.push(t('we.h.scpi')); if (x.fromE === 'PEA') hints.push(t('we.h.peasell')); hints.push(t('we.h.flow'));
      return '<div class="note"><b>' + esc(txt) + '</b><br>' + esc(hints.join(' ')) + '</div>';
    }).join('');
  }
  h += '<h3 style="margin-top:14px">' + esc(t('we.byenv')) + '</h3>' + rtable([{ h: t('col.env') }, { h: t('we.amount'), n: 1 }, { h: t('we.share'), n: 1 }], ENVS.map(function (e) { return ['<b>' + e + '</b>', eur(T.byE[e]), pc(T.byE[e] / T.tot * 100, 1)]; })) + '<p class="mut">' + esc(t('we.disc')) + '</p>';
  return h;
}
RENDER.wealth = function () {
  const P = patri(), sh = store.get('sheet', { id: '', name: '' }), sS = S.sheet;
  let h = '<div class="card"><h2>' + esc(t('we.title')) + '</h2><p class="mut">' + esc(t('we.d')) + '</p><div class="note">' + esc(t('we.privacy')) + '</div>' +
    '<div class="grid"><label class="fld">' + esc(t('we.sheetid')) + '<input type="text" id="sh-id" value="' + esc(sh.id) + '" autocomplete="off" placeholder="1AbC..."></label><label class="fld">' + esc(t('we.sheetname')) + '<input type="text" id="sh-name" value="' + esc(sh.name) + '" autocomplete="off"></label></div>' +
    '<div class="bar" style="justify-content:flex-start;margin:10px 0 0"><button type="button" class="btn pri" data-act="sheet-load">' + esc(t('we.load')) + '</button><button type="button" class="btn" data-act="patri-clear">' + esc(t('we.clear')) + '</button></div><div id="sh-msg" class="mut" style="margin-top:8px">' + (P.ts ? esc(t('we.saved', { d: dtfmt(P.ts), s: t('we.src.' + P.src) })) : '') + '</div>';
  if (sS) {
    const opt = function (sel) { return '<option value="-1">' + esc(t('we.none')) + '</option>' + sS.cols.map(function (c, i) { return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(c || ('#' + (i + 1))) + '</option>'; }).join(''); };
    h += '<h3 style="margin-top:12px">' + esc(t('we.map')) + '</h3><div class="grid"><label class="fld">' + esc(t('col.env')) + '<select data-ch="map" data-r="env">' + opt(sS.map.env) + '</select></label><label class="fld">' + esc(t('col.class')) + '<select data-ch="map" data-r="cls">' + opt(sS.map.cls) + '</select></label><label class="fld">' + esc(t('we.amount')) + '<select data-ch="map" data-r="amt">' + opt(sS.map.amt) + '</select></label></div>';
  }
  h += '</div><div class="card"><h2>' + esc(t('we.manual')) + '</h2><p class="mut">' + esc(t('we.manual.d')) + '</p>' +
    rtable([{ h: t('col.env') }].concat(CLS.map(function (c) { return { h: t('cls.' + c), n: 1 }; })), ENVS.map(function (e) { return ['<b>' + e + '</b>'].concat(CLS.map(function (c) { return '<input type="number" inputmode="decimal" min="0" step="100" style="min-width:90px;text-align:right" value="' + (P.mat[e][c] || '') + '" data-in="pm" data-e="' + e + '" data-c="' + c + '">'; })); })) + '</div>' +
    '<div class="card"><h2>' + esc(t('we.res')) + '</h2><div id="wealth-res">' + wealthResults() + '</div></div>';
  return h;
};
function savePatri(src) { const P = patri(); P.src = src; P.ts = new Date().toISOString(); store.set('patri', P); }
ACT.pm = function (a) { const P = patri(); P.mat[a.dataset.e][a.dataset.c] = Math.max(0, parseNum(a.value) || 0); savePatri('manual'); const el = $('#wealth-res'); if (el) el.innerHTML = wealthResults(); };
ACT['patri-clear'] = function () { S.patri = { mat: emptyMat(), src: 'manual', ts: null }; store.del('patri'); S.sheet = null; renderTab('wealth'); };
ACT.map = function (a) { if (!S.sheet) return; S.sheet.map[a.dataset.r] = parseInt(a.value, 10); const g = aggregate(S.sheet, S.sheet.map); patri().mat = g.mat; savePatri('sheet'); renderTab('wealth'); };
ACT['sheet-load'] = async function () {
  const id = ($('#sh-id').value || '').trim().replace(/^.*\/d\/([a-zA-Z0-9_-]+).*$/, '$1'), name = ($('#sh-name').value || '').trim(), msg = $('#sh-msg');
  if (!id) { msg.textContent = t('we.noid'); return; }
  store.set('sheet', { id: id, name: name }); msg.textContent = t('loading');
  try {
    const sheet = parseGviz(await gvizLoad(id, name)); sheet.map = guessMap(sheet.cols);
    if (sheet.map.env < 0 || sheet.map.amt < 0) { S.sheet = sheet; msg.textContent = t('we.mapfail'); renderTab('wealth'); return; }
    const g = aggregate(sheet, sheet.map); S.sheet = sheet; patri().mat = g.mat; savePatri('sheet'); renderTab('wealth');
    const m2 = $('#sh-msg'); if (m2) m2.textContent = t('we.loaded', { n: g.used }) + (g.assumed ? ' ' + t('we.assumed', { n: g.assumed }) : '');
  } catch (e) { msg.textContent = t('we.err') + ' (' + e.message + ')'; }
};

/* ============================================================================
   ONGLET 8 : COMPARER (mon allocation, radar, All Weather)
   ========================================================================== */
function stackBar(v) { return '<div class="stack">' + CLS.map(function (c) { return '<i style="width:' + (v[c] || 0) + '%;background:' + CLASS_COL[c] + '" title="' + esc(t('cls.' + c)) + ' ' + nf(v[c] || 0, 0) + ' %"></i>'; }).join('') + '</div>'; }
RENDER.compare = function () {
  const tg = targetsNow(); if (!tg) return missing('snapshot');
  const T = totals(patri().mat), mine = {}; const has = T.tot > 0; CLS.forEach(function (c) { mine[c] = has ? T.byC[c] / T.tot * 100 : null; });
  const aw = spec().asset_classes.all_weather;
  let h = '<div class="card"><h2>' + esc(t('cmp.title')) + '</h2><p class="mut">' + esc(t('cmp.d')) + '</p>' + (has ? '' : '<div class="note warn">' + esc(t('cmp.nomine')) + '</div>') +
    [[t('cmp.mine'), mine, has], [t('cmp.radar'), tg, true], ['All Weather', aw, true]].map(function (x) { return '<div style="margin:12px 0"><div class="row" style="border:0;padding:0"><b>' + esc(x[0]) + '</b></div>' + (x[2] ? stackBar(x[1]) : '<div class="mut">' + esc(t('nd')) + '</div>') + '</div>'; }).join('') +
    '<div class="leg">' + CLS.map(function (c) { return '<span><b style="background:' + CLASS_COL[c] + '"></b>' + esc(t('cls.' + c)) + '</span>'; }).join('') + '</div></div>';
  h += '<div class="card">' + rtable([{ h: t('col.class') }, { h: t('cmp.mine'), n: 1 }, { h: t('cmp.radar'), n: 1 }, { h: 'All Weather', n: 1 }, { h: t('cmp.gap.r'), n: 1 }, { h: t('cmp.gap.a'), n: 1 }],
    CLS.map(function (c) { return ['<b>' + esc(t('cls.' + c)) + '</b>', has ? pc(mine[c], 1) : t('nd'), pc(tg[c], 1), pc(aw[c], 1), has ? pc(mine[c] - tg[c], 1, true) : t('nd'), has ? pc(mine[c] - aw[c], 1, true) : t('nd')]; })) + '<p class="mut">' + esc(t('cmp.note')) + '</p></div>';
  return h;
};
