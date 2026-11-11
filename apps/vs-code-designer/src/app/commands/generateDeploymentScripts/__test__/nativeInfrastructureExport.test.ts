import { afterEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse, stringify } from 'yaml';
import {
  getRuntimeUrlSettingName,
  isWorkspaceResourceId,
  publishNativeExport,
  setBicepPipelineConnections,
  validateBicepSourceNames,
  validateNativeExport,
} from '../nativeInfrastructureExport';
import {
  legacyBicepHostZip,
  legacyHelperBicepHostZip,
  nativeZip,
  scope,
  workspaceId,
  parseNativeParameters,
  renderNativeParameters,
} from './nativeExportFixtures';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) };
});
vi.unmock('os');
const directories: string[] = [];
interface PipelineFixture {
  [key: string]: unknown;
  parameters: { name: string; type: string; default: string; displayName?: unknown }[];
  steps: {
    [key: string]: unknown;
    task?: string;
    inputs?: Record<string, unknown>;
    condition?: string;
  }[];
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('native module contract', () => {
  it.each(['CON', 'con.txt', 'PrN', 'AUX', 'NUL', 'COM1', 'lpt9.foo', 'name.', 'name ', '../name', 'a/b', 'a\\b', 'a:b', ''])(
    'rejects unsafe Windows source stem %j for either role',
    (name) => {
      expect(() => validateBicepSourceNames(name, [])).toThrow();
      expect(() => validateBicepSourceNames('app', [name])).toThrow();
    }
  );

  it.each([['app'], ['APP'], ['physical', 'physical'], ['physical', 'PHYSICAL']])(
    'rejects case-insensitive flat source-name collisions %j',
    (...connections) => {
      expect(() => validateBicepSourceNames('app', connections)).toThrow('unique source app and connection names');
    }
  );

  it('accepts distinct exact source stems without suffixing or normalizing them', () => {
    expect(() => validateBicepSourceNames('SourceApp', ['physical.Name(1)', 'main', 'pipeline-settings'])).not.toThrow();
  });

  it('binds the physical source name separately from reference and exact-case ZIP names', () => {
    const bytes = nativeZip('Bicep', 'differentReference', {}, 'Physical.Name(1)');
    const files = validateNativeExport(bytes, 'Bicep', 'app', scope, 'differentReference', 'Physical.Name(1)');
    expect(files.map((file) => file.name).sort()).toEqual([
      'app/infrastructure/Physical.Name(1).bicep',
      'app/infrastructure/Physical.Name(1).bicepparam',
    ]);
    for (const name of [undefined, 'physical.Name(1)', 'differentReference']) {
      expect(() => validateNativeExport(bytes, 'Bicep', 'app', scope, 'differentReference', name)).toThrow('Regenerate');
    }
  });

  it.each(['host', 'connection'] as const)('rejects old fixed-name %s exports with regenerate guidance', (role) => {
    const child = role === 'connection';
    const archive = new AdmZip(nativeZip('Bicep', child ? 'ref' : undefined));
    const zip = new AdmZip();
    for (const entry of archive.getEntries()) {
      const name = entry.entryName.replace('/app.bicep', '/main.bicep').replace('/resource-name.bicep', '/ref.template.bicep');
      zip.addFile(name, entry.getData());
    }
    expect(() =>
      validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, child ? 'ref' : undefined, child ? 'resource-name' : undefined)
    ).toThrow('older fixed-name exports');
  });

  it.each(['Bicep', 'Terraform'] as const)(
    'accepts %s host and connection modules without adding a workspace input or rewriting host files',
    (format) => {
      const archive = nativeZip(format);
      const original = new AdmZip(archive);
      const files = validateNativeExport(archive, format, 'app', scope);
      const input = parseNativeParameters(
        files.find((file) => file.name.endsWith(format === 'Bicep' ? '/app.bicepparam' : '/terraform.tfvars.json')).content.toString()
      );
      expect(format === 'Bicep' ? input.parameters : input).not.toHaveProperty('workspaceResourceId');
      files.forEach((file) => expect(file.content).toEqual(original.getEntry(file.name).getData()));
      expect(validateNativeExport(nativeZip(format, 'ref'), format, 'app', scope, 'ref', 'resource-name')).toHaveLength(
        format === 'Bicep' ? 2 : 3
      );
    }
  );

  it('accepts Windows ZIP separators without changing output paths', () => {
    const original = new AdmZip(nativeZip('Bicep'));
    const zip = new AdmZip();
    for (const entry of original.getEntries()) {
      zip.addFile(entry.entryName.replace(/\//g, '\\'), entry.getData());
    }
    expect(validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope).every((file) => !file.name.includes('\\'))).toBe(true);
  });

  it('accepts bounded repeated identical directory entries emitted by the backend ZIP writer', () => {
    const zip = new AdmZip(nativeZip('Bicep'));
    zip.addFile('app/', Buffer.alloc(0));
    for (let index = 0; index < 5; index++) {
      const placeholder = `directory-${index}/`;
      zip.addFile(placeholder, Buffer.alloc(0));
      zip.getEntry(placeholder).entryName = 'app/infrastructure/';
    }
    const buffer = zip.toBuffer();
    expect(
      new AdmZip(buffer).getEntries().filter((entry) => entry.isDirectory && entry.entryName === 'app/infrastructure/').length
    ).toBeGreaterThan(1);
    expect(validateNativeExport(buffer, 'Bicep', 'app', scope)).toHaveLength(5);
  });

  it('still rejects repeated directory case aliases and duplicate files', () => {
    const directoryAlias = new AdmZip(nativeZip('Bicep'));
    directoryAlias.addFile('app/infrastructure/', Buffer.alloc(0));
    directoryAlias.addFile('app/INFRASTRUCTURE/', Buffer.alloc(0));
    expect(() => validateNativeExport(directoryAlias.toBuffer(), 'Bicep', 'app', scope)).toThrow('Invalid Bicep');
    const duplicate = new AdmZip(nativeZip('Bicep'));
    duplicate.addFile('placeholder', Buffer.from('duplicate'));
    duplicate.getEntry('placeholder').entryName = 'app/infrastructure/app.bicep';
    expect(() => validateNativeExport(duplicate.toBuffer(), 'Bicep', 'app', scope)).toThrow('Invalid Bicep');
  });

  it.each([
    { schemaVersion: 1 },
    { infrastructureFormat: 'Arm' },
    { infrastructureFormat: 'Terraform' },
    { moduleKind: 'Connection' },
    { mode: 'Pipeline' },
    { pipelineSupport: 'None' },
    { schemaVersion: '1.0' },
    { schemaVersion: '2.0' },
    { schemaVersion: '3.0' },
    { pipelineFile: undefined },
    { pipelineFile: '../infrastructure-pipeline.yml' },
    { pipelineSettingsFile: 'missing.json' },
    { applicationPackageIncluded: true },
    { workflowParametersIncluded: true },
    { connectionsJsonIncluded: true },
    { files: ['main.bicep'] },
    { sensitiveFiles: [] },
    { requiredInputs: undefined },
    { subscriptionId: 'wrong' },
    { entrypoint: 'main.tf' },
    { inputFile: 'inputs.json' },
    { targetScope: 'subscription' },
  ])('rejects mismatched descriptor %j', (overrides) => {
    expect(() => validateNativeExport(nativeZip('Bicep', undefined, overrides), 'Bicep', 'app', scope)).toThrow('Update the host/service');
  });

  it('binds connection reference and runtime setting names', () => {
    for (const overrides of [{ connectionReferenceName: 'other' }, { runtimeUrlSettingName: 'display-ConnectionRuntimeUrl' }]) {
      expect(() =>
        validateNativeExport(nativeZip('Terraform', 'ref', overrides), 'Terraform', 'app', scope, 'ref', 'resource-name')
      ).toThrow('managed-connection export service');
    }
  });

  it.each(['ref', 'main', 'parameters', 'pipeline-settings', 'infrastructure-export'])(
    'accepts only the two flat Bicep connection files for reference %s without colliding with the host',
    (reference) => {
      const files = validateNativeExport(nativeZip('Bicep', reference), 'Bicep', 'app', scope, reference, 'resource-name');
      expect(files.map((file) => file.name).sort()).toEqual([
        'app/infrastructure/resource-name.bicep',
        'app/infrastructure/resource-name.bicepparam',
      ]);
      const host = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
      expect(new Set([...host, ...files].map((file) => file.name)).size).toBe(7);
    }
  );

  it.each([
    'app/infrastructure/ref.export.json',
    'app/infrastructure/ref.connection.export.json',
    'app/infrastructure/connections/ref/export.json',
    'app/infrastructure/ref.template.json',
  ])('rejects Bicep connection descriptors or ARM/extra output %s', (name) => {
    const zip = new AdmZip(nativeZip('Bicep', 'ref'));
    zip.addFile(name, Buffer.from('{}'));
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow(
      'managed-connection export service'
    );
  });

  it.each(['resource-name.bicep', 'resource-name.bicepparam'])('rejects a missing Bicep pair member %s', (file) => {
    const zip = new AdmZip(nativeZip('Bicep', 'ref'));
    zip.deleteFile(`app/infrastructure/${file}`);
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow(
      'managed-connection export service'
    );
  });

  it('rejects mismatched references and old nested Bicep pairs', () => {
    expect(() => validateNativeExport(nativeZip('Bicep', 'other'), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow();
    const zip = new AdmZip();
    zip.addFile('app/infrastructure/connections/ref/main.bicep', Buffer.from('param principalId string'));
    zip.addFile('app/infrastructure/connections/ref/parameters.json', Buffer.from('{"parameters":{}}'));
    zip.addFile('app/infrastructure/connections/ref/export.json', Buffer.from('{"schemaVersion":"1.0"}'));
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow(
      'managed-connection export service'
    );
  });

  it('accepts directory entries but rejects unsafe reference paths and connection aliases', () => {
    const zip = new AdmZip(nativeZip('Bicep', 'ref'));
    zip.addFile('app/', Buffer.alloc(0));
    zip.addFile('app/infrastructure/', Buffer.alloc(0));
    expect(validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toHaveLength(2);
    zip.addFile('app/infrastructure/REF.template.bicep', Buffer.from('alias'));
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow();
    for (const reference of ['../ref', 'nested/ref', 'nested\\ref', 'C:ref']) {
      expect(() => validateNativeExport(nativeZip('Bicep', reference), 'Bicep', 'app', scope, reference, 'resource-name')).toThrow();
    }
  });

  it.each([
    { connectionReferenceName: { value: 'other' } },
    { connectionName: { value: 'invalid/name' } },
    { connectionDisplayName: { value: '' } },
    { connectionDisplayName: { value: 'display\nname' } },
    { connectorName: { value: 'invalid/connector' } },
    { location: { value: 'East US' } },
    { principalId: { value: 'not-an-identity' } },
    { tenantId: { value: null } },
    { authentication: { value: null } },
    { authentication: { value: { parameterValues: [] } } },
    { authentication: { value: { parameterValues: {}, parameterValueSet: { name: 'auth', values: {} } } } },
    { authentication: { value: { parameterValueSet: { name: 'auth', values: [] } } } },
    { authentication: { value: { parameterValueSet: { name: '', values: {} } } } },
    { unexpected: { value: 'extra' } },
  ])('rejects invalid flat Bicep input shapes without leaking content: %j', (overrides) => {
    const zip = new AdmZip(nativeZip('Bicep', 'ref'));
    const inputs = parseNativeParameters(zip.getEntry('app/infrastructure/resource-name.bicepparam').getData().toString());
    Object.assign(inputs.parameters, overrides);
    zip.updateFile('app/infrastructure/resource-name.bicepparam', Buffer.from(renderNativeParameters(inputs, 'ref')));
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow(
      'managed-connection export service'
    );
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).not.toThrow('not-an-identity');
  });

  it('requires every parameter and rejects JSON masquerading as native parameter syntax', () => {
    for (const change of ['missing', 'invalid-json', 'renamed-json']) {
      const zip = new AdmZip(nativeZip('Bicep', 'ref'));
      const inputs = parseNativeParameters(zip.getEntry('app/infrastructure/resource-name.bicepparam').getData().toString());
      delete inputs.parameters.authentication;
      zip.updateFile(
        'app/infrastructure/resource-name.bicepparam',
        Buffer.from(
          change === 'invalid-json'
            ? 'credential-not-json'
            : change === 'renamed-json'
              ? JSON.stringify(inputs)
              : renderNativeParameters(inputs, 'ref')
        )
      );
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow();
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).not.toThrow('credential-not-json');
    }
  });

  it.each([
    { parameterValues: { token: 'secret-value', nested: { value: 'secret' }, enabled: true } },
    { parameterValueSet: { name: 'managedIdentityAuth', values: { nested: { value: 'secret' }, scalar: 'value' } } },
  ])('preserves both authentication input alternatives and resource/display/reference distinctions', (authentication) => {
    const zip = new AdmZip(nativeZip('Bicep', 'ref'));
    const inputs = parseNativeParameters(zip.getEntry('app/infrastructure/resource-name.bicepparam').getData().toString());
    inputs.parameters.authentication.value = authentication;
    inputs.parameters.principalId.value = '11111111-1111-1111-1111-111111111111';
    const original = Buffer.from(renderNativeParameters(inputs, 'ref'));
    zip.updateFile('app/infrastructure/resource-name.bicepparam', original);
    const files = validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name');
    const actual = files.find((file) => file.name.endsWith('/resource-name.bicepparam')).content;
    expect(actual).toEqual(original);
    expect(parseNativeParameters(actual.toString()).parameters).toMatchObject({
      connectionName: { value: 'resource-name' },
      connectionDisplayName: { value: 'display-other' },
      connectionReferenceName: { value: 'ref' },
      authentication: { value: authentication },
    });
  });

  it.each([' \n ', '{"$schema":"arm-template","resources":[]}'])('rejects empty or ARM JSON renamed as Bicep', (template) => {
    const zip = new AdmZip(nativeZip('Bicep', 'ref'));
    zip.updateFile('app/infrastructure/resource-name.bicep', Buffer.from(template));
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope, 'ref', 'resource-name')).toThrow(
      'ARM fallback is not supported'
    );
  });

  it.each([
    'pipeline.yml',
    '../outside',
    'C:\\outside',
    'app/infrastructure/app.bicep.',
    'app/infrastructure/CON',
    'app/infrastructure/main.tf',
  ])('rejects unexpected or unsafe archive entry %s', (name) => {
    const zip = new AdmZip(nativeZip('Bicep'));
    zip.addFile(name, Buffer.from('not native'));
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('ARM fallback is not supported');
  });

  it('rejects legacy ARM success ZIPs and missing/invalid content', () => {
    const arm = new AdmZip();
    arm.addFile('app/infrastructure/template.json', Buffer.from('{}'));
    for (const buffer of [arm.toBuffer(), Buffer.from('not a ZIP'), Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
      expect(() => validateNativeExport(buffer, 'Terraform', 'app', scope)).toThrow('Update the host/service');
    }
    const zip = new AdmZip(nativeZip('Bicep'));
    zip.deleteFile('app/infrastructure/app.bicep');
    expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow();
  });

  it('rejects oversized decompressed data, symlinks, case aliases and invalid input JSON', () => {
    const large = new AdmZip(nativeZip('Bicep'));
    large.updateFile('app/infrastructure/app.bicep', Buffer.alloc(20 * 1024 * 1024 + 1));
    const alias = new AdmZip(nativeZip('Bicep'));
    alias.addFile('app/infrastructure/MAIN.BICEP', Buffer.from('alias'));
    const link = new AdmZip(nativeZip('Bicep'));
    link.getEntry('app/infrastructure/app.bicep').attr = 0xa000 * 65536;
    const invalid = new AdmZip(nativeZip('Bicep'));
    invalid.updateFile('app/infrastructure/app.bicepparam', Buffer.from('credential-not-json'));
    for (const zip of [large, alias, link, invalid]) {
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('Invalid Bicep');
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).not.toThrow('credential-not-json');
    }
  });

  it('validates existing Log Analytics workspace resource ID shape', () => {
    expect(isWorkspaceResourceId(workspaceId)).toBe(true);
    expect(
      isWorkspaceResourceId(workspaceId.replace('Microsoft.OperationalInsights/workspaces', 'Microsoft.Storage/storageAccounts'))
    ).toBe(false);
  });

  it.each(['Bicep', 'Terraform'] as const)(
    'rejects obsolete %s hosts requiring an explicit workspace with regenerate guidance',
    (format) => {
      expect(() =>
        validateNativeExport(nativeZip(format, undefined, { requiredInputs: ['workspaceResourceId'] }), format, 'app', scope)
      ).toThrow('Regenerate older native exports');
    }
  );

  it.each(['Bicep', 'Terraform'] as const)('preserves a valid optional explicit %s workspace without client mutation', (format) => {
    const zip = new AdmZip(nativeZip(format));
    const name = format === 'Bicep' ? 'app/infrastructure/app.bicepparam' : 'app/infrastructure/terraform.tfvars.json';
    const input = parseNativeParameters(zip.getEntry(name).getData().toString());
    if (format === 'Bicep') {
      input.parameters.workspaceResourceId = { value: workspaceId };
    } else {
      input.workspaceResourceId = workspaceId;
    }
    const bytes = Buffer.from(format === 'Bicep' ? renderNativeParameters(input) : JSON.stringify(input));
    zip.updateFile(name, bytes);
    const files = validateNativeExport(zip.toBuffer(), format, 'app', scope);
    expect(files.find((file) => file.name === name).content).toEqual(bytes);
  });

  it.each(['Bicep', 'Terraform'] as const)('rejects malformed optional %s workspace overrides without prompting', (format) => {
    const zip = new AdmZip(nativeZip(format));
    const name = format === 'Bicep' ? 'app/infrastructure/app.bicepparam' : 'app/infrastructure/terraform.tfvars.json';
    for (const value of ['', null, {}, 'workspace-name', '$(workspaceResourceId)']) {
      const input = parseNativeParameters(new AdmZip(nativeZip(format)).getEntry(name).getData().toString());
      if (format === 'Bicep') {
        input.parameters.workspaceResourceId = { value };
      } else {
        input.workspaceResourceId = value;
      }
      zip.updateFile(name, Buffer.from(format === 'Bicep' ? renderNativeParameters(input) : JSON.stringify(input)));
      expect(() => validateNativeExport(zip.toBuffer(), format, 'app', scope)).toThrow('Invalid');
    }
  });
});

