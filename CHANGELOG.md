# Changelog

## 0.2.0 — Unreleased (protocol/storage v2)

- Project-scoped opt-in: canonical checkout identities, explicit non-Git roots, automatic bounded same-project agent presence without wake.
- Reciprocal session-scoped cross-project discovery/messaging grants; paired remote machines require separate project approval. Full roots are not advertised.
- Enforce project permissions in listing, sending, delivery, claims and revocation; auto-start remains separate.
- Backed-up transactional v1 migration disables legacy participation/auto-start and pauses old outgoing mail. Legacy records remain inspectable but cannot execute/replay. Both hosts/services must upgrade; old runtimes reject v2 storage.

## Main-branch improvements after 0.1.0

- Settings/help with LAN address examples, automatic authentication, pairing steps, permission boundaries, command reference and recovery guidance; available before setup.
- Bare-IP pairing input with HTTPS/default-port normalization, inline validation retries, and explicit approval/rejection separated from cancellation.
- Readable session/service status, command argument completion, unknown-command errors and compact session names; hide self from send targets.
- Return to the main menu after actions; queue empty states, previous-page navigation, state-aware actions and confirmed turn acceptance with uncertain-work warnings.
- Failed LAN listener activation restores the previous listener configuration and attempts recovery; manager error output is not exposed.
- Menu-only changes introduced no transport downgrade, manual credential entry or dependency changes; project-scoping migration is described above.

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
