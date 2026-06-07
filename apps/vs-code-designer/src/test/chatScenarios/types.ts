// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
  LogicAppProjectStructureOptions,
  WorkflowJson,
  WorkflowOperationExpectation,
  WorkspaceTopologyAssertionOptions,
  WorkspaceTopologyMutationDiff,
  WorkspaceTopologyMutationPolicy,
  WorkspaceTopologySnapshot,
  WorkspaceTopologySnapshotOptions,
} from '../ui/helpers/workspaceHelper';

export type ChatScenarioId = string;

export type ChatScenarioStepId = string;

export type ChatScenarioSeverity = 'info' | 'warning' | 'error';

export type ChatScenarioMutationScope = 'workspace' | 'project' | 'workflow' | 'connection' | 'settings' | 'unknown';

export type ChatScenarioSurface = 'extensionHost' | 'exTester';

export interface ChatScenarioMetadata {
  readonly owner?: string;
  readonly source?: string;
  readonly tags?: readonly string[];
  readonly links?: readonly string[];
  readonly notes?: readonly string[];
}

export interface ChatScenarioWorkspaceState {
  readonly workspaceRoot: string;
  readonly workspaceFilePath?: string;
  readonly topologyOptions?: WorkspaceTopologySnapshotOptions;
  readonly topologyAssertions?: WorkspaceTopologyAssertionOptions;
}

export interface ChatScenarioWorkflowState {
  readonly workflowDir?: string;
  readonly workflowJsonPath?: string;
  readonly workflow?: WorkflowJson;
  readonly structure?: LogicAppProjectStructureOptions;
}

export interface ChatScenarioBeforeState {
  readonly summary?: string;
  readonly workspace?: ChatScenarioWorkspaceState;
  readonly workflow?: ChatScenarioWorkflowState;
  readonly knownConstraints?: readonly string[];
}

export interface ChatScenarioPromptStep {
  readonly id: ChatScenarioStepId;
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly participant?: '@logicapps' | string;
  readonly description?: string;
  readonly expectedResponse?: ChatScenarioSemanticResponseExpectation;
  readonly diagnosticsLabel?: string;
  readonly timeoutMs?: number;
}

export interface ChatScenarioObservationStep {
  readonly id: ChatScenarioStepId;
  readonly kind: 'observe';
  readonly description: string;
  readonly diagnosticsLabel?: string;
}

export type ChatScenarioConversationStep = ChatScenarioPromptStep | ChatScenarioObservationStep;

export interface ChatScenarioSemanticResponseExpectation {
  readonly intent?: string;
  readonly shouldMention?: readonly string[];
  readonly shouldNotMention?: readonly string[];
  readonly shouldAskClarifyingQuestion?: boolean;
  readonly shouldReportSuccess?: boolean;
  readonly shouldReportFailure?: boolean;
  readonly exactResponseText?: string;
  readonly allowExactResponseText?: boolean;
}

export interface ChatScenarioWorkflowOperationAssertion {
  readonly expectation: string | WorkflowOperationExpectation;
  readonly expectedType?: string;
  readonly expectedKind?: string;
  readonly description?: string;
}

export interface ChatScenarioWorkflowAssertion {
  readonly workflowDir?: string;
  readonly workflowJsonPath?: string;
  readonly workflow?: WorkflowJson;
  readonly exactWorkflow?: boolean;
  readonly shape?: Pick<LogicAppProjectStructureOptions, 'expectedWorkflowKind' | 'requireKind' | 'requireTrigger' | 'requireAction'>;
  readonly requiredTriggers?: readonly ChatScenarioWorkflowOperationAssertion[];
  readonly requiredActions?: readonly ChatScenarioWorkflowOperationAssertion[];
  readonly forbiddenActions?: readonly ChatScenarioWorkflowOperationAssertion[];
  readonly allowUnresolvedPlaceholders?: boolean;
}

