# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> This fork adds its own changes on top of the public prototype; it is not identical to the upstream publication or to the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented here.

dsh-superagent is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

Each Source is optional: a deployment runs with GitHub, with Feishu, or with both, and the runtime also runs on Windows (see Platform in [docs/006-deployment.md](docs/006-deployment.md)). With Feishu only, prompts replace the pull-request rules with a committed branch, and the built-in GitHub skill is not registered.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-superagent.ps1
# 加 -NoOpen 则不自动开浏览器

# 关闭 web 进程（默认端口 3082）
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3082 -State Listen).OwningProcess

# desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-desktop.ps1
```

## Credits

This project is a fork of the public `dsh-superagent` research prototype by the DeepSeek Harness Team, used under the MIT
License. The original copyright notice is kept in [LICENSE](LICENSE); see [NOTICE](NOTICE) for details.

## License

[MIT](LICENSE)
