import {
  appKindSetting,
  azureWebJobsStorageKey,
  deploySubpathSetting,
  extensionCommand,
  extensionsFileName,
  funcIgnoreFileName,
  functionsInprocNet8Enabled,
  functionsInprocNet8EnabledTrue,
  funcVersionSetting,
  gitignoreFileName,
  hostFileName,
  launchFileName,
  launchVersion,
  localEmulatorConnectionString,
  localSettingsFileName,
  logicAppKind,
  logicAppsStandardExtensionId,
  preDeployTaskSetting,
  ProjectDirectoryPathKey,
  projectLanguageSetting,
  settingsFileName,
  tasksFileName,
  vscodeFolderName,
  workerRuntimeKey,
  workflowFileName,
  type WorkflowType,
} from '../../../../constants';
import { localize } from '../../../../localize';
import { createArtifactsFolder } from '../../../utils/codeless/artifacts';
import { addLocalFuncTelemetry } from '../../../utils/funcCoreTools/funcVersion';
import type { IActionContext } from '@microsoft/vscode-azext-utils';
import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { addDefaultBundle } from '../../../utils/bundleFeed';
import { newGetGitIgnoreContent, gitInit, isGitInstalled, isInsideRepo } from '../../../utils/git';
import { confirmEditJsonFile, writeFormattedJson } from '../../../utils/fs';
import { getCombinedWorkflowTemplate } from '../../../utils/codeless/templates';
import { ext } from '@microsoft/vscode-azext-azureappservice/out/src/extensionVariables';
import { isDebugConfigEqual } from '../../../utils/vsCodeConfig/launch';
import { CreateFunctionAppFiles } from './CreateFunctionAppFiles';
import type {
  IExtensionsJson,
  IFunctionWizardContext,
  IHostJsonV2,
  ILaunchJson,
  ILocalSettingsJson,
  ISettingToAdd,
  IWebviewProjectContext,
  StandardApp,
} from '@microsoft/vscode-extension-logic-apps';
import { ProjectLanguage, latestGAVersion, WorkerRuntime, ProjectType, TargetFramework } from '@microsoft/vscode-extension-logic-apps';
import type { DebugConfiguration } from 'vscode';

export async function createRulesFiles(context: IFunctionWizardContext): Promise<void> {
  if (context.projectType === ProjectType.rulesEngine) {
    // SampleRuleSet.xml
    const sampleRuleSetPath = path.join(__dirname, 'assets', 'RuleSetProjectTemplate', 'SampleRuleSet');
    const sampleRuleSetXMLPath = path.join(context.projectPath, 'Artifacts', 'Rules', 'SampleRuleSet.xml');
    const sampleRuleSetXMLContent = await fse.readFile(sampleRuleSetPath, 'utf-8');
    const sampleRuleSetXMLFileContent = sampleRuleSetXMLContent.replace(/<%= methodName %>/g, context.functionAppName);
    await fse.writeFile(sampleRuleSetXMLPath, sampleRuleSetXMLFileContent);

    // SchemaUser.xsd
    const schemaUserPath = path.join(__dirname, 'assets', 'RuleSetProjectTemplate', 'SchemaUser');
    const schemaUserXSDPath = path.join(context.projectPath, 'Artifacts', 'Schemas', 'SchemaUser.xsd');
    const schemaUserXSDContent = await fse.readFile(schemaUserPath, 'utf-8');
    await fse.writeFile(schemaUserXSDPath, schemaUserXSDContent);
  }
}

export async function createLibFolder(context: IFunctionWizardContext): Promise<void> {
  fse.mkdirSync(path.join(context.projectPath, 'lib', 'builtinOperationSdks', 'JAR'), { recursive: true });
  fse.mkdirSync(path.join(context.projectPath, 'lib', 'builtinOperationSdks', 'net472'), { recursive: true });
}

export async function getHostContent(context: IActionContext): Promise<IHostJsonV2> {
  const hostJson: IHostJsonV2 = {
    version: '2.0',
    logging: {
      applicationInsights: {
        samplingSettings: {
          isEnabled: true,
          excludedTypes: 'Request',
        },
      },
    },
  };

  await addDefaultBundle(context, hostJson);

  return hostJson;
}

