/// <reference types="mocha" />

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { VSBrowser, type WebDriver } from 'vscode-extension-tester';
import {
  askLogicApps,
  clearChatHistory,
  closeChatPanel,
  getLastChatResponse,
  openChatPanel,
  responseContainsAll,
  responseContainsAny,
  responseContainsNone,
  sendChatPrompt,
  waitForChatResponse,
} from './helpers/chatHelper';
import { findLogicAppProjects, findWorkflowDirs } from './helpers/workspaceHelper';
import { captureScreenshot, clearBlockingUI, sleep } from './helpers';

function readFileIfExists(filePath: string): string | undefined {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : undefined;
}

function resolveServiceProviderProjectDir(): string | undefined {
  const workspaceCandidates = [
    process.env.TEST_WORKSPACE_DIR,
    process.cwd(),
    path.resolve(__dirname, '..', '..', 'e2e', 'test-workspace'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const workspaceCandidate of workspaceCandidates) {
    const hasDirectProject = fs.existsSync(path.join(workspaceCandidate, 'host.json'));
    const hasStatefulWorkflow = fs.existsSync(path.join(workspaceCandidate, 'Stateful1', 'workflow.json'));
    if (hasDirectProject && hasStatefulWorkflow) {
      return workspaceCandidate;
    }

    const nestedProject = findLogicAppProjects(workspaceCandidate).find((candidateProjectDir) =>
      findWorkflowDirs(candidateProjectDir).some((workflowDir) => path.basename(workflowDir) === 'Stateful1')
    );
    if (nestedProject) {
      return nestedProject;
    }
  }

  return undefined;
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

describe('Chat ServiceProvider Action Tests', function () {
  this.timeout(180_000);

  let driver: WebDriver;
  let copilotAvailable = false;
  let projectDir: string | undefined;
  let workflowPath: string | undefined;
  let connectionsPath: string | undefined;
  let localSettingsPath: string | undefined;
  let workflowBaseline: string | undefined;
  let connectionsBaseline: string | undefined;
  let localSettingsBaseline: string | undefined;

  before(async function () {
    this.timeout(90_000);

    if (process.env.E2E_SKIP_CHAT_TESTS === 'true') {
      console.log('[before] E2E_SKIP_CHAT_TESTS=true, skipping chat tests');
      this.skip();
      return;
    }

    driver = VSBrowser.instance.driver;

    await sleep(3000);
    await clearBlockingUI(driver);

    projectDir = resolveServiceProviderProjectDir();

    if (!projectDir) {
      console.log('[before] No Logic App project with Stateful1 found, skipping ServiceProvider chat tests');
      this.skip();
      return;
    }

    workflowPath = path.join(projectDir, 'Stateful1', 'workflow.json');
    connectionsPath = path.join(projectDir, 'connections.json');
    localSettingsPath = path.join(projectDir, 'local.settings.json');
    workflowBaseline = readFileIfExists(workflowPath);
    connectionsBaseline = readFileIfExists(connectionsPath);
    localSettingsBaseline = readFileIfExists(localSettingsPath);

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

    console.log('[before] Chat ServiceProvider tests setup complete, copilotAvailable:', copilotAvailable);
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

    if (workflowPath) {
      restoreFile(workflowPath, workflowBaseline);
    }
    if (connectionsPath) {
      restoreFile(connectionsPath, connectionsBaseline);
    }
    if (localSettingsPath) {
      restoreFile(localSettingsPath, localSettingsBaseline);
    }
  });

  it('asks for Service Bus connection details in chat instead of falling back to generic validation', async function () {
    this.timeout(120_000);

    const actionName = `ChatServiceBusPrompt${Date.now()}`;
    const response = await askLogicApps(driver, `add a Service Bus send message action called ${actionName} to Stateful1`);

    expect(response).to.not.be.null;
    expect(response!.length).to.be.greaterThan(50, 'Response should explain which Service Bus connection fields are needed');

    const requestsServiceBusFields = await responseContainsAll(driver, [
      'serviceproviderconnection.connectionstring',
      'serviceproviderconnection.endpoint',
      'serviceproviderconnection.sharedaccesskeyname',
      'serviceproviderconnection.sharedaccesskey',
    ]);
    const avoidsGenericFallback = await responseContainsNone(driver, ['inputs.serviceproviderconfiguration', 'wizard']);
    const mentionsServiceBus = await responseContainsAny(driver, ['service bus', 'servicebus', 'connection details']);

    expect(requestsServiceBusFields, 'Response should ask for Service Bus connection fields').to.be.true;
    expect(avoidsGenericFallback, 'Response should stay chat-first and avoid generic fallback text').to.be.true;
    expect(mentionsServiceBus, 'Response should stay on the Service Bus topic').to.be.true;

    await captureScreenshot(driver, 'serviceprovider-chat-missing-fields');
  });

  it('asks for the remaining Service Bus auth fields when only the endpoint is provided', async function () {
    this.timeout(120_000);

    const actionName = `ChatServiceBusPartial${Date.now()}`;
    await askLogicApps(driver, `add a Service Bus send message action called ${actionName} to Stateful1`);

    const response = await askLogicApps(
      driver,
      'Use serviceProviderConnection.endpoint = sb://contoso.servicebus.windows.net/ for that Service Bus action.'
    );

    expect(response).to.not.be.null;
    expect(response!.length).to.be.greaterThan(30, 'Response should ask for the remaining Service Bus auth fields');

    const requestsRemainingFields = await responseContainsAll(driver, [
      'serviceproviderconnection.sharedaccesskeyname',
      'serviceproviderconnection.sharedaccesskey',
    ]);
    const avoidsGenericFallback = await responseContainsNone(driver, ['inputs.serviceproviderconfiguration', 'wizard']);

    expect(requestsRemainingFields, 'Response should ask for the remaining Service Bus auth fields').to.be.true;
    expect(avoidsGenericFallback, 'Response should not fall back to generic validation or a wizard').to.be.true;

    await captureScreenshot(driver, 'serviceprovider-chat-partial-fields');
  });

  it('confirms the Service Bus action after the user provides the full connection details in chat', async function () {
    this.timeout(120_000);

    const actionName = `ChatServiceBusComplete${Date.now()}`;
    await askLogicApps(driver, `add a Service Bus send message action called ${actionName} to Stateful1`);

    const response = await askLogicApps(
      driver,
      'Retry that Service Bus action with serviceProviderConnection.endpoint = sb://contoso.servicebus.windows.net/, serviceProviderConnection.sharedAccessKeyName = RootManageSharedAccessKey, and serviceProviderConnection.sharedAccessKey = test-key.'
    );

    expect(response).to.not.be.null;
    expect(response!.length).to.be.greaterThan(30, 'Response should confirm the Service Bus action was added');

    const hasSuccessSignal = await responseContainsAny(driver, [
      'successfully added action',
      'created connection',
      'added action',
      'added to workflow',
    ]);
    const mentionsServiceBus = await responseContainsAny(driver, ['service bus', 'servicebus']);
    const avoidsGenericFallback = await responseContainsNone(driver, ['inputs.serviceproviderconfiguration', 'wizard']);

    expect(hasSuccessSignal, 'Response should confirm that the Service Bus action was added').to.be.true;
    expect(mentionsServiceBus, 'Response should still refer to the Service Bus action').to.be.true;
    expect(avoidsGenericFallback, 'Response should not fall back to generic validation or a wizard').to.be.true;

    await captureScreenshot(driver, 'serviceprovider-chat-complete-fields');
  });
});
