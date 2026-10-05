const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { replaceWithLocalHttpWorkflow } = require('./fixture');
const {
  parseArgs,
  validateManifest,
  validateWebviewPayload,
  createRoot,
  isolatedEnv,
  installExtensions,
  settings,
  main,
} = require('../../../scripts/run-candidate-e2e');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.runner-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function artifact(root, name) {
  const file = path.join(root, name);
  fs.writeFileSync(file, name);
  return { path: file, version: '1.2.3-preview.4', sha256: crypto.createHash('sha256').update(name).digest('hex') };
}

function webviewFixture(extension) {
  const root = path.join(extension, 'vs-code-react');
  const files = {
    'index.html':
      '<!doctype html><html><head><base href="/"><script type="module" src="./assets/entry.js"></script><link rel="stylesheet" href="./assets/entry.css"></head><body><div id="root"></div></body></html>',
    'assets/entry.js':
      'import { value } from "./shared.js"; const dependencies = ["assets/lazy.css"]; document.getElementById("root").textContent = value; export const load = () => import("./lazy.js");',
    'assets/shared.js': 'export const value = "fixture";',
    'assets/lazy.js': 'export { value } from "./shared.js"; export const icon = new URL("./icon.svg", import.meta.url);',
    'assets/entry.css': '@import "./theme.css"; body { background-image: url("./background.svg"); }',
    'assets/theme.css': '.pattern { background-image: url("./pattern.svg"); }',
    'assets/lazy.css': '.lazy { color: blue; }',
    'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'assets/background.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'assets/pattern.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
  for (const [file, content] of Object.entries(files)) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  return root;
}

function productFixture(extension, manifest) {
  json(path.join(extension, 'package.json'), manifest);
  webviewFixture(extension);
}

test('validates the webview entry, literal lazy imports, Vite preload CSS and transitive static assets', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  const evidence = validateWebviewPayload(extension);
  assert.equal(evidence.root, root);
  assert.equal(evidence.index, path.join(root, 'index.html'));
  assert.equal(evidence.files.length, 10);
  for (const file of ['lazy.js', 'lazy.css', 'theme.css', 'icon.svg', 'background.svg', 'pattern.svg']) {
    assert.ok(evidence.files.includes(path.join('assets', file)), file);
  }
  assert.deepEqual(evidence.externalReferences, []);
  assert.equal(evidence.computedImports, 0);
});

for (const file of [
  'index.html',
  'entry.js',
  'entry.css',
  'shared.js',
  'lazy.js',
  'lazy.css',
  'theme.css',
  'icon.svg',
  'background.svg',
  'pattern.svg',
]) {
  test(`rejects missing webview ${file} before copying any extension`, (t) => {
    const base = sandbox(t);
    const extension = path.join(base, 'product');
    productFixture(extension, { publisher: 'test', name: 'product', version: '1.0.0' });
    fs.unlinkSync(path.join(extension, 'vs-code-react', file === 'index.html' ? file : path.join('assets', file)));
    const root = path.join(base, 'run');
    createRoot(root);
    const records = [];
    assert.throws(() => installExtensions({ root, extension }, records), /Missing or empty webview payload file/);
    assert.deepEqual(records, []);
    assert.deepEqual(fs.readdirSync(path.join(root, 'extensions')), []);
  });
}

test('rejects an empty entry and an HTML-only placeholder', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  fs.writeFileSync(path.join(root, 'assets', 'entry.js'), '');
  assert.throws(() => validateWebviewPayload(extension), /Missing or empty/);
  fs.writeFileSync(path.join(root, 'index.html'), '<html><body>not a built webview</body></html>');
  assert.throws(() => validateWebviewPayload(extension), /local JavaScript and a local stylesheet/);
});

