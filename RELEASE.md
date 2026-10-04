# Release checklist

Repository: https://github.com/hknatm/peer-sessions

Package: `peer-sessions` — MIT license, copyright hknatm.

1. Run `npm test` and `npm run check`. Inspect the tarball (`npm pack --pack-destination /private/release-output`, then `tar -tzf FILE.tgz`). The npm allowlist includes only runtime, extension, license and user documentation.
2. Inspect `git status`, `git diff --cached`, and `git ls-files` before every commit/push. Never upload the surrounding Pi configuration directory. Enable GitHub secret scanning/push protection and private vulnerability reporting where supported.
3. Validate setup on a disposable macOS login user and Linux user with systemd, followed by two physical LAN machines. Confirm install/start, restart, service update/rollback, reboot/login, pair approval/revocation, and actual model wake using a bounded authorized test. CI does not install real user service jobs.
4. Tag an approved release and install through Pi's git package manager on another host. npm publication requires separate owner authorization and registry credentials; the name is not reserved merely by publishing on GitHub.
5. Test success is not a no-bugs guarantee or proof of real OS/LAN deployment. Keep known unverified boundaries in the README until verified.

## Urgent steering 0.3.0 update

Test separate permission, cancellation and revoke/regrant, busy vs non-run-busy injection, multiple messages in one run, consumption/settlement races, abort/crash/reload uncertainty, hourly/chain budgets and legacy LAN capability refusal. Real Pi tests use a local zero-cost provider. Update adapter/service on both hosts; additive `steering_permissions` table defaults empty and wire/storage remain v2. Downgrade with pending urgent work is unsupported; use isolated full-state restore if necessary. Inspect all picker intent/permission screens at narrow/wide terminal widths.

## Hourly-limit 0.2.1 update

Test persistent per-session rolling-hour accounting, duplicate retries, queue retention on receive limits, claim/idle races and one-at-a-time auto draining. Restart Pi and update each host’s service; the adapter checks `session-hourly-v1` capability. Existing limit overrides are preserved. No schema-version change beyond v2. Never test against personal queues or providers; the real lifecycle test uses a local stub with zero usage and no HTTP calls.

## Project-scoped v2 upgrade

0.2.0 requires protocol/storage v2; upgrade the service on both hosts before cooperation. Test the v1 database backup/migration with legacy pending, paused and interrupted messages. Confirm old participation and auto-start are disabled, legacy mail cannot resume/execute, and cross-project approval is reciprocal. Test same checkout/subdirectory/symlink matching and separate worktree/non-Git behavior. Never run these migration tests on personal live state.

A restored service unit is not a database downgrade. Old runtimes reject v2 storage; any downgrade needs an explicit offline full-state restore, preserving/reconciling messages created since the migration. Keep retained pre-migration snapshots private.

## Existing prototype installations

Disable any earlier standalone `peer-sessions` prototype extension through `pi config` before installing this package, to avoid duplicate `/peers` and tool registrations. Private state remains separate and must not be deleted. Only one service may own a state directory. No automatic destructive migration is performed.
