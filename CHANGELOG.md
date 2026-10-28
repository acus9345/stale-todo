# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-28

### Added

- `comment: true` keeps one comment with the report on the pull request, edited on each push. Nothing is posted while no TODO is stale.
- `issue: true` keeps one tracking issue: opened when TODOs go stale, updated on each run, closed once nothing is stale. Set its title and labels with `issue-title` and `issue-labels`.
- `stale-todo-ignore`, `stale-todo-ignore-next-line` and `stale-todo-ignore-file` comments leave TODOs out of the report. The new `ignored` output counts them.
- `comment-url`, `issue-url` and `issue-number` outputs, and a `token` input.

### Changed

- Vendored and generated files are skipped by default: `linguist-vendored` and `linguist-generated` in `.gitattributes`, `node_modules/`, `vendor/`, `third_party/` and similar paths, minified files, and files with an `@generated` or `DO NOT EDIT` header. Set `skip-vendored: false` for the old behavior.

## [1.0.0] - 2026-10-20

### Added

- Finds `TODO`, `FIXME`, `HACK` and `XXX` comments (or your own `tags`) with `git grep`, dates them with `git blame`, and flags the ones older than `days`.
- Job summary report with links, ages, owners from `TODO(name):` and a per-person breakdown.
- Warning annotations on stale lines, and `total`, `stale`, `oldest-days`, `markdown` and `json` outputs.
- `include` / `exclude` globs, `only-changed` for pull requests, `comments-only`, `fail-on-stale` and `max-stale`.
- Honours `.git-blame-ignore-revs` and warns about shallow clones.

[1.1.0]: https://github.com/acus9345/stale-todo/releases/tag/v1.1.0
[1.0.0]: https://github.com/acus9345/stale-todo/releases/tag/v1.0.0
