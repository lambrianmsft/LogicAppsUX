#!/usr/bin/env node
// Generic, parameterized replacement for the private manual "copy an edited candidate
// workspace into a new candidate selection" step used while testing a new SDK/bundle
// candidate. Pure file-system operation: it never launches VS Code, dotnet, func, or
// any build, and never contacts a candidate root's owner marker or product installer.
//
// This is only the copy step. It does not select a candidate (that remains
// LOGICAPPS_LOCAL_CANDIDATE_MANIFEST/ROOT). Of the copied project's package/feed/LSP/task
// bindings to the newly selected candidate, only SOME retarget automatically the first
// time each subsystem runs against the project in its new location, via existing product
// code; the project's literal .csproj/nuget.config values do NOT, and must be rewritten
// by retarget-candidate-workspace.js (verified by direct inspection, not assumed):
//   - Debug tasks/host environment: migrateLocalCandidateTasks
//     (app/utils/localCandidateTasks.ts), applied at F5 time via
//     fetchLocalCandidateDebugTasks -- confirmed to rewrite only .vscode/tasks.json
//     (options.env, the node-launcher command/args wrapper, and the --offline flag).
//   - Automatic, gated on assertLocalCandidateProject (app/utils/localCandidateRuntime.ts),
//     which requires the project to physically live under the active candidate's root;
//     relocating the project here is what makes that gate pass.
//   - NOT automatic: the generated .csproj's `<PackageReference ... Version="...">` and
//     nuget.config's `packageSources/current` value are literal strings rendered ONCE, at
//     fresh-project-creation time only, by createCodefulWorkflowFile
//     (app/commands/createNewCodeProject/CodeProjectBase/CreateLogicAppWorkspace.ts,
//     guarded by `if (await fse.pathExists(programFilePath))`, which SKIPS csproj/nuget
//     rendering whenever Program.cs already exists -- i.e. always, for a copied project).
//     invalidateCodefulSdkCacheIfNeeded (app/utils/codeful.ts) only clears the project-local
//     NuGet package cache for a SAME-version VSIX content change; its own gate,
//     codefulNugetConfigUsesExtensionSdkCache, requires nuget.config's packageSources/current
//     to ALREADY equal the active candidate's LSP directory, so it no-ops (does not rewrite
//     anything) when the copied nuget.config still points at the OLD candidate's path.
//     retarget-candidate-workspace.js rewrites both files using the same literal-replace
//     technique as CreateLogicAppWorkspace.ts, reusing its exact pattern rather than
//     reimplementing new logic.
//
// See apps/vs-code-designer/scripts/run-candidate-e2e.md for the full procedure this
// helper is one step of, including what it does and does not guarantee.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const receiptName = '.copied-from-candidate-workspace.json';

// Regenerated or candidate-run-specific content that must never be carried forward into
// a new selection: stale build output (bin/obj/lib/codeful), a previous candidate's
// derived debug hosts, the project-local NuGet restore cache (regenerated and
// self-healed by invalidateCodefulSdkCacheIfNeeded above), and editor caches.
const excludedNames = new Set([
  'bin',
  'obj',
  '.vs',
  '.nuget',
  'node_modules',
  'debug-hosts',
  path.join('lib', 'codeful'),
  '.logicapps-local-candidate.json',
]);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isExcludedRelativePath(relativePath) {
  const segments = relativePath.split(path.sep);
  for (let end = 1; end <= segments.length; end++) {
    if (excludedNames.has(path.join(...segments.slice(0, end)))) {
      return true;
    }
  }
  return false;
}

function parseArgs(argv) {
  const allowed = new Set(['source', 'dest']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] ? argv[i].replace(/^--/, '') : undefined;
    if (!argv[i] || !argv[i].startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) {
      throw new Error(`Unknown, duplicate, or missing argument: ${argv[i]}`);
    }
    args[key] = argv[i + 1];
  }
  if (!args.source || !args.dest) {
    throw new Error('--source and --dest are both required.');
  }
  if (!path.isAbsolute(args.source) || !path.isAbsolute(args.dest)) {
    throw new Error('--source and --dest must both be absolute paths.');
  }
  return args;
}

