# Schémas JSON (version `schema: 1`)

Tous les fichiers portent `schema` et `generated_at` (ISO UTC). Les exemples réels sont dans `demo/data/`.

**snapshot.json** : `schema, generated_at, run_mode(intraday|close), demo, asof, spec_version, sources{prices|fred|cape:{status ok|repli|indisponible, detail}}, regime{key, raw, zone, ambiguous, blend, G, I, confidence, confidence_market, macro_adjust, macro_override, distance_to_switch{points, axis}, components{spy12,spy6,hyg6,tlt6,gsg12,gsg6,be6}}, inertia{current, candidate, counter, required, since, days_in_regime, pending, raw_today}, macro{available, check{adjust, override, raw, agreement, Gm, Im}, series{CODE:{...}}, parts}, bubble{score, tier, tier_thresholds, pillars[]}, allocation{regime_used, blend, tier_effective, ambiguity_applied, sectors[], asset_classes{actions,obligations,or_matieres,immobilier,cash}}, market{spy, vix}, history_perf[{date, from, to, days, spy, portfolio}]`.

**state.json** : `schema, current, candidate, counter, since, last_bar_date, bootstrap`.

**history.json** (ajouts seulement) : `schema, generated_at, entries[{date, from, to, ts, spy, G, I, bubble, bootstrap, email_sent}]`.

**cape.json** : `schema, generated_at, status, source, value, date, series[{d, v}]`.

**backtest.json** : `schema, generated_at, demo, period{start,end}, method, limits[], universe[], curves{dates, portfolio, portfolio_net, vt, spy}, regime_bands[], metrics{portfolio, portfolio_net, vt, spy}, metrics_ucits_window, alpha_by_regime, regime_stats, turnover{annual_one_way_pct, events, regime_changes}, game_cases[]`.

**transitions.json** : `schema, generated_at, demo, period, regimes[], matrix_3m{from:{to:proba}}, durée moyenne`.

**health.json** : `schema, generated_at, run_mode, ok, error, last_snapshot`.

**model_spec.json** : paramètres du modèle (fenêtres, poids, seuils, secteurs et ETF UCITS, cibles par classe d'actifs, fraîcheur). **alerts.xml** : flux Atom, une entrée par changement de régime confirmé.

Chaque fichier peut manquer sans casser le widget.
