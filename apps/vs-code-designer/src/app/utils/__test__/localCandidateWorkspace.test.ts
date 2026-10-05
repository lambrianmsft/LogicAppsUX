import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalCandidateWorkspace } from '../localCandidateWorkspace';

const mocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  assertProject: vi.fn(),
  exists: vi.fn(),
  create: vi.fn(),
  readJson: vi.fn(),
  writeJson: vi.fn(),
  trusted: true,
}));
vi.mock('../localCandidateRuntime', () => ({
  getActiveLocalCandidate: mocks.candidate,
  assertLocalCandidateProject: mocks.assertProject,
}));
vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() {
      return mocks.trusted;
    },
  },
  Uri: { file: (value: string) => ({ fsPath: value, path: value }) },
}));
vi.mock('fs-extra', () => ({ pathExists: mocks.exists, readJson: mocks.readJson, writeJson: mocks.writeJson }));
vi.mock('../../commands/createNewCodeProject/CodeProjectBase/CreateLogicAppWorkspace', () => ({
  createLogicAppWorkspace: mocks.create,
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
  callWithTelemetryAndErrorHandling: async (_name: string, callback: (context: unknown) => Promise<void>) =>
    callback({ errorHandling: {}, telemetry: { properties: {} } }),
}));

describe('candidate workspace adapter', () => {
  const options = {
    parentPath: path.resolve('candidate', 'scratch'),
    workspaceName: 'Workspace',
    logicAppName: 'LogicApp',
    workflowName: 'Workflow',
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidate.mockReturnValue({});
    mocks.exists.mockResolvedValue(false);
    mocks.create.mockResolvedValue(undefined);
    mocks.readJson.mockResolvedValue({ Values: { WORKFLOW_CODEFUL_ENABLED: 'true' } });
    mocks.writeJson.mockResolvedValue(undefined);
    mocks.trusted = true;
  });

  it('uses real creation without opening a new window', async () => {
    const result = await createLocalCandidateWorkspace(options);
    expect(mocks.assertProject).toHaveBeenCalledWith(options.parentPath);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logicAppType: 'codeful', workflowType: 'Stateful-Codeful', logicAppName: 'LogicApp' }),
      false,
      false
    );
    expect(result.projectPath).toBe(path.join(options.parentPath, 'Workspace', 'LogicApp'));
    expect(mocks.writeJson).toHaveBeenCalledWith(
      path.join(result.projectPath, 'local.settings.json'),
      { Values: { WORKFLOW_CODEFUL_ENABLED: 'true', WORKFLOWS_SUBSCRIPTION_ID: '' } },
      { spaces: 2 }
    );
  });

  it('requires candidate opt-in and workspace trust', async () => {
    mocks.candidate.mockReturnValue(undefined);
    await expect(createLocalCandidateWorkspace(options)).rejects.toThrow('opted-in, trusted');
    mocks.candidate.mockReturnValue({});
    mocks.trusted = false;
    await expect(createLocalCandidateWorkspace(options)).rejects.toThrow('opted-in, trusted');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses to overwrite existing workspaces or traverse through names', async () => {
    mocks.exists.mockResolvedValue(true);
    await expect(createLocalCandidateWorkspace(options)).rejects.toThrow('already exists');
    await expect(createLocalCandidateWorkspace({ ...options, workspaceName: '..' })).rejects.toThrow('C# identifiers');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