/** Reject copying an arbitrary directory: require a recognizable Logic Apps project/workspace marker. */
function assertCopyableSource(source) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`--source does not exist or is not a directory: ${source}`);
  }
  const entries = fs.readdirSync(source);
  const hasWorkspaceFile = entries.some((name) => name.endsWith('.code-workspace'));
  const hasProjectMarker = entries.includes('host.json') || entries.includes('local.settings.json');
  const hasNestedProject = entries.some((name) => {
    const nested = path.join(source, name);
    return fs.statSync(nested).isDirectory() && fs.existsSync(path.join(nested, 'host.json'));
  });
  if (!hasWorkspaceFile && !hasProjectMarker && !hasNestedProject) {
    throw new Error(
      `--source does not look like a Logic Apps workspace or project (no .code-workspace, host.json, or local.settings.json found): ${source}`
    );
  }
}

/**
 * Destination-overwrite protection only: refuses to copy into a destination that already
 * exists. This prevents silently merging/overwriting another candidate's workspace; it
 * does NOT detect edits made to --source after a prior copy, and it does NOT by itself
 * keep a copy "fresh" over time. Use assertCandidateWorkspaceSourceUnchanged (below) to
 * detect drift in an already-copied destination before treating it as launch-ready.
 */
function assertNewDestination(dest) {
  if (fs.existsSync(dest)) {
    throw new Error(`--dest already exists; refusing to overwrite or merge: ${dest}`);
  }
  if (!fs.existsSync(path.dirname(dest))) {
    throw new Error(`Parent of --dest does not exist: ${path.dirname(dest)}`);
  }
}

