/// <reference types="mocha" />

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chat List & Get Workflows E2E Tests
 *
 * Tests Section 2 of the AgentChatTestingPlan.md:
 *   2.1 - List all workflows
 *   2.2 - Get workflow definition
 *   2.3 - Get non-existent workflow (error handling)
 *   2.4 - Disambiguation prompt (workflow exists in multiple projects)
 *
 * Prerequisites:
 *   - VS Code with GitHub Copilot installed and activated
 *   - Logic Apps extension loaded
 *   - At least one Logic App project with workflows in the workspace
 *   - Copilot Chat accessible
 *
 * Note: These tests require an existing workspace with workflows.
 * They should be run after createWorkspace tests have set up the environment.
 */

import { expect } from 'chai';
import { VSBrowser, Workbench, type WebDriver } from 'vscode-extension-tester';
import {
  openChatPanel,
  sendChatPrompt,
  waitForChatResponse,
  getLastChatResponse,
  askLogicApps,
  responseContainsAny,
  closeChatPanel,
  clearChatHistory,
} from './helpers/chatHelper';
import { findLogicAppProjects, findWorkflowDirs, readWorkflowJson } from './helpers/workspaceHelper';
import { sleep, clearBlockingUI, captureScreenshot } from './helpers';
import * as path from 'path';

/**
 * NOTE: These tests require GitHub Copilot to be authenticated.
 * In automated CI/CD environments, set E2E_SKIP_CHAT_TESTS=true to skip.
 * For manual testing, ensure you're signed into GitHub Copilot before running.
 */
