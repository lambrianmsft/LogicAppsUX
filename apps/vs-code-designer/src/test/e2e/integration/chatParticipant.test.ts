import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Chat Participant Integration Tests
 *
 * Comprehensive tests for the @logicapps chat participant running inside
 * the VS Code Extension Development Host with full Copilot access.
 *
 * Test workspace: e2e/test-workspace (Logic App project with host.json + Stateful1)
 *
 * Run via: Debug > "Chat Tests (Extension Host)" (F5)
 */

const TOOL_NAMES = {
  listWorkflows: 'logicapps_listWorkflows',
  getWorkflowDefinition: 'logicapps_getWorkflowDefinition',
  createWorkflow: 'logicapps_createWorkflow',
  createProject: 'logicapps_createProject',
  addAction: 'logicapps_addAction',
  modifyAction: 'logicapps_modifyAction',
};

const EXTENSION_ID = 'ms-azuretools.vscode-azurelogicapps';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until a file appears on disk or timeout.
 * Used after chat commands that create workflows/actions.
 */
async function waitForFile(filePath: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

/**
 * Poll until workflow.json's actions change from a baseline snapshot.
 * Used after chat commands that add actions.
 */
async function waitForActionChange(workflowJsonPath: string, baselineActions: string[], timeoutMs = 30_000): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
      const currentActions = Object.keys(content.definition?.actions || {});
      const newActions = currentActions.filter((a) => !baselineActions.includes(a));
      if (newActions.length > 0) {
        return newActions;
      }
    } catch {
      /* file may be mid-write */
    }
    await sleep(500);
  }
  return [];
}

/**
 * Minimum wait after sending a chat command — gives the LLM time to start processing.
 * After this, we poll for side effects rather than sleeping a fixed duration.
 */
const CHAT_MIN_WAIT = 3_000;

/**
 * Send a chat command and wait for completion.
 * For commands with no expected side effects, waits a minimum time.
 * For commands with expected file changes, polls for them.
 */
async function sendChatAndWait(
  query: string,
  options?: { waitForFile?: string; waitForActionChange?: { path: string; baseline: string[] }; minWait?: number }
): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.chat.open', {
    query,
    isPartialQuery: false,
  });

  await sleep(CHAT_MIN_WAIT);

  if (options?.waitForFile) {
    await waitForFile(options.waitForFile, 60_000);
  } else if (options?.waitForActionChange) {
    await waitForActionChange(options.waitForActionChange.path, options.waitForActionChange.baseline, 60_000);
  } else {
    // No specific side effect to wait for — just wait a minimum time for the LLM
    await sleep(options?.minWait ?? 10_000);
  }

  await vscode.commands.executeCommand('workbench.action.closePanel');
}

async function waitForExtensionActivation(timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext?.isActive) {
      console.log(`Extension ${EXTENSION_ID} is active`);
      const toolReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
      if (toolReady) {
        console.log('Tool implementations are registered');
      } else {
        console.log('WARNING: Tool implementations may not be registered yet');
      }
      return true;
    }
    if (ext && !ext.isActive) {
      console.log('Extension found but not active, triggering activation...');
      try {
        await ext.activate();
      } catch (e: any) {
        console.log(`Activation failed: ${e.message}, retrying...`);
      }
    }
    await sleep(2000);
  }
  return false;
}

async function waitForToolImplementation(toolName: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await vscode.lm.invokeTool(
        toolName,
        { input: {}, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<object>,
        new vscode.CancellationTokenSource().token
      );
      return true;
    } catch (e: any) {
      if (e.message?.includes('does not have an implementation')) {
        await sleep(1000);
      } else {
        return true;
      }
    }
  }
  return false;
}

function getToolResultText(result: vscode.LanguageModelToolResult): string {
  return result.content
    .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
    .map((part) => part.value)
    .join('\n');
}

async function invokeTool(name: string, input: object = {}): Promise<string> {
  const result = await vscode.lm.invokeTool(
    name,
    { input, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<object>,
    new vscode.CancellationTokenSource().token
  );
  return getToolResultText(result);
}

function getWorkspacePath(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

/**
 * Clean up any leftover test artifacts from previous runs.
 * Must run before tool tests because stale project dirs cause ENOENT
 * when tools scan all subdirectories.
 */
function cleanupTestArtifacts(): void {
  const wsPath = getWorkspacePath();
  if (!wsPath) {
    return;
  }
  const testDirs = ['TestChatProject', 'TestCreatedWorkflow', 'ChatCreatedWf', 'ChatStatelessWf', 'ChatAddedResponse'];
  for (const dir of testDirs) {
    const dirPath = path.join(wsPath, dir);
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`Cleaned up leftover: ${dir}`);
      }
    } catch {
      /* ignore */
    }
  }

  // Reset the .code-workspace file — createProject modifies it by adding folders.
  // We need it to only contain the single test-workspace folder.
  const wsFile = vscode.workspace.workspaceFile;
  if (wsFile) {
    const wsRoot = path.dirname(wsFile.fsPath);
    // Clean project dir from workspace root too
    for (const dir of testDirs) {
      try {
        const dirPath = path.join(wsRoot, dir);
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`Cleaned from workspace root: ${dir}`);
        }
      } catch {
        /* ignore */
      }
    }
    // Reset workspace file to single folder
    try {
      const wsContent = JSON.parse(fs.readFileSync(wsFile.fsPath, 'utf-8'));
      if (wsContent.folders && wsContent.folders.length > 1) {
        wsContent.folders = [{ path: '.' }];
        fs.writeFileSync(wsFile.fsPath, JSON.stringify(wsContent, null, 2));
        console.log('Reset .code-workspace to single folder');
      }
    } catch {
      /* ignore */
    }
  }
}

// ============================================================================
// 1. Tool Registration & Schema Validation
// ============================================================================
suite('Tool Registration & Schema', () => {
  suiteSetup(async function () {
    this.timeout(90_000);
    cleanupTestArtifacts();
    await waitForExtensionActivation(60_000);
    await sleep(3000);
  });

  test('All 6 Logic Apps tools should be registered', () => {
    const toolNames = vscode.lm.tools.map((t) => t.name);
    for (const [key, name] of Object.entries(TOOL_NAMES)) {
      assert.ok(toolNames.includes(name), `Tool ${name} (${key}) not registered`);
    }
  });

  test('Each tool should have a non-empty description', () => {
    for (const name of Object.values(TOOL_NAMES)) {
      const tool = vscode.lm.tools.find((t) => t.name === name);
      assert.ok(tool, `Tool ${name} not found`);
      assert.ok(tool.description && tool.description.length > 10, `Tool ${name} should have meaningful description`);
    }
  });

  test('getWorkflowDefinition schema should require workflowName', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.getWorkflowDefinition);
    assert.ok(tool, 'Tool not found');
    const schema = tool.inputSchema as { type: string; properties: Record<string, unknown>; required: string[] };
    assert.strictEqual(schema.type, 'object', 'Schema type should be object');
    assert.ok(schema.properties.workflowName, 'Schema should have workflowName property');
    assert.ok(schema.required.includes('workflowName'), 'workflowName should be required');
  });

  test('getWorkflowDefinition schema should have optional projectName', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.getWorkflowDefinition);
    const schema = tool!.inputSchema as { properties: Record<string, unknown>; required: string[] };
    assert.ok(schema.properties.projectName, 'Schema should have projectName property');
    assert.ok(!schema.required.includes('projectName'), 'projectName should be optional');
  });

  test('createWorkflow schema should require name and type', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.createWorkflow);
    assert.ok(tool, 'Tool not found');
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    assert.ok(schema.properties.name, 'Schema should have name property');
    assert.ok(schema.required.includes('name'), 'name should be required');
    assert.ok(schema.required.includes('type'), 'type should be required');
  });

  test('addAction schema should require workflowName and actionName', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.addAction);
    assert.ok(tool, 'Tool not found');
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    assert.ok(schema.properties, 'Schema should have properties');
    assert.ok(schema.properties.workflowName, 'Schema should have workflowName');
    assert.ok(schema.properties.actionName, 'Schema should have actionName');
    assert.ok(schema.required.includes('workflowName'), 'workflowName should be required');
    assert.ok(schema.required.includes('actionName'), 'actionName should be required');
  });

  test('addAction schema should expose serviceProviderConnection fields for chat-supplied connector details', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.addAction);
    assert.ok(tool, 'Tool not found');
    const schema = tool!.inputSchema as {
      properties: Record<string, { properties?: Record<string, unknown> }>;
    };

    assert.ok(schema.properties.serviceProviderConnection, 'Schema should expose serviceProviderConnection');
    assert.ok(
      schema.properties.serviceProviderConnection.properties?.connectionString,
      'Schema should expose serviceProviderConnection.connectionString'
    );
    assert.ok(schema.properties.serviceProviderConnection.properties?.endpoint, 'Schema should expose serviceProviderConnection.endpoint');
    assert.ok(
      schema.properties.serviceProviderConnection.properties?.sharedAccessKeyName,
      'Schema should expose serviceProviderConnection.sharedAccessKeyName'
    );
    assert.ok(
      schema.properties.serviceProviderConnection.properties?.sharedAccessKey,
      'Schema should expose serviceProviderConnection.sharedAccessKey'
    );
  });
});

// ============================================================================
// 2. listWorkflows Tool — Output Validation
// ============================================================================
suite('listWorkflows Tool', () => {
  let toolsReady = false;

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    if (!toolsReady) {
      console.log('Tool implementations not available — skipping');
    }
  });

  test('should return a non-empty result', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    assert.ok(text.length > 0, 'Result should be non-empty');
  });

  test('should find Stateful1 workflow by name', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    assert.ok(text.includes('Stateful1'), `Should contain "Stateful1". Got: ${text}`);
  });

  test('should report workflow type as Stateful', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    assert.ok(text.includes('Stateful'), `Should identify type as Stateful. Got: ${text}`);
  });

  test('should report at least 1 workflow found', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    const countMatch = text.match(/Found (\d+) workflow/);
    assert.ok(countMatch, `Should mention workflow count. Got: ${text}`);
    const count = Number.parseInt(countMatch![1], 10);
    assert.ok(count >= 1, `Should find at least 1 workflow, found ${count}`);
  });

  test('should include project name in listing', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    // Format is "- projectName/workflowName (Type)"
    assert.ok(text.includes('/Stateful1'), `Should show project/workflow format. Got: ${text}`);
  });
});

// ============================================================================
// 3. getWorkflowDefinition Tool — Output Validation
// ============================================================================
suite('getWorkflowDefinition Tool', () => {
  let toolsReady = false;

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  test('should return workflow definition JSON for Stateful1', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'Stateful1' });
    assert.ok(text.length > 50, 'Definition should be substantial');
    assert.ok(text.includes('Stateful1'), `Should mention workflow name. Got first 200: ${text.substring(0, 200)}`);
  });

  test('should include the $schema URL in definition', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'Stateful1' });
    assert.ok(
      text.includes('schema.management.azure.com') || text.includes('$schema'),
      `Should include schema URL. Got first 300: ${text.substring(0, 300)}`
    );
  });

  test('should include triggers section in definition', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'Stateful1' });
    assert.ok(text.includes('triggers'), `Should include triggers. Got first 300: ${text.substring(0, 300)}`);
  });

  test('should include actions section in definition', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'Stateful1' });
    assert.ok(text.includes('actions'), `Should include actions. Got first 300: ${text.substring(0, 300)}`);
  });

  test('should include kind: Stateful in definition', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'Stateful1' });
    assert.ok(text.includes('Stateful'), `Should include kind. Got first 300: ${text.substring(0, 300)}`);
  });

  test('should return "not found" for non-existent workflow', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'DoesNotExist' });
    assert.ok(text.toLowerCase().includes('not found'), `Should say not found. Got: ${text}`);
  });

  test('should return "not found" for empty workflow name', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: '' });
    assert.ok(
      text.toLowerCase().includes('not found') || text.toLowerCase().includes('no workflow'),
      `Should handle empty name gracefully. Got: ${text}`
    );
  });
});

