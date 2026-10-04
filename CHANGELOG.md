# Changelog

## 0.3.0 — Unreleased

- Prompt-cache fix: peer presence is snapshotted once per user turn and placed right after that user message, keeping history append-only; no presence socket call on later requests in the turn.
- Optional normal/urgent delivery and proposal/decision/blocker/result intent; plain messages remain supported. Intent is advisory, not authority or approval.
- Separate exact-sender recipient steering permission requires auto-start first; old backlog is never promoted. Urgent injection only during active runs or idle, never hard aborts or session launch.
- Multiple peer messages can share a run; track context consumption separately and mark unconsumed/interrupted urgent work uncertain. No automatic receipts-as-agreement or reply loops.
- Active-turn boundary checks plus two-second busy polling fallback; idle polling stays 15 seconds. Existing hourly/conversation budgets apply.
- Picker adds urgent send confirmation, explanatory intent choices and directional receive labels; steering grant shown only after auto-start. Queue details explain waiting/consumption/agreement and hide manual acceptance while busy. Compact context encourages explicit confirmation before shared decisions and pausing only dependent work.
- Known offline urgent targets retain durable sends; delivery negotiates support before transmission, and duplicate request IDs do not require a live remote or consume allowance twice. Capability preflight is bounded below the local request deadline; stalled peers cannot turn successful durable queueing into an ambiguous local timeout. Session changes cancel picker drafts before sending.
- Additive steering permission table (default empty), protocol/storage stay v2. Service capability and authenticated LAN negotiation reject unsupported urgent delivery. Both hosts should update services/adapters; downgrade with pending urgent work is unsupported.

## 0.2.1 — Main-branch update

- Durable 40-message rolling-hour allowance per session across incoming/outgoing traffic and all peers. Deduplicated retries and acceptance are free; receiving limits preserve sender queues for retry.
- Default related-chain depth/message/wake ceilings raised to 40; separate 24-hour deadline retained. This is not a token budget.
- Serialize acceptance, recheck readiness after claim, safely release unpresented claims, defer auto-draining past settlement and retain eligibility on message-local claim refusals. Exhausted conversation wakes no longer starve other eligible mail.
- Show hourly usage, directional receive auto/review and busy/backlog rules in the CLI picker/status/help.
- Compact peer context (five presence rows), send receipts and inbox tool results; explicit brief replies only.
- Require updated hourly-limit service capability; no new protocol/storage migration. Real Pi busy-queue flow tested with a local zero-cost provider; physical LAN/provider deployment remains unverified.

## 0.2.0 — Main-branch update (protocol/storage v2)

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