test('rejects traversal, encoded traversal, absolute roots and base overrides', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  const index = path.join(root, 'index.html');
  for (const reference of ['../outside.js', '%2e%2e/outside.js', '/assets/entry.js', 'C:/outside.js', 'assets\\entry.js']) {
    fs.writeFileSync(index, `<script src="${reference}"></script>`);
    assert.throws(() => validateWebviewPayload(extension), /escapes payload root|must be relative/, reference);
  }
  fs.writeFileSync(index, '<base href="./assets/"><script src="entry.js"></script>');
  assert.throws(() => validateWebviewPayload(extension), /base URL overrides/);
});

test('rejects a referenced directory or junction outside the payload', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  const entry = path.join(root, 'assets', 'entry.js');
  fs.unlinkSync(entry);
  fs.mkdirSync(entry);
  assert.throws(() => validateWebviewPayload(extension), /Missing or empty/);
  fs.rmSync(entry, { recursive: true });
  const outside = path.join(extension, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'external.js'), 'export const value = 1;');
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(entry, 'import "../linked/external.js";');
  assert.throws(() => validateWebviewPayload(extension), /Symlink\/junction not allowed/);
});

test('rejects escaping chunk, Vite table, URL constructor and CSS references', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  const entry = path.join(root, 'assets', 'entry.js');
  for (const source of [
    'import "../../outside.js";',
    'export const load = () => import("../../outside.js");',
    'const dependencies = ["assets/../../outside.js"];',
    'const dependencies = ["/assets/shared.js"];',
    'new URL("../../outside.svg", import.meta.url);',
  ]) {
    fs.writeFileSync(entry, source);
    assert.throws(() => validateWebviewPayload(extension), /escapes payload root|must be relative/, source);
  }
  fs.writeFileSync(entry, 'export const value = "fixture";');
  fs.writeFileSync(path.join(root, 'assets', 'entry.css'), 'body { background-image: url("../../outside.svg"); }');
  assert.throws(() => validateWebviewPayload(extension), /escapes payload root/);
});

test('resolves query URLs and in-root parent references while reporting unverified external and computed imports', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  fs.appendFileSync(
    path.join(root, 'assets', 'lazy.js'),
    '\nimport "../assets/shared.js?v=1#part"; import "https://example.invalid/remote.js"; export const dynamic = (name) => import(name);'
  );
  fs.appendFileSync(path.join(root, 'assets', 'entry.css'), '\n.remote { background: url(data:image/png;base64,abc); }');
  const evidence = validateWebviewPayload(extension);
  assert.equal(evidence.files.length, 10);
  assert.equal(evidence.computedImports, 1);
  assert.deepEqual(evidence.externalReferences, ['data:image/png;base64,abc', 'https://example.invalid/remote.js']);
});

test('ignores import-looking JavaScript strings and comments', (t) => {
  const extension = sandbox(t);
  const root = webviewFixture(extension);
  fs.appendFileSync(
    path.join(root, 'assets', 'entry.js'),
    '\n// import "./missing-comment.js";\nconst example = \'import "./missing-example.js";\';\nconst runtimeIconPrefix = "".concat("https://example.invalid", "/assets/icons/");'
  );
  assert.equal(validateWebviewPayload(extension).files.length, 10);
});

for (const scope of ['activation', 'pickup']) {
  test(`${scope} scope records failed webview preflight without launching or copying candidates`, async (t) => {
    const base = sandbox(t);
    const manifest = path.join(base, 'candidate.json');
    json(manifest, {
      schemaVersion: 1,
      bundle: artifact(base, 'bundle.zip'),
      sdk: { ...artifact(base, 'sdk.nupkg'), packageId: 'Microsoft.Azure.Workflows.Sdk' },
    });
    const root = path.join(base, 'run');
    const previousExitCode = process.exitCode;
    try {
      const receipt = await main(['--manifest', manifest, '--root', root, '--extension', path.join(base, 'missing'), '--scope', scope]);
      assert.equal(process.exitCode, 1);
      assert.equal(receipt.status, 'failed');
      assert.equal(receipt.stages.find((stage) => stage.name === 'webview-payload').status, 'failed');
      assert.equal(
        receipt.stages.some((stage) => stage.name === 'local-binaries'),
        false
      );
      assert.deepEqual(fs.readdirSync(path.join(root, 'extensions')), []);
      assert.deepEqual(fs.readdirSync(path.join(root, 'nuget', 'feed')), []);
      assert.equal(fs.existsSync(path.join(root, 'candidate')), false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'receipt.json'), 'utf8')).status, 'failed');
    } finally {
      process.exitCode = previousExitCode;
    }
  });
}

