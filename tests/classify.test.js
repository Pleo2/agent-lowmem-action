import test from "node:test";
import assert from "node:assert/strict";
import { classifyEvidence } from "../src/classify.js";

test("classifyEvidence returns deterministic ecosystem evidence", () => {
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
});

test("classifyEvidence returns a closed empty result", () => {
  assert.deepEqual(classifyEvidence({ entries: [] }), {
    ecosystems: [],
    evidence: {},
    packageManager: { status: "unknown" },
    hasNpmTest: false,
    hasTypescriptDependency: false,
    incomplete: false,
    warnings: [],
  });
});

test("classifyEvidence ignores directories and detects TypeScript variants", () => {
  const result = classifyEvidence({ entries: [
    { name: "Cargo.toml", type: "dir" },
    { name: "package.json", type: "dir" },
    { name: "tsconfig.build.json", type: "file" },
  ] });
  assert.deepEqual(result.ecosystems, ["typescript"]);
  assert.deepEqual(result.evidence, { typescript: ["tsconfig.build.json"] });
});

test("classifyEvidence treats invalid package.json as bounded repository evidence", () => {
  const result = classifyEvidence({
    entries: [{ name: "package.json", type: "file" }],
    packageJsonText: "{invalid",
  });
  assert.deepEqual(result.ecosystems, ["node"]);
  assert.deepEqual(result.evidence, { node: ["package.json"] });
  assert.equal(result.incomplete, false);
  assert.deepEqual(result.warnings, ["package-json-invalid"]);
});

test("classifyEvidence marks a 1000-entry root listing incomplete", () => {
  const entries = Array.from({ length: 1_000 }, (_, index) => ({
    name: `file-${String(index).padStart(4, "0")}`,
    type: "file",
  }));
  assert.equal(classifyEvidence({ entries }).incomplete, true);
});

for (const scenario of [
  { name: "package-lock selects npm", files: ["package-lock.json"], want: { status: "selected", value: "npm" } },
  { name: "npm shrinkwrap selects npm", files: ["npm-shrinkwrap.json"], want: { status: "selected", value: "npm" } },
  { name: "pnpm lock selects pnpm", files: ["pnpm-lock.yaml"], want: { status: "selected", value: "pnpm" } },
  { name: "bun lock selects bun", files: ["bun.lock"], want: { status: "selected", value: "bun" } },
  { name: "legacy bun lock selects bun", files: ["bun.lockb"], want: { status: "selected", value: "bun" } },
  { name: "matching declaration and lock select npm", files: ["package-lock.json"], packageManager: "npm@11.0.0", want: { status: "selected", value: "npm" } },
  { name: "unsupported declaration stays unsupported", files: [], packageManager: "yarn@4.0.0", want: { status: "unsupported" }, warning: true },
  { name: "declaration conflicting with lock stays ambiguous", files: ["bun.lock"], packageManager: "npm@11.0.0", want: { status: "ambiguous" }, warning: true },
  { name: "conflicting locks stay ambiguous", files: ["pnpm-lock.yaml", "bun.lock"], want: { status: "ambiguous" }, warning: true },
  { name: "no evidence stays unknown", files: [], want: { status: "unknown" } },
]) {
  test(`package manager: ${scenario.name}`, () => {
    const entries = [
      { name: "package.json", type: "file" },
      ...scenario.files.map((name) => ({ name, type: "file" })),
    ];
    const packageJsonText = JSON.stringify(
      scenario.packageManager ? { packageManager: scenario.packageManager } : {},
    );
    const result = classifyEvidence({ entries, packageJsonText });
    assert.deepEqual(result.packageManager, scenario.want);
    assert.deepEqual(
      result.warnings,
      scenario.warning ? ["ambiguous-or-unsupported-manager"] : [],
    );
  });
}
