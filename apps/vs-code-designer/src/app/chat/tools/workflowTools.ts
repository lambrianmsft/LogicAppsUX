/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fse from 'fs-extra';
import type { WorkflowTypeOption } from '../chatConstants';
import { ToolName } from '../chatConstants';
import {
  azurePublicBaseUrl,
  connectionsFileName,
  localSettingsFileName,
  logicAppsStandardExtensionId,
  managementApiPrefix,
  workflowAuthenticationMethodKey,
  workflowFileName,
  workflowLocationKey,
  workflowManagementBaseURIKey,
  workflowResourceGroupNameKey,
  workflowTenantIdKey,
  workflowSubscriptionIdKey,
} from '../../../constants';
import { getAuthorizationToken, getAuthData } from '../../utils/codeless/getAuthorizationToken';
import { HttpClient } from '@microsoft/vscode-extension-logic-apps';
import { ext } from '../../../extensionVariables';

/**
 * Parameters for creating a workflow
 */
export interface CreateWorkflowParams {
  name: string;
  type: WorkflowTypeOption;
  description?: string;
}

/**
 * Parameters for modifying an action
 */
export interface ModifyActionParams {
  workflowName: string;
  projectName?: string;
  actionName: string;
  modification: string;
}

/**
 * Parameters for adding an action
 */
export interface AddActionParams {
  workflowName: string;
  projectName?: string;
  actionType: string;
  actionName: string;
  configuration?: Record<string, unknown>;
  connectorReference?: string;
  connectorId?: string;
  operationId?: string;
  method?: string;
  path?: string;
  serviceProviderConnection?: ServiceProviderConnectionInput;
}

export interface ServiceProviderConnectionInput {
  resourceId?: string;
  resourceName?: string;
  connectionString?: string;
  endpoint?: string;
  sharedAccessKeyName?: string;
  sharedAccessKey?: string;
}

/**
 * Result of a workflow operation
 */
export interface WorkflowOperationResult {
  success: boolean;
  message: string;
  workflowPath?: string;
  error?: string;
}

interface ProjectConnectionsInfo {
  managedApiReferences: string[];
  managedApiReferencesWithApiId: string[];
  managedApiIdByReference: Record<string, string>;
  serviceProviderReferences: string[];
  serviceProviderIdByReference: Record<string, string>;
  managedApiBasePath?: string;
  workflowManagementBaseUri?: string;
  workflowTenantId?: string;
  weatherManagedReference?: string;
  projectPath?: string;
  localSettingsValues?: Record<string, string>;
}

/**
 * Resolve @appsetting('KEY') expressions in a string using local.settings.json Values.
 * @internal Exported for testing
 */
export function resolveAppSettingExpressions(value: string, localSettingsValues: Record<string, string>): string {
  return value.replace(/@appsetting\('([^']+)'\)/gi, (_match, key: string) => {
    const resolved = localSettingsValues[key];
    return resolved ?? _match;
  });
}

function resolveApiIdFromAppSettings(apiId: string, localSettingsValues?: Record<string, string>): string {
  if (!localSettingsValues || !apiId.includes('@appsetting(')) {
    return apiId;
  }
  return resolveAppSettingExpressions(apiId, localSettingsValues);
}

export interface ApiConnectionHints {
  connectorReference?: string;
  connectorId?: string;
  operationId?: string;
  method?: string;
  path?: string;
}

function getManagedApiConnections(connectionsData: Record<string, unknown>): Record<string, unknown> {
  return typeof connectionsData.managedApiConnections === 'object' && connectionsData.managedApiConnections !== null
    ? (connectionsData.managedApiConnections as Record<string, unknown>)
    : {};
}

function getManagedApiId(connectionValue: unknown): string | undefined {
  const apiId =
    typeof connectionValue === 'object' && connectionValue !== null
      ? ((connectionValue as Record<string, unknown>).api as Record<string, unknown> | undefined)?.id
      : undefined;

  return typeof apiId === 'string' && apiId.trim() ? apiId : undefined;
}

function getServiceProviderConnections(connectionsData: Record<string, unknown>): Record<string, unknown> {
  return typeof connectionsData.serviceProviderConnections === 'object' && connectionsData.serviceProviderConnections !== null
    ? (connectionsData.serviceProviderConnections as Record<string, unknown>)
    : {};
}

function getServiceProviderId(connectionValue: unknown): string | undefined {
  const spId =
    typeof connectionValue === 'object' && connectionValue !== null
      ? ((connectionValue as Record<string, unknown>).serviceProvider as Record<string, unknown> | undefined)?.id
      : undefined;
  return typeof spId === 'string' && spId.trim() ? spId : undefined;
}

