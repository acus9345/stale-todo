import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { run } from "../dist/main.js";
import { formatAge, renderMarkdown } from "../dist/report.js";
import { parseGrep, parsePorcelain, parseTodo, scan } from "../dist/scan.js";

const TAGS = ["TODO", "FIXME", "HACK", "XXX"];
const NOW = Date.parse("2026-10-20T12:00:00Z");

describe("parseTodo()", () => {
  it("finds keywords in comments of many languages", () => {
    assert.deepEqual(parseTodo("  // TODO: handle errors", TAGS), { tag: "TODO", text: "handle errors", owner: undefined });
    assert.deepEqual(parseTodo("# FIXME(alice): flaky on Windows", TAGS), { tag: "FIXME", text: "flaky on Windows", owner: "alice" });
    assert.deepEqual(parseTodo("/* HACK - remove after v2 */", TAGS), { tag: "HACK", text: "remove after v2", owner: undefined });
    assert.deepEqual(parseTodo(" * TODO(@bob) docs", TAGS), { tag: "TODO", text: "docs", owner: "bob" });
    assert.deepEqual(parseTodo("<!-- TODO: add image -->", TAGS), { tag: "TODO", text: "add image", owner: undefined });
    assert.deepEqual(parseTodo("-- XXX", TAGS), { tag: "XXX", text: "", owner: undefined });
    assert.equal(parseTodo("x = 1; // TODO later", TAGS)!.text, "later");
  });

  it("ignores keywords outside comments, and partial words", () => {
    assert.equal(parseTodo('const status = "TODO";', TAGS), undefined);
    assert.equal(parseTodo("TODO list app", TAGS), undefined);
    assert.equal(parseTodo("// TODOS and TODO_ITEMS", TAGS), undefined);
    assert.equal(parseTodo("TODO list app", TAGS, false)!.text, "list app");
  });
});

describe("parsers", () => {
  it("parses git grep -z output", () => {
    assert.deepEqual(parseGrep("src/a.ts\x0012\x00// TODO x\nb:c.py\x003\x00# FIXME\n"), [
      { file: "src/a.ts", line: 12, content: "// TODO x" },
      { file: "b:c.py", line: 3, content: "# FIXME" },
    ]);
    assert.deepEqual(parseGrep("a.ts\x007:// TODO: y\n"), [{ file: "a.ts", line: 7, content: "// TODO: y" }]);
  });

  it("parses git blame --line-porcelain output", () => {
    const sha = "a".repeat(40);
    const out = [
      `${sha} 3 5 1`,
      "author Ada Lovelace",
      "author-mail <ada@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "summary first",
      "filename a.ts",
      "\t// TODO: x",
      `${"0".repeat(40)} 9 9 1`,
      "author Not Committed Yet",
      "author-mail <not.committed.yet>",
      "author-time 1800000000",
      "filename a.ts",
      "\t// FIXME",
    ].join("\n");
    const map = parsePorcelain(out);
    assert.deepEqual(map.get(5), { commit: sha, author: "Ada Lovelace", authorEmail: "ada@example.com", time: 1700000000 });
    assert.equal(map.get(9)!.commit, "0".repeat(40));
  });

  it("formats ages", () => {
    assert.equal(formatAge(0), "today");
    assert.equal(formatAge(1), "1 day");
    assert.equal(formatAge(45), "45 days");
    assert.equal(formatAge(200), "6 months");
    assert.equal(formatAge(365), "1 year");
    assert.equal(formatAge(900), "2.5 years");
  });
});

