import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
/** Runs git and returns stdout. Exit code 1 is allowed (git grep's "no matches"). */
export function git(args, cwd, allowExit1 = false) {
    return new Promise((resolve, reject) => {
        execFile("git", args, { cwd, maxBuffer: 1024 * 1024 * 512, encoding: "utf8" }, (error, stdout, stderr) => {
            if (error) {
                if (allowExit1 && error.code === 1 && !stderr.trim())
                    return resolve("");
                return reject(new Error(`git ${args[0]} failed: ${stderr.trim() || error.message}`));
            }
            resolve(stdout);
        });
    });
}
/** Parses `git grep -n -z` output: `path\0line\0content` (or `path\0line:content` on older git). */
export function parseGrep(output) {
    const hits = [];
    for (const row of output.split("\n")) {
        if (!row)
            continue;
        const [file, rest = "", ...more] = row.split("\0");
        let lineNo;
        let content;
        if (more.length > 0) {
            lineNo = rest;
            content = more.join("\0");
        }
        else {
            const colon = rest.indexOf(":");
            lineNo = rest.slice(0, colon);
            content = rest.slice(colon + 1);
        }
        const line = Number(lineNo);
        if (file && Number.isInteger(line))
            hits.push({ file, line, content });
    }
    return hits;
}
/** Comment starters for most languages: `//`, `#`, `/*`, `*`, `--`, `<!--`, `;`, `%`, `'`, `{#`, `{{!`, `"""`. */
const COMMENT_BEFORE = /(?:\/\/|\/\*|^\s*\*|#|--|<!--|;|%|^\s*'|^\s*REM\b|\{#|\{\{!|"""|''')/i;
/** Finds the first keyword in a line and pulls out its owner and text. */
export function parseTodo(content, tags, commentsOnly = true) {
    const escaped = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(`(?<![\\w$])(${escaped})(?![\\w$])(?:\\s*\\(([^)]*)\\))?\\s*[:\\-–—]?\\s*(.*)$`);
    const m = re.exec(content);
    if (!m)
        return undefined;
    if (commentsOnly && !COMMENT_BEFORE.test(content.slice(0, m.index)))
        return undefined;
    const text = m[3]
        .replace(/\s*(?:\*\/|-->|#\}|\}\}|"""|''')\s*$/, "")
        .trim();
    const owner = m[2]?.trim().replace(/^@/, "") || undefined;
    return { tag: m[1], text, owner };
}
/** Parses `git blame --line-porcelain` output into a map of final line number → commit info. */
export function parsePorcelain(output) {
    const lines = new Map();
    let current;
    for (const row of output.split("\n")) {
        if (current === undefined || /^[0-9a-f]{40} \d+ \d+/.test(row)) {
            const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
            if (header)
                current = { line: Number(header[2]), info: { commit: header[1] } };
            continue;
        }
        if (row.startsWith("\t")) {
            const { commit = "", author = "", authorEmail = "", time = 0 } = current.info;
            lines.set(current.line, { commit, author, authorEmail, time });
            current = undefined;
        }
        else if (row.startsWith("author "))
            current.info.author = row.slice(7);
        else if (row.startsWith("author-mail "))
            current.info.authorEmail = row.slice(12).replace(/^<|>$/g, "");
        else if (row.startsWith("author-time "))
            current.info.time = Number(row.slice(12));
    }
    return lines;
}
/** Runs `fn` over `items` with at most `limit` running at once. */
async function pool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}
const DAY = 24 * 60 * 60 * 1000;
const UNCOMMITTED = /^0{40}$/;
/** Paths that are almost always vendored or generated. */
const VENDORED_PATH = /(?:^|\/)(?:node_modules|bower_components|vendor|vendored|third[_-]party|Pods|Carthage)\/|\.min\.(?:js|mjs|cjs|css)$|\.(?:pb|g|generated)\.\w+$/;
/** Headers code generators write at the top of a file. */
const GENERATED_HEADER = /@generated\b|\bDO NOT EDIT\b|\bauto-?generated\b/i;
/** Which of `files` are vendored or generated: by `linguist-vendored` / `linguist-generated` in .gitattributes, path, or header. */
export async function vendoredFiles(cwd, files) {
    const attrs = new Map();
    for (let i = 0; i < files.length; i += 200) {
        const out = await git(["check-attr", "-z", "linguist-vendored", "linguist-generated", "--", ...files.slice(i, i + 200)], cwd).catch(() => "");
        const parts = out.split("\0");
        for (let j = 0; j + 2 < parts.length; j += 3) {
            const [file, , value] = [parts[j], parts[j + 1], parts[j + 2]];
            if (value === "set" || value === "true")
                attrs.set(file, true);
            else if ((value === "unset" || value === "false") && !attrs.get(file))
                attrs.set(file, false);
        }
    }
    const skipped = new Set();
    for (const file of files) {
        const attr = attrs.get(file);
        if (attr === false)
            continue;
        if (attr === true || VENDORED_PATH.test(file) || hasGeneratedHeader(join(cwd, file)))
            skipped.add(file);
    }
    return skipped;
}
function hasGeneratedHeader(path) {
    try {
        const head = readFileSync(path, "utf8").slice(0, 2000).split("\n").slice(0, 5).join("\n");
        return GENERATED_HEADER.test(head);
    }
    catch {
        return false;
    }
}
const IGNORE = "stale-todo-ignore";
/** Finds TODO-style comments with git grep and dates each one with git blame. Oldest first. */
export async function scan(options) {
    return (await scanReport(options)).todos;
}
/** Like {@link scan}, plus what was ignored or skipped. */
export async function scanReport(options) {
    const { cwd, tags, commentsOnly = true, skipVendored = true } = options;
    const now = options.now ?? Date.now();
    const empty = { todos: [], ignored: 0, skippedFiles: [] };
    if (tags.length === 0)
        return empty;
    if (options.files && options.files.length === 0)
        return empty;
    const pathspecs = [
        ...(options.files ?? []).map((f) => `:(literal)${f}`),
        ...(options.include ?? []).map((g) => `:(glob)${g}`),
        ...(options.exclude ?? []).map((g) => `:(glob,exclude)${g}`),
    ];
    if (pathspecs.length > 0 && pathspecs.every((p) => p.startsWith(":(glob,exclude)")))
        pathspecs.unshift(".");
    const pattern = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const [out, ignoreOut] = await Promise.all([
        git(["grep", "-n", "-z", "-I", "--no-color", "-w", "-E", "-e", pattern, "--", ...pathspecs], cwd, true),
        git(["grep", "-n", "-z", "-I", "--no-color", "-F", "-e", IGNORE, "--", ...pathspecs], cwd, true),
    ]);
    // `stale-todo-ignore` skips its own line, `-next-line` the line after it, `-file` the whole file.
    const ignoredLines = new Set();
    const ignoredFiles = new Set();
    for (const hit of parseGrep(ignoreOut)) {
        if (hit.content.includes(`${IGNORE}-file`))
            ignoredFiles.add(hit.file);
        else if (hit.content.includes(`${IGNORE}-next-line`))
            ignoredLines.add(`${hit.line + 1}:${hit.file}`);
        else
            ignoredLines.add(`${hit.line}:${hit.file}`);
    }
    let ignored = 0;
    const byFile = new Map();
    for (const hit of parseGrep(out)) {
        const todo = parseTodo(hit.content, tags, commentsOnly);
        if (!todo)
            continue;
        if (ignoredFiles.has(hit.file) || ignoredLines.has(`${hit.line}:${hit.file}`)) {
            ignored++;
            continue;
        }
        const list = byFile.get(hit.file) ?? [];
        list.push({ ...hit, ...todo });
        byFile.set(hit.file, list);
    }
    const skippedFiles = skipVendored ? [...(await vendoredFiles(cwd, [...byFile.keys()]))] : [];
    for (const file of skippedFiles)
        byFile.delete(file);
    const ignoreRevs = existsSync(join(cwd, ".git-blame-ignore-revs")) ? ["--ignore-revs-file", ".git-blame-ignore-revs"] : [];
    const files = [...byFile.keys()];
    const blames = await pool(files, 8, async (file) => {
        const ranges = byFile.get(file).flatMap((h) => ["-L", `${h.line},${h.line}`]);
        try {
            return parsePorcelain(await git(["blame", "--line-porcelain", "-w", "-M", ...ignoreRevs, ...ranges, "--", file], cwd));
        }
        catch {
            // Untracked or unreadable: treat every line as new.
            return new Map();
        }
    });
    const todos = [];
    files.forEach((file, i) => {
        for (const hit of byFile.get(file)) {
            const blame = blames[i].get(hit.line);
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
    todos.sort((a, b) => a.date - b.date || a.file.localeCompare(b.file) || a.line - b.line);
    return { todos, ignored, skippedFiles: skippedFiles.sort() };
}
