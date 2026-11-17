#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Radar Macro FIRE : moteur de calcul unique (aucun serveur, aucune base de données).

Sous-commandes :
  snapshot  : prix + FRED -> régime, inertie, bulle, allocation  -> snapshot.json, state.json, history.json, alerts.xml, health.json
  cape      : CAPE de Shiller mensuel                            -> cape.json
  backtest  : backtest hebdomadaire + matrice de transition      -> backtest.json, transitions.json
  demo      : génère un jeu complet de JSON synthétiques (tests du widget, sans réseau)

Principe de robustesse : un fichier n'est remplacé que s'il passe la validation. En cas d'échec,
le dernier JSON valide reste en place et health.json explique pourquoi.
Seul ce script calcule. Le widget ne fait qu'afficher.
"""
import argparse
import io
import json
import math
import os
import sys
import time
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / "model_spec.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; RadarMacroFIRE/1.0; +https://izilyfire.fr)"}


# ----------------------------------------------------------------------------
# Utilitaires généraux
# ----------------------------------------------------------------------------
def log(*a):
    print("[radar]", *a, flush=True)


def warn(msg):
    # Annotation GitHub Actions visible dans l'interface du workflow
    print(f"::warning::{msg}", flush=True)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_spec():
    with open(SPEC_PATH, encoding="utf-8") as f:
        return json.load(f)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, obj, required=None):
    """Écriture atomique avec validation. Retourne False (et garde l'ancien fichier) si invalide."""
    try:
        if required:
            missing = [k for k in required if k not in obj]
            if missing:
                raise ValueError(f"clés manquantes: {missing}")
        txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        json.loads(txt)
        tmp = str(path) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(txt)
        os.replace(tmp, path)
        return True
    except Exception as e:
        warn(f"{Path(path).name} non écrit, ancien fichier conservé ({e})")
        return False


def clean(o):
    """Remplace NaN/inf par None et convertit les types numpy (JSON strict)."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else round(float(o), 6)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, dt.date)):
        return str(o)[:10]
    return o


def retry(fn, tries=3, base=2.0, label=""):
    """Nouvelle tentative avec backoff exponentiel."""
    last = None
    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa
            last = e
            wait = base ** k
            log(f"échec {label} ({e}); nouvelle tentative dans {wait:.0f}s")
            time.sleep(wait)
    raise last


def r(x, n=2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), n)


# ----------------------------------------------------------------------------
# Données de marché : Yahoo (principal), Stooq (repli)
# ----------------------------------------------------------------------------
def all_tickers(spec):
    t = []
    for grp in spec["tickers"].values():
        t += grp
    t += [s["ticker"] for s in spec["sectors"]]
    return sorted(set(t))


def fetch_yahoo(tickers, years):
    import yfinance as yf
    period = "max" if years >= 30 else f"{years}y"
    df = yf.download(tickers=tickers, period=period, interval="1d", auto_adjust=True,
                     progress=False, group_by="ticker", threads=True)
    out = {}
    for t in tickers:
        try:
            s = df[t]["Close"] if isinstance(df.columns, pd.MultiIndex) else df["Close"]
            s = s.dropna()
            if len(s) > 30:
                out[t] = s
        except Exception:
            pass
    return out


def stooq_symbol(t):
    if t == "^VIX":
        return "^vix"
    if t.startswith("^"):
        return None
    return t.lower().replace("-", ".") + ".us"


def fetch_stooq(t):
    sym = stooq_symbol(t)
    if not sym:
        raise ValueError("pas de symbole Stooq")
    resp = requests.get("https://stooq.com/q/d/l/", params={"s": sym, "i": "d"}, headers=UA, timeout=20)
    resp.raise_for_status()
    d = pd.read_csv(io.StringIO(resp.text))
    if "Date" not in d.columns or "Close" not in d.columns:
        raise ValueError("réponse Stooq inattendue")
    d["Date"] = pd.to_datetime(d["Date"])
    return d.set_index("Date")["Close"].astype(float).dropna()


def get_prices(tickers, years, critical):
    """Retourne (DataFrame des clôtures ajustées, statut par ticker, statut global)."""
    data, status = {}, {}
    try:
        data = retry(lambda: fetch_yahoo(tickers, years), label="yahoo")
    except Exception as e:
        warn(f"Yahoo indisponible: {e}")
    for t in tickers:
        if t in data:
            status[t] = "ok"
    for t in [t for t in tickers if t not in data]:
        try:
            data[t] = retry(lambda t=t: fetch_stooq(t), tries=2, label=f"stooq {t}")
            status[t] = "repli"
        except Exception:
            status[t] = "indisponible"
    px = pd.DataFrame({t: s for t, s in data.items()}).sort_index()
    px.index = pd.to_datetime(px.index).tz_localize(None)
    px = px[~px.index.duplicated(keep="last")].ffill(limit=3)
    miss = [t for t in critical if status.get(t) == "indisponible"]
    if miss:
        glob = "indisponible"
    elif any(v == "repli" for v in status.values()):
        glob = "repli"
    else:
        glob = "ok"
    return px, status, glob, miss


# ----------------------------------------------------------------------------
# FRED
# ----------------------------------------------------------------------------
def fred_obs(sid, key, days):
    start = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    resp = requests.get("https://api.stlouisfed.org/fred/series/observations",
                        params={"series_id": sid, "api_key": key, "file_type": "json",
                                "observation_start": start}, headers=UA, timeout=20)
    resp.raise_for_status()
    obs = resp.json()["observations"]
    s = pd.Series({pd.Timestamp(o["date"]): float(o["value"]) for o in obs if o["value"] not in (".", "")})
    if s.empty:
        raise ValueError(f"série {sid} vide")
    return s.sort_index()


def get_fred(spec, key):
    out, errs = {}, []
    if not key:
        return out, "indisponible", ["FRED_API_KEY absente"]
    for sid in spec["fred"]["series"]:
        try:
            out[sid] = retry(lambda sid=sid: fred_obs(sid, key, spec["fred"]["lookback_days"]), tries=3, label=f"fred {sid}")
        except Exception as e:
            errs.append(f"{sid}: {e}")
    if len(out) == len(spec["fred"]["series"]):
        return out, "ok", errs
    return out, ("repli" if len(out) >= 5 else "indisponible"), errs


def sgn(x, band):
    return 0 if x is None or abs(x) < band else (1 if x > 0 else -1)


def clip(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def macro_scores(fred, spec):
    """Scores macro réels normalisés [-1, 1] pour la croissance (Gm) et l'inflation (Im)."""
    if not fred:
        return None
    F, sc = spec["fred"], spec["fred"]["scales"]
    info, g_parts, i_parts = {}, {}, {}

    def last(sid):
        s = fred.get(sid)
        return (s.iloc[-1], s.index[-1]) if s is not None and len(s) else (None, None)

    def yoy(s):
        ref = s.asof(s.index[-1] - pd.Timedelta(days=365))
        return s.iloc[-1] / ref - 1 if pd.notna(ref) and ref else None

    for sid in F["series"]:
        v, d = last(sid)
        if v is not None:
            prev = fred[sid].iloc[-2] if len(fred[sid]) > 1 else None
            info[sid] = {"value": r(v, 3), "date": str(d)[:10], "prev": r(prev, 3) if prev is not None else None}
    if "INDPRO" in fred:
        y = yoy(fred["INDPRO"])
        if y is not None:
            info["INDPRO"]["yoy"] = r(y * 100, 2); g_parts["INDPRO"] = clip(y / sc["indpro_yoy"])
    if "PAYEMS" in fred:
        y = yoy(fred["PAYEMS"])
        if y is not None:
            info["PAYEMS"]["yoy"] = r(y * 100, 2); g_parts["PAYEMS"] = clip((y - sc["payems_yoy_center"]) / sc["payems_yoy_scale"])
    if "GDPNOW" in fred:
        v = fred["GDPNOW"].iloc[-1]
        g_parts["GDPNOW"] = clip((v - sc["gdpnow_center"]) / sc["gdpnow_scale"])
    if "ICSA" in fred:
        s = fred["ICSA"]
        a4, m52 = s.iloc[-4:].mean(), s.iloc[-52:].mean()
        info["ICSA"]["avg4"] = r(a4, 0)
        g_parts["ICSA"] = clip(-(a4 / m52 - 1) / sc["icsa_scale"])
    if "BAMLH0A0HYM2" in fred:
        g_parts["BAMLH0A0HYM2"] = clip((sc["hy_center"] - fred["BAMLH0A0HYM2"].iloc[-1]) / sc["hy_scale"])
    if "T10Y2Y" in fred:
        g_parts["T10Y2Y"] = clip(fred["T10Y2Y"].iloc[-1] / sc["curve_scale"])
    if "CPIAUCSL" in fred:
        s = fred["CPIAUCSL"]
        y = yoy(s)
        if y is not None:
            info["CPIAUCSL"]["yoy"] = r(y * 100, 2)
            i_parts["cpi_yoy"] = clip((y - sc["cpi_center"]) / sc["cpi_yoy_scale"])
        if len(s) > 3:
            ann = (s.iloc[-1] / s.iloc[-4]) ** 4 - 1
            info["CPIAUCSL"]["ann3m"] = r(ann * 100, 2)
            i_parts["cpi_3m"] = clip((ann - sc["cpi_center"]) / sc["cpi_3m_scale"])
    if not g_parts or not i_parts:
        return None
    gw, iw = F["growth_weights"], F["inflation_weights"]
    Gm = sum(gw[k] * v for k, v in g_parts.items()) / sum(gw[k] for k in g_parts)
    Im = sum(iw[k] * v for k, v in i_parts.items()) / sum(iw[k] for k in i_parts)
    return {"growth_score": Gm, "inflation_score": Im, "series": info,
            "parts": {"growth": {k: r(v, 3) for k, v in g_parts.items()}, "inflation": {k: r(v, 3) for k, v in i_parts.items()}}}


# ----------------------------------------------------------------------------
# Modèle de régime
# ----------------------------------------------------------------------------
def pct(s, n):
    return s / s.shift(n) - 1


def components(px, spec):
    L, S = spec["windows"]["long"], spec["windows"]["short"]
    c = pd.DataFrame(index=px.index)
    c["spy12"], c["spy6"] = pct(px["SPY"], L), pct(px["SPY"], S)
    c["hyg6"], c["tlt6"] = pct(px["HYG"], S), pct(px["TLT"], S)
    c["gsg12"], c["gsg6"] = pct(px["GSG"], L), pct(px["GSG"], S)
    c["be6"] = pct(px["TIP"], S) - pct(px["IEF"], S)
    return c


def axis_scores(c, spec):
    """G (croissance) et I (inflation) sur [-100, +100] pour chaque date."""
    g, i = spec["growth"], spec["inflation"]
    s12 = (c["spy12"] / g["spy12"]["scale"]).clip(-1, 1)
    s6 = (c["spy6"] / g["spy6"]["scale"]).clip(-g["spy6"]["cap"], g["spy6"]["cap"])
    sh = (c["hyg6"] / g["hyg6"]["scale"]).clip(-1, 1)
    pen = (-c["tlt6"] / g["tlt_penalty"]["scale"]).clip(0, 1)
    wsum = g["spy12"]["weight"] + g["spy6"]["weight"] + g["hyg6"]["weight"] + g["tlt_penalty"]["weight"]
    G = 100 * (g["spy12"]["weight"] * s12 + g["spy6"]["weight"] * s6 + g["hyg6"]["weight"] * sh
               - g["tlt_penalty"]["weight"] * pen) / wsum
    c12 = (c["gsg12"] / i["gsg12"]["scale"]).clip(-1, 1)
    c6 = (c["gsg6"] / i["gsg6"]["scale"]).clip(-1, 1)
    cb = (c["be6"] / i["breakeven6"]["scale"]).clip(-1, 1)
    isum = i["gsg12"]["weight"] + i["gsg6"]["weight"] + i["breakeven6"]["weight"]
    I = 100 * (i["gsg12"]["weight"] * c12 + i["gsg6"]["weight"] * c6 + i["breakeven6"]["weight"] * cb) / isum
    return G, I


def quadrant(G, I):
    if G >= 0:
        return "reflation" if I >= 0 else "goldilocks"
    return "stagflation" if I >= 0 else "neutral"


def classify(G, I, spec):
    """Régime brut, zone ambiguë éventuelle et mélange d'allocation associé."""
    band = spec["thresholds"]["ambiguity_band"]
    raw = quadrant(G, I)
    zone, blend = "none", None
    if abs(G) <= band and abs(I) <= band and raw in ("goldilocks", "stagflation"):
        zone, blend = "gold_stag", ["goldilocks", "stagflation"]
    elif abs(G) <= band and I > band and raw in ("reflation", "stagflation"):
        zone, blend = "stag_refl", ["stagflation", "reflation"]
    return raw, zone, blend


def confidence(G, I, ambiguous, spec, macro_adj):
    c = spec["confidence"]
    base = clip(c["base"] + c["slope"] * min(abs(G), abs(I)), c["min"], c["max"])
    if ambiguous:
        base -= c["ambiguity_penalty"]
    return clip(base + macro_adj, c["floor"], c["ceiling"]), base


def macro_check(G, I, raw, macro, spec):
    """Ajustement de fiabilité (+/- 8 points) et bascule si désaccord total sur les deux axes."""
    if not macro:
        return {"available": False, "adjust": 0, "override": False, "agreement": None}
    nb = spec["fred"]["neutral_band"]
    Gm, Im = macro["growth_score"], macro["inflation_score"]
    ag, ai = sgn(Gm, nb) * sgn(G, 1e-9), sgn(Im, nb) * sgn(I, 1e-9)
    half = spec["confidence"]["macro_max_adjust"] / 2
    adjust = half * ag + half * ai
    mo = spec["fred"]["min_abs_for_override"]
    override = ag == -1 and ai == -1 and abs(Gm) >= mo and abs(Im) >= mo
    new_raw = quadrant(Gm, Im) if override else raw
    return {"available": True, "adjust": adjust, "override": override, "raw": new_raw,
            "agreement": {"growth": ag, "inflation": ai}, "Gm": r(Gm * 100, 1), "Im": r(Im * 100, 1)}


def step_inertia(state, raw, required):
    """Avance l'inertie d'un jour de bourse. Retourne (state, regime_precedent_si_changement)."""
    cur, cand, cnt = state["current"], state.get("candidate"), state.get("counter", 0)
    prev = None
    if raw == cur:
        cand, cnt = None, 0
    elif raw == cand:
        cnt += 1
        if cnt >= required:
            prev, cur, cand, cnt = cur, raw, None, 0
    else:
        cand, cnt = raw, 1
        if required <= 1:
            prev, cur, cand, cnt = cur, raw, None, 0
    state.update({"current": cur, "candidate": cand, "counter": cnt})
    return state, prev


def replay(raw_series, required):
    """Rejoue l'inertie sur tout l'historique. Retourne (série confirmée, état final, liste des changements)."""
    vals = list(raw_series.values)
    idx = list(raw_series.index)
    state = {"current": vals[0], "candidate": None, "counter": 0}
    conf, changes = [], []
    for k, v in enumerate(vals):
        state, prev = step_inertia(state, v, required)
        if prev:
            changes.append({"date": str(idx[k])[:10], "from": prev, "to": state["current"]})
        conf.append(state["current"])
    return pd.Series(conf, index=raw_series.index), state, changes


# ----------------------------------------------------------------------------
# Indice de bulle
# ----------------------------------------------------------------------------
def c01(x):
    return clip(x, 0.0, 1.0)


def bubble_index(px, fred, cape, spec):
    B, W = spec["bubble"], spec["bubble"]["weights"]
    sectors = [s["ticker"] for s in spec["sectors"]]
    pillars = []

    # 1. Valorisation : CAPE de Shiller, repli proxy marqué
    v = B["valuation"]
    if cape and cape.get("value"):
        sc = c01((cape["value"] - v["cape_low"]) / (v["cape_high"] - v["cape_low"]))
        pillars.append({"key": "valuation", "score": sc * 100, "value": r(cape["value"], 1), "unit": "CAPE",
                        "source": "Shiller CAPE", "proxy": False, "date": cape.get("date")})
    else:
        ratio = px["SPY"].iloc[-1] / px["SPY"].iloc[-spec["windows"]["cape_proxy"]:].mean()
        sc = c01((ratio - 1) / v["proxy_scale"])
        pillars.append({"key": "valuation", "score": sc * 100, "value": r((ratio - 1) * 100, 1), "unit": "% vs moyenne 4 ans SPY",
                        "source": "Proxy : SPY vs moyenne mobile 1000 jours", "proxy": True, "date": None})

    # 2. Euphorie : VIX bas et breadth des 11 secteurs au-dessus de leur MM50
    e = B["euphoria"]
    ma = spec["windows"]["ma_short"]
    above = [px[t].iloc[-1] > px[t].iloc[-ma:].mean() for t in sectors if t in px and px[t].notna().sum() > ma]
    breadth = sum(above) / len(above) if above else None
    parts, vix = [], None
    if "^VIX" in px and px["^VIX"].notna().any():
        vix = float(px["^VIX"].dropna().iloc[-1])
        parts.append(c01((e["vix_stress"] - vix) / (e["vix_stress"] - e["vix_calm"])))
    if breadth is not None:
        parts.append(c01((breadth - e["breadth_low"]) / (e["breadth_high"] - e["breadth_low"])))
    proxy = vix is None or breadth is None
    pillars.append({"key": "euphoria", "score": (sum(parts) / len(parts) * 100) if parts else 50.0,
                    "value": r(vix, 1) if vix is not None else None, "unit": "VIX",
                    "extra": {"breadth_pct": r(breadth * 100, 0) if breadth is not None else None},
                    "source": "VIX (Yahoo) + breadth 11 secteurs au dessus de leur MM50" + (" (partiel)" if proxy else ""),
                    "proxy": proxy, "date": None})

    # 3. Endettement : spread HY (FRED), repli proxy HYG
    d = B["debt"]
    if fred and "BAMLH0A0HYM2" in fred:
        hy = float(fred["BAMLH0A0HYM2"].iloc[-1])
        sc = c01((d["hy_wide"] - hy) / (d["hy_wide"] - d["hy_tight"]))
        pillars.append({"key": "debt", "score": sc * 100, "value": r(hy, 2), "unit": "% spread HY",
                        "source": "FRED BAMLH0A0HYM2", "proxy": False, "date": str(fred["BAMLH0A0HYM2"].index[-1])[:10]})
    else:
        dd = px["HYG"].iloc[-1] / px["HYG"].iloc[-spec["windows"]["long"]:].max() - 1
        sc = c01(1 - abs(dd) / d["proxy_dd_scale"])
        pillars.append({"key": "debt", "score": sc * 100, "value": r(dd * 100, 2), "unit": "% HYG vs plus haut 12M",
                        "source": "Proxy : HYG vs son plus haut 12 mois", "proxy": True, "date": None})

    # 4. Liquidité : pente T10Y2Y + nuance directionnelle, repli ^TNX moins ^IRX
    q = B["liquidity"]
    slope, hist, proxy = None, None, False
    if fred and "T10Y2Y" in fred:
        s = fred["T10Y2Y"]
        slope, hist, src = float(s.iloc[-1]), s, "FRED T10Y2Y"
    elif "^TNX" in px and "^IRX" in px:
        s = (px["^TNX"] - px["^IRX"]).dropna()
        if len(s):
            slope, hist, src, proxy = float(s.iloc[-1]), s, "Proxy : ^TNX moins ^IRX (Yahoo)", True
    if slope is None:
        pillars.append({"key": "liquidity", "score": 50.0, "value": None, "unit": "pente", "source": "Indisponible, valeur neutre", "proxy": True, "date": None})
    else:
        sc = c01((q["slope_tight"] - slope) / (q["slope_tight"] - q["slope_flat"])) * 100
        w = q["direction_window"]
        move = float(hist.iloc[-1] - hist.iloc[-w]) if len(hist) > w else 0.0
        nuance = 0
        if move >= q["direction_move"] and slope < 0.5:
            nuance = q["bonus_resteepen"]
        elif move <= -q["direction_move"] and slope > 0:
            nuance = q["bonus_flatten"]
        pillars.append({"key": "liquidity", "score": clip(sc + nuance, 0, 100), "value": r(slope, 2), "unit": "pente 10A moins 2A",
                        "extra": {"move_3m": r(move, 2), "nuance": nuance}, "source": src, "proxy": proxy, "date": None})

    # 5. Concentration : QQQ/VTI et SPY/RSP vs moyenne 252 jours
    c = B["concentration"]
    m = spec["windows"]["concentration_mean"]
    vals, details = [], {}
    for a, b, nm in (("QQQ", "VTI", "qqq_vti"), ("SPY", "RSP", "spy_rsp")):
        if a in px and b in px:
            ratio = (px[a] / px[b]).dropna()
            if len(ratio) > m:
                dev = ratio.iloc[-1] / ratio.iloc[-m:].mean() - 1
                details[nm] = r(dev * 100, 2)
                vals.append(c01(dev / c["scale"]))
    pillars.append({"key": "concentration", "score": (sum(vals) / len(vals) * 100) if vals else 50.0,
                    "value": details.get("spy_rsp"), "unit": "% SPY/RSP vs moy. 12M", "extra": details,
                    "source": "Yahoo : QQQ/VTI et SPY/RSP", "proxy": len(vals) < 2, "date": None})

    total = 0.0
    for p in pillars:
        p["weight"] = W[p["key"]]
        p["score"] = r(p["score"], 1)
        total += W[p["key"]] * p["score"]
    tiers = B["tiers"]
    tier = sum(total >= t for t in tiers)
    return {"score": r(total, 1), "tier": tier, "tier_thresholds": tiers, "pillars": pillars}


# ----------------------------------------------------------------------------
# Allocation sectorielle
# ----------------------------------------------------------------------------
def allocate(regime, blend, tier_eff, spec):
    A = spec["allocation"]
    sectors = spec["sectors"]
    if blend:
        p = A["blend_primary"]
        base = {s["key"]: p * s["base"][blend[0]] + (1 - p) * s["base"][blend[1]] for s in sectors}
    else:
        base = {s["key"]: float(s["base"][regime]) for s in sectors}
    t = A["tilt_per_tier"] * tier_eff
    w = {}
    for s in sectors:
        f = 1.0
        if s["kind"] == "defensive":
            f = 1 + t
        elif s["beta"] == "high":
            f = max(0.0, 1 - t)
        w[s["key"]] = base[s["key"]] * f
    tot = sum(w.values())
    return {k: 100 * v / tot for k, v in w.items()}, base


def action_label(w, spec):
    a = spec["allocation"]["action_thresholds"]
    if w >= a["reinforce"]:
        return "reinforce"
    if w >= a["overweight"]:
        return "overweight"
    if w >= a["hold"]:
        return "hold"
    if w >= a["trim"]:
        return "trim"
    return "avoid"


def sector_table(px, weights, base, spec):
    W = spec["windows"]
    spy3 = pct(px["SPY"], W["momentum_3m"]).iloc[-1]
    rows = []
    for s in spec["sectors"]:
        t, p = s["ticker"], px[s["ticker"]].dropna() if s["ticker"] in px else pd.Series(dtype=float)
        if len(p) < W["ma_long"]:
            rows.append({"key": s["key"], "ticker": t, "kind": s["kind"], "weight": r(weights[s["key"]], 2),
                         "base_weight": r(base[s["key"]], 2), "action": action_label(weights[s["key"]], spec), "price": None})
            continue
        last = p.iloc[-1]
        hi, lo = p.iloc[-W["range_6m"]:].max(), p.iloc[-W["range_6m"]:].min()
        pos = (last - lo) / (hi - lo) if hi > lo else 0.5
        rl = spec["allocation"]["range_labels"]
        m1, m3, m6 = (last / p.iloc[-1 - W[k]] - 1 for k in ("momentum_1m", "momentum_3m", "range_6m"))
        rows.append({
            "key": s["key"], "ticker": t, "kind": s["kind"], "beta": s["beta"],
            "weight": r(weights[s["key"]], 2), "base_weight": r(base[s["key"]], 2),
            "action": action_label(weights[s["key"]], spec), "price": r(last, 2),
            "mom_1m": r(m1 * 100, 2), "mom_3m": r(m3 * 100, 2), "mom_6m": r(m6 * 100, 2),
            "rel_strength_3m": r((m3 - spy3) * 100, 2),
            "vs_ma50": r((last / p.iloc[-W["ma_short"]:].mean() - 1) * 100, 2),
            "vs_ma200": r((last / p.iloc[-W["ma_long"]:].mean() - 1) * 100, 2),
            "range_pos": r(pos, 3), "range_label": "low" if pos < rl["low"] else ("high" if pos > rl["high"] else "mid"),
        })
    rows.sort(key=lambda x: (-(x["weight"] or 0), -(x.get("mom_3m") or 0)))
    for k, row in enumerate(rows, 1):
        row["rank"] = k
    return rows


def asset_class_target(regime, blend, tier_eff, spec):
    AC = spec["asset_classes"]
    tg = {k: float(AC["targets"][regime][k]) for k in AC["keys"]}
    if blend:
        a, b = blend
        tg = {k: 0.5 * AC["targets"][a][k] + 0.5 * AC["targets"][b][k] for k in AC["keys"]}
    shift = min(tg["actions"], AC["equity_to_cash_per_tier"] * tier_eff)
    tg["actions"] -= shift
    tg["cash"] += shift
    return {k: r(v, 1) for k, v in tg.items()}


def history_perf(history, px, spec):
    """Durée écoulée et performance depuis chaque changement : SPY et portefeuille à poids figés."""
    out = []
    last_date = px.index[-1]
    for h in history[-12:]:
        d = pd.Timestamp(h["date"])
        row = {"date": h["date"], "from": h["from"], "to": h["to"], "days": int((last_date - d).days),
               "spy": None, "portfolio": None}
        if d >= px.index[0] and d <= last_date:
            try:
                row["spy"] = r((px["SPY"].iloc[-1] / px["SPY"].asof(d) - 1) * 100, 2)
                rets = []
                for s in spec["sectors"]:
                    rets.append(s["base"][h["to"]] / 100.0 * (px[s["ticker"]].iloc[-1] / px[s["ticker"]].asof(d) - 1))
                row["portfolio"] = r(sum(rets) * 100, 2)
            except Exception:
                pass
        out.append(row)
    return out


# ----------------------------------------------------------------------------
# Alertes : flux Atom (aucun e-mail)
# ----------------------------------------------------------------------------
REGIME_FR = {"goldilocks": "Goldilocks", "reflation": "Reflation", "stagflation": "Stagflation", "neutral": "Neutre"}


def write_atom(path, history, base_url):
    entries = [h for h in history if not h.get("bootstrap")][-20:][::-1]
    upd = entries[0]["ts"] if entries else now_iso()
    items = []
    for h in entries:
        title = f"Changement de régime confirmé : {REGIME_FR[h['from']]} vers {REGIME_FR[h['to']]}"
        body = (f"Le Radar Macro FIRE confirme un nouveau régime ({REGIME_FR[h['to']]}) depuis le {h['date']}. "
                f"Indice de bulle {h.get('bubble')} sur 100. Outil pédagogique, pas un conseil en investissement.")
        items.append(f"<entry><id>tag:izilyfire.fr,{h['date']}:regime-{h['to']}</id><title>{title}</title>"
                     f"<updated>{h['ts']}</updated><link href=\"{base_url}\"/><content type=\"text\">{body}</content></entry>")
    xml = ("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">"
           "<title>Radar Macro FIRE : changements de régime</title><id>tag:izilyfire.fr,2026:radar-macro-fire</id>"
           f"<updated>{upd}</updated><link rel=\"self\" href=\"{base_url}alerts.xml\"/>" + "".join(items) + "</feed>")
    Path(path).write_text(xml, encoding="utf-8")


# ----------------------------------------------------------------------------
# Génération de données de démonstration (aucun réseau)
# ----------------------------------------------------------------------------
DEMO_REG = {
    #            goldilocks refl  stag  neutral  (dérive annuelle), volatilité, bêta
    "SPY": ([0.16, 0.10, -0.08, -0.04], 0.15), "VTI": ([0.16, 0.10, -0.08, -0.04], 0.15),
    "RSP": ([0.14, 0.11, -0.05, -0.03], 0.15), "QQQ": ([0.22, 0.10, -0.14, -0.05], 0.20),
    "VT": ([0.14, 0.10, -0.06, -0.03], 0.14),
    "HYG": ([0.07, 0.06, -0.03, -0.02], 0.06), "TLT": ([0.03, -0.06, -0.05, 0.10], 0.13),
    "IEF": ([0.03, -0.02, -0.01, 0.06], 0.06), "TIP": ([0.03, 0.03, 0.05, 0.05], 0.05),
    "GSG": ([-0.04, 0.18, 0.15, -0.15], 0.22), "GLD": ([0.02, 0.08, 0.14, 0.06], 0.15), "DBC": ([-0.03, 0.16, 0.12, -0.12], 0.18),
    "XLK": ([0.24, 0.10, -0.14, -0.04], 0.21), "XLC": ([0.18, 0.06, -0.10, -0.03], 0.19), "XLY": ([0.20, 0.08, -0.14, -0.06], 0.20),
    "XLF": ([0.16, 0.14, -0.10, -0.08], 0.20), "XLI": ([0.16, 0.12, -0.08, -0.06], 0.17), "XLB": ([0.12, 0.16, -0.02, -0.08], 0.19),
    "XLE": ([0.04, 0.22, 0.12, -0.10], 0.26), "XLV": ([0.08, 0.06, 0.04, 0.04], 0.13), "XLP": ([0.06, 0.04, 0.05, 0.05], 0.11),
    "XLU": ([0.05, 0.02, 0.04, 0.06], 0.14), "XLRE": ([0.10, 0.04, 0.00, 0.03], 0.17),
}


def demo_prices(spec, years=22, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=int(years * 252))
    n = len(idx)
    reg = np.zeros(n, dtype=int)
    for k in range(1, n):
        reg[k] = rng.integers(0, 4) if rng.random() < 1 / 170 else reg[k - 1]
    mkt = rng.standard_normal(n)
    out = {}
    tickers = all_tickers(spec) + ["GLD", "DBC", "VT"]
    for t in sorted(set(tickers)):
        if t in ("^VIX", "^TNX", "^IRX"):
            continue
        d, vol = DEMO_REG[t]
        drift = 2.0 * np.array(d)[reg] / 252  # dérives amplifiées pour que la démo reste lisible
        corr = 0.2 if t in ("TLT", "IEF", "TIP", "GSG", "GLD", "DBC") else 0.8
        shock = corr * mkt + math.sqrt(1 - corr ** 2) * rng.standard_normal(n)
        ret = drift + vol / math.sqrt(252) * shock
        out[t] = pd.Series(100 * np.cumprod(1 + ret), index=idx)
    spy = out["SPY"]
    dd = (-spy.pct_change(21)).clip(lower=0).fillna(0)
    out["^VIX"] = (14 + 120 * dd + rng.standard_normal(n).cumsum() * 0.05).clip(10, 60).rolling(3, min_periods=1).mean()
    out["^TNX"] = (3.0 + 0.4 * rng.standard_normal(n).cumsum() / 30).clip(0.8, 6)
    out["^IRX"] = (2.0 + 0.4 * rng.standard_normal(n).cumsum() / 30).clip(0.1, 6)
    px = pd.DataFrame(out).sort_index()
    status = {t: "ok" for t in px.columns}
    return px, status


def demo_fred():
    end = pd.Timestamp.today().normalize()
    def mon(n, v0, step, noise=0.0):
        idx = pd.date_range(end=end, periods=n, freq="MS")
        return pd.Series(v0 + step * np.arange(n), index=idx)
    return {
        "CPIAUCSL": mon(40, 300, 0.7), "INDPRO": mon(40, 102, 0.1), "PAYEMS": mon(40, 158000, 90),
        "GDPNOW": pd.Series([2.1], index=[end]),
        "ICSA": pd.Series(np.linspace(225000, 232000, 60), index=pd.date_range(end=end, periods=60, freq="W")),
        "BAMLH0A0HYM2": pd.Series([3.4], index=[end]), "T10Y2Y": pd.Series(np.linspace(0.1, 0.4, 70), index=pd.bdate_range(end=end, periods=70)),
        "DGS10": pd.Series([4.2], index=[end]), "DGS2": pd.Series([3.9], index=[end]),
    }


# ----------------------------------------------------------------------------
# Commande : snapshot
# ----------------------------------------------------------------------------
def regime_series(px, spec):
    c = components(px, spec)
    G, I = axis_scores(c, spec)
    ok = G.notna() & I.notna()
    raw = pd.Series([quadrant(g, i) for g, i in zip(G[ok], I[ok])], index=G[ok].index)
    return c, G, I, raw


def source_block(status, detail=""):
    return {"status": status, "detail": detail}


def cmd_snapshot(args):
    spec = load_spec()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    mode = "demo" if args.demo else args.mode
    health = {"schema": 1, "generated_at": now_iso(), "run_mode": mode, "ok": False, "error": None}
    critical = spec["tickers"]["growth"] + ["GSG", "TIP", "IEF"] + [s["ticker"] for s in spec["sectors"]]

    if args.demo:
        px, pstat = demo_prices(spec)
        pglob, miss = "ok", []
        fred, fglob, ferrs = demo_fred(), "ok", []
    else:
        px, pstat, pglob, miss = get_prices(all_tickers(spec), 6, critical)
        fred, fglob, ferrs = get_fred(spec, os.getenv("FRED_API_KEY"))
        if fglob != "ok":
            warn(f"FRED {fglob}: {ferrs[:3]}")
    if miss:
        health["error"] = f"prix critiques indisponibles: {miss}"
        write_json(out / "health.json", health)
        warn(health["error"] + " : snapshot.json conservé")
        return 0

    c, G, I, raw_s = regime_series(px, spec)
    if raw_s.empty:
        health["error"] = "historique insuffisant"
        write_json(out / "health.json", health)
        return 0
    last_bar = str(px.index[-1])[:10]
    req = spec["inertia"]["required_days"]

    # état et historique : amorçage par rejeu si absents
    state = read_json(out / "state.json")
    history = read_json(out / "history.json", {"schema": 1, "entries": []})
    entries = history.get("entries", [])
    if not state:
        conf, st, ch = replay(raw_s, req)
        since = ch[-1]["date"] if ch else str(raw_s.index[0])[:10]
        state = {"schema": 1, "current": st["current"], "candidate": st["candidate"], "counter": st["counter"],
                 "since": since, "last_bar_date": last_bar, "bootstrap": True}
        entries = []
        for h in ch:
            d = pd.Timestamp(h["date"])
            entries.append({"date": h["date"], "from": h["from"], "to": h["to"], "ts": f"{h['date']}T22:00:00Z",
                            "spy": r(px["SPY"].asof(d), 2), "G": r(G.asof(d), 1), "I": r(I.asof(d), 1),
                            "bubble": None, "bootstrap": True})
        log(f"amorçage de l'état par rejeu : {len(entries)} changements, régime {state['current']}")

    # signal du jour (G, I, ambiguïté, confirmation macro)
    g_now, i_now = float(G.iloc[-1]), float(I.iloc[-1])
    raw, zone, blend = classify(g_now, i_now, spec)
    macro = macro_scores(fred, spec) if fglob != "indisponible" else None
    mc = macro_check(g_now, i_now, raw, macro, spec)
    if mc["override"]:
        raw = mc["raw"]
        zone, blend = "none", None
    ambiguous = zone != "none"
    conf_final, conf_mkt = confidence(g_now, i_now, ambiguous, spec, mc["adjust"])

    # indice de bulle
    cape = read_json(out / "cape.json")
    bub = bubble_index(px, fred if fglob != "indisponible" else None, cape, spec)

    # inertie : n'avance qu'une fois par jour de bourse, à l'exécution de clôture
    changed_entry = None
    if mode == "close" and last_bar > state.get("last_bar_date", ""):
        prev_state = dict(state)
        state, prev = step_inertia(state, raw, req)
        state["last_bar_date"] = last_bar
        if prev:
            state["since"] = last_bar
            changed_entry = {"date": last_bar, "from": prev, "to": state["current"], "ts": now_iso(),
                             "spy": r(px["SPY"].iloc[-1], 2), "G": r(g_now, 1), "I": r(i_now, 1),
                             "bubble": bub["score"], "bootstrap": False}
            entries.append(changed_entry)
            log(f"CHANGEMENT DE RÉGIME CONFIRMÉ : {prev} -> {state['current']}")

    cur = state["current"]
    use_amb = ambiguous and raw == cur
    tier_eff = bub["tier"] + (spec["allocation"]["ambiguity_extra_tiers"] if use_amb else 0)
    weights, base = allocate(cur, blend if use_amb else None, tier_eff, spec)
    rows = sector_table(px, weights, base, spec)

    dist_axis = "G" if abs(g_now) <= abs(i_now) else "I"
    since_d = pd.Timestamp(state.get("since", last_bar))
    snap = {
        "schema": 1, "generated_at": now_iso(), "run_mode": mode, "demo": bool(args.demo), "asof": last_bar,
        "spec_version": spec["version"],
        "sources": {
            "prices": source_block(pglob, "Yahoo Finance, repli Stooq" + (f", manquants {miss}" if miss else "")),
            "fred": source_block(fglob, "; ".join(ferrs[:3])),
            "cape": source_block((cape or {}).get("status", "indisponible"), (cape or {}).get("source", "")),
        },
        "regime": {
            "key": cur, "raw": raw, "zone": zone, "ambiguous": ambiguous, "blend": blend,
            "G": r(g_now, 1), "I": r(i_now, 1), "confidence": r(conf_final, 0), "confidence_market": r(conf_mkt, 0),
            "macro_adjust": r(mc["adjust"], 1), "macro_override": mc["override"],
            "distance_to_switch": {"points": r(min(abs(g_now), abs(i_now)), 1), "axis": dist_axis},
            "components": {k: r(float(c[k].iloc[-1]) * 100, 2) for k in c.columns},
        },
        "inertia": {"current": cur, "candidate": state.get("candidate"), "counter": state.get("counter", 0),
                    "required": req, "since": state.get("since"), "days_in_regime": int((px.index[-1] - since_d).days),
                    "pending": bool(state.get("candidate")), "raw_today": raw},
        "macro": {"available": bool(macro), "check": mc, "series": (macro or {}).get("series", {}),
                  "parts": (macro or {}).get("parts", {})},
        "bubble": bub,
        "allocation": {"regime_used": cur, "blend": blend if use_amb else None, "tier_effective": tier_eff,
                       "ambiguity_applied": use_amb, "sectors": rows,
                       "asset_classes": asset_class_target(cur, blend if use_amb else None, tier_eff, spec)},
        "market": {"spy": r(px["SPY"].iloc[-1], 2), "vix": r(px["^VIX"].dropna().iloc[-1], 2) if "^VIX" in px else None},
        "history_perf": history_perf(entries, px, spec),
        "trail": [{"d": str(G.index[k])[:10], "G": r(float(G.iloc[k]), 1), "I": r(float(I.iloc[k]), 1)}
                  for k in sorted(set(list(range(len(G) - 1, max(len(G) - 61, 0), -5)) + [len(G) - 1]))],
    }
    snap = clean(snap)
    req_keys = ["schema", "generated_at", "regime", "inertia", "bubble", "allocation", "sources"]
    ok = abs(sum(s["weight"] for s in snap["allocation"]["sectors"]) - 100) < 0.5
    if not ok:
        health["error"] = "somme des poids != 100"
        write_json(out / "health.json", health)
        return 0
    write_json(out / "snapshot.json", snap, req_keys)
    write_json(out / "state.json", clean(state), ["current"])
    write_json(out / "history.json", clean({"schema": 1, "generated_at": now_iso(), "entries": entries}), ["entries"])
    Path(out / "model_spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")

    # alerte : flux Atom uniquement
    base_url = os.getenv("PUBLIC_BASE_URL", "https://izilybourse.github.io/radar-macro-fire/")
    write_json(out / "history.json", clean({"schema": 1, "generated_at": now_iso(), "entries": entries}), ["entries"])
    write_atom(out / "alerts.xml", entries, base_url)

    health["ok"] = True
    health["last_snapshot"] = snap["generated_at"]
    write_json(out / "health.json", health)
    log(f"snapshot OK : régime {cur}, brut {raw}, G={g_now:.1f}, I={i_now:.1f}, bulle {bub['score']}")
    return 0


# ----------------------------------------------------------------------------
# Commande : cape
# ----------------------------------------------------------------------------
CAPE_XLS = os.getenv("CAPE_XLS_URL") or "https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/ie_data.xls"


def cape_from_shiller():
    d = pd.read_excel(CAPE_XLS, sheet_name="Data", skiprows=7, engine="xlrd")
    d = d[["Date", "CAPE"]].dropna()
    d = d[pd.to_numeric(d["Date"], errors="coerce").notna()]
    ser = []
    for a, b in zip(d["Date"].astype(float), d["CAPE"].astype(float)):
        y, m = int(a), int(round((a - int(a)) * 100))
        if 1 <= m <= 12:
            ser.append({"d": f"{y}-{m:02d}", "v": float(b)})
    if len(ser) < 100:
        raise ValueError("table Shiller inattendue")
    return ser, "Robert Shiller (Yale), fichier ie_data.xls"


def cape_from_multpl():
    html = requests.get("https://www.multpl.com/shiller-pe/table/by-month", headers=UA, timeout=25).text
    t = pd.read_html(io.StringIO(html))[0]
    t.columns = ["date", "value"]
    t["date"] = pd.to_datetime(t["date"], errors="coerce")
    t["value"] = pd.to_numeric(t["value"].astype(str).str.replace(r"[^0-9.]", "", regex=True), errors="coerce")
    t = t.dropna().sort_values("date")
    ser = [{"d": d.strftime("%Y-%m"), "v": float(v)} for d, v in zip(t["date"], t["value"])]
    if len(ser) < 100:
        raise ValueError("table multpl inattendue")
    return ser, "multpl.com (reprise des données Shiller), repli"


def cmd_cape(args):
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    if args.demo:
        ser = [{"d": (pd.Timestamp("2006-01-01") + pd.DateOffset(months=k)).strftime("%Y-%m"), "v": 24 + 12 * math.sin(k / 40) + k / 80}
               for k in range(250)]
        res = {"series": ser, "source": "Données de démonstration", "status": "ok"}
    else:
        res = None
        for fn, st in ((cape_from_shiller, "ok"), (cape_from_multpl, "repli")):
            try:
                ser, src = retry(fn, tries=3, label=fn.__name__)
                res = {"series": ser, "source": src, "status": st}
                break
            except Exception as e:
                warn(f"CAPE {fn.__name__} échoué: {e}")
        if not res:
            old = read_json(out / "cape.json")
            if old:
                old["status"] = "indisponible"
                write_json(out / "cape.json", old, ["value"])
            return 0
    last = res["series"][-1]
    obj = {"schema": 1, "generated_at": now_iso(), "status": res["status"], "source": res["source"],
           "value": r(last["v"], 2), "date": last["d"] + "-01", "series": res["series"][-240:]}
    write_json(out / "cape.json", clean(obj), ["value", "date"])
    log(f"CAPE {obj['value']} ({obj['date']})")
    return 0


# ----------------------------------------------------------------------------
# Commande : backtest + transitions
# ----------------------------------------------------------------------------
def build_universe(spec, px_all, ucits_px):
    """Séries de rendements par secteur : ETF UCITS quand disponible, sinon ETF US de référence (raccord par rendements)."""
    rets, info = {}, []
    for s in spec["sectors"]:
        proxy_r = px_all[s["ticker"]].pct_change()
        ter_diff = max(0.0, s["ucits"]["ter"] / 100 - 0.0009) / 252
        r_ = proxy_r.copy() - ter_diff
        start = None
        y = s["ucits"]["yahoo"]
        if y and y in ucits_px:
            u = ucits_px[y].pct_change().dropna()
            u = u.reindex(r_.index)
            m = u.notna()
            if m.sum() > 250:
                r_[m] = u[m]
                start = str(u.dropna().index[0])[:10]
        rets[s["ticker"]] = r_
        info.append({"key": s["key"], "us_proxy": s["ticker"], "ucits_isin": s["ucits"]["isin"], "ucits_yahoo": y,
                     "ucits_start": start, "ter": s["ucits"]["ter"], "approx_ucits": s["ucits"]["approx"]})
    return pd.DataFrame(rets), info


def perf_metrics(ret, rf):
    ret = ret.dropna()
    if len(ret) < 50:
        return None
    nav = (1 + ret).cumprod()
    yrs = len(ret) / 252
    vol = ret.std() * math.sqrt(252)
    dd = (nav / nav.cummax() - 1).min()
    mon = nav.resample("ME").last().pct_change().dropna()
    return {"total_return": r((nav.iloc[-1] - 1) * 100, 2), "cagr": r((nav.iloc[-1] ** (1 / yrs) - 1) * 100, 2),
            "vol": r(vol * 100, 2), "sharpe": r((ret.mean() * 252 - rf) / vol, 2) if vol else None,
            "max_drawdown": r(dd * 100, 2), "win_rate_monthly": r((mon > 0).mean() * 100, 1)}


def simulate(rets, regimes, spec):
    """Portefeuille : poids de base du régime confirmé la veille, rééquilibré à chaque changement et chaque début de mois."""
    cost = spec["backtest"]["cost_bps_per_traded_notional"] / 1e4
    keys = [s["ticker"] for s in spec["sectors"]]
    tgt = {rg: np.array([next(s for s in spec["sectors"] if s["ticker"] == t)["base"][rg] for t in keys], float) / 100 for rg in spec["regimes"]}
    R = rets[keys].fillna(0).values
    idx = rets.index
    reg = regimes.reindex(idx).ffill().values
    w = tgt[reg[0]].copy()
    cur, gross, net, turn = reg[0], [0.0], [0.0], []
    for t in range(1, len(idx)):
        rg = reg[t - 1]
        tc = 0.0
        if rg != cur or idx[t].month != idx[t - 1].month:
            trade = np.abs(tgt[rg] - w).sum()
            tc = trade * cost
            turn.append((str(idx[t])[:10], trade / 2))
            w, cur = tgt[rg].copy(), rg
        pr = float(w @ R[t])
        gross.append(pr)
        net.append(pr - tc)
        w = w * (1 + R[t]) / (1 + pr)
    return pd.Series(gross, idx), pd.Series(net, idx), turn


def transition_matrix(conf, h):
    regs = ["goldilocks", "reflation", "stagflation", "neutral"]
    v = conf.values
    cnt = {a: {b: 0 for b in regs} for a in regs}
    for k in range(len(v) - h):
        cnt[v[k]][v[k + h]] += 1
    prob = {}
    for a in regs:
        tot = sum(cnt[a].values())
        prob[a] = {b: (r(cnt[a][b] / tot, 4) if tot else None) for b in regs}
    return prob, cnt


def cmd_backtest(args):
    spec = load_spec()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    health = read_json(out / "health.json", {"schema": 1})
    if args.demo:
        px, _ = demo_prices(spec, years=19)
        ucits_px = {}
    else:
        tickers = sorted(set(all_tickers(spec) + ["VT", "SPY"]))
        crit = spec["tickers"]["growth"] + ["GSG", "TIP", "IEF", "VT"] + [s["ticker"] for s in spec["sectors"]]
        px, pstat, pglob, miss = get_prices(tickers, 40, crit)
        if miss:
            warn(f"backtest : prix critiques manquants {miss}, backtest.json conservé")
            return 0
        ucits_px = {}
        fx_cache = {}
        for s in spec["sectors"]:
            y = s["ucits"]["yahoo"]
            if not y:
                continue
            try:
                import yfinance as yf
                cur = yf.Ticker(y).fast_info["currency"]
                ser = retry(lambda y=y: fetch_yahoo([y], 40)[y], tries=2, label=y)
                ser = ser.tz_localize(None) if getattr(ser.index, "tz", None) else ser
                if cur != "USD":
                    # conversion en USD pour éviter de mélanger les effets de change : GBp/GBP -> GBPUSD, EUR -> EURUSD
                    fxt = {"GBp": "GBPUSD=X", "GBP": "GBPUSD=X", "EUR": "EURUSD=X"}.get(cur)
                    if not fxt:
                        warn(f"UCITS {y} coté en {cur}, ignoré (repli ETF US)")
                        continue
                    if fxt not in fx_cache:
                        fx = retry(lambda: fetch_yahoo([fxt], 40)[fxt], tries=2, label=fxt)
                        fx_cache[fxt] = fx.tz_localize(None) if getattr(fx.index, "tz", None) else fx
                    ser = ser * fx_cache[fxt].reindex(ser.index).ffill()
                ucits_px[y] = ser
            except Exception as e:
                warn(f"UCITS {y} indisponible: {e}")

    c, G, I, raw_s = regime_series(px, spec)
    conf, st, changes = replay(raw_s, spec["inertia"]["required_days"])
    rets, uinfo = build_universe(spec, px, ucits_px)
    start = max(conf.index[0], rets.dropna(how="all").index[0], px["VT"].dropna().index[0] if "VT" in px else conf.index[0]) + pd.Timedelta(days=1)
    gross, net, turn = simulate(rets.loc[start:], conf, spec)
    vt = px["VT"].pct_change().reindex(gross.index).fillna(0)
    spy = px["SPY"].pct_change().reindex(gross.index).fillna(0)
    rf = spec["backtest"]["risk_free_annual"]

    def curve(x):
        return (100 * (1 + x).cumprod())
    step = spec["backtest"]["weekly_sampling"]
    sel = list(range(0, len(gross), step))
    if sel[-1] != len(gross) - 1:
        sel.append(len(gross) - 1)
    curves = {"dates": [str(gross.index[k])[:10] for k in sel], "portfolio": [r(curve(gross).iloc[k], 2) for k in sel],
              "portfolio_net": [r(curve(net).iloc[k], 2) for k in sel], "vt": [r(curve(vt).iloc[k], 2) for k in sel],
              "spy": [r(curve(spy).iloc[k], 2) for k in sel]}
    ustarts = [u["ucits_start"] for u in uinfo if u["ucits_start"]]
    win = pd.Timestamp(max(ustarts)) if ustarts else None
    mt = lambda s_: perf_metrics(s_, rf)
    metrics = {"portfolio": mt(gross), "portfolio_net": mt(net), "vt": mt(vt), "spy": mt(spy)}
    metrics_u = None
    if win is not None and win > gross.index[0]:
        sl = slice(win, None)
        metrics_u = {"window": {"start": str(win)[:10], "end": str(gross.index[-1])[:10]},
                     "portfolio": mt(gross.loc[sl]), "portfolio_net": mt(net.loc[sl]), "vt": mt(vt.loc[sl]), "spy": mt(spy.loc[sl])}

    reg_al = conf.reindex(gross.index)
    alpha, stats = {}, {}
    for rg in spec["regimes"]:
        m = (reg_al.shift(1) == rg)
        n = int(m.sum())
        if n > 20:
            pa, va = gross[m].mean() * 252, vt[m].mean() * 252
            alpha[rg] = {"days": n, "share_pct": r(n / len(gross) * 100, 1), "portfolio_ann": r(pa * 100, 2), "vt_ann": r(va * 100, 2),
                         "alpha_ann": r((pa - va) * 100, 2)}
            stats[rg] = {"mu": r(pa, 4), "sigma": r(gross[m].std() * math.sqrt(252), 4), "days": n}
    bands, rs = [], reg_al.dropna()
    seg_start, prev = rs.index[0], rs.iloc[0]
    for d_, v_ in rs.items():
        if v_ != prev:
            bands.append({"start": str(seg_start)[:10], "end": str(d_)[:10], "regime": prev})
            seg_start, prev = d_, v_
    bands.append({"start": str(seg_start)[:10], "end": str(rs.index[-1])[:10], "regime": prev})
    yrs = len(gross) / 252
    tor = {"annual_one_way_pct": r(sum(x for _, x in turn) / yrs * 100, 1), "events": len(turn),
           "regime_changes": len([1 for k in range(1, len(rs)) if rs.iloc[k] != rs.iloc[k - 1]])}

    step_g, cases = spec["backtest"]["game_case_step"], []
    cc = c.loc[raw_s.index]
    for k in range(0, len(raw_s), step_g):
        d_ = raw_s.index[k]
        cases.append({"d": str(d_)[:10], "regime": raw_s.iloc[k], "G": r(G.loc[d_], 1), "I": r(I.loc[d_], 1),
                      "f": {kk: r(float(cc[kk].iloc[k]) * 100, 1) for kk in cc.columns}})
    cases = cases[-spec["backtest"]["max_game_cases"]:]

    # --- Validation hors échantillon, robustesse, chronologie, secteurs par régime ---
    import copy
    split = pd.Timestamp("2018-01-01")
    if not (gross.index[0] + pd.Timedelta(days=900) < split < gross.index[-1] - pd.Timedelta(days=900)):
        split = gross.index[len(gross) // 2]
    parts = {"p1": slice(None, split - pd.Timedelta(days=1)), "p2": slice(split, None)}
    validation = {"split": str(split)[:10], "periods": {}}
    for k_, sl_ in parts.items():
        a_, b_ = gross.loc[sl_], None
        validation["periods"][k_] = {"start": str(a_.index[0])[:10], "end": str(a_.index[-1])[:10],
                                      "portfolio_net": mt(net.loc[sl_]), "vt": mt(vt.loc[sl_]), "spy": mt(spy.loc[sl_])}
    ex = (net - vt)
    roll = ((1 + net).rolling(756).apply(np.prod, raw=True) / (1 + vt).rolling(756).apply(np.prod, raw=True) - 1).dropna()
    roll = roll.iloc[::21]
    validation["rolling_3y"] = {"windows": int(len(roll)),
                                "share_beating_vt_pct": r(float((roll > 0).mean() * 100), 1) if len(roll) else None,
                                "median_excess_pct": r(float(roll.median() * 100), 1) if len(roll) else None,
                                "worst_excess_pct": r(float(roll.min() * 100), 1) if len(roll) else None}
    validation["note_fixed_a_priori"] = True

    def run_variant(sp, req):
        c2, G2, I2, raw2 = regime_series(px, sp)
        conf2, _, ch2 = replay(raw2, req)
        conf2 = conf2.reindex(rets.loc[start:].index).bfill()
        g2, n2, _ = simulate(rets.loc[start:], conf2, sp)
        m2 = mt(n2) or {}
        yrs2 = max(len(n2) / 252, 1e-9)
        return {"cagr": m2.get("cagr"), "sharpe": m2.get("sharpe"), "max_drawdown": m2.get("max_drawdown"),
                "changes_per_year": r(len(ch2) / yrs2, 2)}
    robustness = {"inertia": [], "windows": []}
    try:
        for n_ in (1, 2, 3, 5, 10):
            sp = copy.deepcopy(spec)
            res = run_variant(sp, n_)
            res["value"] = n_
            robustness["inertia"].append(res)
        for lg, sh_ in ((189, 95), (252, 126), (315, 158)):
            sp = copy.deepcopy(spec)
            sp["windows"]["long"], sp["windows"]["short"] = lg, sh_
            res = run_variant(sp, spec["inertia"]["required_days"])
            res["value"] = f"{lg}/{sh_}"
            robustness["windows"].append(res)
    except Exception as e:
        warn(f"robustesse indisponible : {e}")
    ci = conf.index
    tsel = list(range(0, len(ci), 5))
    if tsel[-1] != len(ci) - 1:
        tsel.append(len(ci) - 1)
    timeline = {"dates": [str(ci[k])[:10] for k in tsel], "G": [r(float(G.loc[ci[k]]), 0) for k in tsel],
                "I": [r(float(I.loc[ci[k]]), 0) for k in tsel], "reg": [conf.iloc[k] for k in tsel]}
    sbr = {}
    for rg in spec["regimes"]:
        m = (reg_al.shift(1) == rg)
        sbr[rg] = {}
        if int(m.sum()) > 20:
            for sct in spec["sectors"]:
                if sct["ticker"] in rets.columns:
                    sbr[rg][sct["key"]] = r(float(rets[sct["ticker"]].reindex(gross.index).fillna(0)[m].mean() * 252 * 100), 1)
    yrs_all = len(gross) / 252
    switch = {"changes": len(changes), "per_year": r(len(changes) / yrs_all, 2)}

    bt = {"schema": 1, "generated_at": now_iso(), "demo": bool(args.demo),
          "period": {"start": str(gross.index[0])[:10], "end": str(gross.index[-1])[:10]},
          "method": ("Signal de marché seul (sans FRED, non rejouable), inertie 3 jours, poids de base par régime sans ajustement de bulle, "
                     "rééquilibrage à chaque changement de régime et chaque début de mois. Version nette : 10 pb par notionnel échangé "
                     "et différentiel de TER sur la partie reconstituée avec les ETF US."),
          "limits": ["Les ETF UCITS actuels n'existent que depuis 2015 à 2018 : avant, l'ETF US de référence du même indice sert de proxy.",
                     "ETF immobilier : pas d'équivalent UCITS S&P 500, proxy US sur tout l'historique.",
                     "Performances passées, aucune garantie. Hors fiscalité et hors change EUR."],
          "universe": uinfo, "curves": curves, "regime_bands": bands, "metrics": metrics, "metrics_ucits_window": metrics_u,
          "alpha_by_regime": alpha, "regime_stats": stats, "turnover": tor, "game_cases": cases,
          "validation": validation, "robustness": robustness, "timeline": timeline, "sector_by_regime": sbr, "switch": switch}
    write_json(out / "backtest.json", clean(bt), ["curves", "metrics"])

    t3, c3 = transition_matrix(conf, 63)
    t1, _ = transition_matrix(conf, 21)
    dur = {}
    for rg in spec["regimes"]:
        runs, n_ = [], 0
        for v_ in conf.values:
            if v_ == rg:
                n_ += 1
            elif n_:
                runs.append(n_); n_ = 0
        if n_:
            runs.append(n_)
        dur[rg] = r(float(np.mean(runs)), 0) if runs else None
    tr = {"schema": 1, "generated_at": now_iso(), "demo": bool(args.demo),
          "period": {"start": str(conf.index[0])[:10], "end": str(conf.index[-1])[:10]}, "regimes": spec["regimes"],
          "matrix_3m": t3, "matrix_1m": t1, "counts_3m": c3, "avg_duration_days": dur, "n_changes": len(changes),
          "note": "Probabilités empiriques sur l'historique disponible (depuis 2007 environ), régime confirmé avec inertie."}
    write_json(out / "transitions.json", clean(tr), ["matrix_3m", "matrix_1m"])
    Path(out / "model_spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"backtest OK : {bt['period']['start']} -> {bt['period']['end']}, {len(changes)} changements")
    return 0


def cmd_demo(args):
    """Jeu complet de JSON de démonstration, aucun accès réseau."""
    args.demo = True
    cmd_cape(args)
    cmd_backtest(args)
    args.mode = "close"
    # deux passages : amorçage puis passage de clôture
    cmd_snapshot(args)
    return 0


def main():
    ap = argparse.ArgumentParser(description="Radar Macro FIRE")
    ap.add_argument("cmd", choices=["snapshot", "cape", "backtest", "demo"])
    ap.add_argument("--mode", choices=["intraday", "close"], default="intraday")
    ap.add_argument("--out", default="data-out")
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    return {"snapshot": cmd_snapshot, "cape": cmd_cape, "backtest": cmd_backtest, "demo": cmd_demo}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
