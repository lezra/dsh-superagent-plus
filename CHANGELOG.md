# Changelog

All notable changes to this fork are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the project uses [Semantic Versioning](https://semver.org/).

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
