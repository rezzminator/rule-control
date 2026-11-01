import type { EngineInterface, HookFailure, Register } from 'claude-code';
import { levelRow, PLUGIN_LOG_HOLD_ROWS, pluginLogDir, PluginLogQueue, type PluginLogLevel } from '../src/plugin-log.ts';
import { AgentTypes } from '../src/agent-types.ts';
import { ancestorDirs, nestedPath, render, rulesFor, splitShared, targeted, type Rule, type Tier } from '../src/rules.ts';
import { admits, MAIN, readRule } from '../src/visible-to.ts';

// Thin adapter: every decision lives in src/. Claude Code answers the shared
// instruction context once for every loop, so a targeted rule leaves it and
// reaches each loop it names on its own: main at each SessionStart, a sub-agent
// at SubagentStart. A compaction drops what a loop was given; Claude Code then
// fires SessionStart (compact) into the compacted loop with nothing naming it,
// so each session.compact, which names its loop, is paired with the next one.
// A failure is logged with its context and the rule goes on reaching every loop.

const PLUGIN = 'rule-control';

type Snapshot = { rules: Map<string, Rule>; byAlias: Map<string, Rule> };
/** `held`: rows built while no queue could be made, written by the first that can, oldest first. */
type LogState = { work: Promise<void>; queue?: PluginLogQueue; session?: Promise<string | undefined>; held: string[]; failing: boolean };
type State = {
  snapshot?: Promise<Snapshot>;
  /** Rules read on demand for a `nested_memory` attachment, by the path it names. */
  nested: Map<string, Promise<Rule | undefined>>;
  /** Rules main was given at its last session start. */
  mainGiven: Set<string>;
  /** Files the engine put in the last shared context; undefined before the first. */
  engineLoaded?: Set<string>;
  /** Rules the last shared context left out; undefined before the first, when every targeted rule is handed on. */
  dropped?: Set<string>;
  /** The loops compacting (an agent id, or `main`), oldest first, each waiting for its SessionStart (compact). */
  compacting: string[];
  /** Bumped by each start and each failure, so a hook that outlived its budget changes nothing. */
  startGen: number;
  contextGen: number;
  types: AgentTypes;
  /** Problems already logged, one row each per module life. */
  reported: Set<string>;
  log: LogState;
};

function message(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : String(error);
}

function missing(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code === 'ENOENT';
  // Claude Code words it `<plugin>: $.fs.list(<path>) failed: ENOENT`, with no code.
  return /\bENOENT\b/.test(message(error));
}

// Claude Code puts the plugin's name before each line itself.
function show($: EngineInterface, text: string): void {
  try { $.ui.log(text.startsWith(`${PLUGIN}: `) ? text.slice(PLUGIN.length + 2) : text); } catch {
    // No other screen door exists when ui.log itself is unavailable.
  }
}

// Error rows show on screen too; every row goes to the plugin log, written in order behind the ones before it.
function plog($: EngineInterface, state: State, level: PluginLogLevel, event: string, msg: string, hook: string, detail?: Record<string, unknown>): void {
  if (level === 'error') show($, msg);
  const at = Date.now();
  const log = state.log;
  log.work = log.work.then(async () => {
    log.session ??= $.session.id().catch(() => undefined);
    log.held.push(levelRow({ plugin: PLUGIN, level, event, msg, where: `hooks/rule-control.ts#${hook}`, session: await log.session, detail }, at));
    // shortcut: past the hold the oldest held row goes uncounted; count it if a queue ever stays unmakeable for long.
    if (log.held.length > PLUGIN_LOG_HOLD_ROWS) log.held.shift();
    log.queue ??= new PluginLogQueue(pluginLogDir(await $.env.get('PLUGIN_LOG_DIR'), await $.env.get('HOME'), PLUGIN), PLUGIN);
    for (const row of log.held.splice(0)) log.queue.add(row);
    const result = await log.queue.flush((argv) => $.process.run(argv, { timeoutMs: 5000 }));
    if (result.screen !== undefined) show($, result.screen);
    log.failing = false;
  }).catch((error) => {
    const held = log.held.length;
    if (!log.failing) show($, held > 0 ? `plugin log unavailable: ${message(error)}; ${held} ${held === 1 ? 'row is' : 'rows are'} held for the next write` : `plugin log unavailable: ${message(error)}; the ${event} row is not written`);
    log.failing = true;
  });
}

// One row per distinct problem per module life: a rule read at every start would repeat it.
function report($: EngineInterface, state: State, level: PluginLogLevel, event: string, msg: string, hook: string, detail?: Record<string, unknown>): void {
  if (state.reported.has(msg)) return;
  state.reported.add(msg);
  plog($, state, level, event, msg, hook, detail);
}

