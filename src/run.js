import { appendFile as appendFileDefault } from "node:fs/promises";
import { classifyEvidence } from "./classify.js";
import { loadInputs } from "./env.js";
import { createGitHubClient } from "./github.js";
import { buildRecommendations } from "./recommend.js";
import { renderOutputs, renderReport } from "./report.js";

async function appendWorkflowFile(appendFile, path, value, logicalName) {
  try {
    await appendFile(path, value, { encoding: "utf8" });
  } catch {
    throw new Error(`workflow-file-write-failed: ${logicalName}`);
  }
}

export async function runAction({
  env,
  fetchImpl = globalThis.fetch,
  appendFile = appendFileDefault,
}) {
  const inputs = loadInputs(env);
  const client = createGitHubClient({ token: inputs.token, fetchImpl });

  await client.getRepository(inputs.owner, inputs.repo);
  const entries = await client.listRoot(inputs.owner, inputs.repo, inputs.ref);
  const hasPackageJson = entries.some((entry) => entry.type === "file" && entry.name === "package.json");
  const packageJsonText = hasPackageJson
    ? await client.getTextFile(inputs.owner, inputs.repo, "package.json", inputs.ref)
    : undefined;

  const classification = classifyEvidence({ entries, packageJsonText });
  const recommendations = buildRecommendations(classification);
  const result = classification.incomplete
    ? "incomplete"
    : recommendations.length > 0
      ? "recommendations"
      : "no-supported-toolchain";

  const report = renderReport({
    repository: `${inputs.owner}/${inputs.repo}`,
    sha: inputs.ref,
    classification,
    recommendations,
  });
  const outputs = renderOutputs({ result, ecosystems: classification.ecosystems });

  await appendWorkflowFile(appendFile, inputs.summaryPath, report, "GITHUB_STEP_SUMMARY");
  await appendWorkflowFile(appendFile, inputs.outputPath, outputs, "GITHUB_OUTPUT");

  return { result, ecosystems: classification.ecosystems };
}