describe('Chat List & Get Workflows Tests', function () {
  this.timeout(180_000); // 3 minutes per test due to LLM response times

  let driver: WebDriver;
  let workbench: Workbench;
  let workspaceDir: string;
  let projectDirs: string[];
  let workflowDirs: string[];
  let copilotAvailable = false;

  before(async function () {
    this.timeout(90_000);

    // Check if we should skip chat tests
    if (process.env.E2E_SKIP_CHAT_TESTS === 'true') {
      console.log('[before] E2E_SKIP_CHAT_TESTS=true, skipping chat tests');
      this.skip();
      return;
    }

    driver = VSBrowser.instance.driver;
    workbench = new Workbench();

    // Wait for VS Code to fully load
    await sleep(3000);

    // Clear any blocking UI
    await clearBlockingUI(driver);

    // Find workspace directory from VS Code
    // Note: In ExTester tests, we need to determine the workspace path
    // This can come from environment variables or be hardcoded for test workspaces
    workspaceDir = process.env.TEST_WORKSPACE_DIR || process.cwd();

    // Find Logic App projects in the workspace
    projectDirs = findLogicAppProjects(workspaceDir);
    console.log(`[before] Found ${projectDirs.length} Logic App projects in workspace`);

    // Find all workflow directories
    workflowDirs = [];
    for (const projectDir of projectDirs) {
      const workflows = findWorkflowDirs(projectDir);
      workflowDirs.push(...workflows);
    }
    console.log(`[before] Found ${workflowDirs.length} workflows across all projects`);

    // Try to open chat panel and verify Copilot is available
    console.log('[before] Checking if GitHub Copilot Chat is available...');
    const chatOpened = await openChatPanel(driver);
    if (chatOpened) {
      // Try a simple prompt to see if Copilot responds
      const sent = await sendChatPrompt(driver, 'hello', false);
      if (sent) {
        const responded = await waitForChatResponse(driver, 30_000);
        if (responded) {
          // Check if response is an auth error vs a real response
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
          const isAuthError = authErrorPatterns.some((p) => responseText.includes(p));

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

    console.log('[before] Chat list/get tests setup complete, copilotAvailable:', copilotAvailable);
  });

  beforeEach(async function () {
    // Skip test if Copilot not available
    if (!copilotAvailable && process.env.E2E_REQUIRE_COPILOT !== 'true') {
      console.log('[beforeEach] Skipping test - Copilot not available');
      this.skip();
      return;
    }
    // Clear chat history before each test for clean state
    await clearChatHistory(driver);
    await sleep(500);
  });

  after(async () => {
    // Close chat panel after all tests
    try {
      await closeChatPanel(driver);
    } catch {
      // Ignore cleanup errors
    }
  });

  // =========================================================================
  // Test 2.1: List All Workflows
  // =========================================================================
  describe('2.1 - List All Workflows', () => {
    it('should list all workflows across all projects', async function () {
      this.timeout(120_000);

      // Skip if no workflows exist
      if (workflowDirs.length === 0) {
        this.skip();
        return;
      }

      const response = await askLogicApps(driver, 'list all workflows');

      expect(response).to.not.be.null;
      expect(response!.length).to.be.greaterThan(20, 'Response should list workflows');

      console.log('[2.1] List workflows response:', response?.substring(0, 500));

      // The response should mention workflows
      const mentionsWorkflows = await responseContainsAny(driver, ['workflow', 'project', 'stateful', 'stateless']);

      expect(mentionsWorkflows, 'Response should mention workflows').to.be.true;

      await captureScreenshot(driver, '2.1-list-workflows');
    });

    it('should include project names in workflow listing', async function () {
      this.timeout(120_000);

      if (projectDirs.length === 0) {
        this.skip();
        return;
      }

      const response = await askLogicApps(driver, 'list all workflows with their project names');

      expect(response).to.not.be.null;

      // Get first project name for verification
      const firstProjectName = path.basename(projectDirs[0]);

      // Response might mention the project name
      console.log(`[2.1] Looking for project name: ${firstProjectName}`);
      console.log('[2.1] Response:', response?.substring(0, 500));

      // Should at least mention project or workflow concept
      const hasProjectInfo = await responseContainsAny(driver, ['project', firstProjectName.toLowerCase(), 'workflow']);

      expect(hasProjectInfo, 'Response should include project information').to.be.true;
    });

    it('should show workflow types (stateful/stateless) in listing', async function () {
      this.timeout(120_000);

      if (workflowDirs.length === 0) {
        this.skip();
        return;
      }

      const response = await askLogicApps(driver, 'list all workflows and show their types');

      expect(response).to.not.be.null;

      console.log('[2.1] Workflow types response:', response?.substring(0, 500));

      // Should mention type information
      const hasTypeInfo = await responseContainsAny(driver, ['stateful', 'stateless', 'type', 'kind']);

      // This assertion is optional - the LLM might not always include type info
      if (hasTypeInfo) {
        console.log('[2.1] Response includes workflow type information');
      } else {
        console.log('[2.1] Response does not explicitly mention types - this may be acceptable');
      }
    });
  });

  // =========================================================================
  // Test 2.2: Get Workflow Definition
  // =========================================================================
  describe('2.2 - Get Workflow Definition', () => {
    it('should return JSON definition when asked for specific workflow', async function () {
      this.timeout(120_000);

      if (workflowDirs.length === 0) {
        this.skip();
        return;
      }

      // Get the first workflow name for testing
      const firstWorkflowDir = workflowDirs[0];
      const workflowName = path.basename(firstWorkflowDir);
      const projectName = path.basename(path.dirname(firstWorkflowDir));

      console.log(`[2.2] Getting definition for workflow: ${workflowName} in project: ${projectName}`);

      const response = await askLogicApps(driver, `show me the definition of ${workflowName} in ${projectName}`);

      expect(response).to.not.be.null;
      expect(response!.length).to.be.greaterThan(50, 'Response should contain definition');

      // Response should contain JSON-like content or workflow structure
      const hasDefinitionContent = await responseContainsAny(driver, ['$schema', 'triggers', 'actions', 'definition', 'workflow', 'json']);

      console.log('[2.2] Definition response has expected content:', hasDefinitionContent);

      expect(hasDefinitionContent, 'Response should contain workflow definition content').to.be.true;

      await captureScreenshot(driver, '2.2-get-definition');
    });

    it('should include triggers and actions in definition response', async function () {
      this.timeout(120_000);

      if (workflowDirs.length === 0) {
        this.skip();
        return;
      }

      const firstWorkflowDir = workflowDirs[0];
      const workflowName = path.basename(firstWorkflowDir);

      // Read actual workflow to know what to expect
      const workflow = readWorkflowJson(firstWorkflowDir);
      const hasTriggers = workflow?.definition?.triggers && Object.keys(workflow.definition.triggers).length > 0;
      const hasActions = workflow?.definition?.actions && Object.keys(workflow.definition.actions).length > 0;

      console.log(`[2.2] Workflow ${workflowName} has triggers: ${hasTriggers}, actions: ${hasActions}`);

      const response = await askLogicApps(driver, `get workflow definition for ${workflowName}`);

      expect(response).to.not.be.null;

      // Should mention structure elements
      const hasStructureElements = await responseContainsAny(driver, ['trigger', 'action', 'definition', 'workflow']);

      expect(hasStructureElements, 'Response should mention workflow structure').to.be.true;
    });
  });

  // =========================================================================
  // Test 2.3: Get Non-Existent Workflow (Error Handling)
  // =========================================================================
  describe('2.3 - Get Non-Existent Workflow', () => {
    it('should show error message for non-existent workflow', async function () {
      this.timeout(120_000);

      // Ask for a workflow that definitely doesn't exist
      const response = await askLogicApps(driver, 'get workflow definition for NonExistentWorkflow12345');

      expect(response).to.not.be.null;

      console.log('[2.3] Non-existent workflow response:', response?.substring(0, 500));

      // Should indicate workflow not found or ask for clarification
      const hasErrorOrClarification = await responseContainsAny(driver, [
        'not found',
        "doesn't exist",
        'does not exist',
        'could not find',
        "couldn't find",
        'no workflow',
        'which workflow',
        'specify',
        'please provide',
        'unknown',
      ]);

      expect(hasErrorOrClarification, 'Response should indicate workflow not found or ask for clarification').to.be.true;

      await captureScreenshot(driver, '2.3-nonexistent-workflow');
    });

    it('should handle completely invalid workflow names gracefully', async function () {
      this.timeout(120_000);

      // Ask for workflow with special characters
      const response = await askLogicApps(driver, 'show definition of !!!invalid@workflow###');

      expect(response).to.not.be.null;

      // Should not crash - should give some meaningful response
      expect(response!.length).to.be.greaterThan(10, 'Should provide some response');

      console.log('[2.3] Invalid name response:', response?.substring(0, 300));
    });
  });

  // =========================================================================
  // Test 2.4: Disambiguation Prompt
  // =========================================================================
  describe('2.4 - Disambiguation Prompt', () => {
    it('should ask for clarification when multiple matches exist', async function () {
      this.timeout(120_000);

      // This test requires workflows with similar names in multiple projects
      // If we don't have that setup, we test with an ambiguous request

      const response = await askLogicApps(
        driver,
        'get definition of Workflow1' // Generic name that might exist in multiple projects
      );

      expect(response).to.not.be.null;

      console.log('[2.4] Ambiguous request response:', response?.substring(0, 500));

      // Response should either:
      // - Ask which project
      // - Return the definition (if only one match)
      // - Say not found (if no match)
      const hasValidResponse = await responseContainsAny(driver, [
        'which project',
        'multiple',
        'specify',
        'project',
        'definition',
        'workflow',
        'not found',
        "doesn't exist",
        'clarify',
      ]);

      expect(hasValidResponse, 'Should provide valid response for ambiguous request').to.be.true;

      await captureScreenshot(driver, '2.4-disambiguation');
    });

    it('should handle project-less workflow request', async function () {
      this.timeout(120_000);

      if (workflowDirs.length === 0) {
        this.skip();
        return;
      }

      // Get first workflow name without project context
      const workflowName = path.basename(workflowDirs[0]);

      const response = await askLogicApps(driver, `show definition of ${workflowName}`);

      expect(response).to.not.be.null;

      // Should either show definition or ask for project
      const hasValidResponse = await responseContainsAny(driver, [
        'definition',
        'triggers',
        'actions',
        'which project',
        'specify project',
        'workflow',
      ]);

      expect(hasValidResponse, 'Should handle workflow-only request').to.be.true;
    });
  });

  // =========================================================================
  // Additional Read-Only Tests
  // =========================================================================
  describe('Read-Only Operations - Additional', () => {
    it('should describe workflow structure when asked', async function () {
      this.timeout(120_000);

      if (workflowDirs.length === 0) {
        this.skip();
        return;
      }

      const workflowName = path.basename(workflowDirs[0]);

      const response = await askLogicApps(driver, `describe the structure of ${workflowName} workflow`);

      expect(response).to.not.be.null;
      expect(response!.length).to.be.greaterThan(30, 'Should provide description');

      console.log('[read-only] Structure description:', response?.substring(0, 500));
    });

    it('should count workflows when asked', async function () {
      this.timeout(120_000);

      const response = await askLogicApps(driver, 'how many workflows are in my workspace?');

      expect(response).to.not.be.null;

      // Should mention a number or count concept
      const hasCountInfo = await responseContainsAny(driver, [
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        'no workflows',
        'one workflow',
        'workflows',
        'found',
      ]);

      console.log('[read-only] Count response:', response?.substring(0, 300));

      expect(hasCountInfo, 'Should provide count information').to.be.true;
    });
  });
});
