#!/usr/bin/env node
// Guarded, generic replacement for the private manual "prepare an edited candidate
// workspace, then reopen VS Code against it" step. Composes the existing-but-separate
// building blocks below rather than reimplementing any of them:
//   1. copy-candidate-workspace.js: copyCandidateWorkspace (fresh copy) and
//      assertOriginalSourceUnchangedSincePrepare (refuses a stale copy).
//   2. retarget-candidate-workspace.js: readCandidateFacts + retargetCodefulProject
//      (rewrites the copied project's .csproj/nuget.config to the new candidate; NOT
//      automatic, see that script's header for the code evidence).
//   3. detect-active-candidate-profile.js: assertNoActiveProfile (read-only refusal if a
//      process already owns the target --user-data-dir).
//   4. run-candidate-e2e.js: isolatedEnv (the sealed environment builder) and `settings`
//      (the VS Code user settings.json the harness writes). Reused, not reimplemented, so
//      a manual launch gets exactly the same sandboxing guarantees as the automated E2E
//      harness: real HOME/APPDATA/TEMP/NUGET_PACKAGES/DOTNET_* are never touched, and only
//      the explicit --node/--dotnet/--func binaries are on PATH. An earlier version of
//      this script instead overlaid the two candidate-selection environment variables onto
//      the developer's real ambient process.env -- that risked writing into the real shared
//      NuGet/dotnet/VS Code caches and was corrected to reuse isolatedEnv/createRoot
//      instead, per explicit parent direction.
//
// This script never creates the sealed --root itself (it does not call createRoot): a
// --root must already have been installed by run-candidate-e2e.js (or an equivalent future
// install step) -- i.e. it must already contain the exact sealed directory layout
// createRoot produces. assertSealedRoot below verifies that layout (and, if the root was
// already used once, that its receipt.json references the same --manifest) and refuses
// with a pointer to the install step rather than silently fabricating a partial root.
//
// Unlike the fully-automated harness, this is an interactive manual relaunch: it removes
// the two environment markers that are consumed only by the Mocha candidate test suite
// (LA_CANDIDATE_TEST_ROOT/LA_CANDIDATE_TEST_TIMEOUT; see src/test/candidate/suite.js and
// bootstrap.js, the only readers), and it sets LOGICAPPS_LOCAL_CANDIDATE_MANUAL=true (the
// real, pre-existing product flag read by isLocalCandidateManualMode() in
// app/utils/localCandidateRuntime.ts and consumed by getAzureConnectorDetailsForLocalProject
// in app/commands/azureConnectors/azureConnectorDetails.ts) so that Azure connector auth,
// which an active local candidate otherwise disables unconditionally, behaves like a real
// signed-in session. It also writes user-data/User/settings.json without
// azureLogicAppsStandard.silentAuth (the harness's `settings()` sets this to `true`, which
// is the actual auth-suppression setting read by getAuthorizationToken.ts) so the real
// "wants to sign in" flow is not silently bypassed for a manual session.
//
// `prepareCandidateWorkspace` is pure file-system I/O: it never spawns a process.
// `launchCandidateWorkspace` additionally validates the sealed root, refuses an
// already-owned profile, builds the sandboxed environment, and then spawns the user's own
// VS Code binary against the prepared workspace; `spawnImpl`/`assertNoActiveProfileImpl`
// are injectable so tests can assert the exact argv/env without starting a real editor or
// enumerating real processes. This script itself is never invoked by this agent/session --
// it is written for the user (or a future authorized step) to run.
const fs = require('node:fs');
const path = require('node:path');
const { copyCandidateWorkspace, assertOriginalSourceUnchangedSincePrepare } = require('./copy-candidate-workspace');
const { readCandidateFacts, retargetCodefulProject } = require('./retarget-candidate-workspace');
const { assertNoActiveProfile } = require('./detect-active-candidate-profile');
const { isolatedEnv, settings: harnessSettings } = require('./run-candidate-e2e');

// Must match run-candidate-e2e.js's createRoot exactly: these are the directories a sealed
// root is required to already have before this launcher will reuse it.
const sealedRootDirectories = [
  'logs',
  'home',
  'temp',
  'appdata',
  'localappdata',
  'programdata',
  'user-data/User',
  'extensions',
  'nuget/packages',
  'nuget/feed',
];

/**
 * Refuse (read-only) to treat `root` as an installed candidate unless it already has the
 * exact sealed directory layout run-candidate-e2e.js's createRoot produces, and -- if it
 * already has a receipt.json from a prior run -- unless that receipt's manifestPath matches
 * the given `manifestPath`. Never creates, repairs, or deletes anything under `root`.
 */
function assertSealedRoot(root, manifestPath) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(
      `--root does not exist: ${root}. This tool never creates a candidate root itself; it must already be installed, ` +
        `e.g. "node run-candidate-e2e.js --manifest ${manifestPath} --root ${root} --code <code> --dotnet <dotnet> ` +
        '--func <func> --node <node> --extension <extension> --scope activation" (see run-candidate-e2e.md). Run that ' +
        'install step once, then retry this launcher against the same --root.'
    );
  }
  const missing = sealedRootDirectories.filter((dir) => !fs.existsSync(path.join(root, dir)));
  if (missing.length) {
    throw new Error(
      `--root ${root} is missing expected sealed director${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}. It does ` +
        "not look like a root produced by run-candidate-e2e.js's createRoot; refusing to treat a partial or mismatched " +
        'directory as an installed candidate. Re-run the install step against a fresh --root.'
    );
  }
  const receiptPath = path.join(root, 'receipt.json');
  if (fs.existsSync(receiptPath)) {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.manifestPath && path.resolve(receipt.manifestPath) !== path.resolve(manifestPath)) {
      throw new Error(
        `--root ${root} was installed against a different manifest (${receipt.manifestPath}) than the one given here ` +
          `(${manifestPath}); refusing to reuse a sealed root across different candidates.`
      );
    }
  }
}

