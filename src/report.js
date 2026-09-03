const RESULTS = new Set(["recommendations", "no-supported-toolchain", "incomplete"]);
const ECOSYSTEMS = new Set(["bun", "node", "rust", "typescript"]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sanitize(value) {
  return String(value)
    .replace(/\p{Cc}/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function markdownText(value) {
  return sanitize(value).replace(/[\\`*_[\]{}()#+.!|-]/g, "\\$&");
}

function inlineCode(value) {
  const safe = sanitize(value);
  const longest = Math.max(0, ...[...safe.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const padding = safe.startsWith("`") || safe.endsWith("`") ? " " : "";
  return `${fence}${padding}${safe}${padding}${fence}`;
}

export function renderReport({ repository, sha, classification, recommendations }) {
  const lines = [
    "# Agent Lowmem readiness",
    "",
    `**Repository:** ${inlineCode(repository)}  `,
    `**Commit:** ${inlineCode(sha)}`,
    "",
    "## Observed evidence",
    "",
  ];

  const ecosystems = [...classification.ecosystems].sort(compareText);
  if (ecosystems.length === 0) {
    lines.push("None.");
  } else {
    for (const ecosystem of ecosystems) {
      const evidence = [...(classification.evidence[ecosystem] ?? [])]
        .sort(compareText)
        .map(inlineCode)
        .join(", ");
      lines.push(`- **${markdownText(ecosystem)}:** ${evidence || "None."}`);
    }
  }

  lines.push("", "## Recommended commands", "");
  if (recommendations.length === 0) {
    lines.push("None.");
  } else {
    const ordered = [...recommendations].sort((left, right) => (
      compareText(left.ecosystem, right.ecosystem) || compareText(left.command, right.command)
    ));
    for (const item of ordered) {
      lines.push(`- **${markdownText(item.ecosystem)}:** ${inlineCode(item.command)}`);
    }
  }

  const warnings = [...classification.warnings].map(markdownText);
  if (classification.incomplete) {
    warnings.push("GitHub returned 1,000 root entries; detection may be incomplete.");
  }
  if (ecosystems.length > 1) {
    warnings.push("Mixed repository: version 0.1 does not infer orchestration order.");
  }

  lines.push("", "## Warnings", "");
  if (warnings.length === 0) {
    lines.push("None.");
  } else {
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  lines.push(
    "",
    "---",
    "Read-only inspection: Agent Lowmem Action did not modify repository content.",
    "",
  );
  return lines.join("\n");
}

export function renderOutputs({ result, ecosystems }) {
  if (!RESULTS.has(result)) throw new Error("result must be a closed value");
  for (const ecosystem of ecosystems) {
    if (!ECOSYSTEMS.has(ecosystem)) throw new Error("ecosystem must be a closed value");
  }
  const stable = [...new Set(ecosystems)].sort(compareText).join(",");
  return `result=${result}\necosystems=${stable}\n`;
}

export function escapeAnnotation(message) {
  const bounded = [...String(message).replace(/\p{Cc}/gu, (character) => (
    character === "\r" || character === "\n" ? character : " "
  ))]
    .slice(0, 512)
    .join("");
  return bounded
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}
