/* ============================================================================
   ONGLET 1 : RADAR (régime, inertie, bulle, macro, partage, PDF)
   ========================================================================== */
function openNew(url) { try { const w = window.open(url, '_blank', 'noopener'); if (w) return; } catch (e) { } copyText(url, url); }
function quadSvg(G, I, band) {
  const c = 150, k = 1.4, px = c + Math.max(-100, Math.min(100, G)) * k, py = c - Math.max(-100, Math.min(100, I)) * k, b = band * k;
  const q = function (x, y, col, lab) { return '<rect x="' + x + '" y="' + y + '" width="150" height="150" fill="' + col + '" opacity=".13"/><text x="' + (x + 75) + '" y="' + (y + 78) + '" text-anchor="middle" font-size="12" font-weight="700" fill="' + col + '">' + esc(lab) + '</text>'; };
  return '<svg viewBox="0 0 300 300" width="100%" style="max-width:340px;display:block;margin:0 auto" role="img" aria-label="' + esc(t('radar.quad')) + '">' +
    q(150, 0, RC.reflation, regName('reflation')) + q(0, 0, RC.stagflation, regName('stagflation')) + q(150, 150, RC.goldilocks, regName('goldilocks')) + q(0, 150, RC.neutral, regName('neutral')) +
    '<rect x="' + (c - b) + '" y="' + (c - b) + '" width="' + 2 * b + '" height="' + 2 * b + '" fill="none" stroke="var(--tx2)" stroke-dasharray="4 3" opacity=".7"/>' +
    '<line x1="0" y1="150" x2="300" y2="150" stroke="var(--tx2)"/><line x1="150" y1="0" x2="150" y2="300" stroke="var(--tx2)"/>' +
    '<text x="296" y="144" text-anchor="end" font-size="10" fill="var(--tx2)">' + esc(t('axis.g')) + '</text><text x="154" y="12" font-size="10" fill="var(--tx2)">' + esc(t('axis.i')) + '</text>' +
    '<circle cx="' + px + '" cy="' + py + '" r="9" fill="var(--or)" stroke="#fff" stroke-width="2"/></svg>';
}
function bubbleHtml(b) {
  const tiers = b.tier_thresholds || spec().bubble.tiers;
  const col = ['var(--ok)', 'var(--wa)', '#f97316', 'var(--ko)'][b.tier];
  let h = '<div class="hero"><div class="rn" style="color:' + col + ';font-size:clamp(34px,8vw,52px)">' + nf(b.score, 0) + '<span class="mut" style="font-size:16px"> / 100</span></div><div><span class="badge" style="color:' + col + ';border-color:' + col + '">' + esc(t('tier.' + b.tier)) + '</span></div></div>';
  h += '<div class="meter" style="margin:12px 0 4px;position:relative"><i style="width:' + Math.min(100, b.score) + '%;background:' + col + '"></i>' + tiers.map(function (x) { return '<span class="tk" style="left:' + x + '%"></span>'; }).join('') + '</div><div class="mut" style="display:flex;justify-content:space-between"><span>0</span><span>' + tiers.join('  ') + '</span><span>100</span></div>';
  h += '<div style="margin-top:12px">' + b.pillars.map(function (p) {
    return '<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(t('pil.' + p.key)) + ' <span class="mut">(' + Math.round(p.weight * 100) + ' %)</span></b><span>' + nf(p.score, 0) + ' / 100' + (p.proxy ? ' <span class="badge y">' + esc(t('proxy')) + '</span>' : '') + '</span></div>' +
      '<div class="meter" style="margin:5px 0"><i style="width:' + p.score + '%"></i></div><div class="mut">' + esc(t('pil.' + p.key + '.d')) + '</div>' +
      '<div class="mut">' + esc(t('source')) + ' : ' + esc(p.source) + (p.value != null ? ' · ' + nf(p.value, 2) + ' ' + esc(p.unit) : '') + (p.extra && p.extra.breadth_pct != null ? ' · breadth ' + nf(p.extra.breadth_pct, 0) + ' %' : '') + '</div></div>';
  }).join('') + '</div>';
  return h;
}
RENDER.radar = function () {
  const s = sn(); if (!s) return missing('snapshot');
  const R = s.regime, N = s.inertia, cur = N.current, col = RC[cur];
  const dots = '●'.repeat(N.counter) + '○'.repeat(Math.max(0, N.required - N.counter));
  let trans = N.pending ? t('radar.pending', { to: regName(N.candidate), n: N.counter, req: N.required }) : (N.raw_today !== cur ? t('radar.rawdiff', { raw: regName(N.raw_today) }) : t('radar.stable'));
  const comp = R.components || {};
  const compRows = ['spy12', 'spy6', 'hyg6', 'tlt6', 'gsg12', 'gsg6', 'be6'].map(function (k) { return '<div class="row"><span>' + esc(t('comp.' + k)) + '</span><span>' + pc(comp[k], 1, true) + '</span></div>'; }).join('');
  let h = '<div class="card hero" style="border-color:' + col + '"><div class="mut">' + esc(t('radar.current')) + '</div><div class="rn" style="color:' + col + '">' + esc(regName(cur)) + '</div>' +
    '<div class="dots" style="color:' + col + '" aria-label="' + esc(trans) + '">' + dots + '</div><div class="mut">' + esc(trans) + '</div>' +
    '<p style="max-width:720px;margin:10px auto">' + esc(t('reg.' + cur + '.d')) + '</p>' +
    '<div class="grid s" style="max-width:720px;margin:0 auto"><div class="kpi"><b>' + nf(R.confidence, 0) + ' %</b><span>' + esc(t('radar.conf')) + '</span></div><div class="kpi"><b>' + N.days_in_regime + ' ' + esc(t('days')) + '</b><span>' + esc(t('radar.since', { d: dfmt(N.since) })) + '</span></div><div class="kpi"><b>' + nf(R.distance_to_switch.points, 0) + ' ' + esc(t('pts')) + '</b><span>' + esc(t('radar.dist', { ax: R.distance_to_switch.axis === 'G' ? t('axis.g') : t('axis.i') })) + '</span></div><div class="kpi"><b>' + nf(s.bubble.score, 0) + ' / 100</b><span>' + esc(t('radar.bubble')) + '</span></div></div>';
  if (R.ambiguous) h += '<div class="note warn" style="margin-top:10px;text-align:left">' + esc(t('radar.amb.' + R.zone)) + '</div>';
  h += '<div class="bar" style="margin:12px 0 0"><button type="button" class="btn pri" data-act="print">' + esc(t('btn.pdf')) + '</button><button type="button" class="btn" data-act="share">' + esc(t('btn.share')) + '</button><button type="button" class="btn" data-act="share-x">X</button><button type="button" class="btn" data-act="share-li">LinkedIn</button><button type="button" class="btn" data-act="share-wa">WhatsApp</button></div></div>';
  h += '<div class="grid"><div class="card"><h2>' + esc(t('radar.map')) + '</h2>' + quadSvg(R.G, R.I, spec().thresholds.ambiguity_band) +
    '<div style="margin-top:10px"><div class="row"><span>' + esc(t('axis.g')) + '</span><b>' + nf(R.G, 1, true) + '</b></div>' + axBar(R.G, 100) + '<div class="row" style="margin-top:6px"><span>' + esc(t('axis.i')) + '</span><b>' + nf(R.I, 1, true) + '</b></div>' + axBar(R.I, 100) + '</div></div>' +
    '<div class="card"><h2>' + esc(t('radar.signals')) + '</h2>' + compRows + '<p class="mut" style="margin:8px 0 0">' + esc(t('radar.signals.d')) + '</p></div></div>';
  // confirmation macro FRED
  const M = s.macro || {};
  h += '<div class="card"><h2>' + esc(t('radar.macro')) + '</h2>';
  if (!M.available) h += '<div class="note warn">' + esc(t('macro.na')) + '</div>';
  else {
    const mc = M.check || {};
    h += '<p class="mut">' + esc(t('macro.sum', { adj: nf(mc.adjust, 0, true), g: mc.agreement ? t('agree.' + mc.agreement.growth) : '', i: mc.agreement ? t('agree.' + mc.agreement.inflation) : '' })) + '</p>';
    const order = spec().fred.series;
    h += rtable([{ h: t('col.series') }, { h: t('col.value'), n: 1 }, { h: t('col.date') }, { h: t('col.detail') }], order.filter(function (k) { return M.series && M.series[k]; }).map(function (k) {
      const x = M.series[k]; let d = '';
      if (x.yoy != null) d += t('d.yoy') + ' ' + pc(x.yoy, 1, true) + ' '; if (x.ann3m != null) d += t('d.ann3m') + ' ' + pc(x.ann3m, 1, true) + ' '; if (x.avg4 != null) d += t('d.avg4') + ' ' + nf(x.avg4, 0);
      return ['<b>' + esc(k) + '</b> <span class="mut">' + esc(t('fred.' + k)) + '</span>', nf(x.value, 2), esc(dfmt(x.date)), esc(d.trim() || t('nd'))];
    }));
  }
  h += '</div><div class="card"><h2>' + esc(t('radar.bubble.t')) + '</h2>' + bubbleHtml(s.bubble) + '</div>';
  return h;
};
function shareText() {
  const s = sn(); if (!s) return CONFIG.PAGE_URL;
  const top = s.allocation.sectors.slice(0, 3).map(function (x) { return t('sec.' + x.key); }).join(', ');
  return t('share.text', { reg: regName(s.inertia.current), b: nf(s.bubble.score, 0), top: top });
}
ACT.share = function () {
  const txt = shareText();
  try { if (navigator.share) { navigator.share({ text: txt, url: CONFIG.PAGE_URL }).catch(function () { copyText(txt + ' ' + CONFIG.PAGE_URL); }); return; } } catch (e) { }
  copyText(txt + ' ' + CONFIG.PAGE_URL);
};
ACT['share-x'] = function () { openNew('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(CONFIG.PAGE_URL)); };
ACT['share-li'] = function () { openNew('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(CONFIG.PAGE_URL)); };
ACT['share-wa'] = function () { openNew('https://wa.me/?text=' + encodeURIComponent(shareText() + ' ' + CONFIG.PAGE_URL)); };
ACT.print = function () {
  const s = sn(); if (!s) return;
  const rows = s.allocation.sectors.map(function (x) { return '<tr><td>' + esc(t('sec.' + x.key)) + ' (' + esc(x.ticker) + ')</td><td>' + esc(t('act.' + x.action)) + '</td><td>' + pc(x.weight, 1) + '</td></tr>'; }).join('');
  $('#rmf-print').innerHTML = '<h1>' + esc(t('title')) + '</h1><p><b>' + esc(t('print.date')) + ' :</b> ' + esc(dtfmt(s.generated_at)) + ' (' + esc(t('strip.asof')) + ' ' + esc(dfmt(s.asof)) + ')</p>' +
    '<h2>' + esc(regName(s.inertia.current)) + '</h2><p>' + esc(t('reg.' + s.inertia.current + '.d')) + '</p><p>' + esc(t('radar.conf')) + ' : ' + nf(s.regime.confidence, 0) + ' % · ' + esc(t('radar.bubble')) + ' : ' + nf(s.bubble.score, 0) + ' / 100 (' + esc(t('tier.' + s.bubble.tier)) + ')</p>' +
    '<table><tr><th>' + esc(t('col.sector')) + '</th><th>' + esc(t('col.action')) + '</th><th>' + esc(t('col.weight')) + '</th></tr>' + rows + '</table><p style="font-size:11px">' + esc(t('disclaimer')) + '</p>';
  try { window.print(); } catch (e) { toast(t('print.blocked')); }
};

/* ============================================================================
   ONGLET 2 : ALLOCATION (tri par priorité, simulateur de capital, export CSV/TSV)
   ========================================================================== */
function etfOf(key) { const x = spec().sectors.filter(function (s) { return s.key === key; })[0]; return x ? x.ucits : null; }
function justetf(isin) { return 'https://www.justetf.com/' + S.lang + '/etf-profile.html?isin=' + encodeURIComponent(isin); }
function etfCell(key) {
  const u = etfOf(key); if (!u) return t('nd');
  return '<a href="' + justetf(u.isin) + '" target="_blank" rel="noopener">' + esc(u.isin) + '</a>' + (u.isin_verified ? '' : ' <span class="badge y" title="' + esc(t('etf.unverified')) + '">?</span>');
}
function peaBadge(u) { return u && u.pea ? '<span class="badge g">' + esc(t('pea.yes')) + '</span>' : '<span class="badge r">' + esc(t('pea.no')) + '</span>'; }
function rangeBadge(r) { const c = { low: 'g', mid: '', high: 'y' }[r] || ''; return '<span class="badge ' + c + '">' + esc(t('range.' + r)) + '</span>'; }
RENDER.alloc = function () {
  const s = sn(); if (!s) return missing('snapshot');
  const A = s.allocation, cap = store.get('capital', 10000);
  let h = '<div class="card"><h2>' + esc(t('alloc.title')) + '</h2><div class="grid s"><div class="kpi"><b style="color:' + RC[A.regime_used] + '">' + esc(regName(A.regime_used)) + '</b><span>' + esc(t('alloc.regime')) + '</span></div><div class="kpi"><b>' + esc(t('tier.' + s.bubble.tier)) + '</b><span>' + esc(t('radar.bubble')) + '</span></div><div class="kpi"><b>+' + A.tier_effective + '</b><span>' + esc(t('alloc.tilt')) + '</span></div></div>' +
    (A.blend ? '<div class="note warn" style="margin-top:10px">' + esc(t('alloc.blend', { a: regName(A.blend[0]), b: regName(A.blend[1]) })) + '</div>' : '') +
    '<p class="mut">' + esc(t('alloc.sorted')) + '</p>' +
    '<div class="grid" style="margin:10px 0"><label class="fld">' + esc(t('alloc.capital')) + '<input type="number" inputmode="decimal" min="0" step="100" value="' + cap + '" data-in="cap"></label>' +
    '<div class="bar" style="justify-content:flex-start;align-items:flex-end;margin:0"><button type="button" class="btn" data-act="exp-csv">CSV</button><button type="button" class="btn" data-act="exp-tsv">' + esc(t('btn.copytsv')) + '</button></div></div>';
  h += rtable([{ h: '#', n: 1 }, { h: t('col.sector') }, { h: t('col.action') }, { h: t('col.weight'), n: 1 }, { h: t('col.amount'), n: 1 }, { h: t('col.base'), n: 1 }, { h: t('col.range') }, { h: t('col.etf') }, { h: t('col.ter'), n: 1 }, { h: t('col.pea') }],
    A.sectors.map(function (x) {
      const u = etfOf(x.key) || {};
      return [x.rank, '<b>' + esc(t('sec.' + x.key)) + '</b> <span class="mut">' + esc(x.ticker) + '</span>', actBadge(x.action), '<b>' + pc(x.weight, 1) + '</b>', '<span data-amt="' + x.weight + '">' + eur(cap * x.weight / 100) + '</span>', pc(x.base_weight, 1), x.range_label ? rangeBadge(x.range_label) : t('nd'), etfCell(x.key), pc(u.ter, 2), peaBadge(u)];
    })) + '</div>';
  h += '<div class="note">' + esc(t('alloc.pea.note')) + '</div><div class="note">' + esc(t('alloc.etf.note')) + '</div>';
  return h;
};
ACT.cap = function (a) { const v = Math.max(0, parseNum(a.value) || 0); store.set('capital', v); $$('[data-amt]').forEach(function (c) { c.textContent = eur(v * parseFloat(c.dataset.amt) / 100); }); };
function exportRows() {
  const s = sn(), cap = store.get('capital', 10000), sep = '\t';
  const head = [t('col.rank'), t('col.sector'), 'Ticker', t('col.action'), t('col.weight') + ' %', t('col.amount') + ' EUR', 'ETF UCITS', 'ISIN', 'TER %', t('col.pea')];
  const rows = s.allocation.sectors.map(function (x) { const u = etfOf(x.key) || {}; return [x.rank, t('sec.' + x.key), x.ticker, t('act.' + x.action), numStr(x.weight, 2), numStr(cap * x.weight / 100, 0), u.name || '', u.isin || '', numStr(u.ter, 2), u.pea ? t('pea.yes') : t('pea.no')]; });
  return { head: head, rows: rows, sep: sep };
}
ACT['exp-tsv'] = function () { if (!sn()) return; const e = exportRows(); copyText([e.head].concat(e.rows).map(function (r) { return r.join('\t'); }).join('\n')); };
ACT['exp-csv'] = function () {
  if (!sn()) return; const e = exportRows(), q = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
  saveFile('radar-macro-fire-allocation.csv', 'text/csv', '﻿' + [e.head].concat(e.rows).map(function (r) { return r.map(q).join(';'); }).join('\n'));
};

/* ============================================================================
   ONGLET 3 : HEATMAP SECTORIELLE
   ========================================================================== */
RENDER.heat = function () {
  const s = sn(); if (!s) return missing('snapshot');
  const f = S.heat.f, so = S.heat.sort;
  let rows = s.allocation.sectors.filter(function (x) { return f === 'all' || x.kind === f; });
  rows = rows.slice().sort(function (a, b) { return (b[so] == null ? -1e9 : b[so]) - (a[so] == null ? -1e9 : a[so]); });
  const chip = function (k, lab) { return '<button type="button" class="chip' + (S.heat.f === k ? ' on' : '') + '" data-act="heat-f" data-k="' + k + '">' + esc(lab) + '</button>'; };
  const opts = ['weight', 'mom_1m', 'mom_3m', 'mom_6m', 'rel_strength_3m', 'vs_ma50', 'vs_ma200'].map(function (k) { return '<option value="' + k + '"' + (k === so ? ' selected' : '') + '>' + esc(t('hm.' + k)) + '</option>'; }).join('');
  return '<div class="card"><h2>' + esc(t('heat.title')) + '</h2><p class="mut">' + esc(t('heat.d')) + '</p><div class="chips">' + chip('all', t('heat.all')) + chip('defensive', t('heat.def')) + chip('cyclical', t('heat.cyc')) + '</div>' +
    '<label class="fld" style="max-width:320px;margin-bottom:10px">' + esc(t('heat.sort')) + '<select data-ch="heat-s">' + opts + '</select></label>' +
    rtable([{ h: t('col.sector') }, { h: t('col.kind') }, { h: '1M', n: 1 }, { h: '3M', n: 1 }, { h: '6M', n: 1 }, { h: t('hm.rel_strength_3m'), n: 1 }, { h: t('hm.vs_ma50'), n: 1 }, { h: t('hm.vs_ma200'), n: 1 }, { h: t('col.range') }],
      rows.map(function (x) { return ['<b>' + esc(t('sec.' + x.key)) + '</b> <span class="mut">' + esc(x.ticker) + '</span>', esc(t('kind.' + x.kind)), heatCell(x.mom_1m, 8), heatCell(x.mom_3m, 15), heatCell(x.mom_6m, 25), heatCell(x.rel_strength_3m, 8), heatCell(x.vs_ma50, 8), heatCell(x.vs_ma200, 15), x.range_label ? rangeBadge(x.range_label) : t('nd')]; })) + '</div>';
};
ACT['heat-f'] = function (a) { S.heat.f = a.dataset.k; renderTab('heat'); };
ACT['heat-s'] = function (a) { S.heat.sort = a.value; renderTab('heat'); };

/* ============================================================================
   ONGLET 4 : PAGES SECTORIELLES (accordéon, sans ancres)
   ========================================================================== */
RENDER.sectors = function () {
  const s = sn(), sp = spec(); const live = {}; if (s) s.allocation.sectors.forEach(function (x) { live[x.key] = x; });
  const avg = 100 / sp.sectors.length;
  return '<div class="card"><h2>' + esc(t('sect.title')) + '</h2><p class="mut">' + esc(t('sect.d')) + '</p></div>' + sp.sectors.map(function (S_) {
    const L = live[S_.key] || {}, u = S_.ucits;
    const bars = sp.regimes.map(function (rg) {
      const w = S_.base[rg], ctx = w >= avg * 1.4 ? 'ctx.strong' : (w >= avg * .9 ? 'ctx.neutral' : 'ctx.weak');
      return '<div style="margin:8px 0"><div class="row" style="border:0;padding:0"><span>' + regBadge(rg) + (s && s.inertia.current === rg ? ' <span class="badge o">' + esc(t('sect.now')) + '</span>' : '') + '</span><b>' + pc(w, 0) + '</b></div><div class="meter" style="margin:4px 0"><i style="width:' + Math.min(100, w * 3.5) + '%;background:' + RC[rg] + '"></i></div><div class="mut">' + esc(t(ctx, { w: w })) + '</div></div>';
    }).join('');
    return '<details><summary><span>' + esc(t('sec.' + S_.key)) + ' <span class="mut">' + esc(S_.ticker) + '</span></span><span>' + (L.action ? actBadge(L.action) : '') + '</span></summary><div class="bd">' +
      '<p>' + esc(t('sec.' + S_.key + '.d')) + '</p><h3>' + esc(t('sect.ctx')) + '</h3>' + bars +
      '<h3 style="margin-top:12px">' + esc(t('sect.perf')) + '</h3>' + (L.price != null ? '<div class="grid s"><div class="kpi"><b>' + heatCell(L.mom_1m, 8) + '</b><span>1M</span></div><div class="kpi"><b>' + heatCell(L.mom_3m, 15) + '</b><span>3M</span></div><div class="kpi"><b>' + heatCell(L.mom_6m, 25) + '</b><span>6M</span></div><div class="kpi"><b>' + heatCell(L.rel_strength_3m, 8) + '</b><span>' + esc(t('hm.rel_strength_3m')) + '</span></div></div><p class="mut">' + esc(t('hm.vs_ma50')) + ' : ' + pc(L.vs_ma50, 1, true) + ' · ' + esc(t('hm.vs_ma200')) + ' : ' + pc(L.vs_ma200, 1, true) + ' · ' + (L.range_label ? esc(t('range.' + L.range_label)) : '') + '</p>' : '<p class="mut">' + esc(t('nd')) + '</p>') +
      '<h3>' + esc(t('sect.etf')) + '</h3><p>' + esc(u.name) + '<br><span class="mut">ISIN </span>' + etfCell(S_.key) + ' · <span class="mut">TER </span>' + pc(u.ter, 2) + ' · ' + peaBadge(u) + (u.approx ? ' <span class="badge y">' + esc(t('etf.approx')) + '</span>' : '') + '<br><span class="mut">' + esc(t('sect.proxy')) + ' : ' + esc(S_.ticker) + '</span></p>' +
      '<h3>' + esc(t('sect.risks')) + '</h3><p>' + esc(t('sec.' + S_.key + '.r')) + '</p></div></details>';
  }).join('');
};
