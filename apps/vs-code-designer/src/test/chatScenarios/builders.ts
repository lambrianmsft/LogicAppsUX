// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
  ChatScenarioBeforeState,
  ChatScenarioDefinition,
  ChatScenarioDiagnostics,
  ChatScenarioExpectedAfterState,
  ChatScenarioMutationPolicy,
  ChatScenarioPromptStep,
  ChatScenarioSemanticResponseExpectation,
  ChatScenarioWorkflowAssertion,
  ChatScenarioWorkflowOperationAssertion,
} from './types';

export function defineChatScenario(scenario: ChatScenarioDefinition): ChatScenarioDefinition {
  return scenario;
}

export function beforeState(before: ChatScenarioBeforeState): ChatScenarioBeforeState {
  return before;
}

export function promptStep(step: Omit<ChatScenarioPromptStep, 'kind'>): ChatScenarioPromptStep {
  return {
    ...step,
    kind: 'prompt',
  };
}

export function semanticResponse(expectation: ChatScenarioSemanticResponseExpectation): ChatScenarioSemanticResponseExpectation {
  return expectation;
}

export function workflowOperationAssertion(assertion: ChatScenarioWorkflowOperationAssertion): ChatScenarioWorkflowOperationAssertion {
  return assertion;
}

export function workflowAssertions(assertion: ChatScenarioWorkflowAssertion): ChatScenarioWorkflowAssertion {
  return assertion;
}

export function expectedAfterState(expected: ChatScenarioExpectedAfterState): ChatScenarioExpectedAfterState {
  return expected;
}

export function mutationPolicy(policy: ChatScenarioMutationPolicy): ChatScenarioMutationPolicy {
  return policy;
}

export function diagnostics(options: ChatScenarioDiagnostics): ChatScenarioDiagnostics {
  return options;
}
