/* ============================================================================
   NOYAU : configuration, stockage, utilitaires, chargement des JSON, état des données
   ========================================================================== */
const CONFIG = Object.assign({
  // >>> À REMPLACER : URL publique GitHub Pages (branche data) qui sert les JSON, avec le "/" final.
  DATA_BASE: 'https://izilybourse.github.io/radar-macro-fire/',
  FILES: { snapshot: 'snapshot.json', state: 'state.json', history: 'history.json', cape: 'cape.json', backtest: 'backtest.json', transitions: 'transitions.json', spec: 'model_spec.json', health: 'health.json' },
  HOME_URL: 'https://izilyfire.fr',
  PLAY_URL: 'https://izilyfire.fr/izilyplay',
  COACH_URL: 'https://izilyfire.fr/services',
  PAGE_URL: 'https://izilyfire.fr/radar-macro-fire',
  // >>> À REMPLACER (optionnel) : formulaire d'inscription Brevo (https://sibforms.com/serve/...) ou lien d'inscription
  BREVO_FORM_URL: '',
  BREVO_SIGNUP_LINK: '',
  FETCH_TIMEOUT_MS: 12000,
  AUTO_REFRESH_MS: 600000
}, (typeof window !== 'undefined' && window.RMF_CONFIG) || {});

const TABS = ['radar', 'alloc', 'heat', 'sectors', 'backtest', 'history', 'wealth', 'compare', 'stress', 'game', 'journal', 'method'];
const RC = { goldilocks: '#22c55e', reflation: '#f59e0b', stagflation: '#ef4444', neutral: '#60a5fa' };
const AC = { reinforce: '#22c55e', overweight: '#84cc16', hold: '#A0A0A0', trim: '#f5b301', avoid: '#ef4444' };
const CLASS_COL = { actions: '#FF5500', obligations: '#60a5fa', or_matieres: '#f5b301', immobilier: '#a78bfa', cash: '#22c55e' };
const LOC = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE' };

const S = { lang: 'fr', theme: 'dark', tab: 'radar', data: {}, err: {}, spec: null, specSrc: 'repli', loadedAt: 0, loading: false, heat: { f: 'all', sort: 'weight' }, bt: { net: true, vt: true, spy: true, bands: true, win: 'full' }, patri: null, sheet: null, game: null, stressRes: null, rendered: {} };

/* ---------- Stockage local avec repli en mémoire (localStorage peut être bloqué) ---------- */
const store = (function () {
  let ok = true; const mem = {};
  try { const k = '__rmf_t'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); } catch (e) { ok = false; }
  return {
    ok: ok,
    get: function (k, d) { try { const v = ok ? window.localStorage.getItem('rmf_' + k) : mem[k]; return v == null ? d : JSON.parse(v); } catch (e) { return mem[k] !== undefined ? mem[k] : d; } },
    set: function (k, v) { try { if (ok) window.localStorage.setItem('rmf_' + k, JSON.stringify(v)); else mem[k] = JSON.stringify(v); } catch (e) { ok = false; mem[k] = JSON.stringify(v); } },
    del: function (k) { try { if (ok) window.localStorage.removeItem('rmf_' + k); } catch (e) { } delete mem[k]; }
  };
})();

