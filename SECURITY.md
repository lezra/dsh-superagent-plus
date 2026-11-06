# Security policy

`dsh-superagent-plus` is a research prototype. It is not production-ready software, and no version is supported with a
service-level commitment. Security fixes are made on the latest release only.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting:

<https://github.com/lezra/dsh-superagent-plus/security/advisories/new>

Include the affected version, the deployment mode (Desktop or CLI profile), the Source involved (GitHub, Feishu or
DingTalk), reproduction steps and the impact you expect. Never include real bot secrets, tokens or private repository
content; redact them. You will get an acknowledgement when the report is read, and a fix or mitigation when one is ready.

## Known limitations

These are design limits of the prototype, not vulnerabilities to report:

- DingTalk `AppKey` and `AppSecret` are stored in the deployment's settings database in clear text. Give each deployment
  its own DingTalk app and protect the state directory with operating-system permissions.
- Worker Sessions run commands as the operator's OS user. `blockedCommands`, the CLI shims and the environment isolation
  are guardrails, not an operating-system sandbox.
- The management panel is served on localhost by default and has no user authentication of its own. Do not expose it to an
  untrusted network.
- Feishu credentials live in the `lark-cli` configuration directory outside the state directory; protect that directory as
  well.

## Upstream

The upstream `dsh-superagent` prototype has its own security policy. Report upstream issues through
<https://github.com/deepseek-ai/dsh-superagent-prototype/security>.