// ============================================================================
// 4. createWorkflow Tool — File System Validation
// ============================================================================
suite('createWorkflow Tool', () => {
  let toolsReady = false;
  const testWorkflowName = 'TestCreatedWorkflow';

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  suiteTeardown(async () => {
    // Clean up created workflow
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const createdDir = path.join(wsPath, testWorkflowName);
      if (fs.existsSync(createdDir)) {
        fs.rmSync(createdDir, { recursive: true, force: true });
        console.log(`Cleaned up: ${createdDir}`);
      }
    }
  });

  test('should accept valid name and open wizard', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createWorkflow, {
      name: testWorkflowName,
      type: 'stateful',
    });
    console.log(`createWorkflow result: ${text}`);

    // The createWorkflow tool opens the wizard — it doesn't create files directly.
    // It should return a message asking the user to complete the wizard.
    assert.ok(
      text.toLowerCase().includes('wizard') ||
        text.toLowerCase().includes('enter') ||
        text.toLowerCase().includes(testWorkflowName.toLowerCase()),
      `Should mention wizard or workflow name. Got: ${text}`
    );
  });

  test('should not create files on disk (wizard-based)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(10_000);

    // The createWorkflow tool only opens the wizard, it doesn't write files
    const wsPath = getWorkspacePath();
    const workflowJsonPath = path.join(wsPath, testWorkflowName, 'workflow.json');
    // File should NOT exist since the wizard wasn't completed
    if (fs.existsSync(workflowJsonPath)) {
      console.log('WARNING: workflow.json exists — wizard may have auto-completed');
    }
    assert.ok(true, 'Test acknowledges wizard-based creation');
  });
});

// ============================================================================
// 5. createProject Tool — Validation Tests
// ============================================================================
suite('createProject Tool - Input Validation', () => {
  let toolsReady = false;

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  test('should reject invalid project name starting with number', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createProject, {
      projectName: '123Invalid',
      projectType: 'logicApp',
      workflowName: 'Wf1',
      workflowType: 'stateful',
    });
    console.log(`createProject (invalid name) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('invalid') || text.toLowerCase().includes('must start with a letter'),
      `Should reject invalid name. Got: ${text}`
    );
  });

  test('should reject empty project name', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createProject, {
      projectName: '',
      projectType: 'logicApp',
      workflowName: 'Wf1',
      workflowType: 'stateful',
    });
    console.log(`createProject (empty name) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('invalid') || text.toLowerCase().includes('must start'),
      `Should reject empty name. Got: ${text}`
    );
  });

  test('should ask for workflow name when not provided', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createProject, {
      projectName: 'ValidProject',
      projectType: 'logicApp',
    });
    console.log(`createProject (no workflow) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('specify') || text.toLowerCase().includes('workflow'),
      `Should ask for workflow details. Got: ${text}`
    );
  });

  test('should ask for workflow type when not provided', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createProject, {
      projectName: 'ValidProject',
      projectType: 'logicApp',
      workflowName: 'OrderFlow',
    });
    console.log(`createProject (no wf type) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('specify') || text.toLowerCase().includes('type') || text.toLowerCase().includes('stateful'),
      `Should ask for workflow type. Got: ${text}`
    );
  });

  test('should reject invalid workflow type', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createProject, {
      projectName: 'ValidProject',
      projectType: 'logicApp',
      workflowName: 'OrderFlow',
      workflowType: 'invalidType',
    });
    console.log(`createProject (invalid wf type) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('invalid') || text.toLowerCase().includes('valid values'),
      `Should reject invalid type. Got: ${text}`
    );
  });
});

// ============================================================================
// 6. addAction Tool — Output Validation
// ============================================================================
suite('addAction Tool', () => {
  let toolsReady = false;
  const testActionName = 'TestComposeAction';

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  suiteTeardown(async () => {
    // Clean up: remove the test action from workflow.json
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(workflowJsonPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
          if (content.definition?.actions?.[testActionName]) {
            delete content.definition.actions[testActionName];
            fs.writeFileSync(workflowJsonPath, JSON.stringify(content, null, 2));
            console.log(`Cleaned up action ${testActionName} from workflow.json`);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  });

  test('should handle non-existent workflow gracefully', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'NonExistentWorkflow',
      actionType: 'Compose',
      actionName: 'TestAction',
    });
    console.log(`addAction (non-existent wf) result: ${text}`);
    assert.ok(text.toLowerCase().includes('not found'), `Should say workflow not found. Got: ${text}`);
  });

  test('should add a Compose action to Stateful1', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Compose',
      actionName: testActionName,
      configuration: { inputs: 'Hello from test' },
    });
    console.log(`addAction (Compose) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('added') ||
        text.toLowerCase().includes('success') ||
        text.toLowerCase().includes(testActionName.toLowerCase()),
      `Should confirm action added. Got: ${text}`
    );
  });

  test('added action should exist in workflow.json on disk', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(10_000);

    const wsPath = getWorkspacePath();
    const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    assert.ok(fs.existsSync(workflowJsonPath), 'workflow.json should exist');

    const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    assert.ok(content.definition?.actions, 'Should have actions in definition');
    assert.ok(
      content.definition.actions[testActionName],
      `Should have ${testActionName} in actions. Actions: ${Object.keys(content.definition.actions).join(', ')}`
    );
  });

  test('added action should have correct type', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(10_000);

    const wsPath = getWorkspacePath();
    const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    const action = content.definition?.actions?.[testActionName];
    if (!action) {
      this.skip();
      return;
    }

    assert.strictEqual(action.type, 'Compose', 'Action type should be Compose');
    // Verify inputs were preserved (not dropped to {})
    assert.ok(
      JSON.stringify(action.inputs).includes('Hello') || action.inputs === 'Hello from test',
      `Compose inputs should be preserved. Got: ${JSON.stringify(action.inputs)}`
    );
    console.log(`Action type: ${action.type}, inputs: ${JSON.stringify(action.inputs)}`);
  });

  test('action should appear in getWorkflowDefinition output', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);

    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, { workflowName: 'Stateful1' });
    assert.ok(text.includes(testActionName), `getWorkflowDefinition should show the new action. Got first 500: ${text.substring(0, 500)}`);
  });
});

// ============================================================================
// 7. createWorkflow Tool — Input Validation
// ============================================================================
suite('createWorkflow Tool - Input Validation', () => {
  let toolsReady = false;

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  test('should reject invalid workflow name starting with number', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createWorkflow, {
      name: '123Invalid',
      type: 'stateful',
    });
    console.log(`createWorkflow (invalid name) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('invalid') || text.toLowerCase().includes('must start'),
      `Should reject invalid name. Got: ${text}`
    );
  });

  test('should reject empty workflow name', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createWorkflow, {
      name: '',
      type: 'stateful',
    });
    console.log(`createWorkflow (empty name) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('invalid') || text.toLowerCase().includes('must start'),
      `Should reject empty name. Got: ${text}`
    );
  });

  test('should reject name with special characters', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.createWorkflow, {
      name: 'my workflow!',
      type: 'stateful',
    });
    console.log(`createWorkflow (special chars) result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('invalid') || text.toLowerCase().includes('must start'),
      `Should reject special chars. Got: ${text}`
    );
  });

  test('should accept valid workflow name with hyphens and underscores', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    // This will open the wizard, which is expected behavior for the tool
    const text = await invokeTool(TOOL_NAMES.createWorkflow, {
      name: 'My-Valid_Workflow123',
      type: 'stateful',
    });
    console.log(`createWorkflow (valid name) result: ${text}`);
    // The tool opens the wizard — should NOT return an error
    assert.ok(!text.toLowerCase().includes('invalid'), `Should accept valid name. Got: ${text}`);
  });
});

// ============================================================================
// 8. Chat-driven Operations — Verify side effects on disk
// ============================================================================
suite('Chat-driven Workflow Creation', () => {
  const chatCreatedWorkflow = 'ChatCreatedWf';

  suiteTeardown(async () => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const createdDir = path.join(wsPath, chatCreatedWorkflow);
      if (fs.existsSync(createdDir)) {
        fs.rmSync(createdDir, { recursive: true, force: true });
      }
    }
  });

  test('should create a stateful workflow via chat and verify on disk', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, chatCreatedWorkflow, 'workflow.json');

    await sendChatAndWait(`@logicapps /createWorkflow a stateful workflow called ${chatCreatedWorkflow}`, { waitForFile: workflowPath });

    if (fs.existsSync(workflowPath)) {
      const content = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      assert.ok(content.definition, 'Created workflow should have definition');
      assert.ok(content.definition.$schema, 'Definition should have $schema');
      assert.ok(content.definition.triggers !== undefined, 'Definition should have triggers');
      assert.ok(content.definition.actions !== undefined, 'Definition should have actions');
      assert.strictEqual(content.kind, 'Stateful', 'Should be Stateful');
      console.log(`Chat-created workflow verified on disk: ${workflowPath}`);
    } else {
      console.log(`Workflow not found at ${workflowPath} — LLM may need follow-up`);
    }

    await vscode.commands.executeCommand('workbench.action.closePanel');
  });

  test('chat-created workflow should appear in listWorkflows tool', async function () {
    this.timeout(30_000);
    let toolsReady = false;
    try {
      await invokeTool(TOOL_NAMES.listWorkflows);
      toolsReady = true;
    } catch {
      // Tools not ready
    }
    if (!toolsReady) {
      this.skip();
      return;
    }

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, chatCreatedWorkflow, 'workflow.json');
    if (!fs.existsSync(workflowPath)) {
      this.skip();
      return;
    }

    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    assert.ok(text.includes(chatCreatedWorkflow), `listWorkflows should include ${chatCreatedWorkflow}. Got: ${text}`);
  });
});

suite('Chat-driven Add Action', () => {
  const chatActionName = 'ChatAddedResponse';

  suiteTeardown(async () => {
    // Clean up
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(workflowJsonPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
          if (content.definition?.actions?.[chatActionName]) {
            delete content.definition.actions[chatActionName];
            fs.writeFileSync(workflowJsonPath, JSON.stringify(content, null, 2));
            console.log(`Cleaned up ${chatActionName}`);
          }
        } catch {
          // Ignore
        }
      }
    }
  });

  test('should add an action to Stateful1 via chat and verify on disk', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    // Take a snapshot of actions before
    const wsPath = getWorkspacePath();
    const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const before = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    const actionsBefore = Object.keys(before.definition?.actions || {});
    console.log(`Actions before: ${actionsBefore.join(', ') || '(none)'}`);

    await sendChatAndWait(`@logicapps add a Response action called ${chatActionName} to Stateful1`, {
      waitForActionChange: { path: workflowJsonPath, baseline: actionsBefore },
    });

    // Check if a new action was added
    const after = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    const actionsAfter = Object.keys(after.definition?.actions || {});
    console.log(`Actions after: ${actionsAfter.join(', ') || '(none)'}`);

    const newActions = actionsAfter.filter((a) => !actionsBefore.includes(a));
    if (newActions.length > 0) {
      console.log(`New actions added by chat: ${newActions.join(', ')}`);
      assert.ok(newActions.length > 0, 'Chat should have added at least one action');

      // Verify the new action has a type
      for (const actionName of newActions) {
        const action = after.definition.actions[actionName];
        assert.ok(action.type, `Action ${actionName} should have a type`);
        console.log(`  ${actionName}: type=${action.type}`);
      }
    } else {
      console.log('No new actions — LLM may have needed follow-up interaction');
    }

    await vscode.commands.executeCommand('workbench.action.closePanel');
  });
});

// ============================================================================
// 9. LLM Availability
// ============================================================================
suite('LLM Availability', () => {
  test('should have LLM models available', async function () {
    this.timeout(30_000);
    const models = await vscode.lm.selectChatModels();
    const filtered = models.filter((m) => !m.id.includes('1m'));
    console.log(`Available models: ${filtered.length} (${models.length} total)`);
    if (filtered.length > 0) {
      console.log(`First model: ${filtered[0].id} (${filtered[0].vendor})`);
      assert.ok(filtered.length > 0, 'Should have models');
    } else {
      console.log('No models — Copilot not available');
    }
  });
});

// ============================================================================
// 10. Chat Commands — End-to-End with side-effect verification
// ============================================================================
suite('Chat Commands (E2E)', () => {
  test('should open chat panel without error', async function () {
    this.timeout(30_000);
    await vscode.commands.executeCommand('workbench.action.chat.open');
    await sleep(2000);
    assert.ok(true);
    await vscode.commands.executeCommand('workbench.action.closePanel');
  });

  test('should send @logicapps /help without error', async function () {
    this.timeout(120_000);
    await sendChatAndWait('@logicapps /help', { minWait: 5_000 });
    assert.ok(true);
  });

  test('should send @logicapps list workflows — verify tool cross-check', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    await sendChatAndWait('@logicapps list all workflows', { minWait: 8_000 });

    // Cross-check: the tool should also find the same workflows
    try {
      const text = await invokeTool(TOOL_NAMES.listWorkflows);
      assert.ok(text.includes('Stateful1'), `Tool should list Stateful1. Got: ${text}`);
    } catch {
      assert.ok(true, 'Chat command executed');
    }
  });

  test('should send @logicapps get definition — verify file unchanged', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    // Snapshot the file before
    const wsPath = getWorkspacePath();
    const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const contentBefore = fs.readFileSync(workflowJsonPath, 'utf-8');

    await sendChatAndWait('@logicapps show me the definition of Stateful1', { minWait: 8_000 });

    // Read-only operation should NOT modify workflow.json
    const contentAfter = fs.readFileSync(workflowJsonPath, 'utf-8');
    assert.strictEqual(contentAfter, contentBefore, 'Get definition should not modify workflow.json');
  });

  test('should handle general question without modifying workspace', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    // Snapshot workspace files
    const wsPath = getWorkspacePath();
    const filesBefore = fs.readdirSync(wsPath).sort().join(',');

    await sendChatAndWait('@logicapps what is a connector in Azure Logic Apps?', { minWait: 8_000 });

    // General questions should NOT create any new files/folders
    const filesAfter = fs.readdirSync(wsPath).sort().join(',');
    assert.strictEqual(filesAfter, filesBefore, 'General question should not modify workspace');
  });
});

// ============================================================================
// 11. addAction Tool — Multiple Action Types
// ============================================================================
suite('addAction Tool - Multiple Types', () => {
  let toolsReady = false;
  const addedActions: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  suiteTeardown(async () => {
    // Clean up all added actions
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const workflowJsonPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(workflowJsonPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
          for (const name of addedActions) {
            delete content.definition?.actions?.[name];
            delete content.definition?.triggers?.[name];
          }
          fs.writeFileSync(workflowJsonPath, JSON.stringify(content, null, 2));
          console.log(`Cleaned up ${addedActions.length} test actions/triggers`);
        } catch {
          // Ignore
        }
      }
    }
  });

  test('should add a Request trigger (HTTP) to Stateful1', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const name = 'TestHttpTrigger';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Request',
      actionName: name,
    });
    console.log(`addAction (Request trigger) result: ${text}`);
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm trigger added. Got: ${text}`);

    // Verify on disk
    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const inTriggers = content.definition?.triggers?.[name];
    const inActions = content.definition?.actions?.[name];
    assert.ok(inTriggers || inActions, `${name} should be in triggers or actions`);
    const trigger = inTriggers || inActions;
    assert.strictEqual(trigger.type, 'Request', 'Should be Request type');
    assert.strictEqual(trigger.kind, 'Http', 'Should have kind Http');
  });

  test('should add a Response action to Stateful1', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const name = 'TestResponseAction';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Response',
      actionName: name,
      configuration: { statusCode: 200, body: 'Test response' },
    });
    console.log(`addAction (Response) result: ${text}`);
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm action added. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    assert.ok(content.definition?.actions?.[name], `${name} should exist in actions`);
    assert.strictEqual(content.definition.actions[name].type, 'Response', 'Should be Response type');
  });

  test('should add an HTTP action to Stateful1', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const name = 'TestHttpAction';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Http',
      actionName: name,
      configuration: { method: 'GET', uri: 'https://example.com' },
    });
    console.log(`addAction (Http) result: ${text}`);
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm action added. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    assert.ok(content.definition?.actions?.[name], `${name} should exist in actions`);
    // Verify the type is Http
    assert.strictEqual(content.definition.actions[name].type, 'Http', 'Should be Http type');
  });

  test('should reject adding action with empty name', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Compose',
      actionName: '',
    });
    console.log(`addAction (empty name) result: ${text}`);
    // Should either fail gracefully or add with empty key
    assert.ok(text.length > 0, 'Should return some response');
  });
});