function failureText(hook: string, failure: Pick<HookFailure, 'kind' | 'message'>, context: string): string {
  return `${PLUGIN}: ${hook} failed; ${context} (${failure.kind}: ${failure.message ?? 'engine supplied no failure message'})`;
}

async function readRuleFile($: EngineInterface, state: State, path: string, real: string, tier: Tier): Promise<Rule | undefined> {
  let text: string;
  try {
    text = await $.fs.read(path);
  } catch (error) {
    report($, state, 'error', 'rule-unreadable', `${PLUGIN}: reading ${path} failed: ${message(error)}; its visible-to is not read, the rule reaches every loop the engine gives it to`, 'readRuleFile', { error: message(error), path });
    return undefined;
  }
  const read = readRule(text);
  if (read.problem !== undefined) report($, state, 'error', 'frontmatter-problem', `${PLUGIN}: ${path}: ${read.problem}; the rule is kept and reaches every loop`, 'readRuleFile', { error: read.problem, path });
  return { path: real, tier, ...read };
}

// Every `*.md` under a rules directory, links followed, each file once by its real path.
async function walk($: EngineInterface, state: State, dir: string, tier: Tier, snapshot: Snapshot, seen: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await $.fs.list(dir);
  } catch (error) {
    if (!missing(error)) report($, state, 'error', 'rules-dir-unlisted', `${PLUGIN}: listing ${dir} failed: ${message(error)}; its rules are not read and reach every loop the engine gives them to`, 'walk', { error: message(error), path: dir });
    return;
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${entry.name}`;
    let kind = entry.kind;
    let real = path;
    try {
      const stat = await $.fs.stat(path, { resolve: true });
      kind = stat.kind;
      real = stat.realPath ?? path;
    } catch (error) {
      report($, state, 'error', 'rule-unreadable', `${PLUGIN}: resolving ${path} failed: ${message(error)}; it is not read`, 'walk', { error: message(error), path });
      continue;
    }
    if (kind === 'dir') {
      if (seen.has(real)) continue;
      seen.add(real);
      await walk($, state, path, tier, snapshot, seen);
    } else if (kind === 'file' && entry.name.endsWith('.md')) {
      const known = snapshot.rules.get(real);
      if (known !== undefined) {
        snapshot.byAlias.set(path, known);
        continue;
      }
      const rule = await readRuleFile($, state, path, real, tier);
      if (rule === undefined) continue;
      snapshot.rules.set(real, rule);
      snapshot.byAlias.set(path, rule);
    }
  }
}

// The user tier (`$CLAUDE_CONFIG_DIR/rules`, else `~/.claude/rules`), then `.claude/rules` in the session root and each directory above it, below home.
// Fills `snapshot` as it goes, so a failure part way keeps what was found.
async function discover($: EngineInterface, state: State, snapshot: Snapshot): Promise<Snapshot> {
  const home = (await $.env.get('HOME')) || undefined;
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home === undefined ? undefined : `${home.replace(/\/+$/, '')}/.claude`);
  if (config === undefined) report($, state, 'error', 'user-tier-skipped', `${PLUGIN}: neither CLAUDE_CONFIG_DIR nor HOME is set; user rules are not read and reach every loop`, 'discover');
  else await walk($, state, `${config.replace(/\/+$/, '')}/rules`, 'user', snapshot, new Set());
  for (const dir of ancestorDirs(await $.session.root(), home)) {
    await walk($, state, `${dir === '/' ? '' : dir}/.claude/rules`, 'project', snapshot, new Set());
  }
  return snapshot;
}

function snapshotOf($: EngineInterface, state: State, fresh: boolean): Promise<Snapshot> {
  if (fresh || state.snapshot === undefined) {
    state.nested.clear();
    const snapshot: Snapshot = { rules: new Map(), byAlias: new Map() };
    state.snapshot = discover($, state, snapshot).catch((error) => {
      report($, state, 'error', 'discovery-failed', `${PLUGIN}: finding the rules failed: ${message(error)}; the rules found before it stay targeted, every other rule reaches every loop`, 'discover', { error: message(error), found: snapshot.rules.size });
      return snapshot;
    });
  }
  return state.snapshot;
}

// A `nested_memory` file: a rule found at discovery, else one read now when it sits in a rules directory.
async function ruleAt($: EngineInterface, state: State, path: string): Promise<Rule | undefined> {
  const snapshot = await snapshotOf($, state, false);
  const known = snapshot.byAlias.get(path) ?? snapshot.rules.get(path);
  if (known !== undefined || !path.includes('/.claude/rules/') || !path.endsWith('.md')) return known;
  let read = state.nested.get(path);
  if (read === undefined) {
    read = readRuleFile($, state, path, path, 'project');
    state.nested.set(path, read);
  }
  return read;
}

// A loop's agent type; undefined, said once per loop, when nothing names it.
async function loopOf($: EngineInterface, state: State, agentId: string, action: string, hook: string): Promise<string | undefined> {
  const failures: unknown[] = [];
  const type = await state.types.of(agentId, () => $.agent.list(), (error) => failures.push(error));
  for (const error of failures) plog($, state, 'error', 'agent-list-failed', `${PLUGIN}: listing agents failed: ${message(error)} ${action}; loop ${agentId} ${type ? `takes its announced type ${type}` : 'is treated as unknown'}`, hook, { error: message(error), agentId, ...(type ? { type } : {}) });
  if (type) return type;
  if (state.types.firstMiss(agentId)) {
    if (state.types.named(agentId)) plog($, state, 'error', 'loop-unresolved', `${PLUGIN}: loop ${agentId} resolves to no agent type ${action}; its rules are delivered as if every rule named it`, hook, { agentId, action });
    else plog($, state, 'debug', 'engine-loop', `${PLUGIN}: loop ${agentId} is the engine's own (no agent list row or SubagentStart names it) ${action}; its rules are delivered as if every rule named it`, hook, { agentId, action });
  }
  return undefined;
}

