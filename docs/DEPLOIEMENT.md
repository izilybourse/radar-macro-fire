# Le Radar Macro FIRE : guide de déploiement

Hypothèses (modifiables) : compte GitHub `izilybourse`, dépôt public `radar-macro-fire`, données servies par GitHub Pages depuis la branche `data`.

## Étapes

1. **Créer le dépôt** : sur GitHub, New repository, nom `radar-macro-fire`, **Public** (obligatoire pour Pages et Actions gratuites). Envoyez le contenu de ce dossier (hors `demo/` si vous voulez) : `git init && git add . && git commit -m init && git remote add origin https://github.com/izilybourse/radar-macro-fire.git && git push -u origin main`.
2. **Clé FRED** : créez un compte sur fred.stlouisfed.org, My Account, API Keys. Dans le dépôt : Settings, Secrets and variables, Actions, New repository secret : `FRED_API_KEY`.
3. **Autres secrets (optionnels)** : `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` pour l'alerte email ; `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_DIR` pour copier aussi les JSON sur Hostinger. Variable (onglet Variables) : `CAPE_XLS_URL` (lien du fichier Shiller ie_data.xls) ; si vide, repli multpl.com.
4. **Droits des workflows** : Settings, Actions, General, Workflow permissions : Read and write.
5. **Premier lancement manuel, dans cet ordre** : Actions, puis `CAPE mensuel` (Run workflow), puis `Backtest hebdomadaire`, puis `Snapshot` avec mode `close`. La branche `data` est créée automatiquement.
6. **Activer Pages** : Settings, Pages, Source : Deploy from a branch, branche `data`, dossier `/ (root)`. Attendez 1 à 2 minutes. Testez `https://izilybourse.github.io/radar-macro-fire/snapshot.json` dans le navigateur.
7. **Widget Hostinger** : ouvrez `radar-macro-fire.html`, copiez tout, collez dans un module HTML (code personnalisé) de la page. Si votre dépôt ou compte diffère, modifiez `DATA_BASE` avant (voir plus bas), ou relancez `python3 tools/build_widget.py`.
8. **Alertes email** : créez une liste Brevo et un formulaire d'inscription (double opt in), renseignez `BREVO_FORM_URL` (adresse du formulaire) ou `BREVO_SIGNUP_LINK` dans le widget.
9. **Option FTP Hostinger** : ajoutez les secrets FTP, copiez `htaccess.txt` en `.htaccess` dans le dossier cible pour l'en tête CORS, puis pointez `DATA_BASE` vers ce dossier.

## Variables à remplacer dans le widget (bloc CONFIG en début de script)

| Variable | Valeur par défaut | À faire |
|---|---|---|
| `DATA_BASE` | `https://izilybourse.github.io/radar-macro-fire/` | URL de base des JSON, avec `/` final |
| `PAGE_URL` | `https://izilyfire.fr/radar-macro-fire` | adresse de la page, pour le partage |
| `BREVO_FORM_URL` / `BREVO_SIGNUP_LINK` | vide | formulaire d'alertes |
| Google Sheet | non codé en dur | chaque visiteur saisit son identifiant dans l'onglet Patrimoine (fichier partagé « lecteur avec le lien ») |

Pour tester sans modifier le code : `window.RMF_CONFIG = {DATA_BASE:'...'}` avant le widget.

## Secrets et variables, récapitulatif

Secrets : `FRED_API_KEY` (obligatoire), `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_DIR`. Variable : `CAPE_XLS_URL`.

## Calendrier des workflows

Snapshot : toutes les 30 min, 13h à 21h UTC, lundi à vendredi (mode intraday), et 22h15 UTC (mode close, seul à faire avancer l'inertie de 3 jours). CAPE : les 3 et 18 de chaque mois. Backtest : dimanche 05h30 UTC. Les workflows ont aussi `workflow_dispatch`. Le cron GitHub peut avoir plusieurs minutes de retard : c'est pourquoi le widget affiche l'âge réel des données.

## Modifier le modèle

Éditez uniquement `model_spec.json` : le script et le widget le lisent (copie publiée avec les données, repli codé en dur dans le widget via `tools/build_widget.py`).

## Hypothèses retenues

Compte `izilybourse` ; tableau des cibles par classe d'actifs et All Weather 30/55/15 : cadre pédagogique de mon cru ; backtest sur le signal de marché seul (sans FRED) ; correspondance des colonnes du Google Sheets par détection de mots, avec choix manuel de secours ; pas de contenu Premium verrouillé (impossible sans serveur d'authentification).

## Limites connues

Les accès réels à Yahoo, FRED, Stooq, Shiller et Brevo n'ont pas pu être testés depuis l'environnement de développement (réseau restreint) : lancez les workflows à la main et lisez `health.json`. Le lien du fichier Shiller peut changer. Quatre ISIN sont marqués « à vérifier » (disc, ind, mat, util). Les données de `demo/` sont synthétiques.
