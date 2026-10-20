/** "3 days", "5 months", "2.5 years". */
export function formatAge(days) {
    if (days < 1)
        return "today";
    if (days < 60)
        return `${days} day${days === 1 ? "" : "s"}`;
    if (days < 365)
        return `${Math.floor(days / 30)} months`;
    const years = Math.round((days / 365) * 10) / 10;
    return `${years} year${years === 1 ? "" : "s"}`;
}
const cell = (s) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").replace(/</g, "&lt;");
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** The Markdown report: a headline, the stale TODOs oldest first, and who owns them. */
export function renderMarkdown(stale, options) {
    const { days, total, maxRows = 50 } = options;
    const lines = ["## Stale TODOs", ""];
    if (stale.length === 0) {
        lines.push(`✅ No TODOs older than **${days} days** (${total} TODO${total === 1 ? "" : "s"} checked).`);
        return lines.join("\n");
    }
    const oldest = stale[0];
    lines.push(`🕸️ **${stale.length}** of **${total}** TODO${total === 1 ? "" : "s"} ${stale.length === 1 ? "is" : "are"} older than **${days} days**. The oldest is **${formatAge(oldest.ageDays)}** old.`, "", "| Age | | Where | Last touched by | Comment |", "| --- | --- | --- | --- | --- |");
    for (const t of stale.slice(0, maxRows)) {
        const where = `${t.file}:${t.line}`;
        const href = options.link?.(t);
        const date = new Date(t.date).toISOString().slice(0, 10);
        const who = t.owner ? `${cell(t.author)} (owner: ${cell(t.owner)})` : cell(t.author);
        lines.push(`| ${formatAge(t.ageDays)} <sub>${date}</sub> | \`${t.tag}\` | ${href ? `[${cell(where)}](${href})` : cell(where)} | ${who} | ${cell(truncate(t.text, 120)) || "<i>(no text)</i>"} |`);
    }
    if (stale.length > maxRows)
        lines.push("", `…and ${stale.length - maxRows} more.`);
    const byPerson = new Map();
    for (const t of stale)
        byPerson.set(t.owner ?? t.author, (byPerson.get(t.owner ?? t.author) ?? 0) + 1);
    if (byPerson.size > 1) {
        const top = [...byPerson.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
        lines.push("", "<details><summary>By person</summary>", "", "| Person | Stale TODOs |", "| --- | --- |");
        for (const [who, n] of top)
            lines.push(`| ${cell(who)} | ${n} |`);
        lines.push("", "</details>");
    }
    return lines.join("\n");
}
