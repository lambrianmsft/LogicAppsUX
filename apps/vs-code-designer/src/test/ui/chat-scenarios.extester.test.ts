/// <reference types="mocha" />

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EditorView, VSBrowser, Workbench, type WebDriver } from 'vscode-extension-tester';
import {
  chatScenarioFixtures,
  runChatScenario,
  type ChatScenarioDefinition,
  type ChatScenarioDiagnosticEvent,
  type ChatScenarioPromptStep,
  type ChatScenarioRunContext,
  type ChatScenarioRuntimeAdapter,
  type ChatScenarioRuntimeState,
  type ChatScenarioStepResult,
  type ChatScenarioWorkflowOperationAssertion,
} from '../chatScenarios';
import { canvasHasNode, openDesignerViaExplorer, openWorkspaceFileInSession, switchToDesignerWebview } from './designerHelpers';
import { captureScreenshot, clearBlockingUI, sleep } from './helpers';
import {
  clearChatHistory,
  closeChatPanel,
  getLastChatResponse,
  openChatPanel,
  sendChatPrompt,
  waitForChatResponse,
  askLogicApps,
} from './helpers/chatHelper';
import { readWorkflowJson, takeWorkspaceTopologySnapshot, type WorkflowJson } from './helpers/workspaceHelper';

const WORKSPACE_ROOT_TOKEN = '__CHAT_SCENARIO_WORKSPACE_ROOT__';
const CHAT_AUTH_PROBE_TIMEOUT = 30_000;
const CHAT_SCENARIO_ROOT_PREFIX = 'la-chat-scenario-';
const WORKFLOW_SCHEMA = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';

interface ExTesterChatScenarioAdapterContext {
  driver: WebDriver;
  workbench: Workbench;
  workspaceRoot: string;
  workspaceFilePath: string;
  scenario: ChatScenarioDefinition;
}

function cloneWithWorkspaceRoot<T>(value: T, workspaceRoot: string): T {
  if (typeof value === 'string') {
    return value.split(WORKSPACE_ROOT_TOKEN).join(workspaceRoot.replace(/\\/g, '/')) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneWithWorkspaceRoot(entry, workspaceRoot)) as T;
  }

  if (value && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneWithWorkspaceRoot(nestedValue, workspaceRoot);
    }
    return clone as T;
  }

  return value;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function statefulWorkflow(workflow?: WorkflowJson): WorkflowJson {
  return (
    workflow ?? {
      kind: 'Stateful',
      definition: {
        $schema: WORKFLOW_SCHEMA,
        contentVersion: '1.0.0.0',
        triggers: {},
        actions: {},
      },
    }
  );
}

function writeLogicAppProject(projectDir: string): void {
  writeJson(path.join(projectDir, 'host.json'), {
    version: '2.0',
    extensionBundle: {
      id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
      version: '[1.*, 2.0.0)',
    },
  });
  writeJson(path.join(projectDir, 'local.settings.json'), {
    IsEncrypted: false,
    Values: {
      AzureWebJobsStorage: 'UseDevelopmentStorage=true',
      FUNCTIONS_WORKER_RUNTIME: 'dotnet',
      APP_KIND: 'workflowApp',
    },
  });
  writeJson(path.join(projectDir, 'connections.json'), {
    managedApiConnections: {},
    serviceProviderConnections: {},
  });
}

function writeWorkflow(workflowDir: string, workflow?: WorkflowJson): void {
  writeJson(path.join(workflowDir, 'workflow.json'), statefulWorkflow(workflow));
}

function ensureProjectWithWorkflow(workspaceRoot: string, projectName: string, workflowName: string, workflow?: WorkflowJson): void {
  const projectDir = path.join(workspaceRoot, projectName);
  writeLogicAppProject(projectDir);
  writeWorkflow(path.join(projectDir, workflowName), workflow);
}

