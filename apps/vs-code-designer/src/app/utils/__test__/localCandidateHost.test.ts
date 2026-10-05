import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalCandidate } from '../localCandidate';
import { getExplicitCandidateHostEnvironment, getLocalCandidateHostArguments, prepareLocalCandidateHost } from '../localCandidateHost';

vi.unmock('fs');
vi.unmock('node:fs');
vi.unmock('os');
vi.unmock('node:os');
vi.unmock('util');

let root: string;
let source: string;
let candidate: LocalCandidate;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.candidate-host-test-'));
  source = path.join(root, 'project', 'bin', 'Debug', 'net8');
  const bundlePath = path.join(root, 'bundles', '1.2.3.4');
  await fs.mkdir(path.join(bundlePath, 'bin'), { recursive: true });
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(bundlePath, 'bin', 'extensions.json'), '{"extensions":["verified"]}');
  await fs.writeFile(path.join(bundlePath, 'bin', 'engine.dll'), 'engine');
  await fs.writeFile(path.join(source, 'host.json'), '{"version":"2.0","extensionBundle":{"version":"[1.2.3.4]"},"custom":true}');
  await fs.writeFile(path.join(source, 'local.settings.json'), '{"Values":{"unchanged":"user setting"}}');
  await fs.writeFile(path.join(source, 'worker.config.json'), '{"description":{"defaultWorkerPath":"app.dll"}}');
  await fs.writeFile(path.join(source, 'Microsoft.Azure.Workflows.Sdk.dll'), 'sdk');
  await fs.writeFile(path.join(source, 'app.dll'), 'build one');
  await fs.writeFile(path.join(source, 'app.pdb'), 'source mapping');
  const sdkPath = path.join(root, 'sdk.nupkg');
  const archive = new AdmZip();
  archive.addFile('lib/netstandard2.0/Microsoft.Azure.Workflows.Sdk.dll', Buffer.from('sdk'));
  archive.writeZip(sdkPath);
  candidate = {
    root,
    bundlePath,
    bundleRoot: path.dirname(bundlePath),
    dependenciesPath: path.join(root, 'dependencies'),
    sdkPath,
    manifestPath: path.join(root, 'candidate.json'),
    bundle: { path: path.join(root, 'bundle.zip'), version: '1.2.3.4', sha256: 'a'.repeat(64) },
    sdk: {
      path: sdkPath,
      version: '1.0.0',
      sha256: createHash('sha256')
        .update(await fs.readFile(sdkPath))
        .digest('hex'),
      packageId: 'Microsoft.Azure.Workflows.Sdk',
    },
  };
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('explicit candidate debug host', () => {
  it('retains custom host arguments while enforcing loopback and avoiding another build', () => {
    expect(getLocalCandidateHostArguments(['host', 'start', '--port', '7077', '--verbose'])).toEqual([
      'host',
      'start',
      '--port',
      '7077',
      '--verbose',
      '--address',
      '127.0.0.1',
      '--no-build',
    ]);
    expect(getLocalCandidateHostArguments(['host', 'start', '--address', '127.0.0.1', '--no-build'])).toEqual([
      'host',
      'start',
      '--address',
      '127.0.0.1',
      '--no-build',
    ]);
  });

  it('rejects offline, root overrides and non-loopback host bindings', () => {
    for (const extra of [['--offline'], ['--script-root', 'outside'], ['--address', '0.0.0.0'], ['--address=::']]) {
      expect(() => getLocalCandidateHostArguments(['host', 'start', ...extra])).toThrow('Candidate debugging');
    }
  });
  it('preserves the bundle, full worker and source configuration without a bundle resolver', async () => {
    const host = await prepareLocalCandidateHost(candidate, source);
    expect(JSON.parse(await fs.readFile(path.join(host, 'host.json'), 'utf8'))).toEqual({ version: '2.0', custom: true });
    expect(JSON.parse(await fs.readFile(path.join(source, 'host.json'), 'utf8')).extensionBundle.version).toBe('[1.2.3.4]');
    for (const file of ['app.dll', 'app.pdb', 'worker.config.json', 'Microsoft.Azure.Workflows.Sdk.dll']) {
      expect(await fs.readFile(path.join(host, file))).toEqual(await fs.readFile(path.join(source, file)));
      expect(await fs.readFile(path.join(host, 'lib', 'codeful', file))).toEqual(await fs.readFile(path.join(source, file)));
    }
    expect(await fs.readFile(path.join(host, 'lib', 'codeful', 'local.settings.json'))).toEqual(
      await fs.readFile(path.join(source, 'local.settings.json'))
    );
    expect(JSON.parse(await fs.readFile(path.join(host, 'local.settings.json'), 'utf8')).Values).toEqual({
      unchanged: 'user setting',
      ProjectDirectoryPath: host,
    });
    expect(await fs.readFile(path.join(host, 'bin', 'engine.dll'), 'utf8')).toBe('engine');
  });

  it('deploys the current build on each invocation without mutating a running prior host', async () => {
    const first = await prepareLocalCandidateHost(candidate, source);
    await fs.writeFile(path.join(source, 'app.dll'), 'build two');
    await fs.writeFile(path.join(source, 'app.pdb'), 'updated mapping');
    const second = await prepareLocalCandidateHost(candidate, source);
    expect(first).not.toBe(second);
    expect(await fs.readFile(path.join(first, 'app.dll'), 'utf8')).toBe('build one');
    expect(await fs.readFile(path.join(second, 'lib', 'codeful', 'app.dll'), 'utf8')).toBe('build two');
    expect(await fs.readFile(path.join(second, 'app.pdb'), 'utf8')).toBe('updated mapping');
  });

  it('rejects outside-root or missing build output before allocating a host', async () => {
    await expect(prepareLocalCandidateHost(candidate, path.dirname(root))).rejects.toThrow('must be inside');
    await fs.unlink(path.join(source, 'worker.config.json'));
    await expect(prepareLocalCandidateHost(candidate, source)).rejects.toThrow('Build the codeful project');
    await expect(fs.access(path.join(root, 'debug-hosts'))).rejects.toThrow();
  });

  it('rejects a stale or stock SDK before allocation', async () => {
    await fs.writeFile(path.join(source, 'Microsoft.Azure.Workflows.Sdk.dll'), 'stock');
    await expect(prepareLocalCandidateHost(candidate, source)).rejects.toThrow('Built SDK does not match');
    await expect(fs.access(path.join(root, 'debug-hosts'))).rejects.toThrow();
  });

  it('removes stale bundle local settings only in the derived application configuration', async () => {
    const settings = {
      Values: { KEEP: 'user', AzureFunctionsJobHost__extensionBundle__version: '[0.0.0]', logic_apps_csharp_sdk_assembly_path: 'stale' },
    };
    await fs.writeFile(path.join(source, 'local.settings.json'), JSON.stringify(settings));
    const host = await prepareLocalCandidateHost(candidate, source);
    expect(JSON.parse(await fs.readFile(path.join(host, 'local.settings.json'), 'utf8')).Values).toEqual({
      KEEP: 'user',
      ProjectDirectoryPath: host,
    });
    expect(JSON.parse(await fs.readFile(path.join(source, 'local.settings.json'), 'utf8'))).toEqual(settings);
  });

  it('rejects application files colliding with the protected engine', async () => {
    await fs.mkdir(path.join(source, 'bin'));
    await fs.writeFile(path.join(source, 'bin', 'engine.dll'), 'wrong');
    await expect(prepareLocalCandidateHost(candidate, source)).rejects.toThrow('overwrite a verified bundle file');
    await expect(fs.access(path.join(root, 'debug-hosts'))).rejects.toThrow();
  });

  it('removes inherited bundle resolver configuration and approves only the packaged SDK', async () => {
    const host = await prepareLocalCandidateHost(candidate, source);
    const inherited = {
      AzureFunctionsJobHost__extensionBundle__version: '[1.2.3.4]',
      azurefunctionsjobhost__extensionbundle__downloadpath: 'shared',
      'AzureFunctionsJobHost:extensionBundle:ensureLatest': 'true',
      PATH: 'selected tools',
      CUSTOM: 'user',
      logic_apps_csharp_sdk_assembly_sha256: 'unapproved',
      projectdirectorypath: 'previous project',
      azurewebjobsscriptroot: 'previous script',
      workflow_application_root_directory: 'previous app',
    };
    expect(await getExplicitCandidateHostEnvironment(candidate, host, inherited)).toEqual({
      PATH: 'selected tools',
      CUSTOM: 'user',
      ProjectDirectoryPath: host,
      WORKFLOW_APPLICATION_ROOT_DIRECTORY: host,
      AzureWebJobsScriptRoot: host,
      FUNCTIONS_CORE_TOOLS_OFFLINE: 'false',
      FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'http://127.0.0.1:1',
      LOGIC_APPS_CSHARP_SDK_ASSEMBLY_PATH: path.join(host, 'Microsoft.Azure.Workflows.Sdk.dll'),
      LOGIC_APPS_CSHARP_SDK_ASSEMBLY_SHA256: createHash('sha256').update('sdk').digest('hex'),
    });
    expect(inherited.AzureFunctionsJobHost__extensionBundle__version).toBe('[1.2.3.4]');
  });
  it('pins the worker project root to each new host instead of a copied project or previous deployment', async () => {
    const settings = {
      Values: {
        projectdirectorypath: 'previous project',
        WORKFLOW_APPLICATION_ROOT_DIRECTORY: 'previous app',
        AzureWebJobsScriptRoot: 'previous script',
        KEEP: 'user',
      },
    };
    await fs.writeFile(path.join(source, 'local.settings.json'), JSON.stringify(settings));
    const first = await prepareLocalCandidateHost(candidate, source);
    const second = await prepareLocalCandidateHost(candidate, path.join(first, 'lib', 'codeful'));
    for (const host of [first, second]) {
      const derived = JSON.parse(await fs.readFile(path.join(host, 'local.settings.json'), 'utf8')).Values;
      expect(derived).toEqual({
        KEEP: 'user',
        ProjectDirectoryPath: host,
      });
    }
    expect(JSON.parse(await fs.readFile(path.join(source, 'local.settings.json'), 'utf8'))).toEqual(settings);
  });
  it('rejects tampering with either the manifest-approved package or deployed SDK before approving references', async () => {
    const host = await prepareLocalCandidateHost(candidate, source);
    await fs.writeFile(path.join(host, 'Microsoft.Azure.Workflows.Sdk.dll'), 'changed');
    await expect(getExplicitCandidateHostEnvironment(candidate, host, {})).rejects.toThrow('Deployed SDK assembly does not match');
    await fs.writeFile(candidate.sdkPath, 'changed package');
    await expect(getExplicitCandidateHostEnvironment(candidate, host, {})).rejects.toThrow('manifest SHA256');
  });
});
