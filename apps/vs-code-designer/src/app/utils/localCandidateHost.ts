import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { assertLocalCandidateInstalled, type LocalCandidate } from './localCandidate';

const bundleSetting = /^AzureFunctionsJobHost(__|:)extensionBundle((__|:)|$)/i;
const sdkReferenceSetting = /^LOGIC_APPS_CSHARP_SDK_ASSEMBLY_(PATH|SHA256)$/i;
const hostRootSetting = /^(ProjectDirectoryPath|WORKFLOW_APPLICATION_ROOT_DIRECTORY|AzureWebJobsScriptRoot)$/i;

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Candidate debug deployment does not allow symbolic links: ${file}`);
      }
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile()) {
        files.push(path.relative(root, file));
      } else {
        throw new Error(`Candidate debug deployment requires regular files: ${file}`);
      }
    }
  }
  await visit(root);
  return files;
}

async function requirePrivateDirectory(candidate: LocalCandidate, directory: string): Promise<string> {
  const resolved = await fs.realpath(directory);
  const root = await fs.realpath(candidate.root);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Candidate debug output must be inside "${candidate.root}": ${directory}`);
  }
  return resolved;
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}

async function getApprovedSdkAssemblyHash(candidate: LocalCandidate): Promise<string> {
  const bytes = await fs.readFile(candidate.sdkPath);
  if (createHash('sha256').update(bytes).digest('hex') !== candidate.sdk.sha256.toLowerCase()) {
    throw new Error('Candidate SDK package no longer matches the selected manifest SHA256.');
  }
  const assembly = new AdmZip(bytes).readFile('lib/netstandard2.0/Microsoft.Azure.Workflows.Sdk.dll');
  if (!assembly) {
    throw new Error('Candidate SDK package is missing its supported runtime assembly.');
  }
  return createHash('sha256').update(assembly).digest('hex');
}

async function copyFiles(source: string, files: string[], destination: string): Promise<void> {
  for (const file of files) {
    const target = path.join(destination, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(source, file), target, fs.constants.COPYFILE_EXCL);
  }
}

/** Called by the host task itself, after its clean/build dependencies complete. */
export async function prepareLocalCandidateHost(candidate: LocalCandidate, buildDirectory: string): Promise<string> {
  const source = await requirePrivateDirectory(candidate, buildDirectory);
  const sourceFiles = await listFiles(source);
  for (const required of ['host.json', 'local.settings.json', 'Microsoft.Azure.Workflows.Sdk.dll', 'worker.config.json']) {
    if (!sourceFiles.includes(required)) {
      throw new Error(`Build the codeful project before debugging; missing "${path.join(source, required)}".`);
    }
  }
  const bundleFiles = await listFiles(candidate.bundlePath);
  const sdkAssemblyHash = await getApprovedSdkAssemblyHash(candidate);
  if (sdkAssemblyHash !== (await sha256(path.join(source, 'Microsoft.Azure.Workflows.Sdk.dll')))) {
    throw new Error('Built SDK does not match the selected candidate package; restore and build the project again.');
  }
  const occupied = new Set(bundleFiles.map((file) => file.toLowerCase()));
  for (const file of sourceFiles) {
    if (occupied.has(file.toLowerCase()) || occupied.has(path.join('lib', 'codeful', file).toLowerCase())) {
      throw new Error(`Candidate debug deployment would overwrite a verified bundle file: ${file}`);
    }
  }
  const hostConfig = JSON.parse(await fs.readFile(path.join(source, 'host.json'), 'utf8'));
  if (!hostConfig || typeof hostConfig !== 'object' || Array.isArray(hostConfig)) {
    throw new Error('Candidate debug host.json must contain an object.');
  }
  delete hostConfig.extensionBundle;
  const settings = JSON.parse(await fs.readFile(path.join(source, 'local.settings.json'), 'utf8'));
  if (!settings?.Values || typeof settings.Values !== 'object' || Array.isArray(settings.Values) || settings.IsEncrypted === true) {
    throw new Error('Candidate debug deployment requires unencrypted local.settings.json Values.');
  }
  const removedSettings = Object.keys(settings.Values).filter(
    (key) => bundleSetting.test(key) || sdkReferenceSetting.test(key) || hostRootSetting.test(key)
  );
  for (const key of removedSettings) {
    delete settings.Values[key];
  }
  const hosts = path.join(candidate.root, 'debug-hosts');
  await fs.mkdir(hosts, { recursive: true });
  await requirePrivateDirectory(candidate, hosts);
  const host = await fs.mkdtemp(path.join(hosts, 'host-'));
  settings.Values.ProjectDirectoryPath = host;
  await copyFiles(candidate.bundlePath, bundleFiles, host);
  // The runtime discovers providers in lib/codeful; worker RPC resolves assembly paths at the app root.
  await copyFiles(source, sourceFiles, path.join(host, 'lib', 'codeful'));
  await copyFiles(source, sourceFiles, host);
  await fs.writeFile(path.join(host, 'host.json'), JSON.stringify(hostConfig, null, 2));
  await fs.writeFile(path.join(host, 'local.settings.json'), JSON.stringify(settings, null, 2));
  for (const file of bundleFiles) {
    if ((await sha256(path.join(candidate.bundlePath, file))) !== (await sha256(path.join(host, file)))) {
      throw new Error(`Candidate debug bundle copy failed integrity verification: ${file}`);
    }
  }
  for (const file of sourceFiles) {
    const expected = await sha256(path.join(source, file));
    if (
      expected !== (await sha256(path.join(host, 'lib', 'codeful', file))) ||
      (file !== 'host.json' && file !== 'local.settings.json' && expected !== (await sha256(path.join(host, file))))
    ) {
      throw new Error(`Build output changed during candidate debug deployment; build again: ${file}`);
    }
  }
  return host;
}

