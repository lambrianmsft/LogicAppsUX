#!/usr/bin/env node
// Local-only extension-host suite. Intentionally does not enter the shared ExTester runner.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const extensionRoot = path.resolve(__dirname, '..');
const bundleId = 'Microsoft.Azure.Functions.ExtensionBundle.Workflows';
const sdkId = 'Microsoft.Azure.Workflows.Sdk';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (file) => {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
};
const xml = (value) =>
  String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

function parseArgs(argv) {
  const allowed = new Set([
    'manifest',
    'root',
    'code',
    'dotnet',
    'func',
    'node',
    'extensions',
    'extension',
    'nuget-source',
    'timeout-ms',
    'scope',
  ]);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) {
      throw new Error(`Unknown, duplicate, or missing argument: ${argv[i]}`);
    }
    args[key] = argv[i + 1];
  }
  args.manifest ||= process.env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST;
  args.root ||= process.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT;
  args.extension ||= path.join(extensionRoot, 'dist');
  args.node ||= process.execPath;
  args.scope ||= 'pickup';
  if (!['pickup', 'activation'].includes(args.scope)) throw new Error('--scope must be pickup or activation.');
  args['timeout-ms'] = Number(args['timeout-ms'] || 180000);
  if (!Number.isSafeInteger(args['timeout-ms']) || args['timeout-ms'] < 1000 || args['timeout-ms'] > 1800000) {
    throw new Error('--timeout-ms must be between 1000 and 1800000.');
  }
  for (const key of ['manifest', 'root']) {
    if (!args[key] || !path.isAbsolute(args[key])) throw new Error(`--${key} must be an absolute path.`);
  }
  for (const key of ['code', 'dotnet', 'func', 'node', 'extensions', 'extension', 'nuget-source']) {
    if (args[key] && !path.isAbsolute(args[key])) throw new Error(`--${key} must be an absolute path.`);
  }
  return args;
}

