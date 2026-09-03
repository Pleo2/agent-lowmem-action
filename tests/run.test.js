import test from "node:test";
import assert from "node:assert/strict";
import { runAction } from "../src/run.js";

function response(value, status = 200) {
  return new Response(typeof value === "string" ? value : JSON.stringify(value), { status });
}

function actionEnv() {
  return {
    "INPUT_GITHUB-TOKEN": "test-token",
    INPUT_REPOSITORY: "Pleo2/example",
    INPUT_REF: "0123456789abcdef0123456789abcdef01234567",
    GITHUB_STEP_SUMMARY: "/runner/summary",
    GITHUB_OUTPUT: "/runner/output",
  };
}

function queuedRuntime(responses) {
  const calls = [];
  const writes = [];
  return {
    calls,
    writes,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      assert.notEqual(next, undefined, "unexpected extra request");
      return next;
    },
    appendFile: async (path, value) => {
      writes.push({ path, value });
    },
  };
}

test("runAction completes unsupported inspection with exactly two requests", async () => {
  const runtime = queuedRuntime([
    response({ id: 1, default_branch: "main" }),
    response([{ name: "README.md", type: "file" }]),
  ]);

  assert.deepEqual(await runAction({ env: actionEnv(), ...runtime }), {
    result: "no-supported-toolchain",
    ecosystems: [],
  });
  assert.equal(runtime.calls.length, 2);
  assert.equal(runtime.writes.length, 2);
  assert.equal(runtime.writes[0].path, "/runner/summary");
  assert.equal(runtime.writes[1].path, "/runner/output");
  assert.match(runtime.writes[0].value, /Read-only inspection/);
  assert.equal(runtime.writes[1].value, "result=no-supported-toolchain\necosystems=\n");
});

test("runAction fetches package.json at the caller ref and emits recommendations", async () => {
  const packageJson = Buffer.from(JSON.stringify({
    packageManager: "npm@11.0.0",
    scripts: { test: "node --test" },
  })).toString("base64");
  const runtime = queuedRuntime([
    response({ id: 1, default_branch: "main" }),
    response([
      { name: "package-lock.json", type: "file" },
      { name: "package.json", type: "file" },
    ]),
    response({ type: "file", encoding: "base64", content: packageJson }),
  ]);

  assert.deepEqual(await runAction({ env: actionEnv(), ...runtime }), {
    result: "recommendations",
    ecosystems: ["node"],
  });
  assert.equal(runtime.calls.length, 3);
  assert.match(runtime.calls[2].url, /\/contents\/package\.json\?ref=0123456789abcdef0123456789abcdef01234567$/);
  assert.match(runtime.writes[0].value, /agent-lowmem run npm test/);
});

test("runAction marks a root listing at the API limit incomplete", async () => {
  const entries = Array.from({ length: 1_000 }, (_, index) => ({
    name: `file-${index}`,
    type: "file",
  }));
  const runtime = queuedRuntime([
    response({ id: 1, default_branch: "main" }),
    response(entries),
  ]);

  const result = await runAction({ env: actionEnv(), ...runtime });
  assert.equal(result.result, "incomplete");
  assert.match(runtime.writes[0].value, /detection may be incomplete/);
  assert.match(runtime.writes[1].value, /^result=incomplete$/m);
});

test("runAction writes no success artifact when the package request fails", async () => {
  const runtime = queuedRuntime([
    response({ id: 1, default_branch: "main" }),
    response([{ name: "package.json", type: "file" }]),
    response("response-body-secret", 500),
  ]);

  await assert.rejects(
    runAction({ env: actionEnv(), ...runtime }),
    /github-api-response/,
  );
  assert.equal(runtime.calls.length, 3);
  assert.deepEqual(runtime.writes, []);
});

test("runAction reports workflow-file failures with logical names only", async () => {
  for (const failPath of ["/runner/summary", "/runner/output"]) {
    const runtime = queuedRuntime([
      response({ id: 1, default_branch: "main" }),
      response([]),
    ]);
    runtime.appendFile = async (path, value) => {
      runtime.writes.push({ path, value });
      if (path === failPath) throw new Error(`disk failure at ${path}`);
    };

    await assert.rejects(
      runAction({ env: actionEnv(), ...runtime }),
      new RegExp(`workflow-file-write-failed: ${failPath.endsWith("summary") ? "GITHUB_STEP_SUMMARY" : "GITHUB_OUTPUT"}`),
    );
  }
});