describe("in a git repository", () => {
  let repo: string;
  const git = (args: string[], date?: string) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const commit = (message: string, date: string, author = "Ada <ada@example.com>") => {
    git(["add", "-A"]);
    git(["-c", "user.name=Ada", "-c", "user.email=ada@example.com", "commit", "-q", "--author", author, "-m", message], date);
  };

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "stale-todo-"));
    git(["init", "-q", "-b", "main"]);
    write("src/old.ts", "export const a = 1; // TODO: remove this hack\n// FIXME(bob): race condition\nconst s = 'TODO';\n");
    write("vendor/lib.js", "// TODO: vendored\n");
    commit("old", "2024-01-15T10:00:00Z");
    write("src/new.py", "# TODO add tests\nprint('hi')\n");
    commit("new", "2026-10-01T10:00:00Z", "Grace <grace@example.com>");
    // Touch an old file without changing the TODO line: blame keeps the old date.
    write("src/old.ts", "export const a = 1; // TODO: remove this hack\n// FIXME(bob): race condition\nconst s = 'TODO';\nexport const b = 2;\n");
    commit("touch", "2026-10-10T10:00:00Z", "Grace <grace@example.com>");
    write("src/wip.ts", "// HACK: not committed yet\n");
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  it("finds TODOs and dates them with git blame, oldest first", async () => {
    const todos = await scan({ cwd: repo, tags: TAGS, now: NOW });
    assert.deepEqual(
      todos.map((t) => [t.file, t.line, t.tag, t.author, t.ageDays]),
      [
        ["src/old.ts", 1, "TODO", "Ada", 1009],
        ["src/old.ts", 2, "FIXME", "Ada", 1009],
        ["src/new.py", 1, "TODO", "Grace", 19],
      ],
    );
    assert.equal(todos[1]!.owner, "bob");
    const all = await scan({ cwd: repo, tags: TAGS, now: NOW, skipVendored: false });
    assert.ok(all.some((t) => t.file === "vendor/lib.js"));
  });

  it("respects include, exclude and file lists", async () => {
    const ex = await scan({ cwd: repo, tags: TAGS, exclude: ["vendor/**"], now: NOW });
    assert.ok(!ex.some((t) => t.file.startsWith("vendor/")));
    const inc = await scan({ cwd: repo, tags: TAGS, include: ["**/*.py"], now: NOW });
    assert.deepEqual(inc.map((t) => t.file), ["src/new.py"]);
    const only = await scan({ cwd: repo, tags: ["FIXME"], files: ["src/old.ts"], now: NOW });
    assert.deepEqual(only.map((t) => t.tag), ["FIXME"]);
    assert.deepEqual(await scan({ cwd: repo, tags: TAGS, files: [], now: NOW }), []);
  });

  it("runs as an action: outputs, summary, annotations and failure", async () => {
    const outFile = join(repo, "..", `out-${Date.now()}.txt`);
    const summaryFile = join(repo, "..", `summary-${Date.now()}.md`);
    writeFileSync(outFile, "");
    writeFileSync(summaryFile, "");
    const logs: string[] = [];
    const env = {
      GITHUB_WORKSPACE: repo,
      GITHUB_OUTPUT: outFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_SHA: "abc123",
      INPUT_DAYS: "365",
      INPUT_EXCLUDE: "vendor/**",
      "INPUT_FAIL-ON-STALE": "true",
    };
    const code = await run(env, { log: (l) => logs.push(l), now: NOW });
    assert.equal(code, 1);

    const outputs = readFileSync(outFile, "utf8");
    assert.match(outputs, /^total<<ghadelimiter_[\w-]+\n3\n/m);
    assert.match(outputs, /^stale<<ghadelimiter_[\w-]+\n2\n/m);
    const json = JSON.parse(/^json<<(\S+)\n([\s\S]*?)\n\1$/m.exec(outputs)![2]!);
    assert.equal(json[0].file, "src/old.ts");
    assert.equal(json[0].date, "2024-01-15T10:00:00.000Z");

    const summary = readFileSync(summaryFile, "utf8");
    assert.match(summary, /\*\*2\*\* of \*\*3\*\* TODOs are older than \*\*365 days\*\*/);
    assert.match(summary, /\[src\/old\.ts:1\]\(https:\/\/github\.com\/acme\/app\/blob\/abc123\/src\/old\.ts#L1\)/);
    assert.match(summary, /Ada \(owner: bob\)/);

    assert.ok(logs.some((l) => l.startsWith("::warning file=src/old.ts,line=1,title=Stale TODO (2.8 years old)::remove this hack (last changed by Ada on 2024-01-15)")), logs.join("\n"));
    assert.ok(logs.some((l) => l.startsWith("::error title=stale-todo::2 TODOs are older than 365 days.")));

    assert.equal(await run({ ...env, "INPUT_FAIL-ON-STALE": "false", "INPUT_MAX-STALE": "2" }, { log: () => {}, now: NOW }), 0);
    assert.equal(await run({ ...env, "INPUT_FAIL-ON-STALE": "false", "INPUT_MAX-STALE": "1" }, { log: () => {}, now: NOW }), 1);
    rmSync(outFile);
    rmSync(summaryFile);
  });

  it("limits a pull request to the files it changed", async () => {
    const base = git(["rev-parse", "HEAD~1"]).trim();
    const event = join(repo, "..", `event-${Date.now()}.json`);
    writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base } } }));
    const logs: string[] = [];
    const env = { GITHUB_WORKSPACE: repo, GITHUB_EVENT_PATH: event, "INPUT_ONLY-CHANGED": "true", INPUT_DAYS: "0" };
    assert.equal(await run(env, { log: (l) => logs.push(l), now: NOW }), 0);
    // Only src/old.ts changed since HEAD~1.
    assert.match(logs.at(-1)!, /^Found 2 TODOs, 2 older than 0 days\.$/);
    rmSync(event);
  });

  it("rejects bad inputs", async () => {
    await assert.rejects(run({ GITHUB_WORKSPACE: repo, INPUT_DAYS: "soon" }, { log: () => {} }), /"days" must be a number/);
  });
});

describe("renderMarkdown()", () => {
  it("says so when nothing is stale", () => {
    assert.match(renderMarkdown([], { days: 30, total: 4 }), /No TODOs older than \*\*30 days\*\* \(4 TODOs checked\)/);
  });
});
