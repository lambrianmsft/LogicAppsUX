/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { isEmptyString, resolveConnectionsReferences } from '@microsoft/logic-apps-shared';
import {
  AzureWizardExecuteStep,
  callWithTelemetryAndErrorHandling,
  DialogResponses,
  type IActionContext,
  UserCancelledError,
} from '@microsoft/vscode-azext-utils';
import type { ConnectionsData } from '@microsoft/vscode-extension-logic-apps';
import { getBaseGraphApi, OpenBehavior, DeploymentTargetType } from '@microsoft/vscode-extension-logic-apps';
import { getConnectionsJson } from '../../../../utils/codeless/connection';
import { areAllConnectionsParameterized, validateConnectionAuthenticationParameters } from '../../../../utils/codeless/parameterizer';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ext } from '../../../../../extensionVariables';
import { localize } from '../../../../../localize';
import { parameterizeProjectConnections } from '../../../parameterizeConnections';
import { FileManagement } from '../../iacGestureHelperFunctions';
import { deploymentDirectory, managementApiPrefix, workflowFileName } from '../../../../../constants';
import { unzipLogicAppArtifacts } from '../../../../utils/taskUtils';
import { startDesignTimeApi } from '../../../../utils/codeless/startDesignTimeApi';
import { getAuthorizationToken, getCloudHost } from '../../../../utils/codeless/getAuthorizationToken';
import type { IAzureDeploymentScriptsContext } from '../../generateDeploymentScripts';
import {
  isNativeInfrastructureFormat,
  publishNativeExport,
  validateNativeExport,
  getRuntimeUrlSettingName,
  setBicepPipelineConnections,
  validateBicepSourceNames,
  type BicepPipelineConnection,
  type InfrastructureFormat,
  type NativeExportFile,
} from '../../nativeInfrastructureExport';
import { getLocalSettingsJson } from '../../../../utils/appSettings/localSettings';
import { getParametersJson } from '../../../../utils/codeless/parameter';

interface DeploymentConnection {
  reference: string;
  subscriptionId: string;
  resourceGroup: string;
  connectionId: string;
  runtimeUrlSettingName: string | null;
}

export class GenerateADODeploymentScriptsStep extends AzureWizardExecuteStep<IAzureDeploymentScriptsContext> {
  public priority = 250;

  /**
   * Determines whether this step should be executed based on the user's input.
   * @returns {boolean} - A boolean value indicating whether this step should be executed.
   */
  public shouldExecute(): boolean {
    return true;
  }

