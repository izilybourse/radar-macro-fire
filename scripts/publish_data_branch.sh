#!/usr/bin/env bash
# Publie le contenu de data-out sur la branche "data" (servie par GitHub Pages).
# Un seul commit est conservé (--amend + push forcé) : le dépôt ne grossit pas à chaque exécution.
set -euo pipefail
cd data-out
touch .nojekyll
git add -A
if git rev-parse --verify -q HEAD >/dev/null && ! git diff --cached --quiet; then
  git commit --amend -q -m "data $(date -u +%FT%TZ)"
elif ! git rev-parse --verify -q HEAD >/dev/null; then
  git commit -q -m "data init"
else
  echo "Rien à publier."; exit 0
fi
git push --force origin HEAD:data
