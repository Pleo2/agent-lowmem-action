import { escapeAnnotation } from "./report.js";
import { runAction } from "./run.js";

try {
  await runAction({ env: process.env, fetchImpl: globalThis.fetch });
} catch (error) {
  const message = error instanceof Error ? error.message : "unexpected-error";
  process.stderr.write(`::error title=Agent Lowmem Action::${escapeAnnotation(message)}\n`);
  process.exitCode = 1;
}