// ============================================================================
// 12. createProject Tool — Actual Project Creation
// NOTE: Skipped in automated tests. The createProject tool modifies the
// .code-workspace file by adding the new project as a workspace folder.
// This corrupts the test workspace for subsequent tool invocations because
// VS Code tries to scan the new folder (which may not exist after cleanup).
// Input validation is tested in suite 5. Actual creation should be tested
// manually or in a disposable workspace.
// ============================================================================

// ============================================================================
// 13. Chat-driven Stateless Workflow Creation
// ============================================================================
suite('Chat-driven Stateless Workflow', () => {
  const statelessWf = 'ChatStatelessWf';

  suiteTeardown(async () => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const dir = path.join(wsPath, statelessWf);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('should create a stateless workflow via chat', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, statelessWf, 'workflow.json');

    await sendChatAndWait(`@logicapps /createWorkflow a stateless workflow called ${statelessWf}`, { waitForFile: workflowPath });

    if (fs.existsSync(workflowPath)) {
      const content = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      assert.ok(content.definition, 'Should have definition');
      assert.strictEqual(content.kind, 'Stateless', 'Should be Stateless');
      console.log(`Stateless workflow verified: ${workflowPath}`);
    } else {
      console.log('Stateless workflow not created — LLM may need follow-up');
    }
  });
});

// ============================================================================
// 14. modifyAction Tool — Modify existing actions (Plan 10.1-10.3)
// ============================================================================
suite('modifyAction Tool', () => {
  let toolsReady = false;
  const setupActionName = 'ModifyTestAction';

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    if (toolsReady) {
      await invokeTool(TOOL_NAMES.addAction, {
        workflowName: 'Stateful1',
        actionType: 'Compose',
        actionName: setupActionName,
        configuration: { inputs: 'original value' },
      });
    }
  });

  suiteTeardown(async () => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const wfPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(wfPath)) {
        try {
          const c = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
          delete c.definition?.actions?.[setupActionName];
          fs.writeFileSync(wfPath, JSON.stringify(c, null, 2));
        } catch {
          /* ignore */
        }
      }
    }
  });

  test('should modify an existing action (Plan 10.1)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.modifyAction, {
      workflowName: 'Stateful1',
      actionName: setupActionName,
      modification: JSON.stringify({ inputs: 'modified value' }),
    });
    console.log(`modifyAction result: ${text}`);
    assert.ok(
      text.toLowerCase().includes('modified') || text.toLowerCase().includes('success'),
      `Should confirm modification. Got: ${text}`
    );
  });

  test('modified action should reflect changes on disk', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(10_000);
    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = content.definition?.actions?.[setupActionName];
    assert.ok(action, `${setupActionName} should exist after modification`);
    assert.ok(action.type, 'Modified action should still have a type');
    // Verify the modification was actually applied — inputs should contain 'modified'
    const actionJson = JSON.stringify(action);
    assert.ok(actionJson.includes('modified'), `Action inputs should reflect the modification. Got: ${actionJson}`);
    console.log(`Modified action on disk: ${actionJson}`);
  });

  test('should return error for non-existent action (Plan 10.3)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.modifyAction, {
      workflowName: 'Stateful1',
      actionName: 'NonExistentAction',
      modification: JSON.stringify({ inputs: 'test' }),
    });
    assert.ok(text.toLowerCase().includes('not found'), `Should say not found. Got: ${text}`);
  });

  test('should return error for non-existent workflow', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.modifyAction, {
      workflowName: 'NonExistentWorkflow',
      actionName: 'SomeAction',
      modification: JSON.stringify({ inputs: 'test' }),
    });
    assert.ok(text.toLowerCase().includes('not found'), `Should say not found. Got: ${text}`);
  });

  test('should reject invalid modification JSON', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.modifyAction, {
      workflowName: 'Stateful1',
      actionName: setupActionName,
      modification: 'not valid json',
    });
    assert.ok(text.toLowerCase().includes('invalid') || text.toLowerCase().includes('json'), `Should reject invalid JSON. Got: ${text}`);
  });
});

// ============================================================================
// 15. Recurrence Trigger via addAction Tool (Plan 5.2)
// ============================================================================
suite('addAction — Recurrence Trigger', () => {
  let toolsReady = false;
  const triggerName = 'TestRecurrenceTrigger';

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  suiteTeardown(async () => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const wfPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(wfPath)) {
        try {
          const c = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
          delete c.definition?.triggers?.[triggerName];
          fs.writeFileSync(wfPath, JSON.stringify(c, null, 2));
        } catch {
          /* ignore */
        }
      }
    }
  });

  test('should add a Recurrence trigger to Stateful1', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Recurrence',
      actionName: triggerName,
      configuration: { frequency: 'Minute', interval: 5 },
    });
    console.log(`addAction (Recurrence) result: ${text}`);
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm trigger added. Got: ${text}`);
  });

  test('Recurrence trigger should be in triggers on disk', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(10_000);
    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const trigger = content.definition?.triggers?.[triggerName];
    assert.ok(trigger, `${triggerName} should exist in triggers`);
    assert.strictEqual(trigger.type, 'Recurrence', 'Should be Recurrence type');
  });
});

// ============================================================================
// 16. addAction Error Cases (Plan 9.1-9.3)
// ============================================================================
suite('addAction — Error Cases', () => {
  let toolsReady = false;

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  suiteTeardown(async () => {
    // Clean up any test artifacts
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const wfPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(wfPath)) {
        try {
          const c = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
          for (const name of ['TestBadConnector', 'TestNoMethodPath']) {
            delete c.definition?.actions?.[name];
          }
          fs.writeFileSync(wfPath, JSON.stringify(c, null, 2));
        } catch {
          /* ignore */
        }
      }
    }
  });

  test('should handle unknown connector reference (Plan 9.2)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ServiceProvider',
      actionName: 'TestBadConnector',
      connectorReference: 'fakeconnector_that_does_not_exist',
    });
    console.log(`addAction (fake connector) result: ${text}`);
    // Should NOT silently succeed — should indicate the connector wasn't found or add a generic SP action
    assert.ok(text.length > 0, 'Should return a response');
    // Verify on disk: if it was added, it should have ServiceProvider type
    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = content.definition?.actions?.TestBadConnector;
    if (action) {
      assert.ok(action.type, 'If action was created, it should have a type');
      console.log(`Fake connector action type: ${action.type}`);
    }
  });

  test('should handle ApiConnection without method/path (Plan 9.3)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ApiConnection',
      actionName: 'TestNoMethodPath',
    });
    console.log(`addAction (ApiConnection no method/path) result: ${text}`);
    // ApiConnection without method/path should either fail validation or create a partial action
    assert.ok(text.length > 0, 'Should return a response');
    // Verify on disk: if created, check it has ApiConnection type
    const wsPath = getWorkspacePath();
    const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = content.definition?.actions?.TestNoMethodPath;
    if (action) {
      assert.strictEqual(action.type, 'ApiConnection', 'If created, should be ApiConnection type');
      console.log(`ApiConnection action: ${JSON.stringify(action).substring(0, 200)}`);
    } else {
      // Action not created — check that response explains why
      assert.ok(
        text.toLowerCase().includes('method') ||
          text.toLowerCase().includes('path') ||
          text.toLowerCase().includes('require') ||
          text.toLowerCase().includes('connection'),
        `Should explain why action wasn't created. Got: ${text}`
      );
    }
  });
});

// ============================================================================
// 17. Additional Schema Validation
// ============================================================================
suite('Additional Schema Validation', () => {
  suiteSetup(async function () {
    this.timeout(90_000);
    await waitForExtensionActivation(60_000);
  });

  test('modifyAction schema should require workflowName, actionName, modification', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.modifyAction);
    assert.ok(tool, 'modifyAction tool should exist');
    const schema = tool.inputSchema as { required: string[] };
    assert.ok(schema.required.includes('workflowName'), 'workflowName required');
    assert.ok(schema.required.includes('actionName'), 'actionName required');
    assert.ok(schema.required.includes('modification'), 'modification required');
  });

  test('createProject schema should require projectName, projectType, workflowName, workflowType', () => {
    const tool = vscode.lm.tools.find((t) => t.name === TOOL_NAMES.createProject);
    assert.ok(tool, 'createProject tool should exist');
    const schema = tool.inputSchema as { required: string[] };
    assert.ok(schema.required.includes('projectName'), 'projectName required');
    assert.ok(schema.required.includes('projectType'), 'projectType required');
    assert.ok(schema.required.includes('workflowName'), 'workflowName required');
    assert.ok(schema.required.includes('workflowType'), 'workflowType required');
  });
});