function writeWorkspaceFile(workspaceRoot: string, workspaceFilePath: string): void {
  writeJson(workspaceFilePath, {
    folders: [{ path: '.' }],
    settings: {
      'azureLogicAppsStandard.autoRuntimeDependenciesValidationAndInstallation': false,
      'azureLogicAppsStandard.autoStartDesignTime': false,
      'azureLogicAppsStandard.showStartDesignTimeMessage': false,
      'azureLogicAppsStandard.autoStartAzurite': false,
      'azureLogicAppsStandard.silentAuth': true,
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false,
      'update.mode': 'none',
    },
  });
}

function materializeScenarioWorkspace(scenario: ChatScenarioDefinition): ChatScenarioDefinition {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), CHAT_SCENARIO_ROOT_PREFIX));
  const resolvedScenario = cloneWithWorkspaceRoot(scenario, workspaceRoot);
  const workspaceFilePath =
    resolvedScenario.before.workspace?.workspaceFilePath ?? path.join(workspaceRoot, 'chat-scenarios.code-workspace');

  fs.mkdirSync(workspaceRoot, { recursive: true });
  writeWorkspaceFile(workspaceRoot, workspaceFilePath);

  switch (scenario.id) {
    case 'chat.create-project.workspace-root':
      break;
    case 'chat.create-project.sibling-from-existing-project': {
      writeLogicAppProject(path.join(workspaceRoot, 'ExistingProject'));
      writeWorkflow(path.join(workspaceRoot, 'ExistingProject', 'Stateful1'));
      break;
    }
    case 'chat.add-workflow.intended-project': {
      writeLogicAppProject(path.join(workspaceRoot, 'OrderProject'));
      writeLogicAppProject(path.join(workspaceRoot, 'InventoryProject'));
      writeWorkflow(path.join(workspaceRoot, 'OrderProject', 'Stateful1'));
      writeWorkflow(path.join(workspaceRoot, 'InventoryProject', 'Stateful1'));
      break;
    }
    case 'chat.add-action.intended-workflow': {
      ensureProjectWithWorkflow(
        workspaceRoot,
        'OrderProject',
        'ProcessOrder',
        resolvedScenario.before.workflow?.workflow ?? statefulWorkflow()
      );
      ensureProjectWithWorkflow(
        workspaceRoot,
        'InventoryProject',
        'ProcessOrder',
        resolvedScenario.before.workflow?.workflow ?? statefulWorkflow()
      );
      break;
    }
    case 'chat.help.connector.response-only':
    case 'chat.ambiguous-workflow.no-mutation':
    default:
      if (resolvedScenario.before.workflow?.workflowJsonPath) {
        const workflowDir = path.dirname(resolvedScenario.before.workflow.workflowJsonPath);
        const projectDir = path.dirname(workflowDir);
        writeLogicAppProject(projectDir);
        writeWorkflow(workflowDir, resolvedScenario.before.workflow.workflow);
      }
      break;
  }

  return resolvedScenario;
}

function readWorkflowFromJsonPath(workflowJsonPath: string | undefined): WorkflowJson | null | undefined {
  if (!workflowJsonPath || !fs.existsSync(workflowJsonPath)) {
    return undefined;
  }

  return readWorkflowJson(path.dirname(workflowJsonPath));
}

function getWorkflowForPhase(phase: 'before' | 'after', scenario: ChatScenarioDefinition): WorkflowJson | null | undefined {
  const workflowJsonPath =
    phase === 'after'
      ? (scenario.expected.workflow?.workflowJsonPath ?? scenario.before.workflow?.workflowJsonPath)
      : scenario.before.workflow?.workflowJsonPath;
  return readWorkflowFromJsonPath(workflowJsonPath);
}

function hasAuthError(response: string | null | undefined): boolean {
  const responseText = (response || '').toLowerCase();
  return [
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
  ].some((pattern) => responseText.includes(pattern));
}

function operationDisplayName(assertion: ChatScenarioWorkflowOperationAssertion): string | undefined {
  if (typeof assertion.expectation === 'string') {
    return assertion.expectation;
  }

  return assertion.expectation.name ?? assertion.expectation.type ?? assertion.expectedType;
}

