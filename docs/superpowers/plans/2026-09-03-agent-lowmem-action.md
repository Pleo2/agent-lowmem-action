# Agent Lowmem Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a dependency-free, read-only GitHub Action that detects Node.js, Bun, TypeScript, and Rust repository evidence through the GitHub REST API and writes deterministic Agent Lowmem recommendations to the workflow summary.

**Architecture:** A Node.js 24 action validates workflow inputs, performs no more than three bounded REST requests, classifies root evidence, derives conservative commands, and writes a stable Markdown report plus closed outputs. Production code uses only Node built-ins; unit tests mock every network interaction and one repository workflow supplies the live integration proof.

**Tech Stack:** GitHub Actions `node24`, JavaScript ES modules, Node built-in `fetch`, `node:test`, GitHub REST API version `2026-03-10`, Markdown.

**Spec:** `docs/superpowers/specs/2026-09-03-agent-lowmem-action-design.md`

## Global Constraints

- Production dependencies: exactly zero.
- Network destination: only `https://api.github.com` URLs constructed internally.
- Permissions: `contents: read`; every unspecified workflow permission is `none`.
- Request budget: one repository request, one root listing, and at most one `package.json` request.
- Response limit: 262,144 bytes per response before JSON parsing.
- No checkout, shell execution, repository-code execution, telemetry, comments, checks, issues, pull requests, or repository mutations.
- Inputs: `github-token` required; `repository` and `ref` default from GitHub context.
- Outputs: closed `result` vocabulary (`recommendations`, `no-supported-toolchain`, `incomplete`) and alphabetically ordered `ecosystems`.
- Supported package-manager recommendations: npm, pnpm, and Bun only; ambiguity suppresses manager-specific commands.
- Development occurs on `main` with Conventional Commits until the first release.
- License: MIT.

---

## File responsibility map

- `package.json` — ESM package metadata and dependency-free validation commands.
- `action.yml` — public Action inputs, outputs, runtime, entrypoint, and branding.
- `src/env.js` — parse and validate environment-backed Action inputs.
- `src/github.js` — bounded, redacted GitHub REST reads.
- `src/classify.js` — convert API evidence into a closed classification object.
- `src/recommend.js` — derive conservative commands from classification.
- `src/report.js` — render byte-stable Markdown and workflow output records.
- `src/run.js` — enforce request sequence and connect all pure units.
- `src/main.js` — minimal production entrypoint and failure annotation.
- `tests/*.test.js` — unit and orchestration coverage using Node built-ins.
- `.github/workflows/verify.yml` — dependency-free unit checks and live self-inspection.
- `README.md`, `SECURITY.md`, `SUPPORT.md`, `LICENSE` — public adoption and support contract.

---

### Task 1: Project contract and validated inputs

**Files:**
- Create: `package.json`
- Create: `src/env.js`
- Create: `tests/env.test.js`

**Interfaces:**
- Produces: `parseRepository(value: string): { owner: string, repo: string }`
- Produces: `loadInputs(env: NodeJS.ProcessEnv): { token: string, owner: string, repo: string, ref: string, summaryPath: string, outputPath: string }`
- Consumes: GitHub Action environment variables only; it performs no I/O.

- [ ] **Step 1: Add dependency-free package metadata**

Create `package.json` with:

```json
{
  "name": "agent-lowmem-action",
  "version": "0.0.0-development",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test tests/*.test.js",
    "check": "node --check src/*.js"
  }
}
```

- [ ] **Step 2: Write failing input tests**

Create `tests/env.test.js` with table tests proving:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadInputs, parseRepository } from "../src/env.js";

test("parseRepository accepts one owner/name pair", () => {
  assert.deepEqual(parseRepository("Pleo2/agent-lowmem"), {
    owner: "Pleo2",
    repo: "agent-lowmem",
  });
});

