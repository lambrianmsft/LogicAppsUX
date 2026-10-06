const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseArgs,
  assertCopyableSource,
  assertNewDestination,
  copyCandidateWorkspace,
  assertDestinationCopyIntegrity,
  assertOriginalSourceUnchangedSincePrepare,
  main,
} = require('../../../scripts/copy-candidate-workspace');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.copy-workspace-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeProject(root, name = 'LogicApp') {
  const projectDir = path.join(root, name);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'host.json'), '{}');
  fs.writeFileSync(path.join(projectDir, 'local.settings.json'), '{"Values":{}}');
  fs.writeFileSync(path.join(projectDir, 'CandidateWorkflow.cs'), '// edited source');
  fs.mkdirSync(path.join(projectDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'bin', 'stale.dll'), 'stale');
  fs.mkdirSync(path.join(projectDir, 'obj'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'obj', 'stale.json'), '{}');
  return projectDir;
}

test('parseArgs requires both absolute --source and --dest', () => {
  assert.throws(() => parseArgs([]), /required/);
  assert.throws(() => parseArgs(['--source', 'relative/path', '--dest', '/abs']), /absolute/);
  const args = parseArgs(['--source', path.resolve('/a'), '--dest', path.resolve('/b')]);
  assert.equal(args.source, path.resolve('/a'));
  assert.equal(args.dest, path.resolve('/b'));
});

test('parseArgs rejects unknown or duplicate flags', () => {
  assert.throws(() => parseArgs(['--bogus', 'x']), /Unknown/);
  assert.throws(() => parseArgs(['--source', path.resolve('/a'), '--source', path.resolve('/a')]), /Unknown, duplicate/);
});

test('assertCopyableSource rejects a directory with no recognizable project marker', (t) => {
  const root = sandbox(t);
  const empty = path.join(root, 'not-a-project');
  fs.mkdirSync(empty, { recursive: true });
  assert.throws(() => assertCopyableSource(empty), /does not look like a Logic Apps workspace/);
});

test('assertCopyableSource accepts a project with host.json', (t) => {
  const root = sandbox(t);
  const project = makeProject(root);
  assert.doesNotThrow(() => assertCopyableSource(project));
});

test('assertCopyableSource accepts a workspace containing a nested project', (t) => {
  const root = sandbox(t);
  const workspace = path.join(root, 'Workspace');
  fs.mkdirSync(workspace, { recursive: true });
  makeProject(workspace, 'Nested');
  assert.doesNotThrow(() => assertCopyableSource(workspace));
});

test('assertNewDestination refuses an existing destination (overwrite protection only)', (t) => {
  const root = sandbox(t);
  const dest = path.join(root, 'existing');
  fs.mkdirSync(dest, { recursive: true });
  assert.throws(() => assertNewDestination(dest), /already exists; refusing to overwrite or merge/);
});

test('assertNewDestination requires the parent of --dest to exist', (t) => {
  const root = sandbox(t);
  const dest = path.join(root, 'missing-parent', 'dest');
  assert.throws(() => assertNewDestination(dest), /Parent of --dest does not exist/);
});

test('copyCandidateWorkspace preserves edited source and excludes stale build/debug-host output', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  fs.mkdirSync(path.join(source, 'debug-hosts', 'host-abc'), { recursive: true });
  fs.writeFileSync(path.join(source, 'debug-hosts', 'host-abc', 'stale.txt'), 'stale host');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const receipt = copyCandidateWorkspace({ source, dest });

  assert.equal(fs.readFileSync(path.join(dest, 'CandidateWorkflow.cs'), 'utf8'), '// edited source');
  assert.equal(fs.existsSync(path.join(dest, 'bin')), false);
  assert.equal(fs.existsSync(path.join(dest, 'obj')), false);
  assert.equal(fs.existsSync(path.join(dest, 'debug-hosts')), false);
  assert.ok(receipt.filesCopied >= 2);
  assert.ok(receipt.entriesExcluded >= 2);
  const writtenReceipt = JSON.parse(fs.readFileSync(path.join(dest, '.copied-from-candidate-workspace.json'), 'utf8'));
  assert.equal(writtenReceipt.source, source);
  assert.equal(writtenReceipt.dest, dest);
});

