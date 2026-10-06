import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IActionContext } from '@microsoft/vscode-azext-utils';
import * as fse from 'fs-extra';
import * as path from 'path';
import {
  assertExtensionBundleOnDiskHealthy,
  downloadExtensionBundle,
  ensureExtensionBundleHealthy,
  getBundleVersionNumber,
  getExtensionBundleFolder,
  resetCachedBundleVersion,
} from '../bundleFeed';
import { assertLocalCandidateInstalled, ensureLocalCandidateInstalled, type LocalCandidate } from '../localCandidate';
import { downloadAndExtractDependency } from '../binaries';
import { getJsonFeed } from '../feed';
import { fetchExpectedMd5 } from '../integrity';
import { executeCommand } from '../funcCoreTools/cpUtils';
import { ext } from '../../../extensionVariables';

vi.mock('../localCandidate', () => ({
  ensureLocalCandidateInstalled: vi.fn(),
  assertLocalCandidateInstalled: vi.fn(),
}));
vi.mock('../binaries', () => ({ downloadAndExtractDependency: vi.fn() }));
vi.mock('../feed', () => ({ getJsonFeed: vi.fn() }));
vi.mock('../integrity', () => ({ fetchExpectedMd5: vi.fn(), isMissingPackageError: vi.fn() }));
vi.mock('../funcCoreTools/funcVersion', () => ({ getFunctionsCommand: vi.fn(() => 'func') }));
vi.mock('../funcCoreTools/cpUtils', () => ({ executeCommand: vi.fn() }));
vi.mock('../vsCodeConfig/settings', () => ({ getGlobalSetting: vi.fn() }));
vi.mock('../appSettings/localSettings', () => ({ getLocalSettingsJson: vi.fn() }));
vi.mock('../verifyIsProject', () => ({ tryGetLogicAppProjectRoot: vi.fn() }));
vi.mock('../../state/dependencies', () => ({ recordDependencyUpdateCheck: vi.fn(), shouldCheckForDependencyUpdates: vi.fn() }));
vi.mock('../../../extensionVariables', () => ({
  ext: {
    outputChannel: { appendLog: vi.fn() },
    context: { globalState: { get: vi.fn(), update: vi.fn() } },
    telemetryReporter: { sendTelemetryEvent: vi.fn() },
  },
}));
vi.mock('../codeless/startDesignTimeApi', () => ({ startAllDesignTimeApis: vi.fn() }));

const candidate: LocalCandidate = {
  root: path.resolve('private-candidate'),
  bundleRoot: path.resolve('private-candidate', 'bundles'),
  bundlePath: path.resolve('private-candidate', 'bundles', 'Microsoft.Azure.Functions.ExtensionBundle.Workflows', '1.2.3-local.1'),
  dependenciesPath: path.resolve('private-candidate', 'dependencies'),
  sdkPath: path.resolve('private-candidate', 'dependencies', 'LanguageServerLogicApps', 'Microsoft.Azure.Workflows.Sdk.1.0.0.nupkg'),
  manifestPath: path.resolve('candidate.json'),
  bundle: { path: path.resolve('bundle.zip'), version: '1.2.3-local.1', sha256: 'a'.repeat(64) },
  sdk: { path: path.resolve('sdk.nupkg'), packageId: 'Microsoft.Azure.Workflows.Sdk', version: '1.0.0', sha256: 'b'.repeat(64) },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCachedBundleVersion();
  vi.mocked(ensureLocalCandidateInstalled).mockResolvedValue(candidate);
  vi.mocked(assertLocalCandidateInstalled).mockResolvedValue(candidate);
});

describe('bundle feed local candidate selection', () => {
  it('selects the exact candidate instead of a higher cached directory or host-reported version', async () => {
    vi.mocked(fse.readdir).mockResolvedValue(['99.0.0'] as any);
    vi.mocked(executeCommand).mockResolvedValue(path.resolve('shared-cache') as any);
    expect(await getBundleVersionNumber()).toBe(candidate.bundle.version);
    expect(await getExtensionBundleFolder()).toBe(candidate.bundleRoot);
    expect(fse.readdir).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('installs locally without CDN lookup, sidecar verification, shared state writes, or restart', async () => {
    const context = { telemetry: { properties: {}, measurements: {} } } as IActionContext;
    await downloadExtensionBundle(context);
    expect(ensureLocalCandidateInstalled).toHaveBeenCalled();
    expect(ext.defaultBundleVersion).toBe(candidate.bundle.version);
    expect(ext.latestBundleVersion).toBe(candidate.bundle.version);
    expect(context.telemetry.properties.extensionBundleVersionSource).toBe('localCandidate');
    expect(getJsonFeed).not.toHaveBeenCalled();
    expect(fetchExpectedMd5).not.toHaveBeenCalled();
    expect(downloadAndExtractDependency).not.toHaveBeenCalled();
    expect(ext.context.globalState.update).not.toHaveBeenCalled();
    const { startAllDesignTimeApis } = await import('../codeless/startDesignTimeApi');
    expect(startAllDesignTimeApis).not.toHaveBeenCalled();
  });

  it('validates health every time, even without an action context', async () => {
    await ensureExtensionBundleHealthy();
    await ensureExtensionBundleHealthy();
    expect(ensureLocalCandidateInstalled).toHaveBeenCalledTimes(2);
    expect(await assertExtensionBundleOnDiskHealthy()).toEqual({ ok: true, version: candidate.bundle.version });
    expect(assertLocalCandidateInstalled).toHaveBeenCalledTimes(1);
    await expect(assertExtensionBundleOnDiskHealthy('99.0.0')).rejects.toThrow('does not match');
  });

  it('fails closed on candidate corruption without public repair', async () => {
    const failure = new Error('candidate is corrupt');
    vi.mocked(ensureLocalCandidateInstalled).mockRejectedValue(failure);
    vi.mocked(assertLocalCandidateInstalled).mockRejectedValue(failure);
    const context = { telemetry: { properties: {}, measurements: {} } } as IActionContext;
    await expect(downloadExtensionBundle(context)).rejects.toThrow('candidate is corrupt');
    await expect(ensureExtensionBundleHealthy(context)).rejects.toThrow('candidate is corrupt');
    await expect(getBundleVersionNumber()).rejects.toThrow('candidate is corrupt');
    await expect(getExtensionBundleFolder()).rejects.toThrow('candidate is corrupt');
    await expect(assertExtensionBundleOnDiskHealthy()).rejects.toThrow('candidate is corrupt');
    expect(getJsonFeed).not.toHaveBeenCalled();
    expect(fetchExpectedMd5).not.toHaveBeenCalled();
    expect(downloadAndExtractDependency).not.toHaveBeenCalled();
  });
});
