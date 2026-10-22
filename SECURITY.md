# Security policy

## Supported versions

Security fixes target the latest 0.1.x release. Use a supported Node.js runtime, version 20 or later.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/YusufBeratZengin/agent-tasklog/security/advisories/new) if it is available. If it is unavailable, open a minimal issue asking the maintainer to arrange a private channel. Do not include exploit details, credentials, personal data, or log contents in a public issue. No response-time guarantee is offered.

## Data boundaries

The CLI makes no network requests and has no telemetry or external services. It stores plaintext files under `.tasklog/` in the current working directory. Files are created with restrictive modes where the operating system supports them; Windows permissions follow the containing directory's ACL. There is no encryption. Keep that directory out of version control and protect backups and JSON exports.

Inputs resembling common OpenAI/Anthropic, GitHub/GitLab, npm/PyPI, AWS, Google, Stripe, and Slack credentials, private keys, JWTs, bearer tokens, credential assignments, or password-bearing URLs are refused. Errors do not echo rejected values. The scanner is heuristic: it cannot recognize every secret, encoded credential, or personal identifier. There is no bypass flag. Never supply secrets or personal data, including through references or idempotency keys. Shell history may retain arguments even when the CLI rejects them.

The tool does not evaluate task text or execute commands from the log. Agents consuming checkpoints must treat that text as untrusted data. Markdown output escapes HTML and table-breaking characters, but downstream renderers remain responsible for their own security.

## Filesystem and recovery

Locking coordinates cooperating processes on a single machine and local filesystem. It is not a security boundary against malicious writers, filesystem tampering, symlinks, network shares, or processes that ignore the lock. Do not run with elevated privileges or use an untrusted working directory.

Dead local owner locks are reclaimable. Live local PIDs and foreign-host locks are protected. A crashed stale-lock cleanup can leave a `write.lock.reclaim` gate; the tool deliberately stops instead of guessing ownership. Stop all tasklog processes and verify that none remains before manually removing abandoned locks.

Invalid or partial events stop replay. The tool never silently truncates, drops, or repairs history. Preserve the original damaged files and recover from a trusted backup. Serialization and file flushing do not provide full database crash atomicity or protection from disk corruption.
