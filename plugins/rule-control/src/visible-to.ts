// A rule file's frontmatter, pure: the `visible-to` filter naming the loops
// that receive the rule, whether the engine scopes it by `paths:`, and the
// body the engine would deliver.

/** The frontmatter key this plugin reads. */
export const KEY = 'visible-to';
/** The main conversation's loop name; every other loop is named by its agent type. */
export const MAIN = 'main';

/** The loops a rule reaches: those `include` names (every loop when absent), minus those `exclude` names. */
export type Filter = { include?: readonly string[]; exclude?: readonly string[] };

/**
 * One rule file read. `filter` is set only for a usable `visible-to` value;
 * `problem` says why a present value is unusable, and the rule then reaches
 * every loop. `paths` is true when the engine scopes the rule to files.
 */
export type RuleText = { filter?: Filter; problem?: string; paths: boolean; body: string };

/** Whether `value` matches `pattern`, exactly or with `*` standing for any run of characters. */
export function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value;
  const re = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(value);
}

/** Whether a rule with `filter` reaches `loop` (`main` or an agent type). */
export function admits(filter: Filter, loop: string): boolean {
  const matches = (pattern: string) => globMatch(pattern, loop);
  return (filter.include === undefined || filter.include.some(matches)) && !(filter.exclude ?? []).some(matches);
}

/** True when the filter reaches every loop: such a rule needs no targeting. */
export function admitsAll(filter: Filter): boolean {
  return (filter.include === undefined || filter.include.includes('*')) && (filter.exclude ?? []).length === 0;
}

/** Reads a rule file's text. A file without frontmatter, or without the key, reaches every loop. */
export function readRule(text: string): RuleText {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const close = lines[0]?.trim() === '---' ? lines.findIndex((line, i) => i > 0 && line.trim() === '---') : -1;
  if (close < 0) {
    const body = bodyOf(text.replace(/^﻿/, ''));
    // An opening fence that never closes is no frontmatter to the engine either: the key in it is said, never read.
    return lines[0]?.trim() === '---' && topValue(lines.slice(1), KEY) !== undefined ? { problem: `the frontmatter has no closing --- line, so ${KEY} is not read`, paths: false, body } : { paths: false, body };
  }
  const yaml = lines.slice(1, close);
  const body = bodyOf(lines.slice(close + 1).join('\n'));
  const paths = topValue(yaml, 'paths');
  const hasPaths = paths !== undefined && (paths.inline !== '' || paths.block.some((line) => stripComment(line).trim() !== ''));
  const value = topValue(yaml, KEY);
  if (value === undefined) return { paths: hasPaths, body };
  const read = readFilter(value);
  return 'problem' in read ? { problem: read.problem, paths: hasPaths, body } : { filter: read.filter, paths: hasPaths, body };
}

// The engine delivers a rule without its frontmatter and HTML comments.
// shortcut: comments inside fenced code are removed too; parse Markdown if a rule needs one shown.
function bodyOf(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\n/, '').trimEnd();
}

type Value = { inline: string; block: string[] };

// A top-level key's value: the rest of its line, and the indented lines under it.
function topValue(yaml: readonly string[], key: string): Value | undefined {
  const at = yaml.findIndex((line) => new RegExp(`^${key.replace(/-/g, '\\-')}\\s*:(\\s|$)`).test(line));
  if (at < 0) return undefined;
  const line = yaml[at]!;
  const inline = stripComment(line.slice(line.indexOf(':') + 1)).trim();
  const block: string[] = [];
  for (const next of yaml.slice(at + 1)) {
    if (next.trim() !== '' && !/^\s/.test(next) && !next.startsWith('#') && !/^-(\s|$)/.test(next)) break;
    block.push(next);
  }
  return { inline, block };
}

// Cuts a `#` comment that starts a line or follows a space, outside quotes.
function stripComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

type Read = { filter: Filter } | { problem: string };

function readFilter(value: Value): Read {
  if (value.inline !== '') {
    if (!value.inline.startsWith('{') || !value.inline.endsWith('}')) return { problem: `${KEY} is not a mapping of include and exclude; write ${KEY}: {include: [main]}` };
    const pairs: Array<[string, string]> = [];
    for (const part of splitTop(value.inline.slice(1, -1))) {
      if (part.trim() === '') continue;
      const colon = part.indexOf(':');
      if (colon < 0) return { problem: `${KEY} holds ${JSON.stringify(part.trim())}, which is not a key: value pair` };
      pairs.push([part.slice(0, colon).trim(), part.slice(colon + 1).trim()]);
    }
    return filterOf(pairs.map(([key, list]) => [key, list, []]));
  }
  const lines = value.block.map(stripComment).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { problem: `${KEY} has no value` };
  const indent = lines[0]!.length - lines[0]!.trimStart().length;
  const entries: Array<[string, string, string[]]> = [];
  for (const line of lines) {
    const depth = line.length - line.trimStart().length;
    const item = /^-(\s|$)/.test(line.trim());
    if ((depth > indent || item) && entries.length > 0) { entries[entries.length - 1]![2].push(line.trim()); continue; }
    if (depth !== indent) return { problem: `${KEY} is not indented consistently at ${JSON.stringify(line.trim())}` };
    const match = /^([^:]+):(.*)$/.exec(line.trim());
    if (!match) return { problem: `${KEY} is not a mapping of include and exclude at ${JSON.stringify(line.trim())}` };
    entries.push([match[1]!.trim(), match[2]!.trim(), []]);
  }
  return filterOf(entries);
}

// Each entry: its key, its inline value, and the `- item` lines under it.
function filterOf(entries: ReadonlyArray<readonly [string, string, readonly string[]]>): Read {
  const filter: { include?: string[]; exclude?: string[] } = {};
  for (const [rawKey, inline, items] of entries) {
    const key = unquote(rawKey);
    if (key !== 'include' && key !== 'exclude') return { problem: `${KEY} has an unknown key ${JSON.stringify(key)}; use include or exclude` };
    if (filter[key] !== undefined) return { problem: `${KEY} names ${key} twice` };
    let names: string[];
    if (inline !== '') {
      if (!inline.startsWith('[') || !inline.endsWith(']') || items.length > 0) return { problem: `${KEY}.${key} is not a list; write [name, ...]` };
      names = splitTop(inline.slice(1, -1)).map((item) => item.trim());
      if (names.length === 1 && names[0] === '') names = [];
    } else {
      if (items.length === 0) return { problem: `${KEY}.${key} has no value; write [name, ...]` };
      const bad = items.find((item) => !item.startsWith('- ') && item !== '-');
      if (bad !== undefined) return { problem: `${KEY}.${key} is not a list at ${JSON.stringify(bad)}; write one "- name" per line` };
      names = items.map((item) => item.slice(1).trim());
    }
    const unquoted = names.map(unquote);
    const bad = unquoted.find((name) => name.trim() === '' || /[[\]{},\n]/.test(name));
    if (bad !== undefined) return { problem: `${KEY}.${key} holds ${JSON.stringify(bad)}, which is not a name` };
    filter[key] = unquoted.map((name) => name.trim());
  }
  return { filter };
}

// Splits on commas outside quotes, brackets and braces.
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(text: string): string {
  const t = text.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0] ? t.slice(1, -1) : t;
}