function extractManagedApiBasePath(managedApiIdByReference: Record<string, string>): string | undefined {
  for (const apiId of Object.values(managedApiIdByReference)) {
    const match = apiId.match(/^(\/subscriptions\/[^/]+\/providers\/Microsoft\.Web\/locations\/[^/]+\/managedApis\/).+$/i);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function constructManagedApiConnectorId(basePath: string, connectorShortName: string): string {
  return `${basePath.replace(/\/+$/, '')}/${connectorShortName.toLowerCase()}`;
}

/**
 * Construct the managedApi base path from local.settings.json values when
 * no existing managed connections are available to extract it from.
 *
 * Returns e.g. `/subscriptions/{sub}/providers/Microsoft.Web/locations/{loc}/managedApis/`
 * @internal Exported for testing
 */
export function constructManagedApiBasePathFromSettings(localSettingsValues?: Record<string, string>): string | undefined {
  if (!localSettingsValues) {
    return undefined;
  }
  const subscriptionId = localSettingsValues.WORKFLOWS_SUBSCRIPTION_ID;
  const location = localSettingsValues.WORKFLOWS_LOCATION_NAME;
  if (subscriptionId && location) {
    return `/subscriptions/${subscriptionId}/providers/Microsoft.Web/locations/${location}/managedApis/`;
  }
  return undefined;
}

async function addPlaceholderManagedApiConnection(projectPath: string, referenceName: string, connectorId: string): Promise<void> {
  const connectionsPath = path.join(projectPath, connectionsFileName);
  let connectionsData: Record<string, unknown> = {};
  try {
    if (await fse.pathExists(connectionsPath)) {
      connectionsData = (await fse.readJson(connectionsPath)) as Record<string, unknown>;
    }
  } catch {
    connectionsData = {};
  }
  if (typeof connectionsData.managedApiConnections !== 'object' || connectionsData.managedApiConnections === null) {
    connectionsData.managedApiConnections = {};
  }
  const managed = connectionsData.managedApiConnections as Record<string, unknown>;
  if (managed[referenceName]) {
    return;
  }
  managed[referenceName] = {
    api: { id: connectorId },
    connection: { id: '' },
    authentication: { type: 'Raw', scheme: 'Key', parameter: `@appsetting('${referenceName}-connectionKey')` },
  };
  await fse.writeJson(connectionsPath, connectionsData, { spaces: 2 });
  console.log(`[chat-tools] Added placeholder managed API connection for "${referenceName}"`);
}

// ──────────────────────────────────────────────────────────────────────────
// Managed API Connection: metadata-driven reuse / create / OAuth
// ──────────────────────────────────────────────────────────────────────────

interface ManagedApiConnectionAccess {
  connectionKey?: string;
  connectionRuntimeUrl?: string;
}

export type ConnectorAuthType = 'simple' | 'oauthOnly' | 'credential' | 'multiAuth';

interface ManagedApiConnectionParameterConstraints {
  required?: 'true' | 'false';
  hidden?: 'true' | 'false';
  hideInUI?: string;
  clearText?: boolean;
  serialize?: boolean;
  allowedValues?: Array<{ text?: string; value: unknown }>;
  default?: unknown;
}

interface ManagedApiConnectionParameter {
  type?: string;
  parameterSource?: string;
  allowedValues?: Array<{ text?: string; value: unknown }>;
  oAuthSettings?: Record<string, unknown>;
  uiDefinition?: {
    displayName?: string;
    description?: string;
    tooltip?: string;
    constraints?: ManagedApiConnectionParameterConstraints;
    schema?: {
      type?: string;
      format?: string;
      description?: string;
    };
  };
}

interface ManagedApiConnectionParameterSet {
  name: string;
  uiDefinition?: {
    displayName?: string;
    description?: string;
    tooltip?: string;
  };
  parameters?: Record<string, ManagedApiConnectionParameter>;
}

export interface ManagedApiConnectorMetadata {
  id?: string;
  name?: string;
  displayName?: string;
  connectionParameters?: Record<string, ManagedApiConnectionParameter>;
  connectionParameterSets?: {
    values?: ManagedApiConnectionParameterSet[];
  };
  properties?: {
    displayName?: string;
    connectionParameters?: Record<string, ManagedApiConnectionParameter>;
    connectionParameterSets?: {
      values?: ManagedApiConnectionParameterSet[];
    };
  };
}

export interface PromptableConnectionParameter {
  name: string;
  displayName: string;
  description?: string;
  type: string;
  required: boolean;
  secret: boolean;
  allowedValues?: Array<{ label: string; value: string }>;
  defaultValue?: string;
}

export interface ResolvedConnectorParameterShape {
  parameterSetName?: string;
  parameters: Record<string, ManagedApiConnectionParameter>;
  displayName?: string;
}

export interface ManagedApiConnectionTestResult {
  success: boolean;
  message?: string;
}

interface ManagedApiConnectionResource {
  location?: string;
  properties?: {
    overallStatus?: string;
    statuses?: Array<{
      status?: string;
      error?: {
        message?: string;
      };
    }>;
    testLinks?: Array<{
      method?: string;
      requestUri?: string;
      body?: unknown;
    }>;
    testRequests?: Array<{
      method?: string;
      requestUri?: string;
      body?: unknown;
    }>;
  };
}

interface ManagedApiConnectionCreateResult {
  success: boolean;
  connectionName?: string;
  connectionResourceId?: string;
  message?: string;
}

interface FinalizeManagedApiConnectionOptions {
  cleanupOnFailure?: boolean;
  connectionName?: string;
  successMessage: string;
}

interface WorkflowToolsTestOverrides {
  disableArmSwaggerResolution?: boolean;
  builtInConnectors?: BuiltInConnectorInfo[];
  builtInConnectorOperations?: Record<string, BuiltInConnectorOperation[]>;
  fetch?: typeof fetch;
  getAuthData?: typeof getAuthData;
  getAuthorizationToken?: typeof getAuthorizationToken;
  showInputBox?: (options: vscode.InputBoxOptions) => Thenable<string | undefined>;
}

const workflowToolsTestOverridesKey = '__LOGICAPPS_WORKFLOW_TOOLS_TEST_OVERRIDES__';

function getWorkflowToolsTestOverrides(): WorkflowToolsTestOverrides | undefined {
  const globalState = globalThis as typeof globalThis & {
    [workflowToolsTestOverridesKey]?: WorkflowToolsTestOverrides;
  };

  return globalState[workflowToolsTestOverridesKey];
}

async function getWorkflowToolsAuthorizationToken(tenantId?: string): Promise<string> {
  const override = getWorkflowToolsTestOverrides()?.getAuthorizationToken;
  return override ? override(tenantId) : getAuthorizationToken(tenantId);
}

async function getWorkflowToolsAuthData(tenantId?: string): Promise<Awaited<ReturnType<typeof getAuthData>>> {
  const override = getWorkflowToolsTestOverrides()?.getAuthData;
  return override ? override(tenantId) : getAuthData(tenantId);
}

async function workflowToolsFetch(input: string, init: RequestInit): Promise<Response> {
  const override = getWorkflowToolsTestOverrides()?.fetch;
  return override ? override(input, init) : fetch(input, init);
}

async function workflowToolsShowInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
  const override = getWorkflowToolsTestOverrides()?.showInputBox;
  return override ? override(options) : vscode.window.showInputBox(options);
}

/**
 * Info about an existing Azure API connection resource
 * @internal Exported for testing
 */
export interface ExistingApiConnection {
  id: string;
  name: string;
  displayName?: string;
  connectorId?: string;
}

/**
 * Result of attempting to resolve a managed API connection automatically
 * @internal Exported for testing
 */
export interface ManagedApiConnectionResolution {
  /** Whether the connection was resolved (existing reused or new created) */
  success: boolean;
  /** The ARM resource ID of the connection, if resolved */
  connectionId?: string;
  /** Display name of the connection used */
  connectionName?: string;
  /** Message for the chat response */
  message?: string;
}

/**
 * Extract the short connector name from a full managedApi connector ID.
 * e.g. `/subscriptions/.../managedApis/outlook` -> `outlook`
 * @internal Exported for testing
 */
export function getConnectorShortName(connectorId: string): string {
  return connectorId.split('/').pop() ?? connectorId;
}

function getConnectorDisplayName(metadata: ManagedApiConnectorMetadata, fallbackName?: string): string {
  return metadata.properties?.displayName ?? metadata.displayName ?? metadata.name ?? fallbackName ?? 'connector';
}

function getConnectorConnectionParameters(metadata: ManagedApiConnectorMetadata): Record<string, ManagedApiConnectionParameter> {
  return metadata.properties?.connectionParameters ?? metadata.connectionParameters ?? {};
}

function getConnectorConnectionParameterSets(metadata: ManagedApiConnectorMetadata): ManagedApiConnectionParameterSet[] {
  return metadata.properties?.connectionParameterSets?.values ?? metadata.connectionParameterSets?.values ?? [];
}

function isHiddenConnectorParameter(name: string, parameter: ManagedApiConnectionParameter): boolean {
  const normalizedName = name.toLowerCase();
  const constraints = parameter.uiDefinition?.constraints;
  return (
    normalizedName === 'token' ||
    normalizedName.startsWith('token:') ||
    normalizedName.includes('internal') ||
    parameter.parameterSource === 'AppConfiguration' ||
    constraints?.hidden === 'true' ||
    constraints?.hideInUI === 'true' ||
    constraints?.serialize === false
  );
}

function isSecretConnectorParameter(parameter: ManagedApiConnectionParameter): boolean {
  const normalizedType = parameter.type?.toLowerCase();
  return normalizedType === 'securestring' || normalizedType === 'secureobject' || parameter.uiDefinition?.constraints?.clearText === false;
}

function isPromptableConnectorParameter(name: string, parameter: ManagedApiConnectionParameter): boolean {
  if (isHiddenConnectorParameter(name, parameter)) {
    return false;
  }

  const normalizedType = parameter.type?.toLowerCase();
  return normalizedType !== 'oauthsetting' && normalizedType !== 'managedidentity' && normalizedType !== 'connection';
}

function stringifyDefaultValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function extractAllowedValues(parameter: ManagedApiConnectionParameter): Array<{ label: string; value: string }> | undefined {
  const allowedValues = parameter.allowedValues ?? parameter.uiDefinition?.constraints?.allowedValues;
  if (!allowedValues?.length) {
    return undefined;
  }

  return allowedValues.map((allowedValue) => {
    const value = typeof allowedValue.value === 'string' ? allowedValue.value : JSON.stringify(allowedValue.value);
    return {
      label: allowedValue.text ?? value,
      value,
    };
  });
}

function normalizeJwtPayload(accessToken: string): Record<string, unknown> | undefined {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) {
    return undefined;
  }

  try {
    const normalizedPayload = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(paddedPayload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeAccessPolicyNameSegment(value: string | undefined, fallback: string): string {
  const sanitizedValue = (value ?? fallback)
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitizedValue || fallback;
}

function getAzureErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, any>;
    return record.message ?? record.Message ?? record.error?.message ?? record.error_description ?? record.responseText ?? fallback;
  }

  return fallback;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const responseText = await response.text().catch(() => '');
  if (!responseText) {
    return undefined;
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return responseText;
  }
}

function collectDefaultParameterValues(parameters: Record<string, ManagedApiConnectionParameter>): Record<string, unknown> {
  return Object.entries(parameters).reduce((result: Record<string, unknown>, [name, parameter]) => {
    const defaultValue = parameter.uiDefinition?.constraints?.default;
    const normalizedType = parameter.type?.toLowerCase();

    if (
      defaultValue !== undefined &&
      normalizedType !== 'oauthsetting' &&
      normalizedType !== 'managedidentity' &&
      normalizedType !== 'connection'
    ) {
      result[name] = defaultValue;
    }

    return result;
  }, {});
}

function buildParameterValueSet(values: Record<string, unknown>): Record<string, { value: unknown }> {
  return Object.entries(values).reduce((result: Record<string, { value: unknown }>, [name, value]) => {
    result[name] = { value };
    return result;
  }, {});
}

function validatePromptableParameterInput(value: string, parameter: PromptableConnectionParameter): string | undefined {
  if (!value && parameter.required) {
    return `${parameter.displayName} is required.`;
  }

  if (!value) {
    return undefined;
  }

  switch (parameter.type.toLowerCase()) {
    case 'bool':
      return ['true', 'false'].includes(value.toLowerCase()) ? undefined : 'Enter true or false.';
    case 'int':
      return Number.isNaN(Number(value)) ? 'Enter a valid number.' : undefined;
    case 'array':
    case 'object':
    case 'secureobject':
      try {
        JSON.parse(value);
        return undefined;
      } catch {
        return 'Enter valid JSON.';
      }
    default:
      return undefined;
  }
}

function coerceConnectorParameterValue(value: string, parameterType: string): unknown {
  switch (parameterType.toLowerCase()) {
    case 'bool':
      return value.toLowerCase() === 'true';
    case 'int': {
      const parsedValue = Number(value);
      return Number.isNaN(parsedValue) ? value : parsedValue;
    }
    case 'array':
    case 'object':
    case 'secureobject':
      return JSON.parse(value);
    default:
      return value;
  }
}

export function extractUserFacingParameters(
  parameters: Record<string, ManagedApiConnectionParameter>
): Record<string, ManagedApiConnectionParameter> {
  return Object.entries(parameters).reduce((result: Record<string, ManagedApiConnectionParameter>, [name, parameter]) => {
    if (!isHiddenConnectorParameter(name, parameter)) {
      result[name] = parameter;
    }
    return result;
  }, {});
}

export function extractPromptableParameters(parameters: Record<string, ManagedApiConnectionParameter>): PromptableConnectionParameter[] {
  return Object.entries(extractUserFacingParameters(parameters))
    .filter(([name, parameter]) => isPromptableConnectorParameter(name, parameter))
    .map(([name, parameter]) => ({
      name,
      displayName: parameter.uiDefinition?.displayName ?? name,
      description: parameter.uiDefinition?.description ?? parameter.uiDefinition?.tooltip ?? parameter.uiDefinition?.schema?.description,
      type: parameter.type ?? parameter.uiDefinition?.schema?.type ?? 'string',
      required: parameter.uiDefinition?.constraints?.required === 'true',
      secret: isSecretConnectorParameter(parameter),
      allowedValues: extractAllowedValues(parameter),
      defaultValue: stringifyDefaultValue(parameter.uiDefinition?.constraints?.default),
    }));
}

export function resolveConnectorParameterShape(metadata: ManagedApiConnectorMetadata): ResolvedConnectorParameterShape | undefined {
  const connectionParameterSets = getConnectorConnectionParameterSets(metadata);
  if (connectionParameterSets.length === 1) {
    return {
      parameterSetName: connectionParameterSets[0].name,
      parameters: connectionParameterSets[0].parameters ?? {},
      displayName: connectionParameterSets[0].uiDefinition?.displayName,
    };
  }

  const connectionParameters = getConnectorConnectionParameters(metadata);
  return {
    parameters: connectionParameters,
    displayName: getConnectorDisplayName(metadata),
  };
}

export function classifyConnectorAuthType(metadata: ManagedApiConnectorMetadata): ConnectorAuthType {
  const connectionParameterSets = getConnectorConnectionParameterSets(metadata);
  if (connectionParameterSets.length > 1) {
    return 'multiAuth';
  }

  const parameterShape = resolveConnectorParameterShape(metadata);
  const parameters = parameterShape?.parameters ?? {};
  const visibleParameters = Object.values(extractUserFacingParameters(parameters));
  const hasOAuth = visibleParameters.some((parameter) => parameter.type?.toLowerCase() === 'oauthsetting' || !!parameter.oAuthSettings);
  const promptableParameters = extractPromptableParameters(parameters);

  if (hasOAuth && promptableParameters.length > 0) {
    return 'multiAuth';
  }

  if (hasOAuth) {
    return 'oauthOnly';
  }

  return promptableParameters.length > 0 ? 'credential' : 'simple';
}

export async function fetchConnectorMetadata(
  connectorId: string,
  azureContext: AzureContext
): Promise<ManagedApiConnectorMetadata | undefined> {
  try {
    const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${connectorId}?api-version=2018-07-01-preview`;
    const response = await workflowToolsFetch(url, {
      method: 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await readResponsePayload(response);
      console.log(
        `[chat-tools] Failed to fetch connector metadata for "${connectorId}": ${response.status} ${getAzureErrorMessage(payload, response.statusText)}`
      );
      return undefined;
    }

    return (await response.json()) as ManagedApiConnectorMetadata;
  } catch (error) {
    console.log(`[chat-tools] Error fetching connector metadata: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * List existing API connections in a resource group that match a specific connector.
 *
 * ARM call: GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/connections
 *   ?api-version=2018-07-01-preview
 *   &$filter=ManagedApiName eq '{shortName}' and Kind eq 'V2'
 * @internal Exported for testing
 */
export async function listExistingApiConnections(azureContext: AzureContext, connectorShortName: string): Promise<ExistingApiConnection[]> {
  if (!azureContext.resourceGroup) {
    return [];
  }
  try {
    const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    let filterParts = `ManagedApiName eq '${connectorShortName}' and Kind eq 'V2'`;
    if (azureContext.location) {
      filterParts = `Location eq '${azureContext.location}' and ${filterParts}`;
    }
    const url = `${baseUrl}/subscriptions/${azureContext.subscriptionId}/resourceGroups/${azureContext.resourceGroup}/providers/Microsoft.Web/connections?api-version=2018-07-01-preview&$filter=${encodeURIComponent(filterParts)}`;

    const response = await workflowToolsFetch(url, {
      method: 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.log(`[chat-tools] Failed to list API connections: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as {
      value?: Array<{
        id: string;
        name: string;
        properties?: { displayName?: string; api?: { id?: string } };
      }>;
    };
    return (data.value ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      displayName: c.properties?.displayName,
      connectorId: c.properties?.api?.id,
    }));
  } catch (error) {
    console.log(`[chat-tools] Error listing existing API connections: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchManagedApiConnection(
  connectionId: string,
  azureContext: AzureContext
): Promise<ManagedApiConnectionResource | undefined> {
  try {
    const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${connectionId}?api-version=2018-07-01-preview`;
    const response = await workflowToolsFetch(url, {
      method: 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await readResponsePayload(response);
      console.log(
        `[chat-tools] Failed to fetch connection "${connectionId}": ${response.status} ${getAzureErrorMessage(payload, response.statusText)}`
      );
      return undefined;
    }

    return (await response.json()) as ManagedApiConnectionResource;
  } catch (error) {
    console.log(`[chat-tools] Error fetching connection resource: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Fetch connection keys for an existing API Hub connection.
 *
 * POST /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/connections/{name}/listConnectionKeys
 * @internal Exported for testing
 */
export async function fetchConnectionKey(
  connectionId: string,
  azureContext: AzureContext
): Promise<ManagedApiConnectionAccess | undefined> {
  try {
    const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${connectionId}/listConnectionKeys?api-version=2018-07-01-preview`;
    const response = await workflowToolsFetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ validityTimeSpan: '7' }),
    });

    if (!response.ok) {
      const payload = await readResponsePayload(response);
      console.log(`[chat-tools] Failed to fetch connection keys: ${response.status} ${getAzureErrorMessage(payload, response.statusText)}`);
      return undefined;
    }

    const data = (await response.json()) as { connectionKey?: string; runtimeUrls?: string[] };
    return {
      connectionKey: data.connectionKey,
      connectionRuntimeUrl: data.runtimeUrls?.[0],
    };
  } catch (error) {
    console.log(`[chat-tools] Error fetching connection key: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function deleteManagedApiConnection(connectionId: string, azureContext: AzureContext): Promise<void> {
  try {
    const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${connectionId}?api-version=2018-07-01-preview`;
    const response = await workflowToolsFetch(url, {
      method: 'DELETE',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });

    if (!response.ok && response.status !== 404) {
      const payload = await readResponsePayload(response);
      console.log(
        `[chat-tools] Failed to delete connection "${connectionId}": ${response.status} ${getAzureErrorMessage(payload, response.statusText)}`
      );
    }
  } catch (error) {
    console.log(`[chat-tools] Error deleting connection resource: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureManagedIdentityAccessPolicy(connectionId: string, azureContext: AzureContext): Promise<void> {
  const authSession = await getWorkflowToolsAuthData(azureContext.tenantId);
  const accessToken = authSession?.accessToken;
  if (!accessToken) {
    throw new Error('Could not obtain Azure authentication session for managed identity access policy creation.');
  }

  const tokenPayload = normalizeJwtPayload(accessToken);
  const objectId = typeof tokenPayload?.oid === 'string' ? tokenPayload.oid : undefined;
  const tenantId = typeof tokenPayload?.tid === 'string' ? tokenPayload.tid : undefined;
  const userPrincipalName =
    typeof tokenPayload?.upn === 'string'
      ? tokenPayload.upn
      : typeof tokenPayload?.unique_name === 'string'
        ? tokenPayload.unique_name
        : undefined;

  if (!objectId || !tenantId) {
    throw new Error('Could not extract user identity from the Azure authentication token.');
  }

  const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
  const policiesUrl = `${baseUrl}${connectionId}/accessPolicies?api-version=2018-07-01-preview`;
  const policyResponse = await workflowToolsFetch(policiesUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });

  if (policyResponse.ok) {
    const policyPayload = (await policyResponse.json()) as {
      value?: Array<{
        properties?: {
          principal?: {
            identity?: {
              objectId?: string;
              tenantId?: string;
            };
          };
        };
      }>;
    };

    const hasExistingPolicy = (policyPayload.value ?? []).some(
      (policy) =>
        policy.properties?.principal?.identity?.objectId === objectId && policy.properties?.principal?.identity?.tenantId === tenantId
    );

    if (hasExistingPolicy) {
      return;
    }
  }

  const policyNamePrefix = normalizeAccessPolicyNameSegment(userPrincipalName?.split('@')[0], 'logicapps');
  const policyName = `${policyNamePrefix}-${objectId.slice(-8)}`;
  const createPolicyUrl = `${baseUrl}${connectionId}/accessPolicies/${encodeURIComponent(policyName)}?api-version=2016-06-01`;
  const createResponse = await workflowToolsFetch(createPolicyUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        principal: {
          type: 'ActiveDirectory',
          identity: { objectId, tenantId },
        },
      },
    }),
  });

  if (!createResponse.ok) {
    const payload = await readResponsePayload(createResponse);
    throw new Error(`Failed to create access policy: ${getAzureErrorMessage(payload, createResponse.statusText)}`);
  }
}

function getConnectionStatusFailure(connection: ManagedApiConnectionResource | undefined): string | undefined {
  const statuses = connection?.properties?.statuses ?? [];
  for (const status of statuses) {
    const normalizedStatus = status.status?.toLowerCase();
    if (normalizedStatus && ['error', 'failed', 'disconnected', 'notconnected'].includes(normalizedStatus)) {
      return status.error?.message ?? `Connection status is ${status.status}.`;
    }
  }

  const overallStatus = connection?.properties?.overallStatus?.toLowerCase();
  if (overallStatus && ['error', 'failed', 'disconnected', 'notconnected'].includes(overallStatus)) {
    return `Connection overall status is ${connection?.properties?.overallStatus}.`;
  }

  return undefined;
}

export async function testManagedApiConnection(connectionId: string, azureContext: AzureContext): Promise<ManagedApiConnectionTestResult> {
  try {
    const connection = await fetchManagedApiConnection(connectionId, azureContext);
    if (!connection) {
      return { success: false, message: `Unable to retrieve connection "${connectionId}" for validation.` };
    }

    const statusFailure = getConnectionStatusFailure(connection);
    if (statusFailure) {
      return { success: false, message: statusFailure };
    }

    const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
    const testLink = connection.properties?.testLinks?.[0];
    const testRequest = connection.properties?.testRequests?.[0];
    const testTarget = testLink ?? testRequest;

    if (!testTarget?.requestUri || !testTarget.method) {
      return { success: true };
    }

    const response = await workflowToolsFetch(testTarget.requestUri, {
      method: testTarget.method.toUpperCase(),
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        noBatch: 'true',
      },
      ...(testTarget.body
        ? {
            body: typeof testTarget.body === 'string' ? testTarget.body : JSON.stringify(testTarget.body),
          }
        : {}),
    });

    const payload = await readResponsePayload(response);

    if (testLink) {
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          success: false,
          message: getAzureErrorMessage(payload, 'Please check your account info and/or permissions and try again.'),
        };
      }
      return { success: true };
    }

    if (!response.ok) {
      return {
        success: false,
        message: getAzureErrorMessage(payload, 'Please check your account info and/or permissions and try again.'),
      };
    }

    const responsePayload =
      typeof payload === 'object' && payload !== null && 'response' in (payload as Record<string, unknown>)
        ? ((payload as Record<string, unknown>).response as Record<string, unknown> | undefined)
        : (payload as Record<string, unknown> | undefined);

    if (responsePayload?.statusCode && responsePayload.statusCode !== 'OK') {
      return {
        success: false,
        message: getAzureErrorMessage(responsePayload.body, 'Please check your account info and/or permissions and try again.'),
      };
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Prompt for connector credentials using VS Code UI so secrets stay out of chat history.
 * @internal Exported for testing
 */
export async function promptForCredentials(
  connectorDisplayName: string,
  parameters: PromptableConnectionParameter[],
  preservedValues: Record<string, string>
): Promise<Record<string, unknown> | undefined> {
  const promptedValues: Record<string, unknown> = {};

  for (const parameter of parameters) {
    const existingValue = preservedValues[parameter.name] ?? parameter.defaultValue ?? '';

    if (parameter.allowedValues?.length) {
      const allowedValues = [...parameter.allowedValues].sort((left, right) => {
        if (left.value === existingValue) {
          return -1;
        }
        if (right.value === existingValue) {
          return 1;
        }
        return 0;
      });

      const pickedValue = await vscode.window.showQuickPick(
        allowedValues.map((allowedValue) => ({
          label: allowedValue.label,
          value: allowedValue.value,
          description: parameter.description,
        })),
        {
          title: `Connect ${connectorDisplayName}`,
          placeHolder: `Select ${parameter.displayName}`,
          ignoreFocusOut: true,
        }
      );

      if (!pickedValue) {
        return undefined;
      }

      preservedValues[parameter.name] = pickedValue.value;
      promptedValues[parameter.name] = coerceConnectorParameterValue(pickedValue.value, parameter.type);
      continue;
    }

    const value = await workflowToolsShowInputBox({
      title: `Connect ${connectorDisplayName}`,
      prompt: parameter.description ?? `Enter ${parameter.displayName}`,
      placeHolder: parameter.displayName,
      ignoreFocusOut: true,
      password: parameter.secret,
      value: existingValue,
      validateInput: (inputValue) => validatePromptableParameterInput(inputValue, parameter),
    });

    if (value === undefined) {
      return undefined;
    }

    preservedValues[parameter.name] = value;
    promptedValues[parameter.name] = coerceConnectorParameterValue(value, parameter.type);
  }

  return promptedValues;
}

async function createManagedApiConnectionResource(
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext,
  options?: {
    parameterValues?: Record<string, unknown>;
    parameterSetName?: string;
  }
): Promise<ManagedApiConnectionCreateResult> {
  if (!azureContext.resourceGroup || !azureContext.location) {
    return { success: false, message: 'Resource group and location required to create connection.' };
  }

  const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
  const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
  const connectionName = `${referenceName}-${Date.now().toString(36)}`;
  const connectionResourceId =
    `/subscriptions/${azureContext.subscriptionId}` +
    `/resourceGroups/${azureContext.resourceGroup}` +
    `/providers/Microsoft.Web/connections/${connectionName}`;
  const putUrl = `${baseUrl}${connectionResourceId}?api-version=2018-07-01-preview`;
  const parameterValues = options?.parameterValues ?? {};
  const putBody = {
    properties: {
      api: { id: connectorId },
      displayName: referenceName,
      ...(options?.parameterSetName
        ? {
            parameterValueSet: {
              name: options.parameterSetName,
              values: buildParameterValueSet(parameterValues),
            },
          }
        : Object.keys(parameterValues).length > 0
          ? { parameterValues }
          : {}),
    },
    kind: 'V2',
    location: azureContext.location,
  };

  try {
    const putResponse = await workflowToolsFetch(putUrl, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
    });

    if (!putResponse.ok) {
      const payload = await readResponsePayload(putResponse);
      return {
        success: false,
        message: `Failed to create connection in Azure: ${getAzureErrorMessage(payload, putResponse.statusText)}`,
      };
    }

    return {
      success: true,
      connectionName,
      connectionResourceId,
    };
  } catch (error) {
    return {
      success: false,
      message: `Network error creating connection in Azure: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function finalizeManagedApiConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  connectionResourceId: string,
  azureContext: AzureContext,
  options: FinalizeManagedApiConnectionOptions
): Promise<ManagedApiConnectionResolution> {
  const useMSI = isMSIAuthEnabled(azureContext.authenticationMethod);
  const fail = async (message: string): Promise<ManagedApiConnectionResolution> => {
    if (options.cleanupOnFailure) {
      await deleteManagedApiConnection(connectionResourceId, azureContext);
    }
    return { success: false, message };
  };

  try {
    if (useMSI) {
      await ensureManagedIdentityAccessPolicy(connectionResourceId, azureContext);
    }

    const testResult = await testManagedApiConnection(connectionResourceId, azureContext);
    if (!testResult.success) {
      return fail(`Connection validation failed: ${testResult.message ?? 'Unknown error.'}`);
    }

    const connectionAccess = await fetchConnectionKey(connectionResourceId, azureContext);
    if (!connectionAccess?.connectionRuntimeUrl) {
      return fail('Azure did not return a connection runtime URL for the resolved connection.');
    }

    if (!useMSI && !connectionAccess.connectionKey) {
      return fail('Azure did not return a connection key for the resolved connection.');
    }

    await addRealManagedApiConnection(
      projectPath,
      referenceName,
      connectorId,
      connectionResourceId,
      connectionAccess.connectionKey,
      useMSI,
      connectionAccess.connectionRuntimeUrl
    );

    return {
      success: true,
      connectionId: connectionResourceId,
      connectionName: options.connectionName,
      message: options.successMessage,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Write a fully-populated managed API connection entry (with real connection.id and key)
 * into connections.json and local.settings.json.
 *
 * When useMSI is true, uses ManagedServiceIdentity authentication and skips connection key storage.
 * @internal Exported for testing
 */
export async function addRealManagedApiConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  connectionResourceId: string,
  connectionKey?: string,
  useMSI = false,
  connectionRuntimeUrl?: string
): Promise<void> {
  const connectionsPath = path.join(projectPath, connectionsFileName);
  const localSettingsPath = path.join(projectPath, localSettingsFileName);

  let connectionsData: Record<string, unknown> = {};
  try {
    if (await fse.pathExists(connectionsPath)) {
      connectionsData = (await fse.readJson(connectionsPath)) as Record<string, unknown>;
    }
  } catch {
    connectionsData = {};
  }
  if (typeof connectionsData.managedApiConnections !== 'object' || connectionsData.managedApiConnections === null) {
    connectionsData.managedApiConnections = {};
  }
  const managed = connectionsData.managedApiConnections as Record<string, unknown>;

  if (useMSI) {
    managed[referenceName] = {
      api: { id: connectorId },
      connection: { id: connectionResourceId },
      connectionRuntimeUrl,
      authentication: { type: 'ManagedServiceIdentity' },
    };
  } else {
    const appSettingKey = `${referenceName}-connectionKey`;
    managed[referenceName] = {
      api: { id: connectorId },
      connection: { id: connectionResourceId },
      connectionRuntimeUrl,
      authentication: { type: 'Raw', scheme: 'Key', parameter: `@appsetting('${appSettingKey}')` },
    };
  }
  await fse.writeJson(connectionsPath, connectionsData, { spaces: 2 });

  if (!useMSI && connectionKey) {
    const appSettingKey = `${referenceName}-connectionKey`;
    let localSettings: Record<string, unknown> = {};
    try {
      if (await fse.pathExists(localSettingsPath)) {
        localSettings = (await fse.readJson(localSettingsPath)) as Record<string, unknown>;
      }
    } catch {
      localSettings = {};
    }
    if (typeof localSettings.Values !== 'object' || localSettings.Values === null) {
      localSettings.Values = {};
    }
    (localSettings.Values as Record<string, string>)[appSettingKey] = connectionKey;
    await fse.writeJson(localSettingsPath, localSettings, { spaces: 2 });
  }
  console.log(`[chat-tools] Added real managed API connection for "${referenceName}" -> ${connectionResourceId} (MSI=${useMSI})`);
}

/**
 * Try to reuse an existing Azure API connection from the resource group.
 * Auto-picks the first valid match and mentions alternatives in the result message.
 * @internal Exported for testing
 */
export async function tryReuseExistingConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext
): Promise<ManagedApiConnectionResolution> {
  const shortName = getConnectorShortName(connectorId);
  const existing = await listExistingApiConnections(azureContext, shortName);

  if (existing.length === 0) {
    return { success: false };
  }

  const failureReasons: string[] = [];
  for (const picked of existing) {
    console.log(`[chat-tools] Attempting to reuse existing connection "${picked.name}" for "${referenceName}"`);

    const result = await finalizeManagedApiConnection(projectPath, referenceName, connectorId, picked.id, azureContext, {
      connectionName: picked.displayName || picked.name,
      successMessage: `Connected using existing connection "${picked.displayName || picked.name}" in resource group "${azureContext.resourceGroup}".`,
    });

    if (result.success) {
      if (existing.length > 1) {
        const others = existing
          .filter((candidate) => candidate.id !== picked.id)
          .map((candidate) => candidate.displayName || candidate.name)
          .join(', ');
        result.message += others ? ` (Also available: ${others})` : '';
      }
      return result;
    }

    failureReasons.push(`"${picked.displayName || picked.name}": ${result.message}`);
  }

  return {
    success: false,
    message: `Found existing ${shortName} connection(s), but none were reusable. ${failureReasons.join(' ')}`.trim(),
  };
}

/**
 * Pending OAuth callback tracker. Resolves with the auth code when the
 * `logicapps://authcomplete` URI redirect is received.
 */
const pendingOAuthCallbacks = new Map<string, { resolve: (code: string) => void; reject: (err: Error) => void }>();

/**
 * Register a pending OAuth callback for testing.
 * Returns a promise that resolves when handleChatOAuthRedirect is called with the matching pid.
 * @internal Exported for testing
 */
export function registerPendingOAuthCallback(pid: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pendingOAuthCallbacks.set(pid, { resolve, reject });
  });
}

/**
 * Handle an OAuth redirect aimed at the chat agent (not the designer webview).
 * Called from the UriHandler when the pid matches a pending chat OAuth request.
 */
export function handleChatOAuthRedirect(queryParams: Record<string, string>): boolean {
  const pid = queryParams['pid'];
  if (!pid || !pendingOAuthCallbacks.has(pid)) {
    return false;
  }
  const pending = pendingOAuthCallbacks.get(pid)!;
  pendingOAuthCallbacks.delete(pid);

  if (queryParams['error']) {
    pending.reject(new Error(queryParams['error']));
  } else {
    pending.resolve(queryParams['code'] || 'valid');
  }
  return true;
}

async function createSimpleManagedApiConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext,
  metadata: ManagedApiConnectorMetadata
): Promise<ManagedApiConnectionResolution> {
  const parameterShape = resolveConnectorParameterShape(metadata);
  const parameterValues = collectDefaultParameterValues(parameterShape?.parameters ?? {});
  const createResult = await createManagedApiConnectionResource(referenceName, connectorId, azureContext, {
    parameterValues,
    parameterSetName: parameterShape?.parameterSetName,
  });

  if (!createResult.success || !createResult.connectionResourceId) {
    return {
      success: false,
      message: createResult.message ?? `Failed to create a connection for "${getConnectorDisplayName(metadata, referenceName)}".`,
    };
  }

  return finalizeManagedApiConnection(projectPath, referenceName, connectorId, createResult.connectionResourceId, azureContext, {
    cleanupOnFailure: true,
    connectionName: createResult.connectionName,
    successMessage: `Created connection "${createResult.connectionName}" in resource group "${azureContext.resourceGroup}".`,
  });
}

async function createCredentialBasedConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext,
  metadata: ManagedApiConnectorMetadata
): Promise<ManagedApiConnectionResolution> {
  const parameterShape = resolveConnectorParameterShape(metadata);
  if (!parameterShape) {
    return {
      success: false,
      message: `Connector "${getConnectorDisplayName(metadata, referenceName)}" did not expose any configurable parameters.`,
    };
  }

  const promptableParameters = extractPromptableParameters(parameterShape.parameters);
  if (promptableParameters.length === 0) {
    return createSimpleManagedApiConnection(projectPath, referenceName, connectorId, azureContext, metadata);
  }

  const connectorDisplayName = getConnectorDisplayName(metadata, referenceName);
  const preservedValues: Record<string, string> = {};
  const defaultValues = collectDefaultParameterValues(parameterShape.parameters);

  while (true) {
    const promptedValues = await promptForCredentials(connectorDisplayName, promptableParameters, preservedValues);
    if (!promptedValues) {
      return { success: false, message: `Credential entry for "${connectorDisplayName}" was cancelled.` };
    }

    const createResult = await createManagedApiConnectionResource(referenceName, connectorId, azureContext, {
      parameterValues: { ...defaultValues, ...promptedValues },
      parameterSetName: parameterShape.parameterSetName,
    });

    if (!createResult.success || !createResult.connectionResourceId) {
      const retryResult = await vscode.window.showWarningMessage(
        `Failed to create ${connectorDisplayName} connection: ${createResult.message ?? 'Unknown error.'}`,
        'Retry',
        'Cancel'
      );

      if (retryResult === 'Retry') {
        continue;
      }

      return { success: false, message: createResult.message ?? `Failed to create ${connectorDisplayName} connection.` };
    }

    return finalizeManagedApiConnection(projectPath, referenceName, connectorId, createResult.connectionResourceId, azureContext, {
      cleanupOnFailure: true,
      connectionName: createResult.connectionName,
      successMessage: `Created connection "${createResult.connectionName}" in resource group "${azureContext.resourceGroup}".`,
    });
  }
}

/**
 * Create a new API connection in Azure via ARM and complete OAuth consent inline.
 *
 * 1. PUT connection resource to ARM
 * 2. POST listConsentLinks -> get consent URL
 * 3. Open browser for user to authenticate
 * 4. Wait for logicapps://authcomplete callback
 * 5. POST confirmConsentCode
 * 6. Validate connection and write local files
 */
async function createAndAuthManagedApiConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext
): Promise<ManagedApiConnectionResolution> {
  const createResult = await createManagedApiConnectionResource(referenceName, connectorId, azureContext);
  if (!createResult.success || !createResult.connectionResourceId) {
    return { success: false, message: createResult.message };
  }

  const connectionResourceId = createResult.connectionResourceId;
  const failAndCleanup = async (message: string): Promise<ManagedApiConnectionResolution> => {
    await deleteManagedApiConnection(connectionResourceId, azureContext);
    return { success: false, message };
  };

  const token = await getWorkflowToolsAuthorizationToken(azureContext.tenantId);
  const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
  const authSession = await getWorkflowToolsAuthData(azureContext.tenantId);
  const accessToken = authSession?.accessToken;
  if (!accessToken) {
    return failAndCleanup('Could not obtain Azure authentication session.');
  }

  const tokenPayload = normalizeJwtPayload(accessToken);
  const userObjectId = typeof tokenPayload?.oid === 'string' ? tokenPayload.oid : undefined;
  const userTenantId = typeof tokenPayload?.tid === 'string' ? tokenPayload.tid : undefined;
  if (!userObjectId || !userTenantId) {
    return failAndCleanup('Could not extract user identity from the Azure authentication token.');
  }

  const pid = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const callbackUri = await (vscode.env as any).asExternalUri(
    vscode.Uri.parse(`${vscode.env.uriScheme}://${logicAppsStandardExtensionId}/authcomplete`)
  );
  const redirectUrl = `${callbackUri.toString(true)}?pid=${pid}`;

  const consentUrl = await fetchConsentUrl(connectionResourceId, userObjectId, userTenantId, redirectUrl, token, baseUrl);
  if (!consentUrl) {
    return failAndCleanup('Could not obtain OAuth consent URL from Azure.');
  }

  const codePromise = new Promise<string>((resolve, reject) => {
    pendingOAuthCallbacks.set(pid, { resolve, reject });

    setTimeout(() => {
      if (pendingOAuthCallbacks.has(pid)) {
        pendingOAuthCallbacks.delete(pid);
        reject(new Error('OAuth authentication timed out after 5 minutes.'));
      }
    }, 300_000);
  });

  await vscode.env.openExternal(vscode.Uri.parse(consentUrl));
  vscode.window.showInformationMessage('Please complete authentication in your browser to connect.');

  let authCode: string;
  try {
    authCode = await codePromise;
  } catch (error) {
    return failAndCleanup(error instanceof Error ? error.message : 'OAuth authentication failed.');
  }

  if (authCode !== 'valid') {
    const confirmOk = await confirmConsentCode(connectionResourceId, authCode, userObjectId, userTenantId, token, baseUrl);
    if (!confirmOk) {
      return failAndCleanup('Failed to confirm OAuth authorization code.');
    }
  }

  return finalizeManagedApiConnection(projectPath, referenceName, connectorId, connectionResourceId, azureContext, {
    cleanupOnFailure: true,
    connectionName: createResult.connectionName,
    successMessage: `Created and authenticated connection "${referenceName}" in resource group "${azureContext.resourceGroup}".`,
  });
}

/**
 * POST listConsentLinks to get OAuth consent URL for a connection.
 */
async function fetchConsentUrl(
  connectionResourceId: string,
  objectId: string,
  tenantId: string,
  redirectUrl: string,
  token: string,
  baseUrl: string
): Promise<string | undefined> {
  try {
    const url = `${baseUrl}${connectionResourceId}/listConsentLinks?api-version=2018-07-01-preview`;
    const body = {
      parameters: [
        {
          objectId,
          parameterName: 'token',
          redirectUrl,
          tenantId,
        },
      ],
    };
    const response = await workflowToolsFetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = await readResponsePayload(response);
      console.log(`[chat-tools] Failed to get consent links: ${response.status} ${getAzureErrorMessage(payload, response.statusText)}`);
      return undefined;
    }

    const data = (await response.json()) as { value?: Array<{ link?: string }> };
    return data.value?.[0]?.link;
  } catch (error) {
    console.log(`[chat-tools] Error fetching consent URL: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * POST confirmConsentCode to finalize OAuth for a connection.
 */
async function confirmConsentCode(
  connectionResourceId: string,
  code: string,
  objectId: string,
  tenantId: string,
  token: string,
  baseUrl: string
): Promise<boolean> {
  try {
    const url = `${baseUrl}${connectionResourceId}/confirmConsentCode?api-version=2018-07-01-preview`;
    const body = { code, objectId, tenantId };
    const response = await workflowToolsFetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = await readResponsePayload(response);
      console.log(`[chat-tools] Failed to confirm consent code: ${response.status} ${getAzureErrorMessage(payload, response.statusText)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.log(`[chat-tools] Error confirming consent code: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Attempt to resolve a managed API connection automatically:
 *  1. Try reusing an existing connection in the resource group
 *  2. Use connector metadata to determine whether to auto-create, prompt for credentials, or run OAuth
 *  3. Fall back to placeholder (caller handles this)
 */
async function tryResolveManagedApiConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string
): Promise<ManagedApiConnectionResolution> {
  const azureContext = await getAzureContextFromLocalSettings(projectPath);
  if (!azureContext) {
    return { success: false, message: 'No Azure context configured in local.settings.json.' };
  }

  if (azureContext.resourceGroup) {
    const reuseResult = await tryReuseExistingConnection(projectPath, referenceName, connectorId, azureContext);
    if (reuseResult.success) {
      return reuseResult;
    }

    if (reuseResult.message) {
      console.log(`[chat-tools] Existing connection reuse failed: ${reuseResult.message}`);
    }
  }

  const connectorMetadata = await fetchConnectorMetadata(connectorId, azureContext);
  if (!connectorMetadata) {
    const oauthFallback = await createAndAuthManagedApiConnection(projectPath, referenceName, connectorId, azureContext);
    if (oauthFallback.success) {
      return oauthFallback;
    }

    return {
      success: false,
      message: `Could not inspect connector authentication metadata automatically. ${oauthFallback.message ?? ''}`.trim(),
    };
  }

  const connectorDisplayName = getConnectorDisplayName(connectorMetadata, getConnectorShortName(connectorId));
  switch (classifyConnectorAuthType(connectorMetadata)) {
    case 'simple':
      return createSimpleManagedApiConnection(projectPath, referenceName, connectorId, azureContext, connectorMetadata);
    case 'credential':
      return createCredentialBasedConnection(projectPath, referenceName, connectorId, azureContext, connectorMetadata);
    case 'oauthOnly':
      return createAndAuthManagedApiConnection(projectPath, referenceName, connectorId, azureContext);
    case 'multiAuth':
      return {
        success: false,
        message: `Connector "${connectorDisplayName}" supports multiple authentication modes. Open the designer to choose the authentication flow.`,
      };
    default:
      return {
        success: false,
        message: `Could not determine how to authenticate connector "${connectorDisplayName}".`,
      };
  }
}

/**
 * Result of creating a service provider connection
 */
interface ServiceProviderConnectionResult {
  /** Whether the connection was successfully created */
  success: boolean;
  /** Whether the connection already existed (no prompt needed) */
  alreadyExists?: boolean;
  /** Whether chat needs additional user input before the connection can be created */
  requiresUserInput?: boolean;
  /** Error message if creation failed */
  error?: string;
  /** Success note surfaced back to the chat tool result */
  completionNote?: string;
}

interface ExplicitServiceProviderConnectionResolution {
  usesExplicitInput: boolean;
  connectionString?: string;
  missingFields?: Array<keyof ServiceProviderConnectionInput>;
  resourceId?: string;
  resourceName?: string;
}

/**
 * Azure resource info for the resource picker
 */
interface AzureResourceInfo {
  id: string;
  name: string;
  location?: string;
  type: string;
}

/**
 * Maps service provider IDs to Azure resource types for resource picker
 */
const serviceProviderToAzureResourceType: Record<string, { resourceType: string; apiVersion: string }> = {
  '/serviceProviders/serviceBus': {
    resourceType: 'Microsoft.ServiceBus/namespaces',
    apiVersion: '2021-11-01',
  },
  '/serviceProviders/AzureBlob': {
    resourceType: 'Microsoft.Storage/storageAccounts',
    apiVersion: '2023-01-01',
  },
  '/serviceProviders/AzureQueues': {
    resourceType: 'Microsoft.Storage/storageAccounts',
    apiVersion: '2023-01-01',
  },
  '/serviceProviders/AzureTables': {
    resourceType: 'Microsoft.Storage/storageAccounts',
    apiVersion: '2023-01-01',
  },
  '/serviceProviders/AzureFile': {
    resourceType: 'Microsoft.Storage/storageAccounts',
    apiVersion: '2023-01-01',
  },
  '/serviceProviders/eventHub': {
    resourceType: 'Microsoft.EventHub/namespaces',
    apiVersion: '2022-10-01-preview',
  },
};

function getOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeServiceProviderConnectionInput(
  input?: ServiceProviderConnectionInput | Record<string, unknown>
): ServiceProviderConnectionInput | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const inputRecord = input as Record<string, unknown>;
  const normalized: ServiceProviderConnectionInput = {
    resourceId: getOptionalTrimmedString(inputRecord.resourceId),
    resourceName: getOptionalTrimmedString(inputRecord.resourceName),
    connectionString: getOptionalTrimmedString(inputRecord.connectionString),
    endpoint: getOptionalTrimmedString(inputRecord.endpoint),
    sharedAccessKeyName: getOptionalTrimmedString(inputRecord.sharedAccessKeyName),
    sharedAccessKey: getOptionalTrimmedString(inputRecord.sharedAccessKey),
  };

  return Object.values(normalized).some((value) => Boolean(value)) ? normalized : undefined;
}

export function buildServiceBusConnectionString(endpoint: string, sharedAccessKeyName: string, sharedAccessKey: string): string {
  const trimmedEndpoint = endpoint.trim();
  const endpointPart = /^endpoint=/i.test(trimmedEndpoint) ? trimmedEndpoint : `Endpoint=${trimmedEndpoint}`;
  return `${endpointPart};SharedAccessKeyName=${sharedAccessKeyName.trim()};SharedAccessKey=${sharedAccessKey.trim()}`;
}

function resolveExplicitServiceProviderConnection(
  serviceProviderId: string,
  input?: ServiceProviderConnectionInput
): ExplicitServiceProviderConnectionResolution {
  const normalizedInput = normalizeServiceProviderConnectionInput(input);
  if (!normalizedInput) {
    return { usesExplicitInput: false };
  }

  if (normalizedInput.connectionString) {
    return {
      usesExplicitInput: true,
      connectionString: normalizedInput.connectionString,
      resourceId: normalizedInput.resourceId,
      resourceName: normalizedInput.resourceName,
    };
  }

  const hasResourceSelection = Boolean(normalizedInput.resourceId || normalizedInput.resourceName);
  const normalizedServiceProviderId = serviceProviderId.toLowerCase();
  const hasServiceBusFields = Boolean(normalizedInput.endpoint || normalizedInput.sharedAccessKeyName || normalizedInput.sharedAccessKey);

  if (normalizedServiceProviderId === '/serviceproviders/servicebus' && hasServiceBusFields) {
    const missingFields: Array<keyof ServiceProviderConnectionInput> = [];

    if (!normalizedInput.endpoint) {
      missingFields.push('endpoint');
    }
    if (!normalizedInput.sharedAccessKeyName) {
      missingFields.push('sharedAccessKeyName');
    }
    if (!normalizedInput.sharedAccessKey) {
      missingFields.push('sharedAccessKey');
    }

    if (missingFields.length === 0) {
      return {
        usesExplicitInput: true,
        connectionString: buildServiceBusConnectionString(
          normalizedInput.endpoint!,
          normalizedInput.sharedAccessKeyName!,
          normalizedInput.sharedAccessKey!
        ),
        resourceId: normalizedInput.resourceId,
        resourceName: normalizedInput.resourceName,
      };
    }

    return {
      usesExplicitInput: true,
      missingFields,
      resourceId: normalizedInput.resourceId,
      resourceName: normalizedInput.resourceName,
    };
  }

  if (hasResourceSelection) {
    return {
      usesExplicitInput: true,
      resourceId: normalizedInput.resourceId,
      resourceName: normalizedInput.resourceName,
    };
  }

  return {
    usesExplicitInput: true,
    missingFields: ['connectionString'],
  };
}

function buildServiceProviderFieldPath(fieldName: keyof ServiceProviderConnectionInput): string {
  return `serviceProviderConnection.${fieldName}`;
}

function buildServiceProviderConnectionPromptMessage(
  connectorDisplayName: string,
  serviceProviderId: string,
  options?: {
    availableResources?: AzureResourceInfo[];
    missingFields?: Array<keyof ServiceProviderConnectionInput>;
    requestedResourceId?: string;
    requestedResourceName?: string;
  }
): string {
  const lines = [`I need connection details before I can add the ${connectorDisplayName} action.`];

  if (options?.requestedResourceId || options?.requestedResourceName) {
    const requestedResource = options.requestedResourceName ?? options.requestedResourceId;
    lines.push(`I couldn't find the requested Azure resource "${requestedResource}".`);
  }

  if (options?.availableResources?.length) {
    const resourceNames = options.availableResources
      .slice(0, 5)
      .map((resource) => resource.name)
      .join(', ');
    lines.push(`Available ${connectorDisplayName} resources: ${resourceNames}.`);
    lines.push(
      `Reply with ${buildServiceProviderFieldPath('resourceName')} or ${buildServiceProviderFieldPath('resourceId')} to use one of those resources.`
    );
  }

  if (options?.missingFields?.length) {
    lines.push(`Missing fields: ${options.missingFields.map(buildServiceProviderFieldPath).join(', ')}.`);
  }

  if (serviceProviderId.toLowerCase() === '/serviceproviders/servicebus') {
    lines.push(
      `Reply with either ${buildServiceProviderFieldPath('connectionString')}, or with ${buildServiceProviderFieldPath('endpoint')}, ${buildServiceProviderFieldPath('sharedAccessKeyName')}, and ${buildServiceProviderFieldPath('sharedAccessKey')}.`
    );
  } else {
    lines.push(`Reply with ${buildServiceProviderFieldPath('connectionString')}.`);
  }

  return lines.join(' ');
}

/**
 * Azure context resolved from local.settings.json
 * @internal Exported for testing
 */
export interface AzureContext {
  subscriptionId: string;
  tenantId?: string;
  resourceGroup?: string;
  location?: string;
  managementBaseUrl: string;
  authenticationMethod?: string;
}

/**
 * Check if the authentication method is Managed Service Identity.
 * @internal Exported for testing
 */
export function isMSIAuthEnabled(authenticationMethod?: string): boolean {
  return authenticationMethod?.toLowerCase() === 'managedserviceidentity';
}

/**
 * Gets Azure subscription, tenant, resource group, and location from local.settings.json
 */
async function getAzureContextFromLocalSettings(projectPath: string): Promise<AzureContext | undefined> {
  const localSettingsPath = path.join(projectPath, localSettingsFileName);
  try {
    if (await fse.pathExists(localSettingsPath)) {
      const localSettings = (await fse.readJson(localSettingsPath)) as Record<string, unknown>;
      const values = localSettings.Values as Record<string, string> | undefined;
      if (values?.[workflowSubscriptionIdKey]) {
        return {
          subscriptionId: values[workflowSubscriptionIdKey],
          tenantId: values[workflowTenantIdKey],
          resourceGroup: values[workflowResourceGroupNameKey],
          location: values[workflowLocationKey],
          managementBaseUrl: values[workflowManagementBaseURIKey] ?? azurePublicBaseUrl,
          authenticationMethod: values[workflowAuthenticationMethodKey],
        };
      }
    }
  } catch {
    // Ignore errors reading local settings
  }
  return undefined;
}

/**
 * Lists Azure resources of a specific type in a subscription
 */
async function listAzureResources(
  subscriptionId: string,
  resourceType: string,
  apiVersion: string,
  tenantId?: string,
  managementBaseUrl = azurePublicBaseUrl
): Promise<AzureResourceInfo[]> {
  try {
    const token = await getAuthorizationToken(tenantId);
    const provider = resourceType.split('/')[0];
    const type = resourceType.split('/')[1];
    const url = `${managementBaseUrl}/subscriptions/${subscriptionId}/providers/${provider}/${type}?api-version=${apiVersion}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.log(`[chat-tools] Failed to list Azure resources: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as { value?: Array<{ id: string; name: string; location?: string; type: string }> };
    return (data.value ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location,
      type: r.type,
    }));
  } catch (error) {
    console.log(`[chat-tools] Error listing Azure resources: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Gets a Service Bus connection string from a namespace
 */
async function getServiceBusConnectionString(
  resourceId: string,
  tenantId?: string,
  managementBaseUrl = azurePublicBaseUrl
): Promise<string | undefined> {
  try {
    const token = await getAuthorizationToken(tenantId);

    // First, get the authorization rules
    const authRulesUrl = `${managementBaseUrl}${resourceId}/AuthorizationRules?api-version=2021-11-01`;
    const authRulesResponse = await fetch(authRulesUrl, {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    if (!authRulesResponse.ok) {
      console.log(`[chat-tools] Failed to get Service Bus auth rules: ${authRulesResponse.status}`);
      return undefined;
    }

    const authRulesData = (await authRulesResponse.json()) as { value?: Array<{ id: string; name: string }> };
    const authRules = authRulesData.value ?? [];

    // Prefer RootManageSharedAccessKey, otherwise use the first rule
    const authRule = authRules.find((r) => r.name === 'RootManageSharedAccessKey') ?? authRules[0];
    if (!authRule) {
      console.log('[chat-tools] No authorization rules found for Service Bus');
      return undefined;
    }

    // Get the keys for the auth rule
    const listKeysUrl = `${managementBaseUrl}${authRule.id}/listKeys?api-version=2021-11-01`;
    const keysResponse = await fetch(listKeysUrl, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    if (!keysResponse.ok) {
      console.log(`[chat-tools] Failed to list Service Bus keys: ${keysResponse.status}`);
      return undefined;
    }

    const keysData = (await keysResponse.json()) as { primaryConnectionString?: string };
    return keysData.primaryConnectionString;
  } catch (error) {
    console.log(`[chat-tools] Error getting Service Bus connection string: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Gets a Storage Account connection string
 */
async function getStorageConnectionString(
  resourceId: string,
  tenantId?: string,
  managementBaseUrl = azurePublicBaseUrl
): Promise<string | undefined> {
  try {
    const token = await getAuthorizationToken(tenantId);

    // Get the storage account keys
    const listKeysUrl = `${managementBaseUrl}${resourceId}/listKeys?api-version=2023-01-01`;
    const keysResponse = await fetch(listKeysUrl, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    if (!keysResponse.ok) {
      console.log(`[chat-tools] Failed to list Storage keys: ${keysResponse.status}`);
      return undefined;
    }

    const keysData = (await keysResponse.json()) as { keys?: Array<{ value: string }> };
    const key = keysData.keys?.[0]?.value;
    if (!key) {
      console.log('[chat-tools] No keys found for Storage account');
      return undefined;
    }

    // Extract account name from resource ID
    const accountName = resourceId.split('/').pop();

    // Determine the endpoint suffix based on management URL
    let endpointSuffix = 'core.windows.net';
    if (managementBaseUrl.includes('.azure.cn')) {
      endpointSuffix = 'core.chinacloudapi.cn';
    } else if (managementBaseUrl.includes('.azure.us')) {
      endpointSuffix = 'core.usgovcloudapi.net';
    }

    return `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${key};EndpointSuffix=${endpointSuffix}`;
  } catch (error) {
    console.log(`[chat-tools] Error getting Storage connection string: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Gets an Event Hub connection string from a namespace
 */
async function getEventHubConnectionString(
  resourceId: string,
  tenantId?: string,
  managementBaseUrl = azurePublicBaseUrl
): Promise<string | undefined> {
  try {
    const token = await getAuthorizationToken(tenantId);

    // Get the authorization rules
    const authRulesUrl = `${managementBaseUrl}${resourceId}/AuthorizationRules?api-version=2022-10-01-preview`;
    const authRulesResponse = await fetch(authRulesUrl, {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    if (!authRulesResponse.ok) {
      console.log(`[chat-tools] Failed to get Event Hub auth rules: ${authRulesResponse.status}`);
      return undefined;
    }

    const authRulesData = (await authRulesResponse.json()) as { value?: Array<{ id: string; name: string }> };
    const authRules = authRulesData.value ?? [];

    const authRule = authRules.find((r) => r.name === 'RootManageSharedAccessKey') ?? authRules[0];
    if (!authRule) {
      console.log('[chat-tools] No authorization rules found for Event Hub');
      return undefined;
    }

    // Get the keys
    const listKeysUrl = `${managementBaseUrl}${authRule.id}/listKeys?api-version=2022-10-01-preview`;
    const keysResponse = await fetch(listKeysUrl, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    if (!keysResponse.ok) {
      console.log(`[chat-tools] Failed to list Event Hub keys: ${keysResponse.status}`);
      return undefined;
    }

    const keysData = (await keysResponse.json()) as { primaryConnectionString?: string };
    return keysData.primaryConnectionString;
  } catch (error) {
    console.log(`[chat-tools] Error getting Event Hub connection string: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Gets the connection string for an Azure resource based on its type
 */
async function getConnectionStringForResource(
  resourceId: string,
  resourceType: string,
  tenantId?: string,
  managementBaseUrl?: string
): Promise<string | undefined> {
  const normalizedType = resourceType.toLowerCase();

  if (normalizedType.includes('servicebus')) {
    return getServiceBusConnectionString(resourceId, tenantId, managementBaseUrl);
  }
  if (normalizedType.includes('storage')) {
    return getStorageConnectionString(resourceId, tenantId, managementBaseUrl);
  }
  if (normalizedType.includes('eventhub')) {
    return getEventHubConnectionString(resourceId, tenantId, managementBaseUrl);
  }

  return undefined;
}

/**
 * Creates a service provider connection by letting the user pick an Azure resource.
 * Falls back to placeholder if Azure is not configured or user cancels.
 */
async function createServiceProviderConnection(
  projectPath: string,
  connectionName: string,
  serviceProviderId: string,
  connectorDisplayName: string,
  serviceProviderConnection?: ServiceProviderConnectionInput
): Promise<ServiceProviderConnectionResult> {
  const connectionsPath = path.join(projectPath, connectionsFileName);
  const localSettingsPath = path.join(projectPath, localSettingsFileName);

  // Check if connection already exists
  let connectionsData: Record<string, unknown> = {};
  try {
    if (await fse.pathExists(connectionsPath)) {
      connectionsData = (await fse.readJson(connectionsPath)) as Record<string, unknown>;
    }
  } catch {
    connectionsData = {};
  }

  if (typeof connectionsData.serviceProviderConnections !== 'object' || connectionsData.serviceProviderConnections === null) {
    connectionsData.serviceProviderConnections = {};
  }
  const spConns = connectionsData.serviceProviderConnections as Record<string, unknown>;

  // If connection already exists, return early
  if (spConns[connectionName]) {
    console.log(`[chat-tools] Service provider connection "${connectionName}" already exists`);
    return { success: true, alreadyExists: true };
  }

  // Try to get Azure context from local settings
  const azureContext = await getAzureContextFromLocalSettings(projectPath);
  let connectionString: string | undefined;
  let completionNote: string | undefined;
  const explicitConnection = resolveExplicitServiceProviderConnection(serviceProviderId, serviceProviderConnection);

  if (explicitConnection.connectionString) {
    connectionString = explicitConnection.connectionString;
    completionNote = `Created connection for "${connectionName}" from chat-provided connection details.`;
  } else if (explicitConnection.usesExplicitInput && explicitConnection.missingFields?.length) {
    return {
      success: false,
      requiresUserInput: true,
      error: buildServiceProviderConnectionPromptMessage(connectorDisplayName, serviceProviderId, {
        missingFields: explicitConnection.missingFields,
      }),
    };
  }

  if (!connectionString && azureContext?.subscriptionId) {
    // Map service provider to Azure resource type
    const resourceMapping = serviceProviderToAzureResourceType[serviceProviderId];
    if (resourceMapping) {
      // List Azure resources
      const resources = await listAzureResources(
        azureContext.subscriptionId,
        resourceMapping.resourceType,
        resourceMapping.apiVersion,
        azureContext.tenantId,
        azureContext.managementBaseUrl
      );

      if (resources.length > 0) {
        const selectedResource =
          explicitConnection.resourceId || explicitConnection.resourceName
            ? resources.find((resource) => {
                const matchesId =
                  explicitConnection.resourceId && resource.id.toLowerCase() === explicitConnection.resourceId.toLowerCase();
                const matchesName =
                  explicitConnection.resourceName && resource.name.toLowerCase() === explicitConnection.resourceName.toLowerCase();
                return Boolean(matchesId || matchesName);
              })
            : resources.length === 1
              ? resources[0]
              : undefined;

        if (!selectedResource && (explicitConnection.resourceId || explicitConnection.resourceName)) {
          return {
            success: false,
            requiresUserInput: true,
            error: buildServiceProviderConnectionPromptMessage(connectorDisplayName, serviceProviderId, {
              requestedResourceId: explicitConnection.resourceId,
              requestedResourceName: explicitConnection.resourceName,
              availableResources: resources,
            }),
          };
        }

        if (!selectedResource && resources.length > 1) {
          return {
            success: false,
            requiresUserInput: true,
            error: buildServiceProviderConnectionPromptMessage(connectorDisplayName, serviceProviderId, {
              availableResources: resources,
            }),
          };
        }

        if (selectedResource) {
          connectionString = await getConnectionStringForResource(
            selectedResource.id,
            selectedResource.type,
            azureContext.tenantId,
            azureContext.managementBaseUrl
          );

          if (connectionString) {
            completionNote = `Created connection for "${connectionName}" from Azure resource "${selectedResource.name}".`;
            console.log(`[chat-tools] Retrieved connection string from ${selectedResource.name}`);
          } else {
            return {
              success: false,
              requiresUserInput: true,
              error: `Could not retrieve connection details from Azure resource "${selectedResource.name}". ${buildServiceProviderConnectionPromptMessage(
                connectorDisplayName,
                serviceProviderId
              )}`,
            };
          }
        }
      }
    }
  }

  if (!connectionString) {
    return {
      success: false,
      requiresUserInput: true,
      error: buildServiceProviderConnectionPromptMessage(connectorDisplayName, serviceProviderId),
    };
  }

  // Create the app setting key for the connection string
  const appSettingKey = `${connectionName}_connectionString`;

  // Update local.settings.json with the connection string
  let localSettings: Record<string, unknown> = {};
  try {
    if (await fse.pathExists(localSettingsPath)) {
      localSettings = (await fse.readJson(localSettingsPath)) as Record<string, unknown>;
    }
  } catch {
    localSettings = {};
  }

  if (typeof localSettings.Values !== 'object' || localSettings.Values === null) {
    localSettings.Values = {};
  }
  (localSettings.Values as Record<string, string>)[appSettingKey] = connectionString;
  await fse.writeJson(localSettingsPath, localSettings, { spaces: 2 });
  console.log(`[chat-tools] Added connection string to local.settings.json as "${appSettingKey}"`);

  // Create the service provider connection with @appsetting reference
  spConns[connectionName] = {
    serviceProvider: { id: serviceProviderId },
    parameterValues: {
      connectionString: `@appsetting('${appSettingKey}')`,
    },
    displayName: connectionName,
  };
  await fse.writeJson(connectionsPath, connectionsData, { spaces: 2 });
  console.log(`[chat-tools] Created service provider connection for "${connectionName}"`);

  return { success: true, completionNote };
}

/**
 * @deprecated Use createServiceProviderConnection instead for new connections.
 * This function creates a placeholder connection that requires manual configuration in the designer.
 */
async function addPlaceholderServiceProviderConnection(
  projectPath: string,
  connectionName: string,
  serviceProviderId: string
): Promise<void> {
  const connectionsPath = path.join(projectPath, connectionsFileName);
  let connectionsData: Record<string, unknown> = {};
  try {
    if (await fse.pathExists(connectionsPath)) {
      connectionsData = (await fse.readJson(connectionsPath)) as Record<string, unknown>;
    }
  } catch {
    connectionsData = {};
  }
  if (typeof connectionsData.serviceProviderConnections !== 'object' || connectionsData.serviceProviderConnections === null) {
    connectionsData.serviceProviderConnections = {};
  }
  const spConns = connectionsData.serviceProviderConnections as Record<string, unknown>;
  if (spConns[connectionName]) {
    return;
  }
  spConns[connectionName] = {
    serviceProvider: { id: serviceProviderId },
    parameterValues: {},
    displayName: connectionName,
  };
  await fse.writeJson(connectionsPath, connectionsData, { spaces: 2 });
  console.log(`[chat-tools] Added placeholder service provider connection for "${connectionName}"`);
}

/**
 * Build a ServiceProvider action shape.
 * @internal Exported for testing
 */
export function buildServiceProviderAction(
  connectionName: string,
  serviceProviderOperationId: string,
  serviceProviderId: string,
  parameters?: Record<string, unknown>,
  runAfter?: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: 'ServiceProvider',
    inputs: {
      parameters: parameters ?? {},
      serviceProviderConfiguration: {
        connectionName,
        operationId: serviceProviderOperationId,
        serviceProviderId,
      },
    },
    runAfter: runAfter ?? {},
  };
}

interface BuiltInConnectorInfo {
  name: string;
  id: string;
  displayName?: string;
}

interface BuiltInConnectorOperation {
  name: string;
  id: string;
  properties?: {
    api?: { id?: string; name?: string; displayName?: string };
    summary?: string;
    description?: string;
    trigger?: string;
  };
}

function getDesignTimeBaseUrl(projectPath: string): string | undefined {
  const designTimeInst = ext.designTimeInstances.get(projectPath);
  if (!designTimeInst?.port) {
    return undefined;
  }
  return `http://localhost:${designTimeInst.port}${managementApiPrefix}`;
}

async function listBuiltInConnectorOperations(baseUrl: string, connectorName: string): Promise<BuiltInConnectorOperation[]> {
  try {
    const response = await fetch(`${baseUrl}/operationGroups/${connectorName}/operations?api-version=2018-11-01`);
    if (!response.ok) {
      console.error(`[chat-tools] Built-in operations fetch failed: ${response.status}`);
      return [];
    }
    const data = (await response.json()) as { value?: BuiltInConnectorOperation[] } | BuiltInConnectorOperation[];
    return Array.isArray(data) ? data : Array.isArray(data.value) ? data.value : [];
  } catch (error) {
    console.error(
      `[chat-tools] Failed to list built-in operations for ${connectorName}:`,
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

async function listBuiltInConnectors(baseUrl: string): Promise<BuiltInConnectorInfo[]> {
  try {
    const response = await fetch(`${baseUrl}/operationGroups?api-version=2018-11-01`);
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { value?: Array<{ name: string; id: string; properties?: { displayName?: string } }> };
    return (data.value ?? []).map((c) => ({ name: c.name, id: c.id, displayName: c.properties?.displayName }));
  } catch {
    return [];
  }
}

async function getBuiltInConnectorsForProject(projectPath: string): Promise<BuiltInConnectorInfo[]> {
  const overrideConnectors = getWorkflowToolsTestOverrides()?.builtInConnectors;
  if (overrideConnectors) {
    return overrideConnectors;
  }

  const baseUrl = getDesignTimeBaseUrl(projectPath);
  if (!baseUrl) {
    console.log('[chat-tools] Design time runtime not available for built-in connector discovery');
    return [];
  }

  return listBuiltInConnectors(baseUrl);
}

async function getBuiltInConnectorOperationsForProject(projectPath: string, connectorName: string): Promise<BuiltInConnectorOperation[]> {
  const overrideOperations = getWorkflowToolsTestOverrides()?.builtInConnectorOperations;
  if (overrideOperations) {
    const matchedEntry = Object.entries(overrideOperations).find(([name]) => name.toLowerCase() === connectorName.toLowerCase());
    if (matchedEntry) {
      return matchedEntry[1];
    }
  }

  const baseUrl = getDesignTimeBaseUrl(projectPath);
  if (!baseUrl) {
    return [];
  }

  return listBuiltInConnectorOperations(baseUrl, connectorName);
}

function matchBuiltInConnector(hint: string, connectors: BuiltInConnectorInfo[]): BuiltInConnectorInfo | undefined {
  const n = hint
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!n) {
    return undefined;
  }
  return connectors.find((c) => {
    const cn = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dn = (c.displayName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return cn === n || dn === n || cn.includes(n) || n.includes(cn);
  });
}

async function resolveBuiltInServiceProviderAction(
  actionName: string,
  connectorHint: string,
  projectConnections: ProjectConnectionsInfo,
  configuration?: Record<string, unknown>,
  serviceProviderConnection?: ServiceProviderConnectionInput
): Promise<{ action?: Record<string, unknown>; completionSuffix?: string; error?: string } | undefined> {
  if (!projectConnections.projectPath) {
    return undefined;
  }

  const connectors = await getBuiltInConnectorsForProject(projectConnections.projectPath);
  const matched = matchBuiltInConnector(connectorHint, connectors);
  if (!matched) {
    return undefined;
  }

  console.log(`[chat-tools] Matched built-in connector: ${matched.name} (${matched.id})`);

  const operations = await getBuiltInConnectorOperationsForProject(projectConnections.projectPath, matched.name);
  const actionOps = operations.filter((op) => !op.properties?.trigger);
  if (actionOps.length === 0) {
    return { error: `Built-in connector "${matched.displayName ?? matched.name}" has no action operations.` };
  }

  const actionTokens = tokenizeOperationText(actionName);
  let bestOp = actionOps[0];
  let bestScore = 0;
  for (const op of actionOps) {
    const text = `${op.name} ${op.properties?.summary ?? ''} ${op.properties?.description ?? ''}`.toLowerCase();
    let score = 0;
    for (const t of actionTokens) {
      if (text.includes(t)) {
        score += 10;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestOp = op;
    }
  }

  const connectionName = matched.name;
  const serviceProviderId = matched.id;
  const operationId = bestOp.name;
  const connectorDisplayName = matched.displayName ?? matched.name;

  let connectionNote = '';
  if (!projectConnections.serviceProviderIdByReference[connectionName] && projectConnections.projectPath) {
    try {
      const result = await createServiceProviderConnection(
        projectConnections.projectPath,
        connectionName,
        serviceProviderId,
        connectorDisplayName,
        serviceProviderConnection
      );
      if (result.success) {
        if (result.alreadyExists) {
          connectionNote = '';
        } else {
          connectionNote = ` ${result.completionNote ?? `Created connection for "${connectionName}".`}`;
        }
      } else if (result.requiresUserInput) {
        return { error: result.error };
      } else {
        // User cancelled or error occurred - fall back to placeholder
        await addPlaceholderServiceProviderConnection(projectConnections.projectPath, connectionName, serviceProviderId);
        connectionNote = ` Added placeholder service provider connection for "${connectionName}". Open designer to configure.`;
      }
    } catch (error) {
      console.error(`[chat-tools] Failed to create SP connection: ${error instanceof Error ? error.message : String(error)}`);
      // Fall back to placeholder on error
      try {
        await addPlaceholderServiceProviderConnection(projectConnections.projectPath, connectionName, serviceProviderId);
        connectionNote = ` Added placeholder service provider connection for "${connectionName}". Open designer to configure.`;
      } catch {
        // Ignore secondary error
      }
    }
  }

  const params =
    typeof configuration?.parameters === 'object' && configuration.parameters !== null
      ? (configuration.parameters as Record<string, unknown>)
      : typeof configuration?.inputs === 'object' && (configuration.inputs as Record<string, unknown>)?.parameters
        ? ((configuration.inputs as Record<string, unknown>).parameters as Record<string, unknown>)
        : {};
  const runAfter =
    typeof configuration?.runAfter === 'object' && configuration.runAfter !== null
      ? (configuration.runAfter as Record<string, unknown>)
      : {};

  const action = buildServiceProviderAction(connectionName, operationId, serviceProviderId, params, runAfter);

  return {
    action,
    completionSuffix: ` Used built-in connector "${connectorDisplayName}" (${bestOp.properties?.summary ?? operationId}).${connectionNote}`,
  };
}

function normalizeTypeToken(actionType: string): string {
  return actionType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Returns true when an action type represents a workflow trigger shape.
 * @internal Exported for testing
 */
export function isTriggerType(actionType: string): boolean {
  const normalized = normalizeTypeToken(actionType);
  return normalized === 'request' || normalized === 'manual' || normalized === 'recurrence';
}

/**
 * Compute a default `runAfter` value for a newly added action.
 *
 * When the caller passes an explicit `runAfter` (either top-level on the configuration
 * or nested under `inputs`), it is preserved verbatim — including `{}` to opt into
 * parallel execution. Otherwise, when prior actions already exist in the workflow,
 * the new action is chained after the last one in insertion order so Response-style
 * actions don't race with their dependencies.
 *
 * @internal Exported for testing
 */
export function inferDefaultRunAfter(
  existingActions: Record<string, unknown> | undefined,
  callerConfig: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (callerConfig) {
    if (Object.prototype.hasOwnProperty.call(callerConfig, 'runAfter')) {
      const explicit = callerConfig.runAfter;
      if (typeof explicit === 'object' && explicit !== null) {
        return explicit as Record<string, unknown>;
      }
    }

    const inputs = callerConfig.inputs;
    if (inputs && typeof inputs === 'object' && Object.prototype.hasOwnProperty.call(inputs, 'runAfter')) {
      const nested = (inputs as Record<string, unknown>).runAfter;
      if (typeof nested === 'object' && nested !== null) {
        return nested as Record<string, unknown>;
      }
    }
  }

  if (!existingActions || typeof existingActions !== 'object') {
    return {};
  }

  const actionNames = Object.keys(existingActions);
  if (actionNames.length === 0) {
    return {};
  }

  const lastActionName = actionNames[actionNames.length - 1];
  return { [lastActionName]: ['Succeeded'] };
}

/**
 * Build a trigger definition from an actionType/configuration pair.
 * @internal Exported for testing
 */
export function buildTriggerDefinition(actionType: string, configuration?: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeTypeToken(actionType);
  const config = configuration ? { ...configuration } : {};

  if (normalized === 'request' || normalized === 'manual') {
    const inputsValue = typeof config.inputs === 'object' && config.inputs !== null ? (config.inputs as Record<string, unknown>) : config;

    return {
      type: 'Request',
      kind: typeof config.kind === 'string' ? config.kind : 'Http',
      inputs: inputsValue,
    };
  }

  if (normalized === 'recurrence') {
    const inputsValue = typeof config.inputs === 'object' && config.inputs !== null ? (config.inputs as Record<string, unknown>) : config;

    return {
      type: 'Recurrence',
      recurrence: inputsValue,
    };
  }

  return {
    type: actionType,
    inputs: config,
  };
}

/**
 * Build an action definition from an actionType/configuration pair.
 * @internal Exported for testing
 */
export function buildActionDefinition(actionType: string, configuration?: Record<string, unknown>): Record<string, unknown> {
  const config = configuration ? { ...configuration } : {};
  const hasExplicitType = Object.prototype.hasOwnProperty.call(config, 'type');
  const rawInputs = config.inputs;
  const topLevelInputs =
    typeof rawInputs === 'object' && rawInputs !== null
      ? ({ ...(rawInputs as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;
  // Preserve non-object inputs (strings, numbers, arrays, expressions) — used by Compose actions
  const hasNonObjectInputs = rawInputs !== undefined && (typeof rawInputs !== 'object' || rawInputs === null);
  const topLevelRunAfter =
    typeof config.runAfter === 'object' && config.runAfter !== null
      ? ({ ...(config.runAfter as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;

  if (hasExplicitType || topLevelInputs || hasNonObjectInputs || topLevelRunAfter) {
    const actionDefinition: Record<string, unknown> = {
      ...config,
      type: actionType,
    };

    if (hasNonObjectInputs) {
      // Non-object inputs (e.g., string for Compose) — preserve as-is
      actionDefinition.inputs = rawInputs;
      actionDefinition.runAfter = topLevelRunAfter ?? {};
    } else {
      const resolvedInputs = topLevelInputs ? { ...topLevelInputs } : {};
      const nestedRunAfter =
        typeof resolvedInputs.runAfter === 'object' && resolvedInputs.runAfter !== null
          ? ({ ...(resolvedInputs.runAfter as Record<string, unknown>) } as Record<string, unknown>)
          : undefined;

      delete resolvedInputs.runAfter;

      actionDefinition.inputs = resolvedInputs;
      actionDefinition.runAfter = topLevelRunAfter ?? nestedRunAfter ?? {};
    }

    return actionDefinition;
  }

  const normalizedInputs = { ...config };
  const nestedRunAfter =
    typeof normalizedInputs.runAfter === 'object' && normalizedInputs.runAfter !== null
      ? ({ ...(normalizedInputs.runAfter as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;

  delete normalizedInputs.runAfter;

  return {
    type: actionType,
    inputs: normalizedInputs,
    runAfter: nestedRunAfter ?? {},
  };
}

/**
 * Detect a weather connector reference from a connections.json object.
 * @internal Exported for testing
 */
export function detectWeatherManagedApiReference(connectionsData: Record<string, unknown>): string | undefined {
  const managedApiConnections = getManagedApiConnections(connectionsData);

  for (const [referenceName, value] of Object.entries(managedApiConnections)) {
    const apiId = getManagedApiId(value);
    if (!apiId) {
      continue;
    }

    const normalizedReference = referenceName.toLowerCase();
    const normalizedApiId = apiId.toLowerCase();

    if (normalizedReference.includes('weather') || normalizedApiId.includes('weather')) {
      return referenceName;
    }
  }

  return undefined;
}

/**
 * Returns true when a requested action appears to be weather retrieval intent.
 * @internal Exported for testing
 */
export function shouldAutoUseWeatherConnector(actionType: string, actionName: string, configuration?: Record<string, unknown>): boolean {
  const normalizedType = normalizeTypeToken(actionType);
  if (normalizedType !== 'http' && normalizedType !== 'apiconnection') {
    return false;
  }

  const inputs =
    typeof configuration?.inputs === 'object' && configuration.inputs !== null
      ? (configuration.inputs as Record<string, unknown>)
      : undefined;

  const uri = typeof configuration?.uri === 'string' ? configuration.uri : typeof inputs?.uri === 'string' ? inputs.uri : '';
  const pathValue = typeof configuration?.path === 'string' ? configuration.path : typeof inputs?.path === 'string' ? inputs.path : '';

  const combined = `${actionName} ${uri} ${pathValue}`.toLowerCase();
  return combined.includes('weather') || combined.includes('seattle') || combined.includes('open-meteo');
}

function normalizeReferenceToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function extractActionInputs(configuration?: Record<string, unknown>): Record<string, unknown> {
  if (!configuration) {
    return {};
  }

  if (typeof configuration.inputs === 'object' && configuration.inputs !== null) {
    return configuration.inputs as Record<string, unknown>;
  }

  return configuration;
}

function extractApiConnectionHints(
  configuration?: Record<string, unknown>,
  overrideHints?: Partial<ApiConnectionHints>
): ApiConnectionHints {
  const inputs = extractActionInputs(configuration);
  const methodFromInputs = typeof inputs.method === 'string' ? inputs.method : undefined;
  const pathFromInputs = typeof inputs.path === 'string' ? inputs.path : undefined;
  const operationIdFromInputs = typeof inputs.operationId === 'string' ? inputs.operationId : undefined;

  const hints: ApiConnectionHints = {
    connectorReference:
      overrideHints?.connectorReference ||
      (typeof configuration?.connectorReference === 'string' ? configuration.connectorReference : undefined) ||
      (typeof configuration?.referenceName === 'string' ? configuration.referenceName : undefined) ||
      getApiConnectionReferenceName(inputs),
    connectorId: overrideHints?.connectorId || (typeof configuration?.connectorId === 'string' ? configuration.connectorId : undefined),
    operationId:
      overrideHints?.operationId || (typeof configuration?.operationId === 'string' ? configuration.operationId : operationIdFromInputs),
    method: overrideHints?.method || (typeof configuration?.method === 'string' ? configuration.method : methodFromInputs),
    path: overrideHints?.path || (typeof configuration?.path === 'string' ? configuration.path : pathFromInputs),
  };

  return hints;
}

/**
 * Resolve a managed connector reference case-insensitively against available references.
 * @internal Exported for testing
 */
export function resolveManagedApiReferenceName(
  referenceHint: string | undefined,
  managedApiReferencesWithApiId: readonly string[]
): string | undefined {
  if (!referenceHint || managedApiReferencesWithApiId.length === 0) {
    return undefined;
  }

  const exact = managedApiReferencesWithApiId.find((name) => name.toLowerCase() === referenceHint.toLowerCase());
  if (exact) {
    return exact;
  }

  const normalizedHint = normalizeReferenceToken(referenceHint);
  if (!normalizedHint) {
    return undefined;
  }

  return managedApiReferencesWithApiId.find((name) => normalizeReferenceToken(name) === normalizedHint);
}

/**
 * Build a generic ApiConnection action shape.
 * @internal Exported for testing
 */
export function buildManagedApiConnectionAction(
  referenceName: string,
  method: string,
  pathValue: string,
  configuration?: Record<string, unknown>
): Record<string, unknown> {
  const runAfter =
    typeof configuration?.runAfter === 'object' && configuration.runAfter !== null
      ? (configuration.runAfter as Record<string, unknown>)
      : {};

  const sourceInputs = { ...extractActionInputs(configuration) };
  delete sourceInputs.type;
  delete sourceInputs.host;
  delete sourceInputs.connectorReference;
  delete sourceInputs.connectorId;
  delete sourceInputs.referenceName;
  delete sourceInputs.operationId;
  delete sourceInputs.runAfter;

  return {
    type: 'ApiConnection',
    inputs: {
      ...sourceInputs,
      host: {
        connection: {
          referenceName,
        },
      },
      method: method.toLowerCase(),
      path: pathValue,
    },
    runAfter,
  };
}

function getApiConnectionReferenceName(inputs: Record<string, unknown>): string | undefined {
  const host = typeof inputs.host === 'object' && inputs.host !== null ? (inputs.host as Record<string, unknown>) : undefined;
  const connection =
    host && typeof host.connection === 'object' && host.connection !== null ? (host.connection as Record<string, unknown>) : undefined;

  if (connection && typeof connection.referenceName === 'string' && connection.referenceName.trim()) {
    return connection.referenceName;
  }

  if (connection && typeof connection.name === 'string' && connection.name.trim()) {
    return connection.name;
  }

  if (host && typeof host.connection === 'string' && host.connection.trim()) {
    return host.connection;
  }

  return undefined;
}

/**
 * Validate that an ApiConnection reference exists in connections.json and has an api.id.
 * @internal Exported for testing
 */
export function validateApiConnectionReferenceExists(
  configuration: Record<string, unknown> | undefined,
  managedApiReferencesWithApiId: readonly string[]
): string | undefined {
  const inputs = configuration ?? {};
  const referenceNameHint = getApiConnectionReferenceName(inputs);

  if (!referenceNameHint) {
    return undefined;
  }

  const referenceName = resolveManagedApiReferenceName(referenceNameHint, managedApiReferencesWithApiId);

  if (referenceName && managedApiReferencesWithApiId.includes(referenceName)) {
    return undefined;
  }

  const available = managedApiReferencesWithApiId;
  const hint =
    available.length > 0
      ? ` Valid managed connection references with api.id: ${available.join(', ')}.`
      : ' No managed connection references with api.id were found in connections.json.';

  return `ApiConnection reference "${referenceNameHint}" could not be resolved to a managed API with api.id in connections.json.${hint}`;
}

/**
 * Build a Seattle weather connector action in ApiConnection shape.
 * @internal Exported for testing
 */
export function buildSeattleWeatherConnectorAction(referenceName: string, runAfter?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'ApiConnection',
    inputs: {
      host: {
        connection: {
          referenceName,
        },
      },
      method: 'get',
      path: "/current/@{encodeURIComponent('98101')}",
      queries: {
        units: 'I',
      },
    },
    runAfter: runAfter ?? {},
  };
}

function resolveManagedApiReferenceByConnectorId(
  connectorIdHint: string | undefined,
  managedApiIdByReference: Record<string, string>
): string | undefined {
  if (!connectorIdHint) {
    return undefined;
  }

  const normalizedHint = connectorIdHint.toLowerCase().trim();
  if (!normalizedHint) {
    return undefined;
  }

  const exactMatch = Object.entries(managedApiIdByReference).find(([, apiId]) => apiId.toLowerCase() === normalizedHint);
  if (exactMatch) {
    return exactMatch[0];
  }

  const containsMatch = Object.entries(managedApiIdByReference).find(([, apiId]) => apiId.toLowerCase().includes(normalizedHint));
  if (containsMatch) {
    return containsMatch[0];
  }

  const simpleHint = normalizedHint.split('/').filter(Boolean).pop();
  if (!simpleHint) {
    return undefined;
  }

  const managedApiMatch = Object.entries(managedApiIdByReference).find(([, apiId]) =>
    apiId.toLowerCase().endsWith(`/managedapis/${simpleHint}`)
  );
  return managedApiMatch?.[0];
}

export interface ManagedApiOperation {
  id?: string;
  name?: string;
  properties?: {
    summary?: string;
    description?: string;
    swaggerOperationId?: string;
    trigger?: string;
  };
}

export interface SwaggerOperationResolution {
  method: string;
  path: string;
  operationId?: string;
}
interface ManagedConnectorOfflineResolution {
  method: string;
  path: string;
  operationId?: string;
}

interface SwaggerOperationCandidate {
  method: string;
  path: string;
  operationId: string;
  summary?: string;
  description?: string;
}

function normalizeManagedConnectorPath(pathValue: string): string {
  const withoutConnectionPrefix = pathValue.replace(/\{connectionid\}/gi, '');
  const compacted = withoutConnectionPrefix.replace(/\/{2,}/g, '/').trim();

  if (!compacted) {
    return '/';
  }

  return compacted.startsWith('/') ? compacted : `/${compacted}`;
}

function normalizeManagementBaseUri(baseUri?: string): string {
  const fallback = azurePublicBaseUrl;
  const normalized = (baseUri ?? fallback).trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.replace(/\/+$/, '');
}

function getManagedApiShortName(connectorId: string): string {
  return connectorId.toLowerCase().split('/').filter(Boolean).pop() ?? '';
}

function inferEntityNameFromActionName(actionName: string, fallback: string): string {
  const candidates = actionName
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const stopWords = new Set([
    'list',
    'get',
    'fetch',
    'read',
    'query',
    'find',
    'row',
    'rows',
    'item',
    'items',
    'record',
    'records',
    'sql',
    'servicebus',
    'service',
    'bus',
    'send',
    'receive',
    'peek',
    'message',
    'messages',
    'by',
    'id',
    'to',
    'from',
    'in',
    'the',
    'a',
    'an',
  ]);

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (!stopWords.has(normalized) && /^[a-z][a-z0-9_]*$/i.test(candidate)) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }

  return fallback;
}

function buildCanonicalSqlItemsPath(tableName: string): string {
  const encodedDefault = "@{encodeURIComponent(encodeURIComponent('default'))}";
  const encodedTable = `@{encodeURIComponent(encodeURIComponent('[dbo].[${tableName}]'))}`;
  return `/v2/datasets/${encodedDefault},${encodedDefault}/tables/${encodedTable}/items`;
}

function normalizeSqlPathFromHint(pathHint: string): string | undefined {
  if (!pathHint || pathHint.includes('encodeURIComponent')) {
    return pathHint;
  }

  const plainPattern = /^\/v2\/datasets\/default\/tables\/(?:\[dbo\]\.\[([^\]]+)\]|([^/]+))\/items(?:\/(.+))?$/i;
  const plainMatch = pathHint.match(plainPattern);
  if (!plainMatch) {
    return undefined;
  }

  const tableName = (plainMatch[1] || plainMatch[2] || 'Orders').trim();
  const canonicalItemsPath = buildCanonicalSqlItemsPath(tableName);
  const itemTail = plainMatch[3];

  if (!itemTail) {
    return canonicalItemsPath;
  }

  const encodedId = "@{encodeURIComponent(encodeURIComponent(triggerBody()?['id']))}";
  return `${canonicalItemsPath}/${encodedId}`;
}

function isSingleEntityIntent(actionName: string): boolean {
  const normalized = actionName.toLowerCase();
  return /\b(row|item|record)\b/.test(normalized) && /\b(id|key)\b/.test(normalized);
}

function isServiceBusSendIntent(actionName: string): boolean {
  return /\b(send|publish|enqueue|post)\b/i.test(actionName);
}

function isServiceBusPeekIntent(actionName: string): boolean {
  return /\b(peek|peeklock|browse)\b/i.test(actionName);
}

function isServiceBusReceiveIntent(actionName: string): boolean {
  return /\b(receive|read|dequeue|consume|pull)\b/i.test(actionName);
}

export function resolveOfflineManagedConnectorOperation(
  connectorId: string,
  actionName: string,
  hints: ApiConnectionHints
): ManagedConnectorOfflineResolution | undefined {
  const connectorShortName = getManagedApiShortName(connectorId);

  if (connectorShortName === 'sql') {
    const hintedPath = typeof hints.path === 'string' ? hints.path.trim() : '';
    const normalizedHintPath = hintedPath ? (normalizeSqlPathFromHint(hintedPath) ?? hintedPath) : '';

    if (normalizedHintPath) {
      const inferredOperationId = /\/items\//i.test(normalizedHintPath) ? 'GetItem_V2' : 'GetItems_V2';
      return {
        method: (hints.method || 'get').toLowerCase(),
        path: normalizedHintPath,
        operationId: hints.operationId || inferredOperationId,
      };
    }

    const inferredTableName = inferEntityNameFromActionName(actionName, 'Orders');
    const itemsPath = buildCanonicalSqlItemsPath(inferredTableName);

    if (isSingleEntityIntent(actionName)) {
      const encodedId = "@{encodeURIComponent(encodeURIComponent(triggerBody()?['id']))}";
      return {
        method: 'get',
        path: `${itemsPath}/${encodedId}`,
        operationId: hints.operationId || 'GetItem_V2',
      };
    }

    return {
      method: 'get',
      path: itemsPath,
      operationId: hints.operationId || 'GetItems_V2',
    };
  }

  if (connectorShortName === 'servicebus') {
    if (hints.path && hints.method) {
      return {
        method: hints.method.toLowerCase(),
        path: hints.path,
        operationId: hints.operationId,
      };
    }

    const queueRef = "@{encodeURIComponent(encodeURIComponent('queue-name'))}";

    if (isServiceBusSendIntent(actionName)) {
      return {
        method: 'post',
        path: `/${queueRef}/messages`,
        operationId: hints.operationId || 'SendMessage',
      };
    }

    if (isServiceBusPeekIntent(actionName)) {
      return {
        method: 'get',
        path: `/${queueRef}/messages/head/peek`,
        operationId: hints.operationId || 'PeekLockMessages',
      };
    }

    if (isServiceBusReceiveIntent(actionName)) {
      return {
        method: 'get',
        path: `/${queueRef}/messages/batch/peek`,
        operationId: hints.operationId || 'ReceiveMessages',
      };
    }
  }

  return undefined;
}

async function createArmHttpClient(projectConnections: ProjectConnectionsInfo): Promise<HttpClient | undefined> {
  try {
    const accessToken = await getWorkflowToolsAuthorizationToken(projectConnections.workflowTenantId);
    const managementBaseUri = normalizeManagementBaseUri(projectConnections.workflowManagementBaseUri);
    console.log(
      `[chat-tools] ARM client: baseUri=${managementBaseUri}, tenantId=${projectConnections.workflowTenantId ?? '(none)'}, tokenLength=${accessToken?.length ?? 0}`
    );
    return new HttpClient({
      accessToken,
      baseUrl: managementBaseUri,
      apiHubBaseUrl: managementBaseUri,
    });
  } catch (error) {
    console.error('[chat-tools] Failed to create ARM HttpClient:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function getOperationIdTail(operationId: string | undefined): string {
  if (!operationId) {
    return '';
  }

  return operationId.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
}

function normalizeOperationHintValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function scoreOperationHintMatch(operation: ManagedApiOperation, operationHint: string): number {
  const normalizedHint = normalizeOperationHintValue(operationHint);
  if (!normalizedHint) {
    return 0;
  }

  const matchTargets = [operation.name, getOperationIdTail(operation.id), operation.properties?.swaggerOperationId]
    .map((value) => normalizeOperationHintValue(value ?? ''))
    .filter((value) => value.length > 0);

  let bestScore = 0;
  for (const target of matchTargets) {
    if (target === normalizedHint) {
      bestScore = Math.max(bestScore, 140);
      continue;
    }

    if (target.startsWith(normalizedHint) || normalizedHint.startsWith(target)) {
      bestScore = Math.max(bestScore, 95);
      continue;
    }

    if (target.includes(normalizedHint) || normalizedHint.includes(target)) {
      bestScore = Math.max(bestScore, 60);
    }
  }

  return bestScore;
}

function selectOperationByHint(operationHint: string, operations: ManagedApiOperation[]): ManagedApiOperation | undefined {
  let bestScore = 0;
  let bestMatch: ManagedApiOperation | undefined;

  for (const operation of operations) {
    if (operation.properties?.trigger) {
      continue;
    }

    const score = scoreOperationHintMatch(operation, operationHint);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = operation;
    }
  }

  return bestScore > 0 ? bestMatch : undefined;
}

function getActionIntentMethods(actionName: string): Set<string> {
  const actionTokens = new Set(tokenizeOperationText(actionName));
  const methods = new Set<string>();

  if (['list', 'get', 'read', 'fetch', 'query', 'find'].some((token) => actionTokens.has(token))) {
    methods.add('get');
  }

  if (['create', 'add', 'insert', 'send', 'publish', 'enqueue', 'submit', 'post'].some((token) => actionTokens.has(token))) {
    methods.add('post');
  }

  if (['update', 'replace', 'upsert', 'set', 'modify'].some((token) => actionTokens.has(token))) {
    methods.add('patch');
    methods.add('put');
  }

  if (['delete', 'remove'].some((token) => actionTokens.has(token))) {
    methods.add('delete');
  }

  return methods;
}

interface ActionIntentSignals {
  wantsSingleEntity: boolean;
  wantsCollection: boolean;
  wantsSendMessage: boolean;
  wantsReceiveMessage: boolean;
  wantsPeekMessage: boolean;
}

function getActionIntentSignals(actionName: string): ActionIntentSignals {
  const actionTokens = new Set(tokenizeOperationText(actionName));
  const normalizedAction = actionName.toLowerCase();
  const hasAny = (candidates: string[]): boolean => candidates.some((token) => actionTokens.has(token));

  const wantsSingleEntity =
    hasAny(['single', 'one', 'row', 'item', 'record', 'message']) &&
    (hasAny(['id', 'key', 'specific']) || normalizedAction.includes('by id') || normalizedAction.includes('by key'));

  const wantsCollection = hasAny(['list', 'all', 'many', 'rows', 'items', 'records', 'messages', 'query', 'search']);
  const wantsSendMessage = hasAny(['send', 'publish', 'enqueue', 'push', 'submit']);
  const wantsReceiveMessage = hasAny(['receive', 'read', 'pull', 'consume', 'dequeue']);
  const wantsPeekMessage = hasAny(['peek', 'browse']);

  return {
    wantsSingleEntity,
    wantsCollection,
    wantsSendMessage,
    wantsReceiveMessage,
    wantsPeekMessage,
  };
}

function scoreConnectorIntent(operationText: string, actionName: string): number {
  const normalizedOperation = operationText.toLowerCase();
  const signals = getActionIntentSignals(actionName);
  let score = 0;

  const matchesSingleEntity = /(getitem|getrow|getrecord|getmessage|find.*id|byid|bykey|single)/.test(normalizedOperation);
  const matchesCollection = /(getitems|getrows|getrecords|getmessages|list|query|search|all)/.test(normalizedOperation);
  const matchesSend = /(send|publish|enqueue|postmessage|createmessage)/.test(normalizedOperation);
  const matchesReceive = /(receive|dequeue|consume|readmessage|getmessages|pull)/.test(normalizedOperation);
  const matchesPeek = /(peek|peeklock|browse)/.test(normalizedOperation);

  if (signals.wantsSingleEntity) {
    score += matchesSingleEntity ? 28 : 0;
    score -= matchesCollection ? 16 : 0;
  }

  if (signals.wantsCollection) {
    score += matchesCollection ? 24 : 0;
    score -= matchesSingleEntity ? 14 : 0;
  }

  if (signals.wantsSendMessage) {
    score += matchesSend ? 30 : 0;
    score -= matchesReceive ? 18 : 0;
  }

  if (signals.wantsReceiveMessage) {
    score += matchesReceive ? 28 : 0;
    score -= matchesSend ? 18 : 0;
  }

  if (signals.wantsPeekMessage) {
    score += matchesPeek ? 24 : 0;
    score -= matchesSend ? 12 : 0;
  }

  return score;
}

function scoreOperationForActionName(actionName: string, operation: ManagedApiOperation, hints?: Partial<ApiConnectionHints>): number {
  const operationSearchText = getOperationSearchText(operation).toLowerCase();
  const operationIdentifiers =
    `${operation.name ?? ''} ${operation.properties?.swaggerOperationId ?? ''} ${getOperationIdTail(operation.id)}`.toLowerCase();
  const actionTokens = tokenizeOperationText(actionName);

  let score = 0;

  const normalizedActionName = normalizeOperationHintValue(actionName);
  const normalizedOperationName = normalizeOperationHintValue(operation.name ?? '');
  const normalizedSwaggerOperationId = normalizeOperationHintValue(operation.properties?.swaggerOperationId ?? '');

  if (normalizedActionName && (normalizedActionName === normalizedOperationName || normalizedActionName === normalizedSwaggerOperationId)) {
    score += 140;
  }

  for (const token of actionTokens) {
    if (operationIdentifiers.includes(token)) {
      score += 14;
    } else if (operationSearchText.includes(token)) {
      score += 6;
    }
  }

  if (hints?.operationId) {
    score += scoreOperationHintMatch(operation, hints.operationId);
  }

  const actionIntentMethods = getActionIntentMethods(actionName);
  const swaggerOperationId = operation.properties?.swaggerOperationId?.toLowerCase() ?? '';
  if (actionIntentMethods.has('post') && /(create|add|insert|send|publish|enqueue|post)/.test(swaggerOperationId)) {
    score += 18;
  }
  if (actionIntentMethods.has('get') && /(get|list|read|query|find)/.test(swaggerOperationId)) {
    score += 18;
  }
  if (actionIntentMethods.has('delete') && /(delete|remove)/.test(swaggerOperationId)) {
    score += 18;
  }
  if ((actionIntentMethods.has('patch') || actionIntentMethods.has('put')) && /(update|modify|replace|set)/.test(swaggerOperationId)) {
    score += 18;
  }

  score += scoreConnectorIntent(`${operationIdentifiers} ${operationSearchText}`, actionName);

  return score;
}

function listSwaggerOperationCandidates(swagger: Record<string, unknown>): SwaggerOperationCandidate[] {
  const paths = typeof swagger.paths === 'object' && swagger.paths !== null ? (swagger.paths as Record<string, unknown>) : undefined;
  if (!paths) {
    return [];
  }

  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const candidates: SwaggerOperationCandidate[] = [];

  for (const [pathValue, pathItem] of Object.entries(paths)) {
    if (typeof pathItem !== 'object' || pathItem === null) {
      continue;
    }

    const pathItemRecord = pathItem as Record<string, unknown>;
    for (const method of httpMethods) {
      const operation = pathItemRecord[method];
      if (typeof operation !== 'object' || operation === null) {
        continue;
      }

      const operationRecord = operation as Record<string, unknown>;
      const operationId =
        typeof operationRecord.operationId === 'string' && operationRecord.operationId.trim()
          ? operationRecord.operationId
          : `${method}:${pathValue}`;

      candidates.push({
        method,
        path: normalizeManagedConnectorPath(pathValue),
        operationId,
        summary: typeof operationRecord.summary === 'string' ? operationRecord.summary : undefined,
        description: typeof operationRecord.description === 'string' ? operationRecord.description : undefined,
      });
    }
  }

  return candidates;
}

function scoreSwaggerOperationCandidate(
  candidate: SwaggerOperationCandidate,
  actionName: string,
  operationHints: string[],
  hints: ApiConnectionHints
): number {
  const candidateOperationId = normalizeOperationHintValue(candidate.operationId);
  const candidatePath = normalizeOperationHintValue(candidate.path);
  const candidateMethod = candidate.method.toLowerCase();
  const candidateSearchText =
    `${candidate.operationId} ${candidate.summary ?? ''} ${candidate.description ?? ''} ${candidate.path}`.toLowerCase();
  const actionTokens = tokenizeOperationText(actionName);

  let score = 0;

  if (hints.method && candidateMethod === hints.method.toLowerCase().trim()) {
    score += 120;
  }

  if (hints.path) {
    const normalizedHintPath = normalizeOperationHintValue(hints.path);
    if (normalizedHintPath) {
      if (candidatePath === normalizedHintPath) {
        score += 140;
      } else if (candidatePath.includes(normalizedHintPath) || normalizedHintPath.includes(candidatePath)) {
        score += 70;
      }
    }
  }

  for (let i = 0; i < operationHints.length; i++) {
    const normalizedHint = normalizeOperationHintValue(operationHints[i]);
    if (!normalizedHint) {
      continue;
    }

    const weight = Math.max(140 - i * 20, 40);
    if (candidateOperationId === normalizedHint) {
      score += weight;
      continue;
    }

    if (candidateOperationId.startsWith(normalizedHint) || normalizedHint.startsWith(candidateOperationId)) {
      score += Math.floor(weight * 0.7);
      continue;
    }

    if (candidateOperationId.includes(normalizedHint) || normalizedHint.includes(candidateOperationId)) {
      score += Math.floor(weight * 0.45);
    }
  }

  for (const token of actionTokens) {
    if (candidateOperationId.includes(token)) {
      score += 10;
    } else if (candidateSearchText.includes(token)) {
      score += 4;
    }
  }

  const actionIntentMethods = getActionIntentMethods(actionName);
  if (actionIntentMethods.has(candidateMethod)) {
    score += 20;
  }

  if (/\b(when|trigger|onnew|onupdated|oncreated)\b/.test(candidate.operationId.toLowerCase())) {
    score -= 25;
  }

  score += scoreConnectorIntent(
    `${candidate.operationId} ${candidate.summary ?? ''} ${candidate.description ?? ''} ${candidate.path}`,
    actionName
  );

  return score;
}

function selectSwaggerOperationCandidate(
  candidates: SwaggerOperationCandidate[],
  actionName: string,
  operationHints: string[],
  hints: ApiConnectionHints
): SwaggerOperationCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const hintedMethod = typeof hints.method === 'string' ? hints.method.trim().toLowerCase() : '';
  const hintedPath = typeof hints.path === 'string' ? normalizeOperationHintValue(hints.path) : '';

  const strictMethodAndPathCandidates =
    hintedMethod && hintedPath
      ? candidates.filter(
          (candidate) => candidate.method.toLowerCase() === hintedMethod && normalizeOperationHintValue(candidate.path) === hintedPath
        )
      : [];

  const strictMethodCandidates =
    hintedMethod && !hintedPath ? candidates.filter((candidate) => candidate.method.toLowerCase() === hintedMethod) : [];

  const strictPathCandidates =
    hintedPath && !hintedMethod ? candidates.filter((candidate) => normalizeOperationHintValue(candidate.path) === hintedPath) : [];

  const rankingCandidates =
    strictMethodAndPathCandidates.length > 0
      ? strictMethodAndPathCandidates
      : strictMethodCandidates.length > 0
        ? strictMethodCandidates
        : strictPathCandidates.length > 0
          ? strictPathCandidates
          : candidates;

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCandidate: SwaggerOperationCandidate | undefined;

  for (const candidate of rankingCandidates) {
    const score = scoreSwaggerOperationCandidate(candidate, actionName, operationHints, hints);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestScore > 0 ? bestCandidate : undefined;
}

export function selectOperationByActionName(
  actionName: string,
  operations: ManagedApiOperation[],
  hints?: Partial<ApiConnectionHints>
): ManagedApiOperation | undefined {
  if (operations.length === 0) {
    return undefined;
  }

  let bestScore = 0;
  let bestMatch: ManagedApiOperation | undefined;

  for (const operation of operations) {
    if (operation.properties?.trigger) {
      continue;
    }

    const score = scoreOperationForActionName(actionName, operation, hints);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = operation;
    }
  }

  return bestScore > 0 ? bestMatch : undefined;
}

export function resolveSwaggerOperation(
  swagger: Record<string, unknown>,
  actionName: string,
  operationHints: string[],
  hints: ApiConnectionHints
): SwaggerOperationResolution | undefined {
  const candidates = listSwaggerOperationCandidates(swagger);
  if (candidates.length === 0) {
    return undefined;
  }

  const selectedCandidate = selectSwaggerOperationCandidate(candidates, actionName, operationHints, hints);
  if (!selectedCandidate) {
    return undefined;
  }

  return {
    method: selectedCandidate.method,
    path: selectedCandidate.path,
    operationId: selectedCandidate.operationId,
  };
}
function tokenizeOperationText(value: string): string[] {
  const stopWords = new Set(['a', 'an', 'the', 'to', 'from', 'for', 'and', 'or', 'api', 'action', 'connector', 'connection']);
  const normalized = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const baseTokens = normalized
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));

  const expandedTokens = new Set<string>();
  for (const token of baseTokens) {
    expandedTokens.add(token);

    if (token.endsWith('ies') && token.length > 4) {
      expandedTokens.add(`${token.slice(0, -3)}y`);
    } else if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
      expandedTokens.add(token.slice(0, -1));
    }
  }

  return Array.from(expandedTokens);
}

function getOperationSearchText(operation: ManagedApiOperation): string {
  return `${operation.name ?? ''} ${operation.properties?.summary ?? ''} ${operation.properties?.description ?? ''} ${
    operation.properties?.swaggerOperationId ?? ''
  }`;
}

async function listManagedApiOperations(connectorId: string, client: HttpClient): Promise<ManagedApiOperation[]> {
  try {
    console.log(`[chat-tools] Listing operations: ${connectorId}/apiOperations`);
    const response = await client.get<{ value?: ManagedApiOperation[] } | ManagedApiOperation[]>({
      uri: `${connectorId}/apiOperations`,
      queryParameters: {
        'api-version': '2018-07-01-preview',
        $filter: 'properties/trigger eq null',
      },
    });

    if (Array.isArray(response)) {
      console.log(`[chat-tools] Operations response: ${response.length} items (array)`);
      return response;
    }

    const items = Array.isArray(response.value) ? response.value : [];
    console.log(`[chat-tools] Operations response: ${items.length} items (value)`);
    return items;
  } catch (error) {
    console.error('[chat-tools] Failed to list operations:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function fetchConnectorSwagger(connectorId: string, client: HttpClient): Promise<Record<string, unknown> | undefined> {
  try {
    console.log(`[chat-tools] Fetching swagger: ${connectorId}?export=true`);
    const swagger = await client.get<Record<string, unknown>>({
      uri: connectorId,
      queryParameters: {
        'api-version': '2018-07-01-preview',
        export: 'true',
      },
    });

    const topKeys = swagger ? Object.keys(swagger).slice(0, 10).join(', ') : '(null)';
    console.log(`[chat-tools] Swagger response top-level keys: ${topKeys}`);
    return swagger;
  } catch (error) {
    console.error('[chat-tools] Failed to fetch swagger:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

async function resolveManagedApiOperationFromSwagger(
  connectorId: string,
  actionName: string,
  hints: ApiConnectionHints,
  projectConnections: ProjectConnectionsInfo
): Promise<{ method: string; path: string; operationId?: string; failureReason?: string } | undefined> {
  let failureReason = '';

  if (getWorkflowToolsTestOverrides()?.disableArmSwaggerResolution) {
    failureReason = 'ARM swagger resolution disabled by workflow tools test override.';
    return { method: '', path: '', failureReason };
  }

  const client = await createArmHttpClient(projectConnections);
  if (!client) {
    failureReason = `ARM client creation failed (managementBaseUri=${projectConnections.workflowManagementBaseUri ?? 'NOT SET'}, tenantId=${projectConnections.workflowTenantId ?? 'NOT SET'})`;
    return { method: '', path: '', failureReason };
  }

  const operations = await listManagedApiOperations(connectorId, client);

  const operationFromHint = hints.operationId ? selectOperationByHint(hints.operationId, operations) : undefined;
  const operationFromActionName = operationFromHint ? undefined : selectOperationByActionName(actionName, operations, hints);
  const selectedOperation = operationFromHint ?? operationFromActionName;

  const operationHints = [
    selectedOperation?.properties?.swaggerOperationId,
    selectedOperation?.name,
    getOperationIdTail(selectedOperation?.id),
    hints.operationId,
  ].filter((value): value is string => Boolean(value && value.trim()));
  const uniqueOperationHints = Array.from(new Set(operationHints));

  const swagger = await fetchConnectorSwagger(connectorId, client);
  if (!swagger) {
    failureReason = `Swagger fetch failed for ${connectorId} (operations found: ${operations.length})`;
    return { method: '', path: '', failureReason };
  }

  const pathCount = swagger.paths ? Object.keys(swagger.paths as Record<string, unknown>).length : 0;

  const resolved = resolveSwaggerOperation(swagger, actionName, uniqueOperationHints, hints);
  if (!resolved) {
    failureReason = `No matching swagger operation for "${actionName}" (paths: ${pathCount}, operations: ${operations.length}, hints: ${uniqueOperationHints.join(', ') || 'none'})`;
    return { method: '', path: '', failureReason };
  }

  return {
    method: resolved.method,
    path: resolved.path,
    operationId: selectedOperation?.name ?? resolved.operationId ?? hints.operationId,
  };
}

async function resolveGenericApiConnectionAction(
  actionType: string,
  actionName: string,
  configuration: Record<string, unknown> | undefined,
  projectConnections: ProjectConnectionsInfo,
  overrideHints?: Partial<ApiConnectionHints>,
  requireCanonicalSwaggerResolution = false
): Promise<{ action?: Record<string, unknown>; completionSuffix?: string; error?: string }> {
  const normalizedType = normalizeTypeToken(actionType);
  if (normalizedType !== 'http' && normalizedType !== 'apiconnection') {
    return {};
  }

  const hints = extractApiConnectionHints(configuration, overrideHints);

  const resolvedReferenceFromName = resolveManagedApiReferenceName(
    hints.connectorReference,
    projectConnections.managedApiReferencesWithApiId
  );
  const resolvedReferenceFromConnectorId = resolveManagedApiReferenceByConnectorId(
    hints.connectorId,
    projectConnections.managedApiIdByReference
  );
  const resolvedReference = resolvedReferenceFromName ?? resolvedReferenceFromConnectorId;

  let method = typeof hints.method === 'string' ? hints.method.trim() : '';
  let pathValue = typeof hints.path === 'string' ? hints.path.trim() : '';
  let operationId = hints.operationId;

  let resolvedConnectorId: string | undefined;
  let effectiveReference = resolvedReference;
  let isNewConnectorReference = false;

  if (resolvedReference) {
    resolvedConnectorId =
      projectConnections.managedApiIdByReference[resolvedReference] ??
      (typeof hints.connectorId === 'string' && hints.connectorId.startsWith('/subscriptions/') ? hints.connectorId : undefined);
  } else if (hints.connectorReference || hints.connectorId) {
    const connectorHint = (hints.connectorReference || hints.connectorId || '').trim().toLowerCase();

    if (connectorHint.startsWith('/subscriptions/')) {
      resolvedConnectorId = connectorHint;
      effectiveReference = getManagedApiShortName(connectorHint);
      isNewConnectorReference = true;
    } else if (projectConnections.managedApiBasePath && connectorHint) {
      resolvedConnectorId = constructManagedApiConnectorId(projectConnections.managedApiBasePath, connectorHint);
      effectiveReference = connectorHint;
      isNewConnectorReference = true;
      console.log(`[chat-tools] Constructed connector ID for "${connectorHint}": ${resolvedConnectorId}`);
    } else if (connectorHint && projectConnections.localSettingsValues) {
      // No existing managed connections and no managedApiBasePath — construct from Azure context
      const basePath = constructManagedApiBasePathFromSettings(projectConnections.localSettingsValues);
      if (basePath) {
        resolvedConnectorId = constructManagedApiConnectorId(basePath, connectorHint);
        effectiveReference = connectorHint;
        isNewConnectorReference = true;
        console.log(`[chat-tools] Constructed connector ID from Azure context for "${connectorHint}": ${resolvedConnectorId}`);
      } else {
        const refsHint =
          projectConnections.managedApiReferencesWithApiId.length > 0
            ? ` Available managed connection references: ${projectConnections.managedApiReferencesWithApiId.join(', ')}.`
            : '';
        return {
          error: `Managed connector "${connectorHint}" not found and no Azure context configured to derive location.${refsHint}`,
        };
      }
    } else {
      const refsHint =
        projectConnections.managedApiReferencesWithApiId.length > 0
          ? ` Available managed connection references: ${projectConnections.managedApiReferencesWithApiId.join(', ')}.`
          : '';
      return {
        error: `Managed connector "${connectorHint}" not found and no existing connections to derive Azure location.${refsHint}`,
      };
    }
  }

  if (!effectiveReference) {
    return {};
  }

  const shouldAttemptSwaggerResolution =
    Boolean(resolvedConnectorId) && (!method || !pathValue || !operationId || normalizedType === 'apiconnection');

  let swaggerResolutionApplied = false;
  let swaggerFailureReason = '';
  if (shouldAttemptSwaggerResolution && resolvedConnectorId) {
    const swaggerResolution = await resolveManagedApiOperationFromSwagger(resolvedConnectorId, actionName, hints, projectConnections);

    if (swaggerResolution && swaggerResolution.method && swaggerResolution.path) {
      method = swaggerResolution.method;
      pathValue = swaggerResolution.path;
      operationId = operationId ?? swaggerResolution.operationId;
      swaggerResolutionApplied = true;
    } else if (swaggerResolution?.failureReason) {
      swaggerFailureReason = swaggerResolution.failureReason;
    }
  }
  if (!swaggerResolutionApplied && resolvedConnectorId) {
    const offlineFallback = resolveOfflineManagedConnectorOperation(resolvedConnectorId, actionName, hints);
    if (offlineFallback) {
      method = offlineFallback.method;
      pathValue = offlineFallback.path;
      operationId = operationId ?? offlineFallback.operationId;
      swaggerResolutionApplied = true;
    }
  }

  if (requireCanonicalSwaggerResolution && resolvedConnectorId && !swaggerResolutionApplied) {
    const diagDetail = swaggerFailureReason ? ` Diagnostic: ${swaggerFailureReason}` : ' No diagnostic detail available.';
    return {
      error: `Unable to resolve connector operation metadata for "${effectiveReference}" (connectorId: ${resolvedConnectorId}).${diagDetail}`,
    };
  }

  if (!method || !pathValue) {
    if (normalizedType === 'apiconnection') {
      return {
        error:
          'ApiConnection action requires method and path. Unable to resolve operation details from connector metadata/swagger. Provide operationId or explicit method/path in configuration.',
      };
    }

    return {};
  }

  if (isNewConnectorReference && resolvedConnectorId && projectConnections.projectPath) {
    // Try to resolve the connection automatically (reuse existing, metadata-driven create, or OAuth)
    let connectionNote = '';
    try {
      const resolution = await tryResolveManagedApiConnection(projectConnections.projectPath, effectiveReference, resolvedConnectorId);
      if (resolution.success) {
        connectionNote = ` ${resolution.message}`;
      } else {
        await addPlaceholderManagedApiConnection(projectConnections.projectPath, effectiveReference, resolvedConnectorId);
        const failureReason = resolution.message ? ` Automatic resolution failed: ${resolution.message}` : '';
        connectionNote = ` Added placeholder connection for "${effectiveReference}" in connections.json. Open designer to finish authentication or choose a different auth mode.${failureReason}`;
      }
    } catch (error) {
      console.error(`[chat-tools] Failed to resolve managed API connection: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await addPlaceholderManagedApiConnection(projectConnections.projectPath, effectiveReference, resolvedConnectorId);
        const failureReason = error instanceof Error ? ` Automatic resolution failed: ${error.message}` : '';
        connectionNote = ` Added placeholder connection for "${effectiveReference}" in connections.json. Open designer to finish authentication or choose a different auth mode.${failureReason}`;
      } catch {
        // Ignore secondary placeholder error
      }
    }

    const action = buildManagedApiConnectionAction(effectiveReference, method, pathValue, configuration);
    if (operationId) {
      action.operationId = operationId;
    }
    const completionSuffix = ` Resolved managed connector reference "${effectiveReference}" for action "${actionName}".${connectionNote}`;
    return { action, completionSuffix };
  }

  const action = buildManagedApiConnectionAction(effectiveReference, method, pathValue, configuration);
  if (operationId) {
    action.operationId = operationId;
  }

  const completionSuffix = ` Resolved managed connector reference "${effectiveReference}" for action "${actionName}".`;

  return {
    action,
    completionSuffix,
  };
}

function validateApiConnectionConfiguration(configuration?: Record<string, unknown>): string | undefined {
  const inputs = configuration ?? {};
  const referenceName = getApiConnectionReferenceName(inputs);

  if (!referenceName) {
    return 'ApiConnection action requires a connection reference (inputs.host.connection.referenceName, inputs.host.connection.name, or inputs.host.connection string).';
  }

  if (typeof inputs.method !== 'string' || !inputs.method.trim()) {
    return 'ApiConnection action requires inputs.method.';
  }

  if (typeof inputs.path !== 'string' || !inputs.path.trim()) {
    return 'ApiConnection action requires inputs.path.';
  }

  return undefined;
}

function validateServiceProviderConfiguration(configuration?: Record<string, unknown>): string | undefined {
  const inputs = configuration ?? {};

  const serviceProviderConfiguration =
    typeof inputs.serviceProviderConfiguration === 'object' && inputs.serviceProviderConfiguration !== null
      ? (inputs.serviceProviderConfiguration as Record<string, unknown>)
      : undefined;

  if (!serviceProviderConfiguration) {
    return 'ServiceProvider action requires inputs.serviceProviderConfiguration.';
  }

  if (typeof serviceProviderConfiguration.connectionName !== 'string' || !serviceProviderConfiguration.connectionName.trim()) {
    return 'ServiceProvider action requires serviceProviderConfiguration.connectionName.';
  }

  if (typeof serviceProviderConfiguration.operationId !== 'string' || !serviceProviderConfiguration.operationId.trim()) {
    return 'ServiceProvider action requires serviceProviderConfiguration.operationId.';
  }

  if (typeof serviceProviderConfiguration.serviceProviderId !== 'string' || !serviceProviderConfiguration.serviceProviderId.trim()) {
    return 'ServiceProvider action requires serviceProviderConfiguration.serviceProviderId.';
  }

  return undefined;
}

async function getProjectConnectionsInfo(projectPath: string): Promise<ProjectConnectionsInfo> {
  const connectionsPath = path.join(projectPath, connectionsFileName);
  const localSettingsPath = path.join(projectPath, localSettingsFileName);

  let workflowManagementBaseUri: string | undefined;
  let workflowTenantId: string | undefined;
  let localSettingsMap: Record<string, string> = {};

  try {
    if (await fse.pathExists(localSettingsPath)) {
      const localSettingsData = (await fse.readJson(localSettingsPath)) as Record<string, unknown>;
      const values =
        typeof localSettingsData.Values === 'object' && localSettingsData.Values !== null
          ? (localSettingsData.Values as Record<string, unknown>)
          : undefined;

      workflowManagementBaseUri =
        typeof values?.[workflowManagementBaseURIKey] === 'string' ? (values[workflowManagementBaseURIKey] as string) : undefined;
      workflowTenantId = typeof values?.[workflowTenantIdKey] === 'string' ? (values[workflowTenantIdKey] as string) : undefined;

      // Collect all string values for @appsetting() resolution
      if (values) {
        localSettingsMap = Object.entries(values).reduce<Record<string, string>>((result, [key, val]) => {
          if (typeof val === 'string') {
            result[key] = val;
          }
          return result;
        }, {});
      }
    }
  } catch {
    // Ignore local settings read errors and continue with connection-only metadata
  }

  if (!(await fse.pathExists(connectionsPath))) {
    return {
      managedApiReferences: [],
      managedApiReferencesWithApiId: [],
      managedApiIdByReference: {},
      serviceProviderReferences: [],
      serviceProviderIdByReference: {},
      workflowManagementBaseUri,
      workflowTenantId,
      projectPath,
      localSettingsValues: localSettingsMap,
    };
  }

  try {
    const connectionsData = (await fse.readJson(connectionsPath)) as Record<string, unknown>;
    const managedApiConnections = getManagedApiConnections(connectionsData);
    const managedApiReferences = Object.keys(managedApiConnections);
    const managedApiIdByReference = managedApiReferences.reduce<Record<string, string>>((result, referenceName) => {
      const rawApiId = getManagedApiId(managedApiConnections[referenceName]);
      if (rawApiId) {
        result[referenceName] = resolveApiIdFromAppSettings(rawApiId, localSettingsMap);
      }
      return result;
    }, {});
    const managedApiReferencesWithApiId = Object.keys(managedApiIdByReference);

    const serviceProviderConnectionsData = getServiceProviderConnections(connectionsData);
    const serviceProviderReferences = Object.keys(serviceProviderConnectionsData);
    const serviceProviderIdByReference = serviceProviderReferences.reduce<Record<string, string>>((result, refName) => {
      const spId = getServiceProviderId(serviceProviderConnectionsData[refName]);
      if (spId) {
        result[refName] = spId;
      }
      return result;
    }, {});

    return {
      managedApiReferences,
      managedApiReferencesWithApiId,
      managedApiIdByReference,
      serviceProviderReferences,
      serviceProviderIdByReference,
      managedApiBasePath: extractManagedApiBasePath(managedApiIdByReference) ?? constructManagedApiBasePathFromSettings(localSettingsMap),
      workflowManagementBaseUri,
      workflowTenantId,
      weatherManagedReference: detectWeatherManagedApiReference(connectionsData),
      projectPath,
      localSettingsValues: localSettingsMap,
    };
  } catch {
    return {
      managedApiReferences: [],
      managedApiReferencesWithApiId: [],
      managedApiIdByReference: {},
      serviceProviderReferences: [],
      serviceProviderIdByReference: {},
      workflowManagementBaseUri,
      workflowTenantId,
      projectPath,
      localSettingsValues: localSettingsMap,
    };
  }
}

/**
 * Register workflow-related language model tools
 */
export function registerWorkflowTools(context: vscode.ExtensionContext): void {
  // Register create workflow tool
  context.subscriptions.push(vscode.lm.registerTool(ToolName.createWorkflow, new CreateWorkflowTool()));

  // Register list workflows tool
  context.subscriptions.push(vscode.lm.registerTool(ToolName.listWorkflows, new ListWorkflowsTool()));

  // Register get workflow definition tool
  context.subscriptions.push(vscode.lm.registerTool(ToolName.getWorkflowDefinition, new GetWorkflowDefinitionTool()));

  // Register add action tool
  context.subscriptions.push(vscode.lm.registerTool(ToolName.addAction, new AddActionTool()));

  // Register modify action tool
  context.subscriptions.push(vscode.lm.registerTool(ToolName.modifyAction, new ModifyActionTool()));
}

/**
 * Tool for creating a new workflow
 */
class CreateWorkflowTool implements vscode.LanguageModelTool<CreateWorkflowParams> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CreateWorkflowParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { name, type } = options.input;

    try {
      // Validate workflow name
      if (!name || !isValidWorkflowName(name)) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Invalid workflow name "${name}". Workflow name must start with a letter and can only contain letters, digits, "_" and "-".`
          ),
        ]);
      }

      // Find Logic App projects in the workspace
      const workspaceSearchRoots = getWorkspaceSearchRoots();
      if (workspaceSearchRoots.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('No workspace folder found. Please open a Logic App workspace first.'),
        ]);
      }

      const projectPaths = await findLogicAppProjectsInWorkspace(workspaceSearchRoots);
      if (projectPaths.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('No Logic App projects found in this workspace. Use /createProject to create one first.'),
        ]);
      }

      // Use the first project (or could be extended for multi-project disambiguation)
      const projectPath = projectPaths[0];
      const workflowDir = path.join(projectPath, name);

      // Check if workflow already exists
      if (await fse.pathExists(workflowDir)) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`A workflow named "${name}" already exists in the project.`),
        ]);
      }

      // Create the workflow directory and write workflow.json
      await fse.ensureDir(workflowDir);
      const workflowDefinition = createWorkflowDefinition(type || 'stateful');
      const workflowJsonPath = path.join(workflowDir, workflowFileName);
      await fse.writeJson(workflowJsonPath, workflowDefinition, { spaces: 2 });

      const projectName = path.basename(projectPath);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Successfully created workflow "${name}" (${type || 'stateful'}) in project "${projectName}". ` +
            `The workflow file is at: ${workflowJsonPath}`
        ),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Failed to create workflow: ${errorMessage}`)]);
    }
  }
}

/**
 * Tool for listing workflows in the current project
 */
class ListWorkflowsTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const workspaceSearchRoots = getWorkspaceSearchRoots();
      if (workspaceSearchRoots.length === 0) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace folder found.')]);
      }

      const projectPaths = await findLogicAppProjectsInWorkspace(workspaceSearchRoots);
      if (projectPaths.length === 0) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No Logic App project found in the workspace.')]);
      }

      const workflowsByProject = await Promise.all(
        projectPaths.map(async (projectPath) => ({
          projectPath,
          workflows: await listWorkflowsInProject(projectPath),
        }))
      );

      const workflows = workflowsByProject.flatMap((entry) =>
        entry.workflows.map((workflow) => ({
          projectName: path.basename(entry.projectPath),
          ...workflow,
        }))
      );

      if (workflows.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('No workflows found in the project. Use /createWorkflow to create one.'),
        ]);
      }

      const workflowList = workflows.map((w) => `- ${w.projectName}/${w.name} (${w.type})`).join('\n');
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Found ${workflows.length} workflow(s) across ${workflowsByProject.length} project(s):\n${workflowList}`
        ),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Failed to list workflows: ${errorMessage}`)]);
    }
  }
}

/**
 * Tool for getting workflow definition
 */
class GetWorkflowDefinitionTool implements vscode.LanguageModelTool<{ workflowName: string; projectName?: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ workflowName: string; projectName?: string }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { workflowName, projectName } = options.input;

    try {
      const workspaceSearchRoots = getWorkspaceSearchRoots();
      if (workspaceSearchRoots.length === 0) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace folder found.')]);
      }

      const workflowResolution = await resolveWorkflowPath(workspaceSearchRoots, workflowName, projectName);
      if (workflowResolution.status === 'noProject') {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No Logic App project found in the workspace.')]);
      }

      if (workflowResolution.status === 'notFound') {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Workflow "${workflowName}" not found.`)]);
      }

      if (workflowResolution.status === 'projectNotFound') {
        const projects = workflowResolution.availableProjects.map((name) => `- ${name}`).join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Project "${workflowResolution.requestedProjectName}" was not found. Please specify one of these project names:\n${projects}`
          ),
        ]);
      }

      if (workflowResolution.status === 'ambiguous') {
        const projects = workflowResolution.matches.map((m) => `- ${m.projectName}`).join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Workflow "${workflowName}" exists in multiple projects. Please specify projectName.\n${projects}`
          ),
        ]);
      }

      const workflowPath = workflowResolution.match.workflowPath;

      const definition = await fse.readJson(workflowPath);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Workflow definition for "${workflowName}":\n\`\`\`json\n${JSON.stringify(definition, null, 2)}\n\`\`\``
        ),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Failed to get workflow definition: ${errorMessage}`)]);
    }
  }
}

/**
 * Tool for adding an action to a workflow
 */
class AddActionTool implements vscode.LanguageModelTool<AddActionParams> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AddActionParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const {
      workflowName,
      projectName,
      actionType,
      actionName,
      configuration,
      connectorReference,
      connectorId,
      operationId,
      method,
      path: operationPath,
      serviceProviderConnection,
    } = options.input;

    try {
      const workspaceSearchRoots = getWorkspaceSearchRoots();
      if (workspaceSearchRoots.length === 0) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace folder found.')]);
      }

      const workflowResolution = await resolveWorkflowPath(workspaceSearchRoots, workflowName, projectName);
      if (workflowResolution.status === 'noProject') {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No Logic App project found in the workspace.')]);
      }

      if (workflowResolution.status === 'notFound') {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Workflow "${workflowName}" not found.`)]);
      }

      if (workflowResolution.status === 'projectNotFound') {
        const projects = workflowResolution.availableProjects.map((name) => `- ${name}`).join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Project "${workflowResolution.requestedProjectName}" was not found. Please specify one of these project names:\n${projects}`
          ),
        ]);
      }

      if (workflowResolution.status === 'ambiguous') {
        const projects = workflowResolution.matches.map((m) => `- ${m.projectName}`).join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Workflow "${workflowName}" exists in multiple projects. Please specify projectName.\n${projects}`
          ),
        ]);
      }

      const workflowPath = workflowResolution.match.workflowPath;

      const definition = await fse.readJson(workflowPath);
      const projectConnections = await getProjectConnectionsInfo(workflowResolution.match.projectPath);

      const isTrigger = isTriggerType(actionType);
      let nodeToWrite: Record<string, unknown>;
      const operationLabel = isTrigger ? 'trigger' : 'action';
      let operationTypeName = actionType;
      let completionSuffix = '';

      // Compute a default `runAfter` once, based on the workflow's existing actions.
      // Builders that consume `configuration.runAfter` (ApiConnection / ServiceProvider /
      // generic action builders) will pick this up; explicit caller `runAfter` is preserved.
      const existingActions =
        definition?.definition?.actions && typeof definition.definition.actions === 'object'
          ? (definition.definition.actions as Record<string, unknown>)
          : undefined;
      const inferredRunAfter = inferDefaultRunAfter(existingActions, configuration);
      const effectiveConfiguration: Record<string, unknown> = {
        ...(configuration ?? {}),
        runAfter: inferredRunAfter,
      };

      if (isTrigger) {
        if (!definition.definition.triggers) {
          definition.definition.triggers = {};
        }

        nodeToWrite = buildTriggerDefinition(actionType, configuration);
        definition.definition.triggers[actionName] = nodeToWrite;
      } else {
        const normalizedType = normalizeTypeToken(actionType);

        // Try built-in ServiceProvider connector first
        const connectorHint = connectorReference || connectorId || '';
        if (connectorHint) {
          const builtInResult = await resolveBuiltInServiceProviderAction(
            actionName,
            connectorHint,
            projectConnections,
            effectiveConfiguration,
            serviceProviderConnection
          );
          if (builtInResult?.action) {
            nodeToWrite = builtInResult.action;
            operationTypeName = 'ServiceProvider';
            completionSuffix = builtInResult.completionSuffix ?? '';

            if (!definition.definition.actions) {
              definition.definition.actions = {};
            }
            definition.definition.actions[actionName] = nodeToWrite;
            await fse.writeJson(workflowPath, definition, { spaces: 2 });
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `Successfully added action "${actionName}" of type "${operationTypeName}" to workflow "${workflowName}".${completionSuffix}`
              ),
            ]);
          }
          if (builtInResult?.error) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(builtInResult.error)]);
          }
        }

        // Then try managed ApiConnection path
        const genericResolvedAction = await resolveGenericApiConnectionAction(
          actionType,
          actionName,
          effectiveConfiguration,
          projectConnections,
          {
            connectorReference,
            connectorId,
            operationId,
            method,
            path: operationPath,
          },
          true
        );
        if (genericResolvedAction.error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(genericResolvedAction.error)]);
        }

        if (genericResolvedAction.action) {
          nodeToWrite = genericResolvedAction.action;
          operationTypeName = 'ApiConnection';
          completionSuffix = genericResolvedAction.completionSuffix ?? '';
        } else if (shouldAutoUseWeatherConnector(actionType, actionName, configuration)) {
          // Weather intent detected. Prefer an existing weather managed reference if present;
          // otherwise fall through to the generic resolver with a synthesized `msnweather` hint
          // so ARM discovery + placeholder provisioning can run (matching how every other
          // managed connector is handled).
          if (projectConnections.weatherManagedReference) {
            nodeToWrite = buildSeattleWeatherConnectorAction(projectConnections.weatherManagedReference, inferredRunAfter);
            operationTypeName = 'ApiConnection';
            completionSuffix = ` Used connector reference "${projectConnections.weatherManagedReference}" from connections.json for a Logic Apps weather action.`;
          } else {
            const weatherResolution = await resolveGenericApiConnectionAction(
              'ApiConnection',
              actionName,
              effectiveConfiguration,
              projectConnections,
              {
                connectorReference: connectorReference || 'msnweather',
                connectorId: connectorId || 'msnweather',
                operationId: operationId || 'CurrentWeather',
                method: method || 'get',
                path: operationPath,
              },
              false
            );

            if (weatherResolution.error) {
              const refsHint =
                projectConnections.managedApiReferences.length > 0
                  ? ` Available managed connection references: ${projectConnections.managedApiReferences.join(', ')}.`
                  : ' No managed connection references found in connections.json.';
              return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                  `Weather action requested but no weather managed API connection could be resolved (msnweather). ${weatherResolution.error}${refsHint}`
                ),
              ]);
            }

            if (!weatherResolution.action) {
              const refsHint =
                projectConnections.managedApiReferences.length > 0
                  ? ` Available managed connection references: ${projectConnections.managedApiReferences.join(', ')}.`
                  : ' No managed connection references found in connections.json.';
              return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                  `Weather action requested but no weather managed API connection was found in connections.json and msnweather could not be auto-provisioned (no Azure context available in local.settings.json).${refsHint}`
                ),
              ]);
            }

            nodeToWrite = weatherResolution.action;
            operationTypeName = 'ApiConnection';
            completionSuffix = weatherResolution.completionSuffix ?? '';
          }
        } else {
          if (normalizedType === 'apiconnection') {
            const validationError = validateApiConnectionConfiguration(extractActionInputs(effectiveConfiguration));
            if (validationError) {
              const refs = projectConnections.managedApiReferences;
              const refsHint =
                refs.length > 0
                  ? ` Available managed connection references: ${refs.join(', ')}.`
                  : ' No managed connection references found in connections.json.';

              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`${validationError}${refsHint}`)]);
            }

            const referenceValidationError = validateApiConnectionReferenceExists(
              extractActionInputs(effectiveConfiguration),
              projectConnections.managedApiReferencesWithApiId
            );
            if (referenceValidationError) {
              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(referenceValidationError)]);
            }
          }

          if (normalizedType === 'serviceprovider') {
            const validationError = validateServiceProviderConfiguration(extractActionInputs(effectiveConfiguration));
            if (validationError) {
              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(validationError)]);
            }
          }

          nodeToWrite = buildActionDefinition(actionType, effectiveConfiguration);
        }

        if (!definition.definition.actions) {
          definition.definition.actions = {};
        }

        definition.definition.actions[actionName] = nodeToWrite;
      }

      await fse.writeJson(workflowPath, definition, { spaces: 2 });

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Successfully added ${operationLabel} "${actionName}" of type "${operationTypeName}" to workflow "${workflowName}". Open the designer to configure additional settings.${completionSuffix}`
        ),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Failed to add action: ${errorMessage}`)]);
    }
  }
}

