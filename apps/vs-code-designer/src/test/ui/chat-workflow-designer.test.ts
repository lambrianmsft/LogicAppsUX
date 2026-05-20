/// <reference types="mocha" />

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { By, VSBrowser, type WebDriver } from 'vscode-extension-tester';
import { canvasHasNode, countCanvasNodes, openDesignerViaExplorer, switchToDesignerWebview } from './designerHelpers';
import { captureScreenshot, clearBlockingUI, sleep } from './helpers';
import {
  askLogicApps,
  clearChatHistory,
  closeChatPanel,
  getLastChatResponse,
  openChatPanel,
  responseContainsAny,
  sendChatPrompt,
  waitForChatResponse,
} from './helpers/chatHelper';
import {
  assertNoMissingPlaceholders,
  assertFileTextSnapshotsUnchanged,
  assertWorkflowHasAction,
  findLogicAppProjects,
  findWorkflowDirs,
  readWorkflowJson,
  takeFileTextSnapshots,
  type WorkflowAction,
} from './helpers/workspaceHelper';
import { loadWorkspaceManifest, type WorkspaceManifestEntry } from './workspaceManifest';

const TARGET_WORKFLOW_NAME = 'Stateful1';
const RESPONSE_ACTION_TYPE = 'Response';

interface TargetWorkflow {
  projectDir: string;
  workflowDir: string;
  workflowPath: string;
}

function readFileIfExists(filePath: string): string | undefined {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : undefined;
}

function restoreFile(filePath: string, originalContent: string | undefined): void {
  if (originalContent === undefined) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    return;
  }

  fs.writeFileSync(filePath, originalContent);
}

function takeDirectoryStructureSnapshot(rootDir: string): string[] {
  const entries: string[] = [];

  function visit(currentDir: string): void {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      entries.push(`${entry.isDirectory() ? 'dir' : 'file'}:${path.relative(rootDir, entryPath).replace(/\\/g, '/')}`);

      if (entry.isDirectory()) {
        visit(entryPath);
      }
    }
  }

  visit(rootDir);
  return entries.sort();
}

function assertDirectoryStructureUnchanged(before: string[], rootDir: string, label: string): void {
  expect(takeDirectoryStructureSnapshot(rootDir), label).to.deep.equal(before);
}

function assertIncludesFollowUpCategory(responseText: string, label: string, predicate: (text: string) => boolean): void {
  expect(predicate(responseText), `Response should ask for ${label}. Response: ${responseText.substring(0, 800)}`).to.be.true;
}

function targetFromManifestEntry(entry: WorkspaceManifestEntry): TargetWorkflow | undefined {
  const workflowDir = path.basename(entry.wfDir) === TARGET_WORKFLOW_NAME ? entry.wfDir : path.join(entry.appDir, TARGET_WORKFLOW_NAME);
  const workflowPath = path.join(workflowDir, 'workflow.json');

  if (fs.existsSync(workflowPath)) {
    return {
      projectDir: entry.appDir,
      workflowDir,
      workflowPath,
    };
  }

  return undefined;
}

