import test from "node:test";
import assert from "node:assert/strict";
import { renderOutputs, renderReport } from "../src/report.js";

test("renderReport produces a stable complete summary", () => {
  assert.equal(renderReport({
    repository: "Pleo2/example",
    sha: "0123456789012345678901234567890123456789",
    classification: {
      ecosystems: ["node", "rust"],
      evidence: { node: ["package.json"], rust: ["Cargo.toml"] },
      warnings: [],
      incomplete: false,
    },
    recommendations: [
      { ecosystem: "node", command: "agent-lowmem run npm test", evidence: ["package.json"] },
      { ecosystem: "rust", command: "agent-lowmem run cargo test", evidence: ["Cargo.toml"] },
    ],
  }), [
    "# Agent Lowmem readiness",
    "",
    "**Repository:** `Pleo2/example`  ",
    "**Commit:** `0123456789012345678901234567890123456789`",
    "",
    "## Observed evidence",
    "",
    "- **node:** `package.json`",
    "- **rust:** `Cargo.toml`",
    "",
    "## Recommended commands",
    "",
    "- **node:** `agent-lowmem run npm test`",
    "- **rust:** `agent-lowmem run cargo test`",
    "",
    "## Warnings",
    "",
    "- Mixed repository: version 0.1 does not infer orchestration order.",
    "",
    "---",
    "Read-only inspection: Agent Lowmem Action did not modify repository content.",
    "",
  ].join("\n"));
});

test("renderReport renders empty sections explicitly", () => {
  const report = renderReport({
    repository: "Pleo2/empty",
    sha: "abc",
    classification: { ecosystems: [], evidence: {}, warnings: [], incomplete: false },
    recommendations: [],
  });
  assert.equal((report.match(/None\./g) ?? []).length, 3);
  assert.equal(report.endsWith("\n"), true);
  assert.equal(report.endsWith("\n\n"), false);
  assert.doesNotMatch(report, /\r/);
});

test("renderReport neutralizes hostile repository evidence and warnings", () => {
  const report = renderReport({
    repository: "owner/<script>alert(1)</script>",
    sha: "sha`\n\u001b[31m",
    classification: {
      ecosystems: ["node"],
      evidence: { node: ["evil`\n<img src=x onerror=alert(1)>.json"] },
      warnings: ["warning\n<script>alert(1)</script> *boom*"],
      incomplete: false,
    },
    recommendations: [],
  });
  assert.doesNotMatch(report, /<script|<img|\u001b|\r/);
  assert.match(report, /&lt;script&gt;/);
  assert.match(report, /warning .*\\\*boom\\\*/);
});

test("renderOutputs emits only closed, sorted public values", () => {
  assert.equal(renderOutputs({
    result: "recommendations",
    ecosystems: ["typescript", "node", "node"],
  }), "result=recommendations\necosystems=node,typescript\n");
  assert.throws(
    () => renderOutputs({ result: "success", ecosystems: [] }),
    /result must be a closed value/,
  );
  assert.throws(
    () => renderOutputs({ result: "recommendations", ecosystems: ["node\nmalicious=true"] }),
    /ecosystem must be a closed value/,
  );
});
