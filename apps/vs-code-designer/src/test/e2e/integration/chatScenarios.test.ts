import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { captureFilesystemState, chatScenarioFixtures, runChatScenario } from '../../chatScenarios';
import type {
  ChatScenarioDefinition,
  ChatScenarioDiagnosticEvent,
  ChatScenarioObservationStep,
  ChatScenarioPromptStep,
  ChatScenarioRunContext,
  ChatScenarioRuntimeAdapter,
  ChatScenarioRuntimeState,
  ChatScenarioStepResult,
} from '../../chatScenarios';
import type { WorkflowJson } from '../../ui/helpers/workspaceHelper';
import { sendChatAndWait, waitForExtensionActivation } from '../helpers/chatTestHost';

const WORKSPACE_ROOT_PLACEHOLDER = '__CHAT_SCENARIO_WORKSPACE_ROOT__';

interface ExtensionHostChatScenarioContext {
  readonly workspaceRoot: string;
  readonly workspaceFilePath: string;
  readonly originalWorkspaceFolders: readonly WorkspaceFolderSnapshot[];
  readonly responseTranscript: string[];
}

interface WorkspaceFolderSnapshot {
  readonly uri: vscode.Uri;
  readonly name: string;
}

suite('Shared ChatScenario fixtures (Extension Host)', () => {
  suiteSetup(async function () {
    this.timeout(90_000);
    assertExtensionHostFixtureContracts(extensionHostFixtures);
    const activated = await waitForExtensionActivation(60_000);
    assert.ok(activated, 'Logic Apps extension should activate before running shared chat scenarios.');
  });

  const extensionHostFixtures = chatScenarioFixtures.filter((fixture) => !fixture.surfaces || fixture.surfaces.includes('extensionHost'));

  for (const fixture of extensionHostFixtures) {
    test(`${fixture.title} (${fixture.id})`, async function () {
      this.timeout(Math.max(180_000, ...fixture.conversation.map((step) => (step.kind === 'prompt' ? (step.timeoutMs ?? 0) : 0) + 90_000)));

      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'laux-chat-scenario-'));
      const resolvedScenario = resolveScenarioPlaceholders(fixture, workspaceRoot);
      const adapter = createExtensionHostChatScenarioAdapter(workspaceRoot);

      try {
        const result = await runChatScenario(resolvedScenario, adapter);
        for (const diagnostic of result.diagnostics) {
          console.log(`[chat-scenario:${diagnostic.severity}] ${diagnostic.message}`);
        }
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  }
});

function createExtensionHostChatScenarioAdapter(workspaceRoot: string): ChatScenarioRuntimeAdapter<ExtensionHostChatScenarioContext> {
  return {
    name: 'vscode-extension-host-chat',
    async initialize(scenario) {
      const workspaceFilePath = scenario.before.workspace?.workspaceFilePath ?? path.join(workspaceRoot, 'chat-scenarios.code-workspace');
      materializeScenarioBeforeState(scenario, workspaceRoot, workspaceFilePath);

      const originalWorkspaceFolders = snapshotWorkspaceFolders();
      await replaceWorkspaceFolders([{ uri: vscode.Uri.file(workspaceRoot), name: 'ChatScenarioWorkspace' }]);

      return {
        workspaceRoot,
        workspaceFilePath,
        originalWorkspaceFolders,
        responseTranscript: [],
      };
    },
    captureState(phase, scenario): ChatScenarioRuntimeState {
      return {
        ...captureFilesystemState(scenario),
        workflow: readScenarioWorkflowForPhase(phase, scenario),
      };
    },
    async sendPrompt(
      step: ChatScenarioPromptStep,
      scenario: ChatScenarioDefinition,
      context: ChatScenarioRunContext<ExtensionHostChatScenarioContext>
    ): Promise<ChatScenarioStepResult> {
      const options = getSendChatOptions(step, scenario, context.beforeState);
      const prompt =
        step.participant && !step.prompt.trim().startsWith(step.participant) ? `${step.participant} ${step.prompt}` : step.prompt;
      const responseText = await sendChatAndWait(prompt, options);
      context.adapterContext?.responseTranscript.push(`## ${step.id}\n${responseText ?? '(no response text returned)'}`);

      return {
        stepId: step.id,
        responseText,
      };
    },
    observe(step: ChatScenarioObservationStep): ChatScenarioStepResult {
      return {
        stepId: step.id,
        diagnostics: [`Observation step recorded: ${step.description}`],
      };
    },
    collectDiagnostics(
      scenario: ChatScenarioDefinition,
      context: ChatScenarioRunContext<ExtensionHostChatScenarioContext>
    ): readonly ChatScenarioDiagnosticEvent[] {
      if (!scenario.diagnostics?.includeResponseTranscript || !context.adapterContext?.responseTranscript.length) {
        return [];
      }

      return [
        {
          severity: 'info',
          message: context.adapterContext.responseTranscript.join('\n\n'),
        },
      ];
    },
    async dispose(_scenario, context) {
      await replaceWorkspaceFolders(context.adapterContext?.originalWorkspaceFolders ?? []);
    },
  };
}

function assertExtensionHostFixtureContracts(fixtures: readonly ChatScenarioDefinition[]): void {
  assert.ok(fixtures.length > 0, 'Extension-host ChatScenario fixture filter should include at least one fixture.');
  assert.ok(
    fixtures.every((fixture) => fixture.id !== 'chat.create-project.workspace-root'),
    'Create-project root ChatScenario must remain ExTester-only until active workspace isolation is solved.'
  );
  assert.ok(
    fixtures.some((fixture) => fixture.id === 'chat.help.connector.response-only'),
    'Extension-host fixture set should retain the help no-mutation scenario.'
  );
  assert.ok(
    fixtures.some((fixture) => fixture.id === 'chat.ambiguous-workflow.no-mutation'),
    'Extension-host fixture set should retain the ambiguous no-mutation scenario.'
  );

  for (const fixture of fixtures) {
    assert.ok(fixture.before.workspace?.topologyAssertions, `${fixture.id} should assert before workspace topology.`);
    assert.ok(fixture.expected.workspaceTopology, `${fixture.id} should assert after workspace topology.`);
    assert.ok(fixture.mutationPolicy, `${fixture.id} should declare a mutation policy.`);

    for (const step of fixture.conversation) {
      if (step.kind !== 'prompt') {
        continue;
      }

      assert.ok(step.expectedResponse, `${fixture.id}/${step.id} should declare semantic response expectations.`);
      assert.ok(
        !step.prompt.includes('/createProject') && !step.prompt.includes('logicapps_'),
        `${fixture.id}/${step.id} should remain a natural chat prompt instead of a direct tool invocation.`
      );
    }
  }
}

function getSendChatOptions(
  step: ChatScenarioPromptStep,
  scenario: ChatScenarioDefinition,
  beforeState: ChatScenarioRuntimeState | undefined
): Parameters<typeof sendChatAndWait>[1] {
  const expectedWorkflowPath = scenario.expected.workflow?.workflowJsonPath;
  const beforeWorkflowExists = expectedWorkflowPath ? fs.existsSync(expectedWorkflowPath) : false;
  const responseIncludes = step.expectedResponse?.shouldMention;

  if (expectedWorkflowPath && !beforeWorkflowExists) {
    return {
      waitForFile: expectedWorkflowPath,
      responseIncludes,
      timeoutMs: step.timeoutMs,
    };
  }

  const baselineActions = beforeState?.workflow?.definition?.actions ? Object.keys(beforeState.workflow.definition.actions) : [];
  if (expectedWorkflowPath && scenario.expected.workflow?.requiredActions?.length) {
    return {
      waitForActionChange: {
        path: expectedWorkflowPath,
        baseline: baselineActions,
      },
      responseIncludes,
      timeoutMs: step.timeoutMs,
    };
  }

  return {
    minWait: step.timeoutMs ? Math.min(step.timeoutMs, 30_000) : 10_000,
    responseIncludes,
    timeoutMs: step.timeoutMs,
  };
}

function readScenarioWorkflowForPhase(phase: 'before' | 'after', scenario: ChatScenarioDefinition): WorkflowJson | null | undefined {
  const workflowJsonPath =
    phase === 'after'
      ? (scenario.expected.workflow?.workflowJsonPath ?? scenario.before.workflow?.workflowJsonPath)
      : scenario.before.workflow?.workflowJsonPath;

  if (workflowJsonPath) {
    if (!fs.existsSync(workflowJsonPath)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8')) as WorkflowJson;
  }

  return phase === 'after' ? scenario.expected.workflow?.workflow : scenario.before.workflow?.workflow;
}

function materializeScenarioBeforeState(scenario: ChatScenarioDefinition, workspaceRoot: string, workspaceFilePath: string): void {
  fs.mkdirSync(workspaceRoot, { recursive: true });
  writeJson(workspaceFilePath, {
    folders: [{ path: '.' }],
    settings: {
      'azureLogicAppsStandard.autoRuntimeDependenciesValidationAndInstallation': false,
      'azureLogicAppsStandard.autoStartAzurite': false,
      'azureLogicAppsStandard.autoStartDesignTime': false,
      'azureLogicAppsStandard.showStartDesignTimeMessage': false,
      'azureLogicAppsStandard.silentAuth': true,
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false,
      'update.mode': 'none',
    },
  });

  switch (scenario.id) {
    case 'chat.help.connector.response-only':
    case 'chat.ambiguous-workflow.no-mutation': {
      createLogicAppProject(workspaceRoot, 'OrderProject');
      writeScenarioWorkflow(scenario, path.join(workspaceRoot, 'OrderProject', 'Stateful1'));
      break;
    }
    case 'chat.add-workflow.intended-project': {
      createLogicAppProject(workspaceRoot, 'OrderProject');
      createLogicAppProject(workspaceRoot, 'InventoryProject');
      break;
    }
    case 'chat.add-action.intended-workflow': {
      createLogicAppProject(workspaceRoot, 'OrderProject');
      createLogicAppProject(workspaceRoot, 'InventoryProject');
      const workflow = scenario.before.workflow?.workflow;
      writeWorkflow(path.join(workspaceRoot, 'OrderProject', 'ProcessOrder'), workflow);
      writeWorkflow(path.join(workspaceRoot, 'InventoryProject', 'ProcessOrder'), workflow);
      break;
    }
    default:
      throw new Error(`No extension-host scenario materializer exists for ${scenario.id}`);
  }
}

function createLogicAppProject(workspaceRoot: string, projectName: string): void {
  const projectDir = path.join(workspaceRoot, projectName);
  fs.mkdirSync(projectDir, { recursive: true });
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
      FUNCTIONS_WORKER_RUNTIME: 'node',
    },
  });
  writeJson(path.join(projectDir, 'connections.json'), {
    managedApiConnections: {},
    serviceProviderConnections: {},
  });
}

