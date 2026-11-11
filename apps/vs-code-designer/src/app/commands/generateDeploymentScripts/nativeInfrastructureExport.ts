import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { readBicepParameters } from './bicepParameters';

export type InfrastructureFormat = 'Arm' | 'Bicep' | 'Terraform';
export type NativeInfrastructureFormat = Exclude<InfrastructureFormat, 'Arm'>;
export interface NativeExportFile {
  name: string;
  content: Buffer;
}
export interface BicepPipelineConnection {
  connectionReferenceName: string;
  runtimeUrlSettingName: string | null;
}

const maxArchiveBytes = 5 * 1024 * 1024;
const maxExportBytes = 20 * 1024 * 1024;

export function isNativeInfrastructureFormat(format?: InfrastructureFormat): format is NativeInfrastructureFormat {
  return format === 'Bicep' || format === 'Terraform';
}

export function isWorkspaceResourceId(value: string): boolean {
  return /^\/subscriptions\/[^/\s]+\/resourceGroups\/[^/\s]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/[^/\s]+$/i.test(value);
}

function safePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[<>:"|?*]/.test(part) ||
          [...part].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part)
      )
  ) {
    throw new Error('Unsafe native export path.');
  }
  return normalized;
}

export function validateBicepSourceNames(app: string, connections: string[]): void {
  const names = [app, ...connections];
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.()-]{0,79}$/.test(name) || safePath(name).includes('/')) {
      throw new Error('Bicep export requires Windows-safe source app and connection names. Source files have not been changed.');
    }
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new Error(
      'Bicep export requires unique source app and connection names (case-insensitive) in its flat infrastructure directory. Repeated physical connections across references or scopes are not supported. Source files have not been changed.'
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBicepTaskPipeline(content: Buffer, app: string): boolean {
  const pipeline: unknown = parse(content.toString('utf8'), { maxAliasCount: 0 });
  const sameKeys = (value: Record<string, unknown>, keys: string[]) =>
    Object.keys(value).length === keys.length && keys.every((key) => Object.keys(value).includes(key));
  if (
    !isRecord(pipeline) ||
    !sameKeys(pipeline, ['trigger', 'pr', 'parameters', 'pool', 'steps']) ||
    pipeline.trigger !== 'none' ||
    pipeline.pr !== 'none' ||
    !Array.isArray(pipeline.parameters) ||
    pipeline.parameters.length !== 2 ||
    !pipeline.parameters.every(
      (parameter, index) =>
        isRecord(parameter) &&
        Object.keys(parameter).every((key) => ['name', 'type', 'default', 'displayName'].includes(key)) &&
        (!('displayName' in parameter) || typeof parameter.displayName === 'string') &&
        parameter.name === ['serviceConnectionName', 'infrastructureDirectory'][index] &&
        parameter.type === 'string' &&
        parameter.default === ['', `${app}/infrastructure`][index]
    ) ||
    !isRecord(pipeline.pool) ||
    !sameKeys(pipeline.pool, ['vmImage']) ||
    pipeline.pool.vmImage !== 'ubuntu-latest' ||
    !Array.isArray(pipeline.steps) ||
    pipeline.steps.length !== 2 ||
    !isRecord(pipeline.steps[0]) ||
    !sameKeys(pipeline.steps[0], ['checkout']) ||
    pipeline.steps[0].checkout !== 'self'
  ) {
    return false;
  }
  const step: unknown = pipeline.steps[1];
  if (
    !isRecord(step) ||
    !Object.keys(step).every((key) => ['task', 'displayName', 'inputs'].includes(key)) ||
    ('displayName' in step && typeof step.displayName !== 'string') ||
    step.task !== 'AzureLogicAppsStandardConnectionsDeployment@1' ||
    !isRecord(step.inputs)
  ) {
    return false;
  }
  const expectedInputs: Record<string, string> = {
    connectedServiceName: '${{ parameters.serviceConnectionName }}',
    infrastructureFormat: 'Bicep',
    infrastructureDirectory: '$(Build.SourcesDirectory)/${{ parameters.infrastructureDirectory }}',
    subscriptionId: '$(subscriptionId)',
    resourceGroupName: '$(resourceGroupName)',
    appName: '$(logicAppName)',
    location: '$(resourceGroupLocation)',
    hostingPlanName: '$(hostingPlanName)',
    storageAccountName: '$(storageAccountName)',
  };
  const inputs = step.inputs;
  if ('connectionNames' in inputs) {
    expectedInputs.connectionNames = '$(connectionNames)';
  }
  if ('workspaceResourceId' in inputs) {
    expectedInputs.workspaceResourceId = '$(workspaceResourceId)';
  }
  return sameKeys(inputs, Object.keys(expectedInputs)) && Object.entries(expectedInputs).every(([key, value]) => inputs[key] === value);
}

export function validateNativeExport(
  buffer: Buffer,
  format: NativeInfrastructureFormat,
  app: string,
  scope: { subscriptionId: string; resourceGroupName: string },
  reference?: string,
  connectionName?: string
): NativeExportFile[] {
  const bicepPipeline = format === 'Bicep' && reference === undefined;
  const bicepConnection = format === 'Bicep' && reference !== undefined;
  const service = reference === undefined ? 'local design-time host' : 'managed-connection export service';
  const invalid = () =>
    new Error(
      `Invalid ${format} ${bicepPipeline ? 'Azure DevOps infrastructure pipeline' : 'infrastructure-only'} response from the ${service}. Update the host/service to a version supporting this export contract and retry. ARM fallback is not supported.${reference === undefined ? ' Regenerate older native exports with an updated host supporting the ARM workspace default; modules requiring an explicit workspace input are unsupported.' : ''}${format === 'Bicep' ? ' Regenerate JSON-parameter native exports and older fixed-name exports as schema-4 Bicep exports with source-name .bicep/.bicepparam pairs.' : ''}${bicepPipeline ? ' Bicep requires the complete task-based infrastructure pipeline, not the older infrastructure-only export or PowerShell helper pipeline.' : ''}`
    );
  try {
    if (!buffer?.length || buffer.length > maxArchiveBytes) {
      throw invalid();
    }
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (entries.length > 12) {
      throw invalid();
    }
    if (reference !== undefined && safePath(reference).includes('/')) {
      throw invalid();
    }
    if (format === 'Bicep') {
      if (bicepConnection && typeof connectionName !== 'string') {
        throw invalid();
      }
      validateBicepSourceNames(app, bicepConnection && connectionName !== undefined ? [connectionName] : []);
    }
    const directory =
      reference === undefined || bicepConnection ? `${app}/infrastructure` : `${app}/infrastructure/connections/${reference}`;
    const entrypoint = bicepConnection ? `${connectionName}.bicep` : format === 'Bicep' ? `${app}.bicep` : 'main.tf';
    const inputFile = bicepConnection
      ? `${connectionName}.bicepparam`
      : format === 'Bicep'
        ? `${app}.bicepparam`
        : reference === undefined
          ? 'terraform.tfvars.json'
          : 'inputs.json';
    const descriptorFile = bicepConnection ? undefined : reference === undefined ? 'infrastructure-export.json' : 'export.json';
    const expected = [
      entrypoint,
      inputFile,
      ...(descriptorFile ? [descriptorFile] : []),
      ...(bicepPipeline ? ['infrastructure-pipeline.yml', 'pipeline-settings.json'] : []),
    ];
    safePath(directory);
    const files: NativeExportFile[] = [];
    const names = new Map<string, { name: string; directory: boolean }>();
    let bytes = 0;
    for (const entry of entries) {
      const name = safePath(entry.isDirectory ? entry.entryName.replace(/[\\/]$/, '') : entry.entryName);
      const previous = names.get(name.toLowerCase());
      if (
        (previous && (!entry.isDirectory || !previous.directory || previous.name !== name)) ||
        ((entry.attr >>> 16) & 0xf000) === 0xa000
      ) {
        throw invalid();
      }
      names.set(name.toLowerCase(), { name, directory: entry.isDirectory });
      if (entry.isDirectory) {
        if (!`${directory}/`.startsWith(`${name}/`)) {
          throw invalid();
        }
        continue;
      }
      bytes += entry.header.size;
      if (bytes > maxExportBytes || !expected.some((file) => name === `${directory}/${file}`)) {
        throw invalid();
      }
      const content = entry.getData();
      if (!content.length || content.length !== entry.header.size) {
        throw invalid();
      }
      files.push({ name, content });
    }
    if (files.length !== expected.length) {
      throw invalid();
    }
    const sameStrings = (actual: unknown, expectedValues: string[]) =>
      Array.isArray(actual) &&
      actual.length === expectedValues.length &&
      expectedValues.every((value) => actual.includes(value)) &&
      new Set(actual).size === actual.length;
    if (!bicepConnection) {
      const descriptor = JSON.parse(files.find((file) => file.name === `${directory}/${descriptorFile}`).content.toString('utf8'));
      const requiredInputs =
        reference === undefined
          ? []
          : [...(format === 'Terraform' ? ['subscriptionId', 'resourceGroupName'] : []), 'principalId', 'tenantId', 'authentication'];
      if (
        descriptor.schemaVersion !== (bicepPipeline ? '4.0' : '1.0') ||
        descriptor.infrastructureFormat !== format ||
        descriptor.mode !== 'InfrastructureOnly' ||
        descriptor.pipelineSupport !== (bicepPipeline ? 'AzureDevOps' : 'None') ||
        (bicepPipeline &&
          (descriptor.pipelineFile !== 'infrastructure-pipeline.yml' || descriptor.pipelineSettingsFile !== 'pipeline-settings.json')) ||
        descriptor.applicationPackageIncluded !== false ||
        descriptor.workflowParametersIncluded !== false ||
        descriptor.connectionsJsonIncluded !== false ||
        descriptor.moduleKind !== (reference === undefined ? 'Host' : 'Connection') ||
        descriptor.targetScope !== 'resourceGroup' ||
        descriptor.entrypoint !== entrypoint ||
        descriptor.inputFile !== inputFile ||
        !sameStrings(descriptor.files, expected) ||
        !sameStrings(descriptor.sensitiveFiles, [inputFile]) ||
        !sameStrings(descriptor.requiredInputs, requiredInputs) ||
        (reference === undefined
          ? descriptor.subscriptionId !== scope.subscriptionId || descriptor.resourceGroupName !== scope.resourceGroupName
          : descriptor.connectionReferenceName !== reference || descriptor.runtimeUrlSettingName !== `${reference}-ConnectionRuntimeUrl`)
      ) {
        throw invalid();
      }
    }
    const inputContent = files.find((file) => file.name === `${directory}/${inputFile}`).content;
    const inputs =
      format === 'Bicep'
        ? { parameters: readBicepParameters(inputContent, entrypoint, bicepConnection) }
        : JSON.parse(inputContent.toString('utf8'));
    if (
      !inputs ||
      typeof inputs !== 'object' ||
      Array.isArray(inputs) ||
      (format === 'Bicep' && (!inputs.parameters || typeof inputs.parameters !== 'object' || Array.isArray(inputs.parameters)))
    ) {
      throw invalid();
    }
    if (reference === undefined) {
      if (format === 'Bicep' && inputs.parameters.name?.value !== app) {
        throw invalid();
      }
      const workspace = format === 'Bicep' ? inputs.parameters.workspaceResourceId : inputs.workspaceResourceId;
      if (
        workspace !== undefined &&
        (format === 'Bicep'
          ? !isRecord(workspace) ||
            !sameStrings(Object.keys(workspace), ['value']) ||
            typeof workspace.value !== 'string' ||
            !isWorkspaceResourceId(workspace.value)
          : typeof workspace !== 'string' || !isWorkspaceResourceId(workspace))
      ) {
        throw invalid();
      }
    }
    if (bicepConnection) {
      const matches = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.test(value);
      const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
      const parameterNames = [
        'connectionName',
        'connectionDisplayName',
        'connectionReferenceName',
        'connectorName',
        'location',
        'principalId',
        'tenantId',
        'authentication',
      ];
      if (
        !sameStrings(Object.keys(inputs.parameters), parameterNames) ||
        !Object.values(inputs.parameters).every((parameter) => isRecord(parameter) && sameStrings(Object.keys(parameter), ['value']))
      ) {
        throw invalid();
      }
      const values = Object.fromEntries(
        Object.entries(inputs.parameters).map(([name, parameter]) => [name, isRecord(parameter) ? parameter.value : undefined])
      );
      const authentication = values.authentication;
      const validAuthentication =
        isRecord(authentication) &&
        ((sameStrings(Object.keys(authentication), ['parameterValues']) && isRecord(authentication.parameterValues)) ||
          (sameStrings(Object.keys(authentication), ['parameterValueSet']) &&
            isRecord(authentication.parameterValueSet) &&
            sameStrings(Object.keys(authentication.parameterValueSet), ['name', 'values']) &&
            typeof authentication.parameterValueSet.name === 'string' &&
            authentication.parameterValueSet.name.length > 0 &&
            isRecord(authentication.parameterValueSet.values)));
      const template = files
        .find((file) => file.name === `${directory}/${entrypoint}`)
        .content.toString('utf8')
        .trim();
      if (
        !matches(reference, referencePattern) ||
        values.connectionReferenceName !== reference ||
        values.connectionName !== connectionName ||
        !matches(values.connectionName, /^[A-Za-z0-9][A-Za-z0-9_.()-]{0,79}$/) ||
        typeof values.connectionDisplayName !== 'string' ||
        values.connectionDisplayName.length < 1 ||
        values.connectionDisplayName.length > 256 ||
        [...values.connectionDisplayName].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
        !matches(values.connectorName, referencePattern) ||
        !matches(values.location, /^[a-z][a-z0-9]{0,63}$/) ||
        ![values.principalId, values.tenantId].every(
          (value) => value === '' || matches(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
        ) ||
        !validAuthentication ||
        !template ||
        template.startsWith('{')
      ) {
        throw invalid();
      }
    }
    if (bicepPipeline) {
      const pipeline = files.find((file) => file.name === `${directory}/infrastructure-pipeline.yml`);
      if (!isBicepTaskPipeline(pipeline.content, app)) {
        throw invalid();
      }
      const settings = JSON.parse(files.find((file) => file.name === `${directory}/pipeline-settings.json`).content.toString('utf8'));
      if (
        !settings ||
        !sameStrings(Object.keys(settings), ['schemaVersion', 'connections']) ||
        settings.schemaVersion !== '1.0' ||
        !Array.isArray(settings.connections) ||
        settings.connections.length !== 0
      ) {
        throw invalid();
      }
    }
    return files;
  } catch {
    // Never include response/input contents: connection exports can contain credentials.
    throw invalid();
  }
}

export function getRuntimeUrlSettingName(value: unknown, parameters: Record<string, { value?: unknown }>): string | null {
  const parseReference = (value: unknown) => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const expression = /^@(?:\{(.*)\}|(.*))$/.exec(value.trim());
    return /^(appsetting|parameters)\(\s*(['"])([^'"]+)\2\s*\)$/i.exec((expression?.[1] ?? expression?.[2] ?? '').trim());
  };
  const reference = parseReference(value);
  if (reference?.[1].toLowerCase() === 'appsetting') {
    return reference[3];
  }
  if (reference?.[1].toLowerCase() === 'parameters') {
    const setting = parseReference(parameters[reference[3]]?.value);
    if (setting?.[1].toLowerCase() === 'appsetting') {
      return setting[3];
    }
  }
  // Unknown existing-app bindings require an explicit value; never guess the descriptor convention.
  return null;
}

export function setBicepPipelineConnections(files: NativeExportFile[], connections: BicepPipelineConnection[]): void {
  if (connections.length > 100 || files.length > 205 || files.reduce((total, file) => total + file.content.length, 0) > maxExportBytes) {
    throw new Error('Bicep pipeline connection inventory exceeds the export limits.');
  }
  const settings = files.find((file) => file.name.endsWith('/pipeline-settings.json'));
  if (!settings) {
    throw new Error('Bicep infrastructure export is missing its pipeline settings.');
  }
  const directory = settings.name.slice(0, -'/pipeline-settings.json'.length);
  const app = path.posix.basename(path.posix.dirname(directory));
  const descriptorFile = files.find((file) => file.name === `${directory}/infrastructure-export.json`);
  const descriptor: unknown = descriptorFile && JSON.parse(descriptorFile.content.toString('utf8'));
  if (!isRecord(descriptor) || descriptor.entrypoint !== `${app}.bicep` || descriptor.inputFile !== `${app}.bicepparam`) {
    throw new Error('Bicep pipeline host descriptor must identify its exact source-name pair. Regenerate the export.');
  }
  const hostFiles = [
    descriptor.entrypoint,
    descriptor.inputFile,
    'infrastructure-export.json',
    'infrastructure-pipeline.yml',
    'pipeline-settings.json',
  ];
  const children = files.filter((file) => !hostFiles.includes(path.posix.basename(file.name)));
  const templates = children.filter((file) => file.name.endsWith('.bicep'));
  const inputs = children.filter((file) => file.name.endsWith('.bicepparam'));
  const stems = templates.map((file) => path.posix.basename(file.name).slice(0, -'.bicep'.length));
  validateBicepSourceNames(app, stems);
  const exportedReferences = inputs.map((file) => {
    const stem = path.posix.basename(file.name).slice(0, -'.bicepparam'.length);
    const parameters = readBicepParameters(file.content, `${stem}.bicep`, true);
    if (parameters.connectionName?.value !== stem || typeof parameters.connectionReferenceName?.value !== 'string') {
      throw new Error('Bicep pipeline connection filenames must match their exact source connection names.');
    }
    return parameters.connectionReferenceName.value;
  });
  const configuredReferences = connections.map((connection) => connection.connectionReferenceName);
  if (
    files.some((file) => path.posix.dirname(file.name) !== directory) ||
    new Set(files.map((file) => safePath(file.name).toLowerCase())).size !== files.length ||
    hostFiles.some((name) => !files.some((file) => file.name === `${directory}/${name}`)) ||
    children.length !== connections.length * 2 ||
    templates.length !== connections.length ||
    inputs.some((file) => !stems.includes(path.posix.basename(file.name).slice(0, -'.bicepparam'.length))) ||
    new Set(exportedReferences).size !== exportedReferences.length ||
    new Set(configuredReferences).size !== connections.length ||
    exportedReferences.length !== connections.length ||
    exportedReferences.some((reference) => !configuredReferences.includes(reference)) ||
    configuredReferences.some((reference) => !exportedReferences.includes(reference))
  ) {
    throw new Error('Bicep pipeline connection inventory must match all assembled connection exports.');
  }
  settings.content = Buffer.from(JSON.stringify({ schemaVersion: '1.0', connections }, null, 2));
}

export function publishNativeExport(files: NativeExportFile[], deploymentFolder: string, format: NativeInfrastructureFormat): string {
  const names = files.map((file) => safePath(file.name).toLowerCase());
  if (new Set(names).size !== files.length || files.reduce((total, file) => total + file.content.length, 0) > maxExportBytes) {
    throw new Error('Native export exceeds the size limit or contains conflicting paths.');
  }
  fs.mkdirSync(deploymentFolder, { recursive: true });
  const output = fs.mkdtempSync(path.join(deploymentFolder, `${format.toLowerCase()}-`));
  const staging = path.join(output, '.staging');
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
    for (const file of files) {
      const destination = path.join(staging, ...safePath(file.name).split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, file.content, { flag: 'wx', mode: 0o600 });
    }
    const artifacts = path.join(output, 'artifacts');
    fs.renameSync(staging, artifacts);
    return artifacts;
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
