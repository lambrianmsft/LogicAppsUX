// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs';
import {
  assertNoMissingPlaceholders,
  assertWorkflowHasAction,
  assertWorkflowHasTrigger,
  assertWorkflowJsonShape,
  assertWorkspaceTopologyMutation,
  assertWorkspaceTopologySnapshot,
  readWorkflowJson,
  takeWorkspaceTopologySnapshot,
} from '../ui/helpers/workspaceHelper';
import type { WorkflowJson } from '../ui/helpers/workspaceHelper';
import type {
  ChatScenarioDefinition,
  ChatScenarioDiagnosticEvent,
  ChatScenarioRunContext,
  ChatScenarioRunResult,
  ChatScenarioRuntimeAdapter,
  ChatScenarioRuntimeState,
  ChatScenarioSemanticResponseExpectation,
  ChatScenarioStepResult,
  ChatScenarioWorkflowAssertion,
} from './types';
import { assertValidChatScenario } from './validation';

export async function runChatScenario<TAdapterContext = unknown>(
  scenario: ChatScenarioDefinition,
  adapter: ChatScenarioRuntimeAdapter<TAdapterContext>
): Promise<ChatScenarioRunResult> {
  assertValidChatScenario(scenario);

  let adapterContext: TAdapterContext | undefined;
  const diagnostics: ChatScenarioDiagnosticEvent[] = [];
  const stepResults: ChatScenarioStepResult[] = [];
  let beforeState: ChatScenarioRuntimeState | undefined;
  let afterState: ChatScenarioRuntimeState | undefined;

  try {
    adapterContext = await adapter.initialize?.(scenario);
    let context: ChatScenarioRunContext<TAdapterContext> = {
      scenario,
      adapterContext,
      stepResults,
    };
    beforeState = await captureScenarioState('before', scenario, adapter, context);
    assertBeforeState(scenario, beforeState);

    context = {
      ...context,
      beforeState,
    };

    for (const step of scenario.conversation) {
      if (step.kind === 'prompt') {
        const result = await adapter.sendPrompt(step, scenario, context);
        assertPromptResponse(step.id, result.responseText, step.expectedResponse);
        stepResults.push(result);
      } else {
        const result = (await adapter.observe?.(step, scenario, context)) ?? {
          stepId: step.id,
          diagnostics: [`Observation step recorded: ${step.description}`],
        };
        stepResults.push(result);
      }
      context = {
        ...context,
        stepResults,
      };
    }

    afterState = await captureScenarioState('after', scenario, adapter, context);
    const mutationDiff =
      beforeState?.workspaceTopology && afterState?.workspaceTopology
        ? assertWorkspaceTopologyMutation(beforeState.workspaceTopology, afterState.workspaceTopology, scenario.mutationPolicy)
        : undefined;

    assertAfterState(scenario, afterState);

    diagnostics.push(...((await adapter.collectDiagnostics?.(scenario, { ...context, beforeState, stepResults })) ?? []));

    return {
      scenarioId: scenario.id,
      adapterName: adapter.name,
      beforeState,
      afterState,
      stepResults,
      mutationDiff,
      diagnostics,
    };
  } finally {
    await adapter.dispose?.(scenario, {
      scenario,
      adapterContext,
      beforeState,
      stepResults,
    });
  }
}

export function captureFilesystemState(scenario: ChatScenarioDefinition): ChatScenarioRuntimeState {
  const workspace = scenario.before.workspace;
  const workflow = scenario.before.workflow;
  return {
    workspaceTopology: workspace
      ? takeWorkspaceTopologySnapshot(workspace.workspaceRoot, {
          ...workspace.topologyOptions,
          workspaceFilePath: workspace.workspaceFilePath ?? workspace.topologyOptions?.workspaceFilePath,
        })
      : undefined,
    workflow: workflow ? readScenarioWorkflow(workflow.workflowJsonPath, workflow.workflowDir, workflow.workflow) : undefined,
  };
}

export function assertBeforeState(scenario: ChatScenarioDefinition, state: ChatScenarioRuntimeState | undefined): void {
  if (scenario.before.workspace?.topologyAssertions && !state?.workspaceTopology) {
    throw new Error('before.workspace.topologyAssertions requires a captured workspace topology snapshot.');
  }

  const beforeTopology = state?.workspaceTopology;
  if (scenario.before.workspace?.topologyAssertions && beforeTopology) {
    assertWorkspaceTopologySnapshot(beforeTopology, scenario.before.workspace.topologyAssertions);
  }

  if (scenario.before.workflow?.structure) {
    const workflow =
      state?.workflow ??
      readScenarioWorkflow(
        scenario.before.workflow.workflowJsonPath,
        scenario.before.workflow.workflowDir,
        scenario.before.workflow.workflow
      );
    assertWorkflowJsonShape(workflow, 'before.workflow', {
      expectedWorkflowKind: scenario.before.workflow.structure.expectedWorkflowKind,
      requireKind: scenario.before.workflow.structure.requireKind,
      requireTrigger: scenario.before.workflow.structure.requireTrigger,
      requireAction: scenario.before.workflow.structure.requireAction,
    });
  }
}

