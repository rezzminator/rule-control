# Security policy

## Supported versions

Only the latest release of rule-control gets security fixes. The current
version is in [CHANGELOG.md](./CHANGELOG.md).

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately
through GitHub's
[private vulnerability reporting](https://github.com/rezzminator/rule-control/security/advisories/new)
(the repository's **Security** tab, **Report a vulnerability**).

Include what you found, the steps to reproduce it, the Claude Code version
(`claude --version`) and the rule-control version.

## What rule-control touches

Useful when judging impact:

- It reads the rule files (`*.md`) under `rules/` in `$CLAUDE_CONFIG_DIR`
  (else `~/.claude`) and under `.claude/rules/` of the session's directory and
  each directory above it, at each main-chat session start, and a nested
  `.claude/rules/` file when Claude Code delivers it.
- It reads the `CLAUDE_CONFIG_DIR`, `HOME` and `PLUGIN_LOG_DIR` environment
  variables, the session's directory and id, and the session's list of running
  agents (to learn a sub-agent's type from its id).
- It removes rule files from the instruction context Claude Code shares with
  every loop, adds those rules as hook context to the loops they name, and
  withholds a path-scoped rule from a loop it leaves out; it changes nothing
  else.
- It writes its own log files under `$PLUGIN_LOG_DIR/rule-control/` (else
  `$HOME/.local/state/rule-control/logs/`), private to the user, holding rule
  paths, agent types and ids, never a rule's body, a prompt or a transcript.
- It makes no network request and calls no model.

rule-control is a convenience, not a security boundary: it fails open, so any
error leaves a rule reaching every loop. Do not put a secret in a rule file and
rely on `visible-to` to keep it from a loop.
