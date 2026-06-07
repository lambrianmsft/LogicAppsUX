const chatTestDiagnosticsKey = '__LOGICAPPS_CHAT_TEST_DIAGNOSTICS__';

function getDiagnosticsState(): { text: string } {
  const globalState = globalThis as typeof globalThis & {
    [chatTestDiagnosticsKey]?: { text: string };
  };
  globalState[chatTestDiagnosticsKey] ??= { text: '' };
  return globalState[chatTestDiagnosticsKey];
}

export function isChatTestDiagnosticsEnabled(): boolean {
  return process.env.LAUX_CHAT_TESTS === '1';
}

export function appendChatTestDiagnostic(label: string, payload: Record<string, unknown>): void {
  if (!isChatTestDiagnosticsEnabled()) {
    return;
  }

  const line = `[chat-tests][${label}] ${JSON.stringify(payload)}`;
  const state = getDiagnosticsState();
  state.text = state.text ? `${state.text}\n${line}` : line;
  console.log(line);
}

export function clearChatTestDiagnostics(): void {
  getDiagnosticsState().text = '';
}

export function getChatTestDiagnostics(): string {
  return getDiagnosticsState().text;
}
