import { parameterizeConnection, areAllConnectionsParameterized, validateConnectionAuthenticationParameters } from '../parameterizer';
import type {
  ConnectionReferenceModel,
  FunctionConnectionModel,
  APIManagementConnectionModel,
  ConnectionsData,
  Parameter,
} from '@microsoft/vscode-extension-logic-apps';
import { describe, it, expect } from 'vitest';

describe('areAllConnectionsParameterized', () => {
  it('should return true when all connections are parameterized', () => {
    const apimApiIDNotParamBaseURLIs: ConnectionsData = {
      managedApiConnections: {
        connection1: {
          api: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/providers/Microsoft.Web/locations/@{appsetting('WORKFLOWS_LOCATION_NAME')}/managedApis/connection1",
          },
          connection: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{appsetting('WORKFLOWS_RESOURCE_GROUP_NAME')}/providers/Microsoft.Web/connections/connection1",
          },
          connectionRuntimeUrl: "@parameters('connection1-ConnectionRuntimeUrl')",
          authentication: {
            type: 'Raw',
            scheme: 'Key',
            parameter: "@appsetting('connection1-connectionKey')",
          },
        },
      },
      functionConnections: {
        function1: {
          function: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{parameters('azureFunctionOperation-ResourceGroup')}/providers/Microsoft.Web/sites/@{parameters('azureFunctionOperation-SiteName')}/functions/HttpTrigger",
          },
          triggerUrl: "@parameters('azureFunctionOperation-TriggerUrl')",
          authentication: {
            type: 'QueryString',
            name: 'Code',
            value: "@appsetting('azureFunctionOperation_functionAppKey')",
          },
          displayName: 'func01',
        },
      },
      apiManagementConnections: {
        apiManagement1: {
          apiId:
            '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.ApiManagement/service/vscodeservicename/apis/echo-api',
          baseUrl: "@parameters('apiManagementOperation-BaseUrl')",
          subscriptionKey: "@appsetting('apiManagementOperation_SubscriptionKey')",
          displayName: 'api01',
        },
      },
    };

    const apiIDNotParamRuntimeURLIs: ConnectionsData = {
      managedApiConnections: {
        connection1: {
          api: {
            id: '/subscriptions/workflows-subscription-id/providers/Microsoft.Web/locations/workflows-location-name/managedApis/connection1',
          },
          connection: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{appsetting('WORKFLOWS_RESOURCE_GROUP_NAME')}/providers/Microsoft.Web/connections/connection1",
          },
          connectionRuntimeUrl: "@parameters('connection1-ConnectionRuntimeUrl')",
          authentication: {
            type: 'Raw',
            scheme: 'Key',
            parameter: "@appsetting('connection1-connectionKey')",
          },
        },
      },
      functionConnections: {
        function1: {
          function: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{parameters('azureFunctionOperation-ResourceGroup')}/providers/Microsoft.Web/sites/@{parameters('azureFunctionOperation-SiteName')}/functions/HttpTrigger",
          },
          triggerUrl: "@parameters('azureFunctionOperation-TriggerUrl')",
          authentication: {
            type: 'QueryString',
            name: 'Code',
            value: "@appsetting('azureFunctionOperation_functionAppKey')",
          },
          displayName: 'func01',
        },
      },
      apiManagementConnections: {
        apiManagement1: {
          apiId:
            '/subscriptions/@{appsetting(WORKFLOWS_SUBSCRIPTION_ID)}/resourceGroups/@{parameters(azureFunctionOperation-ResourceGroup)}/providers/Microsoft.ApiManagement/service/vscodeservicename/apis/echo-api',
          baseUrl: "@parameters('apiManagementOperation-BaseUrl')",
          subscriptionKey: "@appsetting('apiManagementOperation_SubscriptionKey')",
          displayName: 'api01',
        },
      },
    };

    expect(areAllConnectionsParameterized(apimApiIDNotParamBaseURLIs)).toBe(true);
    expect(areAllConnectionsParameterized(apiIDNotParamRuntimeURLIs)).toBe(true);
  });

  it('should return false when not all connections are parameterized', () => {
    const connectionsData: ConnectionsData = {
      managedApiConnections: {
        connection1: {
          api: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/providers/Microsoft.Web/locations/@{appsetting('WORKFLOWS_LOCATION_NAME')}/managedApis/connection1",
          },
          connection: {
            id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{appsetting('WORKFLOWS_RESOURCE_GROUP_NAME')}/providers/Microsoft.Web/connections/connection1",
          },
          connectionRuntimeUrl: "@parameters('connection1-ConnectionRuntimeUrl')",
          authentication: {
            type: 'Raw',
            scheme: 'Key',
            parameter: "@appsetting('connection1-connectionKey')",
          },
        },
      },
      functionConnections: {
        function1: {
          function: {
            id: '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.Web/sites/vscodesite/functions/HttpTrigger',
          },
          triggerUrl: 'https://vscodesite.azurewebsites.net/api/httptrigger',
          authentication: {
            type: 'QueryString',
            name: 'Code',
            value: "@appsetting('azureFunctionOperation_functionAppKey')",
          },
          displayName: 'func01',
        },
      },
      apiManagementConnections: {
        apiManagement1: {
          apiId:
            '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.ApiManagement/service/vscodeservicename/apis/echo-api',
          baseUrl: "@parameters('apiManagementOperation-BaseUrl')",
          subscriptionKey: "@appsetting('apiManagementOperation_SubscriptionKey')",
          displayName: 'api01',
        },
      },
    };

    const result = areAllConnectionsParameterized(connectionsData);
    expect(result).toBe(false);
  });

  it('should return true when connectionsData is empty', () => {
    const connectionsData: ConnectionsData = {};

    const result = areAllConnectionsParameterized(connectionsData);
    expect(result).toBe(true);
  });
});

