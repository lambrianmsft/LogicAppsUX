import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.unmock('fs-extra');

import {
  AddActionTool,
  isValidWorkflowName,
  createWorkflowDefinition,
  resolveProjectPathCandidates,
  isTriggerType,
  buildTriggerDefinition,
  buildActionDefinition,
  detectWeatherManagedApiReference,
  shouldAutoUseWeatherConnector,
  buildManagedApiConnectionAction,
  resolveManagedApiReferenceName,
  validateApiConnectionReferenceExists,
  selectOperationByActionName,
  resolveSwaggerOperation,
  resolveOfflineManagedConnectorOperation,
  buildServiceProviderAction,
  buildServiceBusConnectionString,
  resolveAppSettingExpressions,
  inferDefaultRunAfter,
  inferParametersFromNaturalText,
  routeParametersToApiConnectionInputs,
  shouldSkipLogicAppProjectDirectory,
  shouldSkipBuiltInServiceProviderResolution,
  constructManagedApiConnectorId,
  getWeatherManagedApiOverrideHints,
  getNextAvailableActionName,
  inferDuplicateActionBehavior,
  normalizeManagedApiConnectorName,
  resolveGenericApiConnectionAction,
  supplementApiConnectionParameters,
  type ProjectConnectionsInfo,
} from '../tools/workflowTools';
import { WorkflowTypeOption } from '../chatConstants';

const tempProjectPaths = new Set<string>();
const tempProjectsRoot = path.join(process.cwd(), '.vitest-temp');
const workflowToolsTestOverridesKey = '__LOGICAPPS_WORKFLOW_TOOLS_TEST_OVERRIDES__';

function setWorkflowToolsTestOverrides(overrides: Record<string, unknown>): void {
  (globalThis as unknown as Record<string, unknown>)[workflowToolsTestOverridesKey] = overrides;
}

function clearWorkflowToolsTestOverrides(): void {
  delete (globalThis as unknown as Record<string, unknown>)[workflowToolsTestOverridesKey];
}

async function createDuplicateActionProject(): Promise<string> {
  await fs.mkdir(tempProjectsRoot, { recursive: true });
  const projectPath = await fs.mkdtemp(path.join(tempProjectsRoot, 'logicapps-duplicate-action-'));
  tempProjectPaths.add(projectPath);
  await fs.writeFile(
    path.join(projectPath, 'host.json'),
    JSON.stringify({ version: '2.0', extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows' } }),
    'utf8'
  );
  await fs.mkdir(path.join(projectPath, 'Stateful1'), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, 'Stateful1', 'workflow.json'),
    JSON.stringify(
      {
        definition: {
          $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
          contentVersion: '1.0.0.0',
          triggers: {},
          actions: {
            Existing_Action: {
              type: 'Compose',
              inputs: 'old',
              runAfter: {},
            },
          },
          outputs: {},
        },
        kind: 'Stateful',
      },
      null,
      2
    ),
    'utf8'
  );
  (vscode.workspace as unknown as { workspaceFolders: Array<{ uri: { fsPath: string } }> }).workspaceFolders = [
    { uri: { fsPath: projectPath } },
  ];
  return projectPath;
}

async function readDuplicateWorkflow(projectPath: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(path.join(projectPath, 'Stateful1', 'workflow.json'), 'utf8')) as Record<string, any>;
}

function getToolResultText(result: vscode.LanguageModelToolResult): string {
  return result.content.map((part) => (part as { value?: string }).value ?? '').join('\n');
}

afterEach(async () => {
  await Promise.all([...tempProjectPaths].map((projectPath) => fs.rm(projectPath, { recursive: true, force: true })));
  tempProjectPaths.clear();
  clearWorkflowToolsTestOverrides();
  (vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = [];
});

describe('resolveProjectPathCandidates', () => {
  const projectPaths = ['/workspace/OrderManagement', '/workspace/TonyProject'];

  it('should return all projects when project name is not provided', () => {
    expect(resolveProjectPathCandidates(projectPaths)).toEqual(projectPaths);
  });

  it('should match exact project name case-insensitively', () => {
    expect(resolveProjectPathCandidates(projectPaths, 'tonyproject')).toEqual(['/workspace/TonyProject']);
  });

  it('should match project name with trailing punctuation', () => {
    expect(resolveProjectPathCandidates(projectPaths, 'TonyProject,')).toEqual(['/workspace/TonyProject']);
  });

  it('should match project name when extra context is included', () => {
    expect(resolveProjectPathCandidates(projectPaths, 'TonyProject, Workflow1')).toEqual(['/workspace/TonyProject']);
  });

  it('should return empty result when no project matches', () => {
    expect(resolveProjectPathCandidates(projectPaths, 'ContosoProject')).toEqual([]);
  });
});

describe('shouldSkipLogicAppProjectDirectory', () => {
  it('skips generated/runtime directories that are not user projects', () => {
    expect(shouldSkipLogicAppProjectDirectory('workflow-designtime')).toBe(true);
    expect(shouldSkipLogicAppProjectDirectory('.debug')).toBe(true);
    expect(shouldSkipLogicAppProjectDirectory('node_modules')).toBe(true);
  });

  it('does not skip normal Logic App project names', () => {
    expect(shouldSkipLogicAppProjectDirectory('test-workspace')).toBe(false);
    expect(shouldSkipLogicAppProjectDirectory('OrderManagement')).toBe(false);
  });
});

describe('managed API connector hint normalization', () => {
  it.each([
    ['/managedapis/weather', 'weather'],
    ['managedApis/msnweather', 'msnweather'],
    ['/subscriptions/sub-123/providers/Microsoft.Web/locations/westus/managedApis/office365', 'office365'],
    ['office365', 'office365'],
    ['/managedApis/', ''],
    ['managedApis', ''],
  ])('normalizes "%s" to "%s"', (input, expected) => {
    expect(normalizeManagedApiConnectorName(input)).toBe(expected);
  });

  it('does not duplicate managedApis when constructing a connector id from a relative hint', () => {
    const result = constructManagedApiConnectorId(
      '/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/providers/Microsoft.Web/locations/eastus2euap/managedApis/',
      '/managedapis/weather'
    );

    expect(result).toBe(
      '/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/providers/Microsoft.Web/locations/eastus2euap/managedApis/weather'
    );
    expect(result).not.toContain('managedApis//managedapis');
  });

  it('uses canonical msnweather hints for weather fallback instead of caller malformed hints', () => {
    expect(getWeatherManagedApiOverrideHints(undefined, undefined, undefined, undefined)).toEqual({
      connectorReference: 'msnweather',
      connectorId: 'msnweather',
      operationId: 'CurrentWeather',
      method: 'get',
      path: undefined,
    });
  });
});

describe('duplicate action naming', () => {
  it('returns the base name when it is available', () => {
    expect(getNextAvailableActionName('Compose', ['Other'])).toBe('Compose');
  });

  it('returns the next numeric suffix when base exists', () => {
    expect(getNextAvailableActionName('Get_Current_Weather', ['Get_Current_Weather'])).toBe('Get_Current_Weather_1');
  });

  it('skips existing numeric suffixes case-insensitively', () => {
    expect(getNextAvailableActionName('Compose', ['compose', 'Compose_1', 'compose_2'])).toBe('Compose_3');
  });

  it('infers replace behavior from update-style prompts', () => {
    expect(inferDuplicateActionBehavior('Update the existing action to use Redmond, WA')).toBe('replace');
    expect(inferDuplicateActionBehavior('Replace this action with the new configuration')).toBe('replace');
  });

  it('infers addNew behavior from separate-action prompts', () => {
    expect(inferDuplicateActionBehavior('Add another weather action for Redmond, WA')).toBe('addNew');
    expect(inferDuplicateActionBehavior('Create a separate action for Redmond, WA')).toBe('addNew');
  });

  it('does not infer duplicate behavior for ambiguous add prompts', () => {
    expect(inferDuplicateActionBehavior('Add weather for Redmond, WA')).toBeUndefined();
  });

  it('asks for duplicate action intent and does not mutate when behavior is unclear', async () => {
    const projectPath = await createDuplicateActionProject();
    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'Compose',
          actionName: 'Existing_Action',
          configuration: { inputs: 'new' },
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    expect(getToolResultText(result)).toContain('already exists');
    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Existing_Action.inputs).toBe('old');
    expect(workflow.definition.actions.Existing_Action_1).toBeUndefined();
  });

  it('replaces duplicate action when requested', async () => {
    const projectPath = await createDuplicateActionProject();
    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'Compose',
          actionName: 'Existing_Action',
          configuration: { inputs: 'new' },
          duplicateActionBehavior: 'replace',
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    expect(getToolResultText(result)).toContain('Successfully replaced action "Existing_Action"');
    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Existing_Action.inputs).toBe('new');
    expect(workflow.definition.actions.Existing_Action_1).toBeUndefined();
  });

  it('adds a suffixed duplicate action when requested', async () => {
    const projectPath = await createDuplicateActionProject();
    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'Compose',
          actionName: 'Existing_Action',
          configuration: { inputs: 'new' },
          duplicateActionBehavior: 'addNew',
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    expect(getToolResultText(result)).toContain('Successfully added action "Existing_Action_1"');
    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Existing_Action.inputs).toBe('old');
    expect(workflow.definition.actions.Existing_Action_1.inputs).toBe('new');
  });
});