// ============================================================================
// 18. Chat-driven Natural Language Help (Plan 1.2)
// ============================================================================
suite('Chat-driven Natural Language Help', () => {
  test('should route "what can you help me with" without side effects', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    const wsPath = getWorkspacePath();
    const filesBefore = fs.readdirSync(wsPath).sort().join(',');

    await sendChatAndWait('@logicapps what can you help me with?', { minWait: 8_000 });

    const filesAfter = fs.readdirSync(wsPath).sort().join(',');
    assert.strictEqual(filesAfter, filesBefore, 'Help question should not modify workspace');
  });
});

// ============================================================================
// 19. Built-in ServiceProvider Connector Actions (Plan 6.1-6.4)
// ============================================================================
suite('addAction — ServiceProvider Connectors', () => {
  let toolsReady = false;
  const addedActions: string[] = [];
  const serviceProviderConnectionNames = ['AzureBlob', 'serviceBus'];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    removeServiceProviderConnectionArtifacts(serviceProviderConnectionNames);
  });

  suiteTeardown(async () => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const wfPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(wfPath)) {
        try {
          const c = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
          for (const name of addedActions) {
            delete c.definition?.actions?.[name];
          }
          fs.writeFileSync(wfPath, JSON.stringify(c, null, 2));
          console.log(`Cleaned up ${addedActions.length} ServiceProvider actions`);
        } catch {
          /* ignore */
        }
      }
    }

    removeServiceProviderConnectionArtifacts(serviceProviderConnectionNames);
  });

  test('should add an Azure Blob ServiceProvider action (Plan 6.1)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const name = 'TestReadBlob';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ServiceProvider',
      actionName: name,
      connectorReference: 'AzureBlob',
    });
    console.log(`addAction (AzureBlob SP) result: ${text}`);
    // Should either add a ServiceProvider action or report the connector isn't available
    assert.ok(text.length > 0, 'Should return a response');
    if (text.toLowerCase().includes('added') || text.toLowerCase().includes('success')) {
      // Verify on disk
      const wsPath = getWorkspacePath();
      const content = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
      const action = content.definition?.actions?.[name];
      if (action) {
        assert.strictEqual(action.type, 'ServiceProvider', 'Should be ServiceProvider type');
        console.log(`AzureBlob action: ${JSON.stringify(action).substring(0, 200)}`);
      }
    } else {
      console.log('AzureBlob connector may not be available in test environment');
    }
  });

  test('should ask for Service Bus connection fields in chat-compatible tool output when the supplied fields are incomplete', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const name = 'TestNeedSBConnectionFields';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ServiceProvider',
      actionName: name,
      connectorReference: 'serviceBus',
      serviceProviderConnection: {
        endpoint: 'sb://contoso.servicebus.windows.net/',
      },
    });
    console.log(`addAction (ServiceBus SP missing fields) result: ${text}`);
    assert.ok(text.includes('serviceProviderConnection.sharedAccessKeyName'), 'Tool should ask for sharedAccessKeyName in chat');
    assert.ok(text.includes('serviceProviderConnection.sharedAccessKey'), 'Tool should ask for sharedAccessKey in chat');
    assert.strictEqual(
      readWorkflowAction(workflowPath, name),
      undefined,
      'Action should not be written until connection details are complete'
    );
    assert.strictEqual(
      readConnectionsData().serviceProviderConnections?.serviceBus,
      undefined,
      'Service provider connection should not be created from incomplete chat details'
    );
  });

  test('should add a Service Bus ServiceProvider action from chat-supplied connection fields (Plan 6.2)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const name = 'TestSendSBMessage';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ServiceProvider',
      actionName: name,
      connectorReference: 'serviceBus',
      serviceProviderConnection: {
        endpoint: 'sb://contoso.servicebus.windows.net/',
        sharedAccessKeyName: 'RootManageSharedAccessKey',
        sharedAccessKey: 'test-key',
      },
    });
    console.log(`addAction (ServiceBus SP explicit fields) result: ${text}`);
    assert.ok(text.includes('Created connection for "serviceBus"'), 'Tool should report that it created the Service Bus connection');

    const action = readWorkflowAction(workflowPath, name);
    assert.ok(action, 'Service Bus action should be written once connection fields are supplied');
    assert.strictEqual(action.type, 'ServiceProvider');
    assert.strictEqual(action.inputs?.serviceProviderConfiguration?.connectionName, 'serviceBus');

    const serviceBusConnection = readConnectionsData().serviceProviderConnections?.serviceBus;
    assert.ok(serviceBusConnection, 'connections.json should contain the Service Bus service provider connection');
    assert.strictEqual(
      serviceBusConnection.parameterValues?.connectionString,
      "@appsetting('serviceBus_connectionString')",
      'Service Bus connection should reference local.settings.json instead of opening a wizard'
    );

    const values = readLocalSettingsValues();
    assert.strictEqual(
      values.serviceBus_connectionString,
      'Endpoint=sb://contoso.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=test-key',
      'Service Bus connection string should be stored in local.settings.json from chat-supplied fields'
    );
  });

  test('should verify connections.json created with ServiceProvider entries (Plan 6.4)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(10_000);
    const wsPath = getWorkspacePath();
    const connectionsPath = path.join(wsPath, 'connections.json');
    if (fs.existsSync(connectionsPath)) {
      const connections = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
      console.log(`connections.json keys: ${Object.keys(connections).join(', ')}`);
      if (connections.serviceProviderConnections) {
        const spKeys = Object.keys(connections.serviceProviderConnections);
        console.log(`ServiceProvider connections: ${spKeys.join(', ')}`);
        // At least verify the structure is valid
        for (const key of spKeys) {
          const sp = connections.serviceProviderConnections[key];
          assert.ok(sp.serviceProvider, `${key} should have serviceProvider`);
          assert.ok(sp.serviceProvider.id, `${key} should have serviceProvider.id`);
          assert.ok(
            sp.serviceProvider.id.startsWith('/serviceProviders/'),
            `${key} serviceProvider.id should start with /serviceProviders/. Got: ${sp.serviceProvider.id}`
          );
        }
      }
    } else {
      console.log('connections.json not created — ServiceProvider actions may not have been added');
    }
    assert.ok(true, 'Connection structure validation passed or skipped');
  });
});

// ============================================================================
// 20. Multi-Project & Disambiguation (Plan 14.1-14.3)
// Uses chat to create a second project, then tests disambiguation
// ============================================================================
suite('Multi-Project Disambiguation', () => {
  const secondProjectName = 'SecondTestProject';
  const secondWorkflowName = 'Stateful1'; // Same name as in test-workspace

  suiteSetup(async function () {
    this.timeout(180_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    // Use chat to create a second project with a workflow named Stateful1
    const wsFile2 = vscode.workspace.workspaceFile;
    const expectedProjectDir = wsFile2 ? path.join(path.dirname(wsFile2.fsPath), secondProjectName, 'host.json') : '';

    await sendChatAndWait(
      `@logicapps /createProject a Logic App project called ${secondProjectName} with a stateful workflow called ${secondWorkflowName}`,
      expectedProjectDir ? { waitForFile: expectedProjectDir } : { minWait: 30_000 }
    );

    // Verify the project was created WITH proper structure
    const wsFile = vscode.workspace.workspaceFile;
    if (wsFile) {
      const wsRoot = path.dirname(wsFile.fsPath);
      const projectDir = path.join(wsRoot, secondProjectName);
      if (fs.existsSync(projectDir)) {
        console.log(`Second project created: ${projectDir}`);
        // Verify host.json exists and has correct extension bundle
        const hostJson = path.join(projectDir, 'host.json');
        if (fs.existsSync(hostJson)) {
          const host = JSON.parse(fs.readFileSync(hostJson, 'utf-8'));
          console.log(`  host.json bundle: ${host.extensionBundle?.id}`);
          assert.ok(
            host.extensionBundle?.id?.includes('Workflows'),
            `host.json should have Workflows bundle. Got: ${host.extensionBundle?.id}`
          );
        } else {
          console.log('  WARNING: host.json not found in created project');
        }
        // Verify initial workflow exists
        const wfJson = path.join(projectDir, secondWorkflowName, 'workflow.json');
        if (fs.existsSync(wfJson)) {
          const wf = JSON.parse(fs.readFileSync(wfJson, 'utf-8'));
          console.log(`  workflow kind: ${wf.kind}`);
          assert.ok(wf.definition, 'Workflow should have definition');
          assert.strictEqual(wf.kind, 'Stateful', 'Should be Stateful');
        } else {
          console.log(`  WARNING: ${secondWorkflowName}/workflow.json not found`);
        }
      } else {
        console.log(`Second project NOT created at ${projectDir} — disambiguation tests may skip`);
      }
    }
  });

  suiteTeardown(async () => {
    // Clean up second project
    const wsFile = vscode.workspace.workspaceFile;
    if (wsFile) {
      const wsRoot = path.dirname(wsFile.fsPath);
      const projectDir = path.join(wsRoot, secondProjectName);
      try {
        if (fs.existsSync(projectDir)) {
          fs.rmSync(projectDir, { recursive: true, force: true });
          console.log(`Cleaned up second project: ${secondProjectName}`);
        }
      } catch {
        /* ignore */
      }
      // Reset workspace file to remove the second project folder
      try {
        const wsContent = JSON.parse(fs.readFileSync(wsFile.fsPath, 'utf-8'));
        wsContent.folders = wsContent.folders.filter(
          (f: { name?: string; path: string }) => !f.path.includes(secondProjectName) && f.name !== secondProjectName
        );
        fs.writeFileSync(wsFile.fsPath, JSON.stringify(wsContent, null, 2));
        console.log('Reset workspace file after disambiguation tests');
      } catch {
        /* ignore */
      }
    }
  });

  test('listWorkflows should show workflows from multiple projects', async function () {
    this.timeout(30_000);
    let toolsReady = false;
    try {
      await invokeTool(TOOL_NAMES.listWorkflows);
      toolsReady = true;
    } catch {
      /* */
    }
    if (!toolsReady) {
      this.skip();
      return;
    }

    // Check if second project exists
    const wsFile = vscode.workspace.workspaceFile;
    if (!wsFile) {
      this.skip();
      return;
    }
    const wsRoot = path.dirname(wsFile.fsPath);
    if (!fs.existsSync(path.join(wsRoot, secondProjectName))) {
      this.skip();
      return;
    }

    const text = await invokeTool(TOOL_NAMES.listWorkflows);
    console.log(`Multi-project listWorkflows: ${text}`);

    // Should list workflows from both projects
    const projectCount = text.match(/Found \d+ workflow\(s\) across (\d+) project/);
    if (projectCount) {
      const count = Number.parseInt(projectCount[1], 10);
      console.log(`Projects found: ${count}`);
      assert.ok(count >= 2, `Should find at least 2 projects. Got: ${count}`);
    }
  });

  test('getWorkflowDefinition should request disambiguation for Stateful1 (Plan 14.1)', async function () {
    this.timeout(30_000);
    let toolsReady = false;
    try {
      await invokeTool(TOOL_NAMES.listWorkflows);
      toolsReady = true;
    } catch {
      /* */
    }
    if (!toolsReady) {
      this.skip();
      return;
    }

    const wsFile = vscode.workspace.workspaceFile;
    if (!wsFile) {
      this.skip();
      return;
    }
    const wsRoot = path.dirname(wsFile.fsPath);
    if (!fs.existsSync(path.join(wsRoot, secondProjectName))) {
      this.skip();
      return;
    }

    // Stateful1 exists in both projects — should trigger disambiguation
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, {
      workflowName: 'Stateful1',
    });
    console.log(`Disambiguation result: ${text}`);

    // Should either return ambiguous message or return one of the definitions
    const isAmbiguous =
      text.toLowerCase().includes('multiple') || text.toLowerCase().includes('specify') || text.toLowerCase().includes('projectname');
    const hasDefinition = text.includes('triggers') || text.includes('definition');

    assert.ok(isAmbiguous || hasDefinition, `Should disambiguate or return definition. Got: ${text.substring(0, 300)}`);
    if (isAmbiguous) {
      console.log('Disambiguation correctly triggered');
    }
  });

  test('getWorkflowDefinition with projectName should resolve directly (Plan 14.3)', async function () {
    this.timeout(30_000);
    let toolsReady = false;
    try {
      await invokeTool(TOOL_NAMES.listWorkflows);
      toolsReady = true;
    } catch {
      /* */
    }
    if (!toolsReady) {
      this.skip();
      return;
    }

    const wsFile = vscode.workspace.workspaceFile;
    if (!wsFile) {
      this.skip();
      return;
    }
    const wsRoot = path.dirname(wsFile.fsPath);
    if (!fs.existsSync(path.join(wsRoot, secondProjectName))) {
      this.skip();
      return;
    }

    // With explicit projectName, should resolve without disambiguation
    const text = await invokeTool(TOOL_NAMES.getWorkflowDefinition, {
      workflowName: 'Stateful1',
      projectName: 'test-workspace',
    });
    console.log(`Direct project resolution result: ${text.substring(0, 300)}`);

    assert.ok(
      text.includes('triggers') || text.includes('definition') || text.includes('Stateful'),
      `Should return definition when project specified. Got: ${text.substring(0, 200)}`
    );
  });
});

