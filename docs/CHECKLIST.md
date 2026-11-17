# Checklist de test

Faits en navigateur (Chromium, données de démo) : 12 onglets rendus sans erreur JavaScript, aucun débordement horizontal à 360 px, bureau 1200 px, thème clair, FR, EN, DE, JSON backtest et transitions absents, snapshot absent (message clair), localStorage bloqué (repli mémoire), Monte Carlo, jeu, journal.

À faire chez vous :
- [ ] Coller dans Hostinger : l'iframe s'affiche, onglets et accordéons fonctionnent, pas de liens d'ancre.
- [ ] Après le premier workflow : `snapshot.json` accessible, voyant vert, bandeau démo absent.
- [ ] Mobile réel (iPhone, Android), thème clair, rotation écran.
- [ ] Yahoo coupé : sources.prices passe à « repli » (Stooq) ; FRED coupé : bandeau « marché seul ».
- [ ] Copier, export PDF, partage, téléchargement JSON dans l'iframe (replis intégrés si bloqués).
- [ ] Google Sheets : fichier partagé en lecture par lien, colonnes reconnues.
- [ ] Alertes Brevo : inscription, flux alerts.xml, email au premier changement de régime.
- [ ] Vérifier les 4 ISIN signalés sur justETF.

Revue de bugs corrigés : valeur vide des variables GitHub (`or` au lieu du défaut), condition d'amorçage de state.json, devise des lignes LSE (conversion USD), liste de tickers critiques du backtest, bruit des données de démo.
