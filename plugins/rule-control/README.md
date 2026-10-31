# rule-control

Claude Code plugin for per-loop rule delivery — a rule file names the loops that receive it: the main chat, chosen agent types, or all.

Add a top-level `visible-to: { include: [...], exclude: [...] }` key to the frontmatter of a rule file in `~/.claude/rules/` (or `$CLAUDE_CONFIG_DIR/rules/`) or a project's `.claude/rules/`: it names the loops (`main` for the main chat, agent types, `*` globs) that receive the rule. Claude Code gives every rule to every loop in one shared instruction context; rule-control takes each targeted rule out of it and hands it to the main chat at each session start and to a sub-agent at its start, again after each compaction of that loop, and withholds a path-scoped rule from a loop it leaves out. A rule without the key reaches every loop, as before. Rules are read at each main-chat session start. Any error, a malformed `visible-to` included, is logged with its context and leaves the rule reaching every loop.

Install with `claude plugin install rule-control@professor` after `claude plugin marketplace add rezzminator/professor`. Requires function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`). Limits: Claude Code only (a mirror of these rules for Codex or OpenCode delivers a targeted rule to every loop), rule files only (not `CLAUDE.md`), and a targeted rule arrives as hook context rather than in the system prompt. Remove it with `claude plugin uninstall rule-control@professor`. Full documentation: <https://github.com/rezzminator/rule-control>

Built and maintained with [Professor](https://github.com/rezzminator/professor).
