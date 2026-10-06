#!/usr/bin/env node
// Rewrites a codeful project's literal .csproj PackageReference version and nuget.config
// packageSources/current value to point at a (new) candidate, reusing the exact
// literal-replace technique that createCodefulWorkflowFile
// (app/commands/createNewCodeProject/CodeProjectBase/CreateLogicAppWorkspace.ts) uses at
// fresh-project-creation time -- which is the ONLY existing code that writes these two
// values. That renderer never runs again once Program.cs exists (see its
// `if (await fse.pathExists(programFilePath))` guard), so a project copied into a new
// candidate root by copy-candidate-workspace.js is NOT retargeted by any existing product
// code: invalidateCodefulSdkCacheIfNeeded (app/utils/codeful.ts) only clears a project-local
// NuGet cache entry, and its own gate (codefulNugetConfigUsesExtensionSdkCache) requires
// nuget.config's packageSources/current to already equal the new candidate's LSP directory
// -- which is false until this script runs. This was confirmed by direct source inspection,
// not assumed from naming.
//
// Pure file-system operation: never launches dotnet/func/VS Code, never contacts NuGet, and
// never touches connections.json/parameters.json/local.settings.json or any other project
// content besides the two literal fields below.
const fs = require('node:fs');
const path = require('node:path');

const sdkPackageId = 'Microsoft.Azure.Workflows.Sdk';

function parseArgs(argv) {
  const allowed = new Set(['project', 'candidate-manifest', 'candidate-root']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] ? argv[i].replace(/^--/, '') : undefined;
    if (!argv[i] || !argv[i].startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) {
      throw new Error(`Unknown, duplicate, or missing argument: ${argv[i]}`);
    }
    args[key] = argv[i + 1];
  }
  for (const key of ['project', 'candidate-manifest', 'candidate-root']) {
    if (!args[key]) {
      throw new Error(`--${key} is required.`);
    }
    if (!path.isAbsolute(args[key])) {
      throw new Error(`--${key} must be an absolute path.`);
    }
  }
  return args;
}

/**
 * Derive the candidate facts needed to retarget a project from the same two inputs the
 * product uses to select a candidate (LOGICAPPS_LOCAL_CANDIDATE_MANIFEST/ROOT), without
 * duplicating getLocalCandidate()'s full archive/SHA256 validation -- that validation is
 * the installer's job (ensureLocalCandidateInstalled, already run before this point);
 * retargeting a project's own files is a separate, narrower concern.
 *
 * dependenciesPath/lspDirectory layout matches LocalCandidate.dependenciesPath and the
 * `lspDirectory = 'LanguageServerLogicApps'` constant exactly (app/utils/localCandidate.ts,
 * app/constants.ts).
 */
function readCandidateFacts(manifestPath, candidateRoot) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`--candidate-manifest does not exist: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) {
    throw new Error('manifest schemaVersion must be 1.');
  }
  const sdk = manifest.sdk;
  if (!sdk || sdk.packageId !== sdkPackageId || typeof sdk.version !== 'string' || !sdk.version) {
    throw new Error(`manifest.sdk.packageId must be ${sdkPackageId} with a non-empty version.`);
  }
  const dependenciesPath = path.join(candidateRoot, 'dependencies');
  const lspDirectoryPath = path.join(dependenciesPath, 'LanguageServerLogicApps');
  return { packageId: sdk.packageId, version: sdk.version, lspDirectoryPath };
}

function escapeNugetAttributeValue(value) {
  // Matches CreateLogicAppWorkspace.ts's exact escaping for the candidate LSP path.
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function findSingleFile(projectPath, extension) {
  const matches = fs.readdirSync(projectPath).filter((name) => name.toLowerCase().endsWith(extension));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${extension} file directly under --project, found ${matches.length}: ${projectPath}`);
  }
  return path.join(projectPath, matches[0]);
}

/** Rewrite the literal `<PackageReference Include="Microsoft.Azure.Workflows.Sdk" Version="...">` entry. */
function retargetCsproj(csprojPath, candidate) {
  const content = fs.readFileSync(csprojPath, 'utf8');
  const pattern = new RegExp(`(<PackageReference\\s+Include="${escapeRegExp(candidate.packageId)}"\\s+Version=")([^"]*)("\\s*/?>)`);
  const match = content.match(pattern);
  if (!match) {
    throw new Error(
      `Could not find a <PackageReference Include="${candidate.packageId}" Version="..."> entry in ${csprojPath}; refusing to guess.`
    );
  }
  const oldVersion = match[2];
  if (oldVersion === candidate.version) {
    return { changed: false, oldVersion, newVersion: candidate.version };
  }
  const updated = content.replace(pattern, `$1${candidate.version}$3`);
  fs.writeFileSync(csprojPath, updated);
  return { changed: true, oldVersion, newVersion: candidate.version };
}

/** Rewrite the literal nuget.config packageSources/current add value (and its packageSourceMapping pattern, if present). */
function retargetNugetConfig(nugetConfigPath, candidate) {
  const content = fs.readFileSync(nugetConfigPath, 'utf8');
  const sourcePattern = /(<packageSources\b[^>]*>[\s\S]*?<add\s+key="current"\s+value=")([^"]*)("\s*\/>[\s\S]*?<\/packageSources>)/;
  const match = content.match(sourcePattern);
  if (!match) {
    throw new Error(`Could not find a packageSources <add key="current" value="..."> entry in ${nugetConfigPath}; refusing to guess.`);
  }
  const oldSource = match[2];
  const newSource = escapeNugetAttributeValue(candidate.lspDirectoryPath);
  if (oldSource === newSource) {
    return { changed: false, oldSource, newSource };
  }
  let updated = content.replace(sourcePattern, `$1${newSource}$3`);
  const mappingPattern = /(<packageSource\s+key="current"><package\s+pattern=")([^"]*)("\s*\/><\/packageSource>)/;
  if (mappingPattern.test(updated)) {
    updated = updated.replace(mappingPattern, `$1${escapeNugetAttributeValue(candidate.packageId)}$3`);
  }
  fs.writeFileSync(nugetConfigPath, updated);
  return { changed: true, oldSource, newSource };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Retarget an already-existing codeful project's .csproj PackageReference version and
 * nuget.config packageSources/current value to the given candidate facts. Preserves every
 * other file and every other value in both files untouched (user config/connections are
 * never read or written by this function). Fails closed -- throws rather than silently
 * leaving stale values -- if either file's expected literal shape is not found, since an
 * unrecognized shape means guessing which text to replace would be unsafe.
 */
function retargetCodefulProject(projectPath, candidate) {
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error(`--project does not exist or is not a directory: ${projectPath}`);
  }
  const csprojPath = findSingleFile(projectPath, '.csproj');
  const nugetConfigPath = path.join(projectPath, 'nuget.config');
  if (!fs.existsSync(nugetConfigPath)) {
    throw new Error(`No nuget.config found directly under --project: ${projectPath}`);
  }
  return {
    csproj: { path: csprojPath, ...retargetCsproj(csprojPath, candidate) },
    nugetConfig: { path: nugetConfigPath, ...retargetNugetConfig(nugetConfigPath, candidate) },
  };
}

function main(argv) {
  const args = parseArgs(argv);
  const candidate = readCandidateFacts(args['candidate-manifest'], args['candidate-root']);
  const result = retargetCodefulProject(args.project, candidate);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

module.exports = {
  parseArgs,
  readCandidateFacts,
  retargetCodefulProject,
  main,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
