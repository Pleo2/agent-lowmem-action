const DEFAULT_MAX_RESPONSE_BYTES = 262_144;
const API_ROOT = "https://api.github.com";

export class GitHubApiError extends Error {
  constructor(code, { status, requestId } = {}) {
    const details = [status === undefined ? null : `status=${status}`, requestId ? `request-id=${requestId}` : null]
      .filter(Boolean)
      .join(" ");
    super(details ? `${code} (${details})` : code);
    this.name = "GitHubApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function requestIdFrom(response) {
  const value = response.headers.get("x-github-request-id");
  return value && /^[A-Za-z0-9:-]{1,128}$/.test(value) ? value : undefined;
}

function responseError(response, code = "github-api-response") {
  return new GitHubApiError(code, response ? {
    status: response.status,
    requestId: requestIdFrom(response),
  } : undefined);
}

function statusCode(response) {
  if (response.status === 401) return "github-api-auth";
  if (response.status === 403) {
    return response.headers.get("x-ratelimit-remaining") === "0"
      ? "github-api-rate-limit"
      : "github-api-permission";
  }
  if (response.status === 404) return "github-api-not-found";
  if (response.status === 429) return "github-api-rate-limit";
  return "github-api-response";
}

function decodeBase64(value) {
  const compact = value.replace(/[\r\n]/g, "");
  if (compact.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw responseError();
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.toString("base64") !== compact) {
    throw responseError();
  }
  return bytes;
}

export function createGitHubClient({
  token,
  fetchImpl = globalThis.fetch,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
}) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "agent-lowmem-action/0.1",
  };

  async function requestJson(path) {
    let response;
    try {
      const url = new URL(path, API_ROOT);
      response = await fetchImpl(url.href, { headers, redirect: "error" });
    } catch {
      throw new GitHubApiError("github-api-network");
    }

    if (!response.ok) {
      throw responseError(response, statusCode(response));
    }

    let bytes;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw responseError(response);
    }
    if (bytes.byteLength > maxResponseBytes) {
      throw responseError(response);
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return JSON.parse(text);
    } catch {
      throw responseError(response);
    }
  }

  return {
    async getRepository(owner, repo) {
      const value = await requestJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      if (!value || typeof value !== "object" || typeof value.id !== "number" || typeof value.default_branch !== "string") {
        throw responseError();
      }
      return value;
    },

    async listRoot(owner, repo, ref) {
      const query = new URLSearchParams({ ref });
      const value = await requestJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${query}`);
      if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry.name !== "string" || typeof entry.type !== "string")) {
        throw responseError();
      }
      return value;
    },

    async getTextFile(owner, repo, path, ref) {
      const query = new URLSearchParams({ ref });
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const value = await requestJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?${query}`);
      if (!value || value.type !== "file" || value.encoding !== "base64" || typeof value.content !== "string") {
        throw responseError();
      }
      const bytes = decodeBase64(value.content);
      if (bytes.byteLength > maxResponseBytes) {
        throw responseError();
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw responseError();
      }
    },
  };
}
