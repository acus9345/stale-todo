export interface RunIO {
    log: (line: string) => void;
    /** "Now", for tests. */
    now?: number;
    /** `fetch` for the GitHub API, for tests. */
    fetch?: typeof fetch;
}
/** Read an action input the way the runner passes it: `INPUT_<NAME>` with spaces as underscores. */
export declare function input(env: NodeJS.ProcessEnv, name: string, fallback?: string): string;
/** Run the action. Returns the process exit code. */
export declare function run(env: NodeJS.ProcessEnv, io?: RunIO): Promise<number>;
