# Changelog

Every release of rule-control. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `rule-control--v<version>`, with a GitHub release carrying the section below.

## [0.1.2] — 2026-11-01

### Fixed

- When finding the rules fails part way, the rules found before the failure stay targeted and only the rest reach every loop, where every rule reached every loop; the `discovery-failed` error says so and counts the rules kept.
- A rule file whose frontmatter opens with `---`, never closes, and holds a `visible-to` key is named in a `frontmatter-problem` error: the key is not read, and the rule reaches every loop.
- A `nested_memory` attachment whose first line names no file is logged as a `nested-header-unread` error, also on screen, and delivered whole to its loop.
- When listing agents fails, a sub-agent takes the type announced at its start instead of being treated as unknown; the `agent-list-failed` error names the type it took.
- Log rows built while the plugin log cannot be opened are held and written, oldest first, by the next write that can; the on-screen notice says how many rows are held.

## [0.1.1] — 2026-11-01

### Changed

- rule-control ships its own marketplace, named `professor`: install with `claude plugin marketplace add rezzminator/rule-control`, then `claude plugin install rule-control@professor`. The README's install steps say so.
- The log writer and the agent-type lookup are rule-control's own code, no longer copies kept identical to another repository's; logging behaves as before.

## [0.1.0] — 2026-10-31

### Added

- A `visible-to` key in a rule file's frontmatter, with optional `include` and `exclude` lists of loops: `main` for the main chat, an agent type, or a `*` glob. A rule reaches the loops `include` matches (every loop when absent) minus those `exclude` matches; a rule without the key reaches every loop.
- Rules are read from `$CLAUDE_CONFIG_DIR/rules/` (else `~/.claude/rules/`) and `.claude/rules/` in the session's directory and each directory above it, below the home directory, subdirectories and symbolic links included, at each main-chat session start.
- Each targeted rule leaves the instruction context Claude Code shares with every loop. The main chat is given the rules that name `main` at each session start; a sub-agent is given the rules its agent type matches at its start.
- A compacted loop is given its own rules again: `session.compact` names the loop, and the `SessionStart` that follows the compaction delivers to it, so a sub-agent's compaction never gives it the main chat's rules.
- A path-scoped rule (`paths:`) that also carries `visible-to` is withheld from a loop `visible-to` leaves out; a nested `.claude/rules/` file Claude Code loads on demand is read when delivered.
- Every error fails open: a malformed `visible-to`, an unreadable rule or directory, a sub-agent whose type cannot be resolved, or a hook that throws is logged with its context, and the rule reaches every loop. Errors also show on screen.
- Plugin log rows (`errors`, `warnings`, `info`, `debug`) under `$PLUGIN_LOG_DIR/rule-control/`, else `$HOME/.local/state/rule-control/logs/`, written by the shared plugin-log library, vendored byte-identical as `src/plugin-log.ts`.

### Known limits

- Claude Code only: Codex and OpenCode, and any tool that mirrors these rules to them, deliver a targeted rule to every loop.
- Rule files only; a `CLAUDE.md` file reaches every loop.
- A targeted rule reaches a loop as hook context, not inside the system prompt.
- A targeted rule that imports files (`@path`) stays in the shared context and reaches every loop.
- A compaction answered by a hook running before rule-control, or two overlapping compactions, gives that loop every targeted rule.
- At a session's first start the main chat is given its targeted rules even where `claudeMdExcludes` excludes them.
