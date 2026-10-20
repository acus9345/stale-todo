import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface Todo {
  /** Path relative to the repository root, with `/` separators. */
  file: string;
  line: number;
  /** The keyword found, like `TODO` or `FIXME`. */
  tag: string;
  /** The text after the keyword, without comment markers. */
  text: string;
  /** Owner written in the comment, like `alice` in `TODO(alice):`. */
  owner: string | undefined;
  /** Who last changed the line, from git blame. */
  author: string;
  authorEmail: string;
  /** Commit that last changed the line (all zeros when not committed yet). */
  commit: string;
  /** When the line was last changed, in milliseconds since the epoch. */
  date: number;
  /** Whole days since `date`. */
  ageDays: number;
}

export interface ScanOptions {
  cwd: string;
  /** Keywords to look for. Matched case-sensitively as whole words. */
  tags: readonly string[];
  /** Git pathspec globs to search (default: every tracked file). */
  include?: readonly string[];
  /** Git pathspec globs to skip. */
  exclude?: readonly string[];
  /** Only these files (like the files a pull request changed). */
  files?: readonly string[];
  /** Only report keywords that appear in a comment. Default `true`. */
  commentsOnly?: boolean;
  /** "Now", for computing ages. Default `Date.now()`. */
  now?: number;
}

/** Runs git and returns stdout. Exit code 1 is allowed (git grep's "no matches"). */
export function git(args: readonly string[], cwd: string, allowExit1 = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 1024 * 1024 * 512, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        if (allowExit1 && error.code === 1 && !stderr.trim()) return resolve("");
        return reject(new Error(`git ${args[0]} failed: ${stderr.trim() || error.message}`));
      }
      resolve(stdout);
    });
  });
}

export interface GrepHit {
  file: string;
  line: number;
  content: string;
}

/** Parses `git grep -n -z` output: `path\0line\0content` (or `path\0line:content` on older git). */
export function parseGrep(output: string): GrepHit[] {
  const hits: GrepHit[] = [];
  for (const row of output.split("\n")) {
    if (!row) continue;
    const [file, rest = "", ...more] = row.split("\0");
    let lineNo: string;
    let content: string;
    if (more.length > 0) {
      lineNo = rest;
      content = more.join("\0");
    } else {
      const colon = rest.indexOf(":");
      lineNo = rest.slice(0, colon);
      content = rest.slice(colon + 1);
    }
    const line = Number(lineNo);
    if (file && Number.isInteger(line)) hits.push({ file, line, content });
  }
  return hits;
}

