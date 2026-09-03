function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recommendation(ecosystem, command, evidence) {
  return Object.freeze({
    ecosystem,
    command,
    evidence: Object.freeze([...(evidence ?? [])].sort(compareText)),
  });
}

export function buildRecommendations(classification) {
  const values = [];
  const selectedManager = classification.packageManager.status === "selected"
    ? classification.packageManager.value
    : undefined;

  if (classification.ecosystems.includes("rust")) {
    values.push(recommendation("rust", "agent-lowmem run cargo test", classification.evidence.rust));
  }

  if (classification.ecosystems.includes("bun") && selectedManager === "bun") {
    values.push(recommendation("bun", "agent-lowmem run bun test", classification.evidence.bun));
  }

  if (selectedManager === "npm" && classification.hasNpmTest) {
    values.push(recommendation("node", "agent-lowmem run npm test", classification.evidence.node));
  }

  if (classification.hasTypescriptDependency && selectedManager) {
    const commands = {
      npm: "agent-lowmem run npm exec -- tsc --noEmit",
      pnpm: "agent-lowmem run pnpm exec tsc --noEmit",
      bun: "agent-lowmem run bunx tsc --noEmit",
    };
    if (commands[selectedManager]) {
      values.push(recommendation("typescript", commands[selectedManager], classification.evidence.typescript));
    }
  }

  const unique = new Map(values.map((value) => [value.command, value]));
  return [...unique.values()].sort((left, right) => (
    compareText(left.ecosystem, right.ecosystem) || compareText(left.command, right.command)
  ));
}