for (const value of ["", "owner", "owner/repo/extra", "owner name/repo", ".hidden/repo"]) {
  test(`parseRepository rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseRepository(value), /repository must match owner\/name/);
  });
}

test("loadInputs reads the explicit action contract", () => {
  assert.deepEqual(loadInputs({
    INPUT_GITHUB_TOKEN: "token-value",
    INPUT_REPOSITORY: "Pleo2/agent-lowmem",
    INPUT_REF: "0123456789abcdef",
    GITHUB_STEP_SUMMARY: "/tmp/summary",
    GITHUB_OUTPUT: "/tmp/output",
  }), {
    token: "token-value",
    owner: "Pleo2",
    repo: "agent-lowmem",
    ref: "0123456789abcdef",
    summaryPath: "/tmp/summary",
    outputPath: "/tmp/output",
  });
});

test("loadInputs rejects missing token, ref, or workflow files", () => {
  assert.throws(() => loadInputs({ INPUT_REPOSITORY: "Pleo2/repo" }), /github-token is required/);
});
```

- [ ] **Step 3: Run the focused test and confirm the red state**

Run: `node --test --test-name-pattern='parseRepository|loadInputs' tests/env.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/env.js`.

- [ ] **Step 4: Implement strict input parsing**

Create `src/env.js`. Use `^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$`, reject control characters, trim no values silently, and emit these stable errors:

```js
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/;

export function parseRepository(value) {
  if (typeof value !== "string" || !REPOSITORY.test(value)) {
    throw new Error("repository must match owner/name");
  }
  const [owner, repo] = value.split("/");
  return { owner, repo };
}

function required(env, key, label) {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (/\p{Cc}/u.test(value)) throw new Error(`${label} contains control characters`);
  return value;
}

export function loadInputs(env) {
  const token = required(env, "INPUT_GITHUB_TOKEN", "github-token");
  const { owner, repo } = parseRepository(required(env, "INPUT_REPOSITORY", "repository"));
  return {
    token,
    owner,
    repo,
    ref: required(env, "INPUT_REF", "ref"),
    summaryPath: required(env, "GITHUB_STEP_SUMMARY", "GITHUB_STEP_SUMMARY"),
    outputPath: required(env, "GITHUB_OUTPUT", "GITHUB_OUTPUT"),
  };
}
```

- [ ] **Step 5: Verify Task 1**

Run: `npm test`

Expected: all input tests PASS and zero network access.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json src/env.js tests/env.test.js
git commit -m "feat: validate action inputs"
```

---

### Task 2: Bounded GitHub REST client

**Files:**
- Create: `src/github.js`
- Create: `tests/github.test.js`

**Interfaces:**
- Produces: `createGitHubClient({ token, fetchImpl, maxResponseBytes }): GitHubClient`
- Produces methods: `getRepository(owner, repo)`, `listRoot(owner, repo, ref)`, `getTextFile(owner, repo, path, ref)`.
- Produces: `GitHubApiError` with stable `code`, `status`, and optional `requestId`; no response body or token.

- [ ] **Step 1: Write failing success-path and header tests**

Use a fake `fetchImpl` that records URLs and returns a `Response`. Assert:

```js
const calls = [];
const client = createGitHubClient({
  token: "secret-token",
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 1, default_branch: "main" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-github-request-id": "REQ1" },
    });
  },
});

