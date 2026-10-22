# Contributing

Use Node.js 20 or later. Keep the runtime dependency-free and support Windows and Ubuntu. Discuss changes to the event schema before implementing them; existing append-only histories must remain readable or fail with an explicit version error.

## Checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm test
git config core.hooksPath .githooks
```

Lint checks JSON, whitespace, and common credential patterns. The pre-commit hook checks staged files, including credentials. Do not bypass a failed hook. Tests use `node:test`, with temporary workspaces under ignored `is/`. Keep regression tests focused on observable behavior, including concurrent writers and crash recovery boundaries. The normal suite must run without skipped tests before release; sandbox-only checks are described in the README.

Use small English [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), such as `fix: reject invalid calendar dates`. Include the problem, resulting behavior, and actual verification results in pull requests. Update both READMEs for user-visible changes and add an entry to the changelog.

Do not add real credentials, personal data, local log files, or generated archives to examples, tests, commits, or issues. Build synthetic credential fixtures from fragments so the credential scanner does not mistake source fixtures for leaked keys. Report security issues through the process in [SECURITY.md](SECURITY.md).

Repository: [YusufBeratZengin/agent-tasklog](https://github.com/YusufBeratZengin/agent-tasklog).
