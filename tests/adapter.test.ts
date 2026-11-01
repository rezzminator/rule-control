import { describe, expect, it } from 'vitest';
import { register } from '../plugins/rule-control/hooks/rule-control.ts';
import { MARKER } from '../plugins/rule-control/src/rules.ts';

// A stand-in engine: a file system of rule files (links resolved by prefix),
// the session's agents, and the hooks the module registers, driven the way
// Claude Code drives them.
type Hook = (...args: any[]) => any;
type Options = { env?: Record<string, string>; root?: string; links?: Record<string, string>; agents?: Array<{ id: string; type: string }>; unlistable?: string; rootError?: string; listError?: string; envErrors?: Record<string, number> };

const HOME = '/u';
const ROOT = '/w/proj';
const RULES = `${ROOT}/.claude/rules`;
const rule = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n${body}\n`;

const FILES: Record<string, string> = {
  '/store/rules/user-main.md': rule('visible-to: {include: [main]}', 'USER-MAIN'),
  '/w/.claude/rules/parent.md': rule('visible-to: {include: [planner]}', 'PARENT-AGENT'),
  [`${RULES}/main.md`]: rule('visible-to: {include: [main]}', 'MAIN-ONLY'),
  [`${RULES}/agent.md`]: rule('visible-to:\n  include: [planner]', 'AGENT-ONLY'),
  [`${RULES}/all.md`]: 'EVERYONE\n',
  [`${RULES}/bad.md`]: rule('visible-to:\n  only: [main]', 'BAD-FRONTMATTER'),
  [`${RULES}/scoped.md`]: rule('paths: src/**\nvisible-to: {include: [main]}', 'SCOPED-MAIN'),
  [`${RULES}/sub/nested.md`]: rule('visible-to: {exclude: [planner]}', 'NOT-PLANNER'),
  [`${ROOT}/pkg/.claude/rules/deep.md`]: rule('visible-to: {include: [planner]}', 'DEEP-PLANNER'),
  [`${ROOT}/CLAUDE.md`]: 'Project.\n',
};
const LINKS = { '/u/.claude/rules/user-main.md': '/store/rules/user-main.md' };
// What the engine puts in the shared context: every rule without paths, by real path, and CLAUDE.md.
const SHARED = [`${ROOT}/CLAUDE.md`, '/store/rules/user-main.md', '/w/.claude/rules/parent.md', `${RULES}/agent.md`, `${RULES}/all.md`, `${RULES}/bad.md`, `${RULES}/main.md`, `${RULES}/sub/nested.md`];

// Claude Code's own shape: the plugin's name, the call, then the errno, with no `code`.
function enoent(call: string, path: string): Error {
  return new Error(`rule-control: $.fs.${call}(${path}) failed: ENOENT`);
}

const text = (result: { additionalContext?: string[] }) => (result.additionalContext ?? []).join('\n');

function engine(files: Record<string, string> = FILES, options: Options = {}) {
  const hooks = new Map<string, Hook>();
  const catches = new Map<string, Hook>();
  const screen: string[] = [];
  const runs: string[][] = [];
  const links = options.links ?? LINKS;
  const resolve = (path: string) => {
    for (const [from, to] of Object.entries(links)) {
      if (path === from) return to;
      if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
    }
    return path;
  };
  const isDir = (path: string) => Object.keys(files).some((file) => file.startsWith(`${path}/`)) || Object.keys(links).some((link) => link.startsWith(`${path}/`));
  const $ = {
    env: {
      get: async (name: string) => {
        // envErrors: how many reads of a name reject before it answers.
        const left = options.envErrors?.[name] ?? 0;
        if (left > 0) { options.envErrors![name] = left - 1; throw new Error(`env.get(${name}) denied`); }
        return (options.env ?? { HOME })[name];
      },
    },
    session: {
      root: async () => { if (options.rootError !== undefined) throw new Error(options.rootError); return options.root ?? ROOT; },
      id: async () => 'sess-1',
    },
    process: { run: async (argv: string[]) => { runs.push(argv); return { exitCode: 0, stdout: '', stderr: '' }; } },
    // Claude Code puts the plugin's name before each line.
    ui: { log: (text: string) => { screen.push(`rule-control: ${text}`); } },
    agent: { list: async () => { if (options.listError !== undefined) throw new Error(options.listError); return options.agents ?? []; } },
    fs: {
      list: async (dir: string) => {
        if (dir === options.unlistable) throw new Error(`EACCES: permission denied, scandir '${dir}'`);
        const real = resolve(dir);
        const names = new Map<string, string>();
        for (const file of Object.keys(files).filter((f) => f.startsWith(`${real}/`))) {
          const rest = file.slice(real.length + 1);
          names.set(rest.split('/')[0]!, rest.includes('/') ? 'dir' : 'file');
        }
        for (const link of Object.keys(links).filter((l) => l.startsWith(`${dir}/`) && !l.slice(dir.length + 1).includes('/'))) names.set(link.slice(dir.length + 1), 'link');
        if (names.size === 0) throw enoent('list', dir);
        return [...names].map(([name, kind]) => ({ name, kind: kind === 'link' ? 'other' : kind, size: 1, mtimeMs: 0, isLink: kind === 'link' }));
      },
      stat: async (path: string, init?: { resolve?: boolean }) => {
        const real = resolve(path);
        const kind = real in files ? 'file' : isDir(real) ? 'dir' : undefined;
        if (kind === undefined) throw enoent('stat', path);
        return { kind, size: 1, mtimeMs: 0, isLink: path in links, ...(init?.resolve ? { realPath: real } : {}) };
      },
      read: async (path: string) => {
        const text = files[resolve(path)];
        if (text === undefined) throw enoent('read', path);
        return text;
      },
    },
  };
  const on = (name: string, matcherOrHook: unknown, maybeHook?: Hook) => {
    hooks.set(name, (maybeHook ?? matcherOrHook) as Hook);
    return { catch: (handler: Hook) => { catches.set(name, handler); } };
  };
  register(on as never, {} as never);
  const fire = (name: string, e: unknown, next: Hook) => hooks.get(name)!($, e, next);
  const caught = (name: string, e: unknown, next: Hook) => catches.get(name)!($, e, Object.assign(next, { error: { kind: 'throw', message: 'forced hook failure', budget: 100 } }));
  return {
    screen,
    fire,
    caught,
    startMain: async (source = 'startup') => (await fire('classic.SessionStart', { source }, async () => ({}))) as { additionalContext?: string[] },
    context: async (paths: readonly string[] | undefined, extra: Array<{ path: string; parent?: string }> = []) => {
      let sent: { instructionFiles?: Array<{ path: string }> } | undefined;
      const instructionFiles = paths === undefined ? undefined : [...paths.map((path) => ({ path, kind: 'project', content: 'x' })), ...extra.map((file) => ({ ...file, kind: 'project', content: 'x' }))];
      await fire('prompt.context', { blocks: [], instructionFiles }, async (e: typeof sent) => { sent = e; return { blocks: [] }; });
      return sent!.instructionFiles?.map((file) => file.path);
    },
    startAgent: async (id: string, type: string) => (await fire('classic.SubagentStart', { agent_id: id, agent_type: type }, async () => ({}))) as { additionalContext?: string[] },
    attach: async (path: string, agentId?: string) => {
      let passed = false;
      const result = await fire('prompt.attachment', { type: 'nested_memory', text: `Contents of ${path}:\n\nBody.`, origin: 'engine', agentId }, async () => { passed = true; return { text: 'kept' }; });
      return passed ? 'delivered' : (result as { text: null }).text === null ? 'withheld' : 'other';
    },
    // Claude Code fires SessionStart (compact) for every compaction, main's or a sub-agent's, with nothing naming the loop:
    // inside the engine's own summary (native), or after a hook's answer is installed (install); a vetoed one fires none.
    compact: async (agentId: string | undefined, how: 'native' | 'install' | 'skip' = 'native') => {
      let started: { additionalContext?: string[] } | undefined;
      const restart = async () => (await fire('classic.SessionStart', { source: 'compact' }, async () => ({}))) as { additionalContext?: string[] };
      const result = await fire('session.compact', { trigger: 'auto', agentId, messages: [] }, async () => {
        if (how === 'skip') return { skip: 'held' };
        if (how === 'native') started = await restart();
        return { messages: [{ role: 'user', text: 'Summary.', toolUses: [] }] };
      });
      if (how === 'install') started = await restart();
      return { result, started: started === undefined ? undefined : text(started) };
    },
    restart: async () => text((await fire('classic.SessionStart', { source: 'compact' }, async () => ({}))) as { additionalContext?: string[] }),
    // Settles the log chain the way session end does, then the rows written, by level file.
    rows: async () => {
      await fire('session.end', {}, async () => ({}));
      return runs.flatMap((argv) => {
        const out: Array<{ file: string; dir: string; row: Record<string, any> }> = [];
        for (let i = 6; i < argv.length; i += 2) out.push({ dir: argv[4]!, file: argv[i]!, row: JSON.parse(argv[i + 1]!) });
        return out;
      });
    },
  };
}

describe('a session', () => {
  it('gives main its own rules, leaves targeted rules out of the shared context, and gives each sub-agent the ones naming it', async () => {
    const eng = engine();
    const main = text(await eng.startMain());
    expect(main.startsWith(MARKER)).toBe(true);
    for (const word of ['USER-MAIN', 'MAIN-ONLY', 'NOT-PLANNER']) expect(main).toContain(word);
    for (const word of ['AGENT-ONLY', 'PARENT-AGENT', 'EVERYONE', 'SCOPED-MAIN']) expect(main).not.toContain(word);
    expect(main).toContain("Contents of /store/rules/user-main.md (user's private global instructions for all projects):\n\nUSER-MAIN");

    // The no-key rule and the rule with bad frontmatter stay in the shared context: every loop gets them.
    expect(await eng.context(SHARED)).toEqual([`${ROOT}/CLAUDE.md`, `${RULES}/all.md`, `${RULES}/bad.md`]);

    const planner = text(await eng.startAgent('a1', 'planner'));
    expect(planner).toContain('AGENT-ONLY');
    expect(planner).toContain('PARENT-AGENT');
    for (const word of ['MAIN-ONLY', 'USER-MAIN', 'NOT-PLANNER']) expect(planner).not.toContain(word);

    const other = text(await eng.startAgent('a2', 'general-purpose'));
    expect(other).toContain('NOT-PLANNER');
    for (const word of ['MAIN-ONLY', 'AGENT-ONLY', 'PARENT-AGENT']) expect(other).not.toContain(word);

    expect(await eng.startAgent('a3', 'Explore')).toEqual({ additionalContext: [expect.stringContaining('NOT-PLANNER')] });
    // A rules directory that is not there is no failure: only the bad frontmatter is said.
    expect(eng.screen).toEqual([`rule-control: ${RULES}/bad.md: visible-to has an unknown key "only"; use include or exclude; the rule is kept and reaches every loop`]);
  });

  it('keeps a rule with bad frontmatter for every loop and logs the file and the problem once', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.startMain('compact');
    const lines = eng.screen.filter((line) => line.includes('bad.md'));
    expect(lines).toEqual([`rule-control: ${RULES}/bad.md: visible-to has an unknown key "only"; use include or exclude; the rule is kept and reaches every loop`]);
    const rows = (await eng.rows()).filter((r) => r.row.event === 'frontmatter-problem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dir: '/u/.local/state/rule-control/logs', file: 'errors.jsonl', row: { level: 'error', session: 'sess-1', detail: { path: `${RULES}/bad.md`, error: 'visible-to has an unknown key "only"; use include or exclude' } } });
  });

  it('filters again after a compaction: main is given its rules anew and the re-read shared context drops them again', async () => {
    const eng = engine();
    await eng.startMain();
    // The engine leaves main.md out (claudeMdExcludes): from then on main is given only what the engine loaded.
    const loaded = SHARED.filter((path) => path !== `${RULES}/main.md`);
    await eng.context(loaded);
    const again = text(await eng.startMain('compact'));
    expect(again).toContain('USER-MAIN');
    expect(again).not.toContain('MAIN-ONLY');
    expect(await eng.context(loaded)).toEqual([`${ROOT}/CLAUDE.md`, `${RULES}/all.md`, `${RULES}/bad.md`]);
    expect(text(await eng.startAgent('a1', 'planner'))).toContain('AGENT-ONLY');
  });

  it('gives a compacting sub-agent its own rules again, never main\'s, whether the engine or a hook compacted it', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.context(SHARED);
    await eng.startAgent('a1', 'planner');
    for (const how of ['native', 'install'] as const) {
      const again = (await eng.compact('a1', how)).started!;
      expect(again.startsWith(MARKER), how).toBe(true);
      for (const word of ['AGENT-ONLY', 'PARENT-AGENT']) expect(again, how).toContain(word);
      for (const word of ['MAIN-ONLY', 'USER-MAIN', 'NOT-PLANNER']) expect(again, how).not.toContain(word);
    }
    // Main's state is untouched: the re-read shared context drops the same rules.
    expect(await eng.context(SHARED)).toEqual([`${ROOT}/CLAUDE.md`, `${RULES}/all.md`, `${RULES}/bad.md`]);
  });

  it('pairs no SessionStart with a vetoed compaction', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.context(SHARED);
    await eng.startAgent('a1', 'planner');
    expect((await eng.compact('a1', 'skip')).result).toEqual({ skip: 'held' });
    const main = (await eng.compact(undefined)).started!;
    expect(main).toContain('MAIN-ONLY');
    expect(main).not.toContain('AGENT-ONLY');
  });

  it('gives a compaction it did not see, or one of two overlapping, every rule the shared context left out, and logs it', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.context(SHARED);
    await eng.startAgent('a1', 'planner');
    const unseen = await eng.restart();
    for (const word of ['AGENT-ONLY', 'PARENT-AGENT', 'MAIN-ONLY', 'USER-MAIN', 'NOT-PLANNER']) expect(unseen).toContain(word);
    await eng.fire('session.compact', { trigger: 'auto', agentId: 'a1', messages: [] }, async () => ({ messages: [] }));
    await eng.fire('session.compact', { trigger: 'auto', messages: [] }, async () => ({ messages: [] }));
    for (const restart of [await eng.restart(), await eng.restart()]) expect(restart).toContain('AGENT-ONLY');
    // Paired again from the next compaction on.
    expect((await eng.compact('a1', 'install')).started).not.toContain('MAIN-ONLY');
    expect((await eng.rows()).filter((r) => r.row.event === 'compaction-unpaired' && r.file === 'warnings.jsonl').length).toBeGreaterThan(0);
  });

  it('gives a compacting loop nothing names every rule the shared context left out, and logs it', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.context(SHARED);
    const last = (await eng.compact('fork-1')).started!;
    for (const word of ['AGENT-ONLY', 'PARENT-AGENT', 'MAIN-ONLY', 'USER-MAIN', 'NOT-PLANNER']) expect(last).toContain(word);
    expect((await eng.rows()).some((r) => r.row.event === 'engine-loop' && r.file === 'debug.jsonl' && r.row.detail.agentId === 'fork-1')).toBe(true);
  });

  it('withholds a path-scoped rule from the loops its visible-to leaves out, and reads nested rule directories on demand', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.context(SHARED);
    await eng.startAgent('a1', 'planner');
    expect(await eng.attach(`${RULES}/scoped.md`)).toBe('delivered');
    expect(await eng.attach(`${RULES}/scoped.md`, 'a1')).toBe('withheld');
    expect(await eng.attach(`${ROOT}/pkg/.claude/rules/deep.md`, 'a1')).toBe('delivered');
    expect(await eng.attach(`${ROOT}/pkg/.claude/rules/deep.md`)).toBe('withheld');
    expect(await eng.attach(`${ROOT}/pkg/CLAUDE.md`)).toBe('delivered');
    // A loop nothing names keeps what the engine gives it.
    expect(await eng.attach(`${RULES}/scoped.md`, 'unknown-1')).toBe('delivered');
  });

  it('keeps a targeted rule that imports files in the shared context, and says so on screen', async () => {
    const eng = engine();
    await eng.startMain();
    const kept = await eng.context(SHARED, [{ path: `${ROOT}/docs/imported.md`, parent: `${RULES}/agent.md` }]);
    expect(kept).toContain(`${RULES}/agent.md`);
    expect(eng.screen).toContain(`rule-control: ${RULES}/agent.md imports files (@path), which rule-control cannot hand on; the rule stays in the shared context and reaches every loop`);
    expect(text(await eng.startAgent('a1', 'planner'))).not.toContain('AGENT-ONLY');
  });
});

describe('failing open', () => {
  it('after a reload with no start seen, keeps main-bound rules shared and hands every targeted rule to the sub-agents it names', async () => {
    const eng = engine();
    const planner = text(await eng.startAgent('a1', 'planner'));
    expect(planner).toContain('AGENT-ONLY');
    expect(planner).toContain('PARENT-AGENT');
    const kept = await eng.context(SHARED);
    for (const path of [`${RULES}/main.md`, '/store/rules/user-main.md', `${RULES}/sub/nested.md`]) expect(kept).toContain(path);
    expect(kept).not.toContain(`${RULES}/agent.md`);
  });

  it('a failed session start gives main nothing and leaves its rules shared', async () => {
    const eng = engine();
    await eng.caught('classic.SessionStart', { source: 'startup' }, async () => ({}));
    expect(eng.screen.some((line) => line.includes('classic.SessionStart failed') && line.includes('forced hook failure'))).toBe(true);
    expect(await eng.context(SHARED)).toContain(`${RULES}/main.md`);
  });

  it('a failed shared-context hook leaves every rule shared, so sub-agents are handed nothing twice', async () => {
    const eng = engine();
    await eng.startMain();
    await eng.context(SHARED);
    await eng.caught('prompt.context', { blocks: [], instructionFiles: [] }, async () => ({ blocks: [] }));
    expect(await eng.startAgent('a1', 'planner')).toEqual({});
  });

  it('leaves a rewritten instruction text untouched and logs it once', async () => {
    const eng = engine();
    await eng.startMain();
    expect(await eng.context(undefined)).toBeUndefined();
    await eng.context(undefined);
    expect(eng.screen.filter((line) => line.includes('rewrote the instruction text'))).toHaveLength(1);
    expect(await eng.startAgent('a1', 'planner')).toEqual({});
  });

  it('reads the user tier from CLAUDE_CONFIG_DIR, and logs an unlistable rules directory', async () => {
    const files = { ...FILES, '/cfg/rules/cfg.md': rule('visible-to: {include: [main]}', 'CONFIG-MAIN') };
    const eng = engine(files, { env: { HOME, CLAUDE_CONFIG_DIR: '/cfg', PLUGIN_LOG_DIR: '/logs' }, unlistable: '/w/.claude/rules' });
    const main = text(await eng.startMain());
    expect(main).toContain('CONFIG-MAIN');
    expect(main).not.toContain('USER-MAIN');
    expect(eng.screen.some((line) => line.startsWith('rule-control: listing /w/.claude/rules failed: EACCES'))).toBe(true);
    expect((await eng.rows()).every((r) => r.dir === '/logs/rule-control')).toBe(true);
  });

  it('keeps the rules found before discovery failed targeted, and logs the failure', async () => {
    const eng = engine(FILES, { rootError: 'session root unavailable' });
    const main = text(await eng.startMain());
    expect(main).toContain("Contents of /store/rules/user-main.md (user's private global instructions for all projects):\n\nUSER-MAIN");
    expect(await eng.context(SHARED)).toEqual([`${ROOT}/CLAUDE.md`, '/w/.claude/rules/parent.md', `${RULES}/agent.md`, `${RULES}/all.md`, `${RULES}/bad.md`, `${RULES}/main.md`, `${RULES}/sub/nested.md`]);
    expect(eng.screen).toEqual(['rule-control: finding the rules failed: session root unavailable; the rules found before it stay targeted, every other rule reaches every loop']);
  });

  it('takes the type a sub-agent announced when the agent list fails, and logs the failure', async () => {
    const eng = engine(FILES, { listError: 'agent list unavailable' });
    await eng.startMain();
    await eng.context(SHARED);
    expect(text(await eng.startAgent('a1', 'planner'))).toContain('AGENT-ONLY');
    expect(await eng.attach(`${RULES}/scoped.md`, 'a1')).toBe('withheld');
    expect(eng.screen).toContain(`rule-control: listing agents failed: agent list unavailable while delivering ${RULES}/scoped.md; loop a1 takes its announced type planner`);
  });

  it('delivers a nested_memory attachment whose first line names no file whole, and logs its header once', async () => {
    const eng = engine();
    for (const header of ['Contents of nothing readable', 'Contents of another']) {
      let passed = false;
      await eng.fire('prompt.attachment', { type: 'nested_memory', text: `${header}\n\nBody.`, origin: 'engine' }, async () => { passed = true; return { text: 'kept' }; });
      expect(passed, header).toBe(true);
    }
    const line = 'rule-control: a nested_memory attachment names no file on its first line; it is delivered whole to its loop';
    expect(eng.screen).toEqual([line]);
    expect((await eng.rows()).filter((r) => r.row.event === 'nested-header-unread').map((r) => [r.file, r.row.msg, r.row.detail])).toEqual([['errors.jsonl', line, { header: 'Contents of nothing readable' }]]);
  });

  it('holds a log row whose log directory could not be read, and writes it with the next row', async () => {
    const eng = engine(FILES, { envErrors: { PLUGIN_LOG_DIR: 1 } });
    await eng.startMain();
    expect(eng.screen).toContain('rule-control: plugin log unavailable: env.get(PLUGIN_LOG_DIR) denied; 1 row is held for the next write');
    const rows = (await eng.rows()).filter((r) => r.row.event === 'frontmatter-problem');
    expect(rows.map((r) => [r.dir, r.file, r.row.detail])).toEqual([['/u/.local/state/rule-control/logs', 'errors.jsonl', { path: `${RULES}/bad.md`, error: 'visible-to has an unknown key "only"; use include or exclude' }]]);
  });
});
