// Entry point the Actions runner executes (dist/index.js).
import { run } from "./main.js";
run(process.env).then((code) => {
    process.exitCode = code;
}, (error) => {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
