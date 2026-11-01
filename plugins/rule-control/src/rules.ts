// Which rules a loop receives, pure: the rules this plugin delivers itself,
// the files the shared instruction context keeps, and the text a loop is given.
import { admits, admitsAll, MAIN, type Filter } from './visible-to.ts';

export type Tier = 'user' | 'project';

/**
 * One rule file: `path` its real path (the engine's spelling). `filter` is set for a usable `visible-to` value,
 * `problem` for an unusable one; `paths` is true when the engine scopes it by
 * `paths:`.
 */
export type Rule = { path: string; tier: Tier; filter?: Filter; problem?: string; paths: boolean; body: string };

/** Opens every text this plugin gives a loop, so the loop and a reader of its transcript can tell it from the engine's own instruction files. */
export const MARKER = 'rule-control: the rules below reach this loop by their visible-to frontmatter.';

/** The preamble Claude Code puts before instruction files. */
export const HEADER = 'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

const LABEL: Record<Tier, string> = {
  user: "user's private global instructions for all projects",
  project: 'project instructions, checked into the codebase',
};

/**
 * A rule this plugin delivers itself: a usable filter that leaves some loop
 * out, and no `paths:` (the engine delivers a path-scoped rule to each loop
 * on its own, where `prompt.attachment` filters it).
 */
export function targeted(rule: Rule): boolean {
  return rule.filter !== undefined && !admitsAll(rule.filter) && !rule.paths;
}

/** The targeted rules `loop` receives, limited to `only` when given. */
export function rulesFor(rules: Iterable<Rule>, loop: string, only?: ReadonlySet<string>): Rule[] {
  return [...rules].filter((rule) => targeted(rule) && admits(rule.filter!, loop) && (only === undefined || only.has(rule.path)));
}

/** The text that hands `rules` to a loop, in the shape Claude Code renders instruction files. */
export function render(rules: readonly Rule[]): string {
  return [MARKER, HEADER, ...rules.map((rule) => `Contents of ${rule.path} (${LABEL[rule.tier]}):\n\n${rule.body}`)].join('\n\n');
}

export type Drop<F> = { keep: F[]; dropped: Set<string>; importers: string[] };

/**
 * Splits the shared instruction files. A targeted rule leaves the shared
 * context unless main receives it and was not given it at session start, or
 * it imports files (`@path`), whose text this plugin cannot hand on: both stay
 * for every loop.
 */
export function splitShared<F extends { path: string; parent?: string }>(files: readonly F[], rules: ReadonlyMap<string, Rule>, mainGiven: ReadonlySet<string>): Drop<F> {
  const keep: F[] = [];
  const dropped = new Set<string>();
  const importers = new Set<string>();
  for (const file of files) {
    const rule = rules.get(file.path);
    if (rule === undefined || !targeted(rule)) { keep.push(file); continue; }
    if (files.some((child) => child.parent === file.path)) { importers.add(file.path); keep.push(file); continue; }
    if (admits(rule.filter!, MAIN) && !mainGiven.has(file.path)) { keep.push(file); continue; }
    dropped.add(file.path);
  }
  return { keep, dropped, importers: [...importers] };
}

/** The file a `nested_memory` attachment carries: `Contents of {path}:` or `Contents of {path} ({label}):` on its first line. */
export function nestedPath(text: string): string | undefined {
  const first = text.split('\n', 1)[0] ?? '';
  const match = /^Contents of (.+?)(?: \([^()]*\))?:\s*$/.exec(first);
  return match?.[1];
}

/**
 * The project directories of a session at `root`, farthest first: `root` and
 * each directory above it, stopping below `home` (the user tier, never a
 * project) as Claude Code does, else at the filesystem root.
 */
export function ancestorDirs(root: string, home?: string): string[] {
  const parts = root.split('/').filter((part) => part !== '');
  const dirs = ['/', ...parts.map((_, i) => `/${parts.slice(0, i + 1).join('/')}`)];
  const stop = home === undefined ? -1 : dirs.indexOf(`/${home.split('/').filter((part) => part !== '').join('/')}`);
  return stop < 0 ? dirs : dirs.slice(stop + 1);
}
