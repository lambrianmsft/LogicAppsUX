import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('fs-extra');

import * as fse from 'fs-extra';
import {
  addRealManagedApiConnection,
  getConnectorShortName,
  handleChatOAuthRedirect,
  isMSIAuthEnabled,
  constructManagedApiBasePathFromSettings,
  registerPendingOAuthCallback,
  classifyConnectorAuthType,
  extractUserFacingParameters,
  extractPromptableParameters,
  isHiddenParam,
} from '../tools/workflowTools';

const tempProjectPaths = new Set<string>();
const tempProjectsRoot = path.join(process.cwd(), '.vitest-temp');

async function writeFixture(filePath: string, value: Record<string, unknown> | string): Promise<void> {
  if (typeof value === 'string') {
    await fs.writeFile(filePath, value, 'utf8');
    return;
  }

  await fse.writeJson(filePath, value, { spaces: 2 });
}

async function createTempProject(options?: {
  connectionsData?: Record<string, unknown> | string;
  localSettingsData?: Record<string, unknown> | string;
}): Promise<string> {
  await fse.ensureDir(tempProjectsRoot);
  const projectPath = await fs.mkdtemp(path.join(tempProjectsRoot, 'logicapps-connection-resolution-'));
  tempProjectPaths.add(projectPath);

  if (options?.connectionsData !== undefined) {
    await writeFixture(path.join(projectPath, 'connections.json'), options.connectionsData);
  }

  if (options?.localSettingsData !== undefined) {
    await writeFixture(path.join(projectPath, 'local.settings.json'), options.localSettingsData);
  }

  return projectPath;
}

async function readProjectJson(projectPath: string, fileName: string): Promise<Record<string, unknown>> {
  return (await fse.readJson(path.join(projectPath, fileName))) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all([...tempProjectPaths].map((projectPath) => fse.remove(projectPath)));
  tempProjectPaths.clear();
});

// ─────────────────────────────────────────────────────────────────────
// getConnectorShortName
// ─────────────────────────────────────────────────────────────────────