async function waitForDesignerEvidence(driver: WebDriver, expectedText: string): Promise<boolean> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await canvasHasNode(driver, expectedText)) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function collectDesignerEvidence(
  driver: WebDriver,
  scenario: ChatScenarioDefinition
): Promise<readonly ChatScenarioDiagnosticEvent[]> {
  const workflowJsonPath = scenario.expected.workflow?.workflowJsonPath ?? scenario.before.workflow?.workflowJsonPath;
  const requiredOperations = [
    ...(scenario.expected.workflow?.requiredTriggers ?? []),
    ...(scenario.expected.workflow?.requiredActions ?? []),
  ];

  if (!workflowJsonPath || requiredOperations.length === 0 || !fs.existsSync(workflowJsonPath)) {
    return [];
  }

  const evidenceLabels = requiredOperations.map(operationDisplayName).filter((label): label is string => Boolean(label));
  if (evidenceLabels.length === 0) {
    return [];
  }

  const diagnostics: ChatScenarioDiagnosticEvent[] = [];
  try {
    await driver.switchTo().defaultContent();
    await new EditorView().closeAllEditors();
    await sleep(1000);

    const opened = await openDesignerViaExplorer(driver, workflowJsonPath, path.basename(path.dirname(workflowJsonPath)), false, true);
    if (!opened) {
      return [
        {
          severity: 'warning',
          message: `Designer evidence skipped because the designer did not open for ${workflowJsonPath}.`,
        },
      ];
    }

    await switchToDesignerWebview(driver);
    for (const label of evidenceLabels) {
      expect(await waitForDesignerEvidence(driver, label), `Designer canvas should show "${label}" for ${scenario.id}`).to.be.true;
      diagnostics.push({
        severity: 'info',
        message: `Designer canvas showed expected operation "${label}".`,
      });
    }

    await captureScreenshot(driver, `chat-scenario-designer-${scenario.id.replace(/[^a-z0-9-]/gi, '-')}`);
    return diagnostics;
  } finally {
    try {
      await driver.switchTo().defaultContent();
    } catch {
      // Ignore cleanup failures.
    }
  }
}

class ExTesterChatScenarioAdapter implements ChatScenarioRuntimeAdapter<ExTesterChatScenarioAdapterContext> {
  readonly name = 'extester-copilot-chat';

  constructor(
    private readonly driver: WebDriver,
    private readonly workbench: Workbench
  ) {}

  async initialize(scenario: ChatScenarioDefinition): Promise<ExTesterChatScenarioAdapterContext> {
    const resolvedScenario = materializeScenarioWorkspace(scenario);
    const workspaceRoot = resolvedScenario.before.workspace?.workspaceRoot;
    const workspaceFilePath = resolvedScenario.before.workspace?.workspaceFilePath;
    if (!workspaceRoot || !workspaceFilePath) {
      throw new Error(`Scenario ${scenario.id} did not resolve a workspace root and workspace file path.`);
    }

    await openWorkspaceFileInSession(this.workbench, workspaceFilePath);
    await sleep(3000);
    await clearBlockingUI(this.driver);
    await clearChatHistory(this.driver);

    return {
      driver: this.driver,
      workbench: this.workbench,
      workspaceRoot,
      workspaceFilePath,
      scenario: resolvedScenario,
    };
  }

  captureState(
    phase: 'before' | 'after',
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<ExTesterChatScenarioAdapterContext>
  ): ChatScenarioRuntimeState {
    const activeScenario = context.adapterContext?.scenario ?? scenario;
    const workspace = activeScenario.before.workspace;
    return {
      workspaceTopology: workspace
        ? takeWorkspaceTopologySnapshot(workspace.workspaceRoot, {
            ...workspace.topologyOptions,
            workspaceFilePath: workspace.workspaceFilePath ?? workspace.topologyOptions?.workspaceFilePath,
          })
        : undefined,
      workflow: getWorkflowForPhase(phase, activeScenario),
    };
  }

