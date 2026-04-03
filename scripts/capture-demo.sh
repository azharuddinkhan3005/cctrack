#!/usr/bin/env bash
# ============================================================================
# capture-demo.sh — Generate animated demo GIF for the cctrackr README
#
# Usage:
#   cd /Users/corekhan/Sites/cctrack
#   bash scripts/capture-demo.sh
#
# Prerequisites:
#   - Node.js + pnpm
#   - Playwright browsers (auto-installs if missing)
#   - ffmpeg (brew install ffmpeg) OR ImageMagick (brew install imagemagick)
#   - Optional: gifsicle (brew install gifsicle) for extra optimization
#
# Output:  assets/demo.gif  (~2-5 MB, 800px wide, ~30s loop)
# ============================================================================
set -euo pipefail

export PATH="/Users/corekhan/.nvm/versions/node/v24.14.1/bin:$PATH"

ROOT="/Users/corekhan/Sites/cctrack"
DASHBOARD="/tmp/cctrack-mock.html"

echo "=== CCTrack Demo GIF Generator ==="
echo ""

# ---------- Pre-flight ----------
echo "--- Pre-flight checks ---"

if [ ! -f "$DASHBOARD" ]; then
  echo "  Mock dashboard not found at $DASHBOARD"
  echo "  Generate it first:  node dist/index.js dashboard --save $DASHBOARD"
  exit 1
fi
echo "  Dashboard: OK"

# Tools
for tool in ffmpeg magick convert gifsicle; do
  printf "  %-10s " "$tool:"
  which "$tool" 2>/dev/null || echo "(not found)"
done

if ! command -v ffmpeg &>/dev/null && ! command -v magick &>/dev/null && ! command -v convert &>/dev/null; then
  echo ""
  echo "  ERROR: Need ffmpeg or ImageMagick for GIF assembly."
  echo "    brew install ffmpeg"
  exit 1
fi

# Playwright chromium
echo -n "  playwright: "
if pnpm exec playwright install --dry-run chromium &>/dev/null 2>&1; then
  echo "OK"
else
  echo "Installing chromium browser..."
  cd "$ROOT"
  pnpm exec playwright install chromium
fi

echo ""

# ---------- Run the Node.js capture script ----------
cd "$ROOT"
node scripts/capture-demo.mjs

# ---------- Final report ----------
OUTPUT="$ROOT/assets/demo.gif"
if [ -f "$OUTPUT" ]; then
  SIZE=$(stat -f%z "$OUTPUT" 2>/dev/null || stat --printf=%s "$OUTPUT" 2>/dev/null)
  SIZE_KB=$((SIZE / 1024))
  echo ""
  echo "=== COMPLETE ==="
  echo "  File: $OUTPUT"
  echo "  Size: ${SIZE_KB} KB"
  if [ "$SIZE" -gt 5242880 ]; then
    echo "  NOTE: > 5 MB. Consider running:"
    echo "    gifsicle --optimize=3 --colors 64 --lossy=80 -b $OUTPUT"
  fi

  # Update README to use the animated GIF as the hero image
  if grep -q 'assets/dashboard-hero.png' "$ROOT/README.md"; then
    echo ""
    echo "  Updating README.md hero image to use demo.gif..."
    sed -i '' 's|assets/dashboard-hero.png|assets/demo.gif|g' "$ROOT/README.md"
    sed -i '' 's|alt="cctrack dashboard overview"|alt="cctrack dashboard demo — dark/light mode, project filtering, 9 chart panels"|g' "$ROOT/README.md"
    echo "  README.md updated."
  fi
else
  echo ""
  echo "=== FAILED ==="
  echo "  GIF not created. Frames saved in /tmp/cctrack-demo-frames/"
  exit 1
fi
