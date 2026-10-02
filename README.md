# Peer Sessions

A small Pi package for independent sessions on the same machine or paired LAN machines. No parent/child agents, cloud broker, or central queue server.

## Install

Requires **Node.js 24+**, OpenSSL for first-use identity generation, and Pi. macOS and Linux are supported; Windows is not yet supported. Tested locally with Pi 0.99.1.

Install from the public GitHub repository:

```bash
pi install git:github.com/hknatm/peer-sessions
```

For a local checkout, use `pi install /absolute/path/to/peer-sessions`. GitHub installation follows the repository default branch unless you pin a published tag or commit. npm package name: `peer-sessions`; it has not been published to npm.

Use Pi's installer, not a second SDK installation. The package has **no runtime npm dependencies**, no install/postinstall hooks, and optional wildcard host peers. Do not load both this package and a legacy peer extension; `/peer` and compatibility `/peers` are registered by this package.

## Enable and manage

Restart/reload Pi, then:

```text
/peer enable
/peer
```

First use asks permission to initialize private state and install/start a user-level background service. Installation alone does nothing: no services, model calls, LAN listener, or exposed sessions. `/peer enable` joins **this session’s project**, not every session on the machine. Enabled sessions in the same project can discover/message each other; other projects and remote machines remain blocked until explicitly approved.

`/peer` shows whether this session is enabled and whether the service is reachable. It opens **Sessions, Inbox, Outbox, Permissions, Cross-project cooperation, Pair machines, Status, Settings & help, Service, Disable this session**. Completed actions return to the main menu; Escape closes it. Session names are compact, with stable addresses in Details. Queue screens support previous/next pages and show only actions applicable to the message state. Accepting a message in the menu requires confirmation because it starts a model turn; uncertain messages warn about possible prior side effects. Empty lists explain the next step. Noninteractive/RPC users can use explicit commands instead of opening menus:

```text
/peer list
/peer status
/peer settings
/peer cooperate
/peer help
/peer inbox
/peer outbox
/peer send MACHINE/SESSION message
/peer accept INBOX_ID
/peer disable
```

Subcommands have slash-command argument completion. `/peer help` works before service setup; `/peer settings` opens connection/authentication examples, pairing steps, permissions, recovery and command guidance without changing settings. `/peer status` is a readable summary, with machine-wide queue counts labelled separately from this session’s permissions. Unknown subcommands show a usage error. Compatibility `/peers` remains available. Session disable, service uninstall, and machine revocation are different operations; none deletes queues.

## Project-scoped cooperation

**Same project** means the canonical Git checkout root. Sessions in its subdirectories or symlink aliases match; distinct Git worktrees/checkouts do not, even with identical remotes. Non-Git sessions ask you to select/confirm a containing project root, saved on the active session branch. Project changes require a new session rather than silently transferring permissions. Session participation is still opt-in; forks do not inherit participation.

Presence of running same-project sessions refreshes every 15 seconds and before model calls. The UI reports membership changes; the agent receives a fresh, bounded presence snapshot in request context, not an ever-growing persisted transcript. Presence does **not** start a turn, launch Pi or automatically delegate. Busy/closed states are lease-based, not instantaneous process detection. Agree on file ownership or separate worktrees before editing shared files.

For another project, use **Cross-project cooperation** or `/peer cooperate`:

1. On A, choose **Allow local project** (operator-only project picker), or **Allow project by address** for another machine. Project addresses are `MACHINE/PROJECT_ID`, available in `/peer status`.
2. On B, approve A’s project in the same way. Both individual sessions must be enabled.
3. For remote hosts, also pair the machines and allow the machine in each session’s Permissions.

Approval applies **only to the approving session**, not all sessions in a project. A one-sided grant does not expose another local project or permit a local send. Other sessions must approve separately. Revoke a project through the same menu; queued/received messages remain stored, but revoked access cannot claim them or trigger work. Auto-start stays independently sender-authorized. Project approval is a peer-tool boundary, **not** a filesystem/OS sandbox. Same-user processes can administer the service.

