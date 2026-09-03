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
    "INPUT_GITHUB-TOKEN": "token-value",
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