  /**
   * Executes the step to generate deployment scripts for Azure DevOps Pipeline.
   * @param {IAzureDeploymentScriptsContext} context - The Azure deployment scripts context.
   * @returns {Promise<void>} - A Promise that resolves when the scripts are generated.
   */
  public async execute(context: IAzureDeploymentScriptsContext): Promise<void> {
    context.telemetry.properties.lastStep = 'GenerateADODeploymentScriptsStep';
    const format = context.infrastructureFormat;
    const nativeFormat = isNativeInfrastructureFormat(format) ? format : undefined;
    if (nativeFormat) {
      if (context.deploymentTarget === DeploymentTargetType.hybrid) {
        throw new Error('Native infrastructure export supports Standard / App Service only, not Hybrid.');
      }
      await GenerateADODeploymentScriptsStep.confirmNativeExport(nativeFormat);
      context.telemetry.properties.lastStep = 'resolveNativeConnections';
    } else {
      const deploymentFolderPath = path.join(context.workspacePath, deploymentDirectory);
      if (!fs.existsSync(deploymentFolderPath)) {
        fs.mkdirSync(deploymentFolderPath);
      }
      context.deploymentFolderPath = deploymentFolderPath;
      context.workspacePath = (context.workspaceFolder && context.workspaceFolder.uri.fsPath) || context.workspacePath;
      if (context.workspaceFolder) {
        context.openBehavior = OpenBehavior.alreadyOpen;
      }
      context.telemetry.properties.lastStep = 'getConnectionsJson';
    }

    const connectionsJson = await getConnectionsJson(context.projectPath);
    const connectionsData: ConnectionsData = isEmptyString(connectionsJson) ? {} : JSON.parse(connectionsJson);
    const workflowFiles = nativeFormat ? [] : await GenerateADODeploymentScriptsStep.prepareLegacyProject(context, connectionsData);
    if (!nativeFormat) {
      context.telemetry.properties.lastStep = 'generateManagedConnectionsDeploymentArtifacts';
      ext.outputChannel.appendLog(localize('initCallConsumption', 'Initiating call to Consumption API for deployment artifacts.'));
      ext.outputChannel.appendLog(
        localize(
          'operationalContext',
          'Operational context: Tenant ID: {0}, Subscription ID: {1}, Resource Group: {2}, Logic App: {3}',
          context.tenantId,
          context.subscriptionId,
          context.resourceGroup.name,
          context.logicAppName
        )
      );
      ext.outputChannel.appendLog(localize('fetchingManagedConnections', 'Fetching managed connections...'));
    }
    const references = await GenerateADODeploymentScriptsStep.getConnectionReferences(context, connectionsData);
    if (nativeFormat && references.length > 100) {
      throw new Error('Native infrastructure export supports at most 100 managed connections per export.');
    }
    if (nativeFormat === 'Bicep') {
      validateBicepSourceNames(
        context.logicAppName,
        references.map((connection) => connection.connectionId)
      );
    }

    const scope = { subscriptionId: context.subscriptionId, resourceGroupName: context.resourceGroup.name };
    const files: NativeExportFile[] = [];
    const pipelineConnections: BicepPipelineConnection[] = [];
    let totalBytes = 0;
    // Preserve legacy child-first generation and native host validation before cloud export.
    const stages = nativeFormat ? (['host', 'connections'] as const) : (['connections', 'host'] as const);
    for (const stage of stages) {
      if (stage === 'host') {
        if (context.deploymentTarget === DeploymentTargetType.hybrid) {
          context.telemetry.properties.lastStep = 'generateHybridDeploymentArtifacts';
          await GenerateADODeploymentScriptsStep.generateHybridDeploymentArtifacts(context);
          context.telemetry.properties.lastStep = 'transformConnectionTemplatesForHybrid';
          const hybridInfraFolder = path.join(context.deploymentFolderPath, context.logicAppName, 'infrastructure');
          GenerateADODeploymentScriptsStep.transformConnectionTemplatesForHybrid(hybridInfraFolder);
          ext.outputChannel.appendLog(localize('hybridArtifactsGenerated', 'Hybrid deployment artifacts generated successfully.'));
        } else {
          context.telemetry.properties.lastStep = nativeFormat ? 'getNativeHostArtifacts' : 'getLogicAppDeploymentArtifactsBuffer';
          const buffer = await GenerateADODeploymentScriptsStep.getLogicAppDeploymentArtifactsBuffer(context);
          if (nativeFormat) {
            files.push(...validateNativeExport(buffer, nativeFormat, context.logicAppName, scope));
            totalBytes = files.reduce((total, file) => total + file.content.length, 0);
          } else {
            if (!buffer) {
              throw new Error('Failed getting Logic App deployment artifacts. No content received from the standard resources API.');
            }
            await unzipLogicAppArtifacts(buffer, context.deploymentFolderPath);
            ext.outputChannel.appendLog(
              localize('logicAppDeploymentArtifactsUnzipped', 'Logic app deployment artifacts successfully unzipped.')
            );
          }
        }
      } else {
        for (const connection of references) {
          if (nativeFormat) {
            context.telemetry.properties.lastStep = 'getNativeConnectionArtifacts';
          } else {
            ext.outputChannel.appendLog(
              localize(
                'startRetrieveConnectionDeploymentArtifacts',
                'Retrieving deployment artifacts for managed connection "{0}".',
                connection.reference
              )
            );
          }
          const buffer = await GenerateADODeploymentScriptsStep.getManagedConnectionDeploymentArtifactsBuffer(
            context.tenantId,
            connection.subscriptionId,
            connection.resourceGroup,
            context.logicAppName,
            connection.reference,
            connection.connectionId,
            nativeFormat
          );
          if (nativeFormat) {
            const module = validateNativeExport(
              buffer,
              nativeFormat,
              context.logicAppName,
              scope,
              connection.reference,
              connection.connectionId
            );
            totalBytes += module.reduce((total, file) => total + file.content.length, 0);
            if (totalBytes > 20 * 1024 * 1024) {
              throw new Error('Native infrastructure export exceeds the 20 MiB size limit.');
            }
            files.push(...module);
            pipelineConnections.push({
              connectionReferenceName: connection.reference,
              runtimeUrlSettingName: connection.runtimeUrlSettingName,
            });
          } else {
            if (!buffer) {
              vscode.window.showErrorMessage(
                localize(
                  'failedRetrieveConnectionDeploymentArtifacts',
                  'Failed to retrieve deployment artifacts for managed connection "{0}".',
                  connection.reference
                )
              );
              continue;
            }
            ext.outputChannel.appendLog(
              localize(
                'startUnzipConnectionDeploymentArtifacts',
                'Unzipping artifacts for managed connection "{0}" at "{1}".',
                connection.reference,
                context.deploymentFolderPath
              )
            );
            await unzipLogicAppArtifacts(buffer, context.deploymentFolderPath);
          }
        }
      }
    }

    if (nativeFormat) {
      if (nativeFormat === 'Bicep') {
        setBicepPipelineConnections(files, pipelineConnections);
      }
      context.telemetry.properties.lastStep = 'publishNativeInfrastructure';
      context.deploymentFolderPath = publishNativeExport(files, path.join(context.workspacePath, deploymentDirectory), nativeFormat);
    }
    ext.outputChannel.appendLog(GenerateADODeploymentScriptsStep.getExportSuccessMessage(context));
    if (!nativeFormat) {
      if (context.isValidWorkspace) {
        context.telemetry.properties.lastStep = 'addFolderToWorkspace';
        FileManagement.addFolderToWorkspace(context.deploymentFolderPath);
      } else {
        context.telemetry.properties.lastStep = 'convertToValidWorkspace';
        FileManagement.convertToValidWorkspace(context.deploymentFolderPath);
      }
      const correlationId = uuidv4();
      const currentDateTime = new Date().toISOString();
      context.telemetry.properties.lastStep = 'updateMetadata';
      workflowFiles.forEach((filePath) =>
        GenerateADODeploymentScriptsStep.updateMetadata(filePath, context.projectPath, correlationId, currentDateTime)
      );
    }
  }

  private static async confirmNativeExport(format: 'Bicep' | 'Terraform'): Promise<void> {
    const warning =
      format === 'Bicep'
        ? localize(
            'bicepPipelineCredentialWarning',
            'Export an Azure DevOps Bicep infrastructure deployment pipeline? This requires matching backend support and AzureLogicAppsStandardConnectionsDeployment@1 installed in Azure DevOps. The existing @0 task remains available for legacy pipelines but does not satisfy this native export contract. Selected values describe the initial export, not a fixed deployment environment. Configure subscriptionId, resourceGroupName, logicAppName, resourceGroupLocation, hostingPlanName and storageAccountName as pipeline variables; missing values block deployment rather than falling back to exported values. The workspace follows the existing ARM convention in the deployment subscription unless explicitly overridden; no workspace is discovered or created. No application source or CI/CD package is included, and no deployment will run now. Review the service connection, target connection inputs/authentication, additional host settings and runtime URL setting mappings before running it; unresolved mappings block pipeline preflight. Opaque authentication/resource IDs and environment-specific settings are not automatically retargeted. Exported input files may contain plaintext credentials. Pipeline and secure parameter typing do not encrypt files or guarantee authenticated connectors. Protect exported files and do not commit credentials.'
          )
        : localize(
            'nativeExportCredentialWarning',
            'Export infrastructure only? No pipeline, workflows or application package will be generated. The workspace follows the existing ARM convention in the deployment subscription unless explicitly overridden; no workspace is discovered or created. Connection input files may contain plaintext credentials; secure/sensitive typing does not encrypt them. Terraform state can also contain secrets. Protect exported files and state and do not commit credentials.'
          );
    const proceed = localize('exportNativeInfrastructure', 'Export infrastructure');
    if ((await vscode.window.showWarningMessage(warning, { modal: true }, proceed)) !== proceed) {
      throw new UserCancelledError();
    }
  }

