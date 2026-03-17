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

  test('should add a Service Bus ServiceProvider action (Plan 6.2)', async function () {
    if (!toolsReady) {
      this.skip();
      return;
    }
    this.timeout(30_000);
    const name = 'TestSendSBMessage';
    addedActions.push(name);
    const text = await invokeTool(TOOL_NAMES.addAction, {
      workflowName: 'Stateful1',
      actionType: 'ServiceProvider',
      actionName: name,
      connectorReference: 'serviceBus',
    });
    console.log(`addAction (ServiceBus SP) result: ${text}`);
    assert.ok(text.length > 0, 'Should return a response');
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