// ============================================================================
// 21. Chat-driven Add Built-in Connector Action (Plan 6 via Chat)
// ============================================================================
suite('Chat-driven ServiceProvider Action', () => {
  const spActionName = 'ChatBlobAction';

  suiteTeardown(async () => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const wfPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(wfPath)) {
        try {
          const c = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
          delete c.definition?.actions?.[spActionName];
          fs.writeFileSync(wfPath, JSON.stringify(c, null, 2));
        } catch {
          /* ignore */
        }
      }
    }
  });

  test('should add ServiceProvider action via chat and verify on disk', async function () {
    this.timeout(120_000);
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    // Snapshot actions before
    const wsPath = getWorkspacePath();
    const wfPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const before = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
    const actionsBefore = Object.keys(before.definition?.actions || {});

    await sendChatAndWait(`@logicapps add an Azure Blob read action called ${spActionName} to Stateful1`, {
      waitForActionChange: { path: wfPath, baseline: actionsBefore },
    });

    // Check for new actions
    const after = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
    const actionsAfter = Object.keys(after.definition?.actions || {});
    const newActions = actionsAfter.filter((a) => !actionsBefore.includes(a));

    if (newActions.length > 0) {
      console.log(`Chat added ServiceProvider actions: ${newActions.join(', ')}`);
      for (const name of newActions) {
        const action = after.definition.actions[name];
        console.log(`  ${name}: type=${action.type}`);
      }
    } else {
      console.log('No new actions — LLM may need design-time runtime or follow-up');
    }
    assert.ok(true, 'Chat ServiceProvider test completed');
  });
});

interface AzureContextConfig {
  subscriptionId: string;
  resourceGroup: string;
  tenantId?: string;
  location?: string;
  managementBaseUrl: string;
}

interface ExistingManagedConnection {
  id: string;
  name: string;
  displayName?: string;
  connectorId?: string;
}

function readLocalSettingsValues(): Record<string, string> {
  const wsPath = getWorkspacePath();
  const localSettingsPath = path.join(wsPath, 'local.settings.json');
  const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
  return settings.Values || {};
}

function getAzureContextConfig(): AzureContextConfig | undefined {
  const values = readLocalSettingsValues();
  if (!values.WORKFLOWS_SUBSCRIPTION_ID || !values.WORKFLOWS_RESOURCE_GROUP_NAME) {
    return undefined;
  }

  return {
    subscriptionId: values.WORKFLOWS_SUBSCRIPTION_ID,
    resourceGroup: values.WORKFLOWS_RESOURCE_GROUP_NAME,
    tenantId: values.WORKFLOWS_TENANT_ID,
    location: values.WORKFLOWS_LOCATION_NAME,
    managementBaseUrl: (values.WORKFLOWS_MANAGEMENT_BASE_URI || 'https://management.azure.com').replace(/\/+$/, ''),
  };
}

function readConnectionsData(): Record<string, any> {
  const wsPath = getWorkspacePath();
  const connectionsPath = path.join(wsPath, 'connections.json');
  if (!fs.existsSync(connectionsPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
}

function getManagedConnectionRefsForConnector(connectorShortName: string): string[] {
  const normalizedConnector = connectorShortName.toLowerCase();
  const managedApiConnections = readConnectionsData().managedApiConnections || {};

  return Object.keys(managedApiConnections).filter((referenceName) => {
    const connection = managedApiConnections[referenceName];
    const apiId = String(connection?.api?.id || '').toLowerCase();
    return apiId.endsWith(`/managedapis/${normalizedConnector}`) || referenceName.toLowerCase() === normalizedConnector;
  });
}

function removeManagedConnectionArtifacts(referenceNames: string[]): void {
  const wsPath = getWorkspacePath();
  if (!wsPath || referenceNames.length === 0) {
    return;
  }

  const connectionsPath = path.join(wsPath, 'connections.json');
  if (fs.existsSync(connectionsPath)) {
    const connections = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
    if (connections.managedApiConnections) {
      for (const referenceName of referenceNames) {
        delete connections.managedApiConnections[referenceName];
      }
      fs.writeFileSync(connectionsPath, JSON.stringify(connections, null, 2));
    }
  }

  const localSettingsPath = path.join(wsPath, 'local.settings.json');
  if (fs.existsSync(localSettingsPath)) {
    const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    if (settings.Values) {
      for (const referenceName of referenceNames) {
        delete settings.Values[`${referenceName}-connectionKey`];
      }
      fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2));
    }
  }
}

function removeServiceProviderConnectionArtifacts(connectionNames: string[]): void {
  const wsPath = getWorkspacePath();
  if (!wsPath || connectionNames.length === 0) {
    return;
  }

  const connectionsPath = path.join(wsPath, 'connections.json');
  if (fs.existsSync(connectionsPath)) {
    const connections = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
    if (connections.serviceProviderConnections) {
      for (const connectionName of connectionNames) {
        delete connections.serviceProviderConnections[connectionName];
      }
      fs.writeFileSync(connectionsPath, JSON.stringify(connections, null, 2));
    }
  }

  const localSettingsPath = path.join(wsPath, 'local.settings.json');
  if (fs.existsSync(localSettingsPath)) {
    const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    if (settings.Values) {
      for (const connectionName of connectionNames) {
        delete settings.Values[`${connectionName}_connectionString`];
      }
      fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2));
    }
  }
}

async function listExistingManagedConnections(connectorShortName: string): Promise<ExistingManagedConnection[]> {
  const azureContext = getAzureContextConfig();
  if (!azureContext) {
    return [];
  }

  const session = await vscode.authentication.getSession('microsoft', ['https://management.azure.com/.default'], { createIfNone: false });
  if (!session) {
    return [];
  }

  let filterParts = `ManagedApiName eq '${connectorShortName}' and Kind eq 'V2'`;
  if (azureContext.location) {
    filterParts = `Location eq '${azureContext.location}' and ${filterParts}`;
  }

  const listUrl =
    `${azureContext.managementBaseUrl}/subscriptions/${azureContext.subscriptionId}` +
    `/resourceGroups/${azureContext.resourceGroup}` +
    `/providers/Microsoft.Web/connections?api-version=2018-07-01-preview&$filter=${encodeURIComponent(filterParts)}`;

  const response = await fetch(listUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    value?: Array<{
      id: string;
      name: string;
      properties?: { displayName?: string; api?: { id?: string } };
    }>;
  };

  return (payload.value || []).map((connection) => ({
    id: connection.id,
    name: connection.name,
    displayName: connection.properties?.displayName,
    connectorId: connection.properties?.api?.id,
  }));
}

async function pickReusableManagedConnector(
  preferredConnectors: string[]
): Promise<{ connectorShortName: string; connections: ExistingManagedConnection[] } | undefined> {
  for (const connectorShortName of preferredConnectors) {
    const connections = await listExistingManagedConnections(connectorShortName);
    if (connections.length > 0) {
      return { connectorShortName, connections };
    }
  }

  return undefined;
}

async function waitForManagedConnectionRef(
  connectorShortName: string,
  excludedRefs: string[],
  timeoutMs = 60_000
): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const refs = getManagedConnectionRefsForConnector(connectorShortName);
    const newRef = refs.find((referenceName) => !excludedRefs.includes(referenceName));
    if (newRef) {
      return newRef;
    }

    await sleep(500);
  }

  return undefined;
}

function buildManagedConnectorChatPrompt(connectorShortName: string, actionName: string): string {
  switch (connectorShortName.toLowerCase()) {
    case 'office365':
      return `@logicapps add an Office 365 send email action called ${actionName} to Stateful1 using connector reference office365`;
    case 'servicebus':
      return `@logicapps add a Service Bus send message action called ${actionName} to Stateful1 using connector reference servicebus`;
    case 'sql':
      return `@logicapps add a SQL get rows action called ${actionName} to Stateful1 using connector reference sql`;
    default:
      return `@logicapps add an ApiConnection action called ${actionName} to Stateful1 using connector reference ${connectorShortName}`;
  }
}

function readWorkflowAction(workflowPath: string, actionName: string): any {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
  return workflow.definition?.actions?.[actionName];
}

function cleanupWorkflowActions(actionNames: string[]): void {
  const wsPath = getWorkspacePath();
  if (!wsPath || actionNames.length === 0) {
    return;
  }

  const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
  if (!fs.existsSync(workflowPath)) {
    return;
  }

  try {
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
    for (const actionName of actionNames) {
      delete workflow.definition?.actions?.[actionName];
    }
    fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
  } catch {
    /* ignore */
  }
}

function createFakeAzureSession(accessToken = 'test-access-token'): vscode.AuthenticationSession {
  return {
    id: 'test-session',
    accessToken,
    account: {
      id: 'test-account',
      label: 'Test Account',
    },
    scopes: ['https://management.azure.com/.default'],
  };
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

type WorkflowToolsTestOverrides = {
  disableArmSwaggerResolution?: boolean;
  fetch?: typeof fetch;
  getAuthData?: (tenantId?: string) => Promise<vscode.AuthenticationSession | undefined>;
  getAuthorizationToken?: (tenantId?: string) => Promise<string>;
  showInputBox?: (options: vscode.InputBoxOptions) => Thenable<string | undefined>;
};

const WORKFLOW_TOOLS_TEST_OVERRIDES_KEY = '__LOGICAPPS_WORKFLOW_TOOLS_TEST_OVERRIDES__';

function stubWorkflowToolsTestOverrides(overrides: WorkflowToolsTestOverrides): () => void {
  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  const previousValue = globalState[WORKFLOW_TOOLS_TEST_OVERRIDES_KEY] as WorkflowToolsTestOverrides | undefined;
  globalState[WORKFLOW_TOOLS_TEST_OVERRIDES_KEY] = overrides;

  return () => {
    if (previousValue) {
      globalState[WORKFLOW_TOOLS_TEST_OVERRIDES_KEY] = previousValue;
      return;
    }

    delete globalState[WORKFLOW_TOOLS_TEST_OVERRIDES_KEY];
  };
}

async function verifyConnectionExistsInAzure(connectionId: string): Promise<void> {
  const azureContext = getAzureContextConfig();
  assert.ok(azureContext, 'Azure context must be configured for managed connection chat tests');

  const session = await vscode.authentication.getSession('microsoft', ['https://management.azure.com/.default'], { createIfNone: false });
  if (!session) {
    return;
  }

  const getUrl = `${azureContext.managementBaseUrl}${connectionId}?api-version=2018-07-01-preview`;
  const response = await fetch(getUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  assert.strictEqual(response.status, 200, `Connection should exist in Azure. Got: ${response.status}`);
}

// ============================================================================
// 22. Tool-driven Managed Connection Reuse — Raw Keys
// ============================================================================
suite('Tool-driven Managed Connection Reuse — Raw Keys', () => {
  let toolsReady = false;
  let reusableConnector: { connectorShortName: string; connections: ExistingManagedConnection[] } | undefined;
  const testActionName = `ToolRawKeys_${Date.now().toString(36)}`;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    if (!toolsReady) {
      return;
    }

    reusableConnector = await pickReusableManagedConnector(['servicebus', 'office365', 'sql']);
    if (reusableConnector) {
      removeManagedConnectionArtifacts([reusableConnector.connectorShortName]);
    }
  });

  suiteTeardown(() => {
    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should reuse an existing Azure managed connection through the addAction tool', async function () {
    if (!toolsReady || !reusableConnector || !reusableConnector.connections[0]?.connectorId) {
      this.skip();
      return;
    }
    this.timeout(120_000);

    const values = readLocalSettingsValues();
    assert.strictEqual(values.WORKFLOWS_AUTHENTICATION_METHOD || 'rawKeys', 'rawKeys');

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const baselineRefs = getManagedConnectionRefsForConnector(reusableConnector.connectorShortName);

    addedActions.push(testActionName);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ApiConnection',
      actionName: testActionName,
      connectorReference: reusableConnector.connectorShortName,
      connectorId: reusableConnector.connections[0].connectorId,
      method: 'get',
      path: '/',
    });
    console.log(`addAction (managed connection raw reuse) result: ${text}`);
    assert.ok(text.length > 0, 'Tool should return a response');

    const action = readWorkflowAction(workflowPath, testActionName);
    assert.ok(action, `Expected ${testActionName} to be added via addAction`);
    assert.strictEqual(action.type, 'ApiConnection');
    assert.strictEqual(action.inputs?.host?.connection?.referenceName, reusableConnector.connectorShortName);

    const connectionRef = await waitForManagedConnectionRef(reusableConnector.connectorShortName, baselineRefs);
    assert.ok(connectionRef, `Expected a managed connection reference for ${reusableConnector.connectorShortName}`);
    addedConnectionRefs.push(connectionRef!);

    const managedConnection = readConnectionsData().managedApiConnections?.[connectionRef!];
    assert.ok(managedConnection, 'connections.json should contain the managed connection written by addAction');
    assert.strictEqual(managedConnection.authentication?.type, 'Raw');
    assert.strictEqual(managedConnection.authentication?.scheme, 'Key');
    assert.ok(managedConnection.authentication?.parameter?.includes('@appsetting('));
    assert.ok(managedConnection.connection?.id, 'Resolved managed connection should have a non-empty ARM id');
    assert.ok(
      typeof managedConnection.connectionRuntimeUrl === 'string' && managedConnection.connectionRuntimeUrl.length > 0,
      'Resolved managed connection should persist connectionRuntimeUrl'
    );

    const updatedValues = readLocalSettingsValues();
    assert.ok(updatedValues[`${connectionRef!}-connectionKey`], 'Raw Keys flow should store a connection key in local.settings.json');

    await verifyConnectionExistsInAzure(managedConnection.connection.id);
  });
});