test('requires explicit absolute paths and rejects accidental argument typos', () => {
  const absolute = path.resolve('unused');
  assert.throws(() => parseArgs(['--manifest', 'relative', '--root', absolute]), /absolute/);
  assert.throws(() => parseArgs(['--manifest', absolute, '--root', absolute, '--trust', 'true']), /Unknown/);
  assert.throws(() => parseArgs(['--manifest', absolute, '--root', absolute, '--root', absolute]), /duplicate/);
  assert.throws(() => parseArgs(['--manifest', absolute, '--root', absolute, '--timeout-ms', 'NaN']), /timeout/);
  assert.equal(parseArgs(['--manifest', absolute, '--root', absolute, '--scope', 'activation']).scope, 'activation');
  assert.throws(() => parseArgs(['--manifest', absolute, '--root', absolute, '--scope', 'untrusted-project']), /scope/);
});

test('refuses reuse without modifying existing contents', (t) => {
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, 'preserve.txt'), 'keep');
  assert.throws(() => createRoot(root), /exist/i);
  assert.equal(fs.readFileSync(path.join(root, 'preserve.txt'), 'utf8'), 'keep');
  const child = path.join(root, 'new');
  createRoot(child);
  assert.ok(fs.existsSync(path.join(child, 'user-data/User')));
  assert.equal(fs.existsSync(path.join(child, 'candidate')), false, 'Only the product installer may create candidate root.');
});

test('validates both hashes before allowing executable extension work', (t) => {
  const root = sandbox(t);
  const manifest = {
    schemaVersion: 1,
    bundle: artifact(root, 'bundle.zip'),
    sdk: { ...artifact(root, 'sdk.nupkg'), packageId: 'Microsoft.Azure.Workflows.Sdk' },
  };
  const file = path.join(root, 'candidate.json');
  json(file, manifest);
  assert.deepEqual(validateManifest(file), manifest);
  manifest.bundle.version = '1.192.0.32';
  json(file, manifest);
  assert.equal(validateManifest(file).bundle.version, '1.192.0.32');
  fs.appendFileSync(manifest.bundle.path, 'tampered');
  assert.throws(() => validateManifest(file), /SHA256/);
});

