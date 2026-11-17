/* ============================================================================
   ONGLET 9 : STRESS TEST FIRE (Monte Carlo léger dans un Web Worker, repli asynchrone)
   ========================================================================== */
// Cette fonction est sérialisée telle quelle vers le Web Worker (aucune dépendance externe).
function rmfSim(P, scen, n, seed) {
  function mk(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mk(seed);
  function norm() { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
  const R = P.regs, years = Math.ceil(P.months / 12), sq = Math.sqrt(12), yearly = [];
  for (let y = 0; y <= years; y++) yearly.push(new Float64Array(n));
  const reached = new Uint8Array(n), survived = new Uint8Array(n), nmu = 0.025 / 12, nsg = 0.04 / sq, inf = P.infl / 12, total = P.months + P.retMonths;
  for (let k = 0; k < n; k++) {
    let reg = P.start, cap = P.cap; yearly[0][k] = cap; if (P.months === 0) reached[k] = cap >= P.target ? 1 : 0;
    let alive = true;
    for (let m = 0; m < total; m++) {
      if (scen === 'stress' && m < 24) reg = 'stagflation';
      else if (scen !== 'persist') { const row = P.M[reg]; let u = rnd(), acc = 0; for (let j = 0; j < R.length; j++) { acc += (row[R[j]] || 0); if (u <= acc) { reg = R[j]; break; } } }
      const re = P.eq * (P.mu[reg] / 12 + P.sg[reg] / sq * norm()) + (1 - P.eq) * (nmu + nsg * norm()) - inf;
      if (m < P.months) {
        cap = cap * (1 + re) + P.save;
        if ((m + 1) % 12 === 0 || m + 1 === P.months) { const yy = Math.min(years, Math.ceil((m + 1) / 12)); yearly[yy][k] = cap; }
        if (m + 1 === P.months) reached[k] = cap >= P.target ? 1 : 0;
      } else { cap = cap * (1 + re) - P.spend / 12; if (cap <= 0) { cap = 0; alive = false; break; } }
    }
    survived[k] = alive ? 1 : 0;
  }
  return { yearly: yearly, reached: reached, survived: survived };
}
function stressParams() {
  const v = store.get('stress', null), T = totals(patri().mat), sp = spec();
  const d = { cap: T.tot > 0 ? Math.round(T.tot) : 100000, save: 1000, years: 10, spend: 30000, swr: 3.5, ret: 40, infl: 2, eq: T.tot > 0 ? Math.round(Math.max(0, Math.min(100, T.byC.actions / T.tot * 100))) : 80, n: 2000 };
  return Object.assign(d, v || {});
}
function stressModel() {
  const sp = spec(), bt = S.data.backtest, tr = S.data.transitions, regs = sp.regimes, mu = {}, sg = {};
  let srcStats = 'def';
  regs.forEach(function (r) { const st = bt && bt.regime_stats && bt.regime_stats[r]; if (st && st.mu != null && st.sigma != null) { mu[r] = st.mu; sg[r] = st.sigma; srcStats = 'bt'; } else { mu[r] = sp.regime_stats_default[r].mu; sg[r] = sp.regime_stats_default[r].sigma; } });
  const ok = tr && tr.matrix_1m && regs.every(function (a) { return tr.matrix_1m[a] && regs.every(function (b) { return tr.matrix_1m[a][b] != null; }); });
  return { regs: regs, mu: mu, sg: sg, M: ok ? tr.matrix_1m : sp.transition_fallback_1m, srcM: ok ? 'emp' : 'fb', srcStats: srcStats };
}
RENDER.stress = function () {
  const s = sn(), p = stressParams(), mo = stressModel();
  const f = function (id, lab, v, step) { return '<label class="fld">' + esc(lab) + '<input type="number" inputmode="decimal" id="st-' + id + '" value="' + v + '" step="' + (step || 1) + '" min="0"></label>'; };
  return '<div class="card"><h2>' + esc(t('st.title')) + '</h2><p class="mut">' + esc(t('st.d')) + '</p>' +
    (s ? '<p>' + esc(t('st.start')) + ' ' + regBadge(s.inertia.current) + '</p>' : missing('snapshot')) +
    '<div class="note">' + esc(t('st.src', { a: t('st.src.m.' + mo.srcM), b: t('st.src.s.' + mo.srcStats) })) + '</div>' +
    '<div class="grid">' + f('cap', t('st.cap'), p.cap, 1000) + f('save', t('st.save'), p.save, 50) + f('years', t('st.years'), p.years, 1) + f('spend', t('st.spend'), p.spend, 500) + f('swr', t('st.swr'), p.swr, .1) + f('ret', t('st.ret'), p.ret, 1) + f('infl', t('st.infl'), p.infl, .1) + f('eq', t('st.eq'), p.eq, 5) +
    '<label class="fld">' + esc(t('st.n')) + '<select id="st-n">' + [500, 2000, 5000].map(function (n) { return '<option value="' + n + '"' + (n === +p.n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
    '<div class="bar" style="justify-content:flex-start;margin-top:10px"><button type="button" class="btn pri" data-act="stress-run">' + esc(t('st.run')) + '</button><span id="st-prog" class="mut"></span></div></div><div id="stress-res">' + (S.stressRes ? stressResultsHtml() : '') + '</div>';
};
function pctl(arr, q) { const a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; }
function summarize(res, P) {
  const out = {}; Object.keys(res).forEach(function (k) {
    const r = res[k], n = r.reached.length, years = r.yearly.length - 1; let nr = 0, np = 0; for (let i = 0; i < n; i++) { if (r.reached[i]) { nr++; if (r.survived[i]) np++; } }
    const fan = { p10: [], p25: [], p50: [], p75: [], p90: [] }; r.yearly.forEach(function (a) { fan.p10.push(pctl(a, .1)); fan.p25.push(pctl(a, .25)); fan.p50.push(pctl(a, .5)); fan.p75.push(pctl(a, .75)); fan.p90.push(pctl(a, .9)); });
    out[k] = { pReach: nr / n, pSurv: nr ? np / nr : null, pPlan: np / n, med: fan.p50[years], p10: fan.p10[years], p90: fan.p90[years], fan: fan };
  });
  return out;
}
function stressResultsHtml() {
  const R = S.stressRes; if (!R) return '';
  const rows = ['markov', 'stress', 'persist'].map(function (k) { const x = R.sum[k]; return ['<b>' + esc(t('st.sc.' + k)) + '</b>', pc(x.pReach * 100, 0), x.pSurv == null ? t('nd') : pc(x.pSurv * 100, 0), '<b style="color:' + (x.pPlan >= .8 ? 'var(--ok)' : (x.pPlan >= .6 ? 'var(--wa)' : 'var(--ko)')) + '">' + pc(x.pPlan * 100, 0) + '</b>', eur(x.med) + ' <span class="mut">(' + eur(x.p10) + ' / ' + eur(x.p90) + ')</span>']; });
  return '<div class="card"><h2>' + esc(t('st.res')) + '</h2><p class="mut">' + esc(t('st.res.d', { t: eur(R.P.target), n: R.n })) + '</p>' + rtable([{ h: t('st.scen') }, { h: t('st.preach'), n: 1 }, { h: t('st.psurv'), n: 1 }, { h: t('st.pplan'), n: 1 }, { h: t('st.med'), n: 1 }], rows) +
    '<label class="fld" style="max-width:340px;margin:10px 0">' + esc(t('st.fan')) + '<select data-ch="st-fan">' + ['markov', 'stress', 'persist'].map(function (k) { return '<option value="' + k + '"' + (R.fan === k ? ' selected' : '') + '>' + esc(t('st.sc.' + k)) + '</option>'; }).join('') + '</select></label>' +
    '<div class="cvw"><canvas id="st-cv" class="cv"></canvas></div><p class="mut">' + esc(t('st.fan.d')) + '</p><div class="note warn">' + esc(t('st.limits')) + '</div></div>';
}
function drawFan() {
  const R = S.stressRes, cv = $('#st-cv'); if (!R || !cv) return;
  const f = R.sum[R.fan].fan, x = f.p50.map(function (_, i) { return i; });
  drawChart(cv, { x: x, height: 280, floor0: true, hline: R.P.target, yFmt: function (v) { return v >= 1e6 ? nf(v / 1e6, 1) + ' M' : nf(v / 1e3, 0) + ' k'; }, xFmt: function (v) { return v + ' ' + t('yr'); },
    areas: [{ lo: f.p10, hi: f.p90, color: 'rgba(255,85,0,.16)' }, { lo: f.p25, hi: f.p75, color: 'rgba(255,85,0,.28)' }], series: [{ data: f.p50, color: cssv('--or'), w: 2.4 }] });
}
RENDER.stress_after = function () { drawFan(); };
RENDER.stress_resize = function () { drawFan(); };
ACT['st-fan'] = function (a) { S.stressRes.fan = a.value; const el = $('#stress-res'); el.innerHTML = stressResultsHtml(); drawFan(); };
ACT['stress-run'] = function () {
  const g = function (id) { return parseNum($('#st-' + id).value); };
  const p = { cap: g('cap') || 0, save: g('save') || 0, years: Math.max(0, Math.round(g('years') || 0)), spend: g('spend') || 0, swr: Math.max(.5, g('swr') || 3.5), ret: Math.max(1, Math.round(g('ret') || 30)), infl: g('infl') || 0, eq: Math.max(0, Math.min(100, g('eq') || 0)), n: parseInt($('#st-n').value, 10) || 2000 };
  store.set('stress', p);
  const mo = stressModel(), s = sn(), start = s ? s.inertia.current : spec().regimes[0];
  const P = { cap: p.cap, save: p.save, months: p.years * 12, spend: p.spend, retMonths: p.ret * 12, infl: p.infl / 100, eq: p.eq / 100, regs: mo.regs, mu: mo.mu, sg: mo.sg, M: mo.M, start: start, target: p.spend / (p.swr / 100) };
  const scens = ['markov', 'stress', 'persist'], seed = (Date.now() % 1e9) | 0, prog = $('#st-prog'), n = p.n;
  const done = function (res) { S.stressRes = { sum: summarize(res, P), P: P, n: n, fan: 'markov' }; prog.textContent = ''; const el = $('#stress-res'); el.innerHTML = stressResultsHtml(); drawFan(); };
  prog.textContent = t('st.running');
  const fallback = function () {
    const res = {}, chunk = 250; let si = 0, off = 0;
    scens.forEach(function (k) { res[k] = { yearly: Array.from({ length: Math.ceil(P.months / 12) + 1 }, function () { return new Float64Array(n); }), reached: new Uint8Array(n), survived: new Uint8Array(n) }; });
    const step = function () {
      const k = scens[si], c = Math.min(chunk, n - off), r = rmfSim(P, k, c, seed + si * 7919 + off);
      r.yearly.forEach(function (a, y) { res[k].yearly[y].set(a, off); }); res[k].reached.set(r.reached, off); res[k].survived.set(r.survived, off); off += c;
      if (off >= n) { si++; off = 0; }
      prog.textContent = t('st.running') + ' ' + Math.round((si * n + off) / (scens.length * n) * 100) + ' %';
      if (si < scens.length) setTimeout(step, 0); else done(res);
    };
    setTimeout(step, 0);
  };
  try {
    if (!window.Worker) throw new Error('no worker');
    const src = 'const rmfSim=' + rmfSim.toString() + ';self.onmessage=function(e){var d=e.data,o={};d.scens.forEach(function(s,i){o[s]=rmfSim(d.P,s,d.n,d.seed+i*7919)});self.postMessage(o)}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    w.onmessage = function (e) { done(e.data); w.terminate(); }; w.onerror = function () { w.terminate(); fallback(); };
    w.postMessage({ P: P, n: n, seed: seed, scens: scens });
  } catch (e) { fallback(); }
};

/* ============================================================================
   ONGLET 10 : IZILY PLAY, « DEVINE LE RÉGIME »
   ========================================================================== */
function gstore() { return Object.assign({ games: 0, best: 0, streak: 0, bestStreak: 0, answered: 0, correct: 0 }, store.get('game', {})); }
function shareCode() { const g = gstore(); try { return 'RMF1.' + btoa(JSON.stringify({ b: g.best, g: g.games, s: g.bestStreak, a: g.answered ? Math.round(g.correct / g.answered * 100) : 0 })); } catch (e) { return ''; } }
function parseCode(c) { try { c = String(c).trim(); if (c.indexOf('RMF1.') !== 0) return null; const o = JSON.parse(atob(c.slice(5))); return (typeof o.b === 'number') ? o : null; } catch (e) { return null; } }
RENDER.game = function () {
  const b = S.data.backtest, g = gstore(), G = S.game;
  let h = '<div class="card"><h2>' + esc(t('gm.title')) + '</h2><p class="mut">' + esc(t('gm.d')) + '</p>' + (store.ok ? '' : '<div class="note warn">' + esc(t('storage.blocked')) + '</div>') +
    '<div class="grid s"><div class="kpi"><b>' + g.best + '</b><span>' + esc(t('gm.best')) + '</span></div><div class="kpi"><b>' + g.bestStreak + '</b><span>' + esc(t('gm.beststreak')) + '</span></div><div class="kpi"><b>' + g.games + '</b><span>' + esc(t('gm.games')) + '</span></div><div class="kpi"><b>' + (g.answered ? Math.round(g.correct / g.answered * 100) : 0) + ' %</b><span>' + esc(t('gm.acc')) + '</span></div></div></div>';
  if (!b || !b.game_cases || b.game_cases.length < 12) return h + missing('backtest');
  if (!G) h += '<div class="card hero"><button type="button" class="btn pri" data-act="gm-start">' + esc(t('gm.start')) + '</button></div>';
  else if (G.i >= G.cases.length) h += '<div class="card hero"><h2>' + esc(t('gm.end')) + '</h2><div class="rn" style="font-size:44px;font-family:\'Prosto One\'">' + G.score + '</div><p>' + esc(t('gm.end.d', { c: G.correct, n: G.cases.length })) + '</p><button type="button" class="btn pri" data-act="gm-start">' + esc(t('gm.again')) + '</button></div>';
  else {
    const c = G.cases[G.i], F = c.f;
    h += '<div class="card"><div class="row" style="border:0"><b>' + esc(t('gm.round', { i: G.i + 1, n: G.cases.length })) + '</b><span>' + esc(t('gm.score')) + ' ' + G.score + ' · ' + esc(t('gm.streak')) + ' ' + G.streak + '</span></div>' +
      '<div class="grid s">' + ['spy12', 'spy6', 'hyg6', 'tlt6', 'gsg12', 'gsg6', 'be6'].map(function (k) { return '<div class="kpi"><b>' + heatCell(F[k], 20) + '</b><span>' + esc(t('comp.' + k)) + '</span></div>'; }).join('') + '</div>' +
      '<p class="mut" style="margin-top:10px">' + esc(t('gm.q')) + '</p><div class="ans">' + spec().regimes.map(function (rg) { return '<button type="button" class="btn" data-act="gm-ans" data-k="' + rg + '"' + (G.done ? ' disabled' : '') + ' style="border-color:' + RC[rg] + '">' + esc(regName(rg)) + '</button>'; }).join('') + '</div>';
    if (G.done) h += '<div class="note ' + (G.last ? '' : 'bad') + '" style="margin-top:10px"><b>' + esc(G.last ? t('gm.ok') : t('gm.ko')) + '</b> ' + esc(t('gm.reveal', { r: regName(c.regime), d: dfmt(c.d), G: nf(c.G, 0, true), I: nf(c.I, 0, true) })) + '</div><button type="button" class="btn pri" data-act="gm-next">' + esc(G.i + 1 >= G.cases.length ? t('gm.finish') : t('gm.next')) + '</button>';
    h += '</div>';
  }
  const code = shareCode();
  h += '<div class="card"><h2>' + esc(t('gm.share')) + '</h2><p class="mut">' + esc(t('gm.share.d')) + '</p><div class="bar" style="justify-content:flex-start"><input type="text" readonly value="' + esc(code) + '" style="flex:1 1 220px"><button type="button" class="btn" data-act="gm-copy">' + esc(t('copy')) + '</button></div>' +
    '<label class="fld" style="margin-top:10px">' + esc(t('gm.friend')) + '<input type="text" id="gm-friend" data-in="gm-cmp" placeholder="RMF1."></label><div id="gm-cmp"></div></div>';
  return h;
};
ACT['gm-start'] = function () {
  const all = S.data.backtest.game_cases.slice(); for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = all[i]; all[i] = all[j]; all[j] = x; }
  S.game = { cases: all.slice(0, 10), i: 0, score: 0, correct: 0, streak: 0, done: false, last: false }; renderTab('game');
};
ACT['gm-ans'] = function (a) {
  const G = S.game, c = G.cases[G.i]; if (G.done) return; const ok = a.dataset.k === c.regime, st = gstore();
  G.done = true; G.last = ok; st.answered++; if (ok) { st.correct++; G.correct++; G.streak++; G.score += 10 + 2 * Math.min(G.streak - 1, 5); st.streak = (st.streak || 0) + 1; st.bestStreak = Math.max(st.bestStreak, G.streak); } else { G.streak = 0; st.streak = 0; }
  store.set('game', st); renderTab('game');
};
ACT['gm-next'] = function () {
  const G = S.game; G.i++; G.done = false;
  if (G.i >= G.cases.length) { const st = gstore(); st.games++; st.best = Math.max(st.best, G.score); store.set('game', st); }
  renderTab('game');
};
ACT['gm-copy'] = function () { copyText(shareCode()); };
ACT['gm-cmp'] = function (a) {
  const o = parseCode(a.value), el = $('#gm-cmp'), g = gstore(); if (!a.value.trim()) { el.innerHTML = ''; return; }
  if (!o) { el.innerHTML = '<div class="note bad">' + esc(t('gm.badcode')) + '</div>'; return; }
  const mine = { b: g.best, g: g.games, s: g.bestStreak, a: g.answered ? Math.round(g.correct / g.answered * 100) : 0 };
  el.innerHTML = rtable([{ h: '' }, { h: t('gm.you'), n: 1 }, { h: t('gm.friendn'), n: 1 }], [[esc(t('gm.best')), mine.b, o.b], [esc(t('gm.beststreak')), mine.s, o.s], [esc(t('gm.games')), mine.g, o.g], [esc(t('gm.acc')), mine.a + ' %', o.a + ' %']]);
};

/* ============================================================================
   ONGLET 11 : JOURNAL DE DÉCISIONS (local) ET ALERTES
   ========================================================================== */
function journal() { return store.get('journal', []); }
RENDER.journal = function () {
  const J = journal().slice().reverse(), s = sn();
  let h = '<div class="card"><h2>' + esc(t('jr.title')) + '</h2><p class="mut">' + esc(t('jr.d')) + '</p>' + (store.ok ? '' : '<div class="note warn">' + esc(t('storage.blocked')) + '</div>') +
    '<div class="note">' + esc(t('jr.local')) + '</div>' +
    '<label class="fld">' + esc(t('jr.note')) + '<textarea id="jr-note" placeholder="' + esc(t('jr.ph')) + '"></textarea></label>' +
    '<div class="bar" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn pri" data-act="jr-add">' + esc(t('jr.add')) + '</button>' + (s ? '<span class="mut">' + esc(t('jr.ctx')) + ' ' + esc(regName(s.inertia.current)) + ' · ' + esc(t('radar.bubble')) + ' ' + nf(s.bubble.score, 0) + '</span>' : '') + '</div>' +
    (J.length ? J.map(function (e) { return '<div class="note"><div class="row" style="border:0;padding:0"><span>' + esc(dtfmt(e.ts)) + ' ' + (e.regime ? regBadge(e.regime) : '') + (e.bubble != null ? ' <span class="mut">' + esc(t('radar.bubble')) + ' ' + nf(e.bubble, 0) + '</span>' : '') + '</span><button type="button" class="btn sm" data-act="jr-del" data-id="' + esc(e.id) + '" aria-label="' + esc(t('delete')) + '">' + esc(t('delete')) + '</button></div><div style="white-space:pre-wrap;margin-top:6px;color:var(--tx)">' + esc(e.note) + '</div></div>'; }).join('') : '<div class="mut">' + esc(t('jr.none')) + '</div>') + '</div>';
  h += '<div class="card"><h2>' + esc(t('jr.io')) + '</h2><p class="mut">' + esc(t('jr.io.d')) + '</p><div class="bar" style="justify-content:flex-start"><button type="button" class="btn" data-act="jr-exp">' + esc(t('jr.exp')) + '</button><label class="btn" style="cursor:pointer">' + esc(t('jr.file')) + '<input type="file" accept="application/json,.json" data-ch="jr-file" style="display:none"></label><button type="button" class="btn" data-act="jr-imp">' + esc(t('jr.imp')) + '</button></div>' +
    '<textarea id="jr-io" style="margin-top:10px" placeholder="' + esc(t('jr.io.ph')) + '"></textarea><div id="jr-msg" class="mut"></div></div>';
  const atom = CONFIG.DATA_BASE + 'alerts.xml';
  h += '<div class="card"><h2>' + esc(t('al.title')) + '</h2><p class="mut">' + esc(t('al.d')) + '</p><div class="note warn">' + esc(t('al.limit')) + '</div>' +
    '<h3>' + esc(t('al.rss')) + '</h3><div class="bar" style="justify-content:flex-start"><input type="text" readonly value="' + esc(atom) + '" style="flex:1 1 240px"><button type="button" class="btn" data-act="al-copy">' + esc(t('copy')) + '</button><button type="button" class="btn" data-act="al-open">' + esc(t('open')) + '</button></div>' +
    '<h3 style="margin-top:14px">' + esc(t('al.mail')) + '</h3>' + (CONFIG.BREVO_FORM_URL ? '<iframe title="' + esc(t('al.mail')) + '" src="' + esc(CONFIG.BREVO_FORM_URL) + '" style="width:100%;max-width:560px;height:430px;border:0;border-radius:12px;background:#fff" loading="lazy"></iframe>' : '') +
    (CONFIG.BREVO_SIGNUP_LINK ? '<div class="bar" style="justify-content:flex-start;margin-top:8px"><a class="btn pri" target="_blank" rel="noopener" href="' + esc(CONFIG.BREVO_SIGNUP_LINK) + '">' + esc(t('al.signup')) + '</a></div>' : '') +
    (!CONFIG.BREVO_FORM_URL && !CONFIG.BREVO_SIGNUP_LINK ? '<div class="note">' + esc(t('al.nocfg')) + '</div>' : '') + '<p class="mut">' + esc(t('al.optin')) + '</p></div>';
  return h;
};
ACT['jr-add'] = function () {
  const v = ($('#jr-note').value || '').trim(); if (!v) return; const s = sn(), J = journal();
  J.push({ id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), regime: s ? s.inertia.current : null, bubble: s ? s.bubble.score : null, note: v });
  store.set('journal', J); renderTab('journal');
};
ACT['jr-del'] = function (a) { store.set('journal', journal().filter(function (e) { return e.id !== a.dataset.id; })); renderTab('journal'); };
ACT['jr-exp'] = function () {
  const txt = JSON.stringify({ app: 'radar-macro-fire', version: 1, exported_at: new Date().toISOString(), journal: journal() }, null, 1);
  $('#jr-io').value = txt; saveFile('journal-radar-macro-fire.json', 'application/json', txt);
};
function importJournal(txt) {
  const msg = $('#jr-msg');
  try {
    const o = JSON.parse(txt), arr = Array.isArray(o) ? o : o.journal; if (!Array.isArray(arr)) throw new Error('format');
    const cur = journal(), ids = {}; cur.forEach(function (e) { ids[e.id] = 1; }); let add = 0;
    arr.forEach(function (e) { if (e && e.id && e.note && !ids[e.id]) { cur.push({ id: String(e.id), ts: e.ts || new Date().toISOString(), regime: e.regime || null, bubble: e.bubble == null ? null : e.bubble, note: String(e.note) }); add++; } });
    cur.sort(function (a, b) { return a.ts < b.ts ? -1 : 1; }); store.set('journal', cur); renderTab('journal'); const m = $('#jr-msg'); if (m) m.textContent = t('jr.imported', { n: add });
  } catch (e) { msg.textContent = t('jr.badjson'); }
}
ACT['jr-imp'] = function () { importJournal($('#jr-io').value); };
ACT['jr-file'] = function (a) { const f = a.files && a.files[0]; if (!f) return; const r = new FileReader(); r.onload = function () { importJournal(String(r.result)); }; r.readAsText(f); };
ACT['al-copy'] = function () { copyText(CONFIG.DATA_BASE + 'alerts.xml'); };
ACT['al-open'] = function () { openNew(CONFIG.DATA_BASE + 'alerts.xml'); };

/* ============================================================================
   ONGLET 12 : MÉTHODE, ÉTAT DES DONNÉES, FAQ
   ========================================================================== */
RENDER.method = function () {
  const sp = spec(), s = sn(), F = fileStatus(), g = sp.growth, i = sp.inflation, th = sp.thresholds, B = sp.bubble, A = sp.allocation;
  const det = function (title, body, open) { return '<details' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><div class="bd">' + body + '</div></details>'; };
  const p = function (k, v) { return '<p>' + esc(t(k, v)) + '</p>'; };
  const dataBody = rtable([{ h: t('col.file') }, { h: t('strip.calc') }, { h: t('col.age'), n: 1 }, { h: t('col.state') }], F.map(function (f) { return [esc(f.file), esc(f.generated ? dtfmt(f.generated) : t('nd')), esc(f.generated ? ago(f.generated) : t('nd')), '<span class="dot ' + (f.missing && f.name !== 'snapshot' ? 'warn' : f.lv) + '"></span>' + esc(f.missing ? t('state.missing') : t('state.' + f.lv))]; })) +
    '<h3 style="margin-top:12px">' + esc(t('data.sources')) + '</h3>' + (s ? rtable([{ h: t('col.source') }, { h: t('col.state') }, { h: t('col.detail') }], Object.keys(s.sources).map(function (k) { const x = s.sources[k], c = { ok: 'g', repli: 'y', indisponible: 'r' }[x.status] || ''; return [esc(t('src.' + k)), '<span class="badge ' + c + '">' + esc(t('srcst.' + x.status)) + '</span>', esc(x.detail || '')]; })) : missing('snapshot')) +
    '<p class="mut">' + esc(t('data.spec', { s: t('spec.' + S.specSrc) })) + ' · ' + esc(t('data.base')) + ' ' + esc(CONFIG.DATA_BASE) + '</p>' + (Object.keys(S.err).length ? '<div class="note warn">' + esc(t('data.errs')) + ' : ' + esc(Object.keys(S.err).map(function (k) { return CONFIG.FILES[k] + ' (' + S.err[k] + ')'; }).join(', ')) + '</div>' : '') +
    '<p class="mut">' + esc(t('banner.age')) + '</p><div class="bar" style="justify-content:flex-start"><button type="button" class="btn" data-act="refresh">' + esc(t('refresh')) + '</button></div>';
  let h = '<div class="card"><h2>' + esc(t('me.title')) + '</h2><p class="mut">' + esc(t('me.d')) + '</p></div>';
  h += det(t('me.data'), dataBody, true);
  h += det(t('me.regime'), p('me.regime.1', { L: sp.windows.long, S: sp.windows.short }) + p('me.regime.2', { w12: g.spy12.weight, w6: g.spy6.weight, wh: g.hyg6.weight, wt: g.tlt_penalty.weight, cap: g.spy6.cap }) + p('me.regime.3', { a: i.gsg12.weight, b: i.gsg6.weight, c: i.breakeven6.weight }) + p('me.regime.4', { band: th.ambiguity_band }) + p('me.regime.5'));
  h += det(t('me.macro'), p('me.macro.1', { max: sp.confidence.macro_max_adjust }) + p('me.macro.2'));
  h += det(t('me.inertia'), p('me.inertia.1', { n: sp.inertia.required_days }) + p('me.inertia.2'));
  h += det(t('me.bubble'), p('me.bubble.1', { w: Object.keys(B.weights).map(function (k) { return t('pil.' + k) + ' ' + Math.round(B.weights[k] * 100); }).join(', '), tiers: B.tiers.join(', ') }) + p('me.bubble.2'));
  h += det(t('me.alloc'), p('me.alloc.1', { tilt: Math.round(A.tilt_per_tier * 100) }) + p('me.alloc.2', { r: A.action_thresholds.reinforce, o: A.action_thresholds.overweight, h: A.action_thresholds.hold, t: A.action_thresholds.trim }));
  h += det(t('me.bt'), p('me.bt.1') + p('me.bt.2', { c: sp.backtest.cost_bps_per_traded_notional }));
  h += det(t('me.src'), p('me.src.1') + p('me.src.2'));
  h += det(t('me.legal'), p('me.legal.1') + p('me.legal.2'));
  h += '<div class="card" style="margin-top:12px"><h2>' + esc(t('faq.title')) + '</h2>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return det(t('faq.' + n + '.q'), '<p>' + esc(t('faq.' + n + '.a')) + '</p>'); }).join('') + '</div>';
  return h;
};

/* ============================================================================
   DÉMARRAGE
   ========================================================================== */
(function init() {
  const l = store.get('lang', 'fr'); S.lang = I18N[l] ? l : 'fr';
  S.theme = store.get('theme', 'dark') === 'light' ? 'light' : 'dark';
  const tb = store.get('tab', 'radar'); S.tab = TABS.indexOf(tb) >= 0 ? tb : 'radar';
  S.spec = SPEC_FALLBACK;
  buildChrome(); renderStrip(); renderBanners(); renderTab(S.tab); loadAll();
  setInterval(function () { renderStrip(); renderBanners(); }, 60000);
  setInterval(function () { if (!document.hidden) loadAll(); }, CONFIG.AUTO_REFRESH_MS);
})();
