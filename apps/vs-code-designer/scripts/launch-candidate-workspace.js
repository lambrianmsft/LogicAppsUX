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
//
// `prepareCandidateWorkspace` performs steps 1-2 and is pure file-system I/O: it never
// spawns a process. `launchCandidateWorkspace` additionally performs step 3 and then
// spawns the user's own VS Code binary against the prepared workspace; its `spawnImpl` is
// injectable so tests can assert the exact argv/env without starting a real editor. This
// script itself is never invoked by this agent/session -- it is written for the user (or
// a future authorized step) to run.
//
// Unlike run-candidate-e2e.js's isolatedEnv, this does NOT fabricate a brand-new sandboxed
// HOME/dotnet/NuGet environment: the scenario here is an interactive manual relaunch
// against the developer's real VS Code install and real machine environment, only
// overlaying the two candidate-selection environment variables the product already reads
// (LOGICAPPS_LOCAL_CANDIDATE_MANIFEST/ROOT). It intentionally does not reuse createRoot/
// isolatedEnv, which are scoped to the fully-sandboxed automated E2E harness.
const fs = require('node:fs');
const path = require('node:path');
const { copyCandidateWorkspace, assertOriginalSourceUnchangedSincePrepare } = require('./copy-candidate-workspace');
const { readCandidateFacts, retargetCodefulProject } = require('./retarget-candidate-workspace');
const { assertNoActiveProfile } = require('./detect-active-candidate-profile');

function parseArgs(argv) {
  const allowed = new Set(['source', 'dest', 'candidate-manifest', 'candidate-root', 'user-data-dir', 'extensions-dir', 'code']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] ? argv[i].replace(/^--/, '') : undefined;
    if (!argv[i] || !argv[i].startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) {
      throw new Error(`Unknown, duplicate, or missing argument: ${argv[i]}`);
    }
    args[key] = argv[i + 1];
  }
  for (const key of ['source', 'dest', 'candidate-manifest', 'candidate-root']) {
    if (!args[key]) {
      throw new Error(`--${key} is required.`);
    }
  }
  for (const key of allowed) {
    if (args[key] && !path.isAbsolute(args[key])) {
      throw new Error(`--${key} must be an absolute path.`);
    }
  }
  args['user-data-dir'] ||= path.join(args['candidate-root'], 'user-data');
  args['extensions-dir'] ||= path.join(args['candidate-root'], 'extensions');
  args.code ||= 'code';
  return args;
}

/**
 * Pure file-system prepare step: fresh-copy `source` into `dest` (refusing to overwrite),
 * verify the original `source` was not edited again after an earlier copy, and retarget
 * the copy's .csproj/nuget.config to the given candidate. Safe to call repeatedly with
 * different candidates against the same freshly copied `dest` (retargeting is a no-op if
 * already current; the copy step itself only runs once per `dest`).
 *
 * Does not copy if `dest` already exists; call `assertOriginalSourceUnchangedSincePrepare`
 * directly first if you only want to validate an existing prepared `dest` without copying.
 */
function prepareCandidateWorkspace({ source, dest, candidateManifest, candidateRoot }) {
  if (!fs.existsSync(dest)) {
    copyCandidateWorkspace({ source, dest });
  }
  assertOriginalSourceUnchangedSincePrepare(dest);
  const candidate = readCandidateFacts(candidateManifest, candidateRoot);
  const retarget = retargetCodefulProject(dest, candidate);
  return { dest, candidate, retarget };
}

/**
 * Guarded launch: refuses (read-only) if --user-data-dir already has an owning process,
 * then spawns the given VS Code binary against the prepared --dest with the candidate
 * environment variables set, detached so this tool does not wait for or own the
 * interactive editor's lifetime. Returns the spawned child's pid; never kills/waits on it.
 */
function launchCandidateWorkspace(
  { dest, candidateManifest, candidateRoot, userDataDir, extensionsDir, code },
  { spawnImpl = require('node:child_process').spawn, assertNoActiveProfileImpl = assertNoActiveProfile } = {}
) {
  if (!fs.existsSync(dest)) {
    throw new Error(`--dest has not been prepared yet (does not exist): ${dest}. Call prepareCandidateWorkspace first.`);
  }
  assertNoActiveProfileImpl(userDataDir);
  const env = {
    ...process.env,
    LOGICAPPS_LOCAL_CANDIDATE_MANIFEST: candidateManifest,
    LOGICAPPS_LOCAL_CANDIDATE_ROOT: candidateRoot,
  };
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
  const prepared = prepareCandidateWorkspace({
    source: args.source,
    dest: args.dest,
    candidateManifest: args['candidate-manifest'],
    candidateRoot: args['candidate-root'],
  });
  const launched = launchCandidateWorkspace({
    dest: args.dest,
    candidateManifest: args['candidate-manifest'],
    candidateRoot: args['candidate-root'],
    userDataDir: args['user-data-dir'],
    extensionsDir: args['extensions-dir'],
    code: args.code,
  });
  console.log(JSON.stringify({ prepared, launched }, null, 2));
  return { prepared, launched };
}

module.exports = {
  parseArgs,
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