assert.deepEqual(await client.getRepository("Pleo2", "repo"), {
  id: 1,
  default_branch: "main",
});
assert.equal(calls[0].url, "https://api.github.com/repos/Pleo2/repo");
assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
assert.equal(calls[0].options.redirect, "error");
```

Add tests for encoded `ref`, base64 text decoding, a non-file content response, and the exact API version header `2026-03-10`.

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `node --test --test-name-pattern='GitHub client' tests/github.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/github.js`.

- [ ] **Step 3: Implement the minimal client**

Implement one private `requestJson(path)` closure using internally constructed `new URL(path, "https://api.github.com")`. Read the response through `arrayBuffer()`, reject byte lengths above `262144`, decode with fatal UTF-8, then parse JSON. Use:

```js
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "agent-lowmem-action/0.1",
};
```

Validate expected shapes in each public method. `getTextFile` accepts only `{ type: "file", encoding: "base64", content: string }`, strips MIME line breaks from `content`, decodes to UTF-8, and rejects decoded content above 262,144 bytes.

- [ ] **Step 4: Add failing error and redaction tests**

Cover status `401`, `403`, `404`, `429`, `500`, oversized bodies, malformed JSON, invalid UTF-8, rejected redirects, and thrown network errors. For every caught error assert:

```js
assert.doesNotMatch(String(error), /secret-token/);
assert.doesNotMatch(String(error), /response-body-secret/);
assert.match(String(error), /github-api-(auth|permission|rate-limit|not-found|response|network)/);
```

- [ ] **Step 5: Implement closed errors**

Map statuses to stable codes:

```text
401 -> github-api-auth
403 -> github-api-permission, or github-api-rate-limit when x-ratelimit-remaining is 0
404 -> github-api-not-found
429 -> github-api-rate-limit
other non-200 -> github-api-response
fetch rejection -> github-api-network
```

Include only status and a sanitized `x-github-request-id` matching `^[A-Za-z0-9:-]{1,128}$`.

- [ ] **Step 6: Verify Task 2**

Run: `node --test --test-name-pattern='GitHub client|GitHub API error' tests/github.test.js`

Expected: all client tests PASS with no live requests.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/github.js tests/github.test.js
git commit -m "feat: add bounded github api client"
```

---

### Task 3: Deterministic evidence classification

**Files:**
- Create: `src/classify.js`
- Create: `tests/classify.test.js`

**Interfaces:**
- Consumes: root entries shaped as `{ name: string, type: string }[]` and optional `package.json` text.
- Produces: `classifyEvidence({ entries, packageJsonText }): Classification`.
- `Classification` keys: `ecosystems`, `evidence`, `packageManager`, `hasNpmTest`, `hasTypescriptDependency`, `incomplete`, `warnings`.

- [ ] **Step 1: Write failing ecosystem tests**

Create fixtures inline and assert exact stable results for:

```js
assert.deepEqual(classifyEvidence({
  entries: [
    { name: "Cargo.toml", type: "file" },
    { name: "package.json", type: "file" },
    { name: "tsconfig.json", type: "file" },
    { name: "bun.lock", type: "file" },
  ],
  packageJsonText: JSON.stringify({
    packageManager: "bun@1.2.3",
    scripts: { test: "node --test" },
    devDependencies: { typescript: "^5.9.0" },
  }),
}), {
  ecosystems: ["bun", "node", "rust", "typescript"],
  evidence: {
    bun: ["bun.lock", "package.json#packageManager"],
    node: ["package.json"],
    rust: ["Cargo.toml"],
    typescript: ["package.json#devDependencies.typescript", "tsconfig.json"],
  },
  packageManager: { status: "selected", value: "bun" },
  hasNpmTest: true,
  hasTypescriptDependency: true,
  incomplete: false,
  warnings: [],
});
```

Also cover empty roots, directories with manifest-like names, `tsconfig.build.json`, invalid `package.json`, and exactly 1,000 root entries setting `incomplete: true`. Invalid repository `package.json` preserves filename-based detection, skips manifest-derived evidence, and emits the closed warning `package-json-invalid`; it does not set `incomplete`, which remains reserved for a root listing at GitHub's 1,000-entry limit.

- [ ] **Step 2: Run classifier tests and confirm the red state**

Run: `node --test --test-name-pattern='classifyEvidence' tests/classify.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/classify.js`.

- [ ] **Step 3: Implement ecosystem classification**

Use sets internally, accept only `type === "file"`, recognize `tsconfig.json` and `/^tsconfig\..+\.json$/`, and sort every public array with ASCII lexical ordering. Parse `package.json` once and validate relevant members as objects or strings before reading them.

- [ ] **Step 4: Add failing package-manager conflict tests**

Test the closed manager rules:

