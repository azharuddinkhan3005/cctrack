# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in cctrack, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email **azharuddin.khan3005@gmail.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive an acknowledgment within 48 hours
4. A fix will be prioritized and released as a patch version

## Security Design

- **Local-only processing** -- All data stays on your machine. No telemetry, no server, no account.
- **No install scripts** -- No `postinstall`, `preinstall`, or `install` hooks that could execute arbitrary code.
- **Unminified bundle** -- Published code is readable and auditable. We do not ship minified code.
- **npm provenance** -- Every release includes SLSA v1 provenance via GitHub Actions, verifiable on npm.
- **Trusted Publishing** -- Publishes via OIDC (no stored npm tokens). Prevents token theft attacks.
- **Minimal dependencies** -- 4 runtime deps (chalk, cli-table3, commander, zod). No transitive surprises.

## Supply Chain

cctrack is published exclusively through GitHub Actions with:
- Provenance attestation (SLSA v1, logged in Sigstore Rekor)
- OIDC-based Trusted Publishing (no npm access tokens stored anywhere)
- Build-from-source verification (every publish links to the exact source commit)

You can verify any release:
```bash
npm audit signatures
```