/* ---------- Utilitaires ---------- */
const root = document.getElementById('rmf');
const $ = function (s, el) { return (el || root).querySelector(s); };
const $$ = function (s, el) { return Array.prototype.slice.call((el || root).querySelectorAll(s)); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function t(k, v) {
  let s = (I18N[S.lang] && I18N[S.lang][k]); if (s == null) s = I18N.fr[k]; if (s == null) return k;
  if (v) for (const x in v) s = s.split('{' + x + '}').join(v[x]);
  return s;
}
function has(k) { return !!(I18N[S.lang] && I18N[S.lang][k]) || !!I18N.fr[k]; }
function minus(s) { return s.replace(/^[-‐-‒]/, '−'); }
function nf(n, d, sign) {
  if (d == null) d = 1;
  if (n == null || !isFinite(n)) return t('nd');
  let s = minus(new Intl.NumberFormat(LOC[S.lang], { minimumFractionDigits: d, maximumFractionDigits: d }).format(n));
  return (sign && n > 0 ? '+' : '') + s;
}
function pc(n, d, sign) { return n == null || !isFinite(n) ? t('nd') : nf(n, d == null ? 1 : d, sign) + ' %'; }
function eur(n) { return n == null || !isFinite(n) ? t('nd') : minus(new Intl.NumberFormat(LOC[S.lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)); }
function dfmt(iso) { try { return new Intl.DateTimeFormat(LOC[S.lang], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)); } catch (e) { return iso || t('nd'); } }
function dtfmt(iso) { try { return new Intl.DateTimeFormat(LOC[S.lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return iso || t('nd'); } }
function ageH(iso) { return iso ? (Date.now() - Date.parse(iso)) / 36e5 : Infinity; }
function ago(iso) {
  const h = ageH(iso); if (!isFinite(h)) return t('nd');
  if (h < 1) return t('ago.m', { n: Math.max(1, Math.round(h * 60)) });
  if (h < 48) return t('ago.h', { n: Math.round(h) });
  return t('ago.d', { n: Math.round(h / 24) });
}
function spec() { return S.spec; }
function sn() { return S.data.snapshot; }
function regName(k) { return t('reg.' + k); }
function regBadge(k) { return '<span class="badge" style="color:' + RC[k] + ';border-color:' + RC[k] + '">' + esc(regName(k)) + '</span>'; }
function actBadge(a) { return '<span class="badge" style="color:' + AC[a] + ';border-color:' + AC[a] + '">' + esc(t('act.' + a)) + '</span>'; }
function numStr(n, d) { if (n == null || !isFinite(n)) return ''; return (S.lang === 'en' ? n.toFixed(d) : n.toFixed(d).replace('.', ',')); }
function parseNum(s) { if (typeof s === 'number') return s; if (s == null) return NaN; const x = parseFloat(String(s).replace(/\s| | /g, '').replace('€', '').replace(',', '.')); return x; }
function missing(name) { return '<div class="note bad">' + esc(t('missing.file', { f: CONFIG.FILES[name] })) + (S.err[name] ? ' (' + esc(S.err[name]) + ')' : '') + '</div>'; }
function rtable(cols, rows) {
  // tableau qui se transforme en cartes empilées sous 640 px (data-label sur chaque cellule)
  return '<table class="rt"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function (r) { return '<tr>' + r.map(function (cell, i) { return '<td class="' + (cols[i].n ? 'n' : '') + '" data-label="' + esc(cols[i].h) + '">' + cell + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
}
function axBar(v, max) {
  const w = Math.min(50, Math.abs(v) / max * 50), col = v >= 0 ? 'var(--ok)' : 'var(--ko)';
  return '<div class="ax"><i style="' + (v >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w + '%;background:' + col + '"></i></div>';
}
function heatCell(v, scale) {
  if (v == null) return '<span class="hm">' + t('nd') + '</span>';
  const a = Math.min(.65, Math.abs(v) / scale * .65), c = v >= 0 ? '34,197,94' : '239,68,68';
  return '<span class="hm" style="background:rgba(' + c + ',' + a.toFixed(2) + ')">' + pc(v, 1, true) + '</span>';
}

/* ---------- Toast, modale, copie, enregistrement de fichier (avec replis iframe sandboxée) ---------- */
let toastT;
function toast(msg) { const el = $('#rmf-toast'); el.textContent = msg; el.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(function () { el.style.display = 'none'; }, 2600); }
function modal(title, text) { $('#rmf-modal-t').textContent = title; const ta = $('#rmf-modal-ta'); ta.value = text; $('#rmf-modal').classList.add('on'); setTimeout(function () { ta.focus(); ta.select(); }, 30); }
function copyText(text, title) {
  const fb = function () {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; root.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) { toast(t('copied')); return; } } catch (e) { }
    modal(title || t('copy.manual'), text);
  };
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast(t('copied')); }, fb); return; } } catch (e) { }
  fb();
}
function saveFile(name, mime, text) {
  try {
    const b = new Blob([text], { type: mime + ';charset=utf-8' }), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; root.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000);
    toast(t('saved', { f: name }));
  } catch (e) { modal(name, text); }
}
function openUrl(url) {
  // navigation fiable : top si possible, sinon nouvel onglet, sinon copie du lien
  try { window.top.location.assign(url); return; } catch (e) { }
  try { const w = window.open(url, '_blank', 'noopener'); if (w) return; } catch (e) { }
  copyText(url, url);
}