```text
package-lock.json only -> selected npm
npm-shrinkwrap.json only -> selected npm
pnpm-lock.yaml only -> selected pnpm
bun.lock or bun.lockb only -> selected bun
matching packageManager + lock -> selected manager
packageManager yarn -> unsupported
packageManager npm + bun.lock -> ambiguous
pnpm-lock.yaml + bun.lock -> ambiguous
no manager evidence -> unknown
```

Each unsupported or ambiguous case must contain exactly the warning code `ambiguous-or-unsupported-manager` once.

- [ ] **Step 5: Implement manager selection and warnings**

Normalize `packageManager` only when it matches `^(npm|pnpm|bun)@[^\s]+$`. Treat any other non-empty declaration as unsupported. Never choose a manager by precedence when evidence conflicts.

- [ ] **Step 6: Verify Task 3**

Run: `node --test --test-name-pattern='classifyEvidence|package manager' tests/classify.test.js`

Expected: all classification tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/classify.js tests/classify.test.js
git commit -m "feat: classify repository toolchains"
```

---

### Task 4: Conservative recommendations and stable report

**Files:**
- Create: `src/recommend.js`
- Create: `src/report.js`
- Create: `tests/recommend.test.js`
- Create: `tests/report.test.js`

**Interfaces:**
- Produces: `buildRecommendations(classification): Recommendation[]`.
- `Recommendation` keys: `ecosystem`, `command`, `evidence`.
- Produces: `renderReport({ repository, sha, classification, recommendations }): string`.
- Produces: `renderOutputs({ result, ecosystems }): string`.

- [ ] **Step 1: Write failing recommendation tests**

Assert exact commands:

```text
Rust evidence -> agent-lowmem run cargo test
Bun evidence -> agent-lowmem run bun test
npm + test script -> agent-lowmem run npm test
TypeScript dependency + npm -> agent-lowmem run npm exec -- tsc --noEmit
TypeScript dependency + pnpm -> agent-lowmem run pnpm exec tsc --noEmit
TypeScript dependency + Bun -> agent-lowmem run bunx tsc --noEmit
Node without test script -> no npm test command
TypeScript without local dependency -> no compiler command
ambiguous manager -> no manager-specific command
```

For mixed repositories, assert ordering by `ecosystem`, then `command`, and exact evidence filenames.

- [ ] **Step 2: Run recommendation tests and confirm the red state**

Run: `node --test --test-name-pattern='buildRecommendations' tests/recommend.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/recommend.js`.

- [ ] **Step 3: Implement recommendations as a pure function**

Return frozen plain objects, never mutate classification, and derive commands only from the closed rules above. Deduplicate identical commands and sort deterministically.

- [ ] **Step 4: Write failing report tests**

Use a fixed `repository` and 40-character SHA. Assert a complete report snapshot containing these sections in order:

```markdown
# Agent Lowmem readiness

**Repository:** `Pleo2/example`  
**Commit:** `0123456789012345678901234567890123456789`

## Observed evidence

## Recommended commands

## Warnings

---
Read-only inspection: Agent Lowmem Action did not modify repository content.
```

Add hostile filenames/warnings containing backticks, newlines, ANSI escapes, and HTML. Verify `renderReport` escapes Markdown delimiters, replaces controls, and never emits raw HTML.

- [ ] **Step 5: Implement stable rendering and outputs**

Render `None.` for empty sections. Use only `\n` newlines and end with exactly one newline. `renderOutputs` emits:

```text
result=<closed-result>
ecosystems=<comma-separated-sorted-identifiers>
```

Reject result values outside the closed vocabulary.

- [ ] **Step 6: Verify Task 4**

Run: `node --test --test-name-pattern='buildRecommendations|renderReport|renderOutputs' tests/recommend.test.js tests/report.test.js`

Expected: all recommendation and rendering tests PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/recommend.js src/report.js tests/recommend.test.js tests/report.test.js
git commit -m "feat: render low-memory recommendations"
```

---

### Task 5: Orchestration, Action entrypoint, and request-budget enforcement

**Files:**
- Create: `src/run.js`
- Create: `src/main.js`
- Create: `action.yml`
- Create: `tests/run.test.js`
- Modify: `src/report.js`
- Modify: `tests/report.test.js`