describe('resolveGenericApiConnectionAction', () => {
  it('supplements incomplete live weather metadata with path placeholders and offline parameters', () => {
    const supplemented = supplementApiConnectionParameters(
      '/current/{Location}',
      [{ name: 'connectionId', in: 'path', required: true, type: 'string' }],
      [
        { name: 'Location', in: 'path', required: true, type: 'string' },
        {
          name: 'units',
          in: 'query',
          required: false,
          type: 'string',
          enum: ['I', 'C'],
          xMsEnum: {
            values: [
              { value: 'I', displayName: 'Imperial' },
              { value: 'C', displayName: 'Metric' },
            ],
          },
        },
      ]
    );

    expect(supplemented?.map((parameter) => `${parameter.in}:${parameter.name}`)).toEqual([
      'path:connectionId',
      'path:Location',
      'query:units',
    ]);
  });

  it('synthesizes missing non-runtime path placeholders generically', () => {
    const supplemented = supplementApiConnectionParameters('/items/{itemId}/{connectionId}', undefined, undefined);

    expect(supplemented).toEqual([{ name: 'itemId', in: 'path', required: true, type: 'string' }]);
  });

  it('routes captured weather addAction parameters into msnweather action inputs', async () => {
    const projectConnections: ProjectConnectionsInfo = {
      managedApiReferences: ['msnweather'],
      managedApiReferencesWithApiId: ['msnweather'],
      managedApiIdByReference: {
        msnweather: '/subscriptions/sub-123/providers/Microsoft.Web/locations/westus2/managedApis/msnweather',
      },
      serviceProviderReferences: [],
      serviceProviderIdByReference: {},
      weatherManagedReference: 'msnweather',
    };

    const result = await resolveGenericApiConnectionAction(
      'ApiConnection',
      'Get_Current_Weather',
      {
        parameters: { Location: 'Seattle, WA', units: 'Imperial' },
        parameterText: 'Add an action to Stateful1 that gets the current weather for Seattle, WA in Imperial units.',
      },
      projectConnections,
      {
        connectorId: 'msnweather',
        operationId: 'CurrentWeather',
      },
      true
    );

    expect(result.error).toBeUndefined();
    expect(result.action).toEqual({
      type: 'ApiConnection',
      inputs: {
        host: {
          connection: {
            referenceName: 'msnweather',
          },
        },
        method: 'get',
        path: "/current/@{encodeURIComponent('Seattle, WA')}",
        queries: { units: 'I' },
      },
      operationId: 'CurrentWeather',
      runAfter: {},
    });
  });
});

describe('isValidWorkflowName', () => {
  describe('valid names', () => {
    it('should accept simple alphabetic name', () => {
      expect(isValidWorkflowName('OrderProcessor')).toBe(true);
    });

    it('should accept name starting with lowercase letter', () => {
      expect(isValidWorkflowName('orderProcessor')).toBe(true);
    });

    it('should accept name with digits', () => {
      expect(isValidWorkflowName('Order123')).toBe(true);
    });

    it('should accept name with underscores', () => {
      expect(isValidWorkflowName('Order_Processor')).toBe(true);
    });

    it('should accept name with hyphens', () => {
      expect(isValidWorkflowName('Order-Processor')).toBe(true);
    });

    it('should accept single letter name', () => {
      expect(isValidWorkflowName('A')).toBe(true);
    });

    it('should accept mixed valid characters', () => {
      expect(isValidWorkflowName('Order_123-Processor')).toBe(true);
    });
  });

  describe('invalid names', () => {
    it('should reject name starting with digit', () => {
      expect(isValidWorkflowName('123Order')).toBe(false);
    });

    it('should reject name starting with underscore', () => {
      expect(isValidWorkflowName('_Order')).toBe(false);
    });

    it('should reject name starting with hyphen', () => {
      expect(isValidWorkflowName('-Order')).toBe(false);
    });

    it('should reject name with spaces', () => {
      expect(isValidWorkflowName('Order Processor')).toBe(false);
    });

    it('should reject name with special characters', () => {
      expect(isValidWorkflowName('Order@Processor')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidWorkflowName('')).toBe(false);
    });

    it('should reject name with dots', () => {
      expect(isValidWorkflowName('Order.Processor')).toBe(false);
    });
  });
});