/* ---------- Chargement des JSON (lecture seule, anti cache par l'heure) ---------- */
async function getJSON(name) {
  const url = CONFIG.DATA_BASE + CONFIG.FILES[name] + '?_=' + Date.now();
  const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const tm = setTimeout(function () { if (ctl) ctl.abort(); }, CONFIG.FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { ok: true, data: await r.json() };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; } finally { clearTimeout(tm); }
}
async function loadAll() {
  if (S.loading) return; S.loading = true; renderStrip();
  const names = Object.keys(CONFIG.FILES);
  const res = await Promise.all(names.map(getJSON));
  names.forEach(function (n, i) {
    if (res[i].ok && res[i].data) { S.data[n] = res[i].data; delete S.err[n]; } else { S.err[n] = res[i].error; if (!S.data[n]) S.data[n] = null; }
  });
  const sp = S.data.spec;
  if (sp && Array.isArray(sp.sectors) && Array.isArray(sp.regimes)) { S.spec = sp; S.specSrc = 'distant'; } else { S.spec = SPEC_FALLBACK; S.specSrc = 'repli'; }
  S.loading = false; S.loadedAt = Date.now(); S.rendered = {};
  renderStrip(); renderBanners(); renderTab(S.tab);
}

/* ---------- État des données : vert / jaune / rouge ---------- */
function usState(now) {
  // état de la séance US en heure de New York : 'session', 'week' (hors séance en semaine), 'weekend'
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now || new Date());
    const g = function (ty) { return p.filter(function (x) { return x.type === ty; })[0].value; };
    const wd = g('weekday'), m = (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10);
    if (wd === 'Sat' || wd === 'Sun') return 'weekend';
    if (wd === 'Mon' && m < 9 * 60 + 30) return 'weekend';
    return (m >= 9 * 60 + 30 && m <= 16 * 60 + 30) ? 'session' : 'week';
  } catch (e) { return 'week'; }
}
function lvl(age, thr) { const y = (spec().freshness || {}).yellow_factor || 2; return age <= thr ? 'ok' : (age <= thr * y ? 'warn' : 'bad'); }
function fileStatus() {
  const F = spec().freshness, out = [], us = usState();
  const sThr = us === 'session' ? F.snapshot_session_hours : (us === 'weekend' ? F.snapshot_weekend_hours : F.snapshot_offhours_hours);
  const defs = [['snapshot', sThr, 'h'], ['cape', F.cape_days * 24, 'd'], ['backtest', F.backtest_days * 24, 'd'], ['transitions', F.transitions_days * 24, 'd']];
  defs.forEach(function (d) {
    const j = S.data[d[0]], g = j && j.generated_at;
    let lv = 'bad';
    if (j && g) lv = lvl(ageH(g), d[1]); else if (j) lv = 'warn';
    if (!j && d[0] !== 'snapshot') lv = 'warn';
    out.push({ name: d[0], file: CONFIG.FILES[d[0]], generated: g, lv: lv, thr: d[1], unit: d[2], missing: !j });
  });
  return out;
}
function overall() {
  const f = fileStatus(), order = { ok: 0, warn: 1, bad: 2 }; let w = 'ok';
  f.forEach(function (x) { if (order[x.lv] > order[w]) w = x.lv; });
  const src = (sn() && sn().sources) || {};
  Object.keys(src).forEach(function (k) { if (src[k].status === 'indisponible' && w === 'ok') w = 'warn'; });
  if (sn() && sn().demo) w = 'warn';
  return w;
}
function renderStrip() {
  const el = $('#rmf-strip'), o = overall(), s = sn();
  el.innerHTML = '<span><span class="dot ' + o + '"></span>' + esc(t('strip.' + o)) + '</span>' +
    '<span>' + esc(t('strip.calc')) + ' : ' + esc(s ? dtfmt(s.generated_at) + ' (' + ago(s.generated_at) + ')' : t('nd')) + '</span>' +
    (s ? '<span>' + esc(t('strip.asof')) + ' : ' + esc(dfmt(s.asof)) + '</span>' : '') +
    '<button type="button" class="btn sm" data-act="refresh">' + (S.loading ? esc(t('loading')) : esc(t('refresh'))) + '</button>';
}
function renderBanners() {
  const b = []; const s = sn();
  if (!store.ok) b.push('<div class="note warn">' + esc(t('storage.blocked')) + '</div>');
  if (s && s.demo) b.push('<div class="note warn">' + esc(t('banner.demo')) + '</div>');
  if (!s) b.push('<div class="note bad">' + esc(t('banner.nosnap', { u: CONFIG.DATA_BASE })) + '</div>');
  fileStatus().forEach(function (f) { if (f.lv !== 'ok' && !f.missing) b.push('<div class="note ' + (f.lv === 'bad' ? 'bad' : 'warn') + '">' + esc(t('stale.' + f.name, { a: ago(f.generated) })) + '</div>'); });
  if (s && s.regime && s.regime.macro_override) b.push('<div class="note warn">' + esc(t('banner.override')) + '</div>');
  b.push('<div class="note">' + esc(t('banner.age')) + '</div>');
  $('#rmf-banners').innerHTML = b.join('');
}