  private static getExportSuccessMessage(context: IAzureDeploymentScriptsContext): string {
    const format = context.infrastructureFormat;
    if (!isNativeInfrastructureFormat(format)) {
      return localize(
        'scriptGenSuccess',
        'Deployment script generation completed successfully. The scripts were added at "{0}". Warning: One or more workflows in your logic app may contain user-based authentication for managed connectors. You are required to manually authenticate the connection from the Azure portal after the resource is deployed by the DevOps pipeline.',
        context.deploymentFolderPath
      );
    }
    return format === 'Bicep'
      ? localize(
          'bicepInfrastructurePipelineExported',
          'Bicep Azure DevOps infrastructure pipeline and connection modules exported to "{0}". The pipeline requires matching backend support and AzureLogicAppsStandardConnectionsDeployment@1 installed in Azure DevOps; the existing @0 task remains available for legacy pipelines but is insufficient for this native export contract. Host infrastructure and connections deploy through one task invocation with internal cleanup and no exported PowerShell helper. No deployment was run and no application source/CI/CD package is included. Configure serviceConnectionName and infrastructureDirectory for the export location, then define subscriptionId, resourceGroupName, logicAppName, resourceGroupLocation, hostingPlanName and storageAccountName in the pipeline UI or variable groups. These variables are required deployment targets, not fallbacks to initial exported values; the export directory remains unchanged when targeting another app. The workspace follows the existing ARM convention in the deployment subscription unless explicitly overridden; no workspace variable is required and no workspace is discovered or created. Review connection names/authentication, additional host settings and pipeline-settings.json runtime URL setting keys. Opaque authentication/resource IDs and environment-specific settings are not automatically retargeted. Null mappings must be resolved explicitly before pipeline preflight can pass; connector authentication is not guaranteed. Workflow metadata, source connections and workflow parameters were not rewritten. Input files may contain plaintext credentials; pipeline/secure typing is not encryption.',
          context.deploymentFolderPath
        )
      : localize(
          'nativeInfrastructureExported',
          '{0} infrastructure-only modules exported to "{1}". No deployment, pipeline or application package was created; workflow metadata, source connections and workflow parameters were not rewritten. Review requiredInputs in each descriptor, provide connection identity/authentication inputs, and publish runtime URLs under the exact setting names consumed by your app. Terraform connections are child modules for one application root, not independent states. Input files may contain plaintext credentials; protect files and Terraform state.',
          format,
          context.deploymentFolderPath
        );
  }

  private static async prepareLegacyProject(context: IAzureDeploymentScriptsContext, connectionsData: ConnectionsData): Promise<string[]> {
    validateConnectionAuthenticationParameters(connectionsData, await getParametersJson(context.projectPath));
    context.telemetry.properties.lastStep = 'areAllConnectionsParameterized';
    const isParameterized = await areAllConnectionsParameterized(connectionsData);

    context.telemetry.properties.lastStep = 'getWorkflowFilePaths';
    const workflowFiles = GenerateADODeploymentScriptsStep.getWorkflowFilePaths(context.projectPath);

    if (!isParameterized) {
      context.telemetry.properties.lastStep = 'parameterizeConnectionsPrompt';
      const parameterizeConnectionsPrompt = localize(
        'parameterizeInDeploymentScripts',
        'Allow parameterization for connections? Declining cancels generation for deployment scripts.'
      );
      const shouldParameterizeConnections = await vscode.window.showInformationMessage(
        parameterizeConnectionsPrompt,
        { modal: true },
        DialogResponses.yes,
        DialogResponses.no
      );
      if (shouldParameterizeConnections === DialogResponses.yes) {
        context.telemetry.properties.lastStep = 'parameterizeConnections';
        await callWithTelemetryAndErrorHandling(
          'GenerateADODeploymentScriptsStep.parameterizeProjectConnections',
          async (actionContext: IActionContext) => {
            actionContext.errorHandling.rethrow = true;
            actionContext.errorHandling.suppressDisplay = true;
            await parameterizeProjectConnections(actionContext);
          }
        );
        context.telemetry.properties.parameterizeConnectionsInDeploymentScripts = 'true';
      } else {
        context.telemetry.properties.parameterizeConnectionsInDeploymentScripts = 'false';
        throw new UserCancelledError('User declined to parameterize connections in deployment scripts.');
      }
    }

    return workflowFiles;
  }

  private static getWorkflowFilePaths(source: string): string[] {
    return fs
      .readdirSync(source)
      .filter((name) => {
        const dirPath = path.join(source, name);
        if (fs.statSync(dirPath).isDirectory()) {
          const files = fs.readdirSync(dirPath);
          return files.length === 1 && files[0] === workflowFileName;
        }
        return false;
      })
      .map((name) => path.join(source, name, workflowFileName));
  }