describe('createWorkflowDefinition', () => {
  describe('workflow kind mapping', () => {
    it('should create stateful workflow with Stateful kind', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      expect(result.kind).toBe('Stateful');
    });

    it('should create stateless workflow with Stateless kind', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateless);
      expect(result.kind).toBe('Stateless');
    });

    it('should create agentic workflow with Stateful kind', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.agentic);
      expect(result.kind).toBe('Stateful');
    });

    it('should create agent workflow with Stateful kind', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.agent);
      expect(result.kind).toBe('Stateful');
    });
  });

  describe('base definition structure', () => {
    it('should include correct schema', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      const definition = result.definition as Record<string, unknown>;
      expect(definition.$schema).toBe(
        'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      );
    });

    it('should include correct content version', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      const definition = result.definition as Record<string, unknown>;
      expect(definition.contentVersion).toBe('1.0.0.0');
    });

    it('should include empty triggers object', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      const definition = result.definition as Record<string, unknown>;
      expect(definition.triggers).toEqual({});
    });

    it('should include empty actions object', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      const definition = result.definition as Record<string, unknown>;
      expect(definition.actions).toEqual({});
    });

    it('should include empty outputs object', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      const definition = result.definition as Record<string, unknown>;
      expect(definition.outputs).toEqual({});
    });
  });

  describe('description handling', () => {
    it('should add description when provided', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful, 'Process customer orders');
      const definition = result.definition as Record<string, unknown>;
      expect(definition.description).toBe('Process customer orders');
    });

    it('should not add description when not provided', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      const definition = result.definition as Record<string, unknown>;
      expect(definition.description).toBeUndefined();
    });
  });

  describe('agentic workflow metadata', () => {
    it('should add metadata for agentic workflows', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.agentic);
      expect(result.metadata).toEqual({
        workflowType: 'agentic',
        aiEnabled: true,
      });
    });

    it('should add metadata for agent workflows', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.agent);
      expect(result.metadata).toEqual({
        workflowType: 'agent',
        aiEnabled: true,
      });
    });

    it('should not add metadata for stateful workflows', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateful);
      expect(result.metadata).toBeUndefined();
    });

    it('should not add metadata for stateless workflows', () => {
      const result = createWorkflowDefinition(WorkflowTypeOption.stateless);
      expect(result.metadata).toBeUndefined();
    });
  });
});

