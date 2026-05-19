import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  showInputBoxMock,
  showQuickPickMock,
  showWarningMessageMock,
  showInformationMessageMock,
  getAuthorizationTokenMock,
  getAuthDataMock,
} = vi.hoisted(() => ({
  showInputBoxMock: vi.fn(),
  showQuickPickMock: vi.fn(),
  showWarningMessageMock: vi.fn(),
  showInformationMessageMock: vi.fn(),
  getAuthorizationTokenMock: vi.fn(),
  getAuthDataMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showInputBox: showInputBoxMock,
    showQuickPick: showQuickPickMock,
    showWarningMessage: showWarningMessageMock,
    showInformationMessage: showInformationMessageMock,
  },
  env: {
    uriScheme: 'vscode',
    asExternalUri: vi.fn(),
    openExternal: vi.fn(),
  },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
    }),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => false),
    })),
  },
}));

vi.mock('../../utils/codeless/getAuthorizationToken', () => ({
  getAuthorizationToken: getAuthorizationTokenMock,
  getAuthData: getAuthDataMock,
}));

import {
  classifyConnectorAuthType,
  extractPromptableParameters,
  extractUserFacingParameters,
  fetchConnectionKey,
  promptForCredentials,
  resolveConnectorParameterShape,
  testManagedApiConnection,
  type PromptableConnectionParameter,
} from '../tools/workflowTools';

const azureContext = {
  subscriptionId: 'sub',
  tenantId: 'tenant',
  resourceGroup: 'rg',
  location: 'westus',
  managementBaseUrl: 'https://management.azure.com',
  authenticationMethod: 'rawKeys',
};

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('managed connection runtime helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizationTokenMock.mockResolvedValue('Bearer token');
    getAuthDataMock.mockResolvedValue({ accessToken: 'jwt.token.value' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies multi-auth connectors when multiple parameter sets are present', () => {
    const metadata = {
      properties: {
        connectionParameterSets: {
          values: [
            {
              name: 'OAuth',
              parameters: {
                token: {
                  type: 'oauthSetting',
                },
              },
            },
            {
              name: 'Key',
              parameters: {
                apiKey: {
                  type: 'secureString',
                  uiDefinition: {
                    displayName: 'API key',
                    constraints: { required: 'true' },
                  },
                },
              },
            },
          ],
        },
      },
    };

    expect(classifyConnectorAuthType(metadata)).toBe('multiAuth');
  });

  it('classifies single parameter-set connectors with promptable secrets as credential auth', () => {
    const metadata = {
      properties: {
        connectionParameterSets: {
          values: [
            {
              name: 'Key',
              parameters: {
                apiKey: {
                  type: 'secureString',
                  uiDefinition: {
                    displayName: 'API key',
                    constraints: { required: 'true' },
                  },
                },
              },
            },
          ],
        },
      },
    };

    expect(classifyConnectorAuthType(metadata)).toBe('credential');
    expect(resolveConnectorParameterShape(metadata)).toEqual({
      parameterSetName: 'Key',
      displayName: undefined,
      parameters: metadata.properties.connectionParameterSets.values[0].parameters,
    });
  });

  it('classifies hidden-only connectors as simple auth', () => {
    const metadata = {
      properties: {
        connectionParameters: {
          token: {
            type: 'secureString',
            uiDefinition: {
              constraints: {
                hidden: 'true',
              },
            },
          },
        },
      },
    };

    expect(classifyConnectorAuthType(metadata)).toBe('simple');
  });

  it('filters hidden and internal parameters before prompting', () => {
    const parameters = {
      token: {
        type: 'secureString',
      },
      'token:clientSecret': {
        type: 'secureString',
      },
      internalRegion: {
        type: 'string',
      },
      appSettingSecret: {
        type: 'string',
        parameterSource: 'AppConfiguration',
      },
      visibleKey: {
        type: 'secureString',
        uiDefinition: {
          displayName: 'Visible key',
        },
      },
    };

    expect(extractUserFacingParameters(parameters)).toEqual({
      visibleKey: parameters.visibleKey,
    });
  });

  it('builds prompt metadata for secret and allowed-value parameters', () => {
    const parameters = {
      apiKey: {
        type: 'secureString',
        uiDefinition: {
          displayName: 'API key',
          description: 'Paste the key',
          constraints: { required: 'true' },
        },
      },
      environment: {
        type: 'string',
        uiDefinition: {
          displayName: 'Environment',
          constraints: {
            allowedValues: [
              { text: 'Production', value: 'prod' },
              { text: 'Test', value: 'test' },
            ],
          },
        },
      },
      oauth: {
        type: 'oauthSetting',
        uiDefinition: {
          displayName: 'OAuth',
        },
      },
    };

    expect(extractPromptableParameters(parameters)).toEqual([
      {
        name: 'apiKey',
        displayName: 'API key',
        description: 'Paste the key',
        type: 'secureString',
        required: true,
        secret: true,
        allowedValues: undefined,
        defaultValue: undefined,
      },
      {
        name: 'environment',
        displayName: 'Environment',
        description: undefined,
        type: 'string',
        required: false,
        secret: false,
        allowedValues: [
          { label: 'Production', value: 'prod' },
          { label: 'Test', value: 'test' },
        ],
        defaultValue: undefined,
      },
    ]);
  });

  it('preserves prompt values across retries and coerces bool inputs', async () => {
    const parameters: PromptableConnectionParameter[] = [
      {
        name: 'username',
        displayName: 'Username',
        type: 'string',
        required: true,
        secret: false,
      },
      {
        name: 'enabled',
        displayName: 'Enabled',
        type: 'bool',
        required: true,
        secret: false,
      },
    ];
    const preservedValues: Record<string, string> = {};

    showInputBoxMock.mockResolvedValueOnce('first-user').mockResolvedValueOnce('true');

    const firstResult = await promptForCredentials('Contoso', parameters, preservedValues);
    expect(firstResult).toEqual({
      username: 'first-user',
      enabled: true,
    });
    expect(preservedValues).toEqual({
      username: 'first-user',
      enabled: 'true',
    });

    showInputBoxMock.mockResolvedValueOnce('second-user').mockResolvedValueOnce('false');

    await promptForCredentials('Contoso', parameters, preservedValues);

    expect(showInputBoxMock.mock.calls[2][0].value).toBe('first-user');
    expect(showInputBoxMock.mock.calls[3][0].value).toBe('true');
  });

  it('fetches both connection key and runtime url from listConnectionKeys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        connectionKey: 'key-123',
        runtimeUrls: ['https://runtime.example'],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchConnectionKey('/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/sql-conn', azureContext)
    ).resolves.toEqual({
      connectionKey: 'key-123',
      connectionRuntimeUrl: 'https://runtime.example',
    });
  });

  it('treats testRequest failures as connection validation failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            testRequests: [
              {
                method: 'POST',
                requestUri: 'https://management.azure.com/test',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          response: {
            statusCode: 'BadRequest',
            body: {
              message: 'Denied',
            },
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      testManagedApiConnection('/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/sql-conn', azureContext)
    ).resolves.toEqual({
      success: false,
      message: 'Denied',
    });
  });

  it('passes connection validation when the connector test link succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            testLinks: [
              {
                method: 'GET',
                requestUri: 'https://management.azure.com/test',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      testManagedApiConnection('/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/connections/sql-conn', azureContext)
    ).resolves.toEqual({
      success: true,
    });
  });
});