/** Comment starters for most languages: `//`, `#`, `/*`, `*`, `--`, `<!--`, `;`, `%`, `'`, `{#`, `{{!`, `"""`. */
const COMMENT_BEFORE = /(?:\/\/|\/\*|^\s*\*|#|--|<!--|;|%|^\s*'|^\s*REM\b|\{#|\{\{!|"""|''')/i;

export interface ParsedTodo {
  tag: string;
  text: string;
  owner: string | undefined;
}

/** Finds the first keyword in a line and pulls out its owner and text. */
export function parseTodo(content: string, tags: readonly string[], commentsOnly = true): ParsedTodo | undefined {
  const escaped = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?<![\\w$])(${escaped})(?![\\w$])(?:\\s*\\(([^)]*)\\))?\\s*[:\\-–—]?\\s*(.*)$`);
  const m = re.exec(content);
  if (!m) return undefined;
  if (commentsOnly && !COMMENT_BEFORE.test(content.slice(0, m.index))) return undefined;
  const text = m[3]!
    .replace(/\s*(?:\*\/|-->|#\}|\}\}|"""|''')\s*$/, "")
    .trim();
  const owner = m[2]?.trim().replace(/^@/, "") || undefined;
  return { tag: m[1]!, text, owner };
}

export interface BlameLine {
  commit: string;
  author: string;
  authorEmail: string;
  /** Seconds since the epoch. */
  time: number;
}

/** Parses `git blame --line-porcelain` output into a map of final line number → commit info. */
export function parsePorcelain(output: string): Map<number, BlameLine> {
  const lines = new Map<number, BlameLine>();
  let current: { line: number; info: Partial<BlameLine> } | undefined;
  for (const row of output.split("\n")) {
    if (current === undefined || /^[0-9a-f]{40} \d+ \d+/.test(row)) {
      const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
      if (header) current = { line: Number(header[2]), info: { commit: header[1]! } };
      continue;
    }
    if (row.startsWith("\t")) {
      const { commit = "", author = "", authorEmail = "", time = 0 } = current.info;
      lines.set(current.line, { commit, author, authorEmail, time });
      current = undefined;
    } else if (row.startsWith("author ")) current.info.author = row.slice(7);
    else if (row.startsWith("author-mail ")) current.info.authorEmail = row.slice(12).replace(/^<|>$/g, "");
    else if (row.startsWith("author-time ")) current.info.time = Number(row.slice(12));
  }
  return lines;
}

/** Runs `fn` over `items` with at most `limit` running at once. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const DAY = 24 * 60 * 60 * 1000;
const UNCOMMITTED = /^0{40}$/;

/** Finds TODO-style comments with git grep and dates each one with git blame. Oldest first. */
export async function scan(options: ScanOptions): Promise<Todo[]> {
  const { cwd, tags, commentsOnly = true } = options;
  const now = options.now ?? Date.now();
  if (tags.length === 0) return [];
  if (options.files && options.files.length === 0) return [];

  const pathspecs = [
    ...(options.files ?? []).map((f) => `:(literal)${f}`),
    ...(options.include ?? []).map((g) => `:(glob)${g}`),
    ...(options.exclude ?? []).map((g) => `:(glob,exclude)${g}`),
  ];
  if (pathspecs.length > 0 && pathspecs.every((p) => p.startsWith(":(glob,exclude)"))) pathspecs.unshift(".");
  const pattern = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const out = await git(["grep", "-n", "-z", "-I", "--no-color", "-w", "-E", "-e", pattern, "--", ...pathspecs], cwd, true);

  const byFile = new Map<string, Array<GrepHit & ParsedTodo>>();
  for (const hit of parseGrep(out)) {
    const todo = parseTodo(hit.content, tags, commentsOnly);
    if (!todo) continue;
    const list = byFile.get(hit.file) ?? [];
    list.push({ ...hit, ...todo });
    byFile.set(hit.file, list);
  }

  const ignoreRevs = existsSync(join(cwd, ".git-blame-ignore-revs")) ? ["--ignore-revs-file", ".git-blame-ignore-revs"] : [];
  const files = [...byFile.keys()];
  const blames = await pool(files, 8, async (file) => {
    const ranges = byFile.get(file)!.flatMap((h) => ["-L", `${h.line},${h.line}`]);
    try {
      return parsePorcelain(await git(["blame", "--line-porcelain", "-w", "-M", ...ignoreRevs, ...ranges, "--", file], cwd));
    } catch {
      // Untracked or unreadable: treat every line as new.
      return new Map<number, BlameLine>();
    }
  });

  const todos: Todo[] = [];
  files.forEach((file, i) => {
    for (const hit of byFile.get(file)!) {
      const blame = blames[i]!.get(hit.line);
      const uncommitted = !blame || UNCOMMITTED.test(blame.commit);
      const date = uncommitted ? now : blame.time * 1000;
      todos.push({
        file,
        line: hit.line,
        tag: hit.tag,
        text: hit.text,
        owner: hit.owner,
        author: uncommitted ? "Not committed yet" : blame.author,
        authorEmail: uncommitted ? "" : blame.authorEmail,
        commit: blame?.commit ?? "0".repeat(40),
        date,
        ageDays: Math.max(0, Math.floor((now - date) / DAY)),
      });
    }
  });
  return todos.sort((a, b) => a.date - b.date || a.file.localeCompare(b.file) || a.line - b.line);
}