describe('trigger/action definitions', () => {
  it('treats Request as a trigger type', () => {
    expect(isTriggerType('Request')).toBe(true);
    expect(isTriggerType('request')).toBe(true);
  });

  it('does not treat Http as a trigger type', () => {
    expect(isTriggerType('Http')).toBe(false);
  });

  it('builds Request trigger definition in trigger shape', () => {
    const trigger = buildTriggerDefinition('Request', {
      type: 'Request',
      kind: 'Http',
      inputs: {
        method: 'GET',
      },
    });

    expect(trigger).toEqual({
      type: 'Request',
      kind: 'Http',
      inputs: {
        method: 'GET',
      },
    });
  });

  it('builds action definition with runAfter for non-trigger operations', () => {
    const action = buildActionDefinition('Http', {
      method: 'GET',
      uri: 'https://example.com',
    });

    expect(action).toEqual({
      type: 'Http',
      inputs: {
        method: 'GET',
        uri: 'https://example.com',
      },
      runAfter: {},
    });
  });

  it('normalizes runAfter from nested inputs to top-level action property', () => {
    const action = buildActionDefinition('Response', {
      type: 'Response',
      inputs: {
        statusCode: 200,
        runAfter: {
          Get_Seattle_Weather: ['Succeeded'],
        },
      },
    });

    expect(action).toEqual({
      type: 'Response',
      inputs: {
        statusCode: 200,
      },
      runAfter: {
        Get_Seattle_Weather: ['Succeeded'],
      },
    });
  });

  it('does not persist internal parameterText metadata into action definitions', () => {
    const action = buildActionDefinition('Response', {
      statusCode: 200,
      body: "@body('Get_Current_Weather')",
      parameterText: 'current weather for Seattle, WA',
      inputs: {
        headers: { 'Content-Type': 'application/json' },
        parameterText: 'nested current weather for Seattle, WA',
      },
    });

    expect(action).toEqual({
      type: 'Response',
      statusCode: 200,
      body: "@body('Get_Current_Weather')",
      inputs: {
        headers: { 'Content-Type': 'application/json' },
      },
      runAfter: {},
    });
    expect(action).not.toHaveProperty('parameterText');
  });

  it('does not persist internal parameterText metadata into trigger definitions', () => {
    const trigger = buildTriggerDefinition('Request', {
      parameterText: 'current weather for Seattle, WA',
      inputs: {
        schema: {},
        parameterText: 'nested current weather for Seattle, WA',
      },
    });

    expect(trigger).toEqual({
      type: 'Request',
      kind: 'Http',
      inputs: {
        schema: {},
      },
    });
  });

  it('detects weather managed connection reference from connections data', () => {
    const reference = detectWeatherManagedApiReference({
      managedApiConnections: {
        myWeatherConn: {
          api: {
            id: '/subscriptions/abc/providers/Microsoft.Web/locations/westus/managedApis/msnweather',
          },
        },
      },
    });

    expect(reference).toBe('myWeatherConn');
  });

  it('returns undefined when no weather connector is found', () => {
    const reference = detectWeatherManagedApiReference({
      managedApiConnections: {
        office365: {
          api: {
            id: '/managedApis/office365',
          },
        },
        sql: {
          api: {
            id: '/managedApis/sql',
          },
        },
      },
    });

    expect(reference).toBeUndefined();
  });

  it('returns undefined when weather-like reference is missing api.id', () => {
    const reference = detectWeatherManagedApiReference({
      managedApiConnections: {
        msweather: {
          connection: {
            id: '/connections/msweather',
          },
        },
      },
    });

    expect(reference).toBeUndefined();
  });

  it('detects weather intent for HTTP actions', () => {
    expect(
      shouldAutoUseWeatherConnector('Http', 'Get_Seattle_Weather', {
        uri: 'https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321&current_weather=true',
      })
    ).toBe(true);
  });

  it('detects weather intent for ApiConnection actions too', () => {
    expect(shouldAutoUseWeatherConnector('ApiConnection', 'Get_Seattle_Weather', {})).toBe(true);
  });

  it('does not detect weather intent from Seattle alone', () => {
    expect(shouldAutoUseWeatherConnector('ApiConnection', 'Seattle_Action', { path: '/v2/something' })).toBe(false);
    expect(shouldAutoUseWeatherConnector('Http', 'In_Seattle_Add_HTTP_Trigger', {})).toBe(false);
  });

  it('does not detect weather intent for unrelated ApiConnection actions', () => {
    expect(
      shouldAutoUseWeatherConnector('ApiConnection', 'Send_Email', {
        path: '/v2/Mail',
      })
    ).toBe(false);
  });

  it('does not detect weather intent for SQL ApiConnection actions', () => {
    expect(
      shouldAutoUseWeatherConnector('ApiConnection', 'Query_SQL_Orders', {
        path: '/v2/datasets/default/tables/Orders/items',
      })
    ).toBe(false);
  });

  it('does not detect weather intent for Service Bus ApiConnection actions', () => {
    expect(
      shouldAutoUseWeatherConnector('ApiConnection', 'Send_ServiceBus_Message', {
        path: "/@{encodeURIComponent('orders')}/messages",
      })
    ).toBe(false);
  });

  it('detects weather intent when URI is nested under inputs', () => {
    expect(
      shouldAutoUseWeatherConnector('Http', 'Get_Seattle_Weather', {
        inputs: {
          uri: 'https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321&current_weather=true',
        },
      })
    ).toBe(true);
  });

  it('builds generic managed ApiConnection action for SQL', () => {
    const action = buildManagedApiConnectionAction('sql', 'GET', '/v2/datasets/default/tables/Orders/items', {
      inputs: {
        queries: {
          $top: 10,
        },
      },
    });

    expect(action).toEqual({
      type: 'ApiConnection',
      inputs: {
        host: {
          connection: {
            referenceName: 'sql',
          },
        },
        method: 'get',
        path: '/v2/datasets/default/tables/Orders/items',
        queries: {
          $top: 10,
        },
      },
      runAfter: {},
    });
  });

  it('resolves managed connector reference case-insensitively', () => {
    const resolved = resolveManagedApiReferenceName('SQL', ['sql', 'servicebus']);
    expect(resolved).toBe('sql');
  });

  it('validates ApiConnection reference for SQL/Service Bus references', () => {
    const sqlValidation = validateApiConnectionReferenceExists(
      {
        host: {
          connection: {
            referenceName: 'sql',
          },
        },
      },
      ['sql', 'servicebus']
    );

    const sbValidation = validateApiConnectionReferenceExists(
      {
        host: {
          connection: {
            referenceName: 'servicebus',
          },
        },
      },
      ['sql', 'servicebus']
    );

    expect(sqlValidation).toBeUndefined();
    expect(sbValidation).toBeUndefined();
  });

  it('returns reference validation error when connector is missing', () => {
    const validationError = validateApiConnectionReferenceExists(
      {
        host: {
          connection: {
            referenceName: 'sql',
          },
        },
      },
      ['servicebus']
    );

    expect(validationError).toContain('ApiConnection reference "sql" could not be resolved');
    expect(validationError).toContain('Valid managed connection references with api.id: servicebus');
  });

  it('ranks operation candidates to prefer specific row retrieval over list operations', () => {
    const selected = selectOperationByActionName('Get SQL row by id', [
      {
        name: 'Get_rows_V2',
        properties: {
          summary: 'List all rows in table',
          swaggerOperationId: 'GetItems_V2',
        },
      },
      {
        name: 'Get_row_V2',
        properties: {
          summary: 'Get a single row by key',
          swaggerOperationId: 'GetItem_V2',
        },
      },
    ]);

    expect(selected?.name).toBe('Get_row_V2');
  });

  it('uses operationId hint to rank service bus send operation above receive', () => {
    const selected = selectOperationByActionName(
      'Send Service Bus message',
      [
        {
          name: 'ReceiveMessages',
          properties: {
            summary: 'Receive messages from queue',
            swaggerOperationId: 'ReceiveMessages',
          },
        },
        {
          name: 'SendMessage',
          properties: {
            summary: 'Send a message to queue',
            swaggerOperationId: 'SendMessage',
          },
        },
      ],
      {
        operationId: 'sendmessage',
      }
    );

    expect(selected?.name).toBe('SendMessage');
  });

  it('ranks swagger operation candidates using action intent when method/path is not provided', () => {
    const resolved = resolveSwaggerOperation(
      {
        paths: {
          '/messages': {
            get: {
              operationId: 'GetMessages',
              summary: 'Get messages from queue',
            },
            post: {
              operationId: 'SendMessage',
              summary: 'Send message to queue',
            },
          },
        },
      },
      'Send Service Bus message',
      [],
      {}
    );

    expect(resolved).toMatchObject({
      method: 'post',
      path: '/messages',
      operationId: 'SendMessage',
    });
  });

  it('prefers explicit method/path hints when ranking swagger operation candidates', () => {
    const resolved = resolveSwaggerOperation(
      {
        paths: {
          '/messages': {
            get: {
              operationId: 'GetMessages',
              summary: 'Get messages from queue',
            },
            post: {
              operationId: 'SendMessage',
              summary: 'Send message to queue',
            },
          },
        },
      },
      'Send Service Bus message',
      ['SendMessage'],
      {
        method: 'get',
        path: '/messages',
      }
    );

    expect(resolved).toMatchObject({
      method: 'get',
      path: '/messages',
      operationId: 'GetMessages',
    });
  });

  it('prefers SQL list operation for list intent', () => {
    const selected = selectOperationByActionName('List SQL rows in Orders table', [
      {
        name: 'Get_row_V2',
        properties: {
          summary: 'Get a single row by key',
          swaggerOperationId: 'GetItem_V2',
        },
      },
      {
        name: 'Get_rows_V2',
        properties: {
          summary: 'List all rows in a table',
          swaggerOperationId: 'GetItems_V2',
        },
      },
    ]);

    expect(selected?.name).toBe('Get_rows_V2');
  });

  it('prefers SQL single-item swagger path for by-id intent', () => {
    const resolved = resolveSwaggerOperation(
      {
        paths: {
          '/v2/tables/orders/items': {
            get: {
              operationId: 'GetItems_V2',
              summary: 'List rows',
            },
          },
          '/v2/tables/orders/items/{id}': {
            get: {
              operationId: 'GetItem_V2',
              summary: 'Get row by id',
            },
          },
        },
      },
      'Get SQL row by id',
      [],
      {}
    );

    expect(resolved).toMatchObject({
      method: 'get',
      path: '/v2/tables/orders/items/{id}',
      operationId: 'GetItem_V2',
    });
  });

  it('prefers Service Bus receive operation when send and receive share method', () => {
    const resolved = resolveSwaggerOperation(
      {
        paths: {
          '/queues/{queueName}/messages/send': {
            post: {
              operationId: 'SendMessage',
              summary: 'Send message to queue',
            },
          },
          '/queues/{queueName}/messages/receive': {
            post: {
              operationId: 'ReceiveMessages',
              summary: 'Receive messages from queue',
            },
          },
        },
      },
      'Receive Service Bus messages',
      [],
      {}
    );

    expect(resolved).toMatchObject({
      method: 'post',
      path: '/queues/{queueName}/messages/receive',
      operationId: 'ReceiveMessages',
    });
  });

  it('prefers Service Bus peek-lock operation for peek intent', () => {
    const resolved = resolveSwaggerOperation(
      {
        paths: {
          '/queues/{queueName}/messages/send': {
            post: {
              operationId: 'SendMessage',
              summary: 'Send message to queue',
            },
          },
          '/queues/{queueName}/messages/receive': {
            post: {
              operationId: 'ReceiveMessages',
              summary: 'Receive messages from queue',
            },
          },
          '/queues/{queueName}/messages/peeklock': {
            post: {
              operationId: 'PeekLockMessages',
              summary: 'Peek-lock messages from queue',
            },
          },
        },
      },
      'Peek Service Bus messages',
      [],
      {}
    );

    expect(resolved).toMatchObject({
      method: 'post',
      path: '/queues/{queueName}/messages/peeklock',
      operationId: 'PeekLockMessages',
    });
  });

  it('normalizes connector swagger paths that include {connectionId} prefix', () => {
    const resolved = resolveSwaggerOperation(
      {
        paths: {
          '/{connectionId}/v2/datasets/{dataset}/tables/{table}/items': {
            get: {
              operationId: 'GetItems_V2',
              summary: 'List rows',
            },
          },
        },
      },
      'List SQL rows',
      ['GetItems_V2'],
      {}
    );

    expect(resolved).toMatchObject({
      method: 'get',
      path: '/v2/datasets/{dataset}/tables/{table}/items',
      operationId: 'GetItems_V2',
    });
  });

  it('resolves offline SQL list operation to canonical encoded path', () => {
    const resolved = resolveOfflineManagedConnectorOperation(
      '/subscriptions/abc/providers/Microsoft.Web/locations/westus/managedApis/sql',
      'List SQL Orders',
      {}
    );

    expect(resolved).toEqual({
      method: 'get',
      path: "/v2/datasets/@{encodeURIComponent(encodeURIComponent('default'))},@{encodeURIComponent(encodeURIComponent('default'))}/tables/@{encodeURIComponent(encodeURIComponent('[dbo].[Orders]'))}/items",
      operationId: 'GetItems_V2',
    });
  });

  it('normalizes plain SQL path hint in offline fallback', () => {
    const resolved = resolveOfflineManagedConnectorOperation(
      '/subscriptions/abc/providers/Microsoft.Web/locations/westus/managedApis/sql',
      'List SQL Orders',
      {
        method: 'GET',
        path: '/v2/datasets/default/tables/[dbo].[Orders]/items',
      }
    );

    expect(resolved).toEqual({
      method: 'get',
      path: "/v2/datasets/@{encodeURIComponent(encodeURIComponent('default'))},@{encodeURIComponent(encodeURIComponent('default'))}/tables/@{encodeURIComponent(encodeURIComponent('[dbo].[Orders]'))}/items",
      operationId: 'GetItems_V2',
    });
  });

  it('builds ServiceProvider action with correct shape', () => {
    const action = buildServiceProviderAction('AzureBlob', 'readBlob', '/serviceProviders/AzureBlob', {
      containerName: 'container1',
      blobName: 'blob1',
    });

    expect(action).toEqual({
      type: 'ServiceProvider',
      inputs: {
        parameters: {
          containerName: 'container1',
          blobName: 'blob1',
        },
        serviceProviderConfiguration: {
          connectionName: 'AzureBlob',
          operationId: 'readBlob',
          serviceProviderId: '/serviceProviders/AzureBlob',
        },
      },
      runAfter: {},
    });
  });

  it('builds ServiceProvider action with custom runAfter', () => {
    const action = buildServiceProviderAction(
      'serviceBus',
      'sendMessage',
      '/serviceProviders/serviceBus',
      { message: 'hello' },
      { Previous_Action: ['Succeeded'] }
    );

    expect(action.type).toBe('ServiceProvider');
    expect((action.inputs as any).serviceProviderConfiguration.connectionName).toBe('serviceBus');
    expect((action.inputs as any).serviceProviderConfiguration.operationId).toBe('sendMessage');
    expect(action.runAfter).toEqual({ Previous_Action: ['Succeeded'] });
  });

  it('builds a Service Bus connection string from endpoint and key fields', () => {
    expect(buildServiceBusConnectionString('sb://contoso.servicebus.windows.net/', 'RootManageSharedAccessKey', 'secret-value')).toBe(
      'Endpoint=sb://contoso.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=secret-value'
    );
  });

  it('preserves an Endpoint= prefix when building a Service Bus connection string', () => {
    expect(
      buildServiceBusConnectionString('Endpoint=sb://contoso.servicebus.windows.net/', 'RootManageSharedAccessKey', 'secret-value')
    ).toBe('Endpoint=sb://contoso.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=secret-value');
  });

  it('builds ServiceProvider action with empty parameters when none provided', () => {
    const action = buildServiceProviderAction('AzureBlob', 'readBlob', '/serviceProviders/AzureBlob');
    expect((action.inputs as any).parameters).toEqual({});
    expect(action.runAfter).toEqual({});
  });

  it('resolves @appsetting() expressions in api.id paths', () => {
    const input =
      "/subscriptions/@appsetting('WORKFLOWS_SUBSCRIPTION_ID')/providers/Microsoft.Web/locations/@appsetting('WORKFLOWS_LOCATION_NAME')/managedApis/office365";
    const result = resolveAppSettingExpressions(input, {
      WORKFLOWS_SUBSCRIPTION_ID: 'abc-123',
      WORKFLOWS_LOCATION_NAME: 'westus',
    });
    expect(result).toBe('/subscriptions/abc-123/providers/Microsoft.Web/locations/westus/managedApis/office365');
  });

  it('leaves @appsetting() expressions unresolved when values are missing', () => {
    const input =
      "/subscriptions/@appsetting('WORKFLOWS_SUBSCRIPTION_ID')/providers/Microsoft.Web/locations/@appsetting('WORKFLOWS_LOCATION_NAME')/managedApis/sql";
    const result = resolveAppSettingExpressions(input, {});
    expect(result).toBe(input);
  });

  it('returns string unchanged when no @appsetting() expressions are present', () => {
    const input = '/subscriptions/abc-123/providers/Microsoft.Web/locations/westus/managedApis/sql';
    const result = resolveAppSettingExpressions(input, { WORKFLOWS_SUBSCRIPTION_ID: 'other' });
    expect(result).toBe(input);
  });
});

