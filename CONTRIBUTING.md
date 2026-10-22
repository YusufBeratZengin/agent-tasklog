# Contributing

Use Node.js 20 or later. Keep the runtime dependency-free and support Windows and Ubuntu. Discuss changes to the event schema before implementing them; existing append-only histories must remain readable or fail with an explicit version error.

## Checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm test
git config core.hooksPath .githooks
```

Lint checks JSON, whitespace, common credential patterns, JavaScript syntax with `node --check`, and both README command tables against `--help`. The pre-commit hook checks staged files, including credentials. Do not bypass a failed hook. Tests use `node:test`, with temporary workspaces under ignored `is/`. Keep regression tests focused on observable behavior, including concurrent writers and crash recovery boundaries. The normal suite must run without skipped tests before release; sandbox-only checks are described in the README.

Use small English [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), such as `fix: reject invalid calendar dates`. Include the problem, resulting behavior, and actual verification results in pull requests. Update both READMEs for user-visible changes and add an entry to the changelog.

Do not add real credentials, personal data, local log files, or generated archives to examples, tests, commits, or issues. Build synthetic credential fixtures from fragments so the credential scanner does not mistake source fixtures for leaked keys. Report security issues through the process in [SECURITY.md](SECURITY.md).

Repository: [YusufBeratZengin/agent-tasklog](https://github.com/YusufBeratZengin/agent-tasklog).

## Releasing

Publishing uses npm trusted publishing (OIDC) through `.github/workflows/release.yml`.
Before the first release, configure the npm package trusted publisher for owner
`YusufBeratZengin`, repository `agent-tasklog`, workflow `release.yml`, and GitHub
environment `npm`. Create that environment in the repository and enable private
vulnerability reporting. The workflow uses Node 24 and its bundled npm (trusted
publishing requires npm 11.5.1 or newer). No registry token is required or stored.
If trusted publishing is unavailable, stop and fix its configuration before releasing.

1. Run `npm run lint`, `npm test`, and `npm pack --dry-run` with no skipped tests.
2. Move the relevant Unreleased entries to a dated release section in CHANGELOG.md.
   Choose a SemVer version; breaking changes during 0.x require a minor bump.
3. Update package.json and package-lock.json to that version and rerun the checks.
4. The maintainer commits with `chore(release): vX.Y.Z`, then creates a matching
   `vX.Y.Z` tag and pushes it when ready to publish.

The tag workflow checks that the tag matches package.json, runs lint and tests,
checks the package contents, and runs `npm publish --provenance --access public`.
Use only `release.yml` as the publishing workflow; a second tag publisher would
race it. Review the npm package contents and provenance after the first release.
The improvement pass leaves version 0.1.0 unchanged and does not run publishing.
