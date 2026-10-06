const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  parseArgs,
  assertSealedRoot,
  manualSettings,
  prepareCandidateWorkspace,
  launchCandidateWorkspace,
  main,
} = require('../../../scripts/launch-candidate-workspace');
const { createRoot } = require('../../../scripts/run-candidate-e2e');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.launch-workspace-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeProject(root, { version = '1.0.0-old', lspDirectoryPath = path.join(root, 'old-candidate', 'dependencies', 'x') } = {}) {
  const projectDir = path.join(root, 'LogicApp');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'host.json'), '{}');
  fs.writeFileSync(
    path.join(projectDir, 'MyLogicApp.csproj'),
    `<Project><ItemGroup><PackageReference Include="Microsoft.Azure.Workflows.Sdk" Version="${version}"/></ItemGroup></Project>\n`
  );
  fs.writeFileSync(
    path.join(projectDir, 'nuget.config'),
    `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n    <packageSources>\n        <add key="current" value="${lspDirectoryPath}" />\n    </packageSources>\n</configuration>\n`
  );
  return projectDir;
}

function makeCandidateManifest(root, version, name = 'candidate.json') {
  const manifestPath = path.join(root, name);
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, sdk: { packageId: 'Microsoft.Azure.Workflows.Sdk', version } }));
  return manifestPath;
}

/** Build a properly sealed root (same layout createRoot produces), optionally with a receipt.json. */
function makeSealedRoot(parent, { name = 'sealed-root', manifestPath } = {}) {
  const root = path.join(parent, name);
  createRoot(root);
  if (manifestPath) {
    fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify({ manifestPath }));
  }
  return root;
}

function toolPaths(root) {
  const bin = path.join(root, 'tools');
  fs.mkdirSync(bin, { recursive: true });
  const node = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const dotnet = path.join(bin, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  const func = path.join(bin, process.platform === 'win32' ? 'func.exe' : 'func');
  for (const file of [node, dotnet, func]) fs.writeFileSync(file, '');
  return { node, dotnet, func };
}

test('parseArgs requires the six candidate-launch arguments and defaults --code', () => {
  const root = path.resolve('/root');
  assert.throws(() => parseArgs([]), /--source is required/);
  const args = parseArgs([
    '--source',
    path.join(root, 's'),
    '--dest',
    path.join(root, 'd'),
    '--manifest',
    path.join(root, 'm.json'),
    '--root',
    path.join(root, 'r'),
    '--node',
    path.join(root, 'node.exe'),
    '--dotnet',
    path.join(root, 'dotnet.exe'),
    '--func',
    path.join(root, 'func.exe'),
  ]);
  assert.equal(args.code, 'code');
});

test('parseArgs rejects a relative path for any path argument', () => {
  assert.throws(
    () =>
      parseArgs([
        '--source',
        'relative/path',
        '--dest',
        path.resolve('/d'),
        '--manifest',
        path.resolve('/m.json'),
        '--root',
        path.resolve('/r'),
        '--node',
        path.resolve('/n'),
        '--dotnet',
        path.resolve('/dn'),
        '--func',
        path.resolve('/f'),
      ]),
    /--source must be an absolute path/
  );
});

test('assertSealedRoot refuses a --root that does not exist, pointing at the install step', (t) => {
  const root = sandbox(t);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  assert.throws(() => assertSealedRoot(path.join(root, 'never-installed'), manifestPath), /never creates a candidate root itself/);
});

test('assertSealedRoot refuses a partial/mismatched --root missing the sealed directory layout', (t) => {
  const root = sandbox(t);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  const partial = path.join(root, 'partial-root');
  fs.mkdirSync(partial, { recursive: true }); // exists, but none of createRoot's subdirectories
  assert.throws(() => assertSealedRoot(partial, manifestPath), /missing expected sealed director/);
});

test('assertSealedRoot refuses a sealed root whose receipt.json references a different manifest', (t) => {
  const root = sandbox(t);
  const manifestA = makeCandidateManifest(root, '1.0.0-e2e.new1', 'a.json');
  const manifestB = makeCandidateManifest(root, '1.0.0-e2e.new2', 'b.json');
  const sealed = makeSealedRoot(root, { manifestPath: manifestA });
  assert.throws(() => assertSealedRoot(sealed, manifestB), /was installed against a different manifest/);
});

test('assertSealedRoot accepts a properly sealed root with no receipt, or with a matching receipt', (t) => {
  const root = sandbox(t);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  const freshRoot = makeSealedRoot(root, { name: 'fresh' });
  assert.doesNotThrow(() => assertSealedRoot(freshRoot, manifestPath));
  const matchingRoot = makeSealedRoot(root, { name: 'matching', manifestPath });
  assert.doesNotThrow(() => assertSealedRoot(matchingRoot, manifestPath));
});

test('prepareCandidateWorkspace copies a fresh source, then retargets the copy against root/candidate', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const sealedRoot = makeSealedRoot(root);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');

  const result = prepareCandidateWorkspace({ source, dest, manifest: manifestPath, root: sealedRoot });

  assert.equal(result.retarget.csproj.changed, true);
  assert.equal(result.retarget.csproj.newVersion, '1.0.0-e2e.new1');
  assert.ok(result.candidate.lspDirectoryPath.startsWith(path.join(sealedRoot, 'candidate')));
  const csproj = fs.readFileSync(path.join(dest, 'MyLogicApp.csproj'), 'utf8');
  assert.match(csproj, /Version="1\.0\.0-e2e\.new1"/);
});

