#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Dash"
APP_PATH="$ROOT/release/mac-arm64/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"

# macOS 26+ (Darwin 25+): CLT 17 ships incomplete C++ stdlib headers.
# The compiler searches /Library/Developer/CommandLineTools/usr/include/c++/v1/
# but CLT 17 only has the full set inside the SDK. Without the copy,
# electron-rebuild fails with: fatal error: 'functional' file not found
DARWIN_MAJOR="$(uname -r | cut -d. -f1)"
CXX_HEADER="/Library/Developer/CommandLineTools/usr/include/c++/v1/functional"
if [ "$DARWIN_MAJOR" -ge 25 ] 2>/dev/null && [ ! -f "$CXX_HEADER" ]; then
  echo "==> macOS 26+ detected: C++ stdlib headers missing for native module compilation."
  echo "    Run this once to fix:"
  echo ""
  echo "    sudo rsync -a /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk/usr/include/c++/v1/ \\"
  echo "                   /Library/Developer/CommandLineTools/usr/include/c++/v1/"
  echo ""
  exit 1
fi

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