  private static updateMetadata(filePath: string, projectPath: string, correlationId: string, currentDateTime: string): void {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Normalize the metadata key to lowercase
    const metadataKey = Object.keys(data.definition).find((key) => key.toLowerCase() === 'metadata');
    if (metadataKey && metadataKey !== 'metadata') {
      data.definition.metadata = data.definition[metadataKey];
      delete data.definition[metadataKey];
    }

    const iacMetadata = {
      IaCGenerationDate: currentDateTime,
      IaCWorkflowCorrelationId: correlationId,
      LogicAppsExtensionVersion: ext.extensionVersion,
      LogicAppsPinnedBundle: ext.pinnedBundleVersion.has(projectPath) ? ext.pinnedBundleVersion.get(projectPath) : false,
      LogicAppsCurrentBundleVersion: ext.currentBundleVersion.has(projectPath)
        ? ext.currentBundleVersion.get(projectPath)
        : ext.defaultBundleVersion,
    };

    if (data.definition.metadata) {
      data.definition.metadata.IaCMetadata = {
        ...data.definition.metadata.IaCMetadata,
        ...iacMetadata,
      };
    } else {
      data.definition.metadata = { IaCMetadata: iacMetadata };
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private static async getConnectionReferences(
    context: IAzureDeploymentScriptsContext,
    connectionsData: ConnectionsData
  ): Promise<DeploymentConnection[]> {
    const nativeFormat = isNativeInfrastructureFormat(context.infrastructureFormat);
    // ARM rereads after parameterization; native discovery never rewrites source files.
    const data: ConnectionsData = nativeFormat ? connectionsData : JSON.parse((await getConnectionsJson(context.projectPath)) || '{}');
    const nativeInputs = nativeFormat
      ? { parameters: await getParametersJson(context.projectPath), settings: await getLocalSettingsJson(context, context.projectPath) }
      : undefined;
    return Object.entries(data.managedApiConnections ?? {}).map(([reference, connection]) => {
      if (!nativeInputs) {
        const idPath = connection.connection.id;
        return {
          reference,
          subscriptionId: context.subscriptionId,
          resourceGroup: context.resourceGroup.name,
          connectionId: idPath.substring(idPath.lastIndexOf('/') + 1),
          runtimeUrlSettingName: null,
        };
      }
      const sourceConnection =
        typeof connection === 'object' && connection !== null && 'connection' in connection ? connection.connection : undefined;
      const sourceId =
        typeof sourceConnection === 'object' && sourceConnection !== null && 'id' in sourceConnection ? sourceConnection.id : undefined;
      const id: unknown = resolveConnectionsReferences(
        JSON.stringify({ id: sourceId }),
        nativeInputs.parameters,
        nativeInputs.settings.Values
      )?.id;
      const match =
        typeof id === 'string' &&
        /^\/subscriptions\/([^/\s@{}?#]+)\/resourceGroups\/([^/\s@{}?#]+)\/providers\/Microsoft\.Web\/connections\/([^/\s@{}?#]+)$/i.exec(
          id
        );
      if (!match) {
        throw new Error(
          localize(
            'unresolvedNativeConnection',
            'Cannot resolve the resource ID for connection reference "{0}". Supply its workflow parameter/app-setting values locally before exporting. Source files have not been changed.',
            reference
          )
        );
      }
      const runtimeUrl =
        typeof connection === 'object' && connection !== null && 'connectionRuntimeUrl' in connection
          ? connection.connectionRuntimeUrl
          : undefined;
      return {
        reference,
        subscriptionId: match[1],
        resourceGroup: match[2],
        connectionId: match[3],
        runtimeUrlSettingName: getRuntimeUrlSettingName(runtimeUrl, nativeInputs.parameters),
      };
    });
  }

  private static nativeExportRequestError(error: unknown, format: InfrastructureFormat, boundary: 'host' | 'connection'): unknown {
    if (!axios.isAxiosError(error)) {
      return error;
    }
    const response = error.response;
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      return error;
    }
    const status = response.status;
    const code = GenerateADODeploymentScriptsStep.nativeExportResponseCode(response.data);
    const source = boundary === 'host' ? 'local design-time host' : 'cloud managed-connection export service';
    const route =
      boundary === 'host'
        ? 'POST /runtime/webhooks/workflow/api/management/generateDeploymentArtifacts'
        : 'POST /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/connections/{connectionName}/generateDeploymentArtifacts';
    const guidance =
      boundary === 'host'
        ? 'Check the running design-time host logs for the server-side failure.'
        : 'Check the managed-connection export service diagnostics. Changing the local bundle does not update this cloud service.';
    return new Error(
      localize(
        'nativeExportHttpFailure',
        '{0} infrastructure export failed at the {1} (HTTP {2}; {3}{4}). {5} Response messages, bodies and request credentials are not included.',
        format,
        source,
        status,
        route,
        code ? `; code ${code}` : '',
        guidance
      )
    );
  }

  private static nativeExportResponseCode(data: unknown): string | undefined {
    let response: unknown = data;
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer || typeof data === 'string') {
      if ((typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength) > 16 * 1024) {
        return undefined;
      }
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
      try {
        response = JSON.parse(text);
      } catch {
        // A non-JSON error body must not obscure the HTTP status or be displayed.
        return undefined;
      }
    }
    if (
      typeof response !== 'object' ||
      response === null ||
      !('error' in response) ||
      typeof response.error !== 'object' ||
      response.error === null ||
      !('code' in response.error)
    ) {
      return undefined;
    }
    const code = response.error.code;
    return typeof code === 'string' &&
      [
        'LogicAppTargetDeploymentArtifactsInputInvalid',
        'InvalidRequestContent',
        'MissingIaCFile',
        'InvalidApiConnectionDeploymentArtifactsGenerationRequest',
        'WorkflowParametersInvalidExpression',
      ].includes(code)
      ? code
      : undefined;
  }

  /**
   * Calls the consumption Managed Connections API to retrieve deployment artifacts for a given Logic App.
   * @param tenantId - The Azure tenant ID.
   * @param subscriptionId - The Azure subscription ID.
   * @param resourceGroup - The Azure resource group name.
   * @param logicAppName - The name of the Logic App.
   * @param managedConnection - The reference name for the managed connection template generation.
   * @param connectionId - The parameter for connection ID endpoint deployed in portal.
   * @returns A Buffer containing the API response.
   */
  private static async getManagedConnectionDeploymentArtifactsBuffer(
    tenantId: string,
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    connectionName: string,
    connectionId: string,
    infrastructureFormat?: InfrastructureFormat
  ): Promise<Buffer> {
    try {
      const apiVersion = '2018-07-01-preview';
      const accessToken = await getAuthorizationToken(tenantId);
      const cloudHost = await getCloudHost();
      const baseGraphUri = getBaseGraphApi(cloudHost);

      const segment = (value: string) => (isNativeInfrastructureFormat(infrastructureFormat) ? encodeURIComponent(value) : value);
      const apiUrl = `${baseGraphUri}/subscriptions/${segment(subscriptionId)}/resourceGroups/${segment(resourceGroup)}/providers/Microsoft.Web/connections/${segment(connectionId)}/generateDeploymentArtifacts?api-version=${apiVersion}`;
      const requestBody = {
        TargetLogicAppName: logicAppName,
        ConnectionReferenceName: connectionName,
        ...(isNativeInfrastructureFormat(infrastructureFormat) ? { InfrastructureFormat: infrastructureFormat } : {}),
      };

      const response = await axios
        .post(apiUrl, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `${accessToken}`,
          },
          responseType: 'arraybuffer',
          ...(isNativeInfrastructureFormat(infrastructureFormat) ? { maxContentLength: 5 * 1024 * 1024 } : {}),
        })
        .catch((error: unknown) => {
          throw isNativeInfrastructureFormat(infrastructureFormat)
            ? GenerateADODeploymentScriptsStep.nativeExportRequestError(error, infrastructureFormat, 'connection')
            : error;
        });
      if (isNativeInfrastructureFormat(infrastructureFormat) && !response?.data) {
        throw new Error(
          'No native infrastructure export content received from the managed-connection export service. Update the service to a version supporting native export and retry.'
        );
      }

      const buffer = Buffer.from(response.data, 'binary');
      ext.outputChannel.appendLog(
        localize('successfulManagedConnection', `Successfully retrieved deployment artifacts for managed connection "${connectionName}".`)
      );
      return buffer;
    } catch (error) {
      if (isNativeInfrastructureFormat(infrastructureFormat)) {
        throw error;
      }
      const responseData = JSON.parse(new TextDecoder().decode(error.response.data));
      const { message = '', code = '' } = responseData?.error ?? {};
      throw new Error(`Error getting deployment artifacts for managed connection "${connectionName}": ${code} - ${message}`);
    }
  }

  /**
   * Gets deployment artifacts for the Logic App using standard resources API.
   * @param {IAzureDeploymentScriptsContext} context - The Azure deployment scripts context.
   * @returns {Promise<Buffer>} - A Promise that resolves to a Buffer containing the Logic App deployment artifacts.
   */
  private static async getLogicAppDeploymentArtifactsBuffer(context: IAzureDeploymentScriptsContext): Promise<Buffer> {
    try {
      ext.outputChannel.appendLog(localize('initApiWorkflowDesignerPort', 'Initiating API connection through workflow designer port...'));

      await callWithTelemetryAndErrorHandling(
        'GenerateADODeploymentScriptsStep.getLogicAppDeploymentArtifactsBuffer.startDesignTimeApi',
        async (actionContext: IActionContext) => {
          if (isNativeInfrastructureFormat(context.infrastructureFormat)) {
            actionContext.errorHandling.rethrow = true;
            actionContext.errorHandling.suppressDisplay = true;
          }
          await startDesignTimeApi(actionContext, context.projectPath);
        }
      );

      if (!ext.designTimeInstances.has(context.projectPath)) {
        throw new Error('Design time API is undefined. Please retry once Azure Functions Core Tools has started.');
      }

      const designTimeInst = ext.designTimeInstances.get(context.projectPath);
      if (designTimeInst.port === undefined) {
        throw new Error('Design time port is undefined. Please retry once Azure Functions Core Tools has started.');
      }

      const apiUrl = `http://localhost:${designTimeInst.port}${managementApiPrefix}/generateDeploymentArtifacts`;

      ext.outputChannel.appendLog(
        localize(
          'operationalContext',
          `Operational context: Subscription ID: ${context.subscriptionId}, Resource Group: ${context.resourceGroup.name}, Logic App: ${context.logicAppName}`
        )
      );

      const deploymentArtifactsInput = {
        targetSubscriptionName: context.subscriptionId,
        targetResourceGroupName: context.resourceGroup.name,
        targetStorageAccountName: context.storageAccountName,
        targetLocation: context.resourceGroup.location,
        targetLogicAppName: context.logicAppName,
        targetAppServicePlanName: context.appServicePlan,
        ...(isNativeInfrastructureFormat(context.infrastructureFormat) ? { infrastructureFormat: context.infrastructureFormat } : {}),
      };

      const response = await axios
        .post(apiUrl, deploymentArtifactsInput, {
          headers: {
            Accept: 'application/zip',
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          ...(isNativeInfrastructureFormat(context.infrastructureFormat) ? { maxContentLength: 5 * 1024 * 1024 } : {}),
        })
        .catch((error: unknown) => {
          throw isNativeInfrastructureFormat(context.infrastructureFormat)
            ? GenerateADODeploymentScriptsStep.nativeExportRequestError(error, context.infrastructureFormat, 'host')
            : error;
        });
      if (isNativeInfrastructureFormat(context.infrastructureFormat) && !response?.data) {
        throw new Error(
          'No native infrastructure export content received from the local design-time host. Update the host to a version supporting native export and retry.'
        );
      }
      return Buffer.from(response.data, 'binary');
    } catch (error) {
      if (isNativeInfrastructureFormat(context.infrastructureFormat)) {
        throw error;
      }
      const responseData = JSON.parse(new TextDecoder().decode(error.response.data));
      const { message = '', code = '' } = responseData?.error ?? {};
      throw new Error(`Error getting deployment artifacts for Logic App: ${code} - ${message}`);
    }
  }

  // Generates all Hybrid deployment artifacts: ARM infrastructure templates + pipeline YAML.
  // Hybrid Logic Apps are Microsoft.App/containerApps (kind: workflowapp), NOT Microsoft.Web/sites.
  // Three ARM resources: containerApp, logicApp (scoped on containerApp), connectedEnvironments/storages (SMB).
  // Secrets (AAD creds, SQL connection string, SMB password) must be supplied via ADO secret variables.
  private static async generateHybridDeploymentArtifacts(context: IAzureDeploymentScriptsContext): Promise<void> {
    // Place artifacts under deployment/<logicAppName>/ to match the Standard IaC API structure.
    const logicAppFolder = path.join(context.deploymentFolderPath, context.logicAppName);
    const infraFolder = path.join(logicAppFolder, 'infrastructure');
    const pipelinesFolder = path.join(logicAppFolder, 'pipelines');

    if (!fs.existsSync(infraFolder)) {
      fs.mkdirSync(infraFolder, { recursive: true });
    }
    if (!fs.existsSync(pipelinesFolder)) {
      fs.mkdirSync(pipelinesFolder, { recursive: true });
    }

    // --- Workflow parameters ---
    // The Build task requires workflowparameters/parameters.json when deploymentFolder is set.
    // Copy the app's parameters.json so the build task can overlay deployment-specific values.
    const workflowParamsFolder = path.join(logicAppFolder, 'workflowparameters');
    if (!fs.existsSync(workflowParamsFolder)) {
      fs.mkdirSync(workflowParamsFolder, { recursive: true });
    }
    const sourceParametersFile = path.join(context.workspacePath, 'parameters.json');
    const destParametersFile = path.join(workflowParamsFolder, 'parameters.json');
    if (fs.existsSync(sourceParametersFile)) {
      fs.copyFileSync(sourceParametersFile, destParametersFile);
    } else {
      fs.writeFileSync(destParametersFile, JSON.stringify({}, null, 2));
    }

    // --- ARM template ---
    const armTemplate = GenerateADODeploymentScriptsStep.generateHybridArmTemplate();
    fs.writeFileSync(path.join(infraFolder, 'hybrid-logicapp-template.json'), JSON.stringify(armTemplate, null, 2));

    // --- ARM parameters ---
    const armParameters = GenerateADODeploymentScriptsStep.generateHybridArmParameters(context);
    fs.writeFileSync(path.join(infraFolder, 'hybrid-logicapp-parameters.json'), JSON.stringify(armParameters, null, 2));

    // --- Pipeline YAML ---
    GenerateADODeploymentScriptsStep.generateHybridPipelineTemplates(context, pipelinesFolder);
  }

  // ARM template for Hybrid Logic Apps — 3 resources matching Azure Portal deployment:
  // 1. Microsoft.App/containerApps (kind: workflowapp) — the Container App hosting the logic app
  // 2. Microsoft.App/logicApps — the logic app scoped on the container app
  // 3. Microsoft.App/connectedEnvironments/storages — SMB file share for artifacts
  private static generateHybridArmTemplate(): Record<string, unknown> {
    return {
      $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
      contentVersion: '1.0.0.0',
      parameters: {
        subscriptionId: { type: 'string' },
        logicAppName: { type: 'string' },
        location: { type: 'string' },
        connectedEnvironmentName: { type: 'string' },
        connectedEnvironmentResourceGroup: { type: 'string' },
        customLocationId: {
          type: 'string',
          metadata: { description: 'Resource ID of the custom location tied to the connected environment' },
        },
        sqlConnectionString: { type: 'securestring' },
        fileShareHostName: { type: 'string' },
        fileSharePath: { type: 'string' },
        fileShareUsername: { type: 'string' },
        fileSharePassword: { type: 'securestring' },
        aadClientId: { type: 'string' },
        aadClientSecret: { type: 'securestring' },
        aadObjectId: { type: 'string' },
        aadTenantId: { type: 'string' },
      },
      variables: {
        connectedEnvironmentId:
          "[resourceId(parameters('connectedEnvironmentResourceGroup'), 'Microsoft.App/connectedEnvironments', parameters('connectedEnvironmentName'))]",
        storageShareName: "[concat(parameters('logicAppName'), '-fs')]",
      },
      resources: [
        {
          type: 'Microsoft.Resources/deployments',
          apiVersion: '2021-04-01',
          name: 'PersistentStorageTemplate',
          resourceGroup: "[parameters('connectedEnvironmentResourceGroup')]",
          subscriptionId: "[parameters('subscriptionId')]",
          properties: {
            mode: 'Incremental',
            expressionEvaluationOptions: {
              scope: 'outer',
            },
            template: {
              $schema: 'https://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#',
              contentVersion: '1.0.0.0',
              resources: [
                {
                  apiVersion: '2024-02-02-preview',
                  name: "[concat(parameters('connectedEnvironmentName'), '/', variables('storageShareName'))]",
                  type: 'Microsoft.App/connectedEnvironments/storages',
                  properties: {
                    smb: {
                      accessMode: 'ReadWrite',
                      host: "[parameters('fileShareHostName')]",
                      shareName: "[parameters('fileSharePath')]",
                      username: "[parameters('fileShareUsername')]",
                      password: "[parameters('fileSharePassword')]",
                    },
                  },
                },
              ],
            },
          },
        },
        {
          type: 'Microsoft.App/containerApps',
          apiVersion: '2024-02-02-preview',
          name: "[parameters('logicAppName')]",
          kind: 'workflowapp',
          location: "[parameters('location')]",
          extendedLocation: {
            name: "[parameters('customLocationId')]",
            type: 'CustomLocation',
          },
          dependsOn: ['Microsoft.Resources/deployments/PersistentStorageTemplate'],
          properties: {
            environmentId: "[variables('connectedEnvironmentId')]",
            configuration: {
              activeRevisionsMode: 'Single',
              secrets: [
                { name: 'sql-connection-string', value: "[parameters('sqlConnectionString')]" },
                { name: 'aad-client-secret', value: "[parameters('aadClientSecret')]" },
              ],
              ingress: {
                external: true,
                targetPort: 80,
                allowInsecure: false,
              },
            },
            template: {
              containers: [
                {
                  name: "[parameters('logicAppName')]",
                  image: 'mcr.microsoft.com/azurelogicapps/logicapps-base:latest',
                  resources: { cpu: 1.0, memory: '2Gi' },
                  env: [
                    { name: 'APP_KIND', value: 'workflowapp' },
                    { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' },
                    {
                      name: 'AzureFunctionsJobHost__extensionBundle__id',
                      value: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
                    },
                    { name: 'AzureWebJobsSecretStorageType', value: 'files' },
                    { name: 'IS_ZIP_DEPLOY_ENABLED', value: 'true' },
                    { name: 'Workflows.Sql.ConnectionString', secretRef: 'sql-connection-string' },
                    { name: 'WORKFLOWAPP_AAD_CLIENTID', value: "[parameters('aadClientId')]" },
                    { name: 'WORKFLOWAPP_AAD_CLIENTSECRET', secretRef: 'aad-client-secret' },
                    { name: 'WORKFLOWAPP_AAD_OBJECTID', value: "[parameters('aadObjectId')]" },
                    { name: 'WORKFLOWAPP_AAD_TENANTID', value: "[parameters('aadTenantId')]" },
                  ],
                  volumeMounts: [{ volumeName: 'fileshare', mountPath: '/home/site/wwwroot' }],
                },
              ],
              scale: { minReplicas: 1, maxReplicas: 30 },
              volumes: [
                {
                  name: 'fileshare',
                  storageType: 'Smb',
                  storageName: "[variables('storageShareName')]",
                },
              ],
            },
          },
        },
        {
          type: 'Microsoft.App/logicApps',
          apiVersion: '2024-02-02-preview',
          name: "[parameters('logicAppName')]",
          scope: "[concat('Microsoft.App/containerApps/', parameters('logicAppName'))]",
          dependsOn: ["[concat('Microsoft.App/containerApps/', parameters('logicAppName'))]"],
          properties: {},
        },
      ],
    };
  }

  // Post-process managed connection templates for Hybrid deployments.
  // The Consumption API generates access policies referencing Microsoft.Web/Sites to resolve managed identity,
  // but Hybrid Logic Apps are Container Apps — replace with explicit AAD parameters.
  private static transformConnectionTemplatesForHybrid(infraFolder: string): void {
    if (!fs.existsSync(infraFolder)) {
      return;
    }

    const templateFiles = fs.readdirSync(infraFolder).filter((f) => f.endsWith('.template.json') && f !== 'hybrid-logicapp-template.json');

    for (const file of templateFiles) {
      const filePath = path.join(infraFolder, file);
      const template = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Add aadObjectId and aadTenantId parameters to the template
      if (template.parameters) {
        if (!template.parameters.aadObjectId) {
          template.parameters.aadObjectId = { type: 'String' };
        }
        if (!template.parameters.aadTenantId) {
          template.parameters.aadTenantId = { type: 'String' };
        }
      }

      // Walk resources and fix access policy identity references
      GenerateADODeploymentScriptsStep.fixAccessPolicyIdentityForHybrid(template.resources || []);

      fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8');
    }

    // Also update corresponding parameter files
    const paramFiles = fs.readdirSync(infraFolder).filter((f) => f.endsWith('.parameters.json') && f !== 'hybrid-logicapp-parameters.json');

    for (const file of paramFiles) {
      const filePath = path.join(infraFolder, file);
      const params = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (params.parameters) {
        if (!params.parameters.aadObjectId) {
          params.parameters.aadObjectId = { value: '' };
        }
        if (!params.parameters.aadTenantId) {
          params.parameters.aadTenantId = { value: '' };
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(params, null, 2), 'utf-8');
    }
  }

  // Recursively walk ARM template resources and replace Microsoft.Web/Sites identity references
  // in accessPolicies with explicit AAD parameter references for Hybrid.
  private static fixAccessPolicyIdentityForHybrid(resources: any[]): void {
    for (const resource of resources) {
      if (resource.type === 'accessPolicies' && resource.properties?.principal?.identity) {
        const identity = resource.properties.principal.identity;
        if (typeof identity.objectId === 'string' && identity.objectId.toLowerCase().includes('microsoft.web/sites')) {
          identity.objectId = "[parameters('aadObjectId')]";
        }
        if (typeof identity.tenantId === 'string' && identity.tenantId.toLowerCase().includes('microsoft.web/sites')) {
          identity.tenantId = "[parameters('aadTenantId')]";
        }
      }
      // Recurse into nested resources
      if (resource.resources) {
        GenerateADODeploymentScriptsStep.fixAccessPolicyIdentityForHybrid(resource.resources);
      }
    }
  }

  // ARM parameters file — secrets are excluded and must be supplied via ADO pipeline secret variables
  // using overrideParameters in the CD pipeline's ARM deployment task.
  private static generateHybridArmParameters(context: IAzureDeploymentScriptsContext): Record<string, unknown> {
    return {
      $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
      contentVersion: '1.0.0.0',
      parameters: {
        subscriptionId: { value: context.subscriptionId || '<your-subscription-id>' },
        logicAppName: { value: context.logicAppName },
        location: { value: context.resourceGroup?.location || '' },
        connectedEnvironmentName: { value: context.connectedEnvironmentName || '' },
        connectedEnvironmentResourceGroup: { value: context.connectedEnvironmentResourceGroup || '' },
        customLocationId: { value: '<your-custom-location-resource-id>' },
        fileShareHostName: { value: '<your-smb-host>' },
        fileSharePath: { value: '<your-smb-share-name>' },
        fileShareUsername: { value: '<your-smb-username>' },
        aadClientId: { value: '<your-aad-client-id>' },
        aadObjectId: { value: '<your-aad-object-id>' },
        aadTenantId: { value: '<your-aad-tenant-id>' },
        // DO NOT add secrets here — supply via ADO pipeline secret variables:
        // sqlConnectionString, fileSharePassword, aadClientSecret
      },
    };
  }

  // Generates Hybrid CI/CD pipeline YAML and variable files.
  // CI: HybridBuild task (copy, transform auth, archive).
  // CD: ARM deployment (infrastructure) → ConnectionsDeployment → HybridRelease.
  private static generateHybridPipelineTemplates(context: IAzureDeploymentScriptsContext, pipelinesFolder: string): void {
    // CI pipeline — HybridBuild copies files, transforms MSI→AAD OAuth auth, and archives.
    const ciPipelineContent = `trigger:
- main

pr: none

pool:
  vmImage: 'ubuntu-latest'

variables:
- template: CI-pipeline-variables.yml

jobs:
- job: logic_app_build
  displayName: 'Build and publish Hybrid Logic App'
  steps:
  - task: AzureLogicAppsHybridBuild@0
    displayName: 'Azure Logic Apps Hybrid Build'
    inputs:
      sourceFolder: '${'$'}(Build.SourcesDirectory)/${'$'}(sourceFolderName)'
      deploymentFolder: '${'$'}(System.DefaultWorkingDirectory)/deployment/${'$'}(logicAppName)/'
      archiveFile: '${'$'}(Build.ArtifactStagingDirectory)/${'$'}(Build.BuildId).zip'

  - task: PublishPipelineArtifact@1
    displayName: 'Publish logic app zip artifact'
    inputs:
      targetPath: '${'$'}(Build.ArtifactStagingDirectory)/${'$'}(Build.BuildId).zip'
      artifact: '${'$'}(logicAppCIArtifactName)'
      publishLocation: 'pipeline'

  - task: PublishPipelineArtifact@1
    displayName: 'Publish infrastructure artifacts'
    inputs:
      targetPath: '${'$'}(Build.SourcesDirectory)/deployment/${'$'}(logicAppName)/infrastructure'
      artifact: 'infrastructure'
      publishLocation: 'pipeline'
`;

    fs.writeFileSync(path.join(pipelinesFolder, 'CI-pipeline.yml'), ciPipelineContent);

    // CD pipeline — ARM deploy infrastructure → ConnectionsDeployment → HybridRelease.
    const cdPipelineContent = `trigger: none

pr: none

pool:
  vmImage: 'ubuntu-latest'

variables:
- template: CD-pipeline-variables.yml

resources:
  pipelines:
  - pipeline: cipipeline
    # TODO: Update with the name of your CI pipeline
    source: CI Pipeline
    trigger:
      branches:
      - main

jobs:
- deployment: deploy_hybrid_logicapp
  displayName: Deploy Hybrid Logic App
  environment: ${'$'}(logicAppEnvironment)
  strategy:
    runOnce:
      deploy:
        steps:
        - task: AzureResourceManagerTemplateDeployment@3
          displayName: 'Deploy Hybrid Logic App Infrastructure'
          inputs:
            deploymentScope: 'Resource Group'
            azureResourceManagerConnection: '${'$'}(azureServiceConnection)'
            subscriptionId: '${'$'}(subscriptionId)'
            action: 'Create Or Update Resource Group'
            resourceGroupName: '${'$'}(resourceGroupName)'
            location: '${'$'}(location)'
            templateLocation: 'Linked artifact'
            csmFile: '${'$'}(Pipeline.Workspace)/cipipeline/infrastructure/hybrid-logicapp-template.json'
            csmParametersFile: '${'$'}(Pipeline.Workspace)/cipipeline/infrastructure/hybrid-logicapp-parameters.json'
            overrideParameters: >-
              -sqlConnectionString "${'$'}(sqlConnectionString)"
              -fileSharePassword "${'$'}(fileSharePassword)"
              -aadClientSecret "${'$'}(aadClientSecret)"
            deploymentMode: 'Incremental'

        - task: AzureLogicAppsHybridConnectionsDeployment@0
          displayName: 'Deploy Managed Connections'
          condition: eq(variables['deployConnections'], 'true')
          inputs:
            connectedServiceName: '${'$'}(azureServiceConnection)'
            subscriptionId: '${'$'}(subscriptionId)'
            resourceGroupName: '${'$'}(resourceGroupName)'
            location: '${'$'}(location)'
            sourcePackagePath: '${'$'}(Pipeline.Workspace)/cipipeline/${'$'}(logicAppCIArtifactName)/${'$'}(resources.pipeline.cipipeline.runID).zip'
            outputPackagePath: '${'$'}(Pipeline.Workspace)/cipipeline/${'$'}(logicAppCIArtifactName)/${'$'}(resources.pipeline.cipipeline.runID)-transformed.zip'
            armTemplatePath: '${'$'}(Pipeline.Workspace)/cipipeline/infrastructure'
            deployConnections: true

        - script: |
            transformedZip="${'$'}(Pipeline.Workspace)/cipipeline/${'$'}(logicAppCIArtifactName)/${'$'}(resources.pipeline.cipipeline.runID)-transformed.zip"
            originalZip="${'$'}(Pipeline.Workspace)/cipipeline/${'$'}(logicAppCIArtifactName)/${'$'}(resources.pipeline.cipipeline.runID).zip"
            if [ -f "$transformedZip" ]; then
              echo "##vso[task.setvariable variable=deployPackagePath]$transformedZip"
            else
              echo "##vso[task.setvariable variable=deployPackagePath]$originalZip"
            fi
          displayName: 'Resolve deploy package path'

        - task: AzureLogicAppsHybridRelease@0
          displayName: 'Azure Logic Apps Hybrid Release'
          inputs:
            connectedServiceName: '${'$'}(azureServiceConnection)'
            hybridConnectionName: '${'$'}(hybridServiceConnection)'
            containerAppName: '${'$'}(containerAppName)'
            resourceGroupName: '${'$'}(resourceGroupName)'
            package: '${'$'}(deployPackagePath)'
`;

    fs.writeFileSync(path.join(pipelinesFolder, 'CD-pipeline.yml'), cdPipelineContent);

    // CD variables — includes all inputs for ARM deploy, ConnectionsDeployment, and HybridRelease.
    // Secrets (sqlConnectionString, fileSharePassword, aadClientSecret) should be set as ADO secret variables.
    const cdVariablesContent = `variables:
  azureServiceConnection: '<your-azure-service-connection>'
  hybridServiceConnection: '<your-hybrid-service-connection>'
  subscriptionId: '<your-subscription-id>'
  containerAppName: '${context.logicAppName}'
  resourceGroupName: '${context.resourceGroup?.name || '<your-resource-group>'}'
  location: '${context.resourceGroup?.location || '<your-location>'}'
  logicAppCIArtifactName: 'logic-app-artifact'
  logicAppEnvironment: 'production'
  # Set to 'true' to deploy managed connections via ARM templates
  deployConnections: 'false'
  # Secrets — set these as pipeline secret variables in ADO (Variables button in pipeline editor)
  # Do NOT define them here — YAML variables override pipeline variables
  # Required secrets: sqlConnectionString, fileSharePassword, aadClientSecret
`;

    fs.writeFileSync(path.join(pipelinesFolder, 'CD-pipeline-variables.yml'), cdVariablesContent);

    // CI variables
    // sourceFolderName is the local project folder in the repo (host.json, workflows). It can differ from
    // logicAppName, which is the deployed Logic App (Container App) name entered in the wizard.
    const ciVariablesContent = `variables:
  logicAppName: '${context.logicAppName}'
  sourceFolderName: '${path.basename(context.projectPath)}'
  logicAppCIArtifactName: 'logic-app-artifact'
`;

    fs.writeFileSync(path.join(pipelinesFolder, 'CI-pipeline-variables.yml'), ciVariablesContent);
  }
}
