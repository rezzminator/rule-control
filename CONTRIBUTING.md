# Contributing

Thanks for helping. rule-control is small on purpose: one frontmatter key, six
hooks and a fail-open rule. A change that keeps it that way is the easiest to
merge.

## Layout

| Path | Role |
| --- | --- |
| `plugins/rule-control/` | Everything that installs, and nothing else; dev files never go in it |
| `plugins/rule-control/src/visible-to.ts` | The `visible-to` frontmatter reader and loop matching, pure |
| `plugins/rule-control/src/rules.ts` | Which rules a loop receives, the shared-context split, the delivered text, pure |
| `plugins/rule-control/src/agent-types.ts` | A sub-agent's type by its id, from the agent list or its start; the plugin's own module |
| `plugins/rule-control/src/plugin-log.ts` | The plugin's own logging module |
| `plugins/rule-control/hooks/rule-control.ts` | The adapter: finds and reads the rules, resolves a loop, wires the hooks; the only file that touches `$` |
| `tests/` | One vitest file per concern: `visible-to.test.ts` and `rules.test.ts` for the pure functions, `adapter.test.ts` for the hooks against a stand-in engine |
| `types/claude-code.d.ts` | The plugin API, the truth for every hook's shape |

## Set up

```sh
npm install
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
npm test                # vitest: the frontmatter reader, the rule split, the hooks
npm run typecheck       # src and the hooks module against the plugin API types
npm run validate:plugin
npm run release:check   # the version agrees everywhere it is written
```

Try the checkout in a real session with
`claude --plugin-dir plugins/rule-control`, with any installed copy of
rule-control disabled for that run, and a rule file of your own carrying a
`visible-to` key.

## Rules for a change

- A new behaviour lands in `plugins/rule-control/src/` as a pure function, with
  a test in `tests/` that you watched fail first; the adapter only wires it.
- An error never loses a rule: log it with its context and leave the rule
  reaching every loop.
- `$` is passed only to functions declared at the top level of the hooks file
  and always spelled `$.noun.event(...)`; otherwise Claude Code loads the
  module with zero hooks. `npm run validate:plugin` reports it.
- A change in behaviour moves `README.md` and `CHANGELOG.md` (under
  `## [Unreleased]`) in the same pull request.
- No machine-absolute paths or personal data in a tracked file.

## Send it in

1. Fork the repository and branch off `develop`.
2. Make the change with its test; run the four gates above.
3. Open a pull request against `develop`; `main` holds only releases.

Issues labelled
[good first issue](https://github.com/rezzminator/rule-control/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
are a good start. By contributing you agree to license your work under the
repository's [MIT license](./LICENSE) and to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).
