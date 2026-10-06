import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import { apiUtils } from '@microsoft/vscode-azext-utils';
import { getAzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../../extensionVariables';
import { initializeResourceGroupsApi } from '../getExtensionApi';

vi.mock('@microsoft/vscode-azext-utils', () => ({
  apiUtils: { getExtensionExports: vi.fn() },
}));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
  getAzureResourcesExtensionApi: vi.fn(),
}));
vi.mock('../../../extensionVariables', () => ({ ext: {} }));
vi.mock('../../../localize', () => ({
  localize: (_key: string, message: string) => message,
}));

describe('Azure Resources activation prerequisite', () => {
  const context = { subscriptions: [] } as ExtensionContext;
  const root = { getSubscriptionPromptStep: vi.fn(), dispose: vi.fn() };
  const api = { appResourceTree: { _rootTreeItem: root } };
  const v2 = { resources: {} };

  beforeEach(() => {
    vi.resetAllMocks();
    Reflect.deleteProperty(ext, 'rgApi');
    Reflect.deleteProperty(ext, 'rgApiV2');
    Reflect.deleteProperty(ext, 'azureAccountTreeItem');
    vi.mocked(apiUtils.getExtensionExports).mockResolvedValue({
      getApi: vi.fn().mockReturnValue(api),
    });
    vi.mocked(getAzureResourcesExtensionApi).mockResolvedValue(v2 as Awaited<ReturnType<typeof getAzureResourcesExtensionApi>>);
  });

  it('initializes the previously absent receiver before the normal subscription picker is used', async () => {
    expect(ext.azureAccountTreeItem).toBeUndefined();
    await initializeResourceGroupsApi(context);
    expect(ext.rgApi).toBe(api);
    expect(ext.rgApiV2).toBe(v2);
    expect(ext.azureAccountTreeItem).toBe(root);
    expect(apiUtils.getExtensionExports).toHaveBeenCalledWith('ms-azuretools.vscode-azureresourcegroups');
    expect(getAzureResourcesExtensionApi).toHaveBeenCalledWith(context, '2.0.0');
    expect(root.getSubscriptionPromptStep).not.toHaveBeenCalled();
  });

  it('waits for dependency activation instead of exposing an uninitialized receiver', async () => {
    let provideExports: (value: { getApi: () => typeof api }) => void = () => {
      throw new Error('Dependency promise was not initialized.');
    };
    vi.mocked(apiUtils.getExtensionExports).mockReturnValueOnce(
      new Promise((resolve) => {
        provideExports = resolve;
      })
    );
    const initialization = initializeResourceGroupsApi(context);
    expect(ext.azureAccountTreeItem).toBeUndefined();
    provideExports({ getApi: () => api });
    await initialization;
    expect(ext.azureAccountTreeItem).toBe(root);
  });

  it.each([undefined, {}, { getSubscriptionPromptStep: 'incompatible' }])(
    'reports an incompatible subscription API explicitly (%j)',
    async (invalidRoot) => {
      vi.mocked(apiUtils.getExtensionExports).mockResolvedValue({
        getApi: vi.fn().mockReturnValue({ appResourceTree: { _rootTreeItem: invalidRoot } }),
      });
      await expect(initializeResourceGroupsApi(context)).rejects.toThrow('Azure Resources did not provide its subscription picker API');
      expect(ext.azureAccountTreeItem).toBeUndefined();
      expect(getAzureResourcesExtensionApi).not.toHaveBeenCalled();
    }
  );

  it('does not publish partially initialized APIs when v2 acquisition fails', async () => {
    vi.mocked(getAzureResourcesExtensionApi).mockRejectedValueOnce(new Error('v2 unavailable'));
    await expect(initializeResourceGroupsApi(context)).rejects.toThrow('v2 unavailable');
    expect(ext.rgApi).toBeUndefined();
    expect(ext.rgApiV2).toBeUndefined();
    expect(ext.azureAccountTreeItem).toBeUndefined();
  });

  it('reports a missing dependency rather than hiding its failure', async () => {
    vi.mocked(apiUtils.getExtensionExports).mockResolvedValueOnce(undefined);
    await expect(initializeResourceGroupsApi(context)).rejects.toThrow('Could not find the Azure Resource Groups extension');
  });

  it('awaits API initialization before registering commands or scheduling activation consumers', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const source = ts.createSourceFile(
      'main.ts',
      readFileSync(new URL('../../../main.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const activation = source.statements.find(
      (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'activate'
    );
    expect(activation?.body).toBeDefined();
    const statements = activation!.body!.statements;
    const initializationIndex = statements.findIndex(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isAwaitExpression(statement.expression) &&
        ts.isCallExpression(statement.expression.expression) &&
        statement.expression.expression.expression.getText(source) === 'initializeResourceGroupsApi'
    );
    expect(initializationIndex).toBeGreaterThan(-1);
    const telemetryIndex = statements.findIndex((statement) => {
      return statement.getText(source).includes('callWithTelemetryAndErrorHandling(extensionCommand.activate');
    });
    expect(telemetryIndex).toBeGreaterThan(initializationIndex);
    const consumers = statements[telemetryIndex].getText(source);
    expect(consumers).toContain('registerCommands()');
    expect(consumers).toContain('await startLanguageServer()');
    expect(consumers).toContain('await startDesignTime(');
  });
});