  async sendPrompt(
    step: ChatScenarioPromptStep,
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<ExTesterChatScenarioAdapterContext>
  ): Promise<ChatScenarioStepResult> {
    const prompt =
      step.participant && !step.prompt.trim().startsWith(step.participant) ? `${step.participant} ${step.prompt}` : step.prompt;
    const responseText = await askLogicApps(context.adapterContext?.driver ?? this.driver, prompt, {
      ensureChatOpen: true,
      includeParticipant: false,
      timeout: step.timeoutMs ?? 120_000,
    });

    return {
      stepId: step.id,
      responseText,
      diagnostics: step.diagnosticsLabel ? [`Diagnostics label: ${step.diagnosticsLabel}`] : undefined,
    };
  }

  async collectDiagnostics(
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<ExTesterChatScenarioAdapterContext>
  ): Promise<readonly ChatScenarioDiagnosticEvent[]> {
    const responseTranscript = context.stepResults
      .filter((stepResult) => stepResult.responseText)
      .map((stepResult) => `${stepResult.stepId}: ${stepResult.responseText}`);

    const transcriptDiagnostics: ChatScenarioDiagnosticEvent[] = scenario.diagnostics?.includeResponseTranscript
      ? responseTranscript.map((message) => ({
          severity: 'info',
          message,
        }))
      : [];

    const activeScenario = context.adapterContext?.scenario ?? scenario;
    const designerDiagnostics = await collectDesignerEvidence(context.adapterContext?.driver ?? this.driver, activeScenario);

    return [...transcriptDiagnostics, ...designerDiagnostics];
  }

  dispose(_scenario: ChatScenarioDefinition, context: ChatScenarioRunContext<ExTesterChatScenarioAdapterContext>): void {
    const workspaceRoot = context.adapterContext?.workspaceRoot;
    if (workspaceRoot && fs.existsSync(workspaceRoot)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
}

describe('ChatScenario ExTester adapter tests', function () {
  this.timeout(300_000);

  let driver: WebDriver;
  let workbench: Workbench;
  let copilotAvailable = false;

  before(async function () {
    this.timeout(90_000);

    if (process.env.E2E_SKIP_CHAT_TESTS === 'true') {
      console.log('[before] E2E_SKIP_CHAT_TESTS=true, skipping ChatScenario ExTester adapter tests');
      this.skip();
      return;
    }

    driver = VSBrowser.instance.driver;
    workbench = new Workbench();

    await sleep(3000);
    await clearBlockingUI(driver);

    const chatOpened = await openChatPanel(driver);
    if (chatOpened) {
      const sent = await sendChatPrompt(driver, 'hello', false);
      if (sent && (await waitForChatResponse(driver, CHAT_AUTH_PROBE_TIMEOUT))) {
        const response = await getLastChatResponse(driver);
        copilotAvailable = !hasAuthError(response);
        if (!copilotAvailable) {
          console.log(`[before] Copilot auth probe response: ${response?.substring(0, 200)}`);
        }
      }
    }

    if (!copilotAvailable && process.env.E2E_REQUIRE_COPILOT !== 'true') {
      console.log('[before] GitHub Copilot Chat is not available; skipping ChatScenario ExTester adapter tests');
      this.skip();
      return;
    }
  });

  beforeEach(async function () {
    if (!copilotAvailable && process.env.E2E_REQUIRE_COPILOT !== 'true') {
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
      // Ignore cleanup failures.
    }
  });

  const exTesterFixtures = chatScenarioFixtures.filter((scenario) => !scenario.surfaces || scenario.surfaces.includes('exTester'));

  for (const scenario of exTesterFixtures) {
    it(`runs shared ChatScenario fixture: ${scenario.id}`, async function () {
      this.timeout(300_000);

      const adapter = new ExTesterChatScenarioAdapter(driver, workbench);
      const result = await runChatScenario(scenario, adapter);

      console.log(`[chat-scenario] ${scenario.id} diagnostics: ${JSON.stringify(result.diagnostics)}`);

      expect(result.scenarioId).to.equal(scenario.id);
      expect(result.adapterName).to.equal(adapter.name);
      expect(result.stepResults.length).to.equal(scenario.conversation.length);
      expect(result.mutationDiff?.violations ?? []).to.deep.equal([]);
    });
  }
});