test('prepareCandidateWorkspace does not recopy an already-prepared dest, preserving iterative edits', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const sealedRoot = makeSealedRoot(root);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  prepareCandidateWorkspace({ source, dest, manifest: manifestPath, root: sealedRoot });

  fs.writeFileSync(path.join(dest, 'Added.cs'), '// iterated edit');
  const second = prepareCandidateWorkspace({ source, dest, manifest: manifestPath, root: sealedRoot });
  assert.equal(second.retarget.csproj.changed, false); // already retargeted; no-op the second time
  assert.ok(fs.existsSync(path.join(dest, 'Added.cs')));
});

test('prepareCandidateWorkspace refuses when the original source was edited again after the copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const sealedRoot = makeSealedRoot(root);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  prepareCandidateWorkspace({ source, dest, manifest: manifestPath, root: sealedRoot });

  fs.writeFileSync(path.join(source, 'host.json'), '{"edited": true}');
  assert.throws(
    () => prepareCandidateWorkspace({ source, dest, manifest: manifestPath, root: sealedRoot }),
    /was edited after it was copied/
  );
});

test('manualSettings omits silentAuth (so real sign-in is not suppressed) while keeping tool binary paths', (t) => {
  const root = sandbox(t);
  const sealedRoot = makeSealedRoot(root);
  const tools = toolPaths(root);
  const value = manualSettings(sealedRoot, { node: tools.node, dotnet: tools.dotnet, func: tools.func });
  assert.equal(Object.hasOwn(value, 'azureLogicAppsStandard.silentAuth'), false);
  assert.equal(value['azureLogicAppsStandard.dotnetBinaryPath'], tools.dotnet);
  assert.equal(value['azureLogicAppsStandard.funcCoreToolsBinaryPath'], tools.func);
  assert.equal(value['azureLogicAppsStandard.nodeJsBinaryPath'], tools.node);
  assert.equal(value['telemetry.telemetryLevel'], 'off');
});

function prepareForLaunch(t) {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const sealedRoot = makeSealedRoot(root);
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  const tools = toolPaths(root);
  prepareCandidateWorkspace({ source, dest, manifest: manifestPath, root: sealedRoot });
  return { root, source, dest, sealedRoot, manifestPath, tools };
}

test('launchCandidateWorkspace refuses to launch against an unprepared --dest', (t) => {
  const { sealedRoot, manifestPath, tools } = prepareForLaunch(t);
  assert.throws(
    () =>
      launchCandidateWorkspace(
        { dest: path.join(sealedRoot, 'never-prepared'), manifest: manifestPath, root: sealedRoot, ...tools, code: 'code' },
        { spawnImpl: () => ({ pid: 1, unref() {} }), assertNoActiveProfileImpl: () => {} }
      ),
    /has not been prepared yet/
  );
});

test('launchCandidateWorkspace refuses a --root that is not an installed sealed root', (t) => {
  const { dest, manifestPath, tools, root } = prepareForLaunch(t);
  const unsealed = path.join(root, 'not-sealed');
  fs.mkdirSync(unsealed, { recursive: true });
  assert.throws(
    () =>
      launchCandidateWorkspace(
        { dest, manifest: manifestPath, root: unsealed, ...tools, code: 'code' },
        { spawnImpl: () => ({ pid: 1, unref() {} }), assertNoActiveProfileImpl: () => {} }
      ),
    /missing expected sealed director/
  );
});

