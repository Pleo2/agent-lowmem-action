function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addEvidence(evidenceSets, ecosystem, source) {
  if (!evidenceSets.has(ecosystem)) evidenceSets.set(ecosystem, new Set());
  evidenceSets.get(ecosystem).add(source);
}

function parseManifest(text) {
  if (text === undefined) return { value: undefined, invalid: false };
  try {
    const value = JSON.parse(text);
    if (!isRecord(value)) return { invalid: true };
    for (const key of ["scripts", "dependencies", "devDependencies"]) {
      if (value[key] !== undefined && !isRecord(value[key])) return { invalid: true };
    }
    if (value.packageManager !== undefined && typeof value.packageManager !== "string") {
      return { invalid: true };
    }
    return { value, invalid: false };
  } catch {
    return { invalid: true };
  }
}

function managerSelection(fileNames, manifest) {
  const managers = new Set();
  if (fileNames.has("package-lock.json") || fileNames.has("npm-shrinkwrap.json")) managers.add("npm");
  if (fileNames.has("pnpm-lock.yaml")) managers.add("pnpm");
  if (fileNames.has("bun.lock") || fileNames.has("bun.lockb")) managers.add("bun");

  let declaration;
  let unsupported = false;
  if (manifest?.packageManager !== undefined && manifest.packageManager.length > 0) {
    const match = /^(npm|pnpm|bun)@[^\s]+$/.exec(manifest.packageManager);
    if (match) {
      declaration = match[1];
      managers.add(declaration);
    } else {
      unsupported = true;
    }
  }

  if (unsupported) return { packageManager: { status: "unsupported" }, warning: true };
  if (managers.size > 1) return { packageManager: { status: "ambiguous" }, warning: true };
  if (managers.size === 1) {
    return { packageManager: { status: "selected", value: [...managers][0] }, warning: false };
  }
  return { packageManager: { status: "unknown" }, warning: false };
}

export function classifyEvidence({ entries, packageJsonText }) {
  const files = entries.filter((entry) => entry?.type === "file");
  const fileNames = new Set(files.map((entry) => entry.name));
  const evidenceSets = new Map();
  const warnings = new Set();

  if (fileNames.has("Cargo.toml")) addEvidence(evidenceSets, "rust", "Cargo.toml");
  if (fileNames.has("package.json")) addEvidence(evidenceSets, "node", "package.json");
  for (const name of ["bun.lock", "bun.lockb", "bunfig.toml"]) {
    if (fileNames.has(name)) addEvidence(evidenceSets, "bun", name);
  }
  for (const { name } of files) {
    if (name === "tsconfig.json" || /^tsconfig\..+\.json$/.test(name)) {
      addEvidence(evidenceSets, "typescript", name);
    }
  }

  const parsed = parseManifest(packageJsonText);
  if (parsed.invalid) warnings.add("package-json-invalid");
  const manifest = parsed.value;
  let hasNpmTest = false;
  let hasTypescriptDependency = false;

  if (manifest) {
    hasNpmTest = typeof manifest.scripts?.test === "string" && manifest.scripts.test.length > 0;
    for (const group of ["dependencies", "devDependencies"]) {
      if (typeof manifest[group]?.typescript === "string") {
        hasTypescriptDependency = true;
        addEvidence(evidenceSets, "typescript", `package.json#${group}.typescript`);
      }
    }
    if (/^bun@[^\s]+$/.test(manifest.packageManager ?? "")) {
      addEvidence(evidenceSets, "bun", "package.json#packageManager");
    }
  }

  const manager = managerSelection(fileNames, manifest);
  if (manager.warning) warnings.add("ambiguous-or-unsupported-manager");

  const ecosystems = [...evidenceSets.keys()].sort();
  const evidence = Object.fromEntries(ecosystems.map((ecosystem) => [
    ecosystem,
    [...evidenceSets.get(ecosystem)].sort(),
  ]));

  return {
    ecosystems,
    evidence,
    packageManager: manager.packageManager,
    hasNpmTest,
    hasTypescriptDependency,
    incomplete: entries.length === 1_000,
    warnings: [...warnings].sort(),
  };
}
