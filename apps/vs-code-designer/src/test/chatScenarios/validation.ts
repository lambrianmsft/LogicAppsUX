// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
  ChatScenarioConversationStep,
  ChatScenarioDefinition,
  ChatScenarioSemanticResponseExpectation,
  ChatScenarioSeverity,
  ChatScenarioValidationIssue,
  ChatScenarioValidationResult,
} from './types';

export function validateChatScenario(scenario: ChatScenarioDefinition): ChatScenarioValidationResult {
  const issues: ChatScenarioValidationIssue[] = [];

  requireNonEmptyString(scenario.id, 'id', issues);
  requireNonEmptyString(scenario.title, 'title', issues);

  if (!scenario.before) {
    issues.push(errorIssue('before', 'Scenario must declare an initial state.'));
  }

  if (!scenario.expected) {
    issues.push(errorIssue('expected', 'Scenario must declare expected after-state assertions.'));
  }

  if (!Array.isArray(scenario.conversation) || scenario.conversation.length === 0) {
    issues.push(errorIssue('conversation', 'Scenario must include at least one conversation step.'));
  } else {
    scenario.conversation.forEach((step, index) => validateConversationStep(step, `conversation[${index}]`, issues));
  }

  if (scenario.surfaces && scenario.surfaces.length === 0) {
    issues.push(errorIssue('surfaces', 'Scenario surfaces must be omitted or include at least one runtime surface.'));
  }

  validateResponseExpectation(
    scenario.expected.workflow?.allowUnresolvedPlaceholders,
    'expected.workflow.allowUnresolvedPlaceholders',
    issues
  );

  if (scenario.expected.workflow?.exactWorkflow && !scenario.expected.workflow.workflow) {
    issues.push(errorIssue('expected.workflow.exactWorkflow', 'Exact workflow assertions require expected.workflow.workflow.'));
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}

export function assertValidChatScenario(scenario: ChatScenarioDefinition): void {
  const validation = validateChatScenario(scenario);
  if (!validation.valid) {
    throw new Error(formatValidationIssues(validation.issues));
  }
}

export function formatValidationIssues(issues: readonly ChatScenarioValidationIssue[]): string {
  return issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`).join('\n');
}

function validateConversationStep(step: ChatScenarioConversationStep, path: string, issues: ChatScenarioValidationIssue[]): void {
  requireNonEmptyString(step.id, `${path}.id`, issues);
  requireNonEmptyString(step.kind, `${path}.kind`, issues);

  if (step.kind === 'prompt') {
    requireNonEmptyString(step.prompt, `${path}.prompt`, issues);
    validateSemanticResponseExpectation(step.expectedResponse, `${path}.expectedResponse`, issues);
    return;
  }

  if (step.kind === 'observe') {
    requireNonEmptyString(step.description, `${path}.description`, issues);
    return;
  }

  issues.push(errorIssue(`${path}.kind`, `Unsupported step kind: ${JSON.stringify((step as { kind?: unknown }).kind)}`));
}

function validateSemanticResponseExpectation(
  expectation: ChatScenarioSemanticResponseExpectation | undefined,
  path: string,
  issues: ChatScenarioValidationIssue[]
): void {
  if (!expectation) {
    return;
  }

  if (expectation.exactResponseText && !expectation.allowExactResponseText) {
    issues.push(
      errorIssue(
        `${path}.exactResponseText`,
        'Exact LLM prose assertions are disabled by default. Set allowExactResponseText only for intentional stable text contracts.'
      )
    );
  }

  if (expectation.shouldReportSuccess && expectation.shouldReportFailure) {
    issues.push(errorIssue(path, 'A response expectation cannot require both success and failure reporting.'));
  }
}

function validateResponseExpectation(value: unknown, path: string, issues: ChatScenarioValidationIssue[]): void {
  if (value === true) {
    issues.push(warningIssue(path, 'Allow unresolved placeholders only when the scenario intentionally validates incomplete drafts.'));
  }
}

function requireNonEmptyString(value: unknown, path: string, issues: ChatScenarioValidationIssue[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(errorIssue(path, 'Expected a non-empty string.'));
  }
}

function errorIssue(path: string, message: string): ChatScenarioValidationIssue {
  return issue('error', path, message);
}

function warningIssue(path: string, message: string): ChatScenarioValidationIssue {
  return issue('warning', path, message);
}

function issue(severity: ChatScenarioSeverity, path: string, message: string): ChatScenarioValidationIssue {
  return {
    severity,
    path,
    message,
  };
}
