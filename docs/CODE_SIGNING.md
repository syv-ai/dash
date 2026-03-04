# Code Signing & Notarization

This guide covers how to sign and notarize Dash for macOS distribution.

## Overview

- **Team ID**: `2DD8ZKZ975` (syv.ai ApS)
- **App ID**: `com.syv.dash`
- **Distribution**: Outside Mac App Store (Developer ID)

## Certificates Required

You need two certificates from the Apple Developer portal:

1. **Developer ID Application** — signs the `.app` bundle
2. **Developer ID Installer** — signs the `.dmg`/`.pkg` installer

Both must be installed in your macOS Keychain (locally) or imported via base64 in CI.

## Local Development Setup

### 1. Create certificates (one-time)

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Create a **Developer ID Application** certificate (requires a CSR from Keychain Access)
3. Create a **Developer ID Installer** certificate (same CSR works)
4. Download and double-click both `.cer` files to install into Keychain

### 2. Generate an App-Specific Password (for notarization)

1. Go to https://appleid.apple.com → Sign-In and Security → App-Specific Passwords
2. Generate a password, name it "Dash Notarize"
3. Export it:

```bash
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
```

### 3. Build locally

```bash
./scripts/build-local.sh
```

The script will:
- Sign with the Developer ID Application identity from your keychain
- Notarize with Apple (if `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` are set)
- Verify the signature and install to `/Applications`

## CI/CD Setup (GitHub Actions)

### Required Secrets

Add these to your repo's Settings → Secrets and variables → Actions:

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `CSC_LINK` | Base64-encoded `.p12` certificate | See export instructions below |
| `CSC_KEY_PASSWORD` | Password for the `.p12` file | Set when exporting from Keychain |
| `APPLE_ID` | Apple ID email for notarization | Your Apple Developer email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password | appleid.apple.com |

### Exporting certificates for CI

1. Open **Keychain Access** on your Mac
2. Find the "Developer ID Application" certificate
3. Right-click → Export → save as `.p12` with a password
4. Base64-encode it:

```bash
base64 -i Certificates.p12 | pbcopy
```

5. Paste as `CSC_LINK` secret in GitHub
6. Set the `.p12` password as `CSC_KEY_PASSWORD` secret

### Team ID

The Team ID (`2DD8ZKZ975`) is hardcoded in:
- `package.json` → `build.mac.notarize.teamId`
- `scripts/build-local.sh` → `APPLE_TEAM_ID`
- `.github/workflows/build.yml` → `APPLE_TEAM_ID`

## Troubleshooting

**"Developer ID Application" not found in keychain**
- Make sure the certificate is installed in the "login" keychain
- Run `security find-identity -v -p codesigning` to list available identities

**Notarization fails with "invalid credentials"**
- Regenerate the app-specific password at appleid.apple.com
- Make sure `APPLE_ID` matches the Apple Developer account email

**spctl assessment fails**
- The app might not be notarized yet (takes 1-5 minutes)
- Run `xcrun stapler staple "release/mac-arm64/Dash.app"` to staple the ticket
- electron-builder should handle stapling automatically

**CI build fails at "Import code signing certificate"**
- Re-export the .p12 and update the `CSC_LINK` secret
- Make sure the base64 encoding has no line breaks: `base64 -i file.p12 | tr -d '\n' | pbcopy`