function parseArgs(argv) {
  const allowed = new Set(['source', 'dest', 'manifest', 'root', 'node', 'dotnet', 'func', 'nuget-source', 'code']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] ? argv[i].replace(/^--/, '') : undefined;
    if (!argv[i] || !argv[i].startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) {
      throw new Error(`Unknown, duplicate, or missing argument: ${argv[i]}`);
    }
    args[key] = argv[i + 1];
  }
  for (const key of ['source', 'dest', 'manifest', 'root', 'node', 'dotnet', 'func']) {
    if (!args[key]) {
      throw new Error(`--${key} is required.`);
    }
  }
  for (const key of allowed) {
    if (args[key] && !path.isAbsolute(args[key])) {
      throw new Error(`--${key} must be an absolute path.`);
    }
  }
  args.code ||= 'code';
  return args;
}

/**
 * Pure file-system prepare step: fresh-copy `source` into `dest` (refusing to overwrite),
 * verify the original `source` was not edited again after an earlier copy, and retarget the
 * copy's .csproj/nuget.config to the candidate described by `manifest`, relative to the
 * sealed `root`'s own LOGICAPPS_LOCAL_CANDIDATE_ROOT location (`root/candidate`). Safe to
 * call repeatedly against the same freshly copied `dest` -- the copy step only runs once,
 * iterated edits to `dest` are preserved, and retargeting is a no-op if already current.
 */
function prepareCandidateWorkspace({ source, dest, manifest, root }) {
  if (!fs.existsSync(dest)) {
    copyCandidateWorkspace({ source, dest });
  }
  assertOriginalSourceUnchangedSincePrepare(dest);
  const candidate = readCandidateFacts(manifest, path.join(root, 'candidate'));
  const retarget = retargetCodefulProject(dest, candidate);
  return { dest, candidate, retarget };
}

/**
 * The harness's `settings()` is written for the fully-automated, auth-suppressed E2E
 * harness (azureLogicAppsStandard.silentAuth: true). A manual interactive session must not
 * silently suppress the real "wants to sign in" flow, so that one setting is removed here
 * (leaving getAuthorizationToken.ts's own `false` default) while every other isolation
 * setting (telemetry/update/extension-autoupdate off, tool binary paths, etc.) is kept.
 */
function manualSettings(root, args) {
  const value = harnessSettings(root, args);
  delete value['azureLogicAppsStandard.silentAuth'];
  return value;
}

/**
 * Guarded launch: verifies --root is an already-installed sealed candidate root matching
 * --manifest, refuses (read-only) if --user-data-dir already has an owning process, builds
 * the sandboxed environment via isolatedEnv (stripping the two Mocha-only test markers and
 * adding LOGICAPPS_LOCAL_CANDIDATE_MANUAL=true), writes a manual (non-auth-suppressed)
 * settings.json, then spawns the given VS Code binary against the prepared --dest,
 * detached so this tool does not wait for or own the interactive editor's lifetime.
 * Returns the spawned child's pid; never kills/waits on it.
 */
function launchCandidateWorkspace(
  { dest, manifest, root, node, dotnet, func, nugetSource, code },
  { spawnImpl = require('node:child_process').spawn, assertNoActiveProfileImpl = assertNoActiveProfile } = {}
) {
  if (!fs.existsSync(dest)) {
    throw new Error(`--dest has not been prepared yet (does not exist): ${dest}. Call prepareCandidateWorkspace first.`);
  }
  assertSealedRoot(root, manifest);
  const userDataDir = path.join(root, 'user-data');
  const extensionsDir = path.join(root, 'extensions');
  assertNoActiveProfileImpl(userDataDir);

  const envelope = { manifest, node, dotnet, func, 'nuget-source': nugetSource, 'timeout-ms': 1800000 };
  const env = isolatedEnv(root, envelope);
  // Mocha-candidate-suite-only markers (src/test/candidate/suite.js, bootstrap.js); a
  // manual interactive launch is not that harness and must not carry them.
  delete env.LA_CANDIDATE_TEST_ROOT;
  delete env.LA_CANDIDATE_TEST_TIMEOUT;
  // Re-enable real Azure connector auth for this manual profile: by default, any active
  // local candidate disables connector auth entirely (getAzureConnectorDetailsForLocalProject).
  env.LOGICAPPS_LOCAL_CANDIDATE_MANUAL = 'true';

  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), `${JSON.stringify(manualSettings(root, envelope), null, 2)}\n`);

  const argv = [
    '--new-window',
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--skip-welcome',
    '--skip-release-notes',
    dest,
  ];
  const child = spawnImpl(code, argv, { env, detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid, argv, userDataDir, extensionsDir };
}

function main(argv) {
  const args = parseArgs(argv);
  assertSealedRoot(args.root, args.manifest);
  const prepared = prepareCandidateWorkspace({ source: args.source, dest: args.dest, manifest: args.manifest, root: args.root });
  const launched = launchCandidateWorkspace({
    dest: args.dest,
    manifest: args.manifest,
    root: args.root,
    node: args.node,
    dotnet: args.dotnet,
    func: args.func,
    nugetSource: args['nuget-source'],
    code: args.code,
  });
  console.log(JSON.stringify({ prepared, launched }, null, 2));
  return { prepared, launched };
}

module.exports = {
  parseArgs,
  assertSealedRoot,
  manualSettings,
  prepareCandidateWorkspace,
  launchCandidateWorkspace,
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