Full roots are not advertised; descriptors contain an opaque root-derived identifier and a display label. Hashes are identifiers, not cryptographic anonymity for guessable paths. Different machines always require explicit project approval—even if paths/names/remotes match. No repository URLs or credentials are used as project identity.

## Pair another machine

Install the package and `/peer enable` on both hosts. On host A, `/peer pair` → **Create invitation**. Enter A's actual LAN IP, e.g. `192.168.1.20` or `192.168.1.20:7443`; bare IPs default to HTTPS port 7443. An explicit `https://192.168.1.20:7443` also works. The address is **this computer’s peer listener, not its model/provider API URL**. Invalid entries show guidance and let you retry; Escape cancels. Confirm opening that listener, and copy the private invitation from the UI editor. If listener activation fails, the previous listener configuration is restored and recovery is attempted; a failed recovery requires checking Service before retrying. Invitations expire after five minutes; never paste them into agent chat or tool arguments.

On host B, `/peer pair` → **Join with invitation**, enter B's LAN address, and paste A's invitation privately. Verify A's displayed SHA256 fingerprint with A through a trusted channel. B waits for A's approval.

On A, `/peer pair` → **Approve waiting request**, verify B's fingerprint independently, then select **Approve verified machine**. **Back** or Escape leaves the request pending; **Reject request** explicitly rejects it. Both services save pinned certificates and a freshly generated per-pair secret. Machines have been paired, but each session still needs **Permissions → allow machine** and **Cross-project cooperation → Allow project by address** on both ends. Auto-start remains off.

**No auth token needs to be entered.** Certificates and pair secrets are managed automatically. HTTP, hostnames, wildcard listener addresses, reverse-proxy paths, query tokens and URL credentials are unsupported. Your existing Pi model-provider configuration is unchanged. Same-computer sessions need no URL or pairing. **Settings & help → Connection & authentication** and **Pair machines → Connection guidance** explain this before setup.

TLS 1.3 protects traffic; reciprocal certificate pinning and pair-secret auth protect normal messages. The `/pair` endpoint is reachable only while an invitation/request is open. It accepts a high-entropy invitation and requires local approval; no short PIN/custom encryption. Keep OS firewalls restricted to your LAN peers. No mDNS, NAT traversal, or relay routing. Static IPs/DHCP reservations simplify pairing. A partial pairing (one host stops after approval) may require re-pair/revocation; no silent trust transfer occurs.

Private UI inputs are not appended to model context by this package, but RPC clients, screen capture, clipboard managers and OS processes may observe them. Use a trusted Pi client. Remote names/content are external input, never system instructions.

## Automatic processing and model ownership

Select a session in `/peer` → **Allow auto-start from this session**, confirm the permission. Only that exact sender may wake the recipient while Pi is already running and idle. Busy-session messages queue. Closed-session backlog and interrupted work require manual acceptance; no Pi process is launched.

The recipient uses its own currently selected model/thinking level. Transport never overrides model selection, supplies provider credentials, or selects a fallback. Permission to trigger a turn is not a tool sandbox: the recipient retains its existing tools/workspace privileges. Ordinary final answers are not automatically sent back; `peer_send` explicitly sends a reply with the incoming parent ID.

## Queue control

Each host owns a SQLite inbox/outbox in private state. The sender retains undelivered messages; the recipient acknowledges only after committing its inbox. `/peer` → **Outbox** can pause/resume pending sends and cancel an unsent entry. In-flight cancellation is refused; received messages cannot be recalled. **Inbox** can accept or dismiss stored entries. Records remain for deduplication/audit; no automatic deletion/archive command.

States distinguish transport from work: queued, paused, received (durable receipt), pending, processing, presented, handled (turn settled, not proof of task success), uncertain, expired, rejected, cancelled. Transport retries are deduplicated; side effects are not guaranteed exactly once.