/**
 * Tool for modifying an action in a workflow
 */
class ModifyActionTool implements vscode.LanguageModelTool<ModifyActionParams> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ModifyActionParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { workflowName, actionName, modification, projectName } = options.input;

    try {
      const workspaceSearchRoots = getWorkspaceSearchRoots();
      if (workspaceSearchRoots.length === 0) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace folder found.')]);
      }

      const workflowResolution = await resolveWorkflowPath(workspaceSearchRoots, workflowName, projectName);
      if (workflowResolution.status === 'noProject') {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No Logic App project found in the workspace.')]);
      }

      if (workflowResolution.status === 'notFound') {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Workflow "${workflowName}" not found.`)]);
      }

      if (workflowResolution.status === 'projectNotFound') {
        const projects = workflowResolution.availableProjects.map((name) => `- ${name}`).join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Project "${workflowResolution.requestedProjectName}" was not found. Please specify one of these project names:\n${projects}`
          ),
        ]);
      }

      if (workflowResolution.status === 'ambiguous') {
        const projects = workflowResolution.matches.map((m) => `- ${m.projectName}`).join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Workflow "${workflowName}" exists in multiple projects. Please specify projectName.\n${projects}`
          ),
        ]);
      }

      const workflowPath = workflowResolution.match.workflowPath;

      const definition = await fse.readJson(workflowPath);
      const projectConnections = await getProjectConnectionsInfo(workflowResolution.match.projectPath);

      const actionExists = !!definition.definition.actions?.[actionName];
      const triggerExists = !!definition.definition.triggers?.[actionName];

      if (!actionExists && !triggerExists) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Action or trigger "${actionName}" not found in workflow "${workflowName}".`),
        ]);
      }

      // Parse and apply the modification
      try {
        const modificationObj = JSON.parse(modification);

        if (actionExists) {
          const existingAction = definition.definition.actions[actionName] as Record<string, unknown>;
          const mergedAction = {
            ...existingAction,
            ...modificationObj,
          } as Record<string, unknown>;
          const mergedType = typeof mergedAction.type === 'string' ? mergedAction.type : String(existingAction.type ?? 'Http');
          const normalizedMergedType = normalizeTypeToken(mergedType);

          const genericResolvedAction = await resolveGenericApiConnectionAction(mergedType, actionName, mergedAction, projectConnections);
          if (genericResolvedAction.error) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(genericResolvedAction.error)]);
          }

          if (genericResolvedAction.action) {
            definition.definition.actions[actionName] = genericResolvedAction.action;
          } else if (shouldAutoUseWeatherConnector(mergedType, actionName, mergedAction)) {
            // Weather intent: prefer an existing weather managed reference, else fall through
            // to the generic resolver with a synthesized msnweather hint so ARM discovery /
            // placeholder provisioning runs (same behavior as AddActionTool).
            if (projectConnections.weatherManagedReference) {
              const existingRunAfter =
                typeof mergedAction.runAfter === 'object' && mergedAction.runAfter !== null
                  ? (mergedAction.runAfter as Record<string, unknown>)
                  : undefined;
              definition.definition.actions[actionName] = buildSeattleWeatherConnectorAction(
                projectConnections.weatherManagedReference,
                existingRunAfter
              );
            } else {
              const weatherResolution = await resolveGenericApiConnectionAction(
                'ApiConnection',
                actionName,
                mergedAction,
                projectConnections,
                {
                  connectorReference: 'msnweather',
                  connectorId: 'msnweather',
                  operationId: 'CurrentWeather',
                  method: 'get',
                },
                false
              );

              if (weatherResolution.error) {
                const refsHint =
                  projectConnections.managedApiReferences.length > 0
                    ? ` Available managed connection references: ${projectConnections.managedApiReferences.join(', ')}.`
                    : ' No managed connection references found in connections.json.';
                return new vscode.LanguageModelToolResult([
                  new vscode.LanguageModelTextPart(
                    `Weather action requested but no weather managed API connection could be resolved (msnweather). ${weatherResolution.error}${refsHint}`
                  ),
                ]);
              }

              if (!weatherResolution.action) {
                const refsHint =
                  projectConnections.managedApiReferences.length > 0
                    ? ` Available managed connection references: ${projectConnections.managedApiReferences.join(', ')}.`
                    : ' No managed connection references found in connections.json.';
                return new vscode.LanguageModelToolResult([
                  new vscode.LanguageModelTextPart(
                    `Weather action requested but no weather managed API connection was found in connections.json and msnweather could not be auto-provisioned (no Azure context available in local.settings.json).${refsHint}`
                  ),
                ]);
              }

              definition.definition.actions[actionName] = weatherResolution.action;
            }
          } else {
            if (normalizedMergedType === 'apiconnection') {
              const validationError = validateApiConnectionConfiguration(extractActionInputs(mergedAction));
              if (validationError) {
                const refs = projectConnections.managedApiReferences;
                const refsHint =
                  refs.length > 0
                    ? ` Available managed connection references: ${refs.join(', ')}.`
                    : ' No managed connection references found in connections.json.';

                return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`${validationError}${refsHint}`)]);
              }

              const referenceValidationError = validateApiConnectionReferenceExists(
                extractActionInputs(mergedAction),
                projectConnections.managedApiReferencesWithApiId
              );
              if (referenceValidationError) {
                return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(referenceValidationError)]);
              }
            }

            if (normalizedMergedType === 'serviceprovider') {
              const validationError = validateServiceProviderConfiguration(extractActionInputs(mergedAction));
              if (validationError) {
                return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(validationError)]);
              }
            }

            definition.definition.actions[actionName] = buildActionDefinition(mergedType, mergedAction);
          }
        } else if (triggerExists) {
          definition.definition.triggers[actionName] = {
            ...definition.definition.triggers[actionName],
            ...modificationObj,
          };
        }
      } catch {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            'Invalid modification format. Please provide a valid JSON object with the properties to modify.'
          ),
        ]);
      }

      await fse.writeJson(workflowPath, definition, { spaces: 2 });

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Successfully modified action "${actionName}" in workflow "${workflowName}".`),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Failed to modify action: ${errorMessage}`)]);
    }
  }
}

