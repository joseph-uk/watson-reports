# watson-reports

Public cheat sheets (city breaks, events) published as static pages on GitHub Pages.
Nothing here is private: reports are written to be shared. They are not indexed by search engines (`noindex`).

## Layout

```
docs/                      the published site
  index.html               generated list of reports (do not edit by hand)
  reports/<slug>/
    index.html             the report
    meta.json              title, dates, optional expiry
scripts/site.mjs           prune + index generator
.github/workflows/pages.yml   prune, build, deploy
```

## Adding a report

Reports are produced by the Watson project (`node scripts/publish-report.js`), which writes
`docs/reports/<slug>/index.html` and `meta.json` here and pushes. To add one by hand, create those two files.

`meta.json`:

```json
{ "title": "Berlin weekend", "subtitle": "optional", "startDate": "2026-11-27", "endDate": "2026-11-29" }
```

## Automatic clean-up

The workflow runs on every report push, daily at 03:17 UTC, and on demand. Each run:

1. runs the tests,
2. deletes every report whose expiry date is before today, and rebuilds `docs/index.html`,
3. commits that clean-up to `main`,
4. deploys `docs/` to GitHub Pages.

A report's expiry is, in order: `expires` in its `meta.json`; else its last day (`endDate`, or `startDate`) plus
`RETENTION_DAYS` (7, set in `.github/workflows/pages.yml`); else 30 days after `created`.

Folders with a missing or unreadable `meta.json` are never deleted, only reported in the workflow log.

Deleted reports stay in the git history of this public repository.

## Running locally

```bash
npm test
node scripts/site.mjs build --today 2026-12-01     # prune as if it were that day, rebuild index
```