describe('bounded native publication', () => {
  function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logicapps-native-test-'));
    directories.push(directory);
    return directory;
  }

  it('publishes separate complete exports without overwriting existing output', () => {
    const directory = temporaryDirectory();
    fs.writeFileSync(path.join(directory, 'existing.txt'), 'preserve');
    const files = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
    const first = publishNativeExport(files, directory, 'Bicep');
    const second = publishNativeExport(files, directory, 'Bicep');
    expect(first).not.toBe(second);
    expect(fs.readFileSync(path.join(directory, 'existing.txt'), 'utf8')).toBe('preserve');
    expect(fs.readdirSync(path.join(first, 'app', 'infrastructure'))).toHaveLength(5);
    expect(fs.readdirSync(path.dirname(first))).toEqual(['artifacts']);
  });

  it('publishes multiple flat pairs with the host and rejects case-colliding references before allocating output', () => {
    const directory = temporaryDirectory();
    const host = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
    const files = [
      ...host,
      ...validateNativeExport(nativeZip('Bicep', 'main'), 'Bicep', 'app', scope, 'main', 'resource-name'),
      ...validateNativeExport(nativeZip('Bicep', 'other', {}, 'other-name'), 'Bicep', 'app', scope, 'other', 'other-name'),
    ];
    const output = publishNativeExport(files, directory, 'Bicep');
    expect(fs.readdirSync(path.join(output, 'app', 'infrastructure')).sort()).toEqual(
      files.map((file) => path.posix.basename(file.name)).sort()
    );
    const conflicting = [
      ...files,
      ...validateNativeExport(nativeZip('Bicep', 'MAIN', {}, 'RESOURCE-NAME'), 'Bicep', 'app', scope, 'MAIN', 'RESOURCE-NAME'),
    ];
    const unavailableOutput = path.join(directory, 'not-created');
    expect(() => publishNativeExport(conflicting, unavailableOutput, 'Bicep')).toThrow('conflicting paths');
    expect(fs.existsSync(unavailableOutput)).toBe(false);
    expect(fs.readFileSync(path.join(output, 'app', 'infrastructure', 'resource-name.bicep'))).toEqual(
      files.find((file) => file.name.endsWith('/resource-name.bicep')).content
    );
  });

  describe('Bicep infrastructure pipeline contract and inventory', () => {
    it('requires the task-based schema-4 Bicep host instead of accepting old infrastructure-only or helper exports', () => {
      expect(validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope)).toHaveLength(5);
      expect(() => validateNativeExport(legacyBicepHostZip(), 'Bicep', 'app', scope)).toThrow('not the older infrastructure-only export');
      expect(() => validateNativeExport(legacyHelperBicepHostZip(), 'Bicep', 'app', scope)).toThrow('PowerShell helper pipeline');
      expect(validateNativeExport(nativeZip('Terraform'), 'Terraform', 'app', scope)).toHaveLength(3);
      expect(validateNativeExport(nativeZip('Bicep', 'ref'), 'Bicep', 'app', scope, 'ref', 'resource-name')).toHaveLength(2);
      expect(() =>
        validateNativeExport(
          nativeZip('Terraform', undefined, { schemaVersion: '2.0', pipelineSupport: 'AzureDevOps' }),
          'Terraform',
          'app',
          scope
        )
      ).toThrow('Invalid Terraform');
    });

    it.each(['infrastructure-pipeline.yml', 'pipeline-settings.json'])('rejects a missing required pipeline file %s', (file) => {
      const zip = new AdmZip(nativeZip('Bicep'));
      zip.deleteFile(`app/infrastructure/${file}`);
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('complete task-based infrastructure pipeline');
    });

    it('does not accept an obsolete helper pipeline relabeled as schema 3 without its script', () => {
      const zip = new AdmZip(legacyHelperBicepHostZip());
      zip.deleteFile('app/infrastructure/Invoke-BicepInfrastructure.ps1');
      const descriptor = parseNativeParameters(zip.getEntry('app/infrastructure/infrastructure-export.json').getData().toString());
      descriptor.schemaVersion = '3.0';
      descriptor.files = descriptor.files.filter((file: string) => !file.endsWith('.ps1'));
      zip.updateFile('app/infrastructure/infrastructure-export.json', Buffer.from(JSON.stringify(descriptor)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
    });

    it.each([
      {
        name: 'legacy task major',
        change: (pipeline: PipelineFixture) => (pipeline.steps[1].task = 'AzureLogicAppsStandardConnectionsDeployment@0'),
      },
      {
        name: 'superseded exact legacy patch',
        change: (pipeline: PipelineFixture) => (pipeline.steps[1].task = 'AzureLogicAppsStandardConnectionsDeployment@0.0.3'),
      },
      {
        name: 'wrong native task major',
        change: (pipeline: PipelineFixture) => (pipeline.steps[1].task = 'AzureLogicAppsStandardConnectionsDeployment@2'),
      },
      { name: 'missing deployment task', change: (pipeline: PipelineFixture) => pipeline.steps.pop() },
      { name: 'skip preflight', change: (pipeline: PipelineFixture) => (pipeline.steps[1].condition = 'false') },
      { name: 'suppressed task failure', change: (pipeline: PipelineFixture) => (pipeline.steps[1].continueOnError = true) },
      { name: 'legacy native input', change: (pipeline: PipelineFixture) => (pipeline.steps[1].inputs.infrastructureFormat = 'Arm') },
      {
        name: 'unbound service connection',
        change: (pipeline: PipelineFixture) => (pipeline.steps[1].inputs.connectedServiceName = 'other-connection'),
      },
      {
        name: 'unbound infrastructure directory',
        change: (pipeline: PipelineFixture) => (pipeline.steps[1].inputs.infrastructureDirectory = 'other-directory'),
      },
      {
        name: 'extra queue scope',
        change: (pipeline: PipelineFixture) => pipeline.parameters.push({ name: 'scope', type: 'string', default: '' }),
      },
      { name: 'wrong default directory', change: (pipeline: PipelineFixture) => (pipeline.parameters[1].default = 'other/infrastructure') },
      {
        name: 'extra variables',
        change: (pipeline: PipelineFixture) => (pipeline.variables = { subscriptionId: 'other-sub' }),
      },
      { name: 'inline PowerShell', change: (pipeline: PipelineFixture) => (pipeline.steps[1].pwsh = 'Invoke-BicepInfrastructure.ps1') },
      { name: 'inline shell', change: (pipeline: PipelineFixture) => pipeline.steps.push({ script: 'deploy connections' }) },
      { name: 'Azure CLI substitute', change: (pipeline: PipelineFixture) => (pipeline.steps[1].task = 'AzureCLI@2') },
      {
        name: 'separate host deployment',
        change: (pipeline: PipelineFixture) => pipeline.steps.push({ task: 'AzureResourceManagerTemplateDeployment@3', inputs: {} }),
      },
      {
        name: 'separate cleanup invocation',
        change: (pipeline: PipelineFixture) =>
          pipeline.steps.push({
            task: 'AzureLogicAppsStandardConnectionsDeployment@1',
            condition: 'always()',
            inputs: { phase: 'Cleanup' },
          }),
      },
    ])('rejects schema-4 pipeline with $name', ({ change }) => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      change(pipeline);
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
    });

    it.each([
      'phase',
      'workingDirectory',
      'subscriptionId',
      'resourceGroupName',
      'location',
      'appName',
      'hostingPlanName',
      'storageAccountName',
      'workspaceResourceId',
      'overrideParameters',
      'deploymentOutputs',
      'unrecognizedInput',
    ])('rejects obsolete, unknown or incorrectly bound task input %s', (field) => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      pipeline.steps[1].inputs[field] = 'unverified-value';
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
    });

    it('requires a single invocation with nine pipeline-bound public inputs and no mandatory workspace', () => {
      const files = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
      const pipeline: PipelineFixture = parse(files.find((file) => file.name.endsWith('/infrastructure-pipeline.yml')).content.toString());
      expect(pipeline.steps).toHaveLength(2);
      expect(pipeline.steps[1]).toMatchObject({
        task: 'AzureLogicAppsStandardConnectionsDeployment@1',
        inputs: {
          connectedServiceName: '${{ parameters.serviceConnectionName }}',
          infrastructureFormat: 'Bicep',
          infrastructureDirectory: '$(Build.SourcesDirectory)/${{ parameters.infrastructureDirectory }}',
          subscriptionId: '$(subscriptionId)',
          resourceGroupName: '$(resourceGroupName)',
          appName: '$(logicAppName)',
          location: '$(resourceGroupLocation)',
          hostingPlanName: '$(hostingPlanName)',
          storageAccountName: '$(storageAccountName)',
        },
      });
      expect(Object.keys(pipeline.steps[1].inputs)).toHaveLength(9);
      expect(pipeline.steps[1].inputs).not.toHaveProperty('workspaceResourceId');
      expect(pipeline.steps[1].inputs).not.toHaveProperty('connectionNames');
      expect(pipeline).not.toHaveProperty('variables');
      expect(pipeline.parameters.map((parameter) => parameter.name)).toEqual(['serviceConnectionName', 'infrastructureDirectory']);
      expect(
        parseNativeParameters(files.find((file) => file.name.endsWith('/infrastructure-export.json')).content.toString())
      ).toMatchObject(scope);
      expect(() => validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', { ...scope, subscriptionId: 'other-export' })).toThrow(
        'Update the host/service'
      );
    });

    it.each(['subscriptionId', 'resourceGroupName', 'appName', 'location', 'hostingPlanName', 'storageAccountName'])(
      'rejects a missing required pipeline target binding %s',
      (field) => {
        const zip = new AdmZip(nativeZip('Bicep'));
        const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
        delete pipeline.steps[1].inputs[field];
        zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
        expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
      }
    );

    it('rejects the obsolete three-input native pipeline even with the current schema and task major', () => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      const { connectedServiceName, infrastructureFormat, infrastructureDirectory } = pipeline.steps[1].inputs;
      pipeline.steps[1].inputs = { connectedServiceName, infrastructureFormat, infrastructureDirectory };
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
    });

    it('allows only the optional connectionNames pipeline-variable binding, leaving map validation to the task', () => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      pipeline.steps[1].inputs.connectionNames = '$(connectionNames)';
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toHaveLength(5);
    });

    it('allows an optional manually added workspace binding alongside connectionNames without rewriting it', () => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      pipeline.steps[1].inputs.workspaceResourceId = '$(workspaceResourceId)';
      pipeline.steps[1].inputs.connectionNames = '$(connectionNames)';
      const bytes = Buffer.from(stringify(pipeline));
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', bytes);
      const files = validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope);
      expect(files.find((file) => file.name.endsWith('/infrastructure-pipeline.yml')).content).toEqual(bytes);
    });

    it.each(['', workspaceId, '$(otherWorkspace)', {}, null, true])('rejects a non-contract optional workspace binding %j', (value) => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      pipeline.steps[1].inputs.workspaceResourceId = value;
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
    });

    it.each(['', '{}', '$(otherNames)', { reference: 'target-name' }, null, true])(
      'rejects a non-contract optional connectionNames binding %j',
      (value) => {
        const zip = new AdmZip(nativeZip('Bicep'));
        const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
        pipeline.steps[1].inputs.connectionNames = value;
        zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
        expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
      }
    );

    it('does not rewrite pipeline targets, host defaults, child inputs or export provenance while assembling modules', () => {
      const files = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
      const pipeline = files.find((file) => file.name.endsWith('/infrastructure-pipeline.yml'));
      const descriptor = files.find((file) => file.name.endsWith('/infrastructure-export.json'));
      const pipelineBytes = Buffer.from(pipeline.content);
      const descriptorBytes = Buffer.from(descriptor.content);
      const child = validateNativeExport(nativeZip('Bicep', 'ref'), 'Bicep', 'app', scope, 'ref', 'resource-name');
      const childBytes = child.map((file) => Buffer.from(file.content));
      files.push(...child);
      expect(pipeline.content).toEqual(pipelineBytes);
      expect(descriptor.content).toEqual(descriptorBytes);
      expect(parse(pipeline.content.toString()).steps[1].inputs).not.toHaveProperty('workspaceResourceId');
      child.forEach((file, index) => expect(file.content).toEqual(childBytes[index]));
    });

    it('allows optional queue parameter display names, but not executable parameter extensions', () => {
      const zip = new AdmZip(nativeZip('Bicep'));
      const pipeline: PipelineFixture = parse(zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString());
      for (const parameter of pipeline.parameters) {
        delete parameter.displayName;
      }
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toHaveLength(5);
      pipeline.parameters[0].displayName = { script: 'not a label' };
      zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(stringify(pipeline)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
    });

    it.each(['steps: [', 'steps: []', '# AzureLogicAppsStandardConnectionsDeployment@1\nsteps: []'])(
      'rejects malformed or missing task steps without exposing returned content',
      (pipeline) => {
        const zip = new AdmZip(nativeZip('Bicep'));
        zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(pipeline));
        expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('task-based infrastructure pipeline');
        expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).not.toThrow('steps:');
      }
    );

    it.each([
      { schemaVersion: '2.0', connections: [] },
      { schemaVersion: '1.0' },
      { schemaVersion: '1.0', connections: {} },
      { schemaVersion: '1.0', connections: [{ connectionReferenceName: 'unexpected' }] },
      { schemaVersion: '1.0', connections: [], workspaceResourceId: '' },
    ])('rejects a mismatched initial pipeline-settings contract %j', (settings) => {
      const zip = new AdmZip(nativeZip('Bicep'));
      zip.updateFile('app/infrastructure/pipeline-settings.json', Buffer.from(JSON.stringify(settings)));
      expect(() => validateNativeExport(zip.toBuffer(), 'Bicep', 'app', scope)).toThrow('complete task-based infrastructure pipeline');
    });

    it('populates every assembled child without adding a workspace placeholder to any host or child input', () => {
      const files = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
      files.push(...validateNativeExport(nativeZip('Bicep', 'ref-1'), 'Bicep', 'app', scope, 'ref-1', 'resource-name'));
      files.push(
        ...validateNativeExport(nativeZip('Bicep', 'ref-2', {}, 'second-physical'), 'Bicep', 'app', scope, 'ref-2', 'second-physical')
      );
      setBicepPipelineConnections(files, [
        { connectionReferenceName: 'ref-1', runtimeUrlSettingName: 'custom-consumed-key' },
        { connectionReferenceName: 'ref-2', runtimeUrlSettingName: null },
      ]);
      expect(parseNativeParameters(files.find((file) => file.name.endsWith('/pipeline-settings.json')).content.toString())).toEqual({
        schemaVersion: '1.0',
        connections: [
          { connectionReferenceName: 'ref-1', runtimeUrlSettingName: 'custom-consumed-key' },
          { connectionReferenceName: 'ref-2', runtimeUrlSettingName: null },
        ],
      });
      expect(
        parseNativeParameters(files.find((file) => file.name === 'app/infrastructure/app.bicepparam').content.toString()).parameters
      ).not.toHaveProperty('workspaceResourceId');
      expect(files.find((file) => file.name.endsWith('/pipeline-settings.json')).content.toString()).not.toContain('workspaceResourceId');
      expect(
        files.filter((file) => file.name.endsWith('/app.bicepparam') && file.content.toString().includes('workspaceResourceId'))
      ).toHaveLength(0);
    });

    it('preserves an explicitly empty inventory when there are no connection modules', () => {
      const files = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
      setBicepPipelineConnections(files, []);
      expect(
        parseNativeParameters(files.find((file) => file.name.endsWith('/pipeline-settings.json')).content.toString()).connections
      ).toEqual([]);
    });

    it.each(['orphan.bicep', 'orphan.bicepparam', 'extra.txt', 'nested/extra.bicep', 'resource-name.BICEP'])(
      'rejects unlisted or orphan assembled root content %s without modifying bytes',
      (extra) => {
        const files = [
          ...validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope),
          ...validateNativeExport(nativeZip('Bicep', 'ref'), 'Bicep', 'app', scope, 'ref', 'resource-name'),
          { name: `app/infrastructure/${extra}`, content: Buffer.from('unexpected') },
        ];
        const settings = files.find((file) => file.name.endsWith('/pipeline-settings.json'));
        const original = Buffer.from(settings.content);
        expect(() => setBicepPipelineConnections(files, [{ connectionReferenceName: 'ref', runtimeUrlSettingName: 'key' }])).toThrow();
        expect(settings.content).toEqual(original);
      }
    );

    it('rejects renamed pairs whose decoded physical source identity does not match the basename', () => {
      const files = [
        ...validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope),
        ...validateNativeExport(nativeZip('Bicep', 'ref'), 'Bicep', 'app', scope, 'ref', 'resource-name'),
      ];
      const inputs = files.find((file) => file.name.endsWith('/resource-name.bicepparam'));
      inputs.content = Buffer.from(
        inputs.content.toString().replace("param connectionName = 'resource-name'", "param connectionName = 'other'")
      );
      expect(() => setBicepPipelineConnections(files, [{ connectionReferenceName: 'ref', runtimeUrlSettingName: 'key' }])).toThrow(
        'exact source connection names'
      );
    });

    it.each(['resource-name.bicep', 'resource-name.bicepparam'])(
      'requires both assembled files for configured reference: %s',
      (missing) => {
        const files = [
          ...validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope),
          ...validateNativeExport(nativeZip('Bicep', 'ref'), 'Bicep', 'app', scope, 'ref', 'resource-name'),
        ].filter((file) => file.name !== `app/infrastructure/${missing}`);
        expect(() => setBicepPipelineConnections(files, [{ connectionReferenceName: 'ref', runtimeUrlSettingName: 'exact-key' }])).toThrow(
          'match all assembled connection exports'
        );
      }
    );

    it('preserves all host and child parameters even with a connection pair first', () => {
      const child = validateNativeExport(nativeZip('Bicep', 'parameters'), 'Bicep', 'app', scope, 'parameters', 'resource-name');
      const originalInputs = Buffer.from(child.find((file) => file.name.endsWith('.bicepparam')).content);
      const files = [...child, ...validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope)];
      setBicepPipelineConnections(files, [{ connectionReferenceName: 'parameters', runtimeUrlSettingName: 'exact-key' }]);
      expect(child.find((file) => file.name.endsWith('.bicepparam')).content).toEqual(originalInputs);
      expect(
        parseNativeParameters(files.find((file) => file.name === 'app/infrastructure/app.bicepparam').content.toString()).parameters
      ).not.toHaveProperty('workspaceResourceId');
    });

    it.each([
      { connections: [] },
      { connections: [{ connectionReferenceName: 'missing', runtimeUrlSettingName: 'key' }] },
      {
        connections: [
          { connectionReferenceName: 'ref', runtimeUrlSettingName: 'key' },
          { connectionReferenceName: 'ref', runtimeUrlSettingName: 'key' },
        ],
      },
    ])('rejects incomplete or duplicate configured connection inventories %j', ({ connections }) => {
      const files = [
        ...validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope),
        ...validateNativeExport(nativeZip('Bicep', 'ref'), 'Bicep', 'app', scope, 'ref', 'resource-name'),
      ];
      expect(() => setBicepPipelineConnections(files, connections)).toThrow('match all assembled connection exports');
    });
  });

  describe('read-only runtime setting binding recognition', () => {
    it.each(["@appsetting('exact-key')", '@{appsetting("exact-key")}', " @{appsetting( 'exact-key' )} "])(
      'recognizes an exact static app-setting binding %s',
      (value) => {
        expect(getRuntimeUrlSettingName(value, {})).toBe('exact-key');
      }
    );

    it('recognizes one parameter-to-appsetting binding without evaluating its secret value', () => {
      expect(
        getRuntimeUrlSettingName("@parameters('runtimeUrl')", {
          runtimeUrl: { value: "@appsetting('custom-key')" },
        })
      ).toBe('custom-key');
    });

    it.each([
      undefined,
      null,
      '',
      'https://secret-runtime-url',
      "@parameters('missing')",
      "@concat(appsetting('key'), '/path')",
      "prefix-@{appsetting('key')}",
    ])('leaves unrecognized or missing binding %s unresolved instead of guessing', (value) => {
      expect(getRuntimeUrlSettingName(value, {})).toBeNull();
    });

    it('does not follow arbitrary parameter indirection or use literal/secret URLs as setting names', () => {
      expect(
        getRuntimeUrlSettingName("@parameters('runtimeUrl')", {
          runtimeUrl: { value: "@parameters('another')" },
          another: { value: "@appsetting('not-inferred')" },
        })
      ).toBeNull();
      expect(getRuntimeUrlSettingName("@parameters('runtimeUrl')", { runtimeUrl: { value: 'https://secret-runtime-url' } })).toBeNull();
    });
  });

  it.each(['write', 'rename'] as const)('removes only its own output after %s failure', (failure) => {
    const directory = temporaryDirectory();
    fs.writeFileSync(path.join(directory, 'existing.txt'), 'preserve');
    if (failure === 'write') {
      vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
        throw new Error('disk full');
      });
    } else {
      vi.mocked(fs.renameSync).mockImplementationOnce(() => {
        throw new Error('publish failed');
      });
    }
    expect(() => publishNativeExport(validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope), directory, 'Bicep')).toThrow();
    expect(fs.readdirSync(directory)).toEqual(['existing.txt']);
  });

  it('rejects conflicting paths and total size before creating output', () => {
    const directory = path.join(temporaryDirectory(), 'not-created');
    const files = validateNativeExport(nativeZip('Bicep'), 'Bicep', 'app', scope);
    expect(() => publishNativeExport([...files, files[0]], directory, 'Bicep')).toThrow('conflicting paths');
    expect(() => publishNativeExport([{ name: 'large', content: Buffer.alloc(20 * 1024 * 1024 + 1) }], directory, 'Bicep')).toThrow(
      'size limit'
    );
    expect(fs.existsSync(directory)).toBe(false);
  });
});