/* ---------- Graphique Canvas natif (lignes, bandes, éventail, infobulle) ---------- */
function cssv(n) { return getComputedStyle(root).getPropertyValue(n).trim() || '#888'; }
function drawChart(cv, cfg) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 320, H = cfg.height || 300;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const m = { l: 44, r: 10, t: 10, b: 24 }, x = cfg.x, n = x.length, pw = W - m.l - m.r, ph = H - m.t - m.b;
  if (n < 2) return null;
  let lo = Infinity, hi = -Infinity;
  const eat = function (arr) { arr.forEach(function (v) { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); };
  cfg.series.forEach(function (s) { eat(s.data); }); (cfg.areas || []).forEach(function (a) { eat(a.lo); eat(a.hi); }); if (cfg.hline != null) { lo = Math.min(lo, cfg.hline); hi = Math.max(hi, cfg.hline); }
  if (!isFinite(lo)) return null; const pad = (hi - lo) * .06 || 1; lo -= pad; hi += pad; if (cfg.floor0) lo = Math.max(0, lo);
  const X = function (i) { return m.l + pw * i / (n - 1); }, Y = function (v) { return m.t + ph * (1 - (v - lo) / (hi - lo)); };
  const tx2 = cssv('--tx2'), bd = cssv('--bd');
  (cfg.bands || []).forEach(function (b) { g.fillStyle = b.color; const a = X(b.i0), z = X(b.i1); g.fillRect(a, m.t, Math.max(1, z - a), ph); });
  g.strokeStyle = bd; g.fillStyle = tx2; g.font = '11px Inter,sans-serif'; g.lineWidth = 1; g.textAlign = 'right';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g.beginPath(); g.moveTo(m.l, y); g.lineTo(W - m.r, y); g.stroke(); g.fillText((cfg.yFmt || function (q) { return Math.round(q); })(v), m.l - 5, y + 4); }
  g.textAlign = 'center'; const ticks = Math.max(2, Math.min(6, Math.floor(pw / 80)));
  for (let k = 0; k < ticks; k++) { const i = Math.round((n - 1) * k / (ticks - 1)); g.fillText(cfg.xFmt ? cfg.xFmt(x[i]) : x[i], Math.min(W - 18, Math.max(m.l + 12, X(i))), H - 6); }
  (cfg.areas || []).forEach(function (a) { g.fillStyle = a.color; g.beginPath(); for (let i = 0; i < n; i++) { const yy = Y(a.hi[i]); i ? g.lineTo(X(i), yy) : g.moveTo(X(i), yy); } for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Y(a.lo[i])); g.closePath(); g.fill(); });
  if (cfg.hline != null) { g.strokeStyle = cssv('--or'); g.setLineDash([6, 4]); g.beginPath(); g.moveTo(m.l, Y(cfg.hline)); g.lineTo(W - m.r, Y(cfg.hline)); g.stroke(); g.setLineDash([]); }
  cfg.series.forEach(function (s) {
    g.strokeStyle = s.color; g.lineWidth = s.w || 2; g.setLineDash(s.dash || []); g.beginPath(); let st = false;
    s.data.forEach(function (v, i) { if (v == null) { st = false; return; } st ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); st = true; }); g.stroke(); g.setLineDash([]);
  });
  return { X: X, Y: Y, m: m, W: W, H: H, n: n, pw: pw };
}
function attachTip(cv, tipEl, geo, cfg, snapshotFn) {
  const move = function (e) {
    const r = cv.getBoundingClientRect(), px = (e.clientX != null ? e.clientX : (e.touches && e.touches[0].clientX)) - r.left;
    let i = Math.round((px - geo.m.l) / geo.pw * (geo.n - 1)); i = Math.max(0, Math.min(geo.n - 1, i));
    drawChart(cv, cfg); const g = cv.getContext('2d'); g.strokeStyle = cssv('--tx2'); g.lineWidth = 1; g.beginPath(); g.moveTo(geo.X(i), geo.m.t); g.lineTo(geo.X(i), geo.H - geo.m.b); g.stroke();
    tipEl.innerHTML = snapshotFn(i); tipEl.style.display = 'block'; tipEl.style.left = Math.min(geo.W - 150, Math.max(4, geo.X(i) + 8)) + 'px'; tipEl.style.top = '8px';
  };
  cv.onpointermove = move; cv.onpointerdown = move; cv.onpointerleave = function () { tipEl.style.display = 'none'; drawChart(cv, cfg); };
}

