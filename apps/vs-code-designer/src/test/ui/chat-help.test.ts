/// <reference types="mocha" />

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chat Help & Intent Routing E2E Tests
 *
 * Tests Section 1 of the AgentChatTestingPlan.md:
 *   1.1 - @logicapps /help command
 *   1.2 - Natural language help routing
 *   1.3 - General LLM response (no tool calls)
 *
 * Prerequisites:
 *   - VS Code with GitHub Copilot installed and activated
 *   - Logic Apps extension loaded
 *   - Copilot Chat accessible
 */

import { expect } from 'chai';
import { VSBrowser, Workbench, type WebDriver } from 'vscode-extension-tester';
import {
  openChatPanel,
  sendChatPrompt,
  waitForChatResponse,
  getLastChatResponse,
  responseContainsAny,
  askLogicApps,
  closeChatPanel,
  clearChatHistory,
  verifyHelpResponse,
} from './helpers/chatHelper';
import { sleep, clearBlockingUI, captureScreenshot } from './helpers';

/**
 * NOTE: These tests require GitHub Copilot to be authenticated.
 * In automated CI/CD environments, set E2E_SKIP_CHAT_TESTS=true to skip.
 * For manual testing, ensure you're signed into GitHub Copilot before running.
 */
describe('Chat Help & Intent Routing Tests', function () {
  this.timeout(180_000); // 3 minutes per test due to LLM response times

  let driver: WebDriver;
  let workbench: Workbench;
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

    // Try to open chat panel and verify Copilot is available
    console.log('[before] Checking if GitHub Copilot Chat is available...');
    const chatOpened = await openChatPanel(driver);
    if (chatOpened) {
      // Try a simple prompt to see if Copilot responds
      const sent = await sendChatPrompt(driver, 'hello', false);
      if (sent) {
        // Wait briefly for any response
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
      console.log('[before] Could not open chat panel - Copilot may not be installed or authenticated');
      console.log('[before] Set E2E_SKIP_CHAT_TESTS=true to skip these tests in CI');
      // Don't skip - let tests fail so we can see the actual issue
    }

    console.log('[before] Chat help tests setup complete, copilotAvailable:', copilotAvailable);
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
  // Test 1.1: /help Slash Command
  // =========================================================================
  describe('1.1 - Help Slash Command', () => {
    it('should show help markdown with all commands when using /help', async function () {
      this.timeout(120_000);

      // Open chat and send /help command
      const response = await askLogicApps(driver, '/help');

      expect(response).to.not.be.null;
      expect(response).to.be.a('string');
      expect(response!.length).to.be.greaterThan(50, 'Help response should have meaningful content');

      // Verify help content includes key commands
      const verification = await verifyHelpResponse(driver);

      // Log what we found for debugging
      console.log('[1.1] Help response verification:', {
        hasCreateProject: verification.hasCreateProject,
        hasCreateWorkflow: verification.hasCreateWorkflow,
        hasModifyAction: verification.hasModifyAction,
        hasHelp: verification.hasHelp,
        responseLength: verification.fullResponse?.length || 0,
      });

      // At minimum, help should mention creating workflows or projects
      expect(verification.hasCreateProject || verification.hasCreateWorkflow, 'Help should mention createProject or createWorkflow').to.be
        .true;

      // Take screenshot for reference
      await captureScreenshot(driver, '1.1-help-command');
    });

    it('should show workflow types in help response', async function () {
      this.timeout(120_000);

      const response = await askLogicApps(driver, '/help');

      // Help should mention stateful and stateless workflow types
      const hasStateful = response?.toLowerCase().includes('stateful');
      const hasStateless = response?.toLowerCase().includes('stateless');

      console.log('[1.1] Workflow types in help:', { hasStateful, hasStateless });

      // At least one workflow type should be mentioned
      expect(hasStateful || hasStateless, 'Help should mention workflow types').to.be.true;
    });
  });

  // =========================================================================
  // Test 1.2: Natural Language Help Routing
  // =========================================================================
  describe('1.2 - Natural Language Help Routing', () => {
    it('should route "what can you help me with?" to help', async function () {
      this.timeout(120_000);

      const response = await askLogicApps(driver, 'what can you help me with?');

      expect(response).to.not.be.null;
      expect(response!.length).to.be.greaterThan(50, 'Response should have meaningful content');

      // Should get help-like content without needing slash command
      const containsHelpContent = await responseContainsAny(driver, [
        'create',
        'workflow',
        'project',
        'help',
        'action',
        'trigger',
        'logic app',
      ]);

      console.log('[1.2] Natural language help routed correctly:', containsHelpContent);

      expect(containsHelpContent, 'Natural language should route to help-like content').to.be.true;

      await captureScreenshot(driver, '1.2-natural-language-help');
    });

    it('should route "help me understand your capabilities" to help', async function () {
      this.timeout(120_000);

      const response = await askLogicApps(driver, 'help me understand your capabilities');

      expect(response).to.not.be.null;

      // Should describe capabilities
      const describesCapabilities = await responseContainsAny(driver, [
        'create',
        'workflow',
        'project',
        'action',
        'trigger',
        'connector',
        'logic app',
        'help',
      ]);

      expect(describesCapabilities, 'Should describe capabilities').to.be.true;
    });
  });

  // =========================================================================
  // Test 1.3: General LLM Response (No Tool Calls)
  // =========================================================================
  describe('1.3 - General LLM Response', () => {
    it('should provide general LLM response for off-topic questions', async function () {
      this.timeout(120_000);

      // Ask something completely unrelated to Logic Apps
      const response = await askLogicApps(driver, "how's the weather?");

      expect(response).to.not.be.null;
      expect(response!.length).to.be.greaterThan(10, 'Should provide some response');

      // Response should NOT indicate a tool was called or workflow modified
      // It should be a general conversational response
      const hasToolCallIndicator =
        response?.toLowerCase().includes('workflow.json') ||
        response?.toLowerCase().includes('created workflow') ||
        response?.toLowerCase().includes('added action');

      console.log('[1.3] General LLM response (no tools):', {
        responseLength: response?.length,
        hasToolCallIndicator,
      });

      // For off-topic questions, we shouldn't be modifying workflows
      expect(hasToolCallIndicator, 'Off-topic questions should not trigger tool calls').to.be.false;

      await captureScreenshot(driver, '1.3-general-llm-response');
    });

    it('should handle coding questions gracefully', async function () {
      this.timeout(120_000);

      // Ask a general coding question
      const response = await askLogicApps(driver, 'what is a for loop in JavaScript?');

      expect(response).to.not.be.null;

      // Should either:
      // - Answer the question (knows about JavaScript)
      // - Redirect to Logic Apps context
      // - Say it can't help with that
      console.log('[1.3] Coding question response length:', response?.length);

      // Just verify we got a response - content may vary
      expect(response!.length).to.be.greaterThan(10, 'Should provide some response');
    });

    it('should redirect Logic Apps questions appropriately', async function () {
      this.timeout(120_000);

      // Ask a Logic Apps related question
      const response = await askLogicApps(driver, 'what is a connector in Azure Logic Apps?');

      expect(response).to.not.be.null;

      // Should mention something about Logic Apps or connectors
      const isRelevantResponse = await responseContainsAny(driver, [
        'connector',
        'logic app',
        'action',
        'trigger',
        'api',
        'service',
        'workflow',
      ]);

      console.log('[1.3] Logic Apps question response relevant:', isRelevantResponse);

      // Should give a relevant response about Logic Apps
      expect(isRelevantResponse, 'Logic Apps question should get relevant response').to.be.true;
    });
  });

  // =========================================================================
  // Test: Chat Panel Accessibility
  // =========================================================================
  describe('Chat Panel Operations', () => {
    it('should be able to open and interact with chat panel', async function () {
      this.timeout(60_000);

      // Verify chat panel can be opened
      const opened = await openChatPanel(driver);
      expect(opened, 'Chat panel should open').to.be.true;

      // Verify we can send a simple prompt
      const sent = await sendChatPrompt(driver, 'hello', true);
      expect(sent, 'Should be able to send prompt').to.be.true;

      // Wait for response
      const responseComplete = await waitForChatResponse(driver, 60_000);
      expect(responseComplete, 'Should receive response').to.be.true;

      // Verify we got some response
      const response = await getLastChatResponse(driver);
      expect(response).to.not.be.null;
      expect(response!.length).to.be.greaterThan(0, 'Response should have content');

      console.log('[chat-panel] Successfully interacted with chat panel');
    });
  });
});