/** List tracked (non-excluded) file relative paths under root, in a stable sorted order. */
function listTrackedFiles(root) {
  const files = [];
  function walk(dir, relativeDir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (isExcludedRelativePath(relativePath) || entry.name === receiptName) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to traverse a symbolic link: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  walk(root, '');
  return files.sort();
}

function copyTree(source, dest) {
  let copied = 0;
  let skipped = 0;
  const fingerprints = {};
  function walk(from, to, relativeDir) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (isExcludedRelativePath(relativePath)) {
        skipped++;
        continue;
      }
      const fromPath = path.join(from, entry.name);
      const toPath = path.join(to, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to copy a symbolic link: ${fromPath}`);
      }
      if (entry.isDirectory()) {
        walk(fromPath, toPath, relativePath);
      } else if (entry.isFile()) {
        fs.copyFileSync(fromPath, toPath, fs.constants.COPYFILE_EXCL);
        fingerprints[relativePath] = sha256File(toPath);
        copied++;
      }
    }
  }
  walk(source, dest, '');
  return { copied, skipped, fingerprints };
}

/**
 * Copy an existing, user-edited candidate workspace/project into a new location,
 * preserving its source exactly, so it can be reopened against a newly selected
 * candidate (manifest/root) without losing in-progress edits and without carrying
 * forward the previous candidate's build output, derived debug hosts, or project-local
 * NuGet restore cache.
 *
 * This does not change, create, or validate any candidate selection itself: selection
 * remains the existing `LOGICAPPS_LOCAL_CANDIDATE_MANIFEST` / `LOGICAPPS_LOCAL_CANDIDATE_ROOT`
 * environment variables (or equivalent settings) read by `getLocalCandidate()` /
 * `ensureLocalCandidateInstalled()`. It does not retarget package/feed/LSP/task bindings
 * either -- see the file-header comment for the existing product code that already does
 * that automatically once the project lives under the new candidate's root.
 *
 * The written receipt records a SHA-256 fingerprint of every copied file (taken from the
 * original `--source`, at the moment of copy) so a later
 * `assertOriginalSourceUnchangedSincePrepare(dest)` call can detect whether the ORIGINAL
 * `--source` directory was edited again after this copy was made -- meaning `dest` no
 * longer reflects the latest intended edits and should be recopied before reuse/relaunch.
 * Editing the new `dest` copy itself afterward (the normal F5/iterate workflow) is
 * expected and is never flagged by that check; see `assertDestinationCopyIntegrity`
 * below for the separate, lower-priority "did dest corrupt itself" check.
 */
function copyCandidateWorkspace({ source, dest }) {
  assertCopyableSource(source);
  assertNewDestination(dest);
  const { copied, skipped, fingerprints } = copyTree(source, dest);
  const receipt = {
    schemaVersion: 2,
    source,
    dest,
    copiedUtc: new Date().toISOString(),
    filesCopied: copied,
    entriesExcluded: skipped,
    excludedNames: [...excludedNames],
    fingerprints,
  };
  fs.writeFileSync(path.join(dest, receiptName), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function readCopyReceipt(dest) {
  const receiptPath = path.join(dest, receiptName);
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`No ${receiptName} receipt found under --dest; it was not prepared by copyCandidateWorkspace: ${dest}`);
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.schemaVersion !== 2 || !receipt.fingerprints) {
    throw new Error(`${receiptName} has no recorded fingerprints (schemaVersion ${receipt.schemaVersion}); recopy with the current tool.`);
  }
  return receipt;
}

function compareFingerprints(root, fingerprints) {
  const recordedFiles = Object.keys(fingerprints).sort();
  const currentFiles = listTrackedFiles(root);
  const recordedSet = new Set(recordedFiles);
  const currentSet = new Set(currentFiles);
  const added = currentFiles.filter((file) => !recordedSet.has(file));
  const removed = recordedFiles.filter((file) => !currentSet.has(file));
  const changed = recordedFiles.filter((file) => currentSet.has(file) && sha256File(path.join(root, file)) !== fingerprints[file]);
  return { added, removed, changed };
}

function describeDrift(added, removed, changed) {
  const describe = (label, list) => (list.length ? `${label}: ${list.join(', ')}` : undefined);
  return [describe('changed', changed), describe('added', added), describe('removed', removed)].filter(Boolean).join('; ');
}

/**
 * Optional, lower-priority sanity check: has the copied `dest` itself been corrupted
 * (externally modified without going through the normal edit workflow) since it was
 * copied? This is NOT the "is this copy stale" guard -- editing `dest` after copying it
 * is the expected normal F5/iterate workflow and is deliberately not flagged here either,
 * by design this only exists to catch accidental external truncation/corruption of the
 * copy itself, not to gate a relaunch. Most callers want
 * `assertOriginalSourceUnchangedSincePrepare` instead.
 */
function assertDestinationCopyIntegrity(dest) {
  const receipt = readCopyReceipt(dest);
  const { added, removed, changed } = compareFingerprints(dest, receipt.fingerprints);
  if (added.length || removed.length || changed.length) {
    throw new Error(`Copy under ${dest} no longer matches its copy-time fingerprints (${describeDrift(added, removed, changed)}).`);
  }
}

/**
 * The actual "fail launch on changed source" guard. Compares the ORIGINAL `--source`
 * directory's CURRENT content against the fingerprints recorded when it was copied into
 * `dest`, and throws, listing exactly which tracked files changed, were added, or were
 * removed in the original, if `source` was edited again after the copy was made. This
 * means the prepared `dest` copy no longer reflects the latest intended source edits and
 * should be recopied before being treated as launch-ready. It deliberately does NOT
 * compare against `dest`'s own current content (see `assertDestinationCopyIntegrity`):
 * editing the copy itself afterward is the expected normal workflow, not drift. Callers
 * (the guarded launch tool) must invoke this before accepting `dest` as prepared, and
 * refuse to launch on a throw. It never writes anything and never contacts VS Code/
 * dotnet/func.
 */
function assertOriginalSourceUnchangedSincePrepare(dest) {
  const receipt = readCopyReceipt(dest);
  if (!fs.existsSync(receipt.source) || !fs.statSync(receipt.source).isDirectory()) {
    throw new Error(`Original --source recorded in ${dest}'s receipt no longer exists or is not a directory: ${receipt.source}`);
  }
  const { added, removed, changed } = compareFingerprints(receipt.source, receipt.fingerprints);
  if (added.length || removed.length || changed.length) {
    throw new Error(
      `Original source ${receipt.source} was edited after it was copied to ${dest} (${describeDrift(added, removed, changed)}); recopy before relaunching.`
    );
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const receipt = copyCandidateWorkspace({ source: args.source, dest: args.dest });
  console.log(JSON.stringify(receipt, null, 2));
  return receipt;
}

module.exports = {
  parseArgs,
  assertCopyableSource,
  assertNewDestination,
  copyCandidateWorkspace,
  assertDestinationCopyIntegrity,
  assertOriginalSourceUnchangedSincePrepare,
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
