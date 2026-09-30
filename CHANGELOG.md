# Changelog

## 0.1.0 — Initial release candidate

- Self-contained Pi package; zero runtime npm dependencies and wildcard host peers.
- `/peer` management menu plus compatibility `/peers` commands.
- First-use approved user service setup; versioned runtime staging and activation rollback.
- Guided expiring TLS pairing invitations, explicit reciprocal fingerprint approval.
- Independent durable inbox/outbox, offline retry, deduplication, permissions and bounded chains.
- Optional running-session wake using recipient model; closed backlog/manual uncertain recovery.
- Session outbox pause/resume/cancel and inbox dismiss; retained state, no automatic pruning.
- Release content allowlist, secret checks and temporary-state test suite.

Public source: hknatm/peer-sessions, MIT license; npm publication is separate. Physical LAN, real OS service activation/reboot, and provider wake need deployment verification.
