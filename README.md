# Stale TODO Finder

A GitHub Action that finds the `TODO`, `FIXME` and `HACK` comments that have been sitting in your code for too long. It uses `git blame` to date every one, then reports the stale ones in the job summary, as annotations on the code, in a pull request comment or tracking issue, and as outputs. Zero dependencies, fast on large repos.

[![CI](https://github.com/acus9345/stale-todo/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/stale-todo/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/acus9345/stale-todo)](LICENSE)

> ## Stale TODOs
>
> 🕸️ **2** of **14** TODOs are older than **90 days**. The oldest is **2.8 years** old.
>
> | Age | | Where | Last touched by | Comment |
> | --- | --- | --- | --- | --- |
> | 2.8 years <sub>2024-01-15</sub> | `TODO` | [src/api.ts:41](#) | Ada | remove this retry hack |
> | 1.2 years <sub>2025-08-02</sub> | `FIXME` | [src/db.ts:118](#) | Ada (owner: bob) | race condition on reconnect |

## Usage

```yaml
# .github/workflows/stale-todos.yml
name: Stale TODOs

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 9 * * 1" # every Monday

jobs:
  todos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # full history, so git blame knows how old each line is
      - uses: acus9345/stale-todo@v1
        with:
          days: 90
```

> **`fetch-depth: 0` matters.** With the default shallow clone every line looks as new as the latest commit. The action warns you when it detects one.

### Fail when TODOs pile up

```yaml
- uses: acus9345/stale-todo@v1
  with:
    days: 180
    max-stale: 20 # fail the step when there are more than 20
```

Or `fail-on-stale: true` to fail on any.

### Only the files a pull request touches

Nudge people to clean up the code they are already changing:

```yaml
on: pull_request

jobs:
  todos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: acus9345/stale-todo@v1
        with:
          only-changed: true
          days: 60
```

Stale TODOs in the changed files are annotated right in the pull request diff.

### Comment on pull requests

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  todos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: acus9345/stale-todo@v1
        with:
          only-changed: true
          comment: true
```

The action keeps a single comment on the pull request and edits it on every push, so the thread doesn't fill up. While nothing is stale, it posts nothing. If a later push clears the stale TODOs, the existing comment is updated to say so.

Pull requests from forks get a read-only token, so the comment can't be posted there. The action warns about that instead of failing.

### Keep a tracking issue up to date

```yaml
on:
  schedule:
    - cron: "0 9 * * 1" # every Monday

permissions:
  contents: read
  issues: write

jobs:
  todos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: acus9345/stale-todo@v1
        with:
          days: 180
          issue: true
          issue-labels: tech-debt
```

The action opens one issue when TODOs go stale, rewrites it on each run, and closes it once nothing is stale. Each row names who last touched the line, so you know who to ask.

The `markdown` output is the same report, if you'd rather post it somewhere else, like Slack.

### Ignore a TODO

Some TODOs are fine to keep. Mark them and they drop out of the report:

```ts
// TODO: support IE11 stale-todo-ignore           ← this line

// stale-todo-ignore-next-line
// FIXME: blocked on the vendor's API             ← the line after the marker

// stale-todo-ignore-file                         ← anywhere in a file: the whole file
```

The `ignored` output counts them, and the log line says how many were ignored.

### Vendored and generated files

TODOs in code you didn't write aren't yours to fix, so these files are skipped by default:

- Files marked `linguist-vendored` or `linguist-generated` in `.gitattributes`, the same attributes GitHub uses.
- Paths under `node_modules/`, `vendor/`, `third_party/`, `bower_components/`, `Pods/` and `Carthage/`, and minified `*.min.js` and `*.min.css` files.
- Generated files like `*.pb.go` and `*.g.dart`, and any file with `@generated`, `DO NOT EDIT` or `auto-generated` in its first five lines.

To check a vendored path anyway, unset the attribute in `.gitattributes`:

```gitattributes
vendor/our-fork/** -linguist-vendored
```

Or set `skip-vendored: false` to check everything.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `days` | `90` | A TODO is stale when its line was last changed at least this many days ago. |
| `tags` | `TODO,FIXME,HACK,XXX` | Keywords to look for. Case-sensitive, whole words. |
| `include` | all tracked files | Globs to search, comma- or newline-separated, like `src/**,lib/**`. |
| `exclude` | | Globs to skip, like `vendor/**,**/*.min.js`. |
| `only-changed` | `false` | On pull requests, only check files the PR changed. |
| `comments-only` | `true` | Only count keywords in comments. `false` matches anywhere (Markdown checklists, plain text). |
| `fail-on-stale` | `false` | Fail when any TODO is stale. |
| `max-stale` | | Fail when there are more stale TODOs than this. |
| `max-annotations` | `10` | Most stale TODOs to annotate (GitHub shows 10 warnings per step). |
| `summary` | `true` | Write the report to the job summary. |
| `max-rows` | `50` | Most rows in the report. |
| `path` | `.` | Where the repository is checked out, if not the workspace root. |
| `skip-vendored` | `true` | Skip vendored and generated files. See [below](#vendored-and-generated-files). |
| `comment` | `false` | On pull requests, keep one comment with the report. |
| `issue` | `false` | Keep one tracking issue with the report, closed once nothing is stale. |
| `issue-title` | `Stale TODOs` | Title of the tracking issue. |
| `issue-labels` | | Labels for a new tracking issue, comma-separated. |
| `token` | `${{ github.token }}` | Token for the comment and issue. |

## Outputs

| Output | Description |
| --- | --- |
| `total` | TODOs found. |
| `stale` | Stale TODOs. |
| `oldest-days` | Age of the oldest TODO, in days. |
| `ignored` | TODOs skipped by a `stale-todo-ignore` comment. |
| `comment-url` | The pull request comment, when one was posted or updated. |
| `issue-url`, `issue-number` | The tracking issue, when one was created, updated or closed. |
| `markdown` | The report as Markdown. |
| `json` | Stale TODOs as JSON: `[{ file, line, tag, text, owner, author, commit, date, ageDays }]`. |

## How it works

1. `git grep` finds the keywords in tracked, non-binary files, so `.gitignore`d files are skipped for free. Vendored and generated files are skipped next, and so are lines with a `stale-todo-ignore` comment.
2. Matches that aren't in a comment are dropped: `const s = "TODO"` is not a TODO. Comments in `//`, `#`, `/* */`, `--`, `<!-- -->`, `;`, `%`, `'`, `{# #}` and `"""` styles are recognized.
3. `git blame -w -M` dates each line, ignoring whitespace-only changes and lines moved within a file. If your repo has a `.git-blame-ignore-revs` file (for big reformat commits), it's used automatically.
4. An owner written as `TODO(alice):` or `FIXME(@bob)` is shown next to the last author.

The age is when the **line** last changed, so rewording a TODO resets its clock, and editing other lines in the file doesn't.

## License

[MIT](LICENSE)