test('copyCandidateWorkspace refuses to copy over an existing destination', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'already-there');
  fs.mkdirSync(dest, { recursive: true });
  assert.throws(() => copyCandidateWorkspace({ source, dest }), /already exists/);
});

test('main() prints a receipt for a valid copy and exits cleanly', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const originalLog = console.log;
  let logged = '';
  console.log = (value) => {
    logged = value;
  };
  try {
    const receipt = main(['--source', source, '--dest', dest]);
    assert.equal(receipt.source, source);
    assert.ok(logged.includes('"filesCopied"'));
  } finally {
    console.log = originalLog;
  }
});

test('copyCandidateWorkspace excludes lib/codeful build output and the project-local NuGet cache', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  fs.mkdirSync(path.join(source, 'lib', 'codeful'), { recursive: true });
  fs.writeFileSync(path.join(source, 'lib', 'codeful', 'Generated.g.cs'), '// regenerated on build');
  fs.mkdirSync(path.join(source, '.nuget', 'packages', 'microsoft.azure.workflows.sdk', '1.0.0'), { recursive: true });
  fs.writeFileSync(path.join(source, '.nuget', 'packages', 'microsoft.azure.workflows.sdk', '1.0.0', 'stale.nupkg'), 'stale');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const receipt = copyCandidateWorkspace({ source, dest });

  assert.equal(fs.existsSync(path.join(dest, 'lib', 'codeful')), false);
  assert.equal(fs.existsSync(path.join(dest, '.nuget')), false);
  assert.ok(receipt.excludedNames.includes(path.join('lib', 'codeful')));
  assert.ok(receipt.excludedNames.includes('.nuget'));
});

test('copyCandidateWorkspace preserves authored files that merely share a name/segment with the excluded lib/codeful subtree', (t) => {
  // The exclusion policy must match only the exact generated relative subtree
  // `lib/codeful` (written solely by the CopyToCodefulFolder MSBuild target at the
  // project root), never every directory named `lib` or `codeful` anywhere in the tree.
  // An authored file living under a top-level `lib/` directory that is NOT `lib/codeful`,
  // or under a `codeful`-named directory that is NOT nested directly under a top-level
  // `lib/`, is user source and must survive the copy byte-for-byte.
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  fs.mkdirSync(path.join(source, 'lib', 'codeful'), { recursive: true });
  fs.writeFileSync(path.join(source, 'lib', 'codeful', 'Generated.g.cs'), '// regenerated on build');
  fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(source, 'lib', 'helpers.cs'), '// authored helper, lives directly under lib/');
  fs.mkdirSync(path.join(source, 'workflows', 'codeful'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'workflows', 'codeful', 'stateful.cs'),
    '// authored workflow source, named codeful but not under lib/'
  );
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const receipt = copyCandidateWorkspace({ source, dest });

  // The actual generated subtree is still excluded.
  assert.equal(fs.existsSync(path.join(dest, 'lib', 'codeful')), false);
  // Authored files that merely share a path segment with the excluded name survive exactly.
  assert.equal(fs.readFileSync(path.join(dest, 'lib', 'helpers.cs'), 'utf8'), '// authored helper, lives directly under lib/');
  assert.equal(
    fs.readFileSync(path.join(dest, 'workflows', 'codeful', 'stateful.cs'), 'utf8'),
    '// authored workflow source, named codeful but not under lib/'
  );
  // The same files were fingerprinted (not silently treated as excluded) so later drift
  // detection actually covers them.
  assert.ok(Object.hasOwn(receipt.fingerprints, path.join('lib', 'helpers.cs')));
  assert.ok(Object.hasOwn(receipt.fingerprints, path.join('workflows', 'codeful', 'stateful.cs')));
  assert.ok(!Object.hasOwn(receipt.fingerprints, path.join('lib', 'codeful', 'Generated.g.cs')));
});

