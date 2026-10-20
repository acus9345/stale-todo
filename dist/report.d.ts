import type { Todo } from "./scan.js";
/** "3 days", "5 months", "2.5 years". */
export declare function formatAge(days: number): string;
export interface ReportOptions {
    days: number;
    total: number;
    /** Builds a link to a file and line, or `undefined` for plain text. */
    link?: (todo: Todo) => string | undefined;
    maxRows?: number;
}
/** The Markdown report: a headline, the stale TODOs oldest first, and who owns them. */
export declare function renderMarkdown(stale: readonly Todo[], options: ReportOptions): string;
