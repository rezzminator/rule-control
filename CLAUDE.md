# rule-control — a Claude Code function-hooks plugin: a `visible-to` key in a rule file's frontmatter names the loops that receive the rule

Every user installs from `main`: a rule this plugin drops and fails to hand on is lost from that loop without a word.

Where Vocabulary, Runtime or On demand disagrees with the code on a path, command or convention, follow the code and name each mismatch in your reply; `# Rules` binds regardless.

# Vocabulary

- spec: the plugin's promised behaviour · `README.md`
- loop: the main chat, named `main`, or one sub-agent, named by its agent type · `plugins/rule-control/src/visible-to.ts`
- `visible-to`: the top-level frontmatter key naming the loops a rule reaches, `include` minus `exclude`, `*` globs · `plugins/rule-control/src/visible-to.ts`
- targeted rule: a rule whose readable `visible-to` leaves some loop out and that has no `paths:`; it leaves the shared context and is handed to each loop it names · `plugins/rule-control/src/rules.ts`
- shared context: the instruction files Claude Code renders once for every loop, answered by `prompt.context` · `types/claude-code.d.ts`
- installable plugin: the folder the install copies whole · `plugins/rule-control/`
- adapter: the only file that touches `$`; it finds and reads the rules, resolves a loop's agent type and wires the hooks to `plugins/rule-control/src/` · `plugins/rule-control/hooks/rule-control.ts`
- plugin-log: the shared logging library, a byte-identical copy of its canonical source, https://github.com/rezzminator/professor/tree/main/plugins/plugin-log/ts · `plugins/rule-control/src/plugin-log.ts`
- agent types: a sub-agent's type by its id, a byte-identical copy of tool-visibility-controller's · `plugins/rule-control/src/agent-types.ts`
- plugin API: the function-hooks types of the Claude Code version CI pins, the truth for every hook's shape · `types/claude-code.d.ts`
- tests: one vitest file per concern; `adapter.test.ts` drives the hooks against a stand-in engine · `tests/`
- release check: the version agrees in all four places and `CHANGELOG.md` has its dated section · `scripts/release-check.sh`, `Makefile`
- release workflow: the CI, run on the `develop → main` pull request · `.github/workflows/release.yml`
- gitter: this repository's only git writer · `.claude/agents/gitter.md`

# Runtime

## Claude

- Live check: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/rule-control`, any installed copy of rule-control disabled for that run, a rule of your own carrying `visible-to`.

## Local

- Node 22.12 or later; `mise exec node@22 --` supplies it where the shell has none.
- Done gate, green before every commit: `npm test`, `npm run typecheck`, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npm run validate:plugin` (needs the `claude` CLI), `npm run release:check`.
- Narrowest test: `npx vitest run tests/{file}.test.ts -t '{test name}'`.

## CI

- `check` (`make check`) and `release` (`make release`) gate the `develop → main` pull request; no CI runs on a push. Its merge runs `publish`, which tags the merge commit `rule-control--v{X.Y.Z}` and publishes the GitHub release from the CHANGELOG section.

# On demand

- Before using a hook event in `plugins/rule-control/hooks/rule-control.ts`: grep its shape in `types/claude-code.d.ts`.

# Rules

## Publication

- **Nothing identifying ships:** NEVER a machine-absolute path (`/home/…`, `/Users/…`), personal data or a private project name in a tracked file, a commit message or a pull request body · guard `.claude/agents/gitter.md`
- **`main` is release-only:** it moves only by merging the `develop → main` pull request with a merge commit, after `check` and `release` pass; NEVER a direct push, a squash or an admin override · guard `main is release-only` ruleset
- **`develop` keeps its history:** NEVER force-push or delete it · guard `develop keeps its history` ruleset
- **Code is pushed, and a release cut, only on the owner's ask;** README and marketing commits on `develop` are pushed as soon as they are committed · guard `.claude/agents/gitter.md`

## Code

- A new behaviour lands in `plugins/rule-control/src/` as a pure function with a test in `tests/` watched failing first; the adapter only wires it.
- An error leaves the rule reaching every loop, logged with its context.
- `$` is passed only to functions declared at the adapter's top level and always spelled `$.noun.method(...)`, else Claude Code loads the module with zero hooks; `npm run validate:plugin` reports a breach.
- plugin-log and agent types change only in their canonical sources, then are copied in byte-identical.
- A tracked dev file stays outside `plugins/rule-control/`.

## Branches and releases

- `develop` is the default branch: every change lands there, by a commit or a pull request.
- A release, in order:
  1. On `develop`: bump the version in `plugins/rule-control/.claude-plugin/plugin.json`, `package.json`, `package-lock.json` and the README badge, and move `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] — {date}`; a pre-release suffix becomes the real version, since every merge into `main` publishes.
  2. `make release-check` passes, after `git fetch origin main`.
  3. Open the `develop → main` pull request.
  4. Merge it once `check` and `release` are green; `publish` tags and releases, and no tag is pushed by hand.
- Semantic versioning: a fix is a patch; a new option or behaviour a minor; a renamed or removed option a major, its CHANGELOG entry saying how to migrate.
- Git writes go through gitter.