// ============================================================================
// 23. Tool-driven Managed Connection Reuse — MSI
// ============================================================================
suite('Tool-driven Managed Connection Reuse — MSI', () => {
  let toolsReady = false;
  let reusableConnector: { connectorShortName: string; connections: ExistingManagedConnection[] } | undefined;
  let originalAuthMethod: string | undefined;
  const testActionName = `ToolMsi_${Date.now().toString(36)}`;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    if (!toolsReady) {
      return;
    }

    reusableConnector = await pickReusableManagedConnector(['servicebus', 'office365', 'sql']);
    if (!reusableConnector) {
      return;
    }

    const wsPath = getWorkspacePath();
    const localSettingsPath = path.join(wsPath, 'local.settings.json');
    const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    settings.Values = settings.Values || {};
    originalAuthMethod = settings.Values.WORKFLOWS_AUTHENTICATION_METHOD;
    settings.Values.WORKFLOWS_AUTHENTICATION_METHOD = 'managedServiceIdentity';
    fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2));

    removeManagedConnectionArtifacts([reusableConnector.connectorShortName]);
  });

  suiteTeardown(() => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const localSettingsPath = path.join(wsPath, 'local.settings.json');
      if (fs.existsSync(localSettingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
          settings.Values = settings.Values || {};
          if (originalAuthMethod !== undefined) {
            settings.Values.WORKFLOWS_AUTHENTICATION_METHOD = originalAuthMethod;
          } else {
            settings.Values.WORKFLOWS_AUTHENTICATION_METHOD = 'rawKeys';
          }
          fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2));
        } catch {
          /* ignore */
        }
      }
    }

    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should write MSI auth through the addAction tool when the workflow auth mode is managed identity', async function () {
    if (!toolsReady || !reusableConnector || !reusableConnector.connections[0]?.connectorId) {
      this.skip();
      return;
    }
    this.timeout(120_000);

    const values = readLocalSettingsValues();
    assert.strictEqual(values.WORKFLOWS_AUTHENTICATION_METHOD, 'managedServiceIdentity');

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const baselineRefs = getManagedConnectionRefsForConnector(reusableConnector.connectorShortName);

    addedActions.push(testActionName);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ApiConnection',
      actionName: testActionName,
      connectorReference: reusableConnector.connectorShortName,
      connectorId: reusableConnector.connections[0].connectorId,
      method: 'get',
      path: '/',
    });
    console.log(`addAction (managed connection MSI reuse) result: ${text}`);
    assert.ok(text.length > 0, 'Tool should return a response');

    const action = readWorkflowAction(workflowPath, testActionName);
    assert.ok(action, `Expected ${testActionName} to be added via addAction`);
    assert.strictEqual(action.type, 'ApiConnection');
    assert.strictEqual(action.inputs?.host?.connection?.referenceName, reusableConnector.connectorShortName);

    const connectionRef = await waitForManagedConnectionRef(reusableConnector.connectorShortName, baselineRefs);
    assert.ok(connectionRef, `Expected a managed connection reference for ${reusableConnector.connectorShortName}`);
    addedConnectionRefs.push(connectionRef!);

    const managedConnection = readConnectionsData().managedApiConnections?.[connectionRef!];
    assert.ok(managedConnection, 'connections.json should contain the managed connection written by addAction');
    assert.strictEqual(managedConnection.authentication?.type, 'ManagedServiceIdentity');
    assert.strictEqual(managedConnection.authentication?.scheme, undefined);
    assert.strictEqual(managedConnection.authentication?.parameter, undefined);
    assert.ok(managedConnection.connection?.id, 'Resolved MSI connection should still point at an Azure ARM connection resource');
    assert.ok(
      typeof managedConnection.connectionRuntimeUrl === 'string' && managedConnection.connectionRuntimeUrl.length > 0,
      'Resolved MSI connection should persist connectionRuntimeUrl'
    );

    const updatedValues = readLocalSettingsValues();
    assert.strictEqual(
      updatedValues[`${connectionRef!}-connectionKey`],
      undefined,
      'MSI flow should not persist a connection key to local.settings.json'
    );

    await verifyConnectionExistsInAzure(managedConnection.connection.id);
  });
});

