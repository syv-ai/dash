#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Dash"
APP_PATH="$ROOT/release/mac-arm64/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"

echo "==> Rebuilding native modules for Electron..."
cd "$ROOT"
pnpm exec electron-rebuild -f -w better-sqlite3,node-pty

echo "==> Building $APP_NAME..."
pnpm build

echo "==> Packaging for macOS (signed + notarized)..."
export APPLE_TEAM_ID="2DD8ZKZ975"

if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
  echo "⚠️  APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD not set."
  echo "    The app will be signed but NOT notarized."
  echo "    To notarize, run:"
  echo "      export APPLE_ID=your@email.com"
  echo "      export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx"
  echo ""
fi

pnpm exec electron-builder --mac --arm64

echo "==> Verifying code signature..."
codesign --verify --verbose=2 "$APP_PATH"
echo ""
echo "==> Checking notarization status..."
spctl --assess --verbose=2 "$APP_PATH" 2>&1 || echo "(spctl check may fail if not notarized — this is OK for local dev)"

echo "==> Moving to /Applications..."
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
fi
cp -R "$APP_PATH" "$DEST"

echo "==> Done! $APP_NAME installed to /Applications"
