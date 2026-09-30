# Release checklist

Repository: https://github.com/hknatm/peer-sessions

Package: `peer-sessions` — MIT license, copyright hknatm.

1. Run `npm test` and `npm run check`. Inspect the tarball (`npm pack --pack-destination /private/release-output`, then `tar -tzf FILE.tgz`). The npm allowlist includes only runtime, extension, license and user documentation.
2. Inspect `git status`, `git diff --cached`, and `git ls-files` before every commit/push. Never upload the surrounding Pi configuration directory. Enable GitHub secret scanning/push protection and private vulnerability reporting where supported.
3. Validate setup on a disposable macOS login user and Linux user with systemd, followed by two physical LAN machines. Confirm install/start, restart, service update/rollback, reboot/login, pair approval/revocation, and actual model wake using a bounded authorized test. CI does not install real user service jobs.
4. Tag an approved release and install through Pi's git package manager on another host. npm publication requires separate owner authorization and registry credentials; the name is not reserved merely by publishing on GitHub.
5. Test success is not a no-bugs guarantee or proof of real OS/LAN deployment. Keep known unverified boundaries in the README until verified.

## Existing prototype installations

Disable any earlier standalone `peer-sessions` prototype extension through `pi config` before installing this package, to avoid duplicate `/peers` and tool registrations. Private state remains separate and must not be deleted. Only one service may own a state directory. No automatic destructive migration is performed.