function resolveTargetWorkflow(): TargetWorkflow | undefined {
  const manifestEntries = loadWorkspaceManifest();
  const preferredEntry =
    manifestEntries.find((entry) => entry.appType === 'standard' && entry.wfName === TARGET_WORKFLOW_NAME && entry.wfType === 'Stateful') ||
    manifestEntries.find((entry) => entry.appType === 'standard' && entry.wfName === TARGET_WORKFLOW_NAME) ||
    manifestEntries.find((entry) => entry.wfName === TARGET_WORKFLOW_NAME);

  if (preferredEntry) {
    const target = targetFromManifestEntry(preferredEntry);
    if (target) {
      return target;
    }
  }

  const workspaceCandidates = [
    process.env.TEST_WORKSPACE_DIR,
    process.cwd(),
    path.resolve(__dirname, '..', '..', 'e2e', 'test-workspace'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const workspaceCandidate of workspaceCandidates) {
    const directWorkflowDir = path.join(workspaceCandidate, TARGET_WORKFLOW_NAME);
    const directWorkflowPath = path.join(directWorkflowDir, 'workflow.json');
    if (fs.existsSync(path.join(workspaceCandidate, 'host.json')) && fs.existsSync(directWorkflowPath)) {
      return {
        projectDir: workspaceCandidate,
        workflowDir: directWorkflowDir,
        workflowPath: directWorkflowPath,
      };
    }

    const nestedProject = findLogicAppProjects(workspaceCandidate).find((candidateProjectDir) =>
      findWorkflowDirs(candidateProjectDir).some((workflowDir) => path.basename(workflowDir) === TARGET_WORKFLOW_NAME)
    );
    if (nestedProject) {
      const workflowDir = path.join(nestedProject, TARGET_WORKFLOW_NAME);
      return {
        projectDir: nestedProject,
        workflowDir,
        workflowPath: path.join(workflowDir, 'workflow.json'),
      };
    }
  }

  return undefined;
}

async function waitForWorkflowAction(workflowDir: string, actionName: string, timeoutMs = 60_000): Promise<WorkflowAction | undefined> {
  const deadline = Date.now() + timeoutMs;
  let lastActionNames = '';

  while (Date.now() < deadline) {
    const workflow = readWorkflowJson(workflowDir);
    const actions = workflow?.definition?.actions ?? {};
    lastActionNames = Object.keys(actions).join(', ');
    const action = actions[actionName];

    if (action?.type?.toLowerCase() === RESPONSE_ACTION_TYPE.toLowerCase()) {
      return action;
    }

    await sleep(1000);
  }

  console.log(`[waitForWorkflowAction] Timed out waiting for ${actionName}. Last actions: ${lastActionNames}`);
  return undefined;
}

async function hasVisibleText(driver: WebDriver, expectedText: string): Promise<boolean> {
  const expectedLower = expectedText.toLowerCase();
  const nodes = await driver.findElements(By.css('.react-flow__node, [data-testid*="card-"], [data-testid*="node"]'));

  for (const node of nodes) {
    try {
      const text = await node.getText();
      if (text.toLowerCase().includes(expectedLower)) {
        return true;
      }
    } catch {
      // Ignore stale nodes and continue polling through other candidates.
    }
  }

  return false;
}

async function waitForCanvasEvidence(driver: WebDriver, actionName: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastNodeCount = 0;

  while (Date.now() < deadline) {
    lastNodeCount = await countCanvasNodes(driver);

    if (
      (await canvasHasNode(driver, actionName)) ||
      (await canvasHasNode(driver, RESPONSE_ACTION_TYPE)) ||
      (await hasVisibleText(driver, actionName))
    ) {
      return;
    }

    if (lastNodeCount > 0) {
      console.log(`[waitForCanvasEvidence] Waiting for "${actionName}" on canvas. Visible node count: ${lastNodeCount}`);
    }

    await sleep(1000);
  }

  throw new Error(
    `Designer canvas did not show ${actionName} or a ${RESPONSE_ACTION_TYPE} node. Last visible node count: ${lastNodeCount}`
  );
}

describe('Chat Workflow Designer Tests', function () {
  this.timeout(240_000);

  let driver: WebDriver;
  let copilotAvailable = false;
  let targetWorkflow: TargetWorkflow | undefined;
  let workflowBaseline: string | undefined;

  before(async function () {
    this.timeout(90_000);

    if (process.env.E2E_SKIP_CHAT_TESTS === 'true') {
      console.log('[before] E2E_SKIP_CHAT_TESTS=true, skipping chat workflow designer test');
      this.skip();
      return;
    }

    driver = VSBrowser.instance.driver;

    await sleep(3000);
    await clearBlockingUI(driver);

    targetWorkflow = resolveTargetWorkflow();
    if (!targetWorkflow) {
      console.log(`[before] No Logic App project with ${TARGET_WORKFLOW_NAME} found, skipping chat workflow designer test`);
      this.skip();
      return;
    }

    workflowBaseline = readFileIfExists(targetWorkflow.workflowPath);

    console.log('[before] Checking if GitHub Copilot Chat is available...');
    const chatOpened = await openChatPanel(driver);
    if (chatOpened) {
      const sent = await sendChatPrompt(driver, 'hello', false);
      if (sent) {
        const responded = await waitForChatResponse(driver, 30_000);
        if (responded) {
          const response = await getLastChatResponse(driver);
          const responseText = (response || '').toLowerCase();
          const authErrorPatterns = [
            'sign in',
            'signin',
            'log in',
            'login',
            'authenticate',
            'authorization',
            'not signed in',
            'github account',
            'copilot is not activated',
            'activate copilot',
            'subscription',
            'requires github',
          ];
          const isAuthError = authErrorPatterns.some((pattern) => responseText.includes(pattern));

          if (isAuthError) {
            console.log('[before] Copilot responded with auth error - not authenticated');
            console.log(`[before] Response snippet: ${response?.substring(0, 200)}`);
          } else {
            console.log('[before] GitHub Copilot Chat is available and responding');
            copilotAvailable = true;
          }
        } else {
          console.log('[before] Chat prompt sent but no response - Copilot may need authentication');
        }
      }
    } else {
      console.log('[before] Could not open chat panel - Copilot may not be installed');
    }
  });

  beforeEach(async function () {
    if (!copilotAvailable && process.env.E2E_REQUIRE_COPILOT !== 'true') {
      console.log('[beforeEach] Skipping test - Copilot not available');
      this.skip();
      return;
    }

    await clearChatHistory(driver);
    await sleep(500);
  });

  after(async () => {
    try {
      await closeChatPanel(driver);
    } catch {
      // Ignore cleanup errors.
    }

    if (targetWorkflow) {
      restoreFile(targetWorkflow.workflowPath, workflowBaseline);
    }
  });

  it('adds a Response action through Copilot Chat and renders the workflow in the designer', async function () {
    this.timeout(180_000);

    expect(targetWorkflow, 'Target workflow should be resolved in before hook').to.not.be.undefined;
    const workflowDir = targetWorkflow!.workflowDir;
    const workflowPath = targetWorkflow!.workflowPath;
    const actionName = `ChatDesignerResponse${Date.now()}`;

    const response = await askLogicApps(
      driver,
      `Add a built-in Response action named ${actionName} to ${TARGET_WORKFLOW_NAME}. Set status code 200 and body "chat designer test succeeded".`
    );

    expect(response).to.not.be.null;
    expect(response!.length).to.be.greaterThan(30, 'Chat response should describe the workflow update');

    const hasSuccessSignal = await responseContainsAny(driver, ['successfully', 'added', 'created', 'updated', 'saved']);
    const mentionsAction = response.toLowerCase().includes(actionName.toLowerCase()) || response.toLowerCase().includes('response');
    expect(hasSuccessSignal, 'Chat response should include a success-ish update signal').to.be.true;
    expect(mentionsAction, 'Chat response should mention the requested Response action').to.be.true;

    const action = await waitForWorkflowAction(workflowDir, actionName);
    expect(action, `workflow.json should contain ${actionName} as a ${RESPONSE_ACTION_TYPE} action`).to.not.be.undefined;

    const workflow = readWorkflowJson(workflowDir);
    const persistedAction = assertWorkflowHasAction(workflow, actionName, RESPONSE_ACTION_TYPE);
    assertNoMissingPlaceholders(persistedAction, `${actionName} should not contain unresolved placeholders`);

    await closeChatPanel(driver);
    await clearBlockingUI(driver);

    const designerOpened = await openDesignerViaExplorer(driver, workflowPath, TARGET_WORKFLOW_NAME, false, true);
    expect(designerOpened, 'Workflow should open in the designer through Explorer context menu').to.be.true;

    const webview = await switchToDesignerWebview(driver);
    try {
      await waitForCanvasEvidence(driver, actionName);
      await captureScreenshot(driver, 'chat-workflow-designer-response-rendered');
    } finally {
      try {
        await webview.switchBack();
      } catch {
        await driver.switchTo().defaultContent();
      }
    }
  });

  it('asks follow-up questions for an underspecified queue to SQL or Cosmos workflow request', async function () {
    this.timeout(180_000);

    expect(targetWorkflow, 'Target workflow should be resolved in before hook').to.not.be.undefined;
    const protectedFiles = [
      targetWorkflow!.workflowPath,
      path.join(targetWorkflow!.projectDir, 'connections.json'),
      path.join(targetWorkflow!.projectDir, 'local.settings.json'),
    ];
    const snapshots = takeFileTextSnapshots(protectedFiles);
    const projectStructureBefore = takeDirectoryStructureSnapshot(targetWorkflow!.projectDir);

    const response = await askLogicApps(
      driver,
      'Create a workflow that listens to the queue and adds the message to either sql db or cosmos db based on the message type as SQL or Cosmos'
    );

    expect(response).to.not.be.null;
    expect(response!.length).to.be.greaterThan(50, 'Response should ask for the missing workflow details');

    const responseText = response!.toLowerCase();
    assertIncludesFollowUpCategory(
      responseText,
      'queue provider/name/auth details',
      (text) => text.includes('queue') && (text.includes('service bus') || text.includes('storage') || text.includes('connection'))
    );
    assertIncludesFollowUpCategory(
      responseText,
      'SQL target details',
      (text) => text.includes('sql') && (text.includes('database') || text.includes('table') || text.includes('connection'))
    );
    assertIncludesFollowUpCategory(
      responseText,
      'Cosmos DB target details',
      (text) => text.includes('cosmos') && (text.includes('database') || text.includes('container') || text.includes('connection'))
    );
    assertIncludesFollowUpCategory(
      responseText,
      'message-type branching details',
      (text) => text.includes('message type') || text.includes('condition') || text.includes('branch')
    );
    assertIncludesFollowUpCategory(
      responseText,
      'target workflow/project details',
      (text) => text.includes('workflow') || text.includes('project')
    );
    assertIncludesFollowUpCategory(
      responseText,
      'payload mapping details',
      (text) => text.includes('map') || text.includes('payload') || text.includes('field')
    );

    assertFileTextSnapshotsUnchanged(
      snapshots,
      'Ambiguous queue-to-SQL/Cosmos prompt should not mutate workflow, connections, or local settings before follow-up details are supplied'
    );
    assertDirectoryStructureUnchanged(
      projectStructureBefore,
      targetWorkflow!.projectDir,
      'Ambiguous queue-to-SQL/Cosmos prompt should not create incomplete workflow folders in the target project'
    );
  });
});