/* ---------- Rendu : onglets, actions déléguées ---------- */
const RENDER = {};   // rempli par les modules d'onglets
const ACT = {};
function renderTab(k) {
  const p = $('#panel-' + k); if (!p || !RENDER[k]) return;
  try { p.innerHTML = RENDER[k](); if (RENDER[k + '_after']) RENDER[k + '_after'](p); S.rendered[k] = true; }
  catch (e) { p.innerHTML = '<div class="note bad">' + esc(t('render.error')) + ' (' + esc(e.message) + ')</div>'; if (window.console) console.error(e); }
}
function buildChrome() {
  $('#rmf-tabs').innerHTML = TABS.map(function (k) { return '<button type="button" role="tab" class="tab" id="tab-' + k + '" data-act="tab" data-k="' + k + '" aria-selected="' + (k === S.tab) + '">' + esc(t('tab.' + k)) + '</button>'; }).join('');
  $('#rmf-panels').innerHTML = TABS.map(function (k) { return '<section class="panel' + (k === S.tab ? ' on' : '') + '" id="panel-' + k + '" role="tabpanel"></section>'; }).join('');
  $$('[data-i]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i')); });
  $('#rmf-theme').textContent = S.theme === 'dark' ? t('theme.light') : t('theme.dark');
  root.setAttribute('data-theme', S.theme); root.setAttribute('lang', S.lang); $('#rmf-lang').value = S.lang;
}
function setTab(k) {
  S.tab = k; store.set('tab', k);
  $$('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.k === k)); });
  $$('.panel').forEach(function (p) { p.classList.toggle('on', p.id === 'panel-' + k); });
  renderTab(k);
}
function rerenderAll() { buildChrome(); renderStrip(); renderBanners(); S.rendered = {}; renderTab(S.tab); }

root.addEventListener('click', function (e) {
  const a = e.target.closest('[data-act]');
  if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a, e); return; }
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); openUrl({ home: CONFIG.HOME_URL, play: CONFIG.PLAY_URL, coach: CONFIG.COACH_URL }[go.dataset.go]); }
});
root.addEventListener('input', function (e) { const a = e.target.closest('[data-in]'); if (a && ACT[a.dataset.in]) ACT[a.dataset.in](a, e); });
root.addEventListener('change', function (e) { const a = e.target.closest('[data-ch]'); if (a && ACT[a.dataset.ch]) ACT[a.dataset.ch](a, e); });
$('#rmf-lang').addEventListener('change', function () { S.lang = this.value; store.set('lang', S.lang); rerenderAll(); });
ACT.tab = function (a) { setTab(a.dataset.k); };
ACT.theme = function () { S.theme = S.theme === 'dark' ? 'light' : 'dark'; store.set('theme', S.theme); rerenderAll(); };
ACT.refresh = function () { loadAll(); };
ACT['modal-close'] = function () { $('#rmf-modal').classList.remove('on'); };
window.addEventListener('resize', function () { if (RENDER[S.tab + '_resize']) RENDER[S.tab + '_resize'](); });