describe('parameterizeConnection for ConnectionReferenceModel', () => {
  it('should parameterize Connection Reference', () => {
    let connection: ConnectionReferenceModel = {
      api: {
        id: '/subscriptions/subscription-test-id/providers/Microsoft.Web/locations/eastus2/managedApis/applicationinsights',
      },
      connection: {
        id: '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.Web/connections/applicationinsights',
      },
      connectionRuntimeUrl: 'https://common.logic-centralus.azure-apihub.net/apim/applicationinsights/12345/',
      authentication: {
        type: 'Raw',
        scheme: 'Key',
        parameter: "@appsetting('arm-connectionKey')",
      },
    };

    const parameters: any = {};
    const settings: Record<string, string> = {};
    connection = parameterizeConnection(connection, 'applicationinsights', parameters, settings) as ConnectionReferenceModel;

    const expected = {
      api: {
        id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/providers/Microsoft.Web/locations/@{appsetting('WORKFLOWS_LOCATION_NAME')}/managedApis/applicationinsights",
      },
      connection: {
        id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{appsetting('WORKFLOWS_RESOURCE_GROUP_NAME')}/providers/Microsoft.Web/connections/applicationinsights",
      },
      connectionRuntimeUrl: "@parameters('applicationinsights-ConnectionRuntimeUrl')",
      authentication: "@parameters('applicationinsights-Authentication')",
      connectionProperties: null,
    };

    expect(connection.api.id).toBe(expected.api.id);
    expect(connection.connection.id).toBe(expected.connection.id);
    expect(connection.connectionRuntimeUrl).toBe(expected.connectionRuntimeUrl);
    expect(connection.authentication).toBe(expected.authentication);
    expect(Object.keys(parameters).length).toBe(2);
    expect(Object.keys(settings).length).toBe(1);
    expect(parameters['applicationinsights-ConnectionRuntimeUrl']).toBeDefined();
    expect(parameters['applicationinsights-Authentication']).toBeDefined();
  });

  it('should parameterize Connection Reference for custom connector', () => {
    let connection: ConnectionReferenceModel = {
      api: {
        id: '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug-connector/providers/Microsoft.Web/customApis/customconnector',
      },
      connection: {
        id: '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.Web/connections/customconnector',
      },
      connectionRuntimeUrl: 'https://common.logic-centralus.azure-apihub.net/apim/customconnector/12345/',
      authentication: {
        type: 'ManagedServiceIdentity',
      },
    };

    const parameters: any = {};
    const settings: Record<string, string> = {};
    connection = parameterizeConnection(connection, 'customconnector', parameters, settings) as ConnectionReferenceModel;

    const expected = {
      api: {
        id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{appsetting('CUSTOM_CONNECTOR_RESOURCE_GROUP_NAME')}/providers/Microsoft.Web/customApis/customconnector",
      },
      connection: {
        id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{appsetting('WORKFLOWS_RESOURCE_GROUP_NAME')}/providers/Microsoft.Web/connections/customconnector",
      },
      connectionRuntimeUrl: "@parameters('customconnector-ConnectionRuntimeUrl')",
      authentication: "@parameters('customconnector-Authentication')",
      connectionProperties: null,
    };

    expect(connection.api.id).toBe(expected.api.id);
    expect(connection.connection.id).toBe(expected.connection.id);
    expect(connection.connectionRuntimeUrl).toBe(expected.connectionRuntimeUrl);
    expect(connection.authentication).toBe(expected.authentication);
    expect(Object.keys(parameters).length).toBe(2);
    expect(Object.keys(settings).length).toBe(2);
    expect(settings['CUSTOM_CONNECTOR_RESOURCE_GROUP_NAME']).toBeDefined();
    expect(settings['CUSTOM_CONNECTOR_RESOURCE_GROUP_NAME']).toEqual('vs-code-debug-connector');
    expect(parameters['customconnector-ConnectionRuntimeUrl']).toBeDefined();
    expect(parameters['customconnector-Authentication']).toBeDefined();
  });
});