describe('ServiceProvider versus managed ApiConnection routing', () => {
  const serviceBusManagedApiId = '/subscriptions/sub/providers/Microsoft.Web/locations/westus/managedApis/servicebus';

  it('skips built-in ServiceProvider matching for explicit ApiConnection actions', () => {
    expect(shouldSkipBuiltInServiceProviderResolution('ApiConnection', 'servicebus', undefined)).toBe(true);
  });

  it('skips built-in ServiceProvider matching for full managedApis ARM connector IDs', () => {
    expect(shouldSkipBuiltInServiceProviderResolution('Http', undefined, serviceBusManagedApiId)).toBe(true);
    expect(shouldSkipBuiltInServiceProviderResolution('Http', serviceBusManagedApiId, undefined)).toBe(true);
  });

  it('keeps short ServiceProvider servicebus hints on the built-in path', () => {
    expect(shouldSkipBuiltInServiceProviderResolution('ServiceProvider', 'servicebus', undefined)).toBe(false);
  });

  it('reuses an existing Azure Blob ServiceProvider connection with a noncanonical reference name', async () => {
    const projectPath = await createDuplicateActionProject();
    await fs.writeFile(
      path.join(projectPath, 'connections.json'),
      JSON.stringify(
        {
          serviceProviderConnections: {
            ExistingBlobConnection: {
              serviceProvider: {
                id: '/serviceProviders/AzureBlob',
              },
              parameterValues: {
                connectionString: "@appsetting('ExistingBlobConnection_connectionString')",
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );
    setWorkflowToolsTestOverrides({
      builtInConnectors: [{ name: 'AzureBlob', id: '/serviceProviders/AzureBlob', displayName: 'Azure Blob' }],
    });

    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'ServiceProvider',
          actionName: 'Read_Blob_From_Existing_Connection',
          connectorReference: 'Azure Blob',
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    const resultText = getToolResultText(result);
    expect(resultText).toContain('Successfully added action "Read_Blob_From_Existing_Connection" of type "ServiceProvider"');
    expect(resultText).not.toContain('I need connection details before I can add the Azure Blob action');

    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Read_Blob_From_Existing_Connection).toMatchObject({
      type: 'ServiceProvider',
      inputs: {
        serviceProviderConfiguration: {
          connectionName: 'ExistingBlobConnection',
          operationId: 'readBlob',
          serviceProviderId: '/serviceProviders/AzureBlob',
        },
      },
    });
  });

  it('asks for Azure Blob connection details without mutating workflow when no reusable details exist', async () => {
    const projectPath = await createDuplicateActionProject();
    setWorkflowToolsTestOverrides({
      builtInConnectors: [{ name: 'AzureBlob', id: '/serviceProviders/AzureBlob', displayName: 'Azure Blob' }],
    });

    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'ServiceProvider',
          actionName: 'Read_Blob_Needs_Details',
          connectorReference: 'Azure Blob',
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    const resultText = getToolResultText(result);
    expect(resultText).toContain('I need connection details before I can add the Azure Blob action');
    expect(resultText).toContain('serviceProviderConnection.connectionString');

    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Read_Blob_Needs_Details).toBeUndefined();
    await expect(fs.access(path.join(projectPath, 'connections.json'))).rejects.toThrow();
  });

  it('auto-selects a discovered Azure Blob storage account and writes the ServiceProvider action', async () => {
    const projectPath = await createDuplicateActionProject();
    await fs.writeFile(
      path.join(projectPath, 'local.settings.json'),
      JSON.stringify(
        {
          IsEncrypted: false,
          Values: {
            WORKFLOWS_SUBSCRIPTION_ID: 'sub-123',
            WORKFLOWS_TENANT_ID: 'tenant-123',
            WORKFLOWS_RESOURCE_GROUP_NAME: 'rg-123',
            WORKFLOWS_LOCATION_NAME: 'westus',
            WORKFLOWS_MANAGEMENT_BASE_URI: 'https://management.azure.com',
          },
        },
        null,
        2
      ),
      'utf8'
    );
    setWorkflowToolsTestOverrides({
      builtInConnectors: [{ name: 'AzureBlob', id: '/serviceProviders/AzureBlob', displayName: 'Azure Blob' }],
      getAuthorizationToken: vi.fn(async () => 'Bearer fake-token'),
      fetch: vi.fn(async (url: string) => {
        if (url.includes('/providers/Microsoft.Storage/storageAccounts?')) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: '/subscriptions/sub-123/resourceGroups/rg-123/providers/Microsoft.Storage/storageAccounts/storageone',
                  name: 'storageone',
                  location: 'westus',
                  type: 'Microsoft.Storage/storageAccounts',
                },
                {
                  id: '/subscriptions/sub-123/resourceGroups/rg-123/providers/Microsoft.Storage/storageAccounts/storagetwo',
                  name: 'storagetwo',
                  location: 'westus',
                  type: 'Microsoft.Storage/storageAccounts',
                },
              ],
            }),
            { status: 200 }
          );
        }

        if (url.includes('/storageAccounts/storageone/listKeys?')) {
          return new Response(JSON.stringify({ keys: [{ value: 'storage-key' }] }), { status: 200 });
        }

        return new Response('{}', { status: 404 });
      }),
    });

    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'ServiceProvider',
          actionName: 'Read_Blob_From_Discovered_Storage',
          connectorReference: 'Azure Blob',
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    const resultText = getToolResultText(result);
    expect(resultText).toContain('Successfully added action "Read_Blob_From_Discovered_Storage" of type "ServiceProvider"');
    expect(resultText).toContain('Azure Blob connections were found in Azure: storageone, storagetwo');
    expect(resultText).not.toContain('I need connection details before I can add the Azure Blob action');

    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Read_Blob_From_Discovered_Storage).toMatchObject({
      type: 'ServiceProvider',
      inputs: {
        serviceProviderConfiguration: {
          connectionName: 'AzureBlob',
          operationId: 'readBlob',
          serviceProviderId: '/serviceProviders/AzureBlob',
        },
      },
    });

    const connections = JSON.parse(await fs.readFile(path.join(projectPath, 'connections.json'), 'utf8')) as Record<string, any>;
    expect(connections.serviceProviderConnections.AzureBlob.parameterValues.connectionString).toBe(
      "@appsetting('AzureBlob_connectionString')"
    );

    const localSettings = JSON.parse(await fs.readFile(path.join(projectPath, 'local.settings.json'), 'utf8')) as Record<string, any>;
    expect(localSettings.Values.AzureBlob_connectionString).toBe(
      'DefaultEndpointsProtocol=https;AccountName=storageone;AccountKey=storage-key;EndpointSuffix=core.windows.net'
    );
  });

  it('routes full servicebus managedApis IDs through managed ApiConnection creation instead of built-in ServiceProvider prompts', async () => {
    const projectPath = await createDuplicateActionProject();
    setWorkflowToolsTestOverrides({
      builtInConnectors: [{ name: 'serviceBus', id: '/serviceProviders/serviceBus', displayName: 'Service Bus' }],
    });

    const result = await new AddActionTool().invoke(
      {
        input: {
          workflowName: 'Stateful1',
          actionType: 'Http',
          actionName: 'Send_Service_Bus_Message',
          connectorId: serviceBusManagedApiId,
          operationId: 'SendMessage',
          method: 'POST',
          path: '/messages',
          configuration: {
            inputs: {
              body: {
                ContentData: 'hello',
              },
            },
          },
        },
      } as vscode.LanguageModelToolInvocationOptions<any>,
      {} as vscode.CancellationToken
    );

    const resultText = getToolResultText(result);
    expect(resultText).toContain('Successfully added action "Send_Service_Bus_Message" of type "ApiConnection"');
    expect(resultText).toContain('Added placeholder connection for "servicebus"');
    expect(resultText).not.toContain('I need connection details before I can add the Service Bus action');

    const workflow = await readDuplicateWorkflow(projectPath);
    expect(workflow.definition.actions.Send_Service_Bus_Message).toMatchObject({
      type: 'ApiConnection',
      inputs: {
        host: {
          connection: {
            referenceName: 'servicebus',
          },
        },
        method: 'post',
        path: '/messages',
        body: {
          ContentData: 'hello',
        },
      },
      operationId: 'SendMessage',
    });

    const connections = JSON.parse(await fs.readFile(path.join(projectPath, 'connections.json'), 'utf8')) as Record<string, any>;
    expect(connections.managedApiConnections.servicebus.api.id).toBe(serviceBusManagedApiId.toLowerCase());
    expect(connections.serviceProviderConnections).toBeUndefined();
  });
});