test('assertOriginalSourceUnchangedSincePrepare is governed by the same exclusion policy: edits under the excluded subtree are invisible, edits to authored lib/codeful-adjacent files are detected', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  fs.mkdirSync(path.join(source, 'lib', 'codeful'), { recursive: true });
  fs.writeFileSync(path.join(source, 'lib', 'codeful', 'Generated.g.cs'), '// build 1');
  fs.writeFileSync(path.join(source, 'lib', 'helpers.cs'), '// authored v1');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  assert.doesNotThrow(() => assertOriginalSourceUnchangedSincePrepare(dest));

  // Changing only the excluded generated subtree in the original source must not be
  // reported as drift: it was never fingerprinted because it is excluded for both the
  // copy and the fingerprint/drift check, by the same isExcludedRelativePath policy.
  fs.writeFileSync(path.join(source, 'lib', 'codeful', 'Generated.g.cs'), '// build 2, different content');
  assert.doesNotThrow(() => assertOriginalSourceUnchangedSincePrepare(dest));

  // Changing an authored file that merely shares the `lib` segment (but is not the
  // excluded `lib/codeful` subtree) must still be detected as real drift.
  fs.writeFileSync(path.join(source, 'lib', 'helpers.cs'), '// authored v2, edited after copy');
  assert.throws(() => assertOriginalSourceUnchangedSincePrepare(dest), /was edited after it was copied/);
});

test('assertDestinationCopyIntegrity passes immediately after a fresh copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  assert.doesNotThrow(() => assertDestinationCopyIntegrity(dest));
});

test('assertDestinationCopyIntegrity detects external corruption of the copy itself', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  fs.writeFileSync(path.join(dest, 'CandidateWorkflow.cs'), '// corrupted dest content');
  assert.throws(
    () => assertDestinationCopyIntegrity(dest),
    /no longer matches its copy-time fingerprints.*changed: CandidateWorkflow\.cs/s
  );
});

test('assertDestinationCopyIntegrity requires a receipt prepared by copyCandidateWorkspace', (t) => {
  const root = sandbox(t);
  const dest = makeProject(root, 'NotCopied');
  assert.throws(() => assertDestinationCopyIntegrity(dest), /No \.copied-from-candidate-workspace\.json receipt found/);
});

test('assertOriginalSourceUnchangedSincePrepare passes immediately after a fresh copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  assert.doesNotThrow(() => assertOriginalSourceUnchangedSincePrepare(dest));
});

test('assertOriginalSourceUnchangedSincePrepare does NOT flag ordinary edits made to the new dest copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  // This is the expected normal F5/iterate workflow: edit the copy, not the original.
  fs.writeFileSync(path.join(dest, 'CandidateWorkflow.cs'), '// iterated on the new candidate copy');
  fs.writeFileSync(path.join(dest, 'AnotherNewFile.cs'), '// added only to the copy');
  assert.doesNotThrow(() => assertOriginalSourceUnchangedSincePrepare(dest));
});

test('assertOriginalSourceUnchangedSincePrepare detects the original source being edited again after the copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  fs.writeFileSync(path.join(source, 'CandidateWorkflow.cs'), '// edited the original again after it was copied');
  assert.throws(() => assertOriginalSourceUnchangedSincePrepare(dest), /was edited after it was copied.*changed: CandidateWorkflow\.cs/s);
});

test('assertOriginalSourceUnchangedSincePrepare detects a file added to the original source after the copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  fs.writeFileSync(path.join(source, 'NewFile.cs'), '// added to the original after copy');
  assert.throws(() => assertOriginalSourceUnchangedSincePrepare(dest), /added: NewFile\.cs/);
});

test('assertOriginalSourceUnchangedSincePrepare detects a file removed from the original source after the copy', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  fs.rmSync(path.join(source, 'CandidateWorkflow.cs'));
  assert.throws(() => assertOriginalSourceUnchangedSincePrepare(dest), /removed: CandidateWorkflow\.cs/);
});

test('assertOriginalSourceUnchangedSincePrepare requires a receipt prepared by copyCandidateWorkspace', (t) => {
  const root = sandbox(t);
  const dest = makeProject(root, 'NotCopied');
  assert.throws(() => assertOriginalSourceUnchangedSincePrepare(dest), /No \.copied-from-candidate-workspace\.json receipt found/);
});

test('assertOriginalSourceUnchangedSincePrepare requires the original source to still exist', (t) => {
  const root = sandbox(t);
  const source = makeProject(root, 'LogicApp');
  const dest = path.join(root, 'new-candidate', 'LogicApp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyCandidateWorkspace({ source, dest });
  fs.rmSync(source, { recursive: true, force: true });
  assert.throws(() => assertOriginalSourceUnchangedSincePrepare(dest), /no longer exists or is not a directory/);
});