test('launchCandidateWorkspace refuses to spawn when an existing process already owns --user-data-dir', (t) => {
  const { dest, sealedRoot, manifestPath, tools } = prepareForLaunch(t);
  let spawned = false;
  const spawnImpl = () => {
    spawned = true;
    return { pid: 1, unref() {} };
  };
  const assertNoActiveProfileImpl = () => {
    throw new Error('an existing process already owns this profile');
  };
  assert.throws(
    () =>
      launchCandidateWorkspace(
        { dest, manifest: manifestPath, root: sealedRoot, ...tools, code: 'code' },
        { spawnImpl, assertNoActiveProfileImpl }
      ),
    /already owns this profile/
  );
  assert.equal(spawned, false);
});

test('launchCandidateWorkspace spawns with a fully isolated environment: no ambient HOME/TEMP/NUGET_PACKAGES leak, no test-only markers, manual auth flag set', (t) => {
  const { dest, sealedRoot, manifestPath, tools } = prepareForLaunch(t);

  // Prove the launch environment is NOT the real ambient process.env: poison a probe
  // variable in the real process.env and confirm it never reaches the spawned child.
  process.env.LA_LAUNCH_TEST_PROBE = 'should-not-leak';
  t.after(() => {
    delete process.env.LA_LAUNCH_TEST_PROBE;
  });

  let capturedOptions;
  let capturedArgv;
  const spawnImpl = (command, argv, options) => {
    capturedArgv = argv;
    capturedOptions = options;
    return { pid: 4242, unref() {} };
  };

  const result = launchCandidateWorkspace(
    { dest, manifest: manifestPath, root: sealedRoot, ...tools, code: 'code' },
    { spawnImpl, assertNoActiveProfileImpl: () => {} }
  );

  assert.equal(result.pid, 4242);
  assert.equal(result.userDataDir, path.join(sealedRoot, 'user-data'));
  assert.equal(result.extensionsDir, path.join(sealedRoot, 'extensions'));
  assert.deepEqual(capturedArgv, [
    '--new-window',
    '--user-data-dir',
    result.userDataDir,
    '--extensions-dir',
    result.extensionsDir,
    '--skip-welcome',
    '--skip-release-notes',
    dest,
  ]);

  const env = capturedOptions.env;
  assert.equal(env.LA_LAUNCH_TEST_PROBE, undefined); // ambient env never inherited wholesale
  assert.equal(env.HOME, path.join(sealedRoot, 'home'));
  assert.equal(env.TEMP, path.join(sealedRoot, 'temp'));
  assert.equal(env.NUGET_PACKAGES, path.join(sealedRoot, 'nuget', 'packages'));
  assert.equal(env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST, manifestPath);
  assert.equal(env.LOGICAPPS_LOCAL_CANDIDATE_ROOT, path.join(sealedRoot, 'candidate'));
  // Mocha-only markers must be stripped for a manual launch.
  assert.equal(Object.hasOwn(env, 'LA_CANDIDATE_TEST_ROOT'), false);
  assert.equal(Object.hasOwn(env, 'LA_CANDIDATE_TEST_TIMEOUT'), false);
  // Real product auth-suppression toggle: re-enabled for the manual profile.
  assert.equal(env.LOGICAPPS_LOCAL_CANDIDATE_MANUAL, 'true');
  // PATH is built only from the given tool binaries (+ required Windows system dirs), never
  // the real ambient PATH.
  assert.ok(env.PATH.includes(path.dirname(tools.node)));
  assert.ok(env.PATH.includes(path.dirname(tools.dotnet)));
  assert.ok(env.PATH.includes(path.dirname(tools.func)));
  assert.ok(!env.PATH.includes(process.env.PATH || '\u0000impossible\u0000'));

  // The written settings.json is the manual (non-auth-suppressed) profile.
  const settings = JSON.parse(fs.readFileSync(path.join(result.userDataDir, 'User', 'settings.json'), 'utf8'));
  assert.equal(Object.hasOwn(settings, 'azureLogicAppsStandard.silentAuth'), false);
  assert.equal(settings['azureLogicAppsStandard.dotnetBinaryPath'], tools.dotnet);
});

test('main() wires stale-source detection into the real launch path: edits to the original source after prepare block the launch', (t) => {
  const { source, dest, sealedRoot, manifestPath, tools } = prepareForLaunch(t);
  fs.writeFileSync(path.join(source, 'host.json'), '{"edited": true}');
  assert.throws(
    () =>
      main([
        '--source',
        source,
        '--dest',
        dest,
        '--manifest',
        manifestPath,
        '--root',
        sealedRoot,
        '--node',
        tools.node,
        '--dotnet',
        tools.dotnet,
        '--func',
        tools.func,
      ]),
    /was edited after it was copied/
  );
});