describe('inferDefaultRunAfter', () => {
  it('returns {} when there are no existing actions', () => {
    expect(inferDefaultRunAfter(undefined, undefined)).toEqual({});
    expect(inferDefaultRunAfter({}, undefined)).toEqual({});
  });

  it('ignores empty action-name artifacts when inferring the first runAfter', () => {
    expect(inferDefaultRunAfter({ '': { type: 'Compose' } }, undefined)).toEqual({});
  });

  it('chains after the last existing action when caller omits runAfter', () => {
    const existing = {
      First_Action: { type: 'Compose' },
      Second_Action: { type: 'Http' },
    };
    expect(inferDefaultRunAfter(existing, undefined)).toEqual({ Second_Action: ['Succeeded'] });
  });

  it('chains after the last existing action when caller passes an empty configuration', () => {
    const existing = { Only_Action: { type: 'Compose' } };
    expect(inferDefaultRunAfter(existing, {})).toEqual({ Only_Action: ['Succeeded'] });
  });

  it('preserves an explicit top-level runAfter pointing at a specific previous action', () => {
    const existing = {
      Compose1: { type: 'Compose' },
      Compose2: { type: 'Compose' },
    };
    expect(inferDefaultRunAfter(existing, { runAfter: { Compose1: ['Succeeded'] } })).toEqual({ Compose1: ['Succeeded'] });
  });

  it('preserves an explicit runAfter:{} to opt into parallel execution', () => {
    const existing = { Compose1: { type: 'Compose' } };
    expect(inferDefaultRunAfter(existing, { runAfter: {} })).toEqual({});
  });

  it('preserves runAfter when nested under inputs', () => {
    const existing = { Compose1: { type: 'Compose' } };
    expect(inferDefaultRunAfter(existing, { inputs: { runAfter: { Compose1: ['Failed'] } } })).toEqual({ Compose1: ['Failed'] });
  });

  it('ignores non-object runAfter values from the caller', () => {
    const existing = { Compose1: { type: 'Compose' } };
    expect(inferDefaultRunAfter(existing, { runAfter: 'invalid' as unknown as Record<string, unknown> })).toEqual({
      Compose1: ['Succeeded'],
    });
  });

  it('respects the workflow JSON insertion order for chaining', () => {
    const existing = {
      A: { type: 'Compose' },
      B: { type: 'Compose' },
      C: { type: 'Compose' },
    };
    expect(inferDefaultRunAfter(existing, undefined)).toEqual({ C: ['Succeeded'] });
  });
});

