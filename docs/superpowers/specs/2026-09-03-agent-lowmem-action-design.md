# Agent Lowmem Action Design

**Status:** Proposed for implementation  
**Date:** 2026-09-03  
**Repository:** `Pleo2/agent-lowmem-action`

## 1. Purpose

Agent Lowmem Action is a read-only GitHub Action that inspects a repository and writes a concise low-memory readiness report to the GitHub Actions job summary. Its first release supports repositories using Node.js, Bun, TypeScript, or Rust.

The Action is a genuine GitHub API integration for the Agent Lowmem project. It provides a useful foundation for applying to the GitHub Developer Program without adding API calls, JavaScript, or network dependencies to the native Agent Lowmem CLI or its static landing page.

## 2. Product boundary

Version 0.1 answers one question:

> Which supported toolchains are present, and what conservative Agent Lowmem commands should an agent use in this repository?

It does not execute builds or tests, modify repository files, comment on pull requests, install Agent Lowmem, collect telemetry, or claim that a repository is safe merely because a toolchain was detected.

## 3. User experience

A repository owner adds a workflow step:

```yaml
permissions:
  contents: read

steps:
  - uses: Pleo2/agent-lowmem-action@v0
    with:
      github-token: ${{ github.token }}
```

The Action authenticates with the workflow-provided `GITHUB_TOKEN`, reads repository metadata and a bounded set of root manifest filenames through the GitHub REST API, and writes a Markdown report to `GITHUB_STEP_SUMMARY`.

The report contains:

1. the inspected `owner/repository` and immutable commit SHA;
2. detected ecosystems and the evidence filename for each detection;
3. conservative suggested commands for Agent Lowmem;
4. explicit warnings when evidence is absent, ambiguous, truncated, or inaccessible;
5. a statement that no repository content was changed.

The Action succeeds when inspection completes, including the valid results `no-supported-toolchain` and `incomplete`. `incomplete` is emitted only when GitHub returns the root-listing limit and complete detection cannot be proven; the report names that limitation and contains no unsupported negative claims. Authentication failures, malformed API responses, rate limiting, or inability to inspect the target repository fail the step with a concise error and no partial success claim.

## 4. Detection contract

Detection is evidence-based and limited to these root paths:

| Ecosystem | Evidence |
| --- | --- |
| Node.js | `package.json` |
| Bun | `bun.lock`, `bun.lockb`, or `bunfig.toml` |
| TypeScript | `tsconfig.json` or `tsconfig.*.json` returned by the bounded root listing |
| Rust | `Cargo.toml` |

Package-manager evidence is closed to `packageManager` plus `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `bun.lock`, and `bun.lockb`. A matching `packageManager` and lockfile select npm, pnpm, or Bun. One unopposed lockfile selects its manager. Multiple manager families, contradictory evidence, or another declared manager produce an explicit `ambiguous-or-unsupported-manager` warning and no manager-specific recommendation.

The Action performs at most:

- one repository metadata request;
- one root contents listing request;
- one `package.json` contents request when that file exists.

The `package.json` request is used only to detect scripts, `packageManager`, and whether TypeScript is declared in `dependencies` or `devDependencies`. Root lockfiles are used as package-manager evidence. Conflicting lockfiles or a mismatch with `packageManager` are reported as ambiguous. Version 0.1 does not recursively traverse directories, inspect transitive dependencies, fetch workflow logs, or download the repository.

## 5. Recommendations

Recommendations are deterministic text derived from observed evidence:

- Node/npm: `agent-lowmem run npm test` when a `test` script exists;
- Bun: `agent-lowmem run bun test` when Bun evidence exists;
- TypeScript: emit a command only when the local `typescript` package is declared and package-manager evidence is unambiguous: `npm exec -- tsc --noEmit`, `pnpm exec tsc --noEmit`, or `bunx tsc --noEmit`;
- Rust: `agent-lowmem run cargo test`;
- mixed repositories: display each recommendation separately and warn that version 0.1 does not infer orchestration order.

The Action must not invent a script name or recommend downloading an undeclared compiler. If `package.json` has no `test` script, it reports that fact and omits the npm test command. If manager evidence conflicts, it reports the evidence and omits manager-specific commands.

## 6. Architecture

The Action is a dependency-free JavaScript action targeting GitHub Actions `node24`.

```text
action.yml
    -> src/main.js
        -> environment validation
        -> GitHub REST client using built-in fetch
        -> bounded evidence classifier
        -> deterministic report renderer
        -> GITHUB_STEP_SUMMARY writer
```

No package installation or bundling step is required at runtime. Production code uses only Node.js built-ins and the GitHub REST API. Tests use the built-in `node:test` runner and mocked `fetch` responses.

The committed entrypoint is ordinary readable JavaScript rather than generated output. This keeps the repository small and makes review of the shipped code direct.

## 7. Authentication and permissions

The workflow passes `github.token` explicitly through the Action input `github-token`. The README requires callers to declare:

```yaml
permissions:
  contents: read
