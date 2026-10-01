# Changelog

## Unreleased

- Settings/help with LAN address examples, automatic authentication, pairing steps, permission boundaries, command reference and recovery guidance; available before setup.
- Bare-IP pairing input with HTTPS/default-port normalization, inline validation retries, and explicit approval/rejection separated from cancellation.
- Readable session/service status, command argument completion, unknown-command errors and compact session names; hide self from send targets.
- Return to the main menu after actions; queue empty states, previous-page navigation, state-aware actions and confirmed turn acceptance with uncertain-work warnings.
- Failed LAN listener activation restores the previous listener configuration and attempts recovery; manager error output is not exposed.
- No transport downgrade, manual credential entry, dependency changes or storage migration.

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
