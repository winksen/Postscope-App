# PostScope in CI

PostScope audits Postman collections the same way in a pipeline as in the browser. Nothing is uploaded anywhere: the scan runs on the CI runner and the reports only contain masked evidence.

This guide covers GitHub Actions, GitLab CI, Azure DevOps and a pre-commit hook. The command line reference is `postscope --help`.

---

## 1. Get the command

PostScope compiles to one JavaScript file that runs with plain `node` (20.6 or newer). No TypeScript toolchain and no `node_modules` are needed to run it.

| Way | Command |
|---|---|
| From a clone of this repository | `npm ci && npm run build:node`, then `node dist-node/cli.js scan <paths>` |
| As `postscope` on your PATH | `npm install -g .` in the clone after `npm run build:node` (the `bin` entry is `dist-node/cli.js`) |
| Without installing the project | `npx --yes esbuild@0.25.12 cli/postscope.ts --bundle --platform=node --format=esm --target=node20 --outfile=postscope.mjs` from the clone, then `node postscope.mjs scan <paths>` |
| Inside the Docker image | `docker run --rm -v "$PWD:/work" postscope:<version> node dist-node/cli.js scan /work/collections` |

---

## 2. What the command accepts

```bash
postscope scan <file | folder | glob> [more paths] [options]
```

| Input | Meaning |
|---|---|
| A file | Scanned as is |
| A folder | Searched recursively for `*.postman_collection.json` (`node_modules` and `.git` are skipped) |
| A glob | Expanded by PostScope, so quoting works on every shell: `"collections/**/*.postman_collection.json"`. Supports `*`, `**`, `?`, `[abc]` and `{a,b}` |
| `-` | Standard input |

Useful options (all in `postscope --help`):

| Option | Purpose |
|---|---|
| `--fail-on critical\|warning\|info\|none` | Exit code 1 when a finding at or above this severity exists (default `critical`) |
| `--min-score N` | Exit code 1 when a collection scores below N |
| `--baseline file` / `--write-baseline file` | Fail only on findings that are new compared with a committed baseline |
| `--config file` | Project config (`.postscope.json`), otherwise the nearest one above each collection is used |
| `--sanitize file` with `--redact-pii` | Write a sanitized copy that also replaces personal data (emails, phone and card numbers, IBANs, national ids, dates of birth, employee ids) in request bodies and saved examples |
| `--compliance nist-800-53\|iso-27001\|cis-v8` | Group the text, Markdown, HTML and JSON reports by the controls of one framework. Every report already has a compliance mapping table per finding |
| `--format identity-csv` | Write `identity-inventory.csv` for access reviews and audits: endpoint class, platform, method, URL without query, request and related findings |
| `--packs auto\|none\|PACK,-PACK` | Rule packs. `auto` (default) turns the identity packs on when the collection shows identity signals; list packs (`iam-am`, `iam-iga`, `iam-pam`, `iam-platform`) to force them on, prefix with `-` to force them off |
| `--auto-env` | Also analyze `*.postman_environment.json` and `*.postman_globals.json` stored next to each collection |
| `--format text\|json\|sarif\|markdown\|html\|junit` | Report format; `--output file` writes it to a file |

Exit codes: `0` passed, `1` policy failed, `2` usage or input error (a bad path, a pattern with no match, an invalid config).

---

## 3. GitHub Actions

The repository ships a composite action (`action.yml`). It builds the CLI with esbuild, scans, writes a SARIF file, adds a Markdown summary to the job, and fails the job when the policy fails.

```yaml
name: PostScope
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write   # needed to upload SARIF

jobs:
  postscope:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Scan Postman collections
        id: scan
        uses: winksen/Postscope-App@v0.2.13
        with:
          path: collections
          fail-on: critical
          min-score: 70
          baseline: postscope-baseline.json   # optional
          sarif-output: postscope.sarif

      - name: Upload to code scanning
        if: always() && hashFiles('postscope.sarif') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: postscope.sarif
          category: postscope
```

| Input | Default | Purpose |
|---|---|---|
| `path` | `.` | File, folder or glob |
| `fail-on` | `critical` | Failing severity (`critical`, `warning`, `info`, `none`) |
| `min-score` | empty | Minimum score; empty disables the check |
| `baseline` | empty | Baseline file; only new findings are reported and can fail the job |
| `sarif-output` | `postscope.sarif` | Where the SARIF file is written |
| `config` | empty | Project config; empty uses `.postscope.json` discovery |
| `auto-env` | `false` | Analyze environment files next to each collection |
| `node-version` | `20` | Node.js version used to run the scan |

Outputs: `sarif-file` and `exit-code`. SARIF results carry the line and column of the offending value, so alerts open on the right line of the collection file.