export async function writeSettingsJson(
  context: IWebviewProjectContext,
  theseSettings: ISettingToAdd[],
  vscodePath: string
): Promise<void> {
  const settings: ISettingToAdd[] = theseSettings.concat(
    { key: projectLanguageSetting, value: ProjectLanguage.JavaScript },
    { key: funcVersionSetting, value: latestGAVersion },
    // We want the terminal to open after F5, not the debug console because HTTP triggers are printed in the terminal.
    { prefix: 'debug', key: 'internalConsoleOptions', value: 'neverOpen' },
    { prefix: 'azureFunctions', key: 'suppressProject', value: true }
  );

  if (this.preDeployTask) {
    settings.push({ key: preDeployTaskSetting, value: this.preDeployTask });
  }

  // if (context.workspaceFolder) {
  //   // Use Visual Studio Code API to update config if folder is open
  //   for (const setting of settings) {
  //     await updateWorkspaceSetting(setting.key, setting.value, context.workspacePath, setting.prefix);
  //   }
  // } else {
  // otherwise manually edit json
  const settingsJsonPath: string = path.join(vscodePath, settingsFileName);
  await confirmEditJsonFile(context, settingsJsonPath, (data: Record<string, any>): Record<string, any> => {
    for (const setting of settings) {
      const key = `${setting.prefix || ext.prefix}.${setting.key}`;
      data[key] = setting.value;
    }
    return data;
  });
  // }
}

export async function writeExtensionsJson(context: IActionContext, vscodePath: string): Promise<void> {
  const extensionsJsonPath: string = path.join(vscodePath, extensionsFileName);
  await confirmEditJsonFile(context, extensionsJsonPath, (data: IExtensionsJson): Record<string, any> => {
    const recommendations: string[] = [logicAppsStandardExtensionId];
    // de-dupe array
    data.recommendations = recommendations.filter((rec: string, index: number) => recommendations.indexOf(rec) === index);
    return data;
  });
}

export async function writeTasksJson(context: IActionContext, vscodePath: string): Promise<void> {
  const tasksJsonPath: string = path.join(vscodePath, tasksFileName);
  const tasksJsonContent = `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "generateDebugSymbols",
      "command": "\${config:azureLogicAppsStandard.dotnetBinaryPath}",
      "args": [
        "\${input:getDebugSymbolDll}"
      ],
      "type": "process",
      "problemMatcher": "$msCompile"
    },
    {
      "type": "shell",
      "command": "\${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}",
      "args": [
        "host",
        "start"
      ],
      "options": {
        "env": {
          "PATH": "\${config:azureLogicAppsStandard.autoRuntimeDependenciesPath}\\\\NodeJs;\${config:azureLogicAppsStandard.autoRuntimeDependenciesPath}\\\\DotNetSDK;$env:PATH"
        }
      },
      "problemMatcher": "$func-watch",
      "isBackground": true,
      "label": "func: host start",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ],
  "inputs": [
    {
      "id": "getDebugSymbolDll",
      "type": "command",
      "command": "azureLogicAppsStandard.getDebugSymbolDll"
    }
  ]
}`;

  // if (await confirmOverwriteFile(context, tasksJsonPath)) {
  await fse.writeFile(tasksJsonPath, tasksJsonContent);
  // }
}

export function getDebugConfiguration(logicAppName: string, customCodeTargetFramework?: TargetFramework): DebugConfiguration {
  if (customCodeTargetFramework) {
    return {
      name: localize('debugLogicApp', `Run/Debug logic app with local function ${logicAppName}`),
      type: 'logicapp',
      request: 'launch',
      funcRuntime: 'coreclr',
      customCodeRuntime: customCodeTargetFramework === TargetFramework.Net8 ? 'coreclr' : 'clr',
      isCodeless: true,
    };
  }

  return {
    name: localize('attachToNetFunc', `Run/Debug logic app ${logicAppName}`),
    type: 'coreclr',
    request: 'attach',
    processId: `\${command:${extensionCommand.pickProcess}}`,
  };
}

export async function writeLaunchJson(
  context: IActionContext,
  vscodePath: string,
  logicAppName: string,
  customCodeTargetFramework?: TargetFramework
): Promise<void> {
  const newDebugConfig: DebugConfiguration = getDebugConfiguration(logicAppName, customCodeTargetFramework);

  // otherwise manually edit json
  const launchJsonPath: string = path.join(vscodePath, launchFileName);
  await confirmEditJsonFile(context, launchJsonPath, (data: ILaunchJson): ILaunchJson => {
    data.version = launchVersion;
    data.configurations = insertLaunchConfig(data.configurations, newDebugConfig);
    return data;
  });
}

