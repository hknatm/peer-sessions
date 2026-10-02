# Security and release policy

## Secrets never belong in this repository

State, private keys, pair secrets, invitations, databases, sessions and credentials belong outside package sources. `.gitignore` excludes common state/credential artifacts; npm `files` is an explicit runtime/documentation allowlist. Release checks scan source paths/content and actual npm pack candidates. Do not upload the surrounding Pi configuration directory.

Never commit/publish `.env`, `.npmrc`, `.pypirc`, `auth.json`, `settings.json`, `models.json`, state backups, private keys, secret-bearing configuration, generated TLS certificates, or raw sessions. Test credentials are generated at runtime under OS temp storage, not fixtures. Tests clean them up; if a test is forcibly killed, inspect/remove its isolated temporary directory locally, never bundle it.

No static scanner proves absence of all possible secrets. Before pushing, run `npm run check` and inspect `git diff --cached` and `git ls-files`; enable GitHub secret scanning/push protection when supported. Publication is explicit: this code does not push, publish or upload automatically. GitHub workflows, if added, must not publish using hardcoded credentials.

## Trust boundaries

Local service sockets are mode 600 in a mode-700 state directory. Processes/extensions under the same OS account can administer that account's service; it is not an OS sandbox. Use separate OS accounts for isolation.

LAN normal traffic requires pinned TLS machine identity and a 32-byte per-pair secret. Pair invitations are 32 random bytes, expire in five minutes, and require operator fingerprint verification on both hosts before approval. Anyone seeing an invitation can attempt pairing; never approve an unexpected request. UI/RPC/clipboard observers remain outside package guarantees.

Project discovery/messaging is restricted to enabled sessions in the same canonical local checkout unless each participating session reciprocally approves the other project. Different hosts always need explicit project grants in addition to machine pairing. Roots stay local; project labels/opaque root hashes are not secrets or proof of anonymity. The paired service is trusted to assert its own session/project identity; malicious same-user processes/paired hosts are not sandboxed. Grants do not grant transcript access or concurrent-write safety. Legacy v1 participation is disabled by a backed-up v2 migration, never implicitly adopted.

Auto-start is opt-in per sender and may cause model costs and tool side effects. Peer messages are untrusted input. No transcript/file/model credential API is remotely exposed, but a model with tools could independently disclose data; limit recipient tools/permissions appropriately.

The default 40-message rolling-hour allowance is per persistent session across incoming/outgoing traffic, not a token or global machine budget. New session IDs have separate allowances. One accepted message can start many model/tool calls; chain budgets and concise-message guidance do not guarantee low token spend. Counters depend on the host clock and retained records; use operator-approved model/tool cost controls for strict spending limits.

Revocation blocks subsequent messages/claims but cannot undo already accepted turns or side effects. Cancellation cannot recall a durably received message.

## Reporting

Do not post secrets or exploit details publicly. Use GitHub private vulnerability reporting at https://github.com/hknatm/peer-sessions/security/advisories/new. If it is unavailable, contact the owner privately before disclosing details; do not include credentials in a public issue.
