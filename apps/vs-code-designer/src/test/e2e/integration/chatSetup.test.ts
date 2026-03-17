import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Phase 1: Create a proper Logic App workspace for chat tests.
 *
 * This test creates a valid Logic App project with host.json and workflows
 * in a temp directory. The path is written to a manifest file so Phase 2
 * (the actual chat tests) can open it.
 *
 * Must run BEFORE chatParticipant.test.ts.
 */

const MANIFEST_DIR = path.join(os.tmpdir(), 'la-e2e-chat-test');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'workspace-manifest.json');

suite('Chat Test Setup - Create Workspace', () => {
  let projectDir: string;

  suiteSetup(function () {
    this.timeout(30_000);
    // Create a unique project directory in temp
    projectDir = path.join(os.tmpdir(), 'la-e2e-chat-test', `project-${Date.now()}`);
    fs.mkdirSync(projectDir, { recursive: true });
    console.log(`Creating Logic App project at: ${projectDir}`);
  });

  test('Should create host.json with Logic Apps extension bundle', () => {
    const hostJson = {
      version: '2.0',
      extensionBundle: {
        id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
        version: '[1.*, 2.0.0)',
      },
      extensions: {
        workflow: {
          settings: {
            'Runtime.FlowRetryPolicyMinimalInterval': 'PT1S',
          },
        },
      },
    };

    fs.writeFileSync(path.join(projectDir, 'host.json'), JSON.stringify(hostJson, null, 2));
    assert.ok(fs.existsSync(path.join(projectDir, 'host.json')), 'host.json should exist');
  });

  test('Should create local.settings.json', () => {
    const localSettings = {
      IsEncrypted: false,
      Values: {
        AzureWebJobsStorage: 'UseDevelopmentStorage=true',
        FUNCTIONS_WORKER_RUNTIME: 'node',
        AzureWebJobsSecretStorageType: 'Files',
      },
    };

    fs.writeFileSync(path.join(projectDir, 'local.settings.json'), JSON.stringify(localSettings, null, 2));
    assert.ok(fs.existsSync(path.join(projectDir, 'local.settings.json')));
  });

  test('Should create a stateful workflow (OrderProcessing)', () => {
    const workflowDir = path.join(projectDir, 'OrderProcessing');
    fs.mkdirSync(workflowDir, { recursive: true });

    const workflow = {
      definition: {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0.0',
        triggers: {
          When_a_HTTP_request_is_received: {
            type: 'Request',
            kind: 'Http',
            inputs: { schema: {} },
          },
        },
        actions: {
          Send_Response: {
            type: 'Response',
            kind: 'Http',
            runAfter: {},
            inputs: {
              statusCode: 200,
              body: 'Order processed successfully',
            },
          },
        },
        outputs: {},
      },
      kind: 'Stateful',
    };

    fs.writeFileSync(path.join(workflowDir, 'workflow.json'), JSON.stringify(workflow, null, 2));
    assert.ok(fs.existsSync(path.join(workflowDir, 'workflow.json')));
  });

  test('Should create a stateless workflow (HealthCheck)', () => {
    const workflowDir = path.join(projectDir, 'HealthCheck');
    fs.mkdirSync(workflowDir, { recursive: true });

    const workflow = {
      definition: {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0.0',
        triggers: {
          manual: {
            type: 'Request',
            kind: 'Http',
            inputs: { schema: {} },
          },
        },
        actions: {
          Respond_OK: {
            type: 'Response',
            kind: 'Http',
            runAfter: {},
            inputs: {
              statusCode: 200,
              body: { status: 'healthy' },
            },
          },
        },
        outputs: {},
      },
      kind: 'Stateless',
    };

    fs.writeFileSync(path.join(workflowDir, 'workflow.json'), JSON.stringify(workflow, null, 2));
    assert.ok(fs.existsSync(path.join(workflowDir, 'workflow.json')));
  });

  test('Should create a .code-workspace file', () => {
    const workspaceFile = {
      folders: [{ path: '.' }],
      settings: {
        'azureLogicAppsStandard.autoRuntimeDependenciesValidation': false,
        'azureLogicAppsStandard.showAutoStartWarning': false,
      },
    };

    const wsFilePath = path.join(projectDir, 'chat-test.code-workspace');
    fs.writeFileSync(wsFilePath, JSON.stringify(workspaceFile, null, 2));
    assert.ok(fs.existsSync(wsFilePath));
  });

  test('Should write manifest for Phase 2', () => {
    const manifest = {
      projectDir,
      wsFilePath: path.join(projectDir, 'chat-test.code-workspace'),
      workflows: ['OrderProcessing', 'HealthCheck'],
      createdAt: new Date().toISOString(),
    };

    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    assert.ok(fs.existsSync(MANIFEST_PATH), 'Manifest should be written');
    console.log(`Manifest written to: ${MANIFEST_PATH}`);
    console.log(`Project dir: ${projectDir}`);
    console.log(`Workspace file: ${manifest.wsFilePath}`);
  });

  test('Should verify project structure is complete', () => {
    // Verify the project looks like a valid Logic App
    assert.ok(fs.existsSync(path.join(projectDir, 'host.json')), 'host.json');
    assert.ok(fs.existsSync(path.join(projectDir, 'local.settings.json')), 'local.settings.json');
    assert.ok(fs.existsSync(path.join(projectDir, 'OrderProcessing', 'workflow.json')), 'OrderProcessing/workflow.json');
    assert.ok(fs.existsSync(path.join(projectDir, 'HealthCheck', 'workflow.json')), 'HealthCheck/workflow.json');

    // Verify host.json has the right extension bundle
    const hostJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'host.json'), 'utf8'));
    assert.strictEqual(
      hostJson.extensionBundle.id,
      'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
      'Extension bundle should be Logic Apps'
    );

    console.log('Project structure verified successfully');
  });
});
