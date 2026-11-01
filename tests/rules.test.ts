import { describe, expect, it } from 'vitest';
import { ancestorDirs, HEADER, MARKER, nestedPath, render, rulesFor, splitShared, targeted, type Rule } from '../plugins/rule-control/src/rules.ts';

const make = (path: string, extra: Partial<Rule> = {}): Rule => ({ path, tier: 'project', paths: false, body: `Body of ${path}.`, ...extra });
const MAIN_ONLY = make('/p/.claude/rules/main.md', { filter: { include: ['main'] } });
const AGENT_ONLY = make('/p/.claude/rules/agent.md', { filter: { include: ['planner'] } });
const NOT_PLANNER = make('/p/.claude/rules/not-planner.md', { filter: { exclude: ['planner'] } });
const ALL = make('/p/.claude/rules/all.md');
const EVERY = make('/p/.claude/rules/every.md', { filter: { include: ['*'] } });
const BAD = make('/p/.claude/rules/bad.md', { problem: 'visible-to has no value' });
const SCOPED = make('/p/.claude/rules/scoped.md', { filter: { include: ['main'] }, paths: true });
const RULES = [MAIN_ONLY, AGENT_ONLY, NOT_PLANNER, ALL, EVERY, BAD, SCOPED];
const BY_PATH = new Map(RULES.map((rule) => [rule.path, rule]));

describe('targeted', () => {
  it('is a usable filter that leaves a loop out, without paths', () => {
    expect(RULES.filter(targeted)).toEqual([MAIN_ONLY, AGENT_ONLY, NOT_PLANNER]);
  });
});

describe('rulesFor', () => {
  it('gives each loop the targeted rules that name it', () => {
    expect(rulesFor(RULES, 'main')).toEqual([MAIN_ONLY, NOT_PLANNER]);
    expect(rulesFor(RULES, 'planner')).toEqual([AGENT_ONLY]);
    expect(rulesFor(RULES, 'general-purpose')).toEqual([NOT_PLANNER]);
    expect(rulesFor(RULES, 'main', new Set([NOT_PLANNER.path]))).toEqual([NOT_PLANNER]);
  });
});

describe('splitShared', () => {
  const files = RULES.map((rule) => ({ path: rule.path, content: rule.body }));

  it('drops every targeted rule once main was given its own', () => {
    const split = splitShared(files, BY_PATH, new Set([MAIN_ONLY.path, NOT_PLANNER.path]));
    expect(split.keep.map((file) => file.path)).toEqual([ALL.path, EVERY.path, BAD.path, SCOPED.path]);
    expect([...split.dropped]).toEqual([MAIN_ONLY.path, AGENT_ONLY.path, NOT_PLANNER.path]);
  });

  it('keeps a rule main receives but was not given', () => {
    const split = splitShared(files, BY_PATH, new Set());
    expect([...split.dropped]).toEqual([AGENT_ONLY.path]);
    expect(split.keep.map((file) => file.path)).toContain(MAIN_ONLY.path);
  });

  it('keeps a targeted rule that imports files, and names it', () => {
    const withImport = [...files, { path: '/p/imported.md', parent: AGENT_ONLY.path }];
    const split = splitShared(withImport, BY_PATH, new Set());
    expect(split.importers).toEqual([AGENT_ONLY.path]);
    expect(split.dropped.size).toBe(0);
  });

  it('keeps files it does not know', () => {
    expect(splitShared([{ path: '/p/CLAUDE.md' }], BY_PATH, new Set()).keep).toEqual([{ path: '/p/CLAUDE.md' }]);
  });
});

describe('render', () => {
  it('opens with the marker and the engine preamble, each file labelled by tier', () => {
    const text = render([make('/u/.claude/rules/a.md', { tier: 'user', body: 'A.' }), make('/p/.claude/rules/b.md', { body: 'B.' })]);
    expect(text).toBe([
      MARKER,
      HEADER,
      "Contents of /u/.claude/rules/a.md (user's private global instructions for all projects):\n\nA.",
      'Contents of /p/.claude/rules/b.md (project instructions, checked into the codebase):\n\nB.',
    ].join('\n\n'));
  });
});

describe('nestedPath', () => {
  it('reads the file a nested_memory attachment carries', () => {
    expect(nestedPath('Contents of /p/.claude/rules/x.md:\n\nBody.')).toBe('/p/.claude/rules/x.md');
    expect(nestedPath('Contents of /p/a b/.claude/rules/x.md (project instructions, checked into the codebase):\n\nBody.')).toBe('/p/a b/.claude/rules/x.md');
    expect(nestedPath('Something else')).toBeUndefined();
  });
});

describe('ancestorDirs', () => {
  it('stops below home, else at the filesystem root', () => {
    expect(ancestorDirs('/u/work/proj', '/u')).toEqual(['/u/work', '/u/work/proj']);
    expect(ancestorDirs('/tmp/x', '/u')).toEqual(['/', '/tmp', '/tmp/x']);
    expect(ancestorDirs('/tmp/x')).toEqual(['/', '/tmp', '/tmp/x']);
  });
});