Default limits (editable in private config, restart service): **40 new incoming + outgoing messages per session per rolling hour, shared across all peers**; chain depth 40; 40 messages and 40 wake attempts per conversation **per host**; 24-hour immutable deadline; 32 KiB payload; 10,000 retained rows; 1,000 outstanding rows per mailbox/direction; rate 60/minute; attachment lease 60 seconds. Direct transport has one hop. Related-request depth is adjustable, not unrestricted mesh routing. Hourly usage uses retained message timestamps and survives restarts; retries/duplicates and later acceptance do not count again. Cancellation does not refund usage. A limited recipient leaves delivery queued at the sender for retry; a new send at the sender limit fails with the next-slot time. This is a traffic limit, not a token/cost ceiling. Existing private limit overrides still apply. New unrelated conversations can be created, so this is not a global agent sandbox. Clocks should be synchronized. `/peer status` and the main picker show hourly usage; Inbox distinguishes **auto when idle** from **review required**. New arrivals from an authorized sender wait while busy and start one at a time after settlement (15-second polling fallback). Messages predating permission, reattachment/service restart backlog and uncertain turns stay manual. Auto-start does not auto-reply. Keep requests/results brief and link related replies with the inbox parent ID.

After installing 0.2.1, restart Pi and use **Service → Update/reinstall service** on each host. The adapter requires the hourly-limit service capability rather than silently using an older service; protocol/storage remain v2, and no additional destructive migration is introduced. Hosts with the older four-step ceiling may reject messages from updated hosts until both are updated.

## Service, updates and recovery

Private state defaults to `~/.pi/peer-sessions/`; `PI_PEERS_DIR` overrides it. Never put state in the package/repository. Setup stages immutable runtime copies under state, with a package-version/content-hash name, and activates a launchd LaunchAgent or systemd user unit. No root/sudo required.

User services start at **login**; Linux pre-login reboot recovery requires user-service lingering administered separately. macOS requires a login GUI domain. A Node runtime removed by a version-manager update needs `/peer` → **Service → Update/reinstall service** to refresh its path.

After package update, restart Pi and explicitly activate the service release through that menu. Queues/identity remain separate. Activation health failure restores the previous unit when available. **Protocol/storage v2 is incompatible with v1.** Both hosts need the updated service. An outdated service is rejected; use Service → Update/reinstall service rather than silently falling back to machine-wide access.

### Upgrade from v1

Stop peer participation and back up private state first. On activation, the service creates a mode-600 full SQLite snapshot `mailboxes.sqlite.before-project-v2-*` (including committed WAL contents) before a transactional v1→v2 migration. If backup/migration fails, activation fails instead of granting access. Existing sessions are disabled, their auto-start permissions cleared, and queued outgoing mail paused. Re-enable each session to establish its project and approve cross-project cooperation explicitly. Identity, machine trust, inbox/outbox records and conversation budgets are retained.

**Legacy messages lack project identity:** inspect/dismiss incoming records or cancel old outgoing mail; they cannot be accepted or resumed into v2 delivery. Do not automatically replay their work. Re-send only after reviewing prior side effects. Old service binaries refuse v2 storage; service-unit rollback alone does not downgrade a migrated database. A downgrade requires an operator-managed offline restoration of the full private backup, accounting for messages created since migration. Unknown newer storage/protocol versions are rejected. Package removal does not remove state or an already staged service. First stop/uninstall it via the Service menu (or `pi-peer uninstall-service --yes` if the CLI is available).

Back up by stopping the service, then copy the entire private state directory to an encrypted destination. Do not copy just the main DB with live WAL writes. Do not run a copied identity concurrently on LAN. Current storage caps require explicit operator archival when full; deleting deduplication rows prematurely permits replay.

## Development and release

```bash
npm test
npm run check
npm pack
```

Tests use temp private state and loopback services, not personal credentials or OS jobs. Adapter/RPC tests require npm-installed Pi on PATH; core transport/setup tests have no Pi dependency. OS job activation is tested with a fake manager, not by installing a real machine job. Runtime, git/npm packaging, secrets and relative imports are checked before packing.

See [SECURITY.md](SECURITY.md) for release/credential safety, [RELEASE.md](RELEASE.md) for contributor release checks, and [CHANGELOG.md](CHANGELOG.md). Licensed under [MIT](LICENSE), copyright hknatm.

Known unverified boundaries: physical cross-host LAN/firewall, actual launchd/systemd activation/reboot, billable model wake, power-loss and long-duration load. This is an initial release, not a no-bugs guarantee.
