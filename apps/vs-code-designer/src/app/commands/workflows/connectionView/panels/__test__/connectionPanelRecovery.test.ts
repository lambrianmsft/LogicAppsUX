import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as azext from '@microsoft/vscode-azext-utils';
import { env, window, type WebviewPanel } from 'vscode';
import { ext } from '../../../../../../extensionVariables';
import { localize } from '../../../../../../localize';
import { cacheWebviewPanel, removeWebviewPanelFromCache } from '../../../../../utils/codeless/common';
import { getLogicAppProjectRoot } from '../../../../../utils/codeless/connection';
import { startDesignTimeApi } from '../../../../../utils/codeless/startDesignTimeApi';

const { panels } = vi.hoisted(() => ({ panels: new Map<string, WebviewPanel>() }));

vi.mock('../../../../../utils/codeless/common', () => ({
  cacheWebviewPanel: vi.fn(),
  removeWebviewPanelFromCache: vi.fn(),
}));
vi.mock('../../../../../utils/codeless/connection', () => ({
  getLogicAppProjectRoot: vi.fn(),
}));
vi.mock('../../../../../utils/codeless/startDesignTimeApi', () => ({ startDesignTimeApi: vi.fn() }));
vi.mock('../../../../azureConnectors/azureConnectorDetails', () => ({ getAzureConnectorDetailsForLocalProject: vi.fn() }));
vi.mock('../../../../../utils/codeless/getAuthorizationToken', () => ({ getAuthorizationToken: vi.fn() }));
vi.mock('../../../../../utils/codeless/artifacts', () => ({ getArtifactsInLocalProject: vi.fn() }));
vi.mock('../../../../../utils/appSettings/localSettings', () => ({ getLocalSettingsJson: vi.fn() }));
vi.mock('../../../../../utils/bundleFeed', () => ({ getBundleVersionNumber: vi.fn() }));
vi.mock('../../../../../utils/codeless/parameter', () => ({ saveWorkflowParameter: vi.fn() }));
vi.mock('../../../../../../localize', () => ({ localize: vi.fn((_key, message) => message) }));
vi.mock('../../../designer/panels/designerPanel', () => ({
  DesignerPanel: class {
    constructor(
      public context: azext.IActionContext,
      _filePath: string,
      public panelName: string,
      _apiVersion: string,
      public panelGroupKey: string
    ) {}
    getExistingPanel() {
      return panels.get(this.panelName);
    }
    getPanelOptions() {
      return {};
    }
  },
}));

