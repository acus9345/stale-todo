/** The little of the GitHub REST API the action needs: one sticky PR comment and one tracking issue. */
export interface GitHub {
    /** API base, like https://api.github.com. */
    api: string;
    token: string;
    /** owner/name */
    repo: string;
    fetch: typeof fetch;
}
export declare const COMMENT_MARKER = "<!-- stale-todo:comment -->";
export declare const ISSUE_MARKER = "<!-- stale-todo:issue -->";
export type CommentResult = {
    action: "created" | "updated";
    url: string;
} | {
    action: "skipped";
};
/**
 * Keeps one stale-todo comment on a pull request: updates it when it exists, and creates it only when
 * there is something to report, so clean pull requests get no comment.
 */
export declare function upsertComment(gh: GitHub, pr: number, report: string, hasStale: boolean): Promise<CommentResult>;
export type IssueResult = {
    action: "created" | "updated" | "closed";
    url: string;
    number: number;
} | {
    action: "skipped";
};
/**
 * Keeps one open tracking issue: creates it when TODOs go stale, updates it on later runs, and closes it
 * once nothing is stale.
 */
export declare function upsertIssue(gh: GitHub, options: {
    title: string;
    labels: readonly string[];
    report: string;
    hasStale: boolean;
}): Promise<IssueResult>;
