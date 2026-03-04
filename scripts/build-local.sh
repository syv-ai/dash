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

echo "==> Packaging for macOS..."
pnpm exec electron-builder --mac

echo "==> Ad-hoc signing..."
codesign --force --deep --sign - --entitlements "$ROOT/build/entitlements.mac.plist" "$APP_PATH"
codesign --verify --verbose "$APP_PATH"

echo "==> Moving to /Applications..."
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
fi
cp -R "$APP_PATH" "$DEST"

echo "==> Done! $APP_NAME installed to /Applications"