describe('routeParametersToApiConnectionInputs', () => {
  const msnweatherParams = [
    {
      name: 'Location',
      in: 'path' as const,
      required: true,
      type: 'string',
    },
    {
      name: 'units',
      in: 'query' as const,
      required: false,
      type: 'string',
      enum: ['I', 'C'],
      xMsEnum: {
        values: [
          { value: 'I', displayName: 'Imperial' },
          { value: 'C', displayName: 'Metric' },
        ],
      },
    },
  ];

  it('substitutes path parameters and routes query parameters', () => {
    const result = routeParametersToApiConnectionInputs(
      { Location: 'Seattle, WA', units: 'Imperial' },
      undefined,
      '/current/{Location}',
      msnweatherParams
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
    expect(result.queries).toEqual({ units: 'I' });
  });

  it('infers required location and enum query parameters from natural parameter text', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action that gets the current weather for Seattle, WA in Imperial units.'
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
    expect(result.queries).toEqual({ units: 'I' });
  });

  it('uses explicit parameters before natural parameter text', () => {
    const result = routeParametersToApiConnectionInputs(
      { Location: 'Redmond, WA', units: 'Metric' },
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action that gets the current weather for Seattle, WA in Imperial units.'
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Redmond, WA')}");
    expect(result.queries).toEqual({ units: 'C' });
  });

  it('leaves required values missing when natural parameter text does not include them', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action that gets the current weather in Imperial units.'
    );

    expect(result.missing).toEqual(['Location']);
    expect(result.queries).toEqual({ units: 'I' });
  });

  it('does not guess optional enum parameters from natural text when they are not mentioned', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action that gets the current weather for Seattle, WA.'
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
    expect(result.queries).toBeUndefined();
  });

  it('does not infer one natural value across multiple required location-like path parameters', () => {
    const params = [
      { name: 'sourceLocation', in: 'path' as const, required: true, type: 'string', xMsSummary: 'Source location' },
      { name: 'destinationLocation', in: 'path' as const, required: true, type: 'string', xMsSummary: 'Destination location' },
    ];
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/route/{sourceLocation}/{destinationLocation}',
      params,
      'route for Seattle'
    );

    expect(result.missing).toEqual(['sourceLocation', 'destinationLocation']);
  });

  it('infers enum display values through generic metadata instead of a units parameter name', () => {
    const params = [
      {
        name: 'temperatureScale',
        in: 'query' as const,
        required: false,
        type: 'string',
        enum: ['I', 'C'],
        xMsEnum: {
          values: [
            { value: 'I', displayName: 'Imperial' },
            { value: 'C', displayName: 'Metric' },
          ],
        },
      },
    ];
    const result = routeParametersToApiConnectionInputs(undefined, undefined, '/current', params, 'return the forecast in Fahrenheit');

    expect(result.queries).toEqual({ temperatureScale: 'I' });
  });

  it('does not infer connector parameters from ambiguous enum text', () => {
    const result = inferParametersFromNaturalText(
      undefined,
      undefined,
      msnweatherParams,
      'Add an action that gets the current weather for Seattle, WA in Imperial or Metric units.'
    );

    expect(result).toEqual({ Location: 'Seattle, WA' });
  });

  it('translates enum displayName values to underlying codes', () => {
    const result = routeParametersToApiConnectionInputs(
      { Location: 'Redmond, WA', units: 'Metric' },
      undefined,
      '/current/{Location}',
      msnweatherParams
    );

    expect(result.missing).toEqual([]);
    expect(result.queries).toEqual({ units: 'C' });
  });

  it('translates weather unit synonyms to underlying enum codes', () => {
    expect(
      routeParametersToApiConnectionInputs({ Location: 'Seattle, WA', units: 'F' }, undefined, '/current/{Location}', msnweatherParams)
        .queries
    ).toEqual({
      units: 'I',
    });
    expect(
      routeParametersToApiConnectionInputs(
        { Location: 'Seattle, WA', units: 'Fahrenheit' },
        undefined,
        '/current/{Location}',
        msnweatherParams
      ).queries
    ).toEqual({ units: 'I' });
    expect(
      routeParametersToApiConnectionInputs(
        { Location: 'Seattle, WA', units: 'Celsius' },
        undefined,
        '/current/{Location}',
        msnweatherParams
      ).queries
    ).toEqual({
      units: 'C',
    });
    expect(
      routeParametersToApiConnectionInputs(
        { Location: 'Seattle, WA', units: 'Centigrade' },
        undefined,
        '/current/{Location}',
        msnweatherParams
      ).queries
    ).toEqual({
      units: 'C',
    });
  });

  it('preserves exact enum unit codes before applying weather unit synonyms', () => {
    const params = [
      {
        name: 'units',
        in: 'query' as const,
        required: false,
        type: 'string',
        enum: ['F', 'C'],
      },
    ];
    const result = routeParametersToApiConnectionInputs({ units: 'F' }, undefined, '/forecast', params);

    expect(result.queries).toEqual({ units: 'F' });
  });

  it('passes enum values through unchanged when already the code', () => {
    const result = routeParametersToApiConnectionInputs(
      { Location: 'Seattle, WA', units: 'I' },
      undefined,
      '/current/{Location}',
      msnweatherParams
    );

    expect(result.queries).toEqual({ units: 'I' });
  });

  it('matches parameter names case-insensitively', () => {
    const result = routeParametersToApiConnectionInputs(
      { location: 'Seattle, WA', UNITS: 'Imperial' },
      undefined,
      '/current/{Location}',
      msnweatherParams
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
    expect(result.queries).toEqual({ units: 'I' });
  });

  it('escapes single-quotes in path values', () => {
    const result = routeParametersToApiConnectionInputs({ Location: "O'Brien" }, undefined, '/current/{Location}', msnweatherParams);

    expect(result.path).toBe("/current/@{encodeURIComponent('O''Brien')}");
  });

  it('omits optional parameters when not provided', () => {
    const result = routeParametersToApiConnectionInputs({ Location: 'Seattle, WA' }, undefined, '/current/{Location}', msnweatherParams);

    expect(result.missing).toEqual([]);
    expect(result.queries).toBeUndefined();
  });

  it('does not report missing path parameters when the caller supplied a resolved explicit path', () => {
    const result = routeParametersToApiConnectionInputs(undefined, undefined, '/current/Seattle, WA', msnweatherParams);

    expect(result.missing).toEqual([]);
    expect(result.path).toBe('/current/Seattle, WA');
  });

  it('does not treat workflow expression braces in explicit paths as unresolved swagger placeholders', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      "/datasets/@{encodeURIComponent(encodeURIComponent('default'))}/tables/@{encodeURIComponent(encodeURIComponent('dbo.Orders'))}/items",
      [
        { name: 'dataset', in: 'path' as const, required: true, type: 'string' },
        { name: 'table', in: 'path' as const, required: true, type: 'string' },
      ]
    );

    expect(result.missing).toEqual([]);
  });

  it('does not treat braces inside workflow expression string literals as unresolved swagger placeholders', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      "/datasets/@{variables('table{with}braces')}/items/@{variables('item{id}')}/fields",
      [
        { name: 'dataset', in: 'path' as const, required: true, type: 'string' },
        { name: 'item', in: 'path' as const, required: true, type: 'string' },
      ]
    );

    expect(result.missing).toEqual([]);
  });

  it('reports missing required parameters', () => {
    const result = routeParametersToApiConnectionInputs({ units: 'Imperial' }, undefined, '/current/{Location}', msnweatherParams);

    expect(result.missing).toEqual(['Location']);
  });

  it('does not ask the user for connector runtime connectionId parameters', () => {
    const params = [{ name: 'connectionId', in: 'path' as const, required: true, type: 'string' }, ...msnweatherParams];
    const result = routeParametersToApiConnectionInputs({ Location: 'Seattle, WA' }, undefined, '/current/{Location}', params);

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
  });

  it('falls back to callerInputs slots when parameters not in flat dict', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      { queries: { units: 'Imperial' }, location: 'Seattle, WA' },
      '/current/{Location}',
      msnweatherParams
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
    expect(result.queries).toEqual({ units: 'I' });
  });

  it('routes body parameters into inputs.body', () => {
    const params = [{ name: 'item', in: 'body' as const, required: true, type: 'object' }];
    const result = routeParametersToApiConnectionInputs(
      { item: { Title: 'Hello' } },
      undefined,
      '/datasets/default/tables/Items/items',
      params
    );

    expect(result.missing).toEqual([]);
    expect(result.body).toEqual({ Title: 'Hello' });
  });

  it('routes header parameters into inputs.headers', () => {
    const params = [{ name: 'X-Trace', in: 'header' as const, required: false, type: 'string' }];
    const result = routeParametersToApiConnectionInputs({ 'X-Trace': 'abc' }, undefined, '/things', params);

    expect(result.headers).toEqual({ 'X-Trace': 'abc' });
  });

  it('applies parameter defaults when not provided', () => {
    const params = [{ name: 'limit', in: 'query' as const, required: false, type: 'integer', default: 10 }];
    const result = routeParametersToApiConnectionInputs(undefined, undefined, '/things', params);

    expect(result.queries).toEqual({ limit: 10 });
  });
});
