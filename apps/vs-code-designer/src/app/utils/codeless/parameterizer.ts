import {
  workflowLocationKey,
  workflowSubscriptionIdKey,
  workflowResourceGroupNameKey,
  customConnectorResourceGroupNameKey,
} from '../../../constants';
import {
  isEmptyString,
  ExpressionParser,
  isTemplateExpression,
  isFunction,
  isStringInterpolation,
  isStringLiteral,
  type Expression,
} from '@microsoft/logic-apps-shared';
import type {
  ConnectionReferenceModel,
  ServiceProviderConnectionModel,
  FunctionConnectionModel,
  APIManagementConnectionModel,
  Parameter,
  ConnectionsData,
} from '@microsoft/vscode-extension-logic-apps';

const DELIMITER = '/';
const SUBSCRIPTION_INDEX = 2;

/**
 * Managed API Connection Constants
 */
const MANAGED_API_LOCATION_INDEX = 6;
const MANAGED_CONNECTION_RESOURCE_GROUP_INDEX = 4;
const MANAGED_CONNECTION_CUSTOM_CONNECTOR_RESOURCE_GROUP = 4;

/**
 * Function Connection Constants
 */
const FUNCTION_RESOURCE_GROUP_INDEX = 4;
const FUNCTION_SITE_NAME_INDEX = 8;

/**
 * API Management Connection Constants
 */
const API_MANAGEMENT_RESOURCE_GROUP_INDEX = 4;
const API_MANAGEMENT_SERVICE_NAME_INDEX = 8;

/**
 * Parameterizes connection
 * @param connection The connection reference to parameterize.
 * @param referenceKey The reference key of the connection.
 * @param parametersObject The parameters object.
 * @param settingsRecord The settings record.
 * @returns parameterized connection reference
 */
export function parameterizeConnection(
  connection: ConnectionReferenceModel | ServiceProviderConnectionModel | FunctionConnectionModel | APIManagementConnectionModel,
  referenceKey: string,
  parametersObject: any,
  settingsRecord: Record<string, string>
): ConnectionReferenceModel | ServiceProviderConnectionModel | FunctionConnectionModel | APIManagementConnectionModel {
  if (isConnectionReferenceModel(connection)) {
    connection = getParameterizedConnectionReferenceModel(connection, referenceKey, parametersObject, settingsRecord);
  } else if (isFunctionConnectionModel(connection)) {
    connection = getParameterizedFunctionConnectionModel(connection, referenceKey, parametersObject);
  } else if (isAPIManagementConnectionModel(connection)) {
    connection = getParameterizedAPIManagementConnectionModel(connection, referenceKey, parametersObject);
  } else if (isServiceProviderConnectionModel(connection)) {
    /* no-op */
  } else {
    console.error('parameterizer: connection is not supported.');
  }

  return connection;
}

/**
 * Checks if all connections are parameterized.
 * @param {ConnectionsData} connectionsData - The connections data object.
 * @returns A boolean indicating whether all connections are parameterized or not.
 */