/**
 * Validate workflow name
 * @internal Exported for testing
 */
export function isValidWorkflowName(name: string): boolean {
  const workflowNameValidation = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  return workflowNameValidation.test(name);
}

function getWorkspaceSearchRoots(): string[] {
  return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
}

async function findLogicAppProjectsInWorkspace(workspaceSearchRoots: string[]): Promise<string[]> {
  const allProjects = await Promise.all(workspaceSearchRoots.map((root) => findLogicAppProjects(root)));
  const deduped = new Set(allProjects.flat());
  return Array.from(deduped);
}

async function findLogicAppProjects(workspacePath: string): Promise<string[]> {
  const projectPaths: string[] = [];

  if (await isLogicAppProjectPath(workspacePath)) {
    projectPaths.push(workspacePath);
  }

  const entries = await fse.readdir(workspacePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const subPath = path.join(workspacePath, entry.name);
      if (await isLogicAppProjectPath(subPath)) {
        projectPaths.push(subPath);
      }
    }
  }

  return projectPaths;
}

async function isLogicAppProjectPath(projectPath: string): Promise<boolean> {
  const hostJsonPath = path.join(projectPath, 'host.json');
  if (!(await fse.pathExists(hostJsonPath))) {
    return false;
  }

  try {
    const hostJson = await fse.readJson(hostJsonPath);
    return hostJson.extensionBundle?.id === 'Microsoft.Azure.Functions.ExtensionBundle.Workflows';
  } catch {
    return false;
  }
}

