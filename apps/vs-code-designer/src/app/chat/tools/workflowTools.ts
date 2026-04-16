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
  extensionCommand,
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
// Managed API Connection: reuse existing / create + OAuth
// ──────────────────────────────────────────────────────────────────────────

/**
 * Info about an existing Azure API connection resource
 */
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
 * e.g. `/subscriptions/.../managedApis/outlook` → `outlook`
 * @internal Exported for testing
 */
export function getConnectorShortName(connectorId: string): string {
  return connectorId.split('/').pop() ?? connectorId;
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
    const token = await getAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    let filterParts = `ManagedApiName eq '${connectorShortName}' and Kind eq 'V2'`;
    if (azureContext.location) {
      filterParts = `Location eq '${azureContext.location}' and ${filterParts}`;
    }
    const url = `${baseUrl}/subscriptions/${azureContext.subscriptionId}/resourceGroups/${azureContext.resourceGroup}/providers/Microsoft.Web/connections?api-version=2018-07-01-preview&$filter=${encodeURIComponent(filterParts)}`;

    const response = await fetch(url, {
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

/**
 * Result of fetching connection keys, including the runtime URL required for connections.json.
 * @internal Exported for testing
 */
export interface ConnectionKeyResult {
  connectionKey?: string;
  connectionRuntimeUrl?: string;
}

/**
 * Fetch connection keys and runtime URL for an existing API Hub connection.
 *
 * POST /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/connections/{name}/listConnectionKeys
 * @internal Exported for testing
 */
export async function fetchConnectionKey(connectionId: string, azureContext: AzureContext): Promise<ConnectionKeyResult | undefined> {
  try {
    const token = await getAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${connectionId}/listConnectionKeys?api-version=2018-07-01-preview`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ validityTimeSpan: '7' }),
    });

    if (!response.ok) {
      console.log(`[chat-tools] Failed to fetch connection keys: ${response.status}`);
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

  // Read and update connections.json
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

  const connectionEntry: Record<string, unknown> = {
    api: { id: connectorId },
    connection: { id: connectionResourceId },
  };

  if (connectionRuntimeUrl) {
    connectionEntry.connectionRuntimeUrl = connectionRuntimeUrl;
  }

  if (useMSI) {
    connectionEntry.authentication = { type: 'ManagedServiceIdentity' };
  } else {
    const appSettingKey = `${referenceName}-connectionKey`;
    connectionEntry.authentication = { type: 'Raw', scheme: 'Key', parameter: `@appsetting('${appSettingKey}')` };
  }

  managed[referenceName] = connectionEntry;
  await fse.writeJson(connectionsPath, connectionsData, { spaces: 2 });

  // Store the connection key in local.settings.json (only for Raw Keys, not MSI)
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
  console.log(`[chat-tools] Added real managed API connection for "${referenceName}" → ${connectionResourceId} (MSI=${useMSI})`);
}

/**
 * Try to reuse an existing Azure API connection from the resource group.
 * Auto-picks the first match and mentions alternatives in the result message.
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

  // Auto-pick the first connection
  const picked = existing[0];
  console.log(`[chat-tools] Reusing existing connection "${picked.name}" for "${referenceName}"`);

  const useMSI = isMSIAuthEnabled(azureContext.authenticationMethod);

  // Fetch connection key and runtime URL (MSI doesn't need a key)
  const keyResult = useMSI ? undefined : await fetchConnectionKey(picked.id, azureContext);
  await addRealManagedApiConnection(
    projectPath,
    referenceName,
    connectorId,
    picked.id,
    keyResult?.connectionKey,
    useMSI,
    keyResult?.connectionRuntimeUrl
  );

  // Build response message with alternatives
  let message = `Connected using existing connection "${picked.displayName || picked.name}" in resource group "${azureContext.resourceGroup}".`;
  if (existing.length > 1) {
    const others = existing
      .slice(1)
      .map((c) => c.displayName || c.name)
      .join(', ');
    message += ` (Also available: ${others})`;
  }

  return {
    success: true,
    connectionId: picked.id,
    connectionName: picked.displayName || picked.name,
    message,
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

/**
 * Create a new API connection in Azure via ARM and complete OAuth consent inline.
 *
 * 1. PUT connection resource to ARM
 * 2. POST listConsentLinks → get consent URL
 * 3. Open browser for user to authenticate
 * 4. Wait for logicapps://authcomplete callback
 * 5. POST confirmConsentCode
 * 6. Fetch connection key
 * 7. Write connections.json + local.settings.json
 */
async function createAndAuthManagedApiConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext
): Promise<ManagedApiConnectionResolution> {
  if (!azureContext.resourceGroup || !azureContext.location) {
    return { success: false, message: 'Resource group and location required to create connection.' };
  }

  const token = await getAuthorizationToken(azureContext.tenantId);
  const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
  const connectionName = `${referenceName}-${Date.now().toString(36)}`;
  const connectionResourceId =
    `/subscriptions/${azureContext.subscriptionId}` +
    `/resourceGroups/${azureContext.resourceGroup}` +
    `/providers/Microsoft.Web/connections/${connectionName}`;

  // Step 1: PUT to create the connection resource
  const putUrl = `${baseUrl}${connectionResourceId}?api-version=2018-07-01-preview`;
  const putBody = {
    properties: {
      api: { id: connectorId },
      displayName: referenceName,
    },
    kind: 'V2',
    location: azureContext.location,
  };

  try {
    const putResponse = await fetch(putUrl, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
    });

    if (!putResponse.ok) {
      const errorText = await putResponse.text().catch(() => '');
      console.log(`[chat-tools] Failed to create connection resource: ${putResponse.status} ${errorText}`);
      return { success: false, message: `Failed to create connection in Azure (${putResponse.status}).` };
    }
  } catch (error) {
    console.log(`[chat-tools] Error creating connection: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, message: 'Network error creating connection in Azure.' };
  }

  // Step 2: Get consent URL via listConsentLinks
  const authSession = await getAuthData(azureContext.tenantId);
  const accessToken = authSession?.accessToken;
  if (!accessToken) {
    return { success: false, message: 'Could not obtain Azure authentication session.' };
  }

  // Decode JWT to get objectId and tenantId
  let userObjectId: string | undefined;
  let userTenantId: string | undefined;
  try {
    const payloadBase64 = accessToken.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    userObjectId = payload.oid;
    userTenantId = payload.tid;
  } catch {
    console.log('[chat-tools] Failed to decode JWT for OAuth consent');
  }
  if (!userObjectId || !userTenantId) {
    return { success: false, message: 'Could not extract user identity from auth token.' };
  }

  // Build the OAuth redirect URL
  const pid = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const callbackUri = await (vscode.env as any).asExternalUri(
    vscode.Uri.parse(`${vscode.env.uriScheme}://${logicAppsStandardExtensionId}/authcomplete`)
  );
  const redirectUrl = `${callbackUri.toString(true)}?pid=${pid}`;

  const consentUrl = await fetchConsentUrl(connectionResourceId, userObjectId, userTenantId, redirectUrl, token, baseUrl);

  if (!consentUrl) {
    return { success: false, message: 'Could not obtain OAuth consent URL from Azure.' };
  }

  // Step 3+4: Open browser and wait for callback
  const codePromise = new Promise<string>((resolve, reject) => {
    pendingOAuthCallbacks.set(pid, { resolve, reject });

    // 5-minute timeout
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
    return { success: false, message: error instanceof Error ? error.message : 'OAuth authentication failed.' };
  }

  // Step 5: Confirm consent code
  if (authCode !== 'valid') {
    const confirmOk = await confirmConsentCode(connectionResourceId, authCode, userObjectId, userTenantId, token, baseUrl);
    if (!confirmOk) {
      return { success: false, message: 'Failed to confirm OAuth authorization code.' };
    }
  }

  // Step 6+7: Fetch connection key and write to connections.json + local.settings.json
  const useMSI = isMSIAuthEnabled(azureContext.authenticationMethod);
  const keyResult = useMSI ? undefined : await fetchConnectionKey(connectionResourceId, azureContext);
  await addRealManagedApiConnection(
    projectPath,
    referenceName,
    connectorId,
    connectionResourceId,
    keyResult?.connectionKey,
    useMSI,
    keyResult?.connectionRuntimeUrl
  );

  return {
    success: true,
    connectionId: connectionResourceId,
    connectionName,
    message: `Created and authenticated connection "${referenceName}" in resource group "${azureContext.resourceGroup}".`,
  };
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
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.log(`[chat-tools] Failed to get consent links: ${response.status}`);
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
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.log(`[chat-tools] Failed to confirm consent code: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.log(`[chat-tools] Error confirming consent code: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Connector Parameter Discovery & Classification
// ──────────────────────────────────────────────────────────────────────────

/**
 * A single connection parameter from connector metadata.
 * @internal Exported for testing
 */
export interface ConnectorConnectionParameter {
  type: string;
  uiDefinition?: {
    displayName?: string;
    description?: string;
    tooltip?: string;
    constraints?: {
      required?: string;
      hidden?: string;
      allowedValues?: Array<{ text?: string; value?: string }>;
    };
  };
  allowedValues?: Array<{ value: string }>;
}

/**
 * Connector metadata returned from the managed API endpoint.
 * @internal Exported for testing
 */
export interface ConnectorMetadata {
  name: string;
  displayName?: string;
  connectionParameters?: Record<string, ConnectorConnectionParameter>;
  connectionParameterSets?: {
    uiDefinition?: { displayName?: string; description?: string };
    values: Array<{
      name: string;
      uiDefinition?: { displayName?: string; description?: string };
      parameters: Record<string, ConnectorConnectionParameter>;
    }>;
  };
}

/**
 * Auth classification for a connector's connection requirements.
 * - 'simple': No user-facing parameters needed (auto-create)
 * - 'oauthOnly': Only OAuth parameters (auto-create with browser consent)
 * - 'credential': Single-auth with user-facing credential fields (prompt user)
 * - 'multiAuth': Multiple authentication options / parameter sets (fall back to designer)
 * @internal Exported for testing
 */
export type ConnectorAuthType = 'simple' | 'oauthOnly' | 'credential' | 'multiAuth';

const HIDDEN_PARAMETER_PREFIXES = ['token', 'token:'];

/**
 * Determine whether a connection parameter should be hidden from the user.
 * Hides internal params like token, token:*, hidden-constrained, and prerequisite connection params.
 * Note: oauthSetting is NOT hidden — it's visible for classification purposes but not promptable.
 * @internal Exported for testing
 */
export function isHiddenParam(key: string, param: ConnectorConnectionParameter): boolean {
  const lowerKey = key.toLowerCase();
  if (HIDDEN_PARAMETER_PREFIXES.some((prefix) => lowerKey === prefix || lowerKey.startsWith(`${prefix}:`))) {
    return true;
  }
  if (param.uiDefinition?.constraints?.hidden === 'true') {
    return true;
  }
  if (param.type?.toLowerCase() === 'connection') {
    return true;
  }
  return false;
}

/**
 * Extract user-facing parameters from connector metadata, filtering out hidden/internal ones.
 * Returns parameters that are visible in the connection creation UI (including OAuth).
 * @internal Exported for testing
 */
export function extractUserFacingParameters(
  connectionParameters: Record<string, ConnectorConnectionParameter>
): Record<string, ConnectorConnectionParameter> {
  const result: Record<string, ConnectorConnectionParameter> = {};
  for (const [key, param] of Object.entries(connectionParameters)) {
    if (!isHiddenParam(key, param)) {
      result[key] = param;
    }
  }
  return result;
}

/**
 * Extract promptable (non-OAuth) parameters that the user needs to fill in.
 * Filters out hidden params AND oauthSetting params, leaving only credential fields.
 * @internal Exported for testing
 */
export function extractPromptableParameters(
  connectionParameters: Record<string, ConnectorConnectionParameter>
): Record<string, ConnectorConnectionParameter> {
  const result: Record<string, ConnectorConnectionParameter> = {};
  for (const [key, param] of Object.entries(connectionParameters)) {
    if (!isHiddenParam(key, param) && param.type?.toLowerCase() !== 'oauthsetting') {
      result[key] = param;
    }
  }
  return result;
}

/**
 * Classify a connector's auth requirements based on its connection parameters.
 * @internal Exported for testing
 */
export function classifyConnectorAuthType(metadata: ConnectorMetadata): ConnectorAuthType {
  // Multi-auth: has connectionParameterSets with multiple values
  if (metadata.connectionParameterSets?.values && metadata.connectionParameterSets.values.length > 1) {
    return 'multiAuth';
  }

  // Single parameter set: treat like flat parameters using the single set's params
  if (metadata.connectionParameterSets?.values?.length === 1) {
    const singleSetParams = metadata.connectionParameterSets.values[0].parameters;
    const userFacing = extractUserFacingParameters(singleSetParams);
    if (Object.keys(userFacing).length === 0) {
      return 'simple';
    }
    const allOAuth = Object.values(userFacing).every((p) => p.type?.toLowerCase() === 'oauthsetting');
    return allOAuth ? 'oauthOnly' : 'credential';
  }

  const connectionParameters = metadata.connectionParameters;
  if (!connectionParameters) {
    return 'simple';
  }

  const userFacing = extractUserFacingParameters(connectionParameters);
  if (Object.keys(userFacing).length === 0) {
    return 'simple';
  }

  const allOAuth = Object.values(userFacing).every((p) => p.type?.toLowerCase() === 'oauthsetting');
  if (allOAuth) {
    return 'oauthOnly';
  }

  return 'credential';
}

/**
 * Fetch connector metadata from the managed API endpoint.
 * Returns connection parameter definitions for the given connector.
 * @internal Exported for testing
 */
export async function fetchConnectorMetadata(connectorId: string, azureContext: AzureContext): Promise<ConnectorMetadata | undefined> {
  try {
    const token = await getAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');

    // connectorId is like /subscriptions/.../managedApis/sql
    const url = `${baseUrl}${connectorId}?api-version=2018-07-01-preview`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.log(`[chat-tools] Failed to fetch connector metadata: ${response.status}`);
      return undefined;
    }

    const data = (await response.json()) as {
      name?: string;
      properties?: {
        displayName?: string;
        connectionParameters?: Record<string, ConnectorConnectionParameter>;
        connectionParameterSets?: ConnectorMetadata['connectionParameterSets'];
      };
    };

    return {
      name: data.name ?? getConnectorShortName(connectorId),
      displayName: data.properties?.displayName,
      connectionParameters: data.properties?.connectionParameters,
      connectionParameterSets: data.properties?.connectionParameterSets,
    };
  } catch (error) {
    console.log(`[chat-tools] Error fetching connector metadata: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Credential-Based Connection Creation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Prompt the user for connection credential values using VS Code secure input boxes.
 * Returns the collected parameter values, or undefined if the user cancels.
 * @internal Exported for testing (returns the prompt logic for mocking)
 */
async function promptForCredentials(
  connectorDisplayName: string,
  parameters: Record<string, ConnectorConnectionParameter>
): Promise<Record<string, string> | undefined> {
  const values: Record<string, string> = {};

  for (const [key, param] of Object.entries(parameters)) {
    const displayName = param.uiDefinition?.displayName ?? key;
    const description = param.uiDefinition?.description ?? '';
    const isSecret = param.type?.toLowerCase() === 'securestring' || param.type?.toLowerCase() === 'secureobject';
    const isRequired = param.uiDefinition?.constraints?.required !== 'false';

    // For enum-like params with allowed values, show quick pick
    const allowedValues =
      param.uiDefinition?.constraints?.allowedValues ?? param.allowedValues?.map((v) => ({ value: v.value, text: v.value }));
    if (allowedValues && allowedValues.length > 0) {
      const items = allowedValues.map((v) => ({
        label: v.text ?? v.value ?? '',
        value: v.value ?? v.text ?? '',
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select ${displayName} for ${connectorDisplayName}`,
        ignoreFocusOut: true,
      });
      if (!selected) {
        return undefined;
      }
      values[key] = selected.value;
      continue;
    }

    const input = await vscode.window.showInputBox({
      prompt: description || `Enter ${displayName} for ${connectorDisplayName}`,
      placeHolder: displayName,
      ignoreFocusOut: true,
      password: isSecret,
      validateInput: (value) => {
        if (isRequired && (!value || value.trim().length === 0)) {
          return `${displayName} is required`;
        }
        return undefined;
      },
    });

    if (input === undefined) {
      return undefined;
    }
    values[key] = input;
  }

  return values;
}

/**
 * Create a managed API connection with user-provided credential parameter values.
 * Uses ARM PUT with parameterValues in the request body.
 */
async function createCredentialBasedConnection(
  projectPath: string,
  referenceName: string,
  connectorId: string,
  azureContext: AzureContext,
  parameterValues: Record<string, string>
): Promise<ManagedApiConnectionResolution> {
  if (!azureContext.resourceGroup || !azureContext.location) {
    return { success: false, message: 'Resource group and location required to create connection.' };
  }

  const token = await getAuthorizationToken(azureContext.tenantId);
  const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');
  const connectionName = `${referenceName}-${Date.now().toString(36)}`;
  const connectionResourceId =
    `/subscriptions/${azureContext.subscriptionId}` +
    `/resourceGroups/${azureContext.resourceGroup}` +
    `/providers/Microsoft.Web/connections/${connectionName}`;

  // PUT to create the connection resource with parameter values
  const putUrl = `${baseUrl}${connectionResourceId}?api-version=2018-07-01-preview`;
  const putBody = {
    properties: {
      api: { id: connectorId },
      displayName: referenceName,
      parameterValues,
    },
    kind: 'V2',
    location: azureContext.location,
  };

  try {
    const putResponse = await fetch(putUrl, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
    });

    if (!putResponse.ok) {
      const errorText = await putResponse.text().catch(() => '');
      console.log(`[chat-tools] Failed to create credential connection: ${putResponse.status} ${errorText}`);
      return { success: false, message: `Failed to create connection in Azure (${putResponse.status}). Please check your credentials.` };
    }
  } catch (error) {
    console.log(`[chat-tools] Error creating credential connection: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, message: 'Network error creating connection in Azure.' };
  }

  // Test the connection before persisting locally
  await testManagedApiConnection(connectionResourceId, azureContext);

  // Fetch connection key + runtime URL and write to local files
  const useMSI = isMSIAuthEnabled(azureContext.authenticationMethod);
  const keyResult = useMSI ? undefined : await fetchConnectionKey(connectionResourceId, azureContext);
  await addRealManagedApiConnection(
    projectPath,
    referenceName,
    connectorId,
    connectionResourceId,
    keyResult?.connectionKey,
    useMSI,
    keyResult?.connectionRuntimeUrl
  );

  return {
    success: true,
    connectionId: connectionResourceId,
    connectionName,
    message: `Created connection "${referenceName}" with provided credentials in resource group "${azureContext.resourceGroup}".`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Post-Creation Connection Testing
// ──────────────────────────────────────────────────────────────────────────

/**
 * Test a managed API connection after creation.
 * Non-blocking: logs a warning on failure but does not prevent connection use.
 * @internal Exported for testing
 */
export async function testManagedApiConnection(connectionResourceId: string, azureContext: AzureContext): Promise<boolean> {
  try {
    const token = await getAuthorizationToken(azureContext.tenantId);
    const baseUrl = azureContext.managementBaseUrl.replace(/\/+$/, '');

    // First, get the connection details to find testLinks
    const getUrl = `${baseUrl}${connectionResourceId}?api-version=2018-07-01-preview`;
    const getResponse = await fetch(getUrl, {
      method: 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });

    if (!getResponse.ok) {
      console.log(`[chat-tools] Could not fetch connection for testing: ${getResponse.status}`);
      return false;
    }

    const connectionData = (await getResponse.json()) as {
      properties?: {
        statuses?: Array<{ status?: string; error?: { message?: string } }>;
        testLinks?: Array<{ requestUri?: string; method?: string }>;
        testRequests?: Array<{ requestUri?: string; method?: string }>;
      };
    };

    // Check existing status first
    const statuses = connectionData.properties?.statuses ?? [];
    const hasError = statuses.some((s) => s.status?.toLowerCase() === 'error');
    if (hasError) {
      const errorMsg = statuses.find((s) => s.status?.toLowerCase() === 'error')?.error?.message ?? 'Unknown error';
      console.log(`[chat-tools] Connection test: status indicates error — ${errorMsg}`);
      vscode.window.showWarningMessage(`Connection created but may have issues: ${errorMsg}`);
      return false;
    }

    // Try testLinks if available
    const testLink = connectionData.properties?.testLinks?.[0] ?? connectionData.properties?.testRequests?.[0];
    if (testLink?.requestUri) {
      const testResponse = await fetch(testLink.requestUri, {
        method: testLink.method ?? 'GET',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
      });
      if (!testResponse.ok) {
        console.log(`[chat-tools] Connection test failed: ${testResponse.status}`);
        vscode.window.showWarningMessage('Connection was created but the connection test failed. You may need to verify your credentials.');
        return false;
      }
    }

    console.log(`[chat-tools] Connection test passed for ${connectionResourceId}`);
    return true;
  } catch (error) {
    console.log(`[chat-tools] Connection test error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Attempt to resolve a managed API connection automatically:
 *  1. Try reusing an existing connection in the resource group
 *  2. Discover connector parameters and classify auth type
 *  3. For credential-based: prompt user via VS Code input and create
 *  4. For OAuth: create connection and do inline OAuth consent
 *  5. For multi-auth: fall back to placeholder (caller opens designer)
 *  6. Fall back to placeholder (caller handles this)
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

  // Step 1: Try reusing existing connection from resource group
  if (azureContext.resourceGroup) {
    const reuseResult = await tryReuseExistingConnection(projectPath, referenceName, connectorId, azureContext);
    if (reuseResult.success) {
      return reuseResult;
    }
  }

  // Step 2: Discover connector parameters and classify auth type
  if (azureContext.resourceGroup && azureContext.location) {
    const metadata = await fetchConnectorMetadata(connectorId, azureContext);
    if (metadata) {
      const authType = classifyConnectorAuthType(metadata);
      console.log(`[chat-tools] Connector "${metadata.displayName ?? metadata.name}" classified as: ${authType}`);

      switch (authType) {
        case 'simple': {
          // No credentials needed — create connection with empty params
          const createResult = await createCredentialBasedConnection(projectPath, referenceName, connectorId, azureContext, {});
          if (createResult.success) {
            return createResult;
          }
          break;
        }

        case 'credential': {
          // Prompt user for credentials via VS Code secure input
          const params = metadata.connectionParameters ? extractPromptableParameters(metadata.connectionParameters) : {};
          const connectorDisplayName = metadata.displayName ?? metadata.name;
          const credentials = await promptForCredentials(connectorDisplayName, params);

          if (credentials) {
            const createResult = await createCredentialBasedConnection(projectPath, referenceName, connectorId, azureContext, credentials);
            if (createResult.success) {
              return createResult;
            }
            // Creation failed — message already set in createResult
            return createResult;
          }
          // User cancelled — fall through to placeholder
          return { success: false, message: 'Credential entry was cancelled.' };
        }

        case 'oauthOnly': {
          // Use existing OAuth flow
          const createResult = await createAndAuthManagedApiConnection(projectPath, referenceName, connectorId, azureContext);
          if (createResult.success) {
            return createResult;
          }
          console.log(`[chat-tools] Inline OAuth failed: ${createResult.message}`);
          break;
        }

        case 'multiAuth': {
          // Too complex for chat — fall back to designer panel
          const paramSetNames = metadata.connectionParameterSets?.values?.map((v) => v.uiDefinition?.displayName ?? v.name) ?? [];
          return {
            success: false,
            message: `This connector supports multiple authentication types (${paramSetNames.join(', ')}). Please use the designer to configure the connection.`,
          };
        }
      }
    } else {
      // Metadata fetch failed — try legacy OAuth path as fallback
      const createResult = await createAndAuthManagedApiConnection(projectPath, referenceName, connectorId, azureContext);
      if (createResult.success) {
        return createResult;
      }
      console.log(`[chat-tools] Inline OAuth fallback failed: ${createResult.message}`);
    }
  }

  return { success: false, message: 'Could not resolve connection automatically.' };
}

/**
 * Result of creating a service provider connection
 */
interface ServiceProviderConnectionResult {
  /** Whether the connection was successfully created */
  success: boolean;
  /** Whether the connection already existed (no prompt needed) */
  alreadyExists?: boolean;
  /** Error message if creation failed */
  error?: string;
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
  connectorDisplayName: string
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

  if (azureContext?.subscriptionId) {
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
        // Show quick pick for resource selection
        const items = resources.map((r) => ({
          label: r.name,
          description: r.location,
          detail: r.id,
          resource: r,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Select a ${connectorDisplayName} resource`,
          title: `Connect to ${connectorDisplayName}`,
          ignoreFocusOut: true,
        });

        if (selected) {
          // Fetch connection string from selected resource
          connectionString = await getConnectionStringForResource(
            selected.resource.id,
            selected.resource.type,
            azureContext.tenantId,
            azureContext.managementBaseUrl
          );

          if (connectionString) {
            console.log(`[chat-tools] Retrieved connection string from ${selected.resource.name}`);
          } else {
            // Show error if we couldn't get the connection string
            vscode.window.showWarningMessage(
              `Could not retrieve connection string from ${selected.resource.name}. You may need to configure it manually in the designer.`
            );
            return { success: false, error: 'Could not retrieve connection string from selected resource' };
          }
        } else {
          // User cancelled the picker
          return { success: false, error: 'Resource selection was cancelled' };
        }
      } else {
        // No resources found - let user know
        const message = `No ${connectorDisplayName} resources found in your subscription. Would you like to enter a connection string manually?`;
        const manualEntry = await vscode.window.showInformationMessage(message, 'Enter manually', 'Cancel');
        if (manualEntry !== 'Enter manually') {
          return { success: false, error: 'No resources found and manual entry declined' };
        }
        // Fall through to manual entry below
      }
    }
  }

  // If we don't have a connection string yet (no Azure context, unsupported resource type, or empty resource list),
  // fall back to manual entry
  if (!connectionString) {
    connectionString = await vscode.window.showInputBox({
      prompt: `Enter the connection string for ${connectorDisplayName}`,
      placeHolder: 'e.g., Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...',
      ignoreFocusOut: true,
      password: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Connection string cannot be empty';
        }
        return undefined;
      },
    });

    if (connectionString === undefined) {
      return { success: false, error: 'Connection string input was cancelled' };
    }
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

  return { success: true };
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
  configuration?: Record<string, unknown>
): Promise<{ action?: Record<string, unknown>; completionSuffix?: string; error?: string } | undefined> {
  if (!projectConnections.projectPath) {
    return undefined;
  }
  const baseUrl = getDesignTimeBaseUrl(projectConnections.projectPath);
  if (!baseUrl) {
    console.log('[chat-tools] Design time runtime not available for built-in connector discovery');
    return undefined;
  }

  const connectors = await listBuiltInConnectors(baseUrl);
  const matched = matchBuiltInConnector(connectorHint, connectors);
  if (!matched) {
    return undefined;
  }

  console.log(`[chat-tools] Matched built-in connector: ${matched.name} (${matched.id})`);

  const operations = await listBuiltInConnectorOperations(baseUrl, matched.name);
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
        connectorDisplayName
      );
      if (result.success) {
        if (result.alreadyExists) {
          connectionNote = '';
        } else {
          connectionNote = ` Created connection for "${connectionName}" with the provided connection string.`;
        }
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
export function buildSeattleWeatherConnectorAction(referenceName: string): Record<string, unknown> {
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
    runAfter: {},
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
    const accessToken = await getAuthorizationToken(projectConnections.workflowTenantId);
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
    // Try to resolve the connection automatically (reuse existing or create + OAuth)
    let connectionNote = '';
    try {
      const resolution = await tryResolveManagedApiConnection(projectConnections.projectPath, effectiveReference, resolvedConnectorId);
      if (resolution.success) {
        connectionNote = ` ${resolution.message}`;
      } else {
        // Fall back to placeholder
        await addPlaceholderManagedApiConnection(projectConnections.projectPath, effectiveReference, resolvedConnectorId);
        connectionNote = ` Added placeholder connection for "${effectiveReference}" in connections.json. Open designer to authenticate.`;
      }
    } catch (error) {
      console.error(`[chat-tools] Failed to resolve managed API connection: ${error instanceof Error ? error.message : String(error)}`);
      // Fall back to placeholder on unexpected errors
      try {
        await addPlaceholderManagedApiConnection(projectConnections.projectPath, effectiveReference, resolvedConnectorId);
        connectionNote = ` Added placeholder connection for "${effectiveReference}" in connections.json. Open designer to authenticate.`;
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
    const { name } = options.input;

    try {
      // Validate workflow name
      if (!name || !isValidWorkflowName(name)) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Invalid workflow name "${name}". Workflow name must start with a letter and can only contain letters, digits, "_" and "-".`
          ),
        ]);
      }

      // Get workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('No workspace folder found. Please open a Logic App workspace first.'),
        ]);
      }

      // Execute the create workflow command - this opens the workflow creation wizard
      await vscode.commands.executeCommand(extensionCommand.createWorkflow);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Opened the workflow creation wizard. Please enter "${name}" as the workflow name and complete the wizard to create your workflow.`
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
          const builtInResult = await resolveBuiltInServiceProviderAction(actionName, connectorHint, projectConnections, configuration);
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
                `Successfully added action "${actionName}" of type "${operationTypeName}" to workflow "${workflowName}". Open the designer to configure additional settings.${completionSuffix}`
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
          configuration,
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
          if (!projectConnections.weatherManagedReference) {
            const refsHint =
              projectConnections.managedApiReferences.length > 0
                ? ` Available managed connection references: ${projectConnections.managedApiReferences.join(', ')}.`
                : ' No managed connection references found in connections.json.';

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `Weather action requested but no weather managed API connection was found in connections.json.${refsHint}`
              ),
            ]);
          }

          nodeToWrite = buildSeattleWeatherConnectorAction(projectConnections.weatherManagedReference);
          operationTypeName = 'ApiConnection';
          completionSuffix = ` Used connector reference "${projectConnections.weatherManagedReference}" from connections.json for a Logic Apps weather action.`;
        } else {
          if (normalizedType === 'apiconnection') {
            const validationError = validateApiConnectionConfiguration(extractActionInputs(configuration));
            if (validationError) {
              const refs = projectConnections.managedApiReferences;
              const refsHint =
                refs.length > 0
                  ? ` Available managed connection references: ${refs.join(', ')}.`
                  : ' No managed connection references found in connections.json.';

              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`${validationError}${refsHint}`)]);
            }

            const referenceValidationError = validateApiConnectionReferenceExists(
              extractActionInputs(configuration),
              projectConnections.managedApiReferencesWithApiId
            );
            if (referenceValidationError) {
              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(referenceValidationError)]);
            }
          }

          if (normalizedType === 'serviceprovider') {
            const validationError = validateServiceProviderConfiguration(extractActionInputs(configuration));
            if (validationError) {
              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(validationError)]);
            }
          }

          nodeToWrite = buildActionDefinition(actionType, configuration);
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
            if (!projectConnections.weatherManagedReference) {
              const refsHint =
                projectConnections.managedApiReferences.length > 0
                  ? ` Available managed connection references: ${projectConnections.managedApiReferences.join(', ')}.`
                  : ' No managed connection references found in connections.json.';

              return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                  `Weather action requested but no weather managed API connection was found in connections.json.${refsHint}`
                ),
              ]);
            }

            definition.definition.actions[actionName] = buildSeattleWeatherConnectorAction(projectConnections.weatherManagedReference);
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