test('isolates caches and drops inherited auth and arbitrary Node options', (t) => {
  const root = sandbox(t);
  const env = isolatedEnv(root, { manifest: path.join(root, 'candidate.json'), node: process.execPath, 'timeout-ms': 30000 });
  assert.equal(env.HOME, path.join(root, 'home'));
  assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.ProgramData, path.join(root, 'programdata'));
  assert.equal(env['ProgramFiles(x86)'], process.env['ProgramFiles(x86)']);
  assert.equal(env.PROCESSOR_ARCHITECTURE, process.env.PROCESSOR_ARCHITECTURE);
  assert.equal(env.NUGET_PACKAGES, path.join(root, 'nuget/packages'));
  assert.equal(env.LOGICAPPS_LOCAL_CANDIDATE_ROOT, path.join(root, 'candidate'));
  if (process.platform === 'win32') {
    assert.ok(env.PATH.split(path.delimiter).includes(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')));
  }
  assert.equal(env.LOGICAPPS_LOCAL_CANDIDATE_NUGET_SOURCE, undefined);
  const offlineSource = path.join(root, 'offline');
  assert.equal(
    isolatedEnv(root, { manifest: path.join(root, 'candidate.json'), 'nuget-source': offlineSource })
      .LOGICAPPS_LOCAL_CANDIDATE_NUGET_SOURCE,
    offlineSource
  );
  assert.notEqual(env.HOME, env.LOGICAPPS_LOCAL_CANDIDATE_ROOT);
  assert.equal(env.VSCODE_PORTABLE, undefined, 'Portable mode must not override the explicit private VS Code CLI directories.');
  for (const key of [
    'AZURE_CLIENT_SECRET',
    'GITHUB_TOKEN',
    'NODE_OPTIONS',
    'SSH_AUTH_SOCK',
    'NUGET_CREDENTIALPROVIDERS_PATH',
    'LOGICAPPS_LOCAL_CANDIDATE_MANUAL',
  ]) {
    assert.equal(env[key], undefined);
  }
  assert.equal(settings(root, {})['security.workspace.trust.enabled'], undefined);
  assert.equal(settings(root, {})['azureLogicAppsStandard.silentAuth'], true);
  const dotnet = path.join(root, 'dotnet.exe');
  assert.equal(settings(root, { dotnet })['dotnetAcquisitionExtension.sharedExistingDotnetPath'], dotnet);
});

test('installs only declared dependency closure from a read-only source', (t) => {
  const base = sandbox(t);
  const root = path.join(base, 'run');
  createRoot(root);
  const extension = path.join(base, 'product');
  const extensions = path.join(base, 'installed');
  productFixture(extension, {
    publisher: 'test',
    name: 'product',
    version: '1.0.0',
    extensionDependencies: ['test.required'],
  });
  json(path.join(extensions, 'required/package.json'), { publisher: 'test', name: 'required', version: '1.0.0' });
  json(path.join(extensions, 'unrelated/package.json'), { publisher: 'test', name: 'unrelated', version: '1.0.0' });
  const records = [];
  assert.equal(installExtensions({ root, extension, extensions }, records), 'test.product');
  assert.deepEqual(
    records.map((record) => record.id),
    ['test.product', 'test.required']
  );
  assert.equal(fs.existsSync(path.join(root, 'extensions/test.unrelated')), false);
  assert.equal(fs.existsSync(path.join(extensions, 'required/package.json')), true);
});

test('does not download a missing dependency', (t) => {
  const base = sandbox(t);
  const extension = path.join(base, 'product');
  productFixture(extension, {
    publisher: 'test',
    name: 'product',
    version: '1.0.0',
    extensionDependencies: ['test.required'],
  });
  const root = path.join(base, 'run');
  createRoot(root);
  assert.throws(() => installExtensions({ root, extension }, []), /Missing offline extension dependency/);
});

test('refuses ambiguous offline dependency versions', (t) => {
  const base = sandbox(t);
  const root = path.join(base, 'run');
  createRoot(root);
  const extension = path.join(base, 'product');
  const extensions = path.join(base, 'installed');
  productFixture(extension, {
    publisher: 'test',
    name: 'product',
    version: '1.0.0',
    extensionDependencies: ['test.required'],
  });
  for (const version of ['1.0.0', '2.0.0']) {
    json(path.join(extensions, `required-${version}/package.json`), { publisher: 'test', name: 'required', version });
  }
  assert.throws(() => installExtensions({ root, extension, extensions }, []), /exactly one offline/);
});

test('rejects unsupported package identity before any install', (t) => {
  const root = sandbox(t);
  const manifest = {
    schemaVersion: 1,
    bundle: artifact(root, 'bundle.zip'),
    sdk: { ...artifact(root, 'sdk.nupkg'), packageId: 'Other.Package' },
  };
  const file = path.join(root, 'candidate.json');
  json(file, manifest);
  assert.throws(() => validateManifest(file), /Microsoft.Azure.Workflows.Sdk/);
});

test('uses the active installation index when old extension payloads remain', (t) => {
  const base = sandbox(t);
  const root = path.join(base, 'run');
  createRoot(root);
  const extension = path.join(base, 'product');
  const extensions = path.join(base, 'installed');
  productFixture(extension, {
    publisher: 'test',
    name: 'product',
    version: '1.0.0',
    extensionDependencies: ['test.required'],
  });
  for (const version of ['1.0.0', '2.0.0']) {
    json(path.join(extensions, `required-${version}/package.json`), { publisher: 'test', name: 'required', version });
  }
  json(path.join(extensions, 'extensions.json'), [
    { identifier: { id: 'test.required' }, version: '2.0.0', relativeLocation: 'required-2.0.0' },
  ]);
  const records = [];
  installExtensions({ root, extension, extensions }, records);
  assert.equal(records.find((entry) => entry.id === 'test.required').version, '2.0.0');
});

test('compiled bootstrap rejects preexisting candidate root before loading any product code', (t) => {
  const root = sandbox(t);
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'preserve'), 'untouched');
  const product = path.join(root, 'product.js');
  fs.writeFileSync(product, 'throw new Error("Product must not load for a preexisting root");');
  const env = isolatedEnv(root, { manifest: path.join(root, 'candidate.json'), node: process.execPath, 'timeout-ms': 30000 });
  const result = spawnSync(process.execPath, [path.join(__dirname, 'bootstrap.js'), product], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap.json'), 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.error, /Candidate root must be absent/);
  assert.equal(fs.readFileSync(path.join(candidate, 'preserve'), 'utf8'), 'untouched');
});