describe('parameterizeConnection for FunctionConnectionModel', () => {
  it('should parameterize Connection Reference', () => {
    let connection: FunctionConnectionModel = {
      function: {
        id: '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.Web/sites/vscodesite/functions/HttpTrigger',
      },
      triggerUrl: 'https://vscodesite.azurewebsites.net/api/httptrigger',
      authentication: {
        type: 'QueryString',
        name: 'Code',
        value: "@appsetting('azureFunctionOperation_functionAppKey')",
      },
      displayName: 'func01',
    };

    const parameters: any = {};
    const settings: Record<string, string> = {};
    connection = parameterizeConnection(connection, 'azureFunctionOperation', parameters, settings) as FunctionConnectionModel;

    const expected = {
      function: {
        id: "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{parameters('azureFunctionOperation-ResourceGroup')}/providers/Microsoft.Web/sites/@{parameters('azureFunctionOperation-SiteName')}/functions/HttpTrigger",
      },
      triggerUrl: "@parameters('azureFunctionOperation-TriggerUrl')",
      authentication: {
        type: 'QueryString',
        name: 'Code',
        value: "@appsetting('azureFunctionOperation_functionAppKey')",
      },
      displayName: 'func01',
    };

    expect(connection.function.id).toBe(expected.function.id);
    expect(connection.triggerUrl).toBe(expected.triggerUrl);
    expect(connection.authentication).toStrictEqual(expected.authentication);
    expect(Object.keys(parameters).length).toBe(3);
    expect(Object.keys(settings).length).toBe(0);
    expect(parameters['azureFunctionOperation-ResourceGroup']).toBeDefined();
    expect(parameters['azureFunctionOperation-SiteName']).toBeDefined();
    expect(parameters['azureFunctionOperation-TriggerUrl']).toBeDefined();
  });
});

