const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/;

export function parseRepository(value) {
  if (typeof value !== "string" || !REPOSITORY.test(value)) {
    throw new Error("repository must match owner/name");
  }
  const [owner, repo] = value.split("/");
  return { owner, repo };
}

function required(env, key, label) {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} contains control characters`);
  }
  return value;
}

export function loadInputs(env) {
  const token = required(env, "INPUT_GITHUB_TOKEN", "github-token");
  const { owner, repo } = parseRepository(required(env, "INPUT_REPOSITORY", "repository"));
  return {
    token,
    owner,
    repo,
    ref: required(env, "INPUT_REF", "ref"),
    summaryPath: required(env, "GITHUB_STEP_SUMMARY", "GITHUB_STEP_SUMMARY"),
    outputPath: required(env, "GITHUB_OUTPUT", "GITHUB_OUTPUT"),
  };
}