test('replaces only the generated provider with built-in HTTP and Response', (t) => {
  const root = sandbox(t);
  const project = path.join(root, 'CandidateApp');
  fs.mkdirSync(project);
  const sample = fs.readFileSync(path.join(__dirname, '../../assets/CodefulProjectTemplate/StatefulCodefulWorkflow'), 'utf8');
  fs.writeFileSync(path.join(project, 'CandidateWorkflow.cs'), sample);
  const canonical = ['CandidateApp.csproj', 'host.json', 'tasks.json', 'Program.cs'];
  for (const file of canonical) fs.writeFileSync(path.join(project, file), `unchanged-${file}`);
  const evidence = replaceWithLocalHttpWorkflow(project, root);
  const result = fs.readFileSync(evidence.path, 'utf8');
  assert.match(result, /WorkflowTriggers\.BuiltIn\.CreateHttpTrigger/);
  assert.match(result, /WorkflowActions\.BuiltIn\.Response/);
  assert.match(result, /CreateStatefulWorkflow\("CandidateWorkflow"/);
  assert.doesNotMatch(result, /Managed|Msnweather|Connectors|AgentModel/);
  assert.equal(evidence.beforeSha256, crypto.createHash('sha256').update(sample).digest('hex'));
  assert.equal(evidence.afterSha256, crypto.createHash('sha256').update(result).digest('hex'));
  for (const file of canonical) assert.equal(fs.readFileSync(path.join(project, file), 'utf8'), `unchanged-${file}`);
});

test('fixture replacement rejects a project outside the candidate root', (t) => {
  const root = sandbox(t);
  const candidate = path.join(root, 'candidate');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(candidate);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'CandidateWorkflow.cs'), 'IWorkflowProvider preserve');
  assert.throws(() => replaceWithLocalHttpWorkflow(outside, candidate), /inside candidate ROOT/);
  assert.equal(fs.readFileSync(path.join(outside, 'CandidateWorkflow.cs'), 'utf8'), 'IWorkflowProvider preserve');
});

test('compiled bootstrap preserves optional platform diagnostics without claiming platform support', (t) => {
  const root = sandbox(t);
  const product = path.join(root, 'product.js');
  fs.writeFileSync(
    product,
    `
    exports.ensureLocalCandidateInstalled = async () => {
      const root = process.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT;
      require('node:fs').mkdirSync(root);
      return { root, missingPlatformAssets: ['runtimes/test/native/optional.dll'] };
    };
  `
  );
  const env = isolatedEnv(root, { manifest: path.join(root, 'candidate.json'), node: process.execPath, 'timeout-ms': 30000 });
  const result = spawnSync(process.execPath, [path.join(__dirname, 'bootstrap.js'), product], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap.json'), 'utf8'));
  assert.deepEqual(receipt.evidence.missingPlatformAssets, ['runtimes/test/native/optional.dll']);
  assert.equal(receipt.evidence.platformSupport, 'untested');
  assert.equal(receipt.evidence.brokerSupport, 'untested');
});