Pin the action to a release tag or a commit SHA, as for any third-party action.

---

## 4. GitLab CI

JUnit output feeds the "Tests" tab of the pipeline: each finding at or above `--fail-on` is a failed test case, lower findings pass with their details attached, and suppressed findings are shown as skipped.

```yaml
postscope:
  image: node:20-alpine
  stage: test
  script:
    - npm ci
    - npm run build:node
    - >
      node dist-node/cli.js scan "collections/**/*.postman_collection.json"
      --fail-on critical --format junit --output postscope-junit.xml
    - >
      node dist-node/cli.js scan "collections/**/*.postman_collection.json"
      --fail-on none --format html --output postscope-report.html --quiet
  artifacts:
    when: always
    paths:
      - postscope-report.html
    reports:
      junit: postscope-junit.xml
```

If the collections live in another repository, check that repository out first and point `scan` at it, or run PostScope from its own CI.

---

## 5. Azure DevOps

```yaml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: |
      npm ci
      npm run build:node
    displayName: Build PostScope
    workingDirectory: tools/postscope        # where this repository is checked out

  - script: >
      node tools/postscope/dist-node/cli.js scan "collections/**/*.postman_collection.json"
      --fail-on critical --format junit --output $(Build.ArtifactStagingDirectory)/postscope-junit.xml
    displayName: Scan Postman collections

  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: '$(Build.ArtifactStagingDirectory)/postscope-junit.xml'
      testRunTitle: PostScope
```

For SARIF, write `--format sarif --output postscope.sarif` and publish it with the SARIF viewer extension of your organization.

---

## 6. Pre-commit hook

Catch secrets before they reach the repository. With the [pre-commit](https://pre-commit.com) framework:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: postscope
        name: PostScope (Postman collections)
        entry: node tools/postscope/dist-node/cli.js scan --fail-on critical --quiet
        language: system
        files: '\.postman_(collection|environment|globals)\.json$'
        pass_filenames: true
```

Without the framework, a plain git hook works the same way:

```bash
#!/bin/sh
# .git/hooks/pre-commit
files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.postman_collection\.json$' || true)
[ -z "$files" ] && exit 0
exec node tools/postscope/dist-node/cli.js scan --fail-on critical --quiet $files
```

Environment and globals files are analyzed together with a collection (`--environment`, `--globals` or `--auto-env`). A hook that is handed only an environment file should run `--auto-env` on the collection next to it instead.

---

## 7. Comparing two versions (pull requests)

`postscope diff` audits an older and a newer version of a collection and reports only what changed: new, resolved and unchanged findings, the score change, requests that were added, removed or edited, and new hosts or auth types. A request that was renamed or moved is still the same request (matched by id, then by method and URL), so its existing findings are not reported as new.

```bash
postscope diff old.postman_collection.json new.postman_collection.json --fail-on-new critical
postscope diff old.json new.json --format markdown --output postscope-diff.md --fail-on-new warning
```

| Option | Purpose |
|---|---|
| `--fail-on-new critical\|warning\|info\|none` | Exit code 1 when a finding at or above this severity is new (default `critical`) |
| `--format text\|json\|markdown` | `markdown` is meant for a pull request comment or job summary; `json` is versioned (`reportVersion`, `kind: "comparison"`) |
| `--output file` | Write the comparison to a file |
| `--config`, `--no-config`, `--disable`, `--severity`, `--packs` | Same rule policy as `scan`, applied to both versions |

Comparison output never contains secret values or URL query strings. Exit codes: `0` passed, `1` new findings, `2` usage or input error (a missing file, not exactly two collections).

On a pull request, compare the base branch with the head:

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compare with the base branch
        run: |
          git show "origin/${{ github.base_ref }}:collections/api.postman_collection.json" > base.postman_collection.json
          node dist-node/cli.js diff base.postman_collection.json collections/api.postman_collection.json \
            --fail-on-new critical --format markdown --output postscope-diff.md
          cat postscope-diff.md >> "$GITHUB_STEP_SUMMARY"
```

---

## 8. Adopting PostScope on an existing project

1. Run once locally: `postscope scan collections --fail-on none` and read the report.
2. Fix what is cheap (secrets first), or accept the rest: `postscope scan collections --write-baseline postscope-baseline.json` records today's findings as a baseline. Commit it.
3. Use `--baseline postscope-baseline.json` in CI. The pipeline now fails only on new findings.
4. Put team rules in `.postscope.json`: disabled rules, severity overrides, score weights, rule packs, and suppressions with a reason and an optional expiry. Review changes to that file like any other security policy change.
5. Refresh the baseline when findings are fixed so they cannot come back unnoticed.
