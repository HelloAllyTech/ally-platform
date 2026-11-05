## Security Policy

### Supported Versions

We maintain the latest main branch. Vulnerabilities reported against older, unmaintained branches may not be addressed.

### Reporting a Vulnerability

Please email admin@helloally.ai with details of the issue, steps to reproduce, and potential impact. We aim to respond within 5 business days.

Do not disclose the vulnerability publicly until we have had a chance to investigate and provide a fix.

### Sensitive Data

This repository should not contain secrets. Ensure the following files are not committed:

- `android/app/google-services.json`
- `ios/GoogleService-Info.plist`
- Any `*.keystore` files
- `.env` files or local overrides

If you find any secrets, please contact us immediately so we can rotate affected credentials and remove them from history.
