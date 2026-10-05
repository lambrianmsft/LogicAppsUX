const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseArgs, prepareCandidateWorkspace, launchCandidateWorkspace } = require('../../../scripts/launch-candidate-workspace');

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

function makeCandidateManifest(root, version) {
  const manifestPath = path.join(root, 'candidate.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, sdk: { packageId: 'Microsoft.Azure.Workflows.Sdk', version } }));
  return manifestPath;
}

test('parseArgs requires the four candidate-selection arguments and defaults the rest', () => {
  const root = path.resolve('/root');
  assert.throws(() => parseArgs([]), /--source is required/);
  const args = parseArgs([
    '--source',
    path.join(root, 's'),
    '--dest',
    path.join(root, 'd'),
    '--candidate-manifest',
    path.join(root, 'm.json'),
    '--candidate-root',
    path.join(root, 'c'),
  ]);
  assert.equal(args.code, 'code');
  assert.equal(args['user-data-dir'], path.join(root, 'c', 'user-data'));
  assert.equal(args['extensions-dir'], path.join(root, 'c', 'extensions'));
});

test('prepareCandidateWorkspace copies a fresh source, then retargets the copy to the given candidate', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const candidateRoot = path.join(root, 'new-candidate-root');
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');

  const result = prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot });

  assert.equal(result.retarget.csproj.changed, true);
  assert.equal(result.retarget.csproj.newVersion, '1.0.0-e2e.new1');
  const csproj = fs.readFileSync(path.join(dest, 'MyLogicApp.csproj'), 'utf8');
  assert.match(csproj, /Version="1\.0\.0-e2e\.new1"/);
});

test('prepareCandidateWorkspace does not recopy an already-prepared dest, but still re-validates and retargets it', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const candidateRoot = path.join(root, 'new-candidate-root');
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot });

  // Edit the prepared copy (expected iterate workflow) -- must survive being re-prepared.
  fs.writeFileSync(path.join(dest, 'Added.cs'), '// iterated edit');
  const second = prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot });
  assert.equal(second.retarget.csproj.changed, false); // already retargeted; no-op the second time
  assert.ok(fs.existsSync(path.join(dest, 'Added.cs')));
});

test('prepareCandidateWorkspace refuses when the original source was edited again after the copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const candidateRoot = path.join(root, 'new-candidate-root');
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot });

  fs.writeFileSync(path.join(source, 'host.json'), '{"edited": true}');
  assert.throws(
    () => prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot }),
    /was edited after it was copied/
  );
});

test('launchCandidateWorkspace refuses to spawn when an existing process already owns --user-data-dir', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const candidateRoot = path.join(root, 'new-candidate-root');
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot });

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
        {
          dest,
          candidateManifest: manifestPath,
          candidateRoot,
          userDataDir: path.join(candidateRoot, 'user-data'),
          extensionsDir: path.join(candidateRoot, 'extensions'),
          code: 'code',
        },
        { spawnImpl, assertNoActiveProfileImpl }
      ),
    /already owns this profile/
  );
  assert.equal(spawned, false);
});

test('launchCandidateWorkspace spawns the given code binary, detached, with candidate env vars and no --wait', (t) => {
  const root = sandbox(t);
  const source = makeProject(root);
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const candidateRoot = path.join(root, 'new-candidate-root');
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  prepareCandidateWorkspace({ source, dest, candidateManifest: manifestPath, candidateRoot });

  let capturedCommand;
  let capturedArgv;
  let capturedOptions;
  let unrefCalled = false;
  const spawnImpl = (command, argv, options) => {
    capturedCommand = command;
    capturedArgv = argv;
    capturedOptions = options;
    return { pid: 4242, unref: () => (unrefCalled = true) };
  };
  const userDataDir = path.join(candidateRoot, 'user-data');
  const extensionsDir = path.join(candidateRoot, 'extensions');
  const result = launchCandidateWorkspace(
    { dest, candidateManifest: manifestPath, candidateRoot, userDataDir, extensionsDir, code: 'code' },
    { spawnImpl, assertNoActiveProfileImpl: () => {} }
  );

  assert.equal(result.pid, 4242);
  assert.equal(capturedCommand, 'code');
  assert.deepEqual(capturedArgv, [
    '--new-window',
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--skip-welcome',
    '--skip-release-notes',
    dest,
  ]);
  assert.equal(capturedOptions.detached, true);
  assert.equal(capturedOptions.env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST, manifestPath);
  assert.equal(capturedOptions.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT, candidateRoot);
  assert.ok(unrefCalled);
});

test('launchCandidateWorkspace refuses to launch against an unprepared --dest', (t) => {
  const root = sandbox(t);
  const candidateRoot = path.join(root, 'new-candidate-root');
  const manifestPath = makeCandidateManifest(root, '1.0.0-e2e.new1');
  assert.throws(
    () =>
      launchCandidateWorkspace(
        {
          dest: path.join(root, 'never-prepared'),
          candidateManifest: manifestPath,
          candidateRoot,
          userDataDir: path.join(candidateRoot, 'user-data'),
          extensionsDir: path.join(candidateRoot, 'extensions'),
          code: 'code',
        },
        { spawnImpl: () => ({ pid: 1, unref() {} }), assertNoActiveProfileImpl: () => {} }
      ),
    /has not been prepared yet/
  );
});