export interface ChatScenarioExpectedAfterState {
  readonly summary?: string;
  readonly workspaceTopology?: WorkspaceTopologyAssertionOptions;
  readonly workflow?: ChatScenarioWorkflowAssertion;
}

export interface ChatScenarioMutationPolicy extends WorkspaceTopologyMutationPolicy {
  readonly description?: string;
  readonly scopes?: readonly ChatScenarioMutationScope[];
}

export interface ChatScenarioDiagnostics {
  readonly collectWorkspaceTopology?: boolean;
  readonly collectProtectedFileSnapshots?: boolean;
  readonly includeResponseTranscript?: boolean;
  readonly labels?: readonly string[];
}

export interface ChatScenarioDefinition {
  readonly id: ChatScenarioId;
  readonly title: string;
  readonly description?: string;
  readonly surfaces?: readonly ChatScenarioSurface[];
  readonly before: ChatScenarioBeforeState;
  readonly conversation: readonly ChatScenarioConversationStep[];
  readonly expected: ChatScenarioExpectedAfterState;
  readonly mutationPolicy?: ChatScenarioMutationPolicy;
  readonly diagnostics?: ChatScenarioDiagnostics;
  readonly metadata?: ChatScenarioMetadata;
}

export interface ChatScenarioRuntimeState {
  readonly workspaceTopology?: WorkspaceTopologySnapshot;
  readonly workflow?: WorkflowJson | null;
  readonly data?: unknown;
}

export interface ChatScenarioStepResult {
  readonly stepId: ChatScenarioStepId;
  readonly responseText?: string | null;
  readonly data?: unknown;
  readonly diagnostics?: readonly string[];
}

export interface ChatScenarioDiagnosticEvent {
  readonly severity: ChatScenarioSeverity;
  readonly message: string;
  readonly stepId?: ChatScenarioStepId;
  readonly data?: unknown;
}

export interface ChatScenarioRunResult {
  readonly scenarioId: ChatScenarioId;
  readonly adapterName: string;
  readonly beforeState?: ChatScenarioRuntimeState;
  readonly afterState?: ChatScenarioRuntimeState;
  readonly stepResults: readonly ChatScenarioStepResult[];
  readonly mutationDiff?: WorkspaceTopologyMutationDiff;
  readonly diagnostics: readonly ChatScenarioDiagnosticEvent[];
}

export interface ChatScenarioRunContext<TAdapterContext = unknown> {
  readonly scenario: ChatScenarioDefinition;
  readonly adapterContext?: TAdapterContext;
  readonly beforeState?: ChatScenarioRuntimeState;
  readonly stepResults: readonly ChatScenarioStepResult[];
}

export interface ChatScenarioRuntimeAdapter<TAdapterContext = unknown> {
  readonly name: string;
  initialize?(scenario: ChatScenarioDefinition): Promise<TAdapterContext> | TAdapterContext;
  captureState?(
    phase: 'before' | 'after',
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<TAdapterContext>
  ): Promise<ChatScenarioRuntimeState> | ChatScenarioRuntimeState;
  sendPrompt(
    step: ChatScenarioPromptStep,
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<TAdapterContext>
  ): Promise<ChatScenarioStepResult> | ChatScenarioStepResult;
  observe?(
    step: ChatScenarioObservationStep,
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<TAdapterContext>
  ): Promise<ChatScenarioStepResult> | ChatScenarioStepResult;
  collectDiagnostics?(
    scenario: ChatScenarioDefinition,
    context: ChatScenarioRunContext<TAdapterContext>
  ): Promise<readonly ChatScenarioDiagnosticEvent[]> | readonly ChatScenarioDiagnosticEvent[];
  dispose?(scenario: ChatScenarioDefinition, context: ChatScenarioRunContext<TAdapterContext>): Promise<void> | void;
}

export interface ChatScenarioValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: ChatScenarioSeverity;
}

export interface ChatScenarioValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ChatScenarioValidationIssue[];
}
