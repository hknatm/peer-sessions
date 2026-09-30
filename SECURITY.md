# Security and release policy

## Secrets never belong in this repository

State, private keys, pair secrets, invitations, databases, sessions and credentials belong outside package sources. `.gitignore` excludes common state/credential artifacts; npm `files` is an explicit runtime/documentation allowlist. Release checks scan source paths/content and actual npm pack candidates. Do not upload the surrounding Pi configuration directory.

Never commit/publish `.env`, `.npmrc`, `.pypirc`, `auth.json`, `settings.json`, `models.json`, state backups, private keys, secret-bearing configuration, generated TLS certificates, or raw sessions. Test credentials are generated at runtime under OS temp storage, not fixtures. Tests clean them up; if a test is forcibly killed, inspect/remove its isolated temporary directory locally, never bundle it.

No static scanner proves absence of all possible secrets. Before pushing, run `npm run check` and inspect `git diff --cached` and `git ls-files`; enable GitHub secret scanning/push protection when supported. Publication is explicit: this code does not push, publish or upload automatically. GitHub workflows, if added, must not publish using hardcoded credentials.

## Trust boundaries

Local service sockets are mode 600 in a mode-700 state directory. Processes/extensions under the same OS account can administer that account's service; it is not an OS sandbox. Use separate OS accounts for isolation.

LAN normal traffic requires pinned TLS machine identity and a 32-byte per-pair secret. Pair invitations are 32 random bytes, expire in five minutes, and require operator fingerprint verification on both hosts before approval. Anyone seeing an invitation can attempt pairing; never approve an unexpected request. UI/RPC/clipboard observers remain outside package guarantees.

Auto-start is opt-in per sender and may cause model costs and tool side effects. Peer messages are untrusted input. No transcript/file/model credential API is remotely exposed, but a model with tools could independently disclose data; limit recipient tools/permissions appropriately.

Revocation blocks subsequent messages/claims but cannot undo already accepted turns or side effects. Cancellation cannot recall a durably received message.

## Reporting

Do not post secrets or exploit details publicly. Use GitHub private vulnerability reporting at https://github.com/hknatm/peer-sessions/security/advisories/new. If it is unavailable, contact the owner privately before disclosing details; do not include credentials in a public issue.
