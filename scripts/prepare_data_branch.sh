#!/usr/bin/env bash
# Prépare le dossier data-out : récupère la branche "data" (ou la crée vide la première fois).
set -euo pipefail
git config user.name  "radar-bot"
git config user.email "radar-bot@users.noreply.github.com"
if git ls-remote --exit-code --heads origin data >/dev/null 2>&1; then
  git fetch origin data --depth=1
  git worktree add --detach data-out FETCH_HEAD
else
  git worktree add --detach data-out HEAD
  (cd data-out && git checkout -q --orphan data && git rm -rq --cached . && find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +)
fi
mkdir -p data-out
