# Contributing

`dsh-superagent-plus` is an unofficial fork of the public `dsh-superagent` research prototype. Contributions to this fork
are welcome through issues and pull requests; upstream changes are not merged automatically, and a change that only
affects the upstream project belongs there instead.

## Development

Requirements: Node.js `^22.19` or `>=24`, pnpm 11, and a checkout with dependencies installed.

```sh
corepack enable
pnpm install
pnpm check
```

`pnpm check` runs the typecheck, the test suite and the build. Typecheck and build run on every platform. On Windows some
test suites are POSIX-only or need extra setup:

- `tests/service-script.spec.ts` exercises the POSIX/tmux service script and needs `fcntl`;
- deployment tests create symlinks, which Windows allows only with Developer Mode or elevated permissions;
- CLI shim tests require `gh` on `PATH`;
- permission-bit tests assume POSIX mode bits.

Run the full suite on Linux or macOS before submitting a change that touches those areas, and say which suites you ran.
On Windows, `pnpm typecheck && pnpm build` plus the suites that pass locally is a useful partial check, not a substitute.

## Pull requests

- Keep a change focused; do not mix formatting, refactors and behavior changes.
- Add or update tests for behavior changes, and describe the verification commands you ran.
- Use commit messages of the form `<type>(<scope>): <subject>`, with `type` one of `feat`, `fix`, `docs`, `refactor`,
  `chore` or `test`.
- Update `CHANGELOG.md` for user-visible changes.
- Do not include credentials, private repository content or machine-specific paths.

## License

By contributing, you agree that your contribution is licensed under the MIT License in [LICENSE](LICENSE). The upstream
copyright notice and attribution in [NOTICE](NOTICE) must be preserved, including in forks and redistributions.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