**Interfaces:**
- Consumes interfaces from Tasks 1–4.
- Produces: `runAction({ env, fetchImpl, appendFile }): Promise<{ result: string, ecosystems: string[] }>`.
- `src/main.js` invokes `runAction` once and emits GitHub workflow error annotation on failure.

- [ ] **Step 1: Write failing orchestration tests**

Provide a queue-backed fake `fetch` and temporary `GITHUB_STEP_SUMMARY`/`GITHUB_OUTPUT` paths. Prove:

1. two requests occur when root has no `package.json`;
2. exactly three requests occur when `package.json` exists;
3. the content request uses the caller SHA as `ref`;
4. summary and outputs are appended exactly once;
5. `no-supported-toolchain` is successful;
6. 1,000 root entries produce `incomplete`;
7. a failed third request writes neither success outputs nor a success footer.

- [ ] **Step 2: Run orchestration tests and confirm the red state**

Run: `node --test --test-name-pattern='runAction' tests/run.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/run.js`.

- [ ] **Step 3: Implement the fixed request sequence**

Implement this order without retries:

```text
loadInputs
getRepository
listRoot at ref
getTextFile(package.json) only when root evidence contains that file
classifyEvidence
buildRecommendations
derive result
render and append summary
render and append outputs
return result
```

Derive result as `incomplete` first, otherwise `recommendations` when at least one command exists, otherwise `no-supported-toolchain`.

- [ ] **Step 4: Add bounded workflow-file append behavior**

The injected `appendFile` defaults to `node:fs/promises.appendFile`. Write the summary first and outputs second. If either fails, throw `workflow-file-write-failed` with the logical target name only; do not include absolute runner paths.

- [ ] **Step 5: Create the production entrypoint**

`src/main.js` imports `runAction`, calls it with `process.env` and `globalThis.fetch`, and handles failure with:

```js
process.stderr.write(`::error title=Agent Lowmem Action::${escapeAnnotation(message)}\n`);
process.exitCode = 1;
```

Export `escapeAnnotation` from `src/report.js` and cover it in `tests/report.test.js` before importing it here. It percent-encodes `%`, carriage return, newline, `:`, and `,`; the error message has control characters removed and is capped at 512 code points.

- [ ] **Step 6: Define the public Action metadata**

Create `action.yml` with `runs.using: node24`, `runs.main: src/main.js`, branding icon `activity`, branding color `purple`, the three specified inputs, and the two closed outputs. Use expression defaults `${{ github.repository }}` and `${{ github.sha }}` only for `repository` and `ref`; require an explicit `github-token` input.

- [ ] **Step 7: Verify Task 5**

Run: `npm run check && npm test`

Expected: syntax check PASS and all tests PASS with no live network requests.

- [ ] **Step 8: Commit Task 5**

```bash
git add action.yml src/run.js src/main.js src/report.js tests/run.test.js tests/report.test.js
git commit -m "feat: assemble read-only github action"
```

---

### Task 6: Public documentation, live proof, and first release

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `SUPPORT.md`
- Create: `.github/workflows/verify.yml`
- Create: `tests/public-contract.test.js`

**Interfaces:**
- Consumes: the published Action contract from Tasks 1–5.
- Produces: public usage instructions, support route, CI proof, immutable `v0.1.0`, and moving `v0` tag.

- [ ] **Step 1: Write failing public-contract tests**

Test files as text and assert:

- README usage declares `permissions: contents: read` and passes `${{ github.token }}`;
- README states no checkout, execution, mutation, telemetry, or guarantee of safety;
- `SUPPORT.md` links to `https://github.com/Pleo2/agent-lowmem-action/issues`;
- `SECURITY.md` asks reporters not to disclose tokens publicly and links GitHub private vulnerability reporting;
- `LICENSE` contains the MIT grant and copyright `2026 Jose Moreno`;
- workflow top-level permissions are exactly `contents: read`;
- workflow has no `pull-requests: write`, `issues: write`, `checks: write`, or `actions: write`.

