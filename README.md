# Agent Lowmem Action

Read-only repository readiness checks for [Agent Lowmem](https://agentlowmem.dev).

**Status:** early release

## What it does

Agent Lowmem Action uses the GitHub REST API to inspect a bounded set of root files at an exact ref. It detects evidence for Node.js, Bun, TypeScript, and Rust, then writes conservative low-memory commands to the GitHub Actions job summary.

Each run makes two API requests, or three when a root `package.json` exists. It uses no runtime dependencies.

## What it never does

- It does not require a repository checkout.
- It does not execute repository code, scripts, builds, or tests.
- It does not modify repository content, issues, pull requests, checks, or settings.
- It does not collect telemetry or send data outside the GitHub REST API.
- It does not guarantee that detected commands are safe or that they will succeed; review recommendations before running them.

## Supported evidence

| Ecosystem | Root evidence |
| --- | --- |
| Node.js | `package.json` |
| Bun | `bun.lock`, `bun.lockb`, or `bunfig.toml` |
| TypeScript | `tsconfig.json`, `tsconfig.*.json`, or a declared local `typescript` dependency |
| Rust | `Cargo.toml` |

Package-manager selection is limited to `packageManager`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `bun.lock`, and `bun.lockb`. Conflicting or unsupported evidence produces a warning instead of a guessed command.

## Usage

```yaml
name: agent-lowmem-readiness
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - uses: Pleo2/agent-lowmem-action@v0
        with:
          github-token: ${{ github.token }}
```

No checkout step is needed.

## Example report

```text
Agent Lowmem readiness

Observed evidence
- node: package.json
- rust: Cargo.toml

Recommended commands
- agent-lowmem run npm test
- agent-lowmem run cargo test
```

The actual report also identifies the inspected repository and ref, records warnings, and states that the inspection made no repository changes.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | None | Token for read-only GitHub API requests. Normally `${{ github.token }}`. |
| `repository` | No | `${{ github.repository }}` | Repository in `owner/name` form. |
| `ref` | No | `${{ github.sha }}` | Exact commit or ref used for content reads. |

## Outputs

| Output | Values |
| --- | --- |
| `result` | `recommendations`, `no-supported-toolchain`, or `incomplete` |
| `ecosystems` | Comma-separated detected ecosystems in alphabetical order |

`no-supported-toolchain` is a successful inspection with no supported command. `incomplete` means GitHub returned its 1,000-entry root-listing limit, so complete detection could not be proven.

## Permissions and privacy

The workflow needs only `contents: read`. The token is sent only to `https://api.github.com`; it is never printed, persisted, returned as output, or included in errors. Repository files are not uploaded to another service.

## Limitations

- Version 0.1 inspects root evidence only and does not recursively traverse a monorepo.
- It does not infer orchestration order for mixed repositories.
- It does not inspect transitive dependencies, workflow logs, or runtime memory use.
- Cross-repository inspection works only when the supplied token already has read access.
- A recommendation is evidence-based guidance, not a security review or performance measurement.

## Development

Node.js 24 or newer is required. There are no production or development package dependencies.

```sh
npm run check
npm test
```

Tests use `node:test` and local fetch doubles; they make no live network requests.

## Support and security

See [SUPPORT.md](SUPPORT.md) for usage questions and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE) © 2026 Jose Moreno.
