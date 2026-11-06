# Changelog

All notable changes to this fork are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.5] - 2026-11-07

### Fixed

- Sessions created before the rename run again. DSH stores a Session's working directory when it is created, so the main
  Session and worker Sessions still named `state/dsh-superagent` after the state directory moved to
  `state/dsh-superagent-plus`; every turn failed with `working-directory: directory does not exist`, which made incoming
  Triggers (such as DingTalk messages) time out during assessment instead of becoming Tickets. The old path is now kept
  as a link to the current state directory, including on deployments that moved it on an earlier start.

## [0.4.4] - 2026-11-06

### Fixed

- The DingTalk Source receives robot messages again. DingTalk delivers a robot message as a Stream `CALLBACK` frame, and the
  plugin forwarded only `EVENT` frames: every message was acknowledged and then dropped, leaving the Source `ready` with
  nothing received. Both frame types are handled now, and a `SYSTEM` frame (ping, disconnect) echoes its own headers and
  payload back instead of a `topic`-only acknowledgement.

## [0.4.3] - 2026-11-06

### Fixed

- Sessions persisted before the rename resume again. The agent preset ids are back to `dsh-superagent-worker` and
  `dsh-superagent-router`: DSH stores the selected preset in every Session, so renaming the ids made existing Sessions fail
  with `Unknown agent preset`, which disposed the plugin and left the panel API answering 404.
- The Sources page no longer shows its "no sources installed" state while the first sources request is still in flight.

## [0.4.0] - 2026-11-06

### Changed

- Renamed the package and repository from `dsh-superagent` to `dsh-superagent-plus`. The package can now be installed next
  to the upstream prototype instead of replacing it. The bundle ids, agent presets, skill names, environment defaults,
  scripts and docs use the new name.
- The default state directory is now `$DSH_HOME/state/dsh-superagent-plus`, and the default `lark-cli` configuration
  directory is `~/.lark-cli-dsh-superagent-plus`.
- On first start, an existing `state/dsh-superagent` directory and `~/.lark-cli-dsh-superagent` directory are moved to the
  new defaults when the new paths are absent and no older deployment holds the state lock. Custom paths are left alone.
- Persisted data from the old name keeps working: delivered-message ids and sources, worker shim markers, the managed MCP
  block and stored prompt skill names are recognized and rewritten to the new names.

### Added

- `NOTICE` is included in the published package, with the upstream repository and copyright attribution.
- `SECURITY.md` and `CONTRIBUTING.md`.
- Package metadata: repository, homepage, issue tracker and keywords.
- A `SHA256SUMS` file is published with every release artifact.

### Removed

- Machine-specific paths from the documentation and the Desktop launcher; use `-App` or `DSH_DESKTOP_APP` instead.

## [0.3.38] - 2026-11-06

Last build published under the old package name. See the Git history and the numbered documents in `docs/` for the
features that line carried, including Feishu QR sign-in, the DingTalk Source and Windows Desktop support.
