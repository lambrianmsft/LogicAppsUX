import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultExtensionBundlePathValue, extensionBundleId } from '../../../constants';
import { assertLocalCandidateInstalled, ensureLocalCandidateInstalled, getLocalCandidate } from '../localCandidate';

vi.unmock('fs');
vi.unmock('node:fs');
vi.unmock('os');
vi.unmock('node:os');
vi.unmock('util');

const version = '1.2.3-preview.4';
const sdkVersion = '2.3.4-local.1';
const sdkId = 'Microsoft.Azure.Workflows.Sdk';
const edgeDll = 'bin/Microsoft.Azure.Workflows.Templates.Languages.Edge.CSharp.dll';
let directory: string;
let root: string;
let manifestPath: string;
let bundleFiles: Record<string, string>;
let sdkFiles: Record<string, string>;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function zip(files: Record<string, string>): Buffer {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    archive.addFile(name, Buffer.from(content));
  }
  return archive.toBuffer();
}

async function writeFixture(bundleBytes = zip(bundleFiles), sdkBytes = zip(sdkFiles), bundleVersion = version) {
  const bundlePath = path.join(directory, 'bundle.zip');
  const sdkPath = path.join(directory, 'sdk.nupkg');
  await fs.writeFile(bundlePath, bundleBytes);
  await fs.writeFile(sdkPath, sdkBytes);
  const manifest = {
    schemaVersion: 1,
    bundle: { path: bundlePath, version: bundleVersion, sha256: sha256(bundleBytes).toUpperCase() },
    sdk: { path: sdkPath, packageId: sdkId, version: sdkVersion, sha256: sha256(sdkBytes) },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  return manifest;
}

beforeEach(async () => {
  directory = path.join(process.cwd(), `.candidate-test-${randomUUID()}`);
  root = path.join(directory, 'private');
  manifestPath = path.join(directory, 'candidate.json');
  await fs.mkdir(directory);
  vi.stubEnv('LOGICAPPS_LOCAL_CANDIDATE_ROOT', root);
  vi.stubEnv('LOGICAPPS_LOCAL_CANDIDATE_MANIFEST', manifestPath);
  bundleFiles = {
    'bundle.json': JSON.stringify({ id: extensionBundleId, version }),
    'bin/extensions.json': JSON.stringify({ extensions: [{ name: 'workflow', typeName: 'Workflow.Extension' }] }),
    'bin/function.deps.json': JSON.stringify({
      targets: {
        'net8.0': {
          'workflow/1.0.0': {
            runtime: { 'lib/netstandard2.0/workflow.dll': {} },
            runtimeTargets: { 'runtimes/win-x64/native/native.dll': { assetType: 'native', rid: 'win-x64' } },
          },
        },
      },
    }),
    [edgeDll]: 'edge language assembly bytes',
    'bin/workflow.dll': 'workflow assembly bytes',
    'bin/runtimes/win-x64/native/native.dll': 'native assembly bytes',
  };
  sdkFiles = {
    'Microsoft.Azure.Workflows.Sdk.nuspec': `<package><metadata><id>${sdkId}</id><version>${sdkVersion}</version></metadata></package>`,
    'lib/netstandard2.0/Microsoft.Azure.Workflows.Sdk.dll': 'SDK runtime bytes',
    'buildTransitive/Microsoft.Azure.Workflows.Sdk.props': '<Project />',
    'buildTransitive/Microsoft.Azure.Workflows.Sdk.targets': '<Project />',
    'tools/workflow-build/Microsoft.Azure.Workflows.Build.runtimeconfig.json': '{"runtimeOptions":{}}',
    'tools/workflow-build/Microsoft.Azure.Workflows.Build.dll': 'build tool bytes',
    'content/source-expression/extra.txt': 'preserve every byte, including nonstandard extra payload',
  };
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('local candidate manifest and installation', () => {
  it('does nothing in normal mode', async () => {
    delete process.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT;
    delete process.env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST;
    expect(await getLocalCandidate()).toBeUndefined();
    expect(await ensureLocalCandidateInstalled()).toBeUndefined();
    expect(await assertLocalCandidateInstalled()).toBeUndefined();
  });

  it.each(['LOGICAPPS_LOCAL_CANDIDATE_ROOT', 'LOGICAPPS_LOCAL_CANDIDATE_MANIFEST'])('rejects an incomplete opt-in: %s', async (key) => {
    delete process.env[key];
    await expect(getLocalCandidate()).rejects.toThrow('must both be absolute paths');
  });

  it('validates without writing and installs the full SDK bytes and bundle tree', async () => {
    await writeFixture();
    const selected = await getLocalCandidate();
    expect(selected?.bundle.version).toBe(version);
    await expect(fs.access(root)).rejects.toThrow();
    const installed = await ensureLocalCandidateInstalled();
    expect(installed).toEqual(selected);
    expect(await fs.readFile(installed!.sdkPath)).toEqual(await fs.readFile(installed!.sdk.path));
    for (const [name, contents] of Object.entries(bundleFiles)) {
      expect(await fs.readFile(path.join(installed!.bundlePath, name), 'utf8')).toBe(contents);
    }
    expect(await ensureLocalCandidateInstalled()).toEqual(installed);
    expect(await assertLocalCandidateInstalled()).toEqual(installed);
  });

  it('serializes concurrent installations of the same immutable pair', async () => {
    await writeFixture();
    const [first, second] = await Promise.all([ensureLocalCandidateInstalled(), ensureLocalCandidateInstalled()]);
    expect(first).toEqual(second);
  });

  it('preserves and installs an exact four-part .NET bundle version', async () => {
    const bundleVersion = '1.192.0.32';
    bundleFiles['bundle.json'] = JSON.stringify({ id: extensionBundleId, version: bundleVersion });
    await writeFixture(undefined, undefined, bundleVersion);
    expect((await getLocalCandidate())?.bundle.version).toBe(bundleVersion);
    const installed = (await ensureLocalCandidateInstalled())!;
    expect(installed.bundle.version).toBe(bundleVersion);
    expect(path.basename(installed.bundlePath)).toBe(bundleVersion);
    expect(await assertLocalCandidateInstalled()).toEqual(installed);
  });

  it.each(['1.192.0.32/../../escape', '1.192.0.32\\escape', '1.192.0.32:ads', '1.192.0.32.1', '1.192.0.-32'])(
    'rejects an unsafe or invalid four-part bundle version: %s',
    async (bundleVersion) => {
      await writeFixture(undefined, undefined, bundleVersion);
      await expect(getLocalCandidate()).rejects.toThrow('bundle.version must be');
    }
  );

  it.each([
    ['schema version', (manifest: any) => (manifest.schemaVersion = 2), 'schemaVersion'],
    ['invalid version', (manifest: any) => (manifest.bundle.version = 'latest'), 'semantic version'],
    ['version range', (manifest: any) => (manifest.sdk.version = '[1.0.0,2.0.0)'), 'semantic version'],
    ['four-part SDK version', (manifest: any) => (manifest.sdk.version = '1.192.0.32'), 'sdk.version must be an exact semantic version'],
    ['hash format', (manifest: any) => (manifest.sdk.sha256 = 'deadbeef'), '64-character'],
    ['relative path', (manifest: any) => (manifest.bundle.path = 'bundle.zip'), 'absolute'],
    ['SDK ID', (manifest: any) => (manifest.sdk.packageId = 'Other.Sdk'), 'sdk.packageId'],
    ['source hash', (manifest: any) => (manifest.bundle.sha256 = '0'.repeat(64)), 'SHA256 mismatch'],
  ])('rejects malformed %s', async (_label, mutate, message) => {
    const manifest = await writeFixture();
    mutate(manifest);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow(message);
    await expect(fs.access(root)).rejects.toThrow();
  });

  it('rejects malformed JSON', async () => {
    await fs.writeFile(manifestPath, '{');
    await expect(getLocalCandidate()).rejects.toThrow();
  });

  it('rejects a nuspec version mismatch even with a correct archive hash', async () => {
    sdkFiles['Microsoft.Azure.Workflows.Sdk.nuspec'] = `<package><metadata><id>${sdkId}</id><version>9.9.9</version></metadata></package>`;
    await writeFixture();
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('nuspec ID/version');
  });

  it.each([
    'lib/netstandard2.0/Microsoft.Azure.Workflows.Sdk.dll',
    'buildTransitive/Microsoft.Azure.Workflows.Sdk.props',
    'buildTransitive/Microsoft.Azure.Workflows.Sdk.targets',
    'tools/workflow-build/Microsoft.Azure.Workflows.Build.runtimeconfig.json',
  ])('rejects a partial SDK without %s', async (missing) => {
    delete sdkFiles[missing];
    await writeFixture();
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('complete runtime/build payload');
  });

  it.each(['bundle.json', 'bin/extensions.json', 'bin/function.deps.json', edgeDll])('rejects missing bundle file %s', async (missing) => {
    delete bundleFiles[missing];
    await writeFixture();
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('required package file');
  });

  it('rejects a bundle whose own identity differs', async () => {
    bundleFiles['bundle.json'] = JSON.stringify({ id: extensionBundleId, version: '9.9.9' });
    await writeFixture();
    await expect(getLocalCandidate()).rejects.toThrow('bundle.json ID/version');
  });

  it('rejects an incomplete mandatory .runtime closure', async () => {
    delete bundleFiles['bin/workflow.dll'];
    await writeFixture();
    await expect(getLocalCandidate()).rejects.toThrow('runtime dependency missing');
  });

  it('rejects an empty .runtime set even when runtimeTargets assets exist', async () => {
    const deps = JSON.parse(bundleFiles['bin/function.deps.json']);
    delete deps.targets['net8.0']['workflow/1.0.0'].runtime;
    bundleFiles['bin/function.deps.json'] = JSON.stringify(deps);
    await writeFixture();
    await expect(getLocalCandidate()).rejects.toThrow('contains no runtime assets');
  });

  it('permits omitted localized satellite resources while verifying all included bundle bytes', async () => {
    const deps = JSON.parse(bundleFiles['bin/function.deps.json']);
    deps.targets['net8.0']['workflow/1.0.0'].resources = {
      'lib/netstandard1.3/it/DotLiquid.resources.dll': { locale: 'it' },
    };
    bundleFiles['bin/function.deps.json'] = JSON.stringify(deps);
    await writeFixture();
    const installed = await ensureLocalCandidateInstalled();
    expect(installed?.bundle.version).toBe(version);
    expect(await assertLocalCandidateInstalled()).toEqual(installed);
  });

  it('reports missing native/runtimeTargets as diagnostics without inventing a mandatory platform gate', async () => {
    const deps = JSON.parse(bundleFiles['bin/function.deps.json']);
    deps.targets['net8.0']['workflow/1.0.0'].resources = {
      'lib/netstandard1.3/it/DotLiquid.resources.dll': { locale: 'it' },
    };
    deps.targets['net8.0']['Microsoft.Identity.Client.NativeInterop/0.19.4'] = {
      native: { 'runtimes/linux-x64/native/libmsalruntime.so': {} },
      runtimeTargets: {
        'runtimes/win-x64/native/msalruntime.dll': { rid: 'win-x64', assetType: 'native' },
      },
    };
    bundleFiles['bin/function.deps.json'] = JSON.stringify(deps);
    await writeFixture();
    const selected = (await getLocalCandidate())!;
    expect(selected.missingPlatformAssets).toEqual([
      'runtimes/linux-x64/native/libmsalruntime.so',
      'runtimes/win-x64/native/msalruntime.dll',
    ]);
    expect(await ensureLocalCandidateInstalled()).toEqual(selected);
    expect(await assertLocalCandidateInstalled()).toEqual(selected);
    await fs.writeFile(path.join(selected.bundlePath, 'bin/runtimes/win-x64/native/native.dll'), 'corrupt included platform asset');
    await expect(assertLocalCandidateInstalled()).rejects.toThrow('installed bundle is corrupt');
  });

  it.each(['../bad.dll', 'C:/bad.dll', 'bin/CON.dll', 'bin/bad.dll:ads'])('rejects unsafe ZIP entry %s', async (name) => {
    const archive = new AdmZip(zip(bundleFiles));
    archive.addFile('placeholder', Buffer.from('bad'));
    // Assign directly because addFile sanitizes incoming paths.
    archive.getEntry('placeholder')!.entryName = name;
    await writeFixture(archive.toBuffer());
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('unsafe archive entry');
    await expect(fs.access(root)).rejects.toThrow();
  });

  it('rejects archive symlinks', async () => {
    const archive = new AdmZip(zip(bundleFiles));
    archive.getEntry(edgeDll)!.attr = (0xa1ff << 16) >>> 0;
    await writeFixture(archive.toBuffer());
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('symbolic link');
  });

  it.each(['corrupt', 'missing', 'extra'])('never repairs an installed %s bundle', async (mode) => {
    await writeFixture();
    const installed = (await ensureLocalCandidateInstalled())!;
    const file = path.join(installed.bundlePath, edgeDll);
    if (mode === 'corrupt') {
      await fs.writeFile(file, 'mutated content');
    } else if (mode === 'missing') {
      await fs.rm(file);
    } else {
      await fs.writeFile(path.join(installed.bundlePath, 'unexpected.dll'), 'extra DLL');
    }
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow(/corrupt|incomplete/);
    await expect(assertLocalCandidateInstalled()).rejects.toThrow(/corrupt|incomplete/);
    if (mode === 'corrupt') {
      expect(await fs.readFile(file, 'utf8')).toBe('mutated content');
    }
  });

  it('never repairs an installed corrupt SDK', async () => {
    await writeFixture();
    const installed = (await ensureLocalCandidateInstalled())!;
    await fs.writeFile(installed.sdkPath, 'corrupt');
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('installed SDK is corrupt');
    expect(await fs.readFile(installed.sdkPath, 'utf8')).toBe('corrupt');
  });

  it('refuses reuse after any descriptor change', async () => {
    const manifest = await writeFixture();
    await ensureLocalCandidateInstalled();
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, provenance: 'modified' }));
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow('different or modified manifest');
  });

  it('refuses an existing root without its owner marker', async () => {
    await writeFixture();
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'keep.txt'), 'not owned');
    await expect(ensureLocalCandidateInstalled()).rejects.toThrow();
    expect(await fs.readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('not owned');
  });

  it('keeps the exact candidate even when a higher version directory exists', async () => {
    await writeFixture();
    const installed = (await ensureLocalCandidateInstalled())!;
    await fs.mkdir(path.join(installed.bundleRoot, extensionBundleId, '99.0.0'));
    expect((await ensureLocalCandidateInstalled())?.bundlePath).toBe(installed.bundlePath);
  });

  it.each([() => process.cwd(), () => os.homedir(), () => os.tmpdir(), () => defaultExtensionBundlePathValue])(
    'refuses a non-private root',
    async (getRoot) => {
      await writeFixture();
      vi.stubEnv('LOGICAPPS_LOCAL_CANDIDATE_ROOT', getRoot());
      await expect(getLocalCandidate()).rejects.toThrow(/root must not|root must be/);
    }
  );
});