const { default: ConnectionPanel } = await import('../connectionPanel');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ConnectionPanel initialization recovery', () => {
  const projectPath = 'C:\\test\\project';
  const telemetryContexts: azext.IActionContext[] = [];
  const helperNotifications = vi.fn();
  let panel: WebviewPanel;
  let htmlWrites: string[];
  let instance: ConnectionPanel;
  let metadata: ReturnType<typeof vi.fn>;
  let content: ReturnType<typeof vi.fn>;
  let order: string[];

  function createInstance() {
    const result = new ConnectionPanel(
      { telemetry: { properties: {} } } as azext.IActionContext,
      `${projectPath}\\workflow.cs`,
      'TestMethod',
      'test-connector',
      'builtin',
      { Start: { Line: 0, Character: 0 }, End: { Line: 0, Character: 10 } },
      ''
    );
    Object.assign(result, { getConnectionPanelMetadata: metadata, getWebviewContent: content });
    return result;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    panels.clear();
    telemetryContexts.length = 0;
    htmlWrites = [];
    order = [];
    ext.context = { extensionPath: 'C:\\extension', subscriptions: [] } as any;
    ext.designTimeInstances.clear();
    ext.designTimeInstances.set(projectPath, { port: 8000 });
    vi.mocked(getLogicAppProjectRoot).mockResolvedValue(projectPath);
    vi.mocked(startDesignTimeApi).mockResolvedValue(undefined);
    vi.mocked(localize).mockImplementation((_key, message) => message);
    vi.mocked(env.asExternalUri).mockImplementation(async (uri) => uri);
    vi.mocked(azext.parseError).mockImplementation(
      (error) =>
        ({
          message: error instanceof Error ? error.message : String(error),
          isUserCancelledError: error instanceof azext.UserCancelledError,
        }) as any
    );
    // Match the real helper: ordinary errors are swallowed unless rethrow is set;
    // user cancellation is swallowed even when rethrow is set.
    vi.spyOn(azext, 'callWithTelemetryAndErrorHandling').mockImplementation(async (_key, callback) => {
      const context = { telemetry: { properties: {} }, errorHandling: {} } as azext.IActionContext;
      telemetryContexts.push(context);
      try {
        return await callback(context);
      } catch (error) {
        if (error instanceof azext.UserCancelledError) {
          return undefined;
        }
        if (!context.errorHandling.suppressDisplay) {
          helperNotifications(error);
        }
        if (context.errorHandling.rethrow) {
          throw error;
        }
        return undefined;
      }
    });
    vi.mocked(cacheWebviewPanel).mockImplementation((_group, name, value) => {
      panels.set(name, value);
    });
    vi.mocked(removeWebviewPanelFromCache).mockImplementation((_group, name) => {
      panels.delete(name);
    });
    vi.mocked(window.createWebviewPanel).mockImplementation(() => {
      let onDispose: () => void;
      const result = {
        active: true,
        reveal: vi.fn(),
        dispose: vi.fn(() => onDispose()),
        onDidDispose: vi.fn((callback) => {
          onDispose = callback;
          return { dispose: vi.fn() };
        }),
        webview: {
          get html() {
            return htmlWrites.at(-1) ?? '';
          },
          set html(value: string) {
            htmlWrites.push(value);
            order.push(value === '<html>React</html>' ? 'react' : 'status');
          },
          onDidReceiveMessage: vi.fn(() => {
            order.push('handler');
            return { dispose: vi.fn() };
          }),
        },
      } as unknown as WebviewPanel;
      panel = result;
      return result;
    });
    metadata = vi.fn().mockResolvedValue({ connectionsData: {}, localSettings: {}, extensionBundleVersion: '1.0.0' });
    content = vi.fn().mockResolvedValue('<html>React</html>');
    instance = createInstance();
  });

  it('registers the message handler before assigning React HTML', async () => {
    await instance.create();
    expect(order).toEqual(['status', 'handler', 'react']);
    expect(panels.size).toBe(1);
    expect(ext.context.subscriptions).toContain(panel);
    panel.dispose();
    expect(panels.size).toBe(0);
  });

  it.each(['design time', 'metadata', 'callback URI', 'content'])(
    'replaces loading after %s fails and rethrows the original error',
    async (stage) => {
      const failure = new Error('Offline <script>alert("x")</script> & \'cache\'');
      if (stage === 'design time') {
        vi.mocked(startDesignTimeApi).mockRejectedValueOnce(failure);
      } else if (stage === 'metadata') {
        metadata.mockRejectedValueOnce(failure);
      } else if (stage === 'callback URI') {
        vi.mocked(env.asExternalUri).mockRejectedValueOnce(failure);
      } else {
        content.mockRejectedValueOnce(failure);
      }

      await expect(instance.create()).rejects.toBe(failure);

      expect(htmlWrites[0]).toContain('class="spinner"');
      expect(panel.webview.html).toContain('Unable to load the connection view.');
      expect(panel.webview.html).toContain('close this tab and open the connection view again');
      expect(panel.webview.html).toContain('Offline &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;cache&#39;');
      expect(panel.webview.html).not.toContain('<script>');
      expect(panel.webview.html).not.toContain('class="spinner"');
      expect(panel.webview.html).toContain("default-src 'none'");
      expect(panels.size).toBe(0);
      expect(helperNotifications).not.toHaveBeenCalled();
      expect(window.showErrorMessage).not.toHaveBeenCalled();
      expect(telemetryContexts[0].errorHandling).toMatchObject({ rethrow: true, suppressDisplay: true });
    }
  );

  it.each([undefined, {}])('renders an error when the design-time instance has no usable port: %s', async (value) => {
    ext.designTimeInstances.clear();
    if (value) {
      ext.designTimeInstances.set(projectPath, value);
    }
    await expect(instance.create()).rejects.toThrow(/Design time/);
    expect(panel.webview.html).toContain('Unable to load the connection view.');
    expect(content).not.toHaveBeenCalled();
    expect(panels.size).toBe(0);
  });

  it('escapes localized error UI text as well as error details', async () => {
    vi.mocked(localize).mockImplementation((_key, message) => `<img src=x onerror="bad()"> & ${message}`);
    metadata.mockRejectedValueOnce(new Error('failure'));
    await expect(instance.create()).rejects.toThrow('failure');
    expect(panel.webview.html).toContain('&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp;');
    expect(panel.webview.html).not.toContain('<img');
  });

  it.each(['design time', 'metadata'])('closes the loading panel on %s cancellation and preserves the cancellation', async (stage) => {
    const cancellation = new azext.UserCancelledError();
    if (stage === 'design time') {
      vi.mocked(startDesignTimeApi).mockRejectedValueOnce(cancellation);
    } else {
      metadata.mockRejectedValueOnce(cancellation);
    }
    await expect(instance.create()).rejects.toBe(cancellation);
    expect(panel.dispose).toHaveBeenCalledOnce();
    expect(htmlWrites).toHaveLength(1);
    expect(content).not.toHaveBeenCalled();
    expect(panels.size).toBe(0);
    expect(helperNotifications).not.toHaveBeenCalled();
  });

  it('allows a retry and does not evict it when the old failed tab closes', async () => {
    metadata.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(instance.create()).rejects.toThrow('metadata unavailable');
    const failedPanel = panel;

    await createInstance().create();
    const retryPanel = panel;
    failedPanel.dispose();
    expect([...panels.values()]).toEqual([retryPanel]);
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(retryPanel.webview.html).toBe('<html>React</html>');
  });

  it.each(['design time', 'callback URI', 'content'])('does not write or cache again after disposal during %s', async (stage) => {
    const pending = deferred<any>();
    if (stage === 'design time') {
      vi.mocked(startDesignTimeApi).mockReturnValueOnce(pending.promise);
    } else if (stage === 'callback URI') {
      vi.mocked(env.asExternalUri).mockReturnValueOnce(pending.promise);
    } else {
      content.mockReturnValueOnce(pending.promise);
    }
    const creating = instance.create();
    await vi.waitFor(() => {
      expect(stage === 'design time' ? startDesignTimeApi : stage === 'callback URI' ? env.asExternalUri : content).toHaveBeenCalled();
    });
    panel.dispose();
    pending.resolve(stage === 'content' ? '<html>React</html>' : { toString: () => 'callback' });
    await creating;
    expect(htmlWrites).toHaveLength(1);
    expect(panels.size).toBe(0);
    if (stage !== 'content') {
      expect(content).not.toHaveBeenCalled();
    }
  });

  it('preserves a late rejection without writing to a disposed panel', async () => {
    const pending = deferred<void>();
    const failure = new Error('late host failure');
    vi.mocked(startDesignTimeApi).mockReturnValueOnce(pending.promise);
    const creating = instance.create();
    await vi.waitFor(() => expect(startDesignTimeApi).toHaveBeenCalled());
    panel.dispose();
    const rejection = expect(creating).rejects.toBe(failure);
    pending.reject(failure);
    await rejection;
    expect(htmlWrites).toHaveLength(1);
    expect(panels.size).toBe(0);
  });

  it('does not replace an error with React when the other prerequisite finishes later', async () => {
    const pending = deferred<void>();
    vi.mocked(startDesignTimeApi).mockReturnValueOnce(pending.promise);
    metadata.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(instance.create()).rejects.toThrow('metadata unavailable');
    pending.resolve();
    await pending.promise;
    expect(htmlWrites).toHaveLength(2);
    expect(panel.webview.html).toContain('Unable to load the connection view.');
    expect(content).not.toHaveBeenCalled();
  });
});
