import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubClient } from "../src/github.js";

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

test("GitHub client sends the bounded repository request contract", async () => {
  const calls = [];
  const client = createGitHubClient({
    token: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ id: 1, default_branch: "main" }, {
        headers: { "x-github-request-id": "REQ1" },
      });
    },
  });

  assert.deepEqual(await client.getRepository("Pleo2", "repo"), {
    id: 1,
    default_branch: "main",
  });
  assert.equal(calls[0].url, "https://api.github.com/repos/Pleo2/repo");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(calls[0].options.redirect, "error");
});

test("GitHub client encodes refs when listing root contents", async () => {
  const calls = [];
  const client = createGitHubClient({
    token: "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse([{ name: "Cargo.toml", type: "file" }]);
    },
  });

  assert.deepEqual(await client.listRoot("Pleo2", "repo", "refs/heads/a b"), [
    { name: "Cargo.toml", type: "file" },
  ]);
  assert.equal(calls[0].url, "https://api.github.com/repos/Pleo2/repo/contents?ref=refs%2Fheads%2Fa+b");
});

test("GitHub client decodes a base64 text file", async () => {
  const client = createGitHubClient({
    token: "token",
    fetchImpl: async () => jsonResponse({
      type: "file",
      encoding: "base64",
      content: "aGVs\nbG8=",
    }),
  });

  assert.equal(await client.getTextFile("Pleo2", "repo", "package.json", "abc"), "hello");
});

test("GitHub client rejects a non-file content response", async () => {
  const client = createGitHubClient({
    token: "token",
    fetchImpl: async () => jsonResponse([{ name: "child" }]),
  });

  await assert.rejects(
    client.getTextFile("Pleo2", "repo", "package.json", "abc"),
    /github-api-response/,
  );
});

test("GitHub client rejects malformed base64 and oversized decoded files", async () => {
  for (const [content, maxResponseBytes] of [["!!!!", 262_144], ["aGVsbG8=", 4]]) {
    const client = createGitHubClient({
      token: "token",
      maxResponseBytes,
      fetchImpl: async () => jsonResponse({ type: "file", encoding: "base64", content }),
    });
    await assert.rejects(
      client.getTextFile("Pleo2", "repo", "package.json", "abc"),
      /github-api-response/,
    );
  }
});

async function captureRepositoryError(responseFactory, options = {}) {
  const client = createGitHubClient({
    token: "secret-token",
    fetchImpl: async () => responseFactory(),
    ...options,
  });
  try {
    await client.getRepository("Pleo2", "repo");
    assert.fail("expected repository request to reject");
  } catch (error) {
    return error;
  }
}

for (const [status, headers, code] of [
  [401, {}, "github-api-auth"],
  [403, {}, "github-api-permission"],
  [403, { "x-ratelimit-remaining": "0" }, "github-api-rate-limit"],
  [404, {}, "github-api-not-found"],
  [429, {}, "github-api-rate-limit"],
  [500, {}, "github-api-response"],
]) {
  test(`GitHub API error maps status ${status} to ${code}`, async () => {
    const error = await captureRepositoryError(() => new Response("response-body-secret", {
      status,
      headers: { ...headers, "x-github-request-id": "REQ:123" },
    }));
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.requestId, "REQ:123");
    assert.doesNotMatch(String(error), /secret-token|response-body-secret/);
    assert.match(String(error), new RegExp(code));
  });
}

test("GitHub API error rejects oversized response bodies without exposing them", async () => {
  const error = await captureRepositoryError(
    () => new Response('{"response-body-secret":true}'),
    { maxResponseBytes: 8 },
  );
  assert.equal(error.code, "github-api-response");
  assert.doesNotMatch(String(error), /secret-token|response-body-secret/);
});

test("GitHub API error rejects malformed JSON and invalid UTF-8", async () => {
  for (const body of ["{response-body-secret", new Uint8Array([0xff])]) {
    const error = await captureRepositoryError(() => new Response(body));
    assert.equal(error.code, "github-api-response");
    assert.doesNotMatch(String(error), /secret-token|response-body-secret/);
  }
});

test("GitHub API error maps fetch and redirect rejection to a redacted network error", async () => {
  for (const message of ["secret-token network failure", "redirect mode is error"]) {
    const client = createGitHubClient({
      token: "secret-token",
      fetchImpl: async () => { throw new Error(message); },
    });
    let error;
    try {
      await client.getRepository("Pleo2", "repo");
      assert.fail("expected repository request to reject");
    } catch (caught) {
      error = caught;
    }
    assert.equal(error.code, "github-api-network");
    assert.doesNotMatch(String(error), /secret-token|response-body-secret/);
  }
});

test("GitHub API error discards hostile request IDs", async () => {
  const error = await captureRepositoryError(() => new Response("response-body-secret", {
    status: 500,
    headers: { "x-github-request-id": "bad request id\nsecret" },
  }));
  assert.equal(error.requestId, undefined);
  assert.doesNotMatch(String(error), /bad request|secret/);
});
