import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public contract documents read-only usage and explicit privacy boundaries", async () => {
  const readme = await read("README.md");
  assert.match(readme, /permissions:\s*\n\s*contents: read/);
  assert.match(readme, /github-token: \$\{\{ github\.token \}\}/);
  for (const statement of [
    /does not require.*checkout/i,
    /does not execute repository code/i,
    /does not modify repository content/i,
    /does not collect telemetry/i,
    /does not guarantee.*safe/i,
  ]) {
    assert.match(readme, statement);
  }
});

test("public contract publishes support, private security reporting, and MIT terms", async () => {
  const [support, security, license] = await Promise.all([
    read("SUPPORT.md"),
    read("SECURITY.md"),
    read("LICENSE"),
  ]);
  assert.match(support, /https:\/\/github\.com\/Pleo2\/agent-lowmem-action\/issues/);
  assert.match(security, /do not.*token.*public/i);
  assert.match(security, /https:\/\/github\.com\/Pleo2\/agent-lowmem-action\/security\/advisories\/new/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /Copyright \(c\) 2026 Jose Moreno/);
});

test("public contract workflow remains read-only and self-inspects without checkout", async () => {
  const workflow = await read(".github/workflows/verify.yml");
  const topLevelPermissions = workflow.match(/^permissions:\n((?: {2}.+\n)+)/m);
  assert.ok(topLevelPermissions);
  assert.equal(topLevelPermissions[1], "  contents: read\n");
  assert.doesNotMatch(workflow, /(?:pull-requests|issues|checks|actions): write/);
  assert.match(workflow, /uses: Pleo2\/agent-lowmem-action@main/);

  const selfInspection = workflow.slice(workflow.indexOf("  self-inspection:"));
  assert.doesNotMatch(selfInspection, /actions\/checkout|uses: \.\//);
});

test("public contract action metadata quotes descriptions containing YAML separators", async () => {
  const manifest = await read("action.yml");
  assert.doesNotMatch(manifest, /^\s+description:\s+[^"'|>\n]*:\s.+$/m);
});
