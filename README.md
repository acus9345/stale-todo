# Stale TODO Finder

A GitHub Action that finds the `TODO`, `FIXME` and `HACK` comments that have been sitting in your code for too long. It uses `git blame` to date every one, then reports the stale ones in the job summary, as annotations on the code, and as outputs you can turn into an issue or a PR comment. Zero dependencies, fast on large repos.

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

### Keep a tracking issue up to date

The `markdown` output is the whole report, so you can post it anywhere:

```yaml
- id: todos
  uses: acus9345/stale-todo@v1
- if: steps.todos.outputs.stale != '0'
  env:
    GH_TOKEN: ${{ github.token }}
    REPORT: ${{ steps.todos.outputs.markdown }}
  run: |
    number=$(gh issue list --label stale-todos --state open --json number --jq '.[0].number')
    if [ -n "$number" ]; then gh issue edit "$number" --body "$REPORT"
    else gh issue create --title "Stale TODOs" --label stale-todos --body "$REPORT"; fi
```

(Give the job `permissions: issues: write`.)

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

## Outputs

| Output | Description |
| --- | --- |
| `total` | TODOs found. |
| `stale` | Stale TODOs. |
| `oldest-days` | Age of the oldest TODO, in days. |
| `markdown` | The report as Markdown. |
| `json` | Stale TODOs as JSON: `[{ file, line, tag, text, owner, author, commit, date, ageDays }]`. |

## How it works

1. `git grep` finds the keywords in tracked, non-binary files (so `.gitignore`d and generated files are skipped for free).
2. Matches that aren't in a comment are dropped: `const s = "TODO"` is not a TODO. Comments in `//`, `#`, `/* */`, `--`, `<!-- -->`, `;`, `%`, `'`, `{# #}` and `"""` styles are recognized.
3. `git blame -w -M` dates each line, ignoring whitespace-only changes and lines moved within a file. If your repo has a `.git-blame-ignore-revs` file (for big reformat commits), it's used automatically.
4. An owner written as `TODO(alice):` or `FIXME(@bob)` is shown next to the last author.

The age is when the **line** last changed, so rewording a TODO resets its clock, and editing other lines in the file doesn't.

## License

[MIT](LICENSE)
