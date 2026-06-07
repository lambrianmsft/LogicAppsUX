import * as fse from 'fs-extra';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidProjectName, isValidWorkflowName, resolveProjectCreationWorkspaceRoot } from '../tools/projectTools';

describe('isValidProjectName', () => {
  describe('valid names', () => {
    it('should accept simple alphabetic name', () => {
      expect(isValidProjectName('MyLogicApp')).toBe(true);
    });

    it('should accept name starting with lowercase letter', () => {
      expect(isValidProjectName('myLogicApp')).toBe(true);
    });

    it('should accept name with digits', () => {
      expect(isValidProjectName('LogicApp123')).toBe(true);
    });

    it('should accept name with underscores', () => {
      expect(isValidProjectName('Logic_App')).toBe(true);
    });

    it('should accept name with hyphens', () => {
      expect(isValidProjectName('Logic-App')).toBe(true);
    });

    it('should accept single letter name', () => {
      expect(isValidProjectName('A')).toBe(true);
    });

    it('should accept mixed valid characters', () => {
      expect(isValidProjectName('My_Logic-App123')).toBe(true);
    });

    it('should accept typical project names', () => {
      expect(isValidProjectName('OrderManagement')).toBe(true);
      expect(isValidProjectName('Invoice-Processing')).toBe(true);
      expect(isValidProjectName('API_Gateway_v2')).toBe(true);
    });
  });

  describe('invalid names', () => {
    it('should reject name starting with digit', () => {
      expect(isValidProjectName('123App')).toBe(false);
    });

    it('should reject name starting with underscore', () => {
      expect(isValidProjectName('_App')).toBe(false);
    });

    it('should reject name starting with hyphen', () => {
      expect(isValidProjectName('-App')).toBe(false);
    });

    it('should reject name with spaces', () => {
      expect(isValidProjectName('My Logic App')).toBe(false);
    });

    it('should reject name with special characters', () => {
      expect(isValidProjectName('My@App')).toBe(false);
      expect(isValidProjectName('My#App')).toBe(false);
      expect(isValidProjectName('My$App')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidProjectName('')).toBe(false);
    });

    it('should reject name with dots', () => {
      expect(isValidProjectName('My.App')).toBe(false);
    });

    it('should reject name with slashes', () => {
      expect(isValidProjectName('My/App')).toBe(false);
      expect(isValidProjectName('My\\App')).toBe(false);
    });
  });
});

describe('isValidWorkflowName', () => {
  it('accepts workflow names with letters, digits, underscores and hyphens', () => {
    expect(isValidWorkflowName('OrderProcessing')).toBe(true);
    expect(isValidWorkflowName('Order_Processing_2')).toBe(true);
    expect(isValidWorkflowName('Order-Processing-2')).toBe(true);
  });

  it('rejects invalid workflow names', () => {
    expect(isValidWorkflowName('')).toBe(false);
    expect(isValidWorkflowName('123Workflow')).toBe(false);
    expect(isValidWorkflowName('_Workflow')).toBe(false);
    expect(isValidWorkflowName('Workflow Name')).toBe(false);
    expect(isValidWorkflowName('Workflow.Name')).toBe(false);
  });
});

describe('resolveProjectCreationWorkspaceRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the workspace file folder for an empty workspace container', async () => {
    const workspaceRoot = path.resolve('empty-workspace');
    vi.mocked(fse.pathExists).mockResolvedValue(false);

    await expect(resolveProjectCreationWorkspaceRoot(path.join(workspaceRoot, 'empty-workspace.code-workspace'))).resolves.toBe(
      workspaceRoot
    );
  });

  it('uses the parent folder when the workspace file is inside an existing Logic App project', async () => {
    const workspaceRoot = path.resolve('workspace-with-project');
    const existingProjectRoot = path.join(workspaceRoot, 'ExistingProject');
    mockLogicAppProjectRoot(existingProjectRoot);

    await expect(resolveProjectCreationWorkspaceRoot(path.join(existingProjectRoot, 'ExistingProject.code-workspace'))).resolves.toBe(
      workspaceRoot
    );
  });

  it('uses the parent folder when the workspace file is nested below an existing Logic App project', async () => {
    const workspaceRoot = path.resolve('workspace-with-nested-file');
    const existingProjectRoot = path.join(workspaceRoot, 'ExistingProject');
    mockLogicAppProjectRoot(existingProjectRoot);

    await expect(
      resolveProjectCreationWorkspaceRoot(path.join(existingProjectRoot, '.vscode', 'ExistingProject.code-workspace'))
    ).resolves.toBe(workspaceRoot);
  });

  it('keeps sibling project creation at the workspace container when the workspace file is already outside projects', async () => {
    const workspaceRoot = path.resolve('workspace-with-sibling-project');
    const existingProjectRoot = path.join(workspaceRoot, 'ExistingProject');
    mockLogicAppProjectRoot(existingProjectRoot);

    await expect(resolveProjectCreationWorkspaceRoot(path.join(workspaceRoot, 'workspace.code-workspace'))).resolves.toBe(workspaceRoot);
  });

  it('does not inspect the filesystem above a root workspace folder', async () => {
    const rootFolder = path.parse(process.cwd()).root;
    vi.mocked(fse.pathExists).mockResolvedValue(false);

    await expect(resolveProjectCreationWorkspaceRoot(path.join(rootFolder, 'root.code-workspace'))).resolves.toBe(rootFolder);
    expect(fse.pathExists).not.toHaveBeenCalled();
  });
});

function mockLogicAppProjectRoot(projectRoot: string): void {
  const hostJsonPath = path.join(projectRoot, 'host.json');
  const workflowFolderPath = path.join(projectRoot, 'Workflow');
  const workflowJsonPath = path.join(workflowFolderPath, 'workflow.json');

  vi.mocked(fse.pathExists).mockImplementation(async (filePath) => {
    const normalizedPath = path.normalize(String(filePath));
    return normalizedPath === path.normalize(hostJsonPath) || normalizedPath === path.normalize(workflowJsonPath);
  });

  vi.mocked(fse.readdir).mockImplementation(async (folderPath) => {
    const normalizedPath = path.normalize(String(folderPath));
    if (normalizedPath === path.normalize(projectRoot)) {
      return ['Workflow'];
    }
    if (normalizedPath === path.normalize(workflowFolderPath)) {
      return ['workflow.json'];
    }
    return [];
  });

  vi.mocked(fse.readFile).mockImplementation(async (filePath) => {
    const normalizedPath = path.normalize(String(filePath));
    if (normalizedPath === path.normalize(hostJsonPath)) {
      return JSON.stringify({ version: '2.0', extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows' } });
    }
    if (normalizedPath === path.normalize(workflowJsonPath)) {
      return JSON.stringify({
        definition: {
          $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        },
      });
    }
    return '';
  });
}
