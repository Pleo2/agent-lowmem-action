import test from "node:test";
import assert from "node:assert/strict";
import { buildRecommendations } from "../src/recommend.js";

function classification(overrides = {}) {
  return {
    ecosystems: [],
    evidence: {},
    packageManager: { status: "unknown" },
    hasNpmTest: false,
    hasTypescriptDependency: false,
    incomplete: false,
    warnings: [],
    ...overrides,
  };
}

test("buildRecommendations emits stable commands for a mixed repository", () => {
  const input = classification({
    ecosystems: ["node", "rust", "typescript"],
    evidence: {
      node: ["package.json"],
      rust: ["Cargo.toml"],
      typescript: ["package.json#devDependencies.typescript", "tsconfig.json"],
    },
    packageManager: { status: "selected", value: "npm" },
    hasNpmTest: true,
    hasTypescriptDependency: true,
  });

  assert.deepEqual(buildRecommendations(input), [
    { ecosystem: "node", command: "agent-lowmem run npm test", evidence: ["package.json"] },
    { ecosystem: "rust", command: "agent-lowmem run cargo test", evidence: ["Cargo.toml"] },
    { ecosystem: "typescript", command: "agent-lowmem run npm exec -- tsc --noEmit", evidence: ["package.json#devDependencies.typescript", "tsconfig.json"] },
  ]);
  assert.equal(Object.isFrozen(buildRecommendations(input)[0]), true);
  assert.deepEqual(input.evidence.rust, ["Cargo.toml"]);
});

for (const [manager, command] of [
  ["npm", "agent-lowmem run npm exec -- tsc --noEmit"],
  ["pnpm", "agent-lowmem run pnpm exec tsc --noEmit"],
  ["bun", "agent-lowmem run bunx tsc --noEmit"],
]) {
  test(`buildRecommendations uses the selected ${manager} TypeScript command`, () => {
    assert.deepEqual(buildRecommendations(classification({
      ecosystems: ["typescript"],
      evidence: { typescript: ["package.json#dependencies.typescript"] },
      packageManager: { status: "selected", value: manager },
      hasTypescriptDependency: true,
    })), [{
      ecosystem: "typescript",
      command,
      evidence: ["package.json#dependencies.typescript"],
    }]);
  });
}

test("buildRecommendations emits Bun test only with unambiguous Bun evidence", () => {
  assert.deepEqual(buildRecommendations(classification({
    ecosystems: ["bun"],
    evidence: { bun: ["bun.lock"] },
    packageManager: { status: "selected", value: "bun" },
  })), [{ ecosystem: "bun", command: "agent-lowmem run bun test", evidence: ["bun.lock"] }]);
});

test("buildRecommendations omits commands that repository evidence cannot support", () => {
  for (const value of [
    classification({ ecosystems: ["node"], evidence: { node: ["package.json"] }, packageManager: { status: "selected", value: "npm" } }),
    classification({ ecosystems: ["typescript"], evidence: { typescript: ["tsconfig.json"] }, packageManager: { status: "selected", value: "npm" } }),
    classification({ ecosystems: ["bun", "node"], evidence: { bun: ["bun.lock"], node: ["package.json"] }, packageManager: { status: "ambiguous" }, hasNpmTest: true }),
  ]) {
    assert.deepEqual(buildRecommendations(value), []);
  }
});
