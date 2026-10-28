/** The little of the GitHub REST API the action needs: one sticky PR comment and one tracking issue. */
export const COMMENT_MARKER = "<!-- stale-todo:comment -->";
export const ISSUE_MARKER = "<!-- stale-todo:issue -->";
async function call(gh, method, path, body) {
    const res = await gh.fetch(`${gh.api}${path}`, {
        method,
        headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${gh.token}`,
            "user-agent": "stale-todo",
            "x-github-api-version": "2022-11-28",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`GitHub API ${method} ${path} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    return (await res.json());
}
/** Finds the first item on any page (up to 1000 items) that `match` accepts. */
async function find(gh, path, match) {
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= 10; page++) {
        const items = await call(gh, "GET", `${path}${sep}per_page=100&page=${page}`);
        const hit = items.find(match);
        if (hit)
            return hit;
        if (items.length < 100)
            return undefined;
    }
    return undefined;
}
/**
 * Keeps one stale-todo comment on a pull request: updates it when it exists, and creates it only when
 * there is something to report, so clean pull requests get no comment.
 */
export async function upsertComment(gh, pr, report, hasStale) {
    const body = `${COMMENT_MARKER}\n${report}`;
    const existing = await find(gh, `/repos/${gh.repo}/issues/${pr}/comments`, (c) => c.body?.includes(COMMENT_MARKER) ?? false);
    if (existing) {
        const updated = await call(gh, "PATCH", `/repos/${gh.repo}/issues/comments/${existing.id}`, { body });
        return { action: "updated", url: updated.html_url };
    }
    if (!hasStale)
        return { action: "skipped" };
    const created = await call(gh, "POST", `/repos/${gh.repo}/issues/${pr}/comments`, { body });
    return { action: "created", url: created.html_url };
}
/**
 * Keeps one open tracking issue: creates it when TODOs go stale, updates it on later runs, and closes it
 * once nothing is stale.
 */
export async function upsertIssue(gh, options) {
    const body = `${ISSUE_MARKER}\n${options.report}`;
    const existing = await find(gh, `/repos/${gh.repo}/issues?state=open`, (i) => !i.pull_request && (i.body?.includes(ISSUE_MARKER) ?? false));
    if (existing) {
        const patch = options.hasStale ? { title: options.title, body } : { body, state: "closed", state_reason: "completed" };
        const issue = await call(gh, "PATCH", `/repos/${gh.repo}/issues/${existing.number}`, patch);
        return { action: options.hasStale ? "updated" : "closed", url: issue.html_url, number: issue.number };
    }
    if (!options.hasStale)
        return { action: "skipped" };
    const issue = await call(gh, "POST", `/repos/${gh.repo}/issues`, {
        title: options.title,
        body,
        ...(options.labels.length > 0 ? { labels: options.labels } : {}),
    });
    return { action: "created", url: issue.html_url, number: issue.number };
}