// The targeted rules a loop receives; an unknown loop receives every one the shared context left out.
function giveTo(snapshot: Snapshot, state: State, loop: string | undefined): Rule[] {
  if (loop !== undefined) return rulesFor(snapshot.rules.values(), loop, state.dropped);
  return [...snapshot.rules.values()].filter((rule) => targeted(rule) && (state.dropped === undefined || state.dropped.has(rule.path)));
}

// A sub-agent's targeted rules, handed on with the result of its start or its compaction's SessionStart;
// with no agent id, a loop nothing names.
async function handOn<R extends { additionalContext?: string[] }>($: EngineInterface, state: State, agentId: string | undefined, agentType: string | undefined, result: R, when: string, hook: string): Promise<R> {
  if (agentId !== undefined && agentType) state.types.learn(agentId, agentType);
  const loop = (agentId === undefined ? undefined : await loopOf($, state, agentId, `at ${when}`, hook)) ?? (agentType || undefined);
  const give = giveTo(await snapshotOf($, state, false), state, loop);
  if (give.length === 0) return result;
  plog($, state, 'info', 'delivered', `${PLUGIN}: ${loop ?? `unknown loop ${agentId}`} given ${give.length} targeted ${give.length === 1 ? 'rule' : 'rules'} at ${when}`, hook, { loop, agentId, rules: give.map((rule) => rule.path) });
  return { ...result, additionalContext: [...(result.additionalContext ?? []), render(give)] };
}

function unpair(state: State, key: string): void {
  const at = state.compacting.lastIndexOf(key);
  if (at >= 0) state.compacting.splice(at, 1);
}

function newState(): State {
  return { nested: new Map(), mainGiven: new Set(), compacting: [], startGen: 0, contextGen: 0, types: new AgentTypes(), reported: new Set(), log: { work: Promise.resolve(), held: [], failing: false } };
}