function assertNoLinks(file) {
  let current = path.resolve(file);
  for (;;) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink/junction not allowed: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function validateWebviewPayload(extension) {
  const root = path.resolve(extension, 'vs-code-react');
  const index = path.join(root, 'index.html');
  const files = new Set();
  const pending = [];
  const externalReferences = new Set();
  let computedImports = 0;
  let localScripts = 0;
  let localStylesheets = 0;
  // Use the repository's existing parser rather than matching imports inside bundled strings/comments.
  const ts = require('typescript');

  function reference(value, owner, fromRoot = false) {
    const url = value.trim().replace(/&amp;/g, '&');
    if (!url || url.startsWith('#')) {
      return false;
    }
    if (/^(?:https?:|data:|blob:)/i.test(url) || url.startsWith('//')) {
      externalReferences.add(url);
      return false;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(url.split(/[?#]/, 1)[0]);
    } catch {
      throw new Error(`Invalid webview asset URL ${value} in ${owner}`);
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) {
      throw new Error(`Webview asset must be relative to its payload: ${value} in ${owner}`);
    }
    const file = path.resolve(fromRoot ? root : path.dirname(owner), decoded);
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Webview asset escapes payload root: ${value} in ${owner}`);
    }
    pending.push(file);
    return true;
  }

  function javascript(source, file) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    if (tree.parseDiagnostics.length) {
      throw new Error(`Invalid webview JavaScript: ${file}`);
    }
    const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        reference(node.moduleSpecifier.text, file);
        return;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (literal(node.arguments[0])) {
          reference(node.arguments[0].text, file);
        } else {
          computedImports++;
        }
        return;
      } else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        literal(node.arguments?.[0]) &&
        node.arguments?.[1]?.getText(tree).replace(/\s/g, '') === 'import.meta.url'
      ) {
        reference(node.arguments[0].text, file);
        return;
      } else if (literal(node) && /^(?:\.?\/)?assets\/.+\.[a-z\d]+(?:[?#].*)?$/i.test(node.text)) {
        // Vite's preload dependency table uses payload-root-relative strings, not chunk-relative paths.
        reference(node.text, file, true);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }

  function inspect(file) {
    if (files.has(file)) {
      return;
    }
    assertNoLinks(file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
      throw new Error(`Missing or empty webview payload file: ${file}`);
    }
    files.add(file);
    const extension = path.extname(file).toLowerCase();
    if (!['.html', '.js', '.mjs', '.css'].includes(extension)) {
      return;
    }
    const source = fs.readFileSync(file, 'utf8');
    if (extension === '.js' || extension === '.mjs') {
      javascript(source, file);
    } else if (extension === '.css') {
      const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
        reference(
          match.slice(1).find((value) => value !== undefined),
          file
        );
      }
    } else {
      const html = source.replace(/<!--[\s\S]*?-->/g, '');
      for (const match of html.matchAll(/<(script|link|img|source|video|audio|base)\b([^>]*)>/gi)) {
        const tag = match[1].toLowerCase();
        const attributes = {};
        for (const attribute of match[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
          attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4];
        }
        if (tag === 'base') {
          // The normal Vite index retains <base href="/">; asset lookup is against the packaged webview root.
          if (file !== index || !['/', './'].includes(attributes.href)) {
            throw new Error(`Webview base URL overrides are unsupported: ${file}`);
          }
          continue;
        }
        if (attributes.src) {
          const local = reference(attributes.src, file);
          if (tag === 'script' && local) {
            localScripts++;
          }
        }
        if (tag === 'link' && attributes.href) {
          const local = reference(attributes.href, file);
          if (local && attributes.rel?.toLowerCase().split(/\s+/).includes('stylesheet')) {
            localStylesheets++;
          }
        }
        if (attributes.poster) {
          reference(attributes.poster, file);
        }
      }
    }
  }

  inspect(index);
  for (let i = 0; i < pending.length; i++) {
    inspect(pending[i]);
  }
  if (!localScripts || !localStylesheets) {
    throw new Error(`Webview index must reference local JavaScript and a local stylesheet: ${index}`);
  }
  return {
    root,
    index,
    files: [...files].map((file) => path.relative(root, file)).sort(),
    externalReferences: [...externalReferences].sort(),
    computedImports,
  };
}

function validateManifest(file) {
  assertNoLinks(file);
  const manifest = readJson(file);
  if (manifest.schemaVersion !== 1 || manifest.sdk?.packageId !== sdkId)
    throw new Error('Expected schemaVersion 1 and Microsoft.Azure.Workflows.Sdk.');
  for (const key of ['bundle', 'sdk']) {
    const artifact = manifest[key];
    const versionPattern =
      key === 'bundle'
        ? /^\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
        : /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
    if (!artifact || !path.isAbsolute(artifact.path || '') || !versionPattern.test(artifact.version || '')) {
      throw new Error(`Invalid ${key} artifact path or version.`);
    }
    assertNoLinks(artifact.path);
    if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 || '') || sha256(artifact.path) !== artifact.sha256.toLowerCase()) {
      throw new Error(`${key} SHA256 mismatch.`);
    }
  }
  return manifest;
}

function createRoot(root) {
  assertNoLinks(root);
  // Never clean/reuse an existing directory, even if it appears empty.
  fs.mkdirSync(root);
  for (const directory of [
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
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
}

function isolatedEnv(root, args) {
  // Do not copy credentials, cloud configuration, proxy credentials, NODE_OPTIONS, or user NuGet configuration.
  const env = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const home = path.join(root, 'home');
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(root, 'appdata'),
    LOCALAPPDATA: path.join(root, 'localappdata'),
    ProgramData: path.join(root, 'programdata'),
    ALLUSERSPROFILE: path.join(root, 'programdata'),
    TMP: path.join(root, 'temp'),
    TEMP: path.join(root, 'temp'),
    TMPDIR: path.join(root, 'temp'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    DOTNET_CLI_HOME: path.join(home, '.dotnet'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    DOTNET_NOLOGO: '1',
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true',
    DOTNET_CLI_USE_MSBUILD_SERVER: '0',
    MSBUILDDISABLENODEREUSE: '1',
    NUGET_PACKAGES: path.join(root, 'nuget/packages'),
    NUGET_HTTP_CACHE_PATH: path.join(root, 'nuget/http-cache'),
    NUGET_PLUGINS_CACHE_PATH: path.join(root, 'nuget/plugins-cache'),
    AZURE_CONFIG_DIR: path.join(home, '.azure'),
    LOGICAPPS_LOCAL_CANDIDATE_MANIFEST: args.manifest,
    LOGICAPPS_LOCAL_CANDIDATE_ROOT: path.join(root, 'candidate'),
    LA_CANDIDATE_TEST_ROOT: root,
    LA_CANDIDATE_TEST_TIMEOUT: String(args['timeout-ms']),
  });
  env.PATH = [
    ...[args.node, args.dotnet, args.func].filter(Boolean).map((file) => path.dirname(file)),
    ...(process.platform === 'win32'
      ? [path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')]
      : ['/usr/bin', '/bin']),
  ].join(path.delimiter);
  if (args.dotnet) env.DOTNET_ROOT = path.dirname(args.dotnet);
  if (args['nuget-source']) env.LOGICAPPS_LOCAL_CANDIDATE_NUGET_SOURCE = args['nuget-source'];
  return env;
}

function copyExtension(source, destination, records) {
  assertNoLinks(source);
  const pkg = readJson(path.join(source, 'package.json'));
  const id = `${pkg.publisher}.${pkg.name}`.toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(id)) throw new Error(`Invalid extension ID: ${id}`);
  const target = path.join(destination, id);
  fs.cpSync(source, target, { recursive: true, dereference: true });
  records.push({
    id,
    version: pkg.version,
    source,
    path: target,
    packageJsonSha256: sha256(path.join(target, 'package.json')),
    ...(pkg.main && fs.existsSync(path.join(target, pkg.main)) ? { mainSha256: sha256(path.join(target, pkg.main)) } : {}),
  });
  return pkg;
}

function installExtensions(args, records) {
  validateWebviewPayload(args.extension);
  const destination = path.join(args.root, 'extensions');
  const product = copyExtension(args.extension, destination, records);
  const productId = `${product.publisher}.${product.name}`.toLowerCase();
  validateWebviewPayload(path.join(destination, productId));
  const installed = new Set([productId]);
  let available;
  function install(id) {
    id = id.toLowerCase();
    if (installed.has(id)) return;
    if (!args.extensions)
      throw new Error(`Missing offline extension dependency ${id}; provide --extensions <read-only installed extension directory>.`);
    if (!available) {
      available = fs
        .readdirSync(args.extensions, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          const directory = path.join(args.extensions, entry.name);
          const manifest = path.join(directory, 'package.json');
          if (!fs.existsSync(manifest)) return [];
          const pkg = readJson(manifest);
          return [{ directory, pkg, id: `${pkg.publisher}.${pkg.name}`.toLowerCase() }];
        });
      const indexPath = path.join(args.extensions, 'extensions.json');
      if (fs.existsSync(indexPath)) {
        // Installed directories may retain older versions. Use VS Code's active installation index,
        // without copying its machine-specific metadata or reading any user profile/auth storage.
        const active = readJson(indexPath);
        if (!Array.isArray(active)) throw new Error('Offline extension index must be an array.');
        available = available.filter((entry) =>
          active.some(
            (item) =>
              item.identifier?.id?.toLowerCase() === entry.id &&
              item.version === entry.pkg.version &&
              item.relativeLocation === path.basename(entry.directory)
          )
        );
      }
    }
    const choices = available.filter((entry) => entry.id === id);
    if (choices.length !== 1)
      throw new Error(`Expected exactly one offline ${id} extension, found ${choices.length}. Supply a curated dependency directory.`);
    installed.add(id);
    const pkg = copyExtension(choices[0].directory, destination, records);
    for (const dependency of pkg.extensionDependencies || []) install(dependency);
  }
  for (const id of product.extensionDependencies || []) install(id);
  return productId;
}

async function stopOwnedTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const script = `$all = Get-CimInstance Win32_Process; function Stop-Tree([int]$parentId) { foreach ($p in $all | Where-Object ParentProcessId -eq $parentId) { Stop-Tree $p.ProcessId }; Stop-Process -Id $parentId -Force -ErrorAction SilentlyContinue }; Stop-Tree ${child.pid}`;
    await new Promise((resolve) => {
      const killer = spawn(
        path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { stdio: 'ignore' }
      );
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else {
    // Each child is its own process group; never signal an unrelated process.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
}

async function runProcess(command, argv, env, cwd, logFile, timeout) {
  const log = fs.createWriteStream(logFile, { flags: 'wx' });
  const child = spawn(command, argv, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void stopOwnedTree(child);
  }, timeout);
  const interrupt = () => {
    timedOut = true;
    void stopOwnedTree(child);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ pid: child.pid, code, signal }));
    });
    if (timedOut || result.code !== 0)
      throw new Error(`${path.basename(command)} ${timedOut ? 'timed out' : `exited ${result.code}`}; see ${logFile}`);
    return result;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await stopOwnedTree(child);
    await new Promise((resolve) => log.end(resolve));
  }
}

function settings(root, args) {
  const value = {
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'extensions.ignoreRecommendations': true,
    'workbench.enableExperiments': false,
    'workbench.startupEditor': 'none',
    'azureLogicAppsStandard.silentAuth': true,
    'azureLogicAppsStandard.autoRuntimeDependenciesValidationAndInstallation': false,
    'azureLogicAppsStandard.autoRuntimeDependenciesPath': path.join(root, 'candidate/dependencies'),
    'azureLogicAppsStandard.autoStartDesignTime': false,
    'azureLogicAppsStandard.parameterizeConnectionsInProjectLoad': false,
    'azureResourceGroups.selectedSubscriptions': [],
  };
  for (const [flag, setting] of [
    ['dotnet', 'dotnetBinaryPath'],
    ['func', 'funcCoreToolsBinaryPath'],
    ['node', 'nodeJsBinaryPath'],
  ]) {
    if (args[flag]) value[`azureLogicAppsStandard.${setting}`] = args[flag];
  }
  if (args.dotnet) {
    value['dotnetAcquisitionExtension.sharedExistingDotnetPath'] = args.dotnet;
  }
  return value;
}

async function buildGeneratedProject(args, env, manifest) {
  const fixture = readJson(path.join(args.root, 'fixture.json'));
  const projectFiles = fs.readdirSync(fixture.projectPath).filter((name) => name.endsWith('.csproj'));
  if (projectFiles.length !== 1) throw new Error('Expected exactly one project produced by the real workspace generator.');
  const csproj = path.join(fixture.projectPath, projectFiles[0]);
  const projectBytes = fs.readFileSync(csproj);
  if (!projectBytes.toString('utf8').includes(`Include="${sdkId}" Version="${manifest.sdk.version}"`)) {
    throw new Error('Generated project does not reference the exact candidate SDK; the harness will not rewrite its PackageReference.');
  }
  if (args['nuget-source']) {
    assertNoLinks(args['nuget-source']);
    if (!fs.statSync(args['nuget-source']).isDirectory()) throw new Error('--nuget-source must be an offline package directory.');
  }
  const feed = path.join(args.root, 'nuget/feed');
  fs.copyFileSync(manifest.sdk.path, path.join(feed, `${sdkId}.${manifest.sdk.version}.nupkg`));
  const config = path.join(args.root, 'nuget/generated.NuGet.Config');
  fs.writeFileSync(
    config,
    `<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear/><add key="candidate" value="${xml(feed)}"/>${args['nuget-source'] ? `<add key="offline-dependencies" value="${xml(args['nuget-source'])}"/>` : ''}</packageSources><fallbackPackageFolders><clear/></fallbackPackageFolders><packageSourceMapping><clear/></packageSourceMapping></configuration>\n`
  );
  const evidence = {
    project: csproj,
    projectSha256: sha256(csproj),
    configuration: config,
    fixtureReplacement: fixture.testOnlyWorkflowReplacement,
    restoreLog: path.join(args.root, 'logs/generated-restore.log'),
    buildLog: path.join(args.root, 'logs/generated-build.log'),
    imports: path.join(args.root, 'logs/generated-imports.xml'),
    binlog: path.join(args.root, 'logs/generated-build.binlog'),
  };
  const run = (commandArgs, log) => runProcess(args.dotnet, commandArgs, env, fixture.projectPath, log, args['timeout-ms']);
  // Global RestoreConfigFile also applies to normal nested MSBuild restore targets. Do not
  // edit the generated nuget.config, targets, project, or canonical task configuration.
  const restoreProperties = [`-p:RestoreConfigFile=${config}`, '-p:NuGetAudit=false'];
  try {
    await run(
      ['restore', csproj, '--configfile', config, '--packages', env.NUGET_PACKAGES, '--disable-parallel', ...restoreProperties],
      evidence.restoreLog
    );
    await run(
      ['msbuild', csproj, `-preprocess:${evidence.imports}`, '-nr:false', ...restoreProperties],
      path.join(args.root, 'logs/generated-imports.log')
    );
    const targets = fs.readFileSync(path.join(fixture.projectPath, 'obj', `${projectFiles[0]}.nuget.g.targets`), 'utf8');
    const imports = fs.readFileSync(evidence.imports, 'utf8');
    if (
      !targets.toLowerCase().includes(sdkId.toLowerCase()) ||
      !/buildTransitive/i.test(targets) ||
      !imports.toLowerCase().includes(sdkId.toLowerCase()) ||
      !/buildTransitive/i.test(imports)
    ) {
      throw new Error('Generated project does not import the candidate SDK buildTransitive targets through NuGet.');
    }
    const restoredPackage = path.join(
      env.NUGET_PACKAGES,
      sdkId.toLowerCase(),
      manifest.sdk.version.toLowerCase(),
      `${sdkId.toLowerCase()}.${manifest.sdk.version.toLowerCase()}.nupkg`
    );
    evidence.sdkSha256 = sha256(restoredPackage);
    if (evidence.sdkSha256 !== manifest.sdk.sha256.toLowerCase()) throw new Error('Generated project restored a different SDK package.');
    evidence.generatedTargets = targets;
    evidence.importsSha256 = sha256(evidence.imports);
    await run(['build', csproj, '--no-restore', '-nr:false', `-bl:${evidence.binlog}`, ...restoreProperties], evidence.buildLog);
    if (!fs.readFileSync(csproj).equals(projectBytes)) throw new Error('Generated project changed during build; source integrity failed.');
    return evidence;
  } catch (error) {
    error.evidence = evidence;
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  createRoot(args.root);
  const receiptPath = path.join(args.root, 'receipt.json');
  const receipt = {
    schemaVersion: 1,
    startedUtc: new Date().toISOString(),
    root: args.root,
    candidateRoot: path.join(args.root, 'candidate'),
    manifestPath: args.manifest,
    stages: [],
    extensions: [],
    platformSupport: 'untested',
    brokerSupport: 'untested',
    scope:
      args.scope === 'activation'
        ? 'Actual installed extension activation and candidate installation in an empty window. No project, LSP startup, build, designer, F5, or HTTP claim.'
        : 'Actual installed extension activation, candidate pickup, product workspace creation and reopen/LSP selection; separate offline PackageReference build. Not a designer/F5/HTTP test.',
  };
  const save = () => writeJson(receiptPath, receipt);
  async function stage(name, action) {
    const result = { name, status: 'running', startedUtc: new Date().toISOString() };
    receipt.stages.push(result);
    save();
    try {
      result.evidence = await action();
      result.status = 'passed';
      return result.evidence;
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      if (error.evidence) result.evidence = error.evidence;
      return undefined;
    } finally {
      result.completedUtc = new Date().toISOString();
      save();
    }
  }
  const manifest = await stage('manifest', async () => {
    const value = validateManifest(args.manifest);
    receipt.manifestSha256 = sha256(args.manifest);
    receipt.artifacts = { bundle: value.bundle, sdk: value.sdk };
    return value;
  });
  const webview = manifest && (await stage('webview-payload', async () => validateWebviewPayload(args.extension)));
  if (manifest && webview) {
    const env = isolatedEnv(args.root, args);
    writeJson(path.join(args.root, 'user-data/User/settings.json'), settings(args.root, args));
    const binaries = await stage('local-binaries', async () => {
      const evidence = {};
      for (const flag of ['code', 'dotnet', 'func', 'node']) {
        if (!args[flag] || !fs.statSync(args[flag]).isFile())
          throw new Error(`Provide --${flag} <absolute existing executable>; no automatic download is performed.`);
        evidence[flag] = { path: args[flag], sha256: sha256(args[flag]) };
      }
      return evidence;
    });
    const productId = binaries && (await stage('install-extension-payloads', async () => installExtensions(args, receipt.extensions)));
    if (productId) {
      env.LA_CANDIDATE_EXTENSION_ID = productId;
      const probe = path.join(args.root, 'test-extension');
      fs.cpSync(path.join(extensionRoot, 'src/test/candidate'), probe, { recursive: true });
      const compiledInstaller = path.join(args.root, 'extensions', productId, 'localCandidate.js');
      if (fs.existsSync(compiledInstaller)) {
        await stage('candidate-bootstrap', async () => {
          const log = path.join(args.root, 'logs/candidate-bootstrap.log');
          await runProcess(args.node, [path.join(probe, 'bootstrap.js'), compiledInstaller], env, args.root, log, args['timeout-ms']);
          const observation = readJson(path.join(args.root, 'bootstrap.json'));
          if (observation.status !== 'passed') throw new Error('Compiled product installer did not complete.');
          return { log, observation };
        });
      }
      // Prefer the compiled pure-Node product installer when staged. Older builds remain runnable
      // via actual empty-window activation; neither path pre-creates or blesses candidate ROOT.
      const phases =
        args.scope === 'activation'
          ? ['bootstrap']
          : fs.existsSync(compiledInstaller)
            ? ['pickup', 'reopen']
            : ['bootstrap', 'pickup', 'reopen'];
      for (const phase of phases) {
        const phaseResult = await stage(`vscode-${phase}`, async () => {
          if (!args.code) throw new Error('Provide --code <absolute Code.exe/electron executable>; no automatic download is performed.');
          env.LA_CANDIDATE_TEST_PHASE = phase;
          const log = path.join(args.root, `logs/vscode-${phase}.log`);
          const fixtureFile = path.join(args.root, 'fixture.json');
          const reopenedGeneratedWorkspace = phase === 'reopen' && fs.existsSync(fixtureFile);
          let resource;
          if (phase !== 'bootstrap') {
            const bootstrap = readJson(path.join(args.root, 'bootstrap.json'));
            if (bootstrap.status !== 'passed' || !fs.existsSync(receipt.candidateRoot)) {
              throw new Error('Product bootstrap must atomically install the candidate before opening a workspace.');
            }
            const scratch = path.join(receipt.candidateRoot, 'workspace');
            fs.mkdirSync(scratch, { recursive: true });
            resource = reopenedGeneratedWorkspace ? readJson(fixtureFile).workspaceFile : scratch;
            if (!path.isAbsolute(resource) || !fs.existsSync(resource)) throw new Error('Expected a private workspace before launch.');
          }
          const result = await runProcess(
            args.code,
            [
              '--new-window',
              '--user-data-dir',
              path.join(args.root, 'user-data'),
              '--extensions-dir',
              path.join(args.root, 'extensions'),
              '--extensionDevelopmentPath',
              probe,
              '--extensionTestsPath',
              path.join(probe, 'suite.js'),
              '--skip-welcome',
              '--skip-release-notes',
              '--disable-telemetry',
              ...(resource ? [resource] : []),
            ],
            env,
            args.root,
            log,
            args['timeout-ms']
          ).catch((error) => {
            const observationFile = path.join(args.root, `${phase}.json`);
            error.evidence = {
              log,
              resource,
              reopenedGeneratedWorkspace,
              ...(fs.existsSync(observationFile) ? { observation: readJson(observationFile) } : {}),
            };
            throw error;
          });
          const observation = readJson(path.join(args.root, `${phase}.json`));
          if (observation.status !== 'passed') throw new Error(`Extension-host ${phase}: ${observation.error || observation.status}`);
          return { ...result, log, resource, reopenedGeneratedWorkspace, observation };
        });
        if (!phaseResult) {
          break;
        }
        if (phase === 'pickup' && fs.existsSync(path.join(args.root, 'fixture.json'))) {
          await stage('generated-project-build', () => buildGeneratedProject(args, env, manifest));
        }
      }
      await stage('installed-webview-payload', async () => validateWebviewPayload(path.join(args.root, 'extensions', productId)));
    }
    if (args.scope === 'pickup') {
      await stage('package-reference-build', async () => {
        if (!args.dotnet) throw new Error('Provide --dotnet <absolute dotnet executable>; no SDK download is performed.');
        if (args['nuget-source']) {
          assertNoLinks(args['nuget-source']);
          if (!fs.statSync(args['nuget-source']).isDirectory()) throw new Error('--nuget-source must be an offline package directory.');
        }
        const project = path.join(args.root, 'build');
        fs.mkdirSync(project);
        const packageFile = path.join(args.root, 'nuget/feed', `${sdkId}.${manifest.sdk.version}.nupkg`);
        fs.copyFileSync(manifest.sdk.path, packageFile);
        const config = path.join(project, 'NuGet.Config');
        writeJson(path.join(args.root, 'build-input.json'), { sdk: manifest.sdk, nugetSource: args['nuget-source'] || null });
        fs.writeFileSync(
          config,
          `<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear/><add key="candidate" value="${xml(path.dirname(packageFile))}"/>${args['nuget-source'] ? `<add key="offline-dependencies" value="${xml(args['nuget-source'])}"/>` : ''}</packageSources><fallbackPackageFolders><clear/></fallbackPackageFolders><packageSourceMapping><clear/></packageSourceMapping></configuration>\n`
        );
        const csproj = path.join(project, 'CandidateProbe.csproj');
        fs.writeFileSync(
          csproj,
          `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><NuGetAudit>false</NuGetAudit><RestorePackagesPath>${xml(env.NUGET_PACKAGES)}</RestorePackagesPath></PropertyGroup><ItemGroup><PackageReference Include="${sdkId}" Version="${xml(manifest.sdk.version)}"/></ItemGroup></Project>\n`
        );
        fs.writeFileSync(
          path.join(project, 'Probe.cs'),
          'public sealed class CandidateProbe { public string Value => "candidate-build"; }\n'
        );
        const run = (name, commandArgs) =>
          runProcess(args.dotnet, commandArgs, env, project, path.join(args.root, `logs/${name}.log`), args['timeout-ms']);
        await run('restore', [
          'restore',
          csproj,
          '--configfile',
          config,
          '--packages',
          env.NUGET_PACKAGES,
          '-p:NuGetAudit=false',
          '--disable-parallel',
        ]);
        await run('build', ['build', csproj, '--no-restore', '-nr:false', `-bl:${path.join(args.root, 'logs/build.binlog')}`]);
        const preprocessed = path.join(project, 'imports.xml');
        await run('imports', ['msbuild', csproj, `-preprocess:${preprocessed}`, '-nr:false']);
        const imports = fs.readFileSync(preprocessed, 'utf8');
        const sdkDirectory = path.join(env.NUGET_PACKAGES, sdkId.toLowerCase(), manifest.sdk.version.toLowerCase());
        const targets = fs.readFileSync(path.join(project, 'obj/CandidateProbe.csproj.nuget.g.targets'), 'utf8');
        if (!targets.toLowerCase().includes(sdkId.toLowerCase()) || !/buildTransitive/i.test(targets)) {
          throw new Error('Restore did not generate an import of the candidate SDK buildTransitive targets.');
        }
        if (!imports.toLowerCase().includes(sdkId.toLowerCase()) || !/buildTransitive/i.test(imports)) {
          throw new Error('MSBuild preprocessing does not show the SDK buildTransitive import.');
        }
        for (const directory of ['buildTransitive', 'tools']) {
          if (!fs.statSync(path.join(sdkDirectory, directory)).isDirectory()) throw new Error(`SDK lost ${directory}.`);
        }
        const restoredPackage = path.join(sdkDirectory, `${sdkId.toLowerCase()}.${manifest.sdk.version.toLowerCase()}.nupkg`);
        if (sha256(restoredPackage) !== manifest.sdk.sha256.toLowerCase()) throw new Error('Restored SDK package differs from candidate.');
        return {
          project: csproj,
          sdkDirectory,
          restoredPackage,
          sdkSha256: sha256(restoredPackage),
          imports: preprocessed,
          importsSha256: sha256(preprocessed),
          generatedTargets: targets,
        };
      });
    }
  }
  const pickupReceipt = path.join(args.root, 'pickup.json');
  if (fs.existsSync(pickupReceipt)) {
    const created = readJson(pickupReceipt).stages?.find((entry) => entry.name === 'create-workspace');
    if (created) receipt.stages.push(created);
  }
  for (const name of [
    'vscode-pickup',
    'vscode-reopen',
    'package-reference-build',
    'generated-project-build',
    'create-workspace',
    'f5',
    'local-http-workflow',
  ]) {
    if (!receipt.stages.some((entry) => entry.name === name))
      receipt.stages.push({
        name,
        status: 'not-run',
        reason: 'Prerequisite unavailable or outside this pickup suite; no success inferred.',
      });
  }
  receipt.completedUtc = new Date().toISOString();
  receipt.status = receipt.stages.some((entry) => entry.status === 'failed') ? 'failed' : `passed-${args.scope}-scope-only`;
  save();
  console.log(`Candidate receipt: ${receiptPath}\n${receipt.status}`);
  if (receipt.status === 'failed') process.exitCode = 1;
  return receipt;
}

module.exports = {
  parseArgs,
  validateManifest,
  validateWebviewPayload,
  createRoot,
  isolatedEnv,
  installExtensions,
  settings,
  runProcess,
  stopOwnedTree,
  main,
  bundleId,
};
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