export async function getExplicitCandidateHostEnvironment(
  candidate: LocalCandidate,
  host: string,
  inherited: NodeJS.ProcessEnv
): Promise<NodeJS.ProcessEnv> {
  await requirePrivateDirectory(candidate, host);
  const sdkHash = await getApprovedSdkAssemblyHash(candidate);
  const sdkPath = path.join(host, 'Microsoft.Azure.Workflows.Sdk.dll');
  if ((await sha256(sdkPath)) !== sdkHash) {
    throw new Error('Deployed SDK assembly does not match the hash-approved candidate package.');
  }
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (bundleSetting.test(key) || sdkReferenceSetting.test(key) || hostRootSetting.test(key)) {
      delete env[key];
    }
  }
  return {
    ...env,
    ProjectDirectoryPath: host,
    WORKFLOW_APPLICATION_ROOT_DIRECTORY: host,
    AzureWebJobsScriptRoot: host,
    FUNCTIONS_CORE_TOOLS_OFFLINE: 'false',
    FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'http://127.0.0.1:1',
    LOGIC_APPS_CSHARP_SDK_ASSEMBLY_PATH: sdkPath,
    LOGIC_APPS_CSHARP_SDK_ASSEMBLY_SHA256: sdkHash,
  };
}

export function getLocalCandidateHostArguments(args: string[]): string[] {
  if (args[0] !== 'host' || args[1] !== 'start' || args.some((arg) => /^--(offline|script-root)(=|$)/i.test(arg))) {
    throw new Error('Candidate debugging requires host start without --offline or a script-root override.');
  }
  const addresses = args.flatMap((arg, index) =>
    arg === '--address' ? [args[index + 1]] : arg.startsWith('--address=') ? [arg.slice('--address='.length)] : []
  );
  if (addresses.some((address) => address !== '127.0.0.1') || addresses.length > 1) {
    throw new Error('Candidate debugging must bind only to 127.0.0.1.');
  }
  return [...args, ...(addresses.length ? [] : ['--address', '127.0.0.1']), ...(args.includes('--no-build') ? [] : ['--no-build'])];
}

async function run(): Promise<void> {
  const [func, ...args] = process.argv.slice(2);
  if (!func || !path.isAbsolute(func)) {
    throw new Error('Candidate debug launcher requires an absolute Core Tools path followed by host start arguments.');
  }
  const hostArgs = getLocalCandidateHostArguments(args);
  const candidate = await assertLocalCandidateInstalled();
  if (!candidate) {
    throw new Error('Candidate debug launcher requires an explicitly installed local candidate.');
  }
  const host = await prepareLocalCandidateHost(candidate, process.cwd());
  console.log(`Candidate debug host: ${host}`);
  console.log(`Candidate bundle ${candidate.bundle.version} SHA256 ${candidate.bundle.sha256}; SDK ${candidate.sdk.version}`);
  const env = await getExplicitCandidateHostEnvironment(candidate, host, process.env);
  const child = spawn(func, hostArgs, {
    cwd: host,
    env,
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(`Candidate host failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Candidate debug preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