function writeScenarioWorkflow(scenario: ChatScenarioDefinition, fallbackWorkflowDir: string): void {
  const workflowDir = scenario.before.workflow?.workflowJsonPath
    ? path.dirname(scenario.before.workflow.workflowJsonPath)
    : (scenario.before.workflow?.workflowDir ?? fallbackWorkflowDir);
  writeWorkflow(workflowDir, scenario.before.workflow?.workflow);
}

function writeWorkflow(workflowDir: string, workflow: WorkflowJson | undefined): void {
  if (!workflow) {
    return;
  }
  fs.mkdirSync(workflowDir, { recursive: true });
  writeJson(path.join(workflowDir, 'workflow.json'), workflow);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function resolveScenarioPlaceholders(scenario: ChatScenarioDefinition, workspaceRoot: string): ChatScenarioDefinition {
  const serialized = JSON.stringify(scenario);
  return JSON.parse(serialized.replaceAll(WORKSPACE_ROOT_PLACEHOLDER, normalizeForScenarioPath(workspaceRoot))) as ChatScenarioDefinition;
}

function normalizeForScenarioPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function snapshotWorkspaceFolders(): WorkspaceFolderSnapshot[] {
  return (
    vscode.workspace.workspaceFolders?.map((folder) => ({
      uri: folder.uri,
      name: folder.name,
    })) ?? []
  );
}

async function replaceWorkspaceFolders(folders: readonly WorkspaceFolderSnapshot[]): Promise<void> {
  const existingCount = vscode.workspace.workspaceFolders?.length ?? 0;
  const updated = vscode.workspace.updateWorkspaceFolders(0, existingCount, ...folders);
  assert.ok(updated, 'VS Code should accept the chat scenario workspace folder update.');

  await waitForWorkspaceFolders(folders);
}

async function waitForWorkspaceFolders(expectedFolders: readonly WorkspaceFolderSnapshot[], timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const matches =
      currentFolders.length === expectedFolders.length &&
      currentFolders.every((folder, index) => folder.uri.fsPath === expectedFolders[index].uri.fsPath);
    if (matches) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for workspace folders: ${expectedFolders.map((folder) => folder.uri.fsPath).join(', ')}`);
}
