#!/usr/bin/env bash
# The Marketplace listing uses a separate Forge app (an app submitted to Marketplace can't also be
# shared by installation link). This copies the source of precedent/ into precedent-marketplace/,
# keeping that app's own id, then builds it. Deploy afterwards with:
#   cd precedent-marketplace && forge deploy -e production
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/precedent"
dst="$root/precedent-marketplace"
app_id="$(grep -o 'ari:cloud:ecosystem::app/[0-9a-f-]*' "$dst/manifest.yml")"
for item in src prompts test package.json package-lock.json tsconfig.json README.md; do
  rm -rf "$dst/$item"; cp -r "$src/$item" "$dst/$item"
done
mkdir -p "$dst/static/ui"
for item in src public index.html package.json package-lock.json tsconfig.json vite.config.ts; do
  rm -rf "$dst/static/ui/$item"; cp -r "$src/static/ui/$item" "$dst/static/ui/$item"
done
sed "s#ari:cloud:ecosystem::app/[0-9a-f-]*#$app_id#" "$src/manifest.yml" > "$dst/manifest.yml"
(cd "$dst" && npm install --silent && npm --prefix static/ui install --silent && npm --prefix static/ui run build && npm run check)
echo "Synced into $dst ($app_id)"
