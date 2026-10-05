import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertLocalCandidateProject,
  getLocalCandidateHostEnvironment,
  initializeLocalCandidateRuntime,
  inspectLocalCandidate,
  isLocalCandidateManualMode,
  recordLocalCandidateLspSdk,
} from '../localCandidateRuntime';
import { generateDesignTimeHostJson, generateHostJson } from '../../projectConsistency/fileGenerators/host';
import { getFuncHostTaskEnv } from '../codeless/funcHostTaskEnv';
import { generateTasksJson } from '../../projectConsistency/fileGenerators/vscodeTasks';
import { ProjectType, ProjectPackageType } from '@microsoft/vscode-extension-logic-apps';

const mocks = vi.hoisted(() => ({ getLocalCandidate: vi.fn(), ensureLocalCandidateInstalled: vi.fn() }));
vi.mock('../localCandidate', () => mocks);

describe('local candidate host and LSP selection', () => {
  const root = path.resolve('private-candidate');
  const candidate = {
    root,
    manifestPath: path.join(root, 'candidate.json'),
    dependenciesPath: path.join(root, 'dependencies'),
    bundlePath: path.join(root, 'bundles', 'Microsoft.Azure.Functions.ExtensionBundle.Workflows', '1.2.3'),
    bundle: { version: '1.2.3' },
    sdkPath: path.join(root, 'dependencies', 'LanguageServerLogicApps', 'Microsoft.Azure.Workflows.Sdk.1.0.0-e2e.abc.nupkg'),
    sdk: { version: '1.0.0-e2e.abc' },
  };
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mocks.getLocalCandidate.mockResolvedValue(undefined);
    mocks.ensureLocalCandidateInstalled.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    mocks.getLocalCandidate.mockResolvedValue(undefined);
    await initializeLocalCandidateRuntime();
  });

  it('leaves normal host environment unchanged', async () => {
    await initializeLocalCandidateRuntime();
    expect(getLocalCandidateHostEnvironment()).toEqual({});
    expect(process.env).toEqual(originalEnv);
  });

  it('requires an explicit manual opt-in and an active candidate without relaxing project isolation', async () => {
    process.env.LOGICAPPS_LOCAL_CANDIDATE_MANUAL = 'true';
    await initializeLocalCandidateRuntime();
    expect(isLocalCandidateManualMode()).toBe(false);
    mocks.getLocalCandidate.mockResolvedValue(candidate);
    await initializeLocalCandidateRuntime();
    expect(isLocalCandidateManualMode()).toBe(true);
    expect(() => assertLocalCandidateProject(path.resolve('shared-project'))).toThrow('isolated candidate root');
    delete process.env.LOGICAPPS_LOCAL_CANDIDATE_MANUAL;
    expect(isLocalCandidateManualMode()).toBe(false);
  });

  it('pins host lookup to the isolated bundle ID directory and exact version', async () => {
    mocks.getLocalCandidate.mockResolvedValue(candidate);
    await initializeLocalCandidateRuntime();
    expect(getLocalCandidateHostEnvironment()).toMatchObject({
      AzureFunctionsJobHost__extensionBundle__downloadPath: path.dirname(candidate.bundlePath),
      AzureFunctionsJobHost__extensionBundle__version: '[1.2.3]',
      AzureFunctionsJobHost__extensionBundle__ensureLatest: 'false',
      FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'http://127.0.0.1:1',
      FUNCTIONS_CORE_TOOLS_OFFLINE: 'false',
    });
    expect(() => assertLocalCandidateProject(path.join(root, 'workspace'))).not.toThrow();
    expect(() => assertLocalCandidateProject(path.resolve('shared-project'))).toThrow('isolated candidate root');
    expect(() => assertLocalCandidateProject(path.resolve('shared-project'))).toThrow(root);
    expect(() => assertLocalCandidateProject(root)).toThrow('isolated candidate root');
    expect(generateHostJson().extensionBundle?.version).toBe('[1.2.3]');
    expect(generateDesignTimeHostJson().extensionBundle).toMatchObject({ version: '[1.2.3]' });
    expect(getFuncHostTaskEnv().options.env).toMatchObject(getLocalCandidateHostEnvironment());
    const tasks = generateTasksJson({
      projectType: ProjectType.codeful,
      projectPackageType: ProjectPackageType.Nuget,
      hasFuncBinaries: true,
    });
    const hostTask = tasks.tasks.find((task) => task.label === 'func: host start');
    expect(hostTask?.command).toBe('node');
    expect(hostTask?.dependsOn).toBe('build');
    expect(hostTask?.args).toEqual([
      expect.stringMatching(/localCandidateHost\.js$/),
      '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}',
      'host',
      'start',
      '--address',
      '127.0.0.1',
    ]);
  });

  it('reports only the exact LSP SDK selection after validating the installation', async () => {
    mocks.getLocalCandidate.mockResolvedValue(candidate);
    mocks.ensureLocalCandidateInstalled.mockResolvedValue(candidate);
    await initializeLocalCandidateRuntime();
    expect(() => recordLocalCandidateLspSdk(path.join(root, 'stock.nupkg'))).toThrow('outside the local candidate');
    recordLocalCandidateLspSdk(candidate.sdkPath);
    expect(await inspectLocalCandidate()).toMatchObject({ sdkPath: candidate.sdkPath, lspSdkPath: candidate.sdkPath });
    expect(mocks.ensureLocalCandidateInstalled).toHaveBeenCalled();
  });
});
