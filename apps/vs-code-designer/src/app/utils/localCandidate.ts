/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as semver from 'semver';
import { parseStringPromise } from 'xml2js';
import { defaultDependencyPathValue, defaultExtensionBundlePathValue, extensionBundleId } from '../../constants';

interface CandidateArtifact {
  path: string;
  version: string;
  sha256: string;
}

export interface LocalCandidate {
  bundle: CandidateArtifact;
  sdk: CandidateArtifact & { packageId: 'Microsoft.Azure.Workflows.Sdk' };
  root: string;
  bundleRoot: string;
  bundlePath: string;
  dependenciesPath: string;
  sdkPath: string;
  manifestPath: string;
  /** Missing native/RID assets are diagnostics, not proof of supported platform functionality. */
  missingPlatformAssets?: string[];
}

const ownerFile = '.logicapps-local-candidate.json';
const sdkId = 'Microsoft.Azure.Workflows.Sdk';
type Entries = Map<string, Buffer>;
interface ValidatedCandidate {
  candidate: LocalCandidate;
  entries: Entries;
  sdkBytes: Buffer;
  manifestHash: string;
}

function fail(message: string): never {
  throw new Error(`Local Logic Apps candidate: ${message}`);
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function artifact(value: unknown, label: 'bundle' | 'sdk'): CandidateArtifact {
  const item = record(value, label);
  if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
    fail(`${label}.path must be absolute.`);
  }
  const fourPartBundleVersion =
    label === 'bundle' &&
    typeof item.version === 'string' &&
    /^\d+\.\d+\.\d+\.\d+$/.test(item.version) &&
    item.version.split('.').every((component) => Number.isSafeInteger(Number(component)) && Number(component) <= 2147483647);
  if (
    typeof item.version !== 'string' ||
    (!fourPartBundleVersion && (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(item.version) || !semver.valid(item.version)))
  ) {
    fail(`${label}.version must be an exact semantic version${label === 'bundle' ? ' or a four-part numeric bundle version' : ''}.`);
  }
  if (typeof item.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(item.sha256)) {
    fail(`${label}.sha256 must be a 64-character SHA256.`);
  }
  return { path: item.path, version: item.version, sha256: item.sha256.toLowerCase() };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function rejectSymlinks(file: string): Promise<void> {
  let current = path.resolve(file);
  while (true) {
    if ((await exists(current)) && (await fs.lstat(current)).isSymbolicLink()) {
      fail(`symbolic links are not allowed: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function validateRoot(root: string): Promise<void> {
  if (!path.isAbsolute(root) || root === path.parse(root).root || path.dirname(root) === path.parse(root).root) {
    fail('root must be an explicit, dedicated private directory, not a broad filesystem root.');
  }
  const home = path.resolve(os.homedir());
  const sharedRoots = [path.dirname(defaultDependencyPathValue), path.dirname(defaultExtensionBundlePathValue)];
  if (
    within(root, home) ||
    path.relative(root, path.resolve(os.tmpdir())) === '' ||
    sharedRoots.some((shared) => within(shared, root) || within(root, shared))
  ) {
    fail('root must not be the home, temporary, or shared bundle directory.');
  }
  let ancestor = process.cwd();
  if (path.relative(root, ancestor) === '') {
    fail('root must not be the current working directory.');
  }
  while (true) {
    if ((await exists(path.join(ancestor, '.git'))) && within(root, ancestor)) {
      fail('root must not be the repository root or one of its ancestors.');
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      break;
    }
    ancestor = parent;
  }
  await rejectSymlinks(root);
}

function safeEntryName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const parts = normalized.replace(/\/$/, '').split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[<>:"|?*]/.test(part) ||
        [...part].some((char) => char.charCodeAt(0) < 32) ||
        /[. ]$/.test(part)
    ) ||
    parts.some((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))
  ) {
    fail(`unsafe archive entry: ${name}`);
  }
  return normalized;
}

function archive(bytes: Buffer, label: string): Entries {
  const entries: Entries = new Map();
  const names = new Set<string>();
  for (const entry of new AdmZip(bytes).getEntries()) {
    const name = safeEntryName(entry.entryName);
    const mode = (entry.attr >>> 16) & 0xf000;
    if (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) {
      fail(`${label} contains a symbolic link or special file: ${name}`);
    }
    const key = name.replace(/\/$/, '').toLowerCase();
    if (names.has(key)) {
      fail(`${label} contains duplicate entries: ${name}`);
    }
    names.add(key);
    if (!entry.isDirectory) {
      entries.set(name, entry.getData());
    }
  }
  const files = new Set([...entries.keys()].map((name) => name.toLowerCase()));
  for (const name of entries.keys()) {
    const parts = name.split('/');
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join('/').toLowerCase())) {
        fail(`${label} contains conflicting file and directory paths.`);
      }
      parts.pop();
    }
  }
  return entries;
}

function required(entries: Entries, name: string): Buffer {
  const bytes = entries.get(name);
  if (!bytes?.length) {
    fail(`required package file missing or empty: ${name}`);
  }
  return bytes;
}

function validateBundle(entries: Entries, version: string): string[] {
  const bundle = record(JSON.parse(required(entries, 'bundle.json').toString()), 'bundle.json');
  if (bundle.id !== extensionBundleId || bundle.version !== version) {
    fail('bundle.json ID/version does not match the selected candidate.');
  }
  const extensions = record(JSON.parse(required(entries, 'bin/extensions.json').toString()), 'extensions.json');
  if (!Array.isArray(extensions.extensions) || extensions.extensions.length === 0) {
    fail('extensions.json must contain extension registrations.');
  }
  required(entries, 'bin/Microsoft.Azure.Workflows.Templates.Languages.Edge.CSharp.dll');
  const deps = record(JSON.parse(required(entries, 'bin/function.deps.json').toString()), 'function.deps.json');
  const targets = record(deps.targets, 'function.deps.json targets');
  let runtimeAssets = 0;
  const missingPlatformAssets = new Set<string>();
  for (const target of Object.values(targets)) {
    for (const library of Object.values(record(target, 'dependency target'))) {
      const assets = record(library, 'dependency library');
      // Satellite resources are optional: resource lookup falls back to the neutral
      // assembly, and published bundles intentionally omit localized satellites.
      for (const category of ['runtime', 'native', 'runtimeTargets']) {
        if (!assets[category]) {
          continue;
        }
        for (const asset of Object.keys(record(assets[category], category))) {
          const name = safeEntryName(asset);
          if (path.posix.basename(name) === '_._') {
            continue;
          }
          // Functions bundles flatten managed runtime assets into bin, while native
          // and RID-specific assets may retain their relative package paths.
          if (!entries.has(`bin/${name}`) && !entries.has(`bin/${path.posix.basename(name)}`)) {
            if (category === 'runtime') {
              fail(`bundle runtime dependency missing: ${asset}`);
            }
            missingPlatformAssets.add(name);
          }
          // Match the existing bundleFeed structural gate: only .runtime closure
          // is mandatory. Preserve missing native/RID assets for inspection.
          if (category === 'runtime') {
            runtimeAssets++;
          }
        }
      }
    }
  }
  if (!runtimeAssets) {
    fail('function.deps.json contains no runtime assets.');
  }
  return [...missingPlatformAssets].sort();
}

async function validateSdk(entries: Entries, version: string): Promise<void> {
  const nuspecs = [...entries.keys()].filter((name) => !name.includes('/') && name.toLowerCase().endsWith('.nuspec'));
  if (nuspecs.length !== 1) {
    fail('SDK must contain one root nuspec.');
  }
  const spec = await parseStringPromise(required(entries, nuspecs[0]).toString(), { explicitArray: false });
  if (spec?.package?.metadata?.id !== sdkId || spec?.package?.metadata?.version !== version) {
    fail('SDK nuspec ID/version does not match the selected candidate.');
  }
  for (const pattern of [
    /^lib\/netstandard2\.0\/[^/]+\.dll$/i,
    /^buildTransitive\/.*\.props$/i,
    /^buildTransitive\/.*\.targets$/i,
    /^tools\/workflow-build\/.*\.runtimeconfig\.json$/i,
  ]) {
    if (![...entries].some(([name, bytes]) => pattern.test(name) && bytes.length > 0)) {
      fail(`SDK is missing its complete runtime/build payload (${pattern.source}).`);
    }
  }
}

async function validate(): Promise<ValidatedCandidate | undefined> {
  const manifestPath = process.env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST;
  const requestedRoot = process.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT;
  if (manifestPath === undefined && requestedRoot === undefined) {
    return undefined;
  }
  if (!manifestPath || !requestedRoot || !path.isAbsolute(manifestPath) || !path.isAbsolute(requestedRoot)) {
    fail('LOGICAPPS_LOCAL_CANDIDATE_MANIFEST and LOGICAPPS_LOCAL_CANDIDATE_ROOT must both be absolute paths.');
  }
  const root = path.resolve(requestedRoot);
  await validateRoot(root);
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = record(JSON.parse(manifestBytes.toString()), 'manifest');
  if (manifest.schemaVersion !== 1) {
    fail('manifest schemaVersion must be 1.');
  }
  const bundle = artifact(manifest.bundle, 'bundle');
  const sdkArtifact = artifact(manifest.sdk, 'sdk');
  if (record(manifest.sdk, 'sdk').packageId !== sdkId) {
    fail(`sdk.packageId must be ${sdkId}.`);
  }
  if (path.extname(bundle.path).toLowerCase() !== '.zip' || path.extname(sdkArtifact.path).toLowerCase() !== '.nupkg') {
    fail('bundle must be a ZIP and SDK must be a nupkg.');
  }
  const bundleRoot = path.join(root, 'bundles');
  const dependenciesPath = path.join(root, 'dependencies');
  const candidate: LocalCandidate = {
    bundle,
    sdk: { ...sdkArtifact, packageId: sdkId },
    root,
    bundleRoot,
    bundlePath: path.join(bundleRoot, extensionBundleId, bundle.version),
    dependenciesPath,
    sdkPath: path.join(dependenciesPath, 'LanguageServerLogicApps', `${sdkId}.${sdkArtifact.version}.nupkg`),
    manifestPath,
  };
  const [bundleBytes, sdkBytes] = await Promise.all([fs.readFile(bundle.path), fs.readFile(sdkArtifact.path)]);
  if (hash(bundleBytes) !== bundle.sha256 || hash(sdkBytes) !== sdkArtifact.sha256) {
    fail('artifact SHA256 mismatch.');
  }
  const entries = archive(bundleBytes, 'bundle');
  const missingPlatformAssets = validateBundle(entries, bundle.version);
  if (missingPlatformAssets.length) {
    candidate.missingPlatformAssets = missingPlatformAssets;
  }
  await validateSdk(archive(sdkBytes, 'SDK'), sdkArtifact.version);
  return { candidate, entries, sdkBytes, manifestHash: hash(manifestBytes) };
}

/** Validate the opt-in descriptor and both original artifacts without writing anything. */
export async function getLocalCandidate(): Promise<LocalCandidate | undefined> {
  return (await validate())?.candidate;
}

async function checkInstalled(validated: ValidatedCandidate): Promise<void> {
  const { candidate, manifestHash, entries } = validated;
  await rejectSymlinks(candidate.root);
  await rejectSymlinks(path.join(candidate.root, ownerFile));
  const marker = JSON.parse(await fs.readFile(path.join(candidate.root, ownerFile), 'utf8'));
  if (marker.schemaVersion !== 1 || marker.manifestHash !== manifestHash || marker.manifestPath !== candidate.manifestPath) {
    fail('private root belongs to a different or modified manifest; select a new root.');
  }
  await rejectSymlinks(candidate.sdkPath);
  if (hash(await fs.readFile(candidate.sdkPath)) !== candidate.sdk.sha256) {
    fail('installed SDK is corrupt; select a new private root.');
  }
  await rejectSymlinks(candidate.bundlePath);
  const remaining = new Map(entries);
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`;
      if (item.isSymbolicLink()) {
        fail(`installed bundle contains a symbolic link: ${name}`);
      }
      if (item.isDirectory()) {
        await walk(path.join(directory, item.name), `${name}/`);
      } else if (item.isFile()) {
        const expected = remaining.get(name);
        if (!expected || hash(await fs.readFile(path.join(directory, item.name))) !== hash(expected)) {
          fail(`installed bundle is corrupt: ${name}; select a new private root.`);
        }
        remaining.delete(name);
      } else {
        fail(`installed bundle contains a special file: ${name}`);
      }
    }
  }
  await walk(candidate.bundlePath);
  if (remaining.size) {
    fail(`installed bundle is incomplete: ${remaining.keys().next().value}; select a new private root.`);
  }
}

/** Read-only health check; unlike installation, missing files are always errors. */
export async function assertLocalCandidateInstalled(): Promise<LocalCandidate | undefined> {
  const validated = await validate();
  if (!validated) {
    return undefined;
  }
  await checkInstalled(validated);
  return validated.candidate;
}

const installs = new Map<string, Promise<void>>();

async function install(validated: ValidatedCandidate): Promise<void> {
  const { candidate, entries, sdkBytes, manifestHash } = validated;
  if (await exists(candidate.root)) {
    // The caller verifies every installed byte after awaiting installation.
    return;
  }
  const stage = `${candidate.root}.staging-${randomUUID()}`;
  try {
    await fs.mkdir(stage, { recursive: true });
    const stageBundle = path.join(stage, path.relative(candidate.root, candidate.bundlePath));
    for (const [name, bytes] of entries) {
      const destination = path.join(stageBundle, ...name.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: 'wx' });
    }
    const stageSdk = path.join(stage, path.relative(candidate.root, candidate.sdkPath));
    await fs.mkdir(path.dirname(stageSdk), { recursive: true });
    await fs.writeFile(stageSdk, sdkBytes, { flag: 'wx' });
    await fs.writeFile(
      path.join(stage, ownerFile),
      JSON.stringify({ schemaVersion: 1, manifestHash, manifestPath: candidate.manifestPath }),
      { flag: 'wx' }
    );
    await rejectSymlinks(candidate.root);
    if (await exists(candidate.root)) {
      await checkInstalled(validated);
    } else {
      await fs.rename(stage, candidate.root);
    }
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

/** Install the complete pair atomically into a new private root; never repair or overwrite corruption. */
export async function ensureLocalCandidateInstalled(): Promise<LocalCandidate | undefined> {
  const validated = await validate();
  if (!validated) {
    return undefined;
  }
  const { candidate } = validated;
  let pending = installs.get(candidate.root);
  if (!pending) {
    pending = install(validated);
    installs.set(candidate.root, pending);
  }
  try {
    await pending;
    await checkInstalled(validated);
    return candidate;
  } finally {
    if (installs.get(candidate.root) === pending) {
      installs.delete(candidate.root);
    }
  }
}
