---
name: Bug report
about: A rule reaches a loop its visible-to leaves out, misses a loop it names, or a gate fails
title: ''
labels: bug
assignees: ''
---

**What happened**

<!-- e.g. "a sub-agent of type researcher still follows a rule visible only to main" -->

**What you expected**

**The rule**

```markdown
---
visible-to:
---
```

<!-- The frontmatter, and where the file lives: ~/.claude/rules/, $CLAUDE_CONFIG_DIR/rules/ or a project's .claude/rules/. -->

**Which loop**

<!-- The main chat, or a sub-agent of which type; at its start, after a compaction, or when it touched a file a `paths:` rule names. -->

**Environment**

- Claude Code version (`claude --version`):
- rule-control version (see `/plugin`, or the plugin's `plugin.json`):
- OS:
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set before Claude Code started: yes / no
- Started a new session after editing the rule: yes / no

**Log lines**

<!-- Any line starting with `rule-control:`, and rows from ~/.local/state/rule-control/logs/. Leave out paths or names you would rather keep private. -->