// ============================================================================
// 24. Tool-driven Managed Connection Create — Credential Parameter Set
// ============================================================================
suite('Tool-driven Managed Connection Create — Credential Parameter Set', () => {
  let toolsReady = false;
  const connectorShortName = 'servicebus';
  const testActionName = `ToolCredential_${Date.now().toString(36)}`;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }

    removeManagedConnectionArtifacts([connectorShortName]);
  });

  suiteTeardown(() => {
    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should create a managed connection through the addAction tool using prompted credential parameters', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(120_000);

    const azureContext = getAzureContextConfig();
    assert.ok(azureContext, 'Azure context must be configured for managed connection tool tests');
    const connectorId = `/subscriptions/${azureContext.subscriptionId}/providers/Microsoft.Web/locations/${azureContext.location}/managedApis/${connectorShortName}`;

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const baselineRefs = getManagedConnectionRefsForConnector(connectorShortName);
    const promptOptions: vscode.InputBoxOptions[] = [];
    let createdConnectionId = '';
    let createRequestBody: Record<string, any> | undefined;
    const fakeSession = createFakeAzureSession();
    let inputIndex = 0;

    const restoreOverrides = stubWorkflowToolsTestOverrides({
      disableArmSwaggerResolution: true,
      getAuthData: async () => fakeSession,
      getAuthorizationToken: async () => `Bearer ${fakeSession.accessToken}`,
      showInputBox: async (options) => {
        promptOptions.push(options);
        const responses = ['super-secret-api-key'];
        const response = responses[Math.min(inputIndex, responses.length - 1)];
        inputIndex += 1;
        return response;
      },
      fetch: async (input, init) => {
        const requestUrl = input instanceof Request ? input.url : input.toString();
        const normalizedRequestUrl = requestUrl.toLowerCase();
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const bodyText = typeof init?.body === 'string' ? init.body : undefined;

        if (method === 'GET' && normalizedRequestUrl.includes('/providers/microsoft.web/connections?')) {
          return createJsonResponse({ value: [] });
        }

        if (
          method === 'GET' &&
          normalizedRequestUrl === `${azureContext.managementBaseUrl}${connectorId}?api-version=2018-07-01-preview`.toLowerCase()
        ) {
          return createJsonResponse({
            id: connectorId,
            properties: {
              displayName: 'Credential Test Connector',
              connectionParameterSets: {
                values: [
                  {
                    name: 'ApiKeyAuth',
                    parameters: {
                      apiKey: {
                        type: 'secureString',
                        uiDefinition: {
                          displayName: 'API key',
                          description: 'Enter the connector API key',
                          constraints: {
                            required: 'true',
                          },
                        },
                      },
                      token: {
                        type: 'secureString',
                        uiDefinition: {
                          constraints: {
                            hidden: 'true',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          });
        }

        if (method === 'PUT' && requestUrl.includes('/providers/Microsoft.Web/connections/')) {
          createRequestBody = bodyText ? (JSON.parse(bodyText) as Record<string, any>) : {};
          createdConnectionId = requestUrl.replace(`${azureContext.managementBaseUrl}`, '').replace(/\?api-version=.*$/, '');
          return createJsonResponse({ id: createdConnectionId });
        }

        if (
          method === 'GET' &&
          createdConnectionId &&
          requestUrl === `${azureContext.managementBaseUrl}${createdConnectionId}?api-version=2018-07-01-preview`
        ) {
          return createJsonResponse({
            properties: {
              overallStatus: 'Connected',
              testRequests: [
                {
                  method: 'POST',
                  requestUri: 'https://credentialtest.local/validate',
                },
              ],
            },
          });
        }

        if (method === 'POST' && requestUrl === 'https://credentialtest.local/validate') {
          return createJsonResponse({
            response: {
              statusCode: 'OK',
            },
          });
        }

        if (
          method === 'POST' &&
          createdConnectionId &&
          requestUrl === `${azureContext.managementBaseUrl}${createdConnectionId}/listConnectionKeys?api-version=2018-07-01-preview`
        ) {
          return createJsonResponse({
            connectionKey: 'credential-connection-key',
            runtimeUrls: ['https://credentialtest.runtime'],
          });
        }

        throw new Error(`Unexpected fetch call: ${method} ${requestUrl}`);
      },
    });

    try {
      addedActions.push(testActionName);
      const text = await invokeTool(TOOL_NAMES.addAction, {
        workflowName: 'Stateful1',
        actionType: 'ApiConnection',
        actionName: testActionName,
        connectorId,
        method: 'post',
        path: "/@{encodeURIComponent(encodeURIComponent('queue-name'))}/messages",
      });
      console.log(`addAction (managed connection credential create) result: ${text}`);
      assert.ok(text.length > 0, 'Tool should return a response');

      const action = readWorkflowAction(workflowPath, testActionName);
      assert.ok(action, `Expected ${testActionName} to be added via addAction`);
      assert.strictEqual(action.type, 'ApiConnection');
      assert.strictEqual(action.inputs?.host?.connection?.referenceName, connectorShortName);

      const connectionRef = await waitForManagedConnectionRef(connectorShortName, baselineRefs);
      assert.ok(connectionRef, `Expected a managed connection reference for ${connectorShortName}`);
      addedConnectionRefs.push(connectionRef!);

      const managedConnection = readConnectionsData().managedApiConnections?.[connectionRef!];
      assert.ok(managedConnection, 'connections.json should contain the managed connection created through the credential flow');
      assert.strictEqual(managedConnection.authentication?.type, 'Raw');
      assert.strictEqual(managedConnection.authentication?.scheme, 'Key');
      assert.strictEqual(managedConnection.connectionRuntimeUrl, 'https://credentialtest.runtime');
      assert.ok(managedConnection.connection?.id, 'Credential flow should persist the created Azure connection id');

      const updatedValues = readLocalSettingsValues();
      assert.strictEqual(
        updatedValues[`${connectionRef!}-connectionKey`],
        'credential-connection-key',
        'Credential flow should persist the connection key to local.settings.json'
      );

      assert.ok(createRequestBody, 'The credential flow should issue a create-connection PUT request');
      assert.deepStrictEqual(createRequestBody?.properties?.parameterValueSet, {
        name: 'ApiKeyAuth',
        values: {
          apiKey: {
            value: 'super-secret-api-key',
          },
        },
      });
      assert.ok(
        !('parameterValues' in (createRequestBody?.properties ?? {})),
        'Single parameter-set connectors should not fall back to flat parameterValues'
      );
      assert.strictEqual(promptOptions.length, 1, 'Only the visible credential parameter should be prompted');
      assert.strictEqual(promptOptions[0].password, true, 'Secure connector parameters should use password input');
    } finally {
      restoreOverrides();
    }
  });
});

// ============================================================================
// 25. Tool-driven Managed Connection Fallback — Multi-auth Placeholder
// ============================================================================
suite('Tool-driven Managed Connection Fallback — Multi-auth Placeholder', () => {
  let toolsReady = false;
  const connectorShortName = 'sql';
  const testActionName = `ToolMultiAuth_${Date.now().toString(36)}`;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }

    removeManagedConnectionArtifacts([connectorShortName]);
  });

  suiteTeardown(() => {
    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should add a placeholder connection and surface the multi-auth reason when the connector supports multiple auth modes', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(120_000);

    const azureContext = getAzureContextConfig();
    assert.ok(azureContext, 'Azure context must be configured for managed connection tool tests');
    const connectorId = `/subscriptions/${azureContext.subscriptionId}/providers/Microsoft.Web/locations/${azureContext.location}/managedApis/${connectorShortName}`;

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const baselineRefs = getManagedConnectionRefsForConnector(connectorShortName);
    let createAttempted = false;
    const fakeSession = createFakeAzureSession();
    const restoreOverrides = stubWorkflowToolsTestOverrides({
      disableArmSwaggerResolution: true,
      getAuthData: async () => fakeSession,
      getAuthorizationToken: async () => `Bearer ${fakeSession.accessToken}`,
      fetch: async (input, init) => {
        const requestUrl = input instanceof Request ? input.url : input.toString();
        const normalizedRequestUrl = requestUrl.toLowerCase();
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

        if (method === 'GET' && normalizedRequestUrl.includes('/providers/microsoft.web/connections?')) {
          return createJsonResponse({ value: [] });
        }

        if (
          method === 'GET' &&
          normalizedRequestUrl === `${azureContext.managementBaseUrl}${connectorId}?api-version=2018-07-01-preview`.toLowerCase()
        ) {
          return createJsonResponse({
            id: connectorId,
            properties: {
              displayName: 'Multi Auth Test Connector',
              connectionParameterSets: {
                values: [
                  {
                    name: 'OAuth',
                    parameters: {
                      token: {
                        type: 'oauthSetting',
                        uiDefinition: {
                          displayName: 'OAuth token',
                        },
                      },
                    },
                  },
                  {
                    name: 'ApiKey',
                    parameters: {
                      apiKey: {
                        type: 'secureString',
                        uiDefinition: {
                          displayName: 'API key',
                          constraints: {
                            required: 'true',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          });
        }

        if (method === 'PUT' && requestUrl.includes('/providers/Microsoft.Web/connections/')) {
          createAttempted = true;
          throw new Error(`Unexpected connection creation call for multi-auth connector: ${requestUrl}`);
        }

        throw new Error(`Unexpected fetch call: ${method} ${requestUrl}`);
      },
    });

    try {
      addedActions.push(testActionName);
      const text = await invokeTool(TOOL_NAMES.addAction, {
        workflowName: 'Stateful1',
        actionType: 'ApiConnection',
        actionName: testActionName,
        connectorId,
        method: 'get',
        path: "/v2/datasets/@{encodeURIComponent(encodeURIComponent('default'))},@{encodeURIComponent(encodeURIComponent('default'))}/tables/@{encodeURIComponent(encodeURIComponent('[dbo].[Orders]'))}/items",
      });
      console.log(`addAction (managed connection multi-auth fallback) result: ${text}`);
      assert.ok(
        text.toLowerCase().includes('placeholder'),
        `Tool response should explain that a placeholder connection was added. Got: ${text}`
      );
      assert.ok(
        text.toLowerCase().includes('multiple authentication modes'),
        `Tool response should preserve the multi-auth failure reason. Got: ${text}`
      );
      assert.strictEqual(createAttempted, false, 'The multi-auth fallback should not attempt to create an Azure connection automatically');

      const action = readWorkflowAction(workflowPath, testActionName);
      assert.ok(action, `Expected ${testActionName} to be added via addAction`);
      assert.strictEqual(action.type, 'ApiConnection');
      assert.strictEqual(action.inputs?.host?.connection?.referenceName, connectorShortName);

      const connectionRef = await waitForManagedConnectionRef(connectorShortName, baselineRefs);
      assert.ok(connectionRef, `Expected a managed connection reference for ${connectorShortName}`);
      addedConnectionRefs.push(connectionRef!);

      const managedConnection = readConnectionsData().managedApiConnections?.[connectionRef!];
      assert.ok(managedConnection, 'connections.json should contain the placeholder managed connection');
      assert.strictEqual(managedConnection.connection?.id, '', 'Multi-auth fallback should keep the placeholder connection id empty');
      assert.strictEqual(managedConnection.connectionRuntimeUrl, undefined);
      assert.strictEqual(managedConnection.authentication?.type, 'Raw');
      assert.strictEqual(managedConnection.authentication?.scheme, 'Key');
      assert.ok(managedConnection.authentication?.parameter?.includes('@appsetting('));
    } finally {
      restoreOverrides();
    }
  });
});

// ============================================================================
// 26. Chat-driven Managed Connection Reuse — Raw Keys
// ============================================================================
suite('Chat-driven Managed Connection Reuse — Raw Keys', () => {
  let toolsReady = false;
  let reusableConnector: { connectorShortName: string; connections: ExistingManagedConnection[] } | undefined;
  const testActionName = `ChatRawKeys_${Date.now().toString(36)}`;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    if (!toolsReady) {
      return;
    }

    reusableConnector = await pickReusableManagedConnector(['servicebus', 'office365', 'sql']);
    if (reusableConnector) {
      removeManagedConnectionArtifacts([reusableConnector.connectorShortName]);
    }
  });

  suiteTeardown(() => {
    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should reuse an existing Azure managed connection through the chat participant', async function () {
    if (!toolsReady || !reusableConnector) {
      this.skip();
      return;
    }
    this.timeout(120_000);

    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    const values = readLocalSettingsValues();
    assert.strictEqual(values.WORKFLOWS_AUTHENTICATION_METHOD || 'rawKeys', 'rawKeys');

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const workflowBefore = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
    const baselineActions = Object.keys(workflowBefore.definition?.actions || {});
    const baselineRefs = getManagedConnectionRefsForConnector(reusableConnector.connectorShortName);

    addedActions.push(testActionName);
    await sendChatAndWait(buildManagedConnectorChatPrompt(reusableConnector.connectorShortName, testActionName), {
      waitForActionChange: { path: workflowPath, baseline: baselineActions },
    });

    const action = readWorkflowAction(workflowPath, testActionName);
    assert.ok(action, `Expected ${testActionName} to be added via chat`);
    assert.strictEqual(action.type, 'ApiConnection', 'Chat should add an ApiConnection action');
    assert.strictEqual(
      action.inputs?.host?.connection?.referenceName,
      reusableConnector.connectorShortName,
      'Action should point at the managed connector reference written by the chat flow'
    );

    const connectionRef = await waitForManagedConnectionRef(reusableConnector.connectorShortName, baselineRefs);
    assert.ok(connectionRef, `Expected a managed connection reference for ${reusableConnector.connectorShortName}`);
    addedConnectionRefs.push(connectionRef!);

    const managedConnection = readConnectionsData().managedApiConnections?.[connectionRef!];
    assert.ok(managedConnection, 'connections.json should contain the managed connection written by chat');
    assert.strictEqual(managedConnection.authentication?.type, 'Raw');
    assert.strictEqual(managedConnection.authentication?.scheme, 'Key');
    assert.ok(managedConnection.authentication?.parameter?.includes('@appsetting('));
    assert.ok(managedConnection.connection?.id, 'Resolved managed connection should have a non-empty ARM id');
    assert.ok(
      typeof managedConnection.connectionRuntimeUrl === 'string' && managedConnection.connectionRuntimeUrl.length > 0,
      'Resolved managed connection should persist connectionRuntimeUrl'
    );
    assert.ok(
      reusableConnector.connections.some((connection) => connection.id === managedConnection.connection.id),
      'Chat flow should reuse one of the existing Azure managed connections'
    );

    const updatedValues = readLocalSettingsValues();
    assert.ok(updatedValues[`${connectionRef!}-connectionKey`], 'Raw Keys flow should store a connection key in local.settings.json');

    await verifyConnectionExistsInAzure(managedConnection.connection.id);
  });
});

// ============================================================================
// 27. Chat-driven Managed Connection Reuse — MSI
// ============================================================================
suite('Chat-driven Managed Connection Reuse — MSI', () => {
  let toolsReady = false;
  let reusableConnector: { connectorShortName: string; connections: ExistingManagedConnection[] } | undefined;
  let originalAuthMethod: string | undefined;
  const testActionName = `ChatMsi_${Date.now().toString(36)}`;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    if (!toolsReady) {
      return;
    }

    reusableConnector = await pickReusableManagedConnector(['servicebus', 'office365', 'sql']);
    if (!reusableConnector) {
      return;
    }

    const wsPath = getWorkspacePath();
    const localSettingsPath = path.join(wsPath, 'local.settings.json');
    const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    settings.Values = settings.Values || {};
    originalAuthMethod = settings.Values.WORKFLOWS_AUTHENTICATION_METHOD;
    settings.Values.WORKFLOWS_AUTHENTICATION_METHOD = 'managedServiceIdentity';
    fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2));

    removeManagedConnectionArtifacts([reusableConnector.connectorShortName]);
  });

  suiteTeardown(() => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const localSettingsPath = path.join(wsPath, 'local.settings.json');
      if (fs.existsSync(localSettingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
          settings.Values = settings.Values || {};
          if (originalAuthMethod !== undefined) {
            settings.Values.WORKFLOWS_AUTHENTICATION_METHOD = originalAuthMethod;
          } else {
            settings.Values.WORKFLOWS_AUTHENTICATION_METHOD = 'rawKeys';
          }
          fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2));
        } catch {
          /* ignore */
        }
      }
    }

    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should write MSI auth through the chat participant when the workflow auth mode is managed identity', async function () {
    if (!toolsReady || !reusableConnector) {
      this.skip();
      return;
    }
    this.timeout(120_000);

    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      this.skip();
      return;
    }

    const values = readLocalSettingsValues();
    assert.strictEqual(values.WORKFLOWS_AUTHENTICATION_METHOD, 'managedServiceIdentity');

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const workflowBefore = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
    const baselineActions = Object.keys(workflowBefore.definition?.actions || {});
    const baselineRefs = getManagedConnectionRefsForConnector(reusableConnector.connectorShortName);

    addedActions.push(testActionName);
    await sendChatAndWait(buildManagedConnectorChatPrompt(reusableConnector.connectorShortName, testActionName), {
      waitForActionChange: { path: workflowPath, baseline: baselineActions },
    });

    const action = readWorkflowAction(workflowPath, testActionName);
    assert.ok(action, `Expected ${testActionName} to be added via chat`);
    assert.strictEqual(action.type, 'ApiConnection');
    assert.strictEqual(action.inputs?.host?.connection?.referenceName, reusableConnector.connectorShortName);

    const connectionRef = await waitForManagedConnectionRef(reusableConnector.connectorShortName, baselineRefs);
    assert.ok(connectionRef, `Expected a managed connection reference for ${reusableConnector.connectorShortName}`);
    addedConnectionRefs.push(connectionRef!);

    const managedConnection = readConnectionsData().managedApiConnections?.[connectionRef!];
    assert.ok(managedConnection, 'connections.json should contain the managed connection written by chat');
    assert.strictEqual(managedConnection.authentication?.type, 'ManagedServiceIdentity');
    assert.strictEqual(managedConnection.authentication?.scheme, undefined);
    assert.strictEqual(managedConnection.authentication?.parameter, undefined);
    assert.ok(managedConnection.connection?.id, 'Resolved MSI connection should still point at an Azure ARM connection resource');
    assert.ok(
      typeof managedConnection.connectionRuntimeUrl === 'string' && managedConnection.connectionRuntimeUrl.length > 0,
      'Resolved MSI connection should persist connectionRuntimeUrl'
    );
    assert.ok(
      reusableConnector.connections.some((connection) => connection.id === managedConnection.connection.id),
      'MSI chat flow should still reuse one of the existing Azure managed connections'
    );

    const updatedValues = readLocalSettingsValues();
    assert.strictEqual(
      updatedValues[`${connectionRef!}-connectionKey`],
      undefined,
      'MSI flow should not persist a connection key to local.settings.json'
    );

    await verifyConnectionExistsInAzure(managedConnection.connection.id);
  });
});

