# Getting help

- **A rule still reaches a loop it should not, or never reaches one it should.**
  Function hooks must be on (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`) before
  Claude Code starts, and rules are read at each main-chat session start:
  start a new session or `/clear` after an edit. Check that the rule lives
  under `~/.claude/rules/` (or `$CLAUDE_CONFIG_DIR/rules/`) or a project's
  `.claude/rules/`, that `visible-to` is a top-level frontmatter key, and that
  no `rule-control:` line reports it as malformed. A loop is named by its agent
  type (`general-purpose`, not the agent's description); see
  [Limits](./README.md#️-limits).
- **A question about using rule-control.**
  [Open an issue](https://github.com/rezzminator/rule-control/issues/new/choose)
  with the Question template.
- **A bug.** Use the bug report template; include `claude --version`, the
  rule-control version, the rule's frontmatter, and any `rule-control:` line
  from the screen or the plugin log.
- **A security problem.** Follow [SECURITY.md](./SECURITY.md), never a public
  issue.