describe('parameterizeConnection for APIManagementConnectionModel', () => {
  it('should parameterize Connection Reference', () => {
    let connection: APIManagementConnectionModel = {
      apiId:
        '/subscriptions/subscription-test-id/resourceGroups/vs-code-debug/providers/Microsoft.ApiManagement/service/vscodeservicename/apis/echo-api',
      baseUrl: "@parameters('apiManagementOperation-BaseUrl')",
      subscriptionKey: "@appsetting('apiManagementOperation_SubscriptionKey')",
      displayName: 'api01',
    };

    const parameters: any = {};
    const settings: Record<string, string> = {};
    connection = parameterizeConnection(connection, 'apiManagementOperation', parameters, settings) as APIManagementConnectionModel;

    const expected = {
      apiId:
        "/subscriptions/@{appsetting('WORKFLOWS_SUBSCRIPTION_ID')}/resourceGroups/@{parameters('apiManagementOperation-ResourceGroup')}/providers/Microsoft.ApiManagement/service/@{parameters('apiManagementOperation-ServiceName')}/apis/echo-api",
      baseUrl: "@parameters('apiManagementOperation-BaseUrl')",
      subscriptionKey: "@appsetting('apiManagementOperation_SubscriptionKey')",
      displayName: 'api01',
    };

    expect(connection.apiId).toBe(expected.apiId);
    expect(connection.baseUrl).toBe(expected.baseUrl);
    expect(connection.subscriptionKey).toBe(expected.subscriptionKey);
    expect(Object.keys(parameters).length).toBe(2);
    expect(Object.keys(settings).length).toBe(0);
    expect(parameters['apiManagementOperation-ResourceGroup']).toBeDefined();
    expect(parameters['apiManagementOperation-ServiceName']).toBeDefined();
    expect(parameters['apiManagementOperation-BaseUrl']).toBeUndefined();
  });
});

