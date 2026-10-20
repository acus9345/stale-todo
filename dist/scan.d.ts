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
export declare function git(args: readonly string[], cwd: string, allowExit1?: boolean): Promise<string>;
export interface GrepHit {
    file: string;
    line: number;
    content: string;
}
/** Parses `git grep -n -z` output: `path\0line\0content` (or `path\0line:content` on older git). */
export declare function parseGrep(output: string): GrepHit[];
export interface ParsedTodo {
    tag: string;
    text: string;
    owner: string | undefined;
}
/** Finds the first keyword in a line and pulls out its owner and text. */
export declare function parseTodo(content: string, tags: readonly string[], commentsOnly?: boolean): ParsedTodo | undefined;
export interface BlameLine {
    commit: string;
    author: string;
    authorEmail: string;
    /** Seconds since the epoch. */
    time: number;
}
/** Parses `git blame --line-porcelain` output into a map of final line number → commit info. */
export declare function parsePorcelain(output: string): Map<number, BlameLine>;
/** Finds TODO-style comments with git grep and dates each one with git blame. Oldest first. */
export declare function scan(options: ScanOptions): Promise<Todo[]>;