export const register: Register = (on) => {
  const state = newState();

  // Main's targeted rules, at every start: startup, resume, clear, compact, fork, read fresh each time.
  // A compaction's start goes to the loop its session.compact named: a sub-agent's leaves main's state alone.
  on('classic.SessionStart', async ($, e, next) => {
    const loop = e.source === 'compact' ? state.compacting.splice(0) : [MAIN];
    if (loop.length !== 1) {
      report($, state, 'warning', 'compaction-unpaired', `${PLUGIN}: ${loop.length === 0 ? 'a compaction rule-control did not see (a hook above it answered it)' : `${loop.length} overlapping compactions`} started a loop it cannot name; that loop is given every targeted rule`, 'classic.SessionStart', { loops: loop });
      return handOn($, state, undefined, undefined, await next(e), 'an unpaired compaction', 'classic.SessionStart');
    }
    if (loop[0] !== MAIN) return handOn($, state, loop[0]!, undefined, await next(e), 'its compaction', 'classic.SessionStart');
    const gen = ++state.startGen;
    const result = await next(e);
    const snapshot = await snapshotOf($, state, true);
    const loaded = state.engineLoaded;
    const give = rulesFor(snapshot.rules.values(), MAIN).filter((rule) => loaded === undefined || loaded.has(rule.path));
    if (gen !== state.startGen) return result;
    state.mainGiven = new Set(give.map((rule) => rule.path));
    if (give.length === 0) return result;
    plog($, state, 'info', 'delivered', `${PLUGIN}: main given ${give.length} targeted ${give.length === 1 ? 'rule' : 'rules'} at ${e.source}`, 'classic.SessionStart', { loop: MAIN, source: e.source, rules: give.map((rule) => rule.path) });
    return { ...result, additionalContext: [...(result.additionalContext ?? []), render(give)] };
  }).catch(($, e, next) => {
    state.startGen += 1;
    state.mainGiven = new Set();
    plog($, state, 'error', 'hook-threw', failureText('classic.SessionStart', next.error, `main is given no targeted rule at ${e.source}; every rule stays in the shared context`), 'classic.SessionStart', { kind: next.error.kind, error: next.error.message });
    return next(e);
  });

  // The shared instruction context, answered once for every loop: each targeted rule leaves it.
  on('prompt.context', async ($, e, next) => {
    const gen = ++state.contextGen;
    if (e.instructionFiles === undefined) {
      report($, state, 'error', 'context-rewritten', `${PLUGIN}: a hook above rewrote the instruction text, so its files are unknown; no rule is targeted, every rule reaches every loop`, 'prompt.context');
      state.dropped = new Set();
      return next(e);
    }
    const files = e.instructionFiles;
    const snapshot = await snapshotOf($, state, false);
    const split = splitShared(files, snapshot.rules, state.mainGiven);
    if (gen !== state.contextGen) return next(e);
    state.engineLoaded = new Set(files.map((file) => file.path));
    state.dropped = split.dropped;
    for (const path of split.importers) report($, state, 'error', 'imports-kept', `${PLUGIN}: ${path} imports files (@path), which rule-control cannot hand on; the rule stays in the shared context and reaches every loop`, 'prompt.context', { path });
    if (split.dropped.size > 0) plog($, state, 'debug', 'shared-filtered', `${PLUGIN}: ${split.dropped.size} targeted ${split.dropped.size === 1 ? 'rule leaves' : 'rules leave'} the shared context`, 'prompt.context', { rules: [...split.dropped] });
    return next({ ...e, instructionFiles: split.keep });
  }).catch(($, e, next) => {
    state.contextGen += 1;
    state.dropped = new Set();
    plog($, state, 'error', 'hook-threw', failureText('prompt.context', next.error, 'the shared context is left whole; every rule reaches every loop'), 'prompt.context', { kind: next.error.kind, error: next.error.message });
    return next(e);
  });

  // A sub-agent's targeted rules, at its start.
  on('classic.SubagentStart', async ($, e, next) => {
    return handOn($, state, e.agent_id, e.agent_type, await next(e), 'its start', 'classic.SubagentStart');
  }).catch(($, e, next) => {
    plog($, state, 'error', 'hook-threw', failureText('classic.SubagentStart', next.error, `agent ${e.agent_id} (${e.agent_type}) starts without its targeted rules`), 'classic.SubagentStart', { kind: next.error.kind, error: next.error.message, agentId: e.agent_id });
    return next(e);
  });

  // A path-scoped rule reaches each loop on its own, as the files it names are touched: withheld where its visible-to leaves the loop out.
  on('prompt.attachment', async ($, e, next) => {
    if (e.type !== 'nested_memory') return next(e);
    const path = nestedPath(e.text);
    if (path === undefined) report($, state, 'error', 'nested-header-unread', `${PLUGIN}: a nested_memory attachment names no file on its first line; it is delivered whole to its loop`, 'prompt.attachment', { header: e.text.split('\n', 1)[0] });
    const rule = path === undefined ? undefined : await ruleAt($, state, path);
    if (rule?.filter === undefined) return next(e);
    const loop = e.agentId === undefined ? MAIN : await loopOf($, state, e.agentId, `while delivering ${path}`, 'prompt.attachment');
    if (loop === undefined || admits(rule.filter, loop)) return next(e);
    plog($, state, 'debug', 'withheld', `${PLUGIN}: ${path} withheld from ${loop}`, 'prompt.attachment', { loop, agentId: e.agentId, path });
    return { text: null };
  }).catch(($, e, next) => {
    plog($, state, 'error', 'hook-threw', failureText('prompt.attachment', next.error, `the ${e.type} attachment of loop ${e.agentId ?? MAIN} is delivered whole`), 'prompt.attachment', { kind: next.error.kind, error: next.error.message });
    return next(e);
  });

  // Names the loop the next SessionStart (compact) belongs to; a vetoed or precomputed compaction fires none.
  on('session.compact', async ($, e, next) => {
    const key = e.agentId ?? MAIN;
    state.compacting.push(key);
    const result = await next(e);
    if (result.messages === undefined || e.trigger === 'precompute') unpair(state, key);
    return result;
  }).catch(($, e, next) => {
    unpair(state, e.agentId ?? MAIN);
    plog($, state, 'error', 'hook-threw', failureText('session.compact', next.error, `the compaction of loop ${e.agentId ?? MAIN} goes on unpaired; its start gives every targeted rule`), 'session.compact', { kind: next.error.kind, error: next.error.message, agentId: e.agentId });
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    await state.log.work;
    return next(e);
  });
};