describe('existing connection parameter preservation', () => {
  const makeConnection = (reference = 'arm-1'): ConnectionReferenceModel => ({
    api: { id: '/subscriptions/synthetic/providers/Microsoft.Web/locations/eastus/managedApis/fixture' },
    connection: { id: `/subscriptions/synthetic/resourceGroups/fixture/providers/Microsoft.Web/connections/${reference}` },
    connectionRuntimeUrl: 'https://synthetic.invalid/runtime',
    authentication: { type: 'Raw', scheme: 'Key', parameter: `@appsetting('${reference}-connectionKey')` },
  });

  it.each(['@appsetting', '@APPSETTING', '@{appsetting', '@{APPSETTING'])(
    'does not request parameterization for an existing %s runtime URL with a literal API ID',
    (prefix) => {
      const connection = makeConnection();
      connection.connectionRuntimeUrl = `${prefix}('arm-1-ConnectionRuntimeUrl')${prefix.includes('{') ? '}' : ''}`;
      expect(areAllConnectionsParameterized({ managedApiConnections: { 'arm-1': connection } })).toBe(true);
    }
  );

  it('preserves authentication objects, runtime parameters and settings on repeated parameterization', () => {
    const connection = makeConnection();
    const parameters: Record<string, Parameter> = {};
    const settings: Record<string, string> = {};
    parameterizeConnection(connection, 'arm-1', parameters, settings);
    const original = structuredClone({ connection, parameters, settings });
    parameterizeConnection(connection, 'arm-1', parameters, settings);
    expect({ connection, parameters, settings }).toEqual(original);
    expect(parameters['arm-1-Authentication'].value).toEqual({
      type: 'Raw',
      scheme: 'Key',
      parameter: "@appsetting('arm-1-connectionKey')",
    });
    expect(settings['arm-1-ConnectionRuntimeUrl']).toBe('https://synthetic.invalid/runtime');
  });

  it('preserves existing custom-connector resource-group settings on repeated parameterization', () => {
    const connection = makeConnection();
    connection.api.id = '/subscriptions/synthetic/resourceGroups/fixture/providers/Microsoft.Web/customApis/fixture';
    const parameters: Record<string, Parameter> = {};
    const settings: Record<string, string> = {};
    parameterizeConnection(connection, 'custom', parameters, settings);
    const original = structuredClone({ connection, parameters, settings });
    parameterizeConnection(connection, 'custom', parameters, settings);
    expect({ connection, parameters, settings }).toEqual(original);
    expect(settings.CUSTOM_CONNECTOR_RESOURCE_GROUP_NAME).toBe('fixture');
  });

  it('does not move an existing appsetting runtime reference into the setting value', () => {
    const connection = makeConnection();
    connection.connectionRuntimeUrl = "@appsetting('arm-1-ConnectionRuntimeUrl')";
    const settings = { 'arm-1-ConnectionRuntimeUrl': 'https://synthetic.invalid/original' };
    const parameters: Record<string, Parameter> = {};
    parameterizeConnection(connection, 'arm-1', parameters, settings);
    expect(connection.connectionRuntimeUrl).toBe("@appsetting('arm-1-ConnectionRuntimeUrl')");
    expect(settings).toEqual({ 'arm-1-ConnectionRuntimeUrl': 'https://synthetic.invalid/original' });
    expect(parameters).not.toHaveProperty('arm-1-ConnectionRuntimeUrl');
  });

  it('preserves custom authentication parameter references and their valid nested appsetting values', () => {
    const connection = makeConnection();
    connection.authentication = "@parameters('custom-auth')";
    const parameters: Record<string, Parameter> = { 'custom-auth': { type: 'Object', value: { fixture: "@APPSETTING('synthetic')" } } };
    const original = structuredClone(parameters);
    parameterizeConnection(connection, 'arm-1', parameters, {});
    expect(connection.authentication).toBe("@parameters('custom-auth')");
    expect(parameters['custom-auth']).toEqual(original['custom-auth']);
    expect(parameters).not.toHaveProperty('arm-1-Authentication');
  });

  it("preserves a parameter reference with an escaped quote in the parameter's name", () => {
    const connection = makeConnection();
    connection.authentication = "@parameters('team''s-auth')";
    const parameters: Record<string, Parameter> = { "team's-auth": { type: 'Object', value: { fixture: "@appsetting('synthetic')" } } };
    const original = structuredClone(parameters);
    parameterizeConnection(connection, 'arm-1', parameters, {});
    expect(connection.authentication).toBe("@parameters('team''s-auth')");
    expect(parameters["team's-auth"]).toEqual(original["team's-auth"]);
    expect(parameters).not.toHaveProperty('arm-1-Authentication');
    expect(() => validateConnectionAuthenticationParameters({ managedApiConnections: { 'arm-1': connection } }, {})).toThrow(
      'known-good backup'
    );
  });

  it.each([
    "@concat(parameters('synthetic'), '')",
    "literal@{parameters('synthetic')}",
    "@appsetting(parameters('synthetic'))",
    "@appsetting('synthetic').property",
    "@appsetting('synthetic'",
  ])('rejects evaluated invalid runtime expressions, including nested functions', (value) => {
    const connection = makeConnection();
    connection.authentication = "@parameters('arm-1-Authentication')";
    const parameters: Record<string, Parameter> = { 'arm-1-Authentication': { type: 'Object', value: { fixture: value } } };
    const original = structuredClone(parameters);
    expect(() => parameterizeConnection(connection, 'arm-1', parameters, {})).toThrow('known-good backup');
    expect(parameters).toEqual(original);
  });

  it.each(["literal@parameters('text')", "@@parameters('text')", "prefix@{appsetting('synthetic')}suffix"])(
    'preserves valid literal text and appsetting-only interpolation',
    (value) => {
      const connection = makeConnection();
      connection.authentication = "@parameters('arm-1-Authentication')";
      const parameters: Record<string, Parameter> = { 'arm-1-Authentication': { type: 'Object', value: { fixture: value } } };
      expect(() =>
        validateConnectionAuthenticationParameters({ managedApiConnections: { 'arm-1': connection } }, parameters)
      ).not.toThrow();
    }
  );

  it('rejects malformed authentication references before any in-memory changes', () => {
    const connection = makeConnection();
    connection.authentication = "@parameters('synthetic'";
    const original = structuredClone(connection);
    const parameters: Record<string, Parameter> = {};
    const settings: Record<string, string> = {};
    expect(() => parameterizeConnection(connection, 'arm-1', parameters, settings)).toThrow('Correct its expression');
    expect(connection).toEqual(original);
    expect(parameters).toEqual({});
    expect(settings).toEqual({});
  });

  it('rejects raw authentication objects containing disallowed expressions before creating runtime parameters', () => {
    const connection = makeConnection();
    connection.authentication = { type: 'Raw', scheme: 'Key', parameter: "@concat(parameters('synthetic'), '')" };
    const original = structuredClone(connection);
    const parameters: Record<string, Parameter> = {};
    const settings: Record<string, string> = {};
    expect(() => parameterizeConnection(connection, 'arm-1', parameters, settings)).toThrow(
      'Runtime parameter values allow only @appsetting'
    );
    expect(connection).toEqual(original);
    expect(parameters).toEqual({});
    expect(settings).toEqual({});
  });

  it('preserves an appsetting runtime reference whose setting name contains an escaped quote', () => {
    const connection = makeConnection();
    connection.connectionRuntimeUrl = "@appsetting('team''s-runtime')";
    const parameters: Record<string, Parameter> = {};
    const settings = { "team's-runtime": 'https://synthetic.invalid/runtime' };
    parameterizeConnection(connection, 'arm-1', parameters, settings);
    expect(connection.connectionRuntimeUrl).toBe("@appsetting('team''s-runtime')");
    expect(settings).toEqual({ "team's-runtime": 'https://synthetic.invalid/runtime' });
    expect(parameters).not.toHaveProperty('arm-1-ConnectionRuntimeUrl');
  });

  it.each([
    "@parameters('arm-1-Authentication')",
    "@PARAMETERS('different-auth')",
    { nested: [{ fixture: "@{parameters('different-auth')}" }] },
  ])('rejects pre-existing disallowed authentication parameter lookups without replacing their values', (value) => {
    const connection = makeConnection();
    connection.authentication = "@parameters('arm-1-Authentication')";
    const parameters: Record<string, Parameter> = { 'arm-1-Authentication': { type: 'Object', value } };
    const original = structuredClone(parameters);
    expect(() => validateConnectionAuthenticationParameters({ managedApiConnections: { 'arm-1': connection } }, parameters)).toThrow(
      'Restore its original authentication value'
    );
    expect(() => parameterizeConnection(connection, 'arm-1', parameters, {})).toThrow('known-good backup');
    expect(parameters).toEqual(original);
  });

  it('rejects missing referenced authentication parameters rather than inventing credentials', () => {
    const connection = makeConnection();
    connection.authentication = "@parameters('arm-1-Authentication')";
    expect(() => validateConnectionAuthenticationParameters({ managedApiConnections: { 'arm-1': connection } }, {})).toThrow(
      'cannot be reconstructed'
    );
  });

  it('does not mistake escaped literal expression text for a lookup', () => {
    const connection = makeConnection();
    connection.authentication = "@parameters('arm-1-Authentication')";
    const parameters: Record<string, Parameter> = {
      'arm-1-Authentication': { type: 'Object', value: { fixture: "@@parameters('literal')" } },
    };
    expect(() => validateConnectionAuthenticationParameters({ managedApiConnections: { 'arm-1': connection } }, parameters)).not.toThrow();
  });

  it('preserves function parameter values on repeated parameterization', () => {
    const connection: FunctionConnectionModel = {
      function: { id: '/subscriptions/synthetic/resourceGroups/fixture/providers/Microsoft.Web/sites/fixture/functions/trigger' },
      triggerUrl: 'https://synthetic.invalid/trigger',
      authentication: { type: 'QueryString', name: 'Code', value: "@appsetting('synthetic-key')" },
      displayName: 'fixture',
    };
    const parameters: Record<string, Parameter> = {};
    parameterizeConnection(connection, 'function', parameters, {});
    const original = structuredClone({ connection, parameters });
    parameterizeConnection(connection, 'function', parameters, {});
    expect({ connection, parameters }).toEqual(original);
  });
});