export function areAllConnectionsParameterized(connectionsData: ConnectionsData): boolean {
  if (!connectionsData || Object.keys(connectionsData).length === 0) {
    return true;
  }

  for (const connectionType in connectionsData) {
    if (connectionType === 'serviceProviderConnections') {
      continue;
    }
    const hasSettingRef = (value: string) => /@\{?\s*appsetting\s*\(/i.test(value);
    const hasParameterRef = (value: string) => /@\{?\s*parameters\s*\(/i.test(value);

    const connectionTypeJson = connectionsData[connectionType];
    for (const connectionKey in connectionTypeJson) {
      const connection = connectionTypeJson[connectionKey];
      if (isConnectionReferenceModel(connection)) {
        if (!hasSettingRef(connection.api.id)) {
          if (!hasParameterRef(connection.connectionRuntimeUrl) && !hasSettingRef(connection.connectionRuntimeUrl)) {
            return false;
          }
        }
      } else if (isFunctionConnectionModel(connection)) {
        if (!hasParameterRef(connection.function.id)) {
          if (!hasParameterRef(connection.triggerUrl)) {
            return false;
          }
        }
      } else if (isAPIManagementConnectionModel(connection)) {
        if (!hasParameterRef(connection.apiId)) {
          if (!hasParameterRef(connection.baseUrl)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

function getExistingParameterReference(value: unknown): string | undefined {
  return getExistingReference(value, 'parameters');
}

function getExistingReference(value: unknown, functionName: 'parameters' | 'appsetting'): string | undefined {
  if (typeof value !== 'string' || !/^@\{?\s*(?:parameters|appsetting)\s*\(/i.test(value)) {
    return undefined;
  }
  let expression: Expression;
  try {
    expression = ExpressionParser.parseTemplateExpression(value);
  } catch {
    throw new Error(
      'Invalid connection parameter reference. Correct its expression in connections.json before parameterizing connections.'
    );
  }
  if (isStringInterpolation(expression) && expression.segments.length === 1) {
    expression = expression.segments[0];
  }
  return isFunction(expression) &&
    expression.name.toLowerCase() === functionName &&
    expression.arguments.length === 1 &&
    isStringLiteral(expression.arguments[0]) &&
    expression.dereferences.length === 0
    ? expression.arguments[0].value
    : undefined;
}

export { getExistingReference as getConnectionExpressionReference };

function hasInvalidRuntimeExpression(value: unknown): boolean {
  if (typeof value === 'string') {
    if (!isTemplateExpression(value)) {
      return false;
    }
    let expression: Expression;
    try {
      expression = ExpressionParser.parseTemplateExpression(value);
    } catch {
      // Report a sanitized recovery error rather than exposing parser input or retaining invalid syntax.
      return true;
    }
    const allowed = (node: Expression): boolean => {
      if (isFunction(node)) {
        return (
          node.name.toLowerCase() === 'appsetting' &&
          node.arguments.length === 1 &&
          isStringLiteral(node.arguments[0]) &&
          node.dereferences.length === 0
        );
      }
      return isStringInterpolation(node) ? node.segments.every(allowed) : true;
    };
    return !allowed(expression);
  }
  return typeof value === 'object' && value !== null && Object.values(value).some(hasInvalidRuntimeExpression);
}

export function validateConnectionAuthenticationParameters(connectionsData: ConnectionsData, parameters: Record<string, Parameter>): void {
  for (const connection of Object.values(connectionsData.managedApiConnections ?? {})) {
    const name = getExistingParameterReference(connection.authentication);
    if (name !== undefined) {
      validateAuthenticationParameter(name, parameters);
    }
  }
}

function validateAuthenticationParameter(name: string, parameters: Record<string, Parameter>): void {
  const parameter = parameters[name];
  if (
    !Object.hasOwn(parameters, name) ||
    !parameter ||
    !Object.hasOwn(parameter, 'value') ||
    hasInvalidRuntimeExpression(parameter.value)
  ) {
    throw new Error(
      `Cannot parameterize authentication: parameter "${name}" in parameters.json is missing or contains an invalid runtime expression. Runtime parameter values allow only @appsetting lookups, not @parameters. Restore its original authentication value from source control or a known-good backup before generating deployment artifacts. Authentication values cannot be reconstructed from the connection name.`
    );
  }
}

/**
 * Parameterize Managed API connection.
 * @param connection The connection.
 * @param referenceKey The connection reference key.
 * @param parametersObject The parameters object.
 * @param settingsRecord The settings record.
 * @returns Parameterized Managed API connection.
 */
function getParameterizedConnectionReferenceModel(
  connection: ConnectionReferenceModel,
  referenceKey: string,
  parametersObject: any,
  settingsRecord: Record<string, string>
): ConnectionReferenceModel {
  const authenticationReference = getExistingParameterReference(connection.authentication);
  if (authenticationReference !== undefined) {
    validateAuthenticationParameter(authenticationReference, parametersObject);
  } else {
    validateAuthenticationParameter(getPropertyName('Authentication', referenceKey), {
      [getPropertyName('Authentication', referenceKey)]: getParameter('Object', connection.authentication),
    });
  }
  parameterizeManagedApiId(connection, settingsRecord);
  parameterizeManagedConnectionId(connection);
  parameterizeManagedConnectionRuntimeUrl(connection, referenceKey, parametersObject, settingsRecord);
  parameterizeManagedConnectionAuthentication(connection, referenceKey, parametersObject);
  return connection;
}

/**
 * Parameterize Function connection.
 * @param connection The connection.
 * @param referenceKey The connection reference key.
 * @param parametersObject The parameters object.
 * @returns Parameterized Function connection.
 */
function getParameterizedFunctionConnectionModel(
  connection: FunctionConnectionModel,
  referenceKey: string,
  parametersObject: any
): FunctionConnectionModel {
  parameterizeFunctionId(connection, referenceKey, parametersObject);
  parameterizeFunctionTriggerUrl(connection, referenceKey, parametersObject);

  return connection;
}

/**
 * Parameterize API Management connection.
 * @param connection The connection.
 * @param referenceKey The connection reference key.
 * @param parametersObject The parameters object.
 * @returns Parameterized API Management connection.
 */
function getParameterizedAPIManagementConnectionModel(
  connection: APIManagementConnectionModel,
  referenceKey: string,
  parametersObject: any
): APIManagementConnectionModel {
  parameterizeApiManagementApiId(connection, referenceKey, parametersObject);
  parameterizeApiManagementBaseUrl(connection, referenceKey, parametersObject);

  return connection;
}

function parameterizeManagedApiId(connection: ConnectionReferenceModel, settingsRecord: Record<string, string>): void {
  if (getExistingParameterReference(connection.api.id) !== undefined || /^@\{?\s*appsetting\s*\(/i.test(connection.api.id)) {
    return;
  }
  const segments = connection.api.id.split(DELIMITER);
  const isCustomConnector = connection.api.id.includes('customApis');

  segments[SUBSCRIPTION_INDEX] = getAppSettingReference(workflowSubscriptionIdKey, true);

  if (isCustomConnector) {
    const resourceGroup = segments[MANAGED_CONNECTION_CUSTOM_CONNECTOR_RESOURCE_GROUP];
    if (!/@\{?\s*(?:appsetting|parameters)\s*\(/i.test(resourceGroup)) {
      settingsRecord[customConnectorResourceGroupNameKey] = resourceGroup;
    }
    segments[MANAGED_CONNECTION_CUSTOM_CONNECTOR_RESOURCE_GROUP] = getAppSettingReference(customConnectorResourceGroupNameKey, true);
  } else {
    segments[MANAGED_API_LOCATION_INDEX] = getAppSettingReference(workflowLocationKey, true);
  }

  connection.api.id = segments.join(DELIMITER);
}

function parameterizeManagedConnectionId(connection: ConnectionReferenceModel): void {
  if (getExistingParameterReference(connection.connection.id) !== undefined || /^@\{?\s*appsetting\s*\(/i.test(connection.connection.id)) {
    return;
  }
  const segments = connection.connection.id.split(DELIMITER);
  segments[SUBSCRIPTION_INDEX] = getAppSettingReference(workflowSubscriptionIdKey, true);
  segments[MANAGED_CONNECTION_RESOURCE_GROUP_INDEX] = getAppSettingReference(workflowResourceGroupNameKey, true);
  connection.connection.id = segments.join(DELIMITER);
}

function parameterizeManagedConnectionRuntimeUrl(
  connection: ConnectionReferenceModel,
  referenceKey: string,
  parametersObject: any,
  settingsRecord: Record<string, string>
): void {
  if (isEmptyString(connection.connectionRuntimeUrl)) {
    return;
  }
  if (
    getExistingParameterReference(connection.connectionRuntimeUrl) !== undefined ||
    getExistingReference(connection.connectionRuntimeUrl, 'appsetting') !== undefined
  ) {
    return;
  }

  const propertyName = getPropertyName('ConnectionRuntimeUrl', referenceKey);
  settingsRecord[propertyName] = connection.connectionRuntimeUrl;
  const appSettingReference = getAppSettingReference(propertyName, false);
  connection.connectionRuntimeUrl = getParameterizedProperty(propertyName, appSettingReference, 'String', parametersObject);
}

function parameterizeManagedConnectionAuthentication(
  connection: ConnectionReferenceModel,
  referenceKey: string,
  parametersObject: any
): void {
  const propertyName = getPropertyName('Authentication', referenceKey);
  const existingReference = getExistingParameterReference(connection.authentication);
  if (existingReference !== undefined) {
    return;
  }
  connection.authentication = getParameterizedProperty(propertyName, connection.authentication, 'Object', parametersObject);
}

function parameterizeFunctionId(connection: FunctionConnectionModel, referenceKey: string, parametersObject: any): void {
  const segments = connection.function.id.split(DELIMITER);
  segments[SUBSCRIPTION_INDEX] = getAppSettingReference(workflowSubscriptionIdKey, true);

  setParameterizedPropertyForSegment(
    segments,
    FUNCTION_RESOURCE_GROUP_INDEX,
    referenceKey,
    'ResourceGroup',
    'String',
    parametersObject,
    true
  );
  setParameterizedPropertyForSegment(segments, FUNCTION_SITE_NAME_INDEX, referenceKey, 'SiteName', 'String', parametersObject, true);

  connection.function.id = segments.join(DELIMITER);
}

function parameterizeApiManagementApiId(connection: APIManagementConnectionModel, referenceKey: string, parametersObject: any): void {
  const segments = connection.apiId.split(DELIMITER);
  segments[SUBSCRIPTION_INDEX] = getAppSettingReference(workflowSubscriptionIdKey, true);

  setParameterizedPropertyForSegment(
    segments,
    API_MANAGEMENT_RESOURCE_GROUP_INDEX,
    referenceKey,
    'ResourceGroup',
    'String',
    parametersObject,
    true
  );
  setParameterizedPropertyForSegment(
    segments,
    API_MANAGEMENT_SERVICE_NAME_INDEX,
    referenceKey,
    'ServiceName',
    'String',
    parametersObject,
    true
  );

  connection.apiId = segments.join(DELIMITER);
}

function parameterizeFunctionTriggerUrl(connection: FunctionConnectionModel, referenceKey: string, parametersObject: any): void {
  const propertyName = getPropertyName('TriggerUrl', referenceKey);
  connection.triggerUrl = getParameterizedProperty(propertyName, connection.triggerUrl, 'String', parametersObject);
}

function parameterizeApiManagementBaseUrl(connection: APIManagementConnectionModel, referenceKey: string, parametersObject: any): void {
  const propertyName = getPropertyName('BaseUrl', referenceKey);
  connection.baseUrl = getParameterizedProperty(propertyName, connection.baseUrl, 'String', parametersObject);
}

function getPropertyName(name: string, key: string): string {
  return `${key}-${name}`;
}

function getParameterizedProperty(name: string, value: any, type: string, parametersObject: any, interpolated = false): any {
  if (getExistingParameterReference(value) !== undefined) {
    return value;
  }
  parametersObject[name] = getParameter(type, value);
  return getParameterReference(name, interpolated);
}

function setParameterizedPropertyForSegment(
  segments: string[],
  segmentIndex: number,
  referenceKey: string,
  propertyName: string,
  type: string,
  parametersObject: any,
  interpolated = false
): void {
  const sitePropertyName = getPropertyName(propertyName, referenceKey);
  const parameterizedProperty = getParameterizedProperty(sitePropertyName, segments[segmentIndex], type, parametersObject, interpolated);

  segments[segmentIndex] = parameterizedProperty;
}

/**
 * Gets the app setting reference @appsetting('name')
 * @param name The name of the app setting
 * @param interpolated The flag for interpolated string, add brackets.
 */
function getAppSettingReference(name: string, interpolated = false): string {
  return `@${interpolated ? '{' : ''}appsetting('${name}')${interpolated ? '}' : ''}`;
}

/**
 * Gets the parameter reference @parameter('name')
 * @param name The name of the parameter
 * @param interpolated The flag for interpolated string, add brackets.
 */
function getParameterReference(name: string, interpolated = false): string {
  return `@${interpolated ? '{' : ''}parameters('${name}')${interpolated ? '}' : ''}`;
}

function isConnectionReferenceModel(
  connection: ConnectionReferenceModel | ServiceProviderConnectionModel | FunctionConnectionModel | APIManagementConnectionModel
): connection is ConnectionReferenceModel {
  return 'connection' in connection;
}

function isServiceProviderConnectionModel(
  connection: ConnectionReferenceModel | ServiceProviderConnectionModel | FunctionConnectionModel | APIManagementConnectionModel
): connection is ServiceProviderConnectionModel {
  return 'serviceProvider' in connection;
}

function isFunctionConnectionModel(
  connection: ConnectionReferenceModel | ServiceProviderConnectionModel | FunctionConnectionModel | APIManagementConnectionModel
): connection is FunctionConnectionModel {
  return 'function' in connection;
}

function isAPIManagementConnectionModel(
  connection: ConnectionReferenceModel | ServiceProviderConnectionModel | FunctionConnectionModel | APIManagementConnectionModel
): connection is APIManagementConnectionModel {
  return 'apiId' in connection;
}

function getParameter(type: string, value: any): Parameter {
  return {
    type: type,
    value: value,
  };
}
