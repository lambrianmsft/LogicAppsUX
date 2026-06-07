import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

export const TOOL_NAMES = {
  listWorkflows: 'logicapps_listWorkflows',
  getWorkflowDefinition: 'logicapps_getWorkflowDefinition',
  createWorkflow: 'logicapps_createWorkflow',
  createProject: 'logicapps_createProject',
  addAction: 'logicapps_addAction',
  modifyAction: 'logicapps_modifyAction',
};

const EXTENSION_ID = 'ms-azuretools.vscode-azurelogicapps';
const CHAT_MIN_WAIT = 3_000;
const CHAT_TEST_CLEAR_TRANSCRIPT_COMMAND = 'azureLogicAppsStandard.chatTests.clearTranscript';
const CHAT_TEST_GET_TRANSCRIPT_COMMAND = 'azureLogicAppsStandard.chatTests.getTranscript';
const CHAT_TEST_GET_DIAGNOSTICS_COMMAND = 'azureLogicAppsStandard.chatTests.getDiagnostics';

export interface SendChatAndWaitOptions {
  waitForFile?: string;
  waitForActionChange?: { path: string; baseline: string[] };
  minWait?: number;
  timeoutMs?: number;
  responseIncludes?: readonly string[];
}

let chatPromptQueue: Promise<void> = Promise.resolve();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function waitForActionChange(workflowJsonPath: string, baselineActions: string[], timeoutMs = 30_000): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
      const currentActions = Object.keys(content.definition?.actions || {});
      const newActions = currentActions.filter((action) => !baselineActions.includes(action));
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

async function runSerializedChatCommand<T>(query: string, operation: () => Promise<T>): Promise<T> {
  const previousPrompt = chatPromptQueue;
  let releasePrompt: () => void = () => undefined;
  chatPromptQueue = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });

  await previousPrompt;
  console.log(`[chat-tests] Sending serialized chat prompt: ${query.substring(0, 120)}`);

  try {
    return await operation();
  } finally {
    releasePrompt();
  }
}

function commandResultToResponseText(result: unknown): string | null {
  if (typeof result === 'string') {
    return result;
  }
  if (result && typeof result === 'object') {
    const candidate = result as { response?: unknown; text?: unknown; value?: unknown };
    if (typeof candidate.response === 'string') {
      return candidate.response;
    }
    if (typeof candidate.text === 'string') {
      return candidate.text;
    }
    if (typeof candidate.value === 'string') {
      return candidate.value;
    }
  }
  return null;
}

function buildChatTimeoutDiagnostics(
  query: string,
  responseText: string | null,
  options: SendChatAndWaitOptions | undefined,
  diagnostics: string | null
): string {
  const sideEffect =
    options?.waitForFile ??
    (options?.waitForActionChange
      ? `${options.waitForActionChange.path}; baseline actions: ${options.waitForActionChange.baseline.join(', ') || '(none)'}`
      : 'none');
  return [
    `Chat prompt did not complete before timeout: ${query}`,
    `Expected side effect: ${sideEffect}`,
    `Last command response text: ${responseText || '(not available from workbench.action.chat.open)'}`,
    `Chat diagnostics: ${diagnostics || '(no chat diagnostics captured)'}`,
  ].join('\n');
}

async function clearChatParticipantTranscript(): Promise<void> {
  try {
    await vscode.commands.executeCommand(CHAT_TEST_CLEAR_TRANSCRIPT_COMMAND);
  } catch {
    /* Transcript capture is only available in LAUX_CHAT_TESTS extension hosts. */
  }
}

async function getChatParticipantTranscript(): Promise<string | null> {
  try {
    const transcript = await vscode.commands.executeCommand<unknown>(CHAT_TEST_GET_TRANSCRIPT_COMMAND);
    return typeof transcript === 'string' && transcript.length > 0 ? transcript : null;
  } catch {
    return null;
  }
}

async function getChatParticipantDiagnostics(): Promise<string | null> {
  try {
    const diagnostics = await vscode.commands.executeCommand<unknown>(CHAT_TEST_GET_DIAGNOSTICS_COMMAND);
    return typeof diagnostics === 'string' && diagnostics.length > 0 ? diagnostics : null;
  } catch {
    return null;
  }
}

async function waitForStableChatParticipantTranscript(timeoutMs = 15_000, stableMs = 1_500): Promise<string | null> {
  const start = Date.now();
  let lastTranscript = await getChatParticipantTranscript();
  let stableSince = Date.now();

  while (Date.now() - start < timeoutMs) {
    await sleep(250);
    const currentTranscript = await getChatParticipantTranscript();
    if (currentTranscript !== lastTranscript) {
      lastTranscript = currentTranscript;
      stableSince = Date.now();
      continue;
    }

    if (Date.now() - stableSince >= stableMs) {
      return currentTranscript;
    }
  }

  return lastTranscript;
}

export async function sendChatAndWait(query: string, options?: SendChatAndWaitOptions): Promise<string | null> {
  return runSerializedChatCommand(query, async () => {
    await clearChatParticipantTranscript();
    const commandResult = await vscode.commands.executeCommand<unknown>('workbench.action.chat.open', {
      query,
      isPartialQuery: false,
    });
    let responseText = commandResultToResponseText(commandResult);

    try {
      await sleep(CHAT_MIN_WAIT);

      if (options?.waitForFile) {
        const found = await waitForFile(options.waitForFile, options.timeoutMs ?? 60_000);
        assert.ok(found, buildChatTimeoutDiagnostics(query, responseText, options, await getChatParticipantDiagnostics()));
      } else if (options?.waitForActionChange) {
        const newActions = await waitForActionChange(
          options.waitForActionChange.path,
          options.waitForActionChange.baseline,
          options.timeoutMs ?? 60_000
        );
        assert.ok(newActions.length > 0, buildChatTimeoutDiagnostics(query, responseText, options, await getChatParticipantDiagnostics()));
      } else {
        await sleep(options?.minWait ?? 10_000);
      }

      responseText = (await waitForStableChatParticipantTranscript()) ?? responseText;

      if (options?.responseIncludes) {
        assert.ok(
          responseText,
          `Expected chat response text for semantic assertions, but the chat participant transcript hook did not capture any text. Query: ${query}`
        );
        const lowerResponse = responseText.toLowerCase();
        for (const expectedText of options.responseIncludes) {
          assert.ok(
            lowerResponse.includes(expectedText.toLowerCase()),
            `Expected chat response to include "${expectedText}". Response: ${responseText}`
          );
        }
      }

      return responseText;
    } finally {
      await vscode.commands.executeCommand('workbench.action.closePanel');
    }
  });
}

export async function waitForExtensionActivation(timeoutMs = 60_000): Promise<boolean> {
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

export async function waitForToolImplementation(toolName: string, timeoutMs: number): Promise<boolean> {
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