```

No write permission is requested. The token is used only against `https://api.github.com`. It is never printed, persisted, returned as output, included in errors, or sent to another host.

The initial Action does not require a separately registered GitHub App, OAuth app, server, webhook, database, Vercel function, or paid service.

## 8. Inputs and outputs

### Inputs

- `github-token` — required; normally `${{ github.token }}`.
- `repository` — optional; defaults to `${{ github.repository }}` and must match `owner/name`.
- `ref` — optional; defaults to `${{ github.sha }}` and is used for content reads.

Cross-repository inspection is allowed only when the supplied token already has read access. The Action never broadens token permissions.

### Outputs

- `result` — one of `recommendations`, `no-supported-toolchain`, or `incomplete`.
- `ecosystems` — comma-separated stable identifiers in alphabetical order.

The public vocabulary is closed and tested.

## 9. API behavior

Every request sends:

- `Accept: application/vnd.github+json`;
- `Authorization: Bearer <token>`;
- `X-GitHub-Api-Version: 2026-03-10`;
- a stable `User-Agent` identifying Agent Lowmem Action.

Responses are size-bounded before parsing. Redirects to non-GitHub hosts are rejected. Only HTTPS GitHub API URLs constructed internally from validated owner, repository, path, and ref values are requested.

HTTP status handling is explicit:

- `200`: validate and consume the expected response shape;
- `401` or `403`: authentication, permission, or rate-limit failure;
- `404`: inaccessible repository or evidence that disappeared during inspection;
- other status: fail with the status code and GitHub request ID when available.

Errors never include response headers or bodies that may contain sensitive data.

## 10. Determinism and agentic use

Given the same API evidence, version, and inputs, the Action produces byte-stable report sections and ordered outputs. Timestamps, network timing, random IDs, and locale-dependent formatting are excluded.

The report distinguishes observations from recommendations. Every recommendation names its evidence, and uncertainty remains visible. This makes the output suitable for both human review and downstream coding agents without allowing the agent to mistake a heuristic for repository truth.

## 11. Security and privacy

- read-only token permissions;
- no execution of repository code;
- no checkout required;
- no dependency installation;
- no shell invocation;
- no dynamic evaluation;
- no telemetry or external analytics;
- no retention outside the workflow summary and logs;
- bounded network requests and response sizes;
- token and control-character redaction in error messages.

Repository filenames and detected scripts may appear in the private workflow summary of the repository where the Action runs. The Action documents this behavior.

## 12. Testing

The test suite covers:

1. environment and input validation;
2. repository and ref encoding;
3. Node, Bun, TypeScript, Rust, mixed, and empty fixtures;
4. missing npm `test` script;
5. deterministic ordering and rendering;
6. request count limits;
7. `401`, `403`, `404`, rate-limit, malformed JSON, oversized response, and network failure;
8. token and control-character redaction;
9. output-file and summary-file behavior;
10. an end-to-end workflow in this repository using read-only permissions.

Tests must make no live network requests. The end-to-end workflow is the sole live GitHub integration check and inspects its own public repository.

## 13. Repository structure

```text
action.yml
package.json
src/
  main.js
  github.js
  classify.js
  report.js
tests/
  *.test.js
  fixtures/
.github/workflows/
  verify.yml
README.md
LICENSE
SECURITY.md
SUPPORT.md
```

The project uses Conventional Commits and works on `main` until its first release, matching the current Agent Lowmem workflow.

The source is published under the MIT License to keep reuse and Marketplace adoption straightforward.

## 14. Release and Developer Program readiness

Version 0.1 is ready when:

- all tests pass on GitHub Actions;
- the self-inspection workflow calls the GitHub REST API successfully;
- the report is visible in the workflow summary;
- the public README documents purpose, permissions, usage, limitations, and support;
- `SUPPORT.md` provides a public support route;
- tag `v0.1.0` and moving major tag `v0` reference the verified commit.

After those conditions are met, the Developer Program application uses:

- integration: Agent Lowmem Action;
- homepage: `https://agentlowmem.dev`;
- source/support: `https://github.com/Pleo2/agent-lowmem-action`;
- status: integration in production;
- support email: supplied by the owner immediately before form submission.

The application must describe the actual read-only behavior and must not claim marketplace publication, GitHub endorsement, or capabilities not present in version 0.1.

## 15. Non-goals for version 0.1

- installing or executing Agent Lowmem;
- generating or committing `AGENTS.md`;
- modifying workflows or opening pull requests;
- posting issues, reviews, checks, or comments;
- authenticated GitHub App installation flows;
- GitHub Marketplace publication;
- monorepo recursion;
- workflow log analysis;
- cost, duration, or memory estimates;
- support for ecosystems beyond Node.js, Bun, TypeScript, and Rust.

## 16. References

- [GitHub Developer Program](https://docs.github.com/en/integrations/concepts/github-developer-program)
- [Metadata syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)
- [Using `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [GitHub REST API authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