- [ ] **Step 2: Run public-contract tests and confirm the red state**

Run: `node --test --test-name-pattern='public contract' tests/public-contract.test.js`

Expected: FAIL because the public files do not exist.

- [ ] **Step 3: Write the public documentation**

README sections, in order:

```text
Agent Lowmem Action
Status: early release
What it does
What it never does
Supported evidence
Usage
Example report
Inputs
Outputs
Permissions and privacy
Limitations
Development
Support and security
License
```

Use `https://agentlowmem.dev` as homepage and never claim GitHub endorsement, Marketplace availability, measured memory savings, or platform support beyond the evidence classifier.

- [ ] **Step 4: Add the dependency-free verification workflow**

Create `.github/workflows/verify.yml` with:

```yaml
name: verify
on:
  push:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: 24
      - run: npm run check
      - run: npm test
  self-inspection:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: Pleo2/agent-lowmem-action@main
        with:
          github-token: ${{ github.token }}
```

The SHAs above resolve from the reviewed `v6` tags on 2026-09-03. Retain the full pins and version comments. The self-inspection job deliberately consumes the remote Action and has no checkout step; `uses: ./` would require repository checkout and violate the consumer contract being tested.

- [ ] **Step 5: Verify documentation locally**

Run: `npm run check && npm test && git diff --check`

Expected: all checks PASS, no whitespace errors, and no network requests from tests.

- [ ] **Step 6: Commit public readiness**

```bash
git add README.md LICENSE SECURITY.md SUPPORT.md .github/workflows/verify.yml tests/public-contract.test.js
git commit -m "docs: publish action usage and support"
git push origin main
```

- [ ] **Step 7: Verify the live workflow**

Run:

```bash
verify_run_id=$(gh run list --repo Pleo2/agent-lowmem-action --workflow verify --limit 1 --json databaseId --jq '.[0].databaseId')
test -n "$verify_run_id"
gh run watch "$verify_run_id" --repo Pleo2/agent-lowmem-action --exit-status
```

Expected: `test` and `self-inspection` both complete with `success`; the latter contains an Agent Lowmem readiness job summary produced by the API integration.

- [ ] **Step 8: Create and verify release tags**

Only after the live workflow succeeds:

```bash
git tag -a v0.1.0 -m "release: v0.1.0"
git tag -a v0 -m "release: v0.1.0"
git push origin v0.1.0 v0
git ls-remote --tags origin v0 v0.1.0
```

Expected: both remote tags resolve to annotated tag objects whose peeled commits equal the verified `main` commit.

- [ ] **Step 9: Prepare the Developer Program application**

Open `https://github.com/developer/register` while signed in as `Pleo2` and use:

```text
Integration name: Agent Lowmem Action
Integration URL: https://github.com/Pleo2/agent-lowmem-action
Homepage: https://agentlowmem.dev
Description: Read-only GitHub Action that uses the GitHub REST API to detect Node.js, Bun, TypeScript, and Rust repository evidence and produce conservative Agent Lowmem commands in the workflow summary.
Status: In production
Support URL: https://github.com/Pleo2/agent-lowmem-action/issues
```

Stop before final submission if GitHub requests a support email, legal acceptance, or any material field not listed above. Obtain the repository owner value directly and submit only after explicit confirmation.

---

## Final acceptance checklist

- [ ] `npm run check` succeeds.
- [ ] `npm test` reports zero failures.
- [ ] Unit tests make zero live network requests.
- [ ] Production dependency count is zero.
- [ ] The Action makes two or three REST requests and never exceeds three.
- [ ] Workflow permissions are read-only.
- [ ] Live self-inspection succeeds and produces a job summary.
- [ ] `main`, `v0.1.0`, and `v0` resolve to the verified release commit.
- [ ] Public documentation accurately describes behavior and limitations.
- [ ] No changes exist in `agent-lowmem` or `agentlowmem.dev` from this work.
- [ ] Developer Program submission waits for the owner-provided support email and explicit confirmation.