type WorkflowResolution =
  | { status: 'noProject' }
  | { status: 'notFound' }
  | { status: 'projectNotFound'; requestedProjectName: string; availableProjects: string[] }
  | { status: 'ambiguous'; matches: Array<{ projectPath: string; projectName: string; workflowPath: string }> }
  | { status: 'found'; match: { projectPath: string; projectName: string; workflowPath: string } };

async function resolveWorkflowPath(
  workspaceSearchRoots: string[],
  workflowName: string,
  projectName?: string
): Promise<WorkflowResolution> {
  const projectPaths = await findLogicAppProjectsInWorkspace(workspaceSearchRoots);
  if (projectPaths.length === 0) {
    return { status: 'noProject' };
  }

  const filteredProjectPaths = resolveProjectPathCandidates(projectPaths, projectName);

  if (projectName && filteredProjectPaths.length === 0) {
    return {
      status: 'projectNotFound',
      requestedProjectName: projectName,
      availableProjects: projectPaths.map((projectPath) => path.basename(projectPath)),
    };
  }

  const matches: Array<{ projectPath: string; projectName: string; workflowPath: string }> = [];
  for (const projectPath of filteredProjectPaths) {
    const workflowPath = path.join(projectPath, workflowName, workflowFileName);
    if (await fse.pathExists(workflowPath)) {
      matches.push({
        projectPath,
        projectName: path.basename(projectPath),
        workflowPath,
      });
    }
  }

  if (matches.length === 0) {
    return { status: 'notFound' };
  }

  if (matches.length > 1) {
    return { status: 'ambiguous', matches };
  }

  return { status: 'found', match: matches[0] };
}

function normalizeProjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve project path candidates from user-provided project name.
 * Performs tolerant matching so values like "TonyProject," or
 * "TonyProject, Workflow1" can still resolve correctly.
 * @internal Exported for testing
 */
export function resolveProjectPathCandidates(projectPaths: string[], projectName?: string): string[] {
  if (!projectName) {
    return projectPaths;
  }

  const trimmedInput = projectName.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!trimmedInput) {
    return projectPaths;
  }

  const exactMatches = projectPaths.filter((projectPath) => path.basename(projectPath).toLowerCase() === trimmedInput.toLowerCase());
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const normalizedInput = normalizeProjectName(trimmedInput);
  if (!normalizedInput) {
    return [];
  }

  const normalizedExactMatches = projectPaths.filter((projectPath) => normalizeProjectName(path.basename(projectPath)) === normalizedInput);
  if (normalizedExactMatches.length > 0) {
    return normalizedExactMatches;
  }

  return projectPaths.filter((projectPath) => {
    const normalizedProject = normalizeProjectName(path.basename(projectPath));
    return normalizedInput.includes(normalizedProject) || normalizedProject.includes(normalizedInput);
  });
}

/**
 * List workflows in a Logic App project
 */
async function listWorkflowsInProject(projectPath: string): Promise<Array<{ name: string; type: string }>> {
  const workflows: Array<{ name: string; type: string }> = [];

  const entries = await fse.readdir(projectPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
      const workflowJsonPath = path.join(projectPath, entry.name, workflowFileName);
      if (await fse.pathExists(workflowJsonPath)) {
        try {
          const definition = await fse.readJson(workflowJsonPath);
          const kind = definition.kind || 'Stateful';
          workflows.push({ name: entry.name, type: kind });
        } catch {
          workflows.push({ name: entry.name, type: 'Unknown' });
        }
      }
    }
  }

  return workflows;
}

/**
 * Create a workflow definition based on type
 * @internal Exported for testing
 */
export function createWorkflowDefinition(type: WorkflowTypeOption, description?: string): Record<string, unknown> {
  const kindMap: Record<WorkflowTypeOption, string> = {
    stateful: 'Stateful',
    stateless: 'Stateless',
    agentic: 'Stateful',
    agent: 'Stateful',
  };

  const baseDefinition = {
    definition: {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0.0',
      triggers: {},
      actions: {},
      outputs: {},
    },
    kind: kindMap[type],
  };

  // Add description as a comment if provided
  if (description) {
    (baseDefinition.definition as Record<string, unknown>).description = description;
  }

  // Add type-specific configurations
  if (type === 'agentic' || type === 'agent') {
    // Add AI-related metadata for agentic workflows
    (baseDefinition as Record<string, unknown>).metadata = {
      workflowType: type,
      aiEnabled: true,
    };
  }

  return baseDefinition;
}
