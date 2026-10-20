# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-20

### Added

- Finds `TODO`, `FIXME`, `HACK` and `XXX` comments (or your own `tags`) with `git grep`, dates them with `git blame`, and flags the ones older than `days`.
- Job summary report with links, ages, owners from `TODO(name):` and a per-person breakdown.
- Warning annotations on stale lines, and `total`, `stale`, `oldest-days`, `markdown` and `json` outputs.
- `include` / `exclude` globs, `only-changed` for pull requests, `comments-only`, `fail-on-stale` and `max-stale`.
- Honours `.git-blame-ignore-revs` and warns about shallow clones.

[1.0.0]: https://github.com/acus9345/stale-todo/releases/tag/v1.0.0
