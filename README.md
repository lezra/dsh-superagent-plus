# dsh-superagent-plus

> **Unofficial fork, for research use only, not an official DeepSeek product.** This code grew out of day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> This fork adds its own changes on top of the public `dsh-superagent` prototype; it is not identical to the upstream publication or to the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented here.

The main additions over upstream are Feishu QR sign-in through `lark-cli`, a DingTalk Source, and Windows Desktop support. Because the package name differs from upstream, this fork can be installed next to it; a deployment can use only one of them at a time.

## Download

Ready-to-install builds are published on the [Releases page](https://github.com/lezra/dsh-superagent-plus/releases). Download
`dsh-superagent-plus-<version>.tgz`, verify it against `SHA256SUMS` from the same release, and install it as described in
[docs/009-install.md](docs/009-install.md).

```sh
sha256sum -c SHA256SUMS --ignore-missing
# PowerShell: Get-FileHash .\dsh-superagent-plus-<version>.tgz -Algorithm SHA256
```

Upgrading from the old `dsh-superagent` package: remove that plugin from the profile first (Desktop: **插件** → remove;
CLI: `dsh plugin --profile <name> remove dsh-superagent`), then install this package and restart. On first start the old
state directory and `lark-cli` configuration directory are moved to the new defaults automatically.

dsh-superagent-plus is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

Each Source is optional: a deployment runs with GitHub, with Feishu, or with both, and the runtime also runs on Windows (see Platform in [docs/006-deployment.md](docs/006-deployment.md)). With Feishu only, prompts replace the pull-request rules with a committed branch, and the built-in GitHub skill is not registered.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent-plus with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

To install and connect a Source by hand, including the Desktop `.tgz` install and the one-scan setup for both Feishu and
DingTalk, follow [docs/009-install.md](docs/009-install.md). Both Sources can be created by scanning in the panel — Feishu
through `lark-cli`, DingTalk through its app-registration device flow — so a deployment needs no copied app credentials for
the first run. If Desktop shows no Superagent entry, `scripts\desktop-doctor.ps1` prints which step is missing.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source
- [009 Install and configure](docs/009-install.md): dependencies, Desktop and CLI install, Feishu QR sign-in, troubleshooting
- [010 DingTalk Source](docs/010-dingtalk.md): the internal app, Stream mode, the panel's fields, and what to check

## Development

`pnpm check` runs the typecheck, the tests and the build.

Run the commands below from the checkout root:

```powershell
# 更新插件：构建、打包、安装、重启并校验
node scripts\update-plugin.mjs

# web
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-superagent-plus.ps1
# 加 -NoOpen 则不自动开浏览器

# 关闭 web 进程（默认端口 3082）
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3082 -State Listen).OwningProcess

# desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-desktop.ps1
```

## Credits

This project is an unofficial fork of the public [`dsh-superagent`](https://github.com/deepseek-ai/dsh-superagent-prototype)
research prototype by the DeepSeek Harness Team, used under the MIT License. The original copyright notice is kept in
[LICENSE](LICENSE); see [NOTICE](NOTICE) for details. It is not affiliated with or endorsed by DeepSeek.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request guidelines, and [SECURITY.md](SECURITY.md) for
private vulnerability reporting. Changes to the upstream prototype itself belong in the
[upstream repository](https://github.com/deepseek-ai/dsh-superagent-prototype).

## License

[MIT](LICENSE)