export function assertAfterState(scenario: ChatScenarioDefinition, state: ChatScenarioRuntimeState | undefined): void {
  if (scenario.expected.workspaceTopology && !state?.workspaceTopology) {
    throw new Error('expected.workspaceTopology requires a captured workspace topology snapshot.');
  }

  const afterTopology = state?.workspaceTopology;
  if (scenario.expected.workspaceTopology && afterTopology) {
    assertWorkspaceTopologySnapshot(afterTopology, scenario.expected.workspaceTopology);
  }

  if (scenario.expected.workflow) {
    assertWorkflowAssertions(scenario.expected.workflow, state?.workflow);
  }
}

async function captureScenarioState<TAdapterContext>(
  phase: 'before' | 'after',
  scenario: ChatScenarioDefinition,
  adapter: ChatScenarioRuntimeAdapter<TAdapterContext>,
  context: ChatScenarioRunContext<TAdapterContext>
): Promise<ChatScenarioRuntimeState> {
  const adapterState = await adapter.captureState?.(phase, scenario, context);
  if (adapterState) {
    return adapterState;
  }
  return captureFilesystemState(scenario);
}

function assertWorkflowAssertions(assertion: ChatScenarioWorkflowAssertion, runtimeWorkflow: ChatScenarioRuntimeState['workflow']): void {
  const workflow = runtimeWorkflow ?? readScenarioWorkflow(assertion.workflowJsonPath, assertion.workflowDir, assertion.workflow, false);
  assertWorkflowJsonShape(workflow, 'expected.workflow', assertion.shape);

  if (assertion.exactWorkflow && assertion.workflow) {
    assertJsonEqual(workflow, assertion.workflow, 'expected.workflow exact workflow');
  }

  for (const trigger of assertion.requiredTriggers ?? []) {
    const actual = assertWorkflowHasTrigger(workflow, trigger.expectation, trigger.expectedType);
    if (trigger.expectedKind && actual.kind !== trigger.expectedKind) {
      throw new Error(`Expected trigger kind ${trigger.expectedKind}, got ${actual.kind}`);
    }
  }

  for (const action of assertion.requiredActions ?? []) {
    const actual = assertWorkflowHasAction(workflow, action.expectation, action.expectedType);
    if (action.expectedKind && actual.kind !== action.expectedKind) {
      throw new Error(`Expected action kind ${action.expectedKind}, got ${actual.kind}`);
    }
  }

  for (const action of assertion.forbiddenActions ?? []) {
    try {
      assertWorkflowHasAction(workflow, action.expectation, action.expectedType);
    } catch {
      continue;
    }
    throw new Error(`Forbidden action was present: ${JSON.stringify(action.expectation)}`);
  }

  if (!assertion.allowUnresolvedPlaceholders) {
    assertNoMissingPlaceholders(workflow, 'expected.workflow');
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(sortJsonValue(actual));
  const expectedJson = JSON.stringify(sortJsonValue(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch.\nExpected: ${JSON.stringify(expected, null, 2)}\nActual: ${JSON.stringify(actual, null, 2)}`);
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortJsonValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

function assertPromptResponse(
  stepId: string,
  responseText: string | null | undefined,
  expectation: ChatScenarioSemanticResponseExpectation | undefined
): void {
  if (!expectation) {
    return;
  }

  const response = responseText ?? '';
  const lowerResponse = response.toLowerCase();

  if (expectation.exactResponseText && response !== expectation.exactResponseText) {
    throw new Error(`Step ${stepId} response did not match exact expected text.`);
  }

  if (expectation.shouldAskClarifyingQuestion && !looksLikeClarifyingQuestion(lowerResponse)) {
    throw new Error(`Step ${stepId} response should ask a clarifying question. Response: ${response}`);
  }

  if (expectation.shouldReportSuccess && !looksLikeSuccess(lowerResponse)) {
    throw new Error(`Step ${stepId} response should report success. Response: ${response}`);
  }

  if (expectation.shouldReportFailure && !looksLikeFailure(lowerResponse)) {
    throw new Error(`Step ${stepId} response should report failure. Response: ${response}`);
  }

  for (const expectedText of expectation.shouldMention ?? []) {
    if (!lowerResponse.includes(expectedText.toLowerCase())) {
      throw new Error(`Step ${stepId} response should mention "${expectedText}". Response: ${response}`);
    }
  }

  for (const deniedText of expectation.shouldNotMention ?? []) {
    if (lowerResponse.includes(deniedText.toLowerCase())) {
      throw new Error(`Step ${stepId} response should not mention "${deniedText}". Response: ${response}`);
    }
  }
}

function looksLikeClarifyingQuestion(response: string): boolean {
  return response.includes('?') || response.includes('clarify') || response.includes('which ') || response.includes('what ');
}

function looksLikeSuccess(response: string): boolean {
  return ['success', 'succeeded', 'complete', 'completed', 'created', 'added', 'updated', 'done'].some((token) => response.includes(token));
}

function looksLikeFailure(response: string): boolean {
  return ['failed', 'failure', 'error', 'unable', 'cannot', "can't", "couldn't"].some((token) => response.includes(token));
}

function readScenarioWorkflow(
  workflowJsonPath: string | undefined,
  workflowDir: string | undefined,
  providedWorkflow: ChatScenarioWorkflowAssertion['workflow'],
  preferProvidedWorkflow = true
): WorkflowJson | null {
  if (providedWorkflow && preferProvidedWorkflow) {
    return providedWorkflow;
  }

  if (workflowJsonPath) {
    return JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
  }

  if (workflowDir) {
    return readWorkflowJson(workflowDir);
  }

  return providedWorkflow ?? null;
}
