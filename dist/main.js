import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { upsertComment, upsertIssue } from "./github.js";
import { formatAge, renderMarkdown } from "./report.js";
import { git, scanReport } from "./scan.js";
/** Read an action input the way the runner passes it: `INPUT_<NAME>` with spaces as underscores. */
export function input(env, name, fallback = "") {
    return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? fallback).trim() || fallback;
}
const bool = (v, fallback) => (v === "" ? fallback : /^(true|yes|1|on)$/i.test(v));
const list = (v) => v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
function positiveNumber(name, value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
        throw new Error(`Input "${name}" must be a number, got "${value}".`);
    return n;
}
const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
function setOutput(env, name, value) {
    if (!env.GITHUB_OUTPUT)
        return;
    const delimiter = `ghadelimiter_${randomUUID()}`;
    appendFileSync(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}
/** The pull request in the event payload, if there is one. */
function pullRequest(env) {
    if (!env.GITHUB_EVENT_PATH)
        return undefined;
    try {
        const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
        return event.pull_request;
    }
    catch {
        return undefined;
    }
}
/** Run the action. Returns the process exit code. */
export async function run(env, io = { log: (l) => console.log(l) }) {
    const root = input(env, "path", ".");
    const cwd = resolve(env.GITHUB_WORKSPACE ?? process.cwd(), root);
    const days = positiveNumber("days", input(env, "days", "90"));
    const tags = list(input(env, "tags", "TODO,FIXME,HACK,XXX"));
    const include = list(input(env, "include"));
    const exclude = list(input(env, "exclude"));
    const onlyChanged = bool(input(env, "only-changed"), false);
    const commentsOnly = bool(input(env, "comments-only"), true);
    const failOnStale = bool(input(env, "fail-on-stale"), false);
    const maxStaleInput = input(env, "max-stale");
    const maxStale = maxStaleInput === "" ? undefined : positiveNumber("max-stale", maxStaleInput);
    const annotations = Math.floor(positiveNumber("max-annotations", input(env, "max-annotations", "10")));
    const summary = bool(input(env, "summary"), true);
    const maxRows = Math.floor(positiveNumber("max-rows", input(env, "max-rows", "50")));
    const skipVendored = bool(input(env, "skip-vendored"), true);
    const comment = bool(input(env, "comment"), false);
    const issue = bool(input(env, "issue"), false);
    const issueTitle = input(env, "issue-title", "Stale TODOs");
    const issueLabels = list(input(env, "issue-labels"));
    if ((await git(["rev-parse", "--is-shallow-repository"], cwd)).trim() === "true") {
        io.log("::warning title=stale-todo::This is a shallow clone, so every line looks as new as the latest commit. Add `fetch-depth: 0` to actions/checkout to get real ages.");
    }
    let files;
    if (onlyChanged) {
        const base = pullRequest(env)?.base?.sha;
        if (!base) {
            io.log("::notice title=stale-todo::only-changed works on pull_request events; checking every file.");
        }
        else {
            try {
                files = (await git(["diff", "--name-only", "--diff-filter=AMR", `${base}...HEAD`], cwd)).split("\n").filter(Boolean);
            }
            catch (error) {
                throw new Error(`Could not diff against the pull request base. Use \`fetch-depth: 0\` with actions/checkout. (${error.message})`);
            }
        }
    }
    const { todos, ignored, skippedFiles } = await scanReport({ cwd, tags, include, exclude, ...(files ? { files } : {}), commentsOnly, skipVendored, ...(io.now !== undefined ? { now: io.now } : {}) });
    const stale = todos.filter((t) => t.ageDays >= days);
    const server = env.GITHUB_SERVER_URL ?? "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const sha = env.GITHUB_SHA;
    const link = (t) => repo && sha ? `${server}/${repo}/blob/${sha}/${t.file.split("/").map(encodeURIComponent).join("/")}#L${t.line}` : undefined;
    const markdown = renderMarkdown(stale, { days, total: todos.length, link, maxRows });
    for (const t of stale.slice(0, annotations)) {
        const date = new Date(t.date).toISOString().slice(0, 10);
        const props = [`file=${escapeProperty(posix.join(root.replace(/\\/g, "/"), t.file))}`, `line=${t.line}`, `title=${escapeProperty(`Stale ${t.tag} (${formatAge(t.ageDays)} old)`)}`];
        io.log(`::warning ${props.join(",")}::${escapeData(`${t.text || t.tag} (last changed by ${t.author} on ${date})`)}`);
    }
    if (summary && env.GITHUB_STEP_SUMMARY)
        appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    setOutput(env, "total", String(todos.length));
    setOutput(env, "stale", String(stale.length));
    setOutput(env, "oldest-days", String(todos[0]?.ageDays ?? 0));
    setOutput(env, "ignored", String(ignored));
    setOutput(env, "markdown", markdown);
    setOutput(env, "json", JSON.stringify(stale.map(({ file, line, tag, text, owner, author, commit, date, ageDays }) => ({ file, line, tag, text, owner, author, commit, date: new Date(date).toISOString(), ageDays }))));
    if (comment || issue) {
        const token = input(env, "token") || env.GITHUB_TOKEN || "";
        if (!token || !repo) {
            io.log("::warning title=stale-todo::Posting a comment or issue needs the `token` input and GITHUB_REPOSITORY.");
        }
        else {
            const gh = { api: env.GITHUB_API_URL ?? "https://api.github.com", token, repo, fetch: io.fetch ?? fetch };
            const runUrl = env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
            const footer = `\n\n<sub>Updated by [stale-todo](https://github.com/acus9345/stale-todo)${runUrl ? ` in [this run](${runUrl})` : ""}.</sub>`;
            const report = markdown + footer;
            const hasStale = stale.length > 0;
            if (comment) {
                const pr = pullRequest(env)?.number;
                if (pr === undefined) {
                    io.log("::notice title=stale-todo::comment works on pull_request events; skipping the comment.");
                }
                else {
                    try {
                        const result = await upsertComment(gh, pr, report, hasStale);
                        if (result.action !== "skipped") {
                            setOutput(env, "comment-url", result.url);
                            io.log(`${result.action === "created" ? "Commented on" : "Updated the comment on"} pull request #${pr}: ${result.url}`);
                        }
                    }
                    catch (error) {
                        io.log(`::warning title=stale-todo::Could not comment on pull request #${pr}. Give the job \`permissions: pull-requests: write\`. (${escapeData(error.message)})`);
                    }
                }
            }
            if (issue) {
                try {
                    const result = await upsertIssue(gh, { title: issueTitle, labels: issueLabels, report, hasStale });
                    if (result.action !== "skipped") {
                        setOutput(env, "issue-url", result.url);
                        setOutput(env, "issue-number", String(result.number));
                        io.log(`${result.action[0].toUpperCase()}${result.action.slice(1)} issue #${result.number}: ${result.url}`);
                    }
                }
                catch (error) {
                    io.log(`::warning title=stale-todo::Could not update the tracking issue. Give the job \`permissions: issues: write\`. (${escapeData(error.message)})`);
                }
            }
        }
    }
    const extra = [
        ignored > 0 ? `${ignored} ignored by comment` : "",
        skippedFiles.length > 0 ? `${skippedFiles.length} vendored or generated file${skippedFiles.length === 1 ? "" : "s"} skipped` : "",
    ].filter(Boolean);
    io.log(`Found ${todos.length} TODO${todos.length === 1 ? "" : "s"}, ${stale.length} older than ${days} days.${extra.length > 0 ? ` (${extra.join(", ")})` : ""}`);
    if (failOnStale && stale.length > 0) {
        io.log(`::error title=stale-todo::${stale.length} TODO${stale.length === 1 ? " is" : "s are"} older than ${days} days.`);
        return 1;
    }
    if (maxStale !== undefined && stale.length > maxStale) {
        io.log(`::error title=stale-todo::${stale.length} stale TODOs, more than the limit of ${maxStale}.`);
        return 1;
    }
    return 0;
}