export function insertLaunchConfig(existingConfigs: DebugConfiguration[] | undefined, newConfig: DebugConfiguration): DebugConfiguration[] {
  // tslint:disable-next-line: strict-boolean-expressions
  existingConfigs = existingConfigs || [];
  // Remove configs that match the one we're about to add
  existingConfigs = existingConfigs.filter((l1) => !isDebugConfigEqual(l1, newConfig));
  existingConfigs.push(newConfig);
  return existingConfigs;
}

export async function createLogicAppWorkspace(context: IActionContext, options: any): Promise<void> {
  addLocalFuncTelemetry(context);

  // const language: ProjectLanguage | string = (options.language as ProjectLanguage) || getGlobalSetting(projectLanguageSetting);
  // const version: string = options.version || getGlobalSetting(funcVersionSetting) || (await tryGetLocalFuncVersion()) || latestGAVersion;
  // const projectTemplateKey: string | undefined = getGlobalSetting(projectTemplateKeySetting);
  // // const wizardContext: Partial<IFunctionWizardContext> & IActionContext = Object.assign(context, options, {
  // //   language,
  // //   version: tryParseFuncVersion(version),
  // //   projectTemplateKey,
  // // });

  const myWebviewProjectContext: IWebviewProjectContext = options;
  // export interface IWebviewProjectContext extends IActionContext {
  //   workspaceProjectPath: ITargetDirectory;
  //   workspaceName: string;
  //   logicAppName: string;
  //   logicAppType: string;
  //   projectType: string;
  //   targetFramework: string;
  //   workflowName: string;
  //   workflowType: string;
  // }
  //Create the workspace folder
  const workspaceFolder = path.join(myWebviewProjectContext.workspaceProjectPath.fsPath, myWebviewProjectContext.workspaceName);
  await fse.ensureDir(workspaceFolder);

  // context.workflowProjectType = WorkflowProjectType.Bundle;
  // context.language = ProjectLanguage.JavaScript;

  // Create the workspace .code-workspace file
  // await this.createWorkspaceFile(context);
  const workspaceFilePath = path.join(workspaceFolder, `${myWebviewProjectContext.workspaceName}.code-workspace`);
  const workspaceFolders = [];
  workspaceFolders.push({ name: myWebviewProjectContext.logicAppName, path: `./${myWebviewProjectContext.logicAppName}` });

  // Path to the logic app folder
  const logicAppFolderPath = path.join(workspaceFolder, myWebviewProjectContext.logicAppName);

  // push for functions folder
  if (myWebviewProjectContext.logicAppType !== ProjectType.logicApp) {
    workspaceFolders.push({ name: myWebviewProjectContext.functionName, path: `./${myWebviewProjectContext.functionName}` });
  }

  const workspaceData = {
    folders: workspaceFolders,
  };
  await fse.writeJSON(workspaceFilePath, workspaceData, { spaces: 2 });

  const funcignore: string[] = [
    '__blobstorage__',
    '__queuestorage__',
    '__azurite_db*__.json',
    '.git*',
    vscodeFolderName,
    localSettingsFileName,
    'test',
    '.debug',
    'workflow-designtime/',
  ];
  const localSettingsJson: ILocalSettingsJson = {
    IsEncrypted: false,
    Values: {
      [azureWebJobsStorageKey]: localEmulatorConnectionString,
      [functionsInprocNet8Enabled]: functionsInprocNet8EnabledTrue,
      [workerRuntimeKey]: WorkerRuntime.Dotnet,
      [appKindSetting]: logicAppKind,
    },
  };
  const gitignore = '';

  if (myWebviewProjectContext.logicAppType !== ProjectType.logicApp) {
    // this.projectPath = projectPath;
    funcignore.push('global.json');
    localSettingsJson.Values['AzureWebJobsFeatureFlags'] = 'EnableMultiLanguageWorker';
  }
  // CodeProjectWorkflowStateTypeStep

  //   await this.createSystemArtifacts(context);

  //   const workflowName = nonNullProp(context, 'functionName');

  const mySubContext: IFunctionWizardContext = context as IFunctionWizardContext;
  mySubContext.logicAppName = options.logicAppName;
  mySubContext.projectPath = logicAppFolderPath;
  mySubContext.projectType = myWebviewProjectContext.logicAppType as ProjectType;
  mySubContext.functionAppName = options.functionName;
  mySubContext.functionAppNamespace = options.functionWorkspace;
  mySubContext.targetFramework = options.targetFramework;
  mySubContext.workspacePath = workspaceFolder;

  const codelessDefinition: StandardApp = getCombinedWorkflowTemplate(
    myWebviewProjectContext.functionName,
    myWebviewProjectContext.workflowType as WorkflowType,
    myWebviewProjectContext.logicAppType
  );

  await fse.ensureDir(logicAppFolderPath);
  const logicAppWorkflowFolderPath = path.join(logicAppFolderPath, myWebviewProjectContext.workflowName);
  await fse.ensureDir(logicAppWorkflowFolderPath);

  const workflowJsonFullPath: string = path.join(logicAppWorkflowFolderPath, workflowFileName);

  await writeFormattedJson(workflowJsonFullPath, codelessDefinition);

  // .vscode folder
  const vscodePath: string = path.join(logicAppFolderPath, vscodeFolderName);
  await fse.ensureDir(vscodePath);

  const theseSettings: ISettingToAdd[] = [];

  if (myWebviewProjectContext.logicAppType === ProjectType.logicApp) {
    theseSettings.push({ key: deploySubpathSetting, value: '.' });
  }

  await writeSettingsJson(myWebviewProjectContext, theseSettings, vscodePath);
  await writeExtensionsJson(myWebviewProjectContext, vscodePath);
  await writeTasksJson(myWebviewProjectContext, vscodePath);
  await writeLaunchJson(
    myWebviewProjectContext,
    vscodePath,
    myWebviewProjectContext.logicAppName,
    myWebviewProjectContext.targetFramework as TargetFramework
  );

  // const version: FuncVersion = nonNullProp(context, 'version');
  const hostJsonPath: string = path.join(logicAppFolderPath, hostFileName);
  const hostJson: IHostJsonV2 = await getHostContent(context);
  await writeFormattedJson(hostJsonPath, hostJson);

  const localSettingsJsonPath: string = path.join(logicAppFolderPath, localSettingsFileName);
  localSettingsJson.Values[ProjectDirectoryPathKey] = path.join(logicAppFolderPath);
  localSettingsJson.Values[azureWebJobsStorageKey] = path.join(localEmulatorConnectionString);
  localSettingsJson.Values[functionsInprocNet8Enabled] = path.join(functionsInprocNet8EnabledTrue);
  await writeFormattedJson(localSettingsJsonPath, localSettingsJson);

  const gitignorePath = path.join(logicAppFolderPath, gitignoreFileName);
  await fse.writeFile(gitignorePath, gitignore.concat(newGetGitIgnoreContent()));

  const funcIgnorePath: string = path.join(logicAppFolderPath, funcIgnoreFileName);
  await fse.writeFile(funcIgnorePath, funcignore.sort().join(os.EOL));

  if ((await isGitInstalled(workspaceFolder)) && !(await isInsideRepo(workspaceFolder))) {
    await gitInit(workspaceFolder);
  }

  // OpenFolderStep sometimes restarts the extension host. Adding a second event here to see if we're losing any telemetry
  // await callWithTelemetryAndErrorHandling('azureLogicAppsStandard.createNewProjectStarted', (startedContext: IActionContext) => {
  //   context.telemetry.properties.workflowCodeType = workflowCodeTypeForTelemetry(context.isCodeless);
  //   Object.assign(startedContext, context);
  // });

  await createArtifactsFolder(mySubContext);
  await createRulesFiles(mySubContext);
  await createLibFolder(mySubContext);

  // if (wizardContext.isWorkspaceWithFunctions) {
  //   commands.executeCommand('setContext', extensionCommand.customCodeSetFunctionsFolders, await getAllCustomCodeFunctionsProjects(context));
  // }

  if (myWebviewProjectContext.logicAppType !== ProjectType.logicApp) {
    const createFunctionAppFilesStep = new CreateFunctionAppFiles();
    await createFunctionAppFilesStep.setup(mySubContext);
  }
  vscode.window.showInformationMessage(localize('finishedCreating', 'Finished creating project.'));
}