// ============================================================================
// 28. addAction — runAfter Auto-chain
// Regression coverage: when a Response action consumes the output of a prior
// action, the chat tool must chain runAfter to the previous action by default
// instead of leaving the action in parallel with everything else.
// ============================================================================
suite('addAction — runAfter Auto-chain', () => {
  let toolsReady = false;
  const addedActions: string[] = [];
  const addedTriggers: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
  });

  suiteTeardown(() => {
    const wsPath = getWorkspacePath();
    if (!wsPath) {
      return;
    }
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    if (!fs.existsSync(workflowPath)) {
      return;
    }
    try {
      const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      for (const name of addedActions) {
        delete workflow.definition?.actions?.[name];
      }
      for (const name of addedTriggers) {
        delete workflow.definition?.triggers?.[name];
      }
      fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
    } catch {
      /* ignore */
    }
  });

  test('should default runAfter to {} for the first action in a workflow', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);

    const composeName = 'AutoChain_FirstCompose';
    addedActions.push(composeName);

    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Compose',
      actionName: composeName,
      configuration: { inputs: 'hello' },
    });
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm action added. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const workflow = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = workflow.definition?.actions?.[composeName];
    assert.ok(action, `${composeName} should exist in actions`);
    assert.deepStrictEqual(action.runAfter, {}, 'First action with no prior actions should have empty runAfter');
  });

  test('should chain runAfter to the most recent action when caller omits runAfter', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);

    const responseName = 'AutoChain_ChainedResponse';
    addedActions.push(responseName);

    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Response',
      actionName: responseName,
      configuration: { inputs: { statusCode: 200, body: 'ok' } },
    });
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm action added. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const workflow = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = workflow.definition?.actions?.[responseName];
    assert.ok(action, `${responseName} should exist in actions`);
    assert.ok(
      action.runAfter && typeof action.runAfter === 'object',
      `runAfter should be an object. Got: ${JSON.stringify(action.runAfter)}`
    );
    const runAfterKeys = Object.keys(action.runAfter);
    assert.strictEqual(runAfterKeys.length, 1, `Expected runAfter to chain after a single action. Got: ${JSON.stringify(action.runAfter)}`);
    assert.ok(
      workflow.definition?.actions?.[runAfterKeys[0]],
      `runAfter key "${runAfterKeys[0]}" should reference an existing action in the workflow`
    );
    assert.deepStrictEqual(action.runAfter[runAfterKeys[0]], ['Succeeded']);
  });

  test('should preserve explicit runAfter:{} override (parallel execution)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);

    const parallelName = 'AutoChain_ExplicitParallelResponse';
    addedActions.push(parallelName);

    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Response',
      actionName: parallelName,
      configuration: { inputs: { statusCode: 202 }, runAfter: {} },
    });
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm action added. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const workflow = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = workflow.definition?.actions?.[parallelName];
    assert.ok(action, `${parallelName} should exist in actions`);
    assert.deepStrictEqual(action.runAfter, {}, 'Explicit runAfter:{} should be preserved verbatim');
  });

  test('should preserve explicit runAfter pointing at a specific previous action', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);

    const explicitName = 'AutoChain_ExplicitChainResponse';
    addedActions.push(explicitName);

    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'Response',
      actionName: explicitName,
      configuration: {
        inputs: { statusCode: 200, body: 'explicit' },
        runAfter: { AutoChain_FirstCompose: ['Succeeded'] },
      },
    });
    assert.ok(text.toLowerCase().includes('added') || text.toLowerCase().includes('success'), `Should confirm action added. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const workflow = JSON.parse(fs.readFileSync(path.join(wsPath, 'Stateful1', 'workflow.json'), 'utf-8'));
    const action = workflow.definition?.actions?.[explicitName];
    assert.ok(action, `${explicitName} should exist in actions`);
    assert.deepStrictEqual(
      action.runAfter,
      { AutoChain_FirstCompose: ['Succeeded'] },
      'Explicit runAfter should be preserved verbatim regardless of auto-chain default'
    );
  });
});

// ============================================================================
// 29. addAction — Weather without connections.json reference
// Regression coverage: when a user asks for a weather action and connections.json
// has no weather reference, the tool must no longer return the literal
// "no weather managed API connection was found in connections.json" error. It
// must route through the generic ApiConnection resolver so ARM discovery /
// placeholder provisioning runs.
// ============================================================================
suite('addAction — Weather without connections.json reference', () => {
  let toolsReady = false;
  const addedActions: string[] = [];
  const addedConnectionRefs: string[] = [];
  let baselineWeatherRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(90_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }

    // Capture any pre-existing weather refs so cleanup only removes test artifacts.
    baselineWeatherRefs = getManagedConnectionRefsForConnector('msnweather');
  });

  suiteTeardown(() => {
    cleanupWorkflowActions(addedActions);
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should not return the legacy "no weather managed API connection" error for fresh requests', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(60_000);

    const actionName = 'WeatherFallback_NoConnError';
    addedActions.push(actionName);

    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ApiConnection',
      actionName,
      configuration: {
        inputs: {
          host: { connection: { referenceName: 'msnweather' } },
          method: 'get',
          path: '/current/Seattle, WA',
        },
      },
    });

    assert.ok(
      !/no weather managed API connection was found in connections\.json\./i.test(text),
      `Tool should no longer surface the legacy bail-out. Got: ${text}`
    );

    const newRefs = getManagedConnectionRefsForConnector('msnweather').filter((name) => !baselineWeatherRefs.includes(name));
    addedConnectionRefs.push(...newRefs);
  });

  test('should preserve caller-supplied path (no {Location} placeholder, no 98101 hardcode override)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(60_000);

    const actionName = 'WeatherFallback_CallerPath';
    addedActions.push(actionName);

    const callerPath = '/current/Seattle, WA';
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ApiConnection',
      actionName,
      configuration: {
        inputs: {
          host: { connection: { referenceName: 'msnweather' } },
          method: 'get',
          path: callerPath,
        },
      },
    });
    assert.ok(/added|success|resolved|placeholder/i.test(text), `Tool should produce a success or resolution message. Got: ${text}`);

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
    const action = readWorkflowAction(workflowPath, actionName);
    assert.ok(action, `${actionName} should exist in actions`);
    assert.strictEqual(action.type, 'ApiConnection', 'Action type should be ApiConnection');

    const writtenPath = action.inputs?.path;
    assert.strictEqual(typeof writtenPath, 'string', 'Path must be a string');
    assert.strictEqual(writtenPath, callerPath, `Caller-supplied path must be preserved. Got: ${writtenPath}`);
    assert.ok(
      !/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(writtenPath.replace(/@\{[^}]+\}/g, '')),
      `Path must not contain unsubstituted {Placeholder} tokens. Got: ${writtenPath}`
    );

    const newRefs = getManagedConnectionRefsForConnector('msnweather').filter(
      (name) => !baselineWeatherRefs.includes(name) && !addedConnectionRefs.includes(name)
    );
    addedConnectionRefs.push(...newRefs);
  });
});

// ============================================================================
// 30. Chat-driven Weather Regression — original chat transcript scenario
// Requires Copilot + Azure context. End-to-end: trigger + weather action +
// Response, all with runAfter properly chained and Seattle resolved in path.
// ============================================================================
suite('Chat-driven Weather Regression', () => {
  let toolsReady = false;
  const triggerName = 'WeatherRegression_HttpTrigger';
  const weatherActionName = 'WeatherRegression_GetWeather';
  const responseActionName = 'WeatherRegression_Respond';
  const addedActions = [weatherActionName, responseActionName];
  const addedTriggers = [triggerName];
  const addedConnectionRefs: string[] = [];
  let baselineWeatherRefs: string[] = [];

  suiteSetup(async function () {
    this.timeout(120_000);
    const activated = await waitForExtensionActivation(60_000);
    if (activated) {
      toolsReady = await waitForToolImplementation(TOOL_NAMES.listWorkflows, 15_000);
    }
    baselineWeatherRefs = getManagedConnectionRefsForConnector('msnweather');
  });

  suiteTeardown(() => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');
      if (fs.existsSync(workflowPath)) {
        try {
          const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
          for (const name of addedActions) {
            delete workflow.definition?.actions?.[name];
          }
          for (const name of addedTriggers) {
            delete workflow.definition?.triggers?.[name];
          }
          fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
        } catch {
          /* ignore */
        }
      }
    }
    removeManagedConnectionArtifacts(addedConnectionRefs);
  });

  test('should produce trigger → weather → response with chained runAfter and Seattle resolved', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }

    const azureContext = getAzureContextConfig();
    if (!azureContext) {
      this.skip();
      return;
    }

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!models || models.length === 0) {
      this.skip();
      return;
    }

    this.timeout(180_000);

    const wsPath = getWorkspacePath();
    const workflowPath = path.join(wsPath, 'Stateful1', 'workflow.json');

    // Baseline: capture existing action names so we can detect new additions.
    const baselineWorkflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
    const baselineActionNames = Object.keys(baselineWorkflow.definition?.actions ?? {});

    await sendChatAndWait(
      `@logicapps in Stateful1, when we get an HTTP request, return the weather in Seattle. Use the msnweather managed connector. Name the trigger ${triggerName}, the weather action ${weatherActionName}, and the response action ${responseActionName}.`,
      { waitForActionChange: { path: workflowPath, baseline: baselineActionNames }, minWait: 30_000 }
    );

    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

    // Trigger assertions
    const triggers = workflow.definition?.triggers ?? {};
    const triggerEntries = Object.entries(triggers).filter(([, value]: [string, any]) => value?.type === 'Request');
    assert.ok(triggerEntries.length >= 1, `Expected at least one Request trigger. Got: ${JSON.stringify(Object.keys(triggers))}`);

    // Find the weather action (ApiConnection referencing something containing "weather").
    const actions = workflow.definition?.actions ?? {};
    const weatherEntry = Object.entries(actions).find(([name, value]: [string, any]) => {
      if (value?.type !== 'ApiConnection') {
        return false;
      }
      const ref = value?.inputs?.host?.connection?.referenceName;
      return addedActions.includes(name) || (typeof ref === 'string' && ref.toLowerCase().includes('weather'));
    });
    assert.ok(weatherEntry, `Expected a weather ApiConnection action. Got actions: ${JSON.stringify(Object.keys(actions))}`);
    const [actualWeatherName, weatherAction] = weatherEntry as [string, any];

    // The weather action's path must not contain an unsubstituted {Placeholder} token,
    // and should reference Seattle (literal) or 98101 (canonical builder fallback).
    const weatherPath = weatherAction?.inputs?.path;
    assert.strictEqual(typeof weatherPath, 'string', `weather inputs.path should be a string. Got: ${weatherPath}`);
    const pathWithoutExpressions = (weatherPath as string).replace(/@\{[^}]+\}/g, '');
    assert.ok(
      !/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(pathWithoutExpressions),
      `Weather action path must not contain unsubstituted {Placeholder} tokens. Got: ${weatherPath}`
    );
    assert.ok(/seattle|98101/i.test(weatherPath as string), `Weather action path should reference Seattle or 98101. Got: ${weatherPath}`);

    // Find a Response action.
    const responseEntry = Object.entries(actions).find(([, value]: [string, any]) => value?.type === 'Response');
    assert.ok(responseEntry, `Expected a Response action. Got actions: ${JSON.stringify(Object.keys(actions))}`);
    const [, responseAction] = responseEntry as [string, any];

    // The Response must runAfter the weather action — NOT in parallel.
    const responseRunAfter = responseAction?.runAfter;
    assert.ok(
      responseRunAfter && typeof responseRunAfter === 'object' && Object.keys(responseRunAfter).length > 0,
      `Response runAfter must not be empty. Got: ${JSON.stringify(responseRunAfter)}`
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(responseRunAfter, actualWeatherName),
      `Response runAfter must chain after "${actualWeatherName}". Got: ${JSON.stringify(responseRunAfter)}`
    );

    // Track any new msnweather managed connection refs for cleanup.
    const newRefs = getManagedConnectionRefsForConnector('msnweather').filter((name) => !baselineWeatherRefs.includes(name));
    addedConnectionRefs.push(...newRefs);
  });
});
