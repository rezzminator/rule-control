import { describe, expect, it } from 'vitest';
import { admits, admitsAll, globMatch, readRule } from '../plugins/rule-control/src/visible-to.ts';

const rule = (frontmatter: string, body = 'Body.\n') => `---\n${frontmatter}\n---\n${body}`;

describe('readRule', () => {
  it('reads a flow mapping', () => {
    expect(readRule(rule('visible-to: {include: [main, "flights-*"], exclude: [\'flights-lander\']}'))).toEqual({
      filter: { include: ['main', 'flights-*'], exclude: ['flights-lander'] }, paths: false, body: 'Body.',
    });
  });

  it('reads a block mapping with flow lists, item lists and comments', () => {
    const text = rule(['description: x', 'visible-to:   # who gets it', '  include: [main] # the main chat', '  exclude:', '    - reviewer', '    - "tracer"', 'other: y'].join('\n'));
    expect(readRule(text).filter).toEqual({ include: ['main'], exclude: ['reviewer', 'tracer'] });
  });

  it('reads items at the key indent', () => {
    expect(readRule(rule('visible-to:\n  include:\n  - main\n  - planner')).filter).toEqual({ include: ['main', 'planner'] });
  });

  it('reads an empty include as reaching no loop and an empty mapping as reaching every loop', () => {
    const none = readRule(rule('visible-to: {include: []}')).filter!;
    expect(none).toEqual({ include: [] });
    expect(admits(none, 'main')).toBe(false);
    expect(readRule(rule('visible-to: {}')).filter).toEqual({});
  });

  it('has no filter without the key or without frontmatter', () => {
    expect(readRule(rule('description: x'))).toEqual({ paths: false, body: 'Body.' });
    expect(readRule('Plain rule.\n')).toEqual({ paths: false, body: 'Plain rule.' });
    expect(readRule('---\nvisible-to: {include: [main]}\nno close\n').filter).toBeUndefined();
  });

  it('names the problem of an unusable value and sets no filter', () => {
    const cases: Array<[string, RegExp]> = [
      ['visible-to: main', /not a mapping/],
      ['visible-to:', /has no value/],
      ['visible-to:\n  only: [main]', /unknown key "only"/],
      ['visible-to: {include: main}', /not a list/],
      ['visible-to: {include: [main], include: [x]}', /names include twice/],
      ['visible-to:\n  include:\n    main', /not a list at "main"/],
      ['visible-to: {include: [main, ""]}', /not a name/],
      ['visible-to:\n  include: [main]\n   exclude: [x]', /not a list/],
      ['visible-to: {include}', /not a key: value pair/],
    ];
    for (const [frontmatter, problem] of cases) {
      const read = readRule(rule(frontmatter));
      expect(read.filter, frontmatter).toBeUndefined();
      expect(read.problem, frontmatter).toMatch(problem);
    }
  });

  it('tells a path-scoped rule from an always-on one', () => {
    expect(readRule(rule('paths: src/**')).paths).toBe(true);
    expect(readRule(rule('paths:\n  - "src/**"')).paths).toBe(true);
    expect(readRule(rule('paths:\n- src/**')).paths).toBe(true);
    expect(readRule(rule('paths:')).paths).toBe(false);
    expect(readRule(rule('description: paths: no')).paths).toBe(false);
  });

  it('strips frontmatter and HTML comments from the body', () => {
    expect(readRule(rule('visible-to: {include: [main]}', '\n<!-- note -->\nKeep this.\n<!-- a\nb -->\nAnd this.\n\n')).body).toBe('Keep this.\n\nAnd this.');
    expect(readRule('﻿---\r\nvisible-to: {include: [main]}\r\n---\r\nBody.\r\n').filter).toEqual({ include: ['main'] });
  });
});

describe('admits', () => {
  it('includes, then excludes, with * globs', () => {
    const filter = { include: ['main', 'flights-*'], exclude: ['flights-lander'] };
    expect(admits(filter, 'main')).toBe(true);
    expect(admits(filter, 'flights-foreman')).toBe(true);
    expect(admits(filter, 'flights-lander')).toBe(false);
    expect(admits(filter, 'general-purpose')).toBe(false);
    expect(admits({ exclude: ['main'] }, 'Explore')).toBe(true);
    expect(admits({ exclude: ['main'] }, 'main')).toBe(false);
  });

  it('matches regex characters literally', () => {
    expect(globMatch('a.b', 'aXb')).toBe(false);
    expect(globMatch('plugin:*', 'plugin:agent')).toBe(true);
  });

  it('knows a filter that reaches every loop', () => {
    expect(admitsAll({})).toBe(true);
    expect(admitsAll({ include: ['*'] })).toBe(true);
    expect(admitsAll({ include: ['main'] })).toBe(false);
    expect(admitsAll({ exclude: ['x'] })).toBe(false);
  });
});