describe('getConnectorShortName', () => {
  it('extracts short name from full managedApi connector ID', () => {
    expect(getConnectorShortName('/subscriptions/abc/providers/Microsoft.Web/locations/westus/managedApis/outlook')).toBe('outlook');
  });

  it('extracts short name from SQL connector ID', () => {
    expect(getConnectorShortName('/subscriptions/abc/providers/Microsoft.Web/locations/eastus/managedApis/sql')).toBe('sql');
  });

  it('extracts short name from Service Bus connector ID', () => {
    expect(getConnectorShortName('/subscriptions/abc/providers/Microsoft.Web/locations/westus/managedApis/servicebus')).toBe('servicebus');
  });

  it('returns the full string when there are no slashes', () => {
    expect(getConnectorShortName('outlook')).toBe('outlook');
  });

  it('handles trailing slash by returning empty string', () => {
    expect(getConnectorShortName('/subscriptions/abc/managedApis/')).toBe('');
  });

  it('handles single segment with leading slash', () => {
    expect(getConnectorShortName('/outlook')).toBe('outlook');
  });

  it('preserves original casing of connector name', () => {
    expect(getConnectorShortName('/subscriptions/abc/providers/Microsoft.Web/locations/westus/managedApis/Office365')).toBe('Office365');
  });

  it('handles empty string input', () => {
    expect(getConnectorShortName('')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleChatOAuthRedirect
// ─────────────────────────────────────────────────────────────────────

describe('handleChatOAuthRedirect', () => {
  it('returns false when pid is missing from query params', () => {
    expect(handleChatOAuthRedirect({ code: 'abc123' })).toBe(false);
  });

  it('returns false when pid does not match any pending callback', () => {
    expect(handleChatOAuthRedirect({ pid: 'chat-unknown-12345', code: 'abc123' })).toBe(false);
  });

  it('returns false when pid is empty string', () => {
    expect(handleChatOAuthRedirect({ pid: '', code: 'abc123' })).toBe(false);
  });

  it('returns false for designer pid (non-chat prefix)', () => {
    expect(handleChatOAuthRedirect({ pid: 'designer-panel-1', code: 'abc123' })).toBe(false);
  });

  it('returns false when query params object is empty', () => {
    expect(handleChatOAuthRedirect({})).toBe(false);
  });

  it('returns false for undefined pid value', () => {
    expect(handleChatOAuthRedirect({ pid: undefined as unknown as string })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// isMSIAuthEnabled
// ─────────────────────────────────────────────────────────────────────

describe('isMSIAuthEnabled', () => {
  it('returns true for managedServiceIdentity (exact case)', () => {
    expect(isMSIAuthEnabled('managedServiceIdentity')).toBe(true);
  });

  it('returns true for ManagedServiceIdentity (mixed case)', () => {
    expect(isMSIAuthEnabled('ManagedServiceIdentity')).toBe(true);
  });

  it('returns true for MANAGEDSERVICEIDENTITY (all caps)', () => {
    expect(isMSIAuthEnabled('MANAGEDSERVICEIDENTITY')).toBe(true);
  });

  it('returns false for rawKeys', () => {
    expect(isMSIAuthEnabled('rawKeys')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMSIAuthEnabled('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMSIAuthEnabled(undefined)).toBe(false);
  });

  it('returns false for unrelated string', () => {
    expect(isMSIAuthEnabled('oauth2')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// constructManagedApiBasePathFromSettings
// ─────────────────────────────────────────────────────────────────────

describe('constructManagedApiBasePathFromSettings', () => {
  it('returns correct path when both subscription and location are present', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_SUBSCRIPTION_ID: 'sub-123',
      WORKFLOWS_LOCATION_NAME: 'eastus',
    });
    expect(result).toBe('/subscriptions/sub-123/providers/Microsoft.Web/locations/eastus/managedApis/');
  });

  it('returns undefined when only subscription is present', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_SUBSCRIPTION_ID: 'sub-123',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when only location is present', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_LOCATION_NAME: 'eastus',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when neither is present', () => {
    const result = constructManagedApiBasePathFromSettings({});
    expect(result).toBeUndefined();
  });

  it('returns undefined when input is undefined', () => {
    const result = constructManagedApiBasePathFromSettings(undefined);
    expect(result).toBeUndefined();
  });

  it('returns undefined when subscription is empty string', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_SUBSCRIPTION_ID: '',
      WORKFLOWS_LOCATION_NAME: 'eastus',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when location is empty string', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_SUBSCRIPTION_ID: 'sub-123',
      WORKFLOWS_LOCATION_NAME: '',
    });
    expect(result).toBeUndefined();
  });

  it('preserves full subscription GUID and location in path', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_SUBSCRIPTION_ID: '80d4fe69-c95b-4dd2-a938-9250f1c8ab03',
      WORKFLOWS_LOCATION_NAME: 'eastus2euap',
    });
    expect(result).toBe('/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/providers/Microsoft.Web/locations/eastus2euap/managedApis/');
  });

  it('ignores unrelated keys in the settings map', () => {
    const result = constructManagedApiBasePathFromSettings({
      WORKFLOWS_SUBSCRIPTION_ID: 'sub-123',
      WORKFLOWS_LOCATION_NAME: 'westus2',
      AzureWebJobsStorage: 'UseDevelopmentStorage=true',
      WORKFLOWS_TENANT_ID: 'tenant-456',
    });
    expect(result).toBe('/subscriptions/sub-123/providers/Microsoft.Web/locations/westus2/managedApis/');
  });
});

// ─────────────────────────────────────────────────────────────────────
// addRealManagedApiConnection — real file system tests
// ─────────────────────────────────────────────────────────────────────

const handleOAuth = handleChatOAuthRedirect;

describe('addRealManagedApiConnection', () => {
  it('writes Raw Keys authentication structure by default', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'outlook',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/outlook-conn',
      'test-connection-key-123'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.outlook as Record<string, unknown>;
    const auth = conn.authentication as Record<string, unknown>;

    const localSettings = await readProjectJson(projectPath, 'local.settings.json');
    const values = localSettings.Values as Record<string, string>;

    expect(auth.type).toBe('Raw');
    expect(auth.scheme).toBe('Key');
    expect(auth.parameter).toBe("@appsetting('outlook-connectionKey')");
    expect((conn.connection as Record<string, unknown>).id).toBe(
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/outlook-conn'
    );
    expect(values['outlook-connectionKey']).toBe('test-connection-key-123');
  });

  it('writes ManagedServiceIdentity authentication when useMSI is true', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'servicebus',
      '/subscriptions/sub/managedApis/servicebus',
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/sb-conn',
      undefined,
      true
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.servicebus as Record<string, unknown>;
    const auth = conn.authentication as Record<string, unknown>;

    expect(auth.type).toBe('ManagedServiceIdentity');
    expect(auth.scheme).toBeUndefined();
    expect(auth.parameter).toBeUndefined();
    expect(await fse.pathExists(path.join(projectPath, 'local.settings.json'))).toBe(false);
  });

  it('stores connection key in local.settings.json for Raw Keys', async () => {
    const projectPath = await createTempProject({
      localSettingsData: {
        IsEncrypted: false,
        Values: {
          Existing: 'value',
        },
      },
    });

    await addRealManagedApiConnection(
      projectPath,
      'sql',
      '/subscriptions/sub/managedApis/sql',
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/sql-conn',
      'my-secret-key-456'
    );

    const localSettings = await readProjectJson(projectPath, 'local.settings.json');
    const values = localSettings.Values as Record<string, string>;

    expect(values.Existing).toBe('value');
    expect(values['sql-connectionKey']).toBe('my-secret-key-456');
  });

  it('does NOT write local.settings.json when useMSI is true', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'outlook',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/outlook-conn',
      'some-key',
      true
    );

    expect(await fse.pathExists(path.join(projectPath, 'local.settings.json'))).toBe(false);
  });

  it('does NOT write local.settings.json when connectionKey is undefined', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'outlook',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/outlook-conn',
      undefined,
      false
    );

    expect(await fse.pathExists(path.join(projectPath, 'local.settings.json'))).toBe(false);
  });

  it('merges with existing connections.json data', async () => {
    const projectPath = await createTempProject({
      connectionsData: {
        managedApiConnections: {
          existingConn: { api: { id: '/existing' }, connection: { id: '/existing-id' } },
        },
        serviceProviderConnections: { AzureBlob: { serviceProvider: { id: '/sp/blob' } } },
      },
    });

    await addRealManagedApiConnection(
      projectPath,
      'newConn',
      '/subscriptions/sub/managedApis/sql',
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/sql-new',
      'key-789'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;

    expect(managed.existingConn).toBeDefined();
    expect(managed.newConn).toBeDefined();
    expect(connectionsData.serviceProviderConnections).toBeDefined();
  });

  it('preserves api.id and connection.id correctly', async () => {
    const connectorId = '/subscriptions/sub-123/providers/Microsoft.Web/locations/eastus/managedApis/office365';
    const connectionId = '/subscriptions/sub-123/resourceGroups/myRG/providers/Microsoft.Web/connections/office365-abc';
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(projectPath, 'office365', connectorId, connectionId, 'key-abc');

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.office365 as Record<string, unknown>;

    expect((conn.api as Record<string, unknown>).id).toBe(connectorId);
    expect((conn.connection as Record<string, unknown>).id).toBe(connectionId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 2: OAuth callback success/error lifecycle
// ─────────────────────────────────────────────────────────────────────

describe('OAuth callback lifecycle (registerPendingOAuthCallback + handleChatOAuthRedirect)', () => {
  it('resolves with auth code when redirect arrives with matching pid', async () => {
    const pid = 'chat-test-success-1';
    const promise = registerPendingOAuthCallback(pid);

    // Simulate the redirect arriving
    const handled = handleOAuth({ pid, code: 'auth-code-xyz' });

    expect(handled).toBe(true);
    const code = await promise;
    expect(code).toBe('auth-code-xyz');
  });

  it('resolves with "valid" when redirect has no code', async () => {
    const pid = 'chat-test-nocode-2';
    const promise = registerPendingOAuthCallback(pid);

    const handled = handleOAuth({ pid });
    expect(handled).toBe(true);

    const code = await promise;
    expect(code).toBe('valid');
  });

  it('rejects with error when redirect contains error param', async () => {
    const pid = 'chat-test-error-3';
    const promise = registerPendingOAuthCallback(pid);

    const handled = handleOAuth({ pid, error: 'access_denied' });
    expect(handled).toBe(true);

    await expect(promise).rejects.toThrow('access_denied');
  });

  it('returns false and does not affect promise for unmatched pid', async () => {
    const pid = 'chat-test-nomatch-4';
    const promise = registerPendingOAuthCallback(pid);

    // Try with wrong pid
    const handled = handleOAuth({ pid: 'chat-wrong-pid', code: 'abc' });
    expect(handled).toBe(false);

    // Clean up — resolve the actual one so the test doesn't hang
    handleOAuth({ pid, code: 'cleanup' });
    const code = await promise;
    expect(code).toBe('cleanup');
  });

  it('handles two concurrent callbacks independently', async () => {
    const pid1 = 'chat-test-concurrent-a';
    const pid2 = 'chat-test-concurrent-b';
    const promise1 = registerPendingOAuthCallback(pid1);
    const promise2 = registerPendingOAuthCallback(pid2);

    // Resolve second first
    handleOAuth({ pid: pid2, code: 'code-b' });
    handleOAuth({ pid: pid1, code: 'code-a' });

    const [code1, code2] = await Promise.all([promise1, promise2]);
    expect(code1).toBe('code-a');
    expect(code2).toBe('code-b');
  });

  it('second call with same pid after resolution returns false', async () => {
    const pid = 'chat-test-double-5';
    const promise = registerPendingOAuthCallback(pid);

    handleOAuth({ pid, code: 'first' });
    await promise;

    // Second call with same pid should return false (already consumed)
    const handled = handleOAuth({ pid, code: 'second' });
    expect(handled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 2: addRealManagedApiConnection — error resilience
// ─────────────────────────────────────────────────────────────────────

describe('addRealManagedApiConnection — error resilience', () => {
  it('handles corrupted connections.json by starting fresh', async () => {
    const projectPath = await createTempProject({
      connectionsData: '{not-valid-json',
    });

    await addRealManagedApiConnection(
      projectPath,
      'sql',
      '/subscriptions/sub/managedApis/sql',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/sql-conn',
      'key-123'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    expect(managed.sql).toBeDefined();
  });

  it('handles corrupted local.settings.json by starting fresh', async () => {
    const projectPath = await createTempProject({
      localSettingsData: '{not-valid-json',
    });

    await addRealManagedApiConnection(
      projectPath,
      'outlook',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/outlook-conn',
      'key-456'
    );

    const localSettings = await readProjectJson(projectPath, 'local.settings.json');
    const values = localSettings.Values as Record<string, string>;
    expect(values['outlook-connectionKey']).toBe('key-456');
  });

  it('creates managedApiConnections object when connections.json has none', async () => {
    const projectPath = await createTempProject({
      connectionsData: {
        serviceProviderConnections: { AzureBlob: {} },
      },
    });

    await addRealManagedApiConnection(
      projectPath,
      'sql',
      '/subscriptions/sub/managedApis/sql',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/sql-conn',
      'key'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    expect(connectionsData.managedApiConnections).toBeDefined();
    expect((connectionsData.managedApiConnections as Record<string, unknown>).sql).toBeDefined();
    expect(connectionsData.serviceProviderConnections).toBeDefined();
  });

  it('creates Values object when local.settings.json has none', async () => {
    const projectPath = await createTempProject({
      localSettingsData: { IsEncrypted: false },
    });

    await addRealManagedApiConnection(
      projectPath,
      'sb',
      '/subscriptions/sub/managedApis/servicebus',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/sb-conn',
      'key-sb'
    );

    const localSettings = await readProjectJson(projectPath, 'local.settings.json');
    expect(localSettings.IsEncrypted).toBe(false); // Preserved
    const values = localSettings.Values as Record<string, string>;
    expect(values['sb-connectionKey']).toBe('key-sb');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 3: Connection reference naming consistency
// ─────────────────────────────────────────────────────────────────────

describe('addRealManagedApiConnection — naming conventions', () => {
  it('uses referenceName as the key in managedApiConnections', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'my-custom-ref',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/conn-1',
      'key'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    expect(managed['my-custom-ref']).toBeDefined();
    expect(managed.outlook).toBeUndefined(); // Should NOT use connector name
  });

  it('uses referenceName-connectionKey pattern for local settings key', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'office365_v2',
      '/subscriptions/sub/managedApis/office365',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/o365-conn',
      'key-999'
    );

    const localSettings = await readProjectJson(projectPath, 'local.settings.json');
    const values = localSettings.Values as Record<string, string>;
    expect(values['office365_v2-connectionKey']).toBe('key-999');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 3: Multiple connections — no stomping
// ─────────────────────────────────────────────────────────────────────

describe('addRealManagedApiConnection — sequential writes', () => {
  it('second connection write preserves first connection when file is re-read', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'conn1',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/c1',
      'key1'
    );

    await addRealManagedApiConnection(
      projectPath,
      'conn2',
      '/subscriptions/sub/managedApis/sql',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/c2',
      'key2'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const localSettings = await readProjectJson(projectPath, 'local.settings.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const values = localSettings.Values as Record<string, string>;

    expect(managed.conn1).toBeDefined();
    expect(managed.conn2).toBeDefined();
    expect(values['conn1-connectionKey']).toBe('key1');
    expect(values['conn2-connectionKey']).toBe('key2');
  });
});

// ─────────────────────────────────────────────────────────────────────
// classifyConnectorAuthType
// ─────────────────────────────────────────────────────────────────────

describe('classifyConnectorAuthType', () => {
  it('returns "simple" when connector has no connection parameters', () => {
    expect(classifyConnectorAuthType({ name: 'simple-connector' })).toBe('simple');
  });

  it('returns "simple" when all parameters are hidden (token-prefixed)', () => {
    expect(
      classifyConnectorAuthType({
        name: 'hidden-params',
        connectionParameters: {
          token: { type: 'oauthSetting' },
          'token:clientId': { type: 'string' },
          'token:clientSecret': { type: 'securestring' },
        },
      })
    ).toBe('simple');
  });

  it('returns "simple" when all parameters are hidden via uiDefinition', () => {
    expect(
      classifyConnectorAuthType({
        name: 'ui-hidden',
        connectionParameters: {
          internalParam: { type: 'string', uiDefinition: { constraints: { hidden: 'true' } } },
        },
      })
    ).toBe('simple');
  });

  it('returns "oauthOnly" when all visible parameters are OAuth settings', () => {
    expect(
      classifyConnectorAuthType({
        name: 'outlook',
        connectionParameters: {
          token: { type: 'oauthSetting' },
          'token:clientId': { type: 'string' },
          authorizationUrl: { type: 'oauthSetting' },
        },
      })
    ).toBe('oauthOnly');
  });

  it('returns "credential" when visible parameters include string/securestring', () => {
    expect(
      classifyConnectorAuthType({
        name: 'servicebus',
        connectionParameters: {
          connectionString: { type: 'securestring', uiDefinition: { displayName: 'Connection String' } },
        },
      })
    ).toBe('credential');
  });

  it('returns "credential" for SQL-like connector with mixed param types', () => {
    expect(
      classifyConnectorAuthType({
        name: 'sql-single-auth',
        connectionParameters: {
          token: { type: 'oauthSetting' },
          server: { type: 'string', uiDefinition: { displayName: 'SQL server name' } },
          database: { type: 'string', uiDefinition: { displayName: 'SQL database name' } },
          username: { type: 'string' },
          password: { type: 'securestring' },
        },
      })
    ).toBe('credential');
  });

  it('returns "multiAuth" when connectionParameterSets has multiple values', () => {
    expect(
      classifyConnectorAuthType({
        name: 'sql',
        connectionParameterSets: {
          values: [
            {
              name: 'sqlAuthentication',
              parameters: {
                server: { type: 'string' },
                username: { type: 'string' },
                password: { type: 'securestring' },
              },
            },
            {
              name: 'windowsAuthentication',
              parameters: {
                server: { type: 'string' },
              },
            },
          ],
        },
      })
    ).toBe('multiAuth');
  });

  it('returns appropriate type for single connectionParameterSet', () => {
    expect(
      classifyConnectorAuthType({
        name: 'single-set',
        connectionParameterSets: {
          values: [
            {
              name: 'default',
              parameters: {
                apiKey: { type: 'securestring', uiDefinition: { displayName: 'API Key' } },
              },
            },
          ],
        },
      })
    ).toBe('credential');
  });

  it('returns "simple" for single parameter set with only hidden params', () => {
    expect(
      classifyConnectorAuthType({
        name: 'simple-set',
        connectionParameterSets: {
          values: [
            {
              name: 'default',
              parameters: {
                token: { type: 'oauthSetting' },
                'token:clientId': { type: 'string' },
              },
            },
          ],
        },
      })
    ).toBe('simple');
  });

  it('returns "oauthOnly" for single parameter set with only OAuth visible params', () => {
    expect(
      classifyConnectorAuthType({
        name: 'oauth-set',
        connectionParameterSets: {
          values: [
            {
              name: 'default',
              parameters: {
                token: { type: 'oauthSetting' },
                authUrl: { type: 'oauthSetting' },
              },
            },
          ],
        },
      })
    ).toBe('oauthOnly');
  });

  it('returns "simple" when connectionParameters is an empty object', () => {
    expect(
      classifyConnectorAuthType({
        name: 'empty-params',
        connectionParameters: {},
      })
    ).toBe('simple');
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractUserFacingParameters
// ─────────────────────────────────────────────────────────────────────

describe('extractUserFacingParameters', () => {
  it('filters out token-prefixed parameters', () => {
    const result = extractUserFacingParameters({
      token: { type: 'oauthSetting' },
      'token:clientId': { type: 'string' },
      'token:clientSecret': { type: 'securestring' },
      server: { type: 'string' },
    });
    expect(Object.keys(result)).toEqual(['server']);
  });

  it('filters out parameters with hidden constraint', () => {
    const result = extractUserFacingParameters({
      visibleParam: { type: 'string' },
      hiddenParam: { type: 'string', uiDefinition: { constraints: { hidden: 'true' } } },
    });
    expect(Object.keys(result)).toEqual(['visibleParam']);
  });

  it('keeps oauthSetting type parameters (visible for classification)', () => {
    const result = extractUserFacingParameters({
      oauthParam: { type: 'oauthSetting' },
      apiKey: { type: 'securestring' },
    });
    expect(Object.keys(result)).toEqual(['oauthParam', 'apiKey']);
  });

  it('filters out connection type parameters', () => {
    const result = extractUserFacingParameters({
      prerequisiteConn: { type: 'connection' },
      server: { type: 'string' },
    });
    expect(Object.keys(result)).toEqual(['server']);
  });

  it('keeps all parameters when none are hidden', () => {
    const params = {
      server: { type: 'string', uiDefinition: { displayName: 'Server' } },
      database: { type: 'string', uiDefinition: { displayName: 'Database' } },
      password: { type: 'securestring', uiDefinition: { displayName: 'Password' } },
    };
    const result = extractUserFacingParameters(params);
    expect(Object.keys(result)).toEqual(['server', 'database', 'password']);
  });

  it('returns empty object when all parameters are hidden', () => {
    const result = extractUserFacingParameters({
      token: { type: 'oauthSetting' },
      'token:TenantId': { type: 'string' },
    });
    expect(Object.keys(result)).toEqual([]);
  });

  it('returns empty object for empty input', () => {
    expect(Object.keys(extractUserFacingParameters({}))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// isHiddenParam
// ─────────────────────────────────────────────────────────────────────

describe('isHiddenParam', () => {
  it('hides "token" key', () => {
    expect(isHiddenParam('token', { type: 'oauthSetting' })).toBe(true);
  });

  it('hides "token:clientId" key', () => {
    expect(isHiddenParam('token:clientId', { type: 'string' })).toBe(true);
  });

  it('hides parameters with hidden constraint in uiDefinition', () => {
    expect(isHiddenParam('someParam', { type: 'string', uiDefinition: { constraints: { hidden: 'true' } } })).toBe(true);
  });

  it('does not hide oauthSetting type (visible for classification)', () => {
    expect(isHiddenParam('authUrl', { type: 'oauthSetting' })).toBe(false);
  });

  it('hides connection type', () => {
    expect(isHiddenParam('gatewayConn', { type: 'connection' })).toBe(true);
  });

  it('does not hide regular string parameter', () => {
    expect(isHiddenParam('server', { type: 'string' })).toBe(false);
  });

  it('does not hide securestring parameter', () => {
    expect(isHiddenParam('password', { type: 'securestring' })).toBe(false);
  });

  it('is case-insensitive for token prefix', () => {
    expect(isHiddenParam('Token', { type: 'oauthSetting' })).toBe(true);
    expect(isHiddenParam('TOKEN:ClientId', { type: 'string' })).toBe(true);
  });

  it('is case-insensitive for type check', () => {
    expect(isHiddenParam('conn', { type: 'Connection' })).toBe(true);
  });

  it('does not hide when hidden constraint is "false"', () => {
    expect(isHiddenParam('param', { type: 'string', uiDefinition: { constraints: { hidden: 'false' } } })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// addRealManagedApiConnection — connectionRuntimeUrl support
// ─────────────────────────────────────────────────────────────────────

describe('addRealManagedApiConnection — connectionRuntimeUrl', () => {
  it('writes connectionRuntimeUrl when provided', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'outlook',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/outlook-conn',
      'test-key',
      false,
      'https://runtime.azure.com/api/connections/outlook-conn'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.outlook as Record<string, unknown>;

    expect(conn.connectionRuntimeUrl).toBe('https://runtime.azure.com/api/connections/outlook-conn');
  });

  it('omits connectionRuntimeUrl when not provided', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'sql',
      '/subscriptions/sub/managedApis/sql',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/sql-conn',
      'key-123'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.sql as Record<string, unknown>;

    expect(conn.connectionRuntimeUrl).toBeUndefined();
  });

  it('writes connectionRuntimeUrl alongside MSI authentication', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'servicebus',
      '/subscriptions/sub/managedApis/servicebus',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/sb-conn',
      undefined,
      true,
      'https://runtime.azure.com/api/connections/sb-conn'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.servicebus as Record<string, unknown>;

    expect(conn.connectionRuntimeUrl).toBe('https://runtime.azure.com/api/connections/sb-conn');
    expect((conn.authentication as Record<string, unknown>).type).toBe('ManagedServiceIdentity');
  });

  it('writes connectionRuntimeUrl alongside Raw Keys authentication', async () => {
    const projectPath = await createTempProject();

    await addRealManagedApiConnection(
      projectPath,
      'outlook',
      '/subscriptions/sub/managedApis/outlook',
      '/subscriptions/sub/rg/providers/Microsoft.Web/connections/o365-conn',
      'my-key',
      false,
      'https://runtime.azure.com/api/connections/o365'
    );

    const connectionsData = await readProjectJson(projectPath, 'connections.json');
    const managed = connectionsData.managedApiConnections as Record<string, unknown>;
    const conn = managed.outlook as Record<string, unknown>;
    const auth = conn.authentication as Record<string, unknown>;

    expect(conn.connectionRuntimeUrl).toBe('https://runtime.azure.com/api/connections/o365');
    expect(auth.type).toBe('Raw');
    expect(auth.scheme).toBe('Key');
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractPromptableParameters
// ─────────────────────────────────────────────────────────────────────

describe('extractPromptableParameters', () => {
  it('filters out both hidden and oauthSetting parameters', () => {
    const result = extractPromptableParameters({
      token: { type: 'oauthSetting' },
      authUrl: { type: 'oauthSetting' },
      server: { type: 'string', uiDefinition: { displayName: 'Server' } },
      password: { type: 'securestring', uiDefinition: { displayName: 'Password' } },
    });
    expect(Object.keys(result)).toEqual(['server', 'password']);
  });

  it('returns empty for OAuth-only connector', () => {
    const result = extractPromptableParameters({
      token: { type: 'oauthSetting' },
      'token:clientId': { type: 'string' },
      consentUrl: { type: 'oauthSetting' },
    });
    expect(Object.keys(result)).toEqual([]);
  });

  it('keeps credential parameters for non-OAuth connector', () => {
    const result = extractPromptableParameters({
      connectionString: { type: 'securestring', uiDefinition: { displayName: 'Connection String' } },
    });
    expect(Object.keys(result)).toEqual(['connectionString']);
  });

  it('returns empty for connector with only hidden parameters', () => {
    const result = extractPromptableParameters({
      token: { type: 'oauthSetting' },
      'token:TenantId': { type: 'string' },
      hiddenParam: { type: 'string', uiDefinition: { constraints: { hidden: 'true' } } },
    });
    expect(Object.keys(result)).toEqual([]);
  });
});
