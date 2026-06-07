// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  beforeState,
  defineChatScenario,
  diagnostics,
  expectedAfterState,
  mutationPolicy,
  promptStep,
  semanticResponse,
  workflowAssertions,
  workflowOperationAssertion,
} from './builders';
import type { ChatScenarioDefinition } from './types';

const workspaceRoot = '__CHAT_SCENARIO_WORKSPACE_ROOT__';
const workspaceFilePath = `${workspaceRoot}/chat-scenarios.code-workspace`;

const workflowSchema = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';

const blankStatefulWorkflow = {
  kind: 'Stateful',
  definition: {
    $schema: workflowSchema,
    contentVersion: '1.0.0.0',
    triggers: {},
    actions: {},
  },
};

const httpRequestWorkflow = {
  kind: 'Stateful',
  definition: {
    $schema: workflowSchema,
    contentVersion: '1.0.0.0',
    triggers: {
      manual: {
        type: 'Request',
        kind: 'Http',
        inputs: {
          schema: {},
        },
      },
    },
    actions: {},
  },
};

const httpRequestWithResponseWorkflow = {
  kind: 'Stateful',
  definition: {
    $schema: workflowSchema,
    contentVersion: '1.0.0.0',
    triggers: {
      manual: {
        type: 'Request',
        kind: 'Http',
        inputs: {
          schema: {},
        },
      },
    },
    actions: {
      Send_Ok: {
        type: 'Response',
        runAfter: {},
        inputs: {
          statusCode: 200,
          body: 'Order accepted',
        },
      },
    },
  },
};

export const helpResponseScenario = defineChatScenario({
  id: 'chat.help.connector.response-only',
  title: '@logicapps answers a connector help prompt without mutating the workspace',
  description: 'Covers response-only help and conceptual questions where the assistant should explain, not write files.',
  surfaces: ['extensionHost', 'exTester'],
  before: beforeState({
    summary: 'Workspace contains one healthy Logic App project and one stateful workflow.',
    workspace: {
      workspaceRoot,
      workspaceFilePath,
      topologyAssertions: {
        expectedProjectCount: 1,
        denyNestedProjects: true,
      },
    },
    workflow: {
      workflowJsonPath: `${workspaceRoot}/OrderProject/Stateful1/workflow.json`,
      workflow: httpRequestWorkflow,
      structure: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
        requireTrigger: true,
      },
    },
  }),
  conversation: [
    promptStep({
      id: 'ask-connector-help',
      participant: '@logicapps',
      prompt: '@logicapps what is a connector in Azure Logic Apps, and when should I add an action?',
      expectedResponse: semanticResponse({
        intent: 'Explain Logic Apps connector concepts without changing files.',
        shouldMention: ['connector', 'workflow', 'action'],
        shouldNotMention: ['created', 'updated', 'saved'],
      }),
    }),
  ],
  expected: expectedAfterState({
    summary: 'Workspace and workflow are unchanged after the informational response.',
    workspaceTopology: {
      expectedProjectCount: 1,
      denyNestedProjects: true,
    },
    workflow: workflowAssertions({
      workflow: httpRequestWorkflow,
      exactWorkflow: true,
      shape: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
        requireTrigger: true,
      },
      requiredTriggers: [
        workflowOperationAssertion({
          expectation: { name: 'manual', type: 'Request', kind: 'Http', inputs: { schema: {} } },
          description: 'The existing HTTP Request trigger should remain the only trigger for help-only prompts.',
        }),
      ],
      forbiddenActions: [
        workflowOperationAssertion({
          expectation: { type: 'Response' },
          description: 'Help-only prompts must not add a Response action or any other workflow action.',
        }),
      ],
    }),
  }),
  mutationPolicy: mutationPolicy({
    description: 'Read-only help response: no workspace, project, workflow, connection, or settings mutations are allowed.',
    scopes: [],
  }),
  diagnostics: diagnostics({
    collectWorkspaceTopology: true,
    collectProtectedFileSnapshots: true,
    includeResponseTranscript: true,
    labels: ['response-only', 'help', 'no-mutation'],
  }),
  metadata: {
    owner: 'test',
    tags: ['@logicapps', 'chat-scenario', 'response-only', 'help'],
  },
});

export const createProjectAtWorkspaceRootScenario = defineChatScenario({
  id: 'chat.create-project.workspace-root',
  title: '@logicapps creates one project at the workspace root without nesting it',
  description: 'Covers project creation where the expected project folder is directly under the workspace root.',
  surfaces: ['exTester'],
  before: beforeState({
    summary: 'Empty scenario workspace with no Logic App projects yet.',
    workspace: {
      workspaceRoot,
      workspaceFilePath,
      topologyAssertions: {
        expectedProjectCount: 0,
        expectedWorkspaceFileRelativePath: 'chat-scenarios.code-workspace',
        expectedProjectRelativePaths: [],
        denyNestedProjects: true,
      },
    },
  }),
  conversation: [
    promptStep({
      id: 'create-root-project',
      participant: '@logicapps',
      prompt: '@logicapps /createProject a Logic App project called OrderProject with a stateful workflow called ProcessOrder',
      expectedResponse: semanticResponse({
        intent: 'Create a new Logic App project directly under the workspace root.',
        shouldMention: ['OrderProject', 'ProcessOrder'],
        shouldReportSuccess: true,
      }),
      timeoutMs: 120_000,
    }),
  ],
  expected: expectedAfterState({
    summary: 'One non-nested project exists at the workspace root with the requested initial workflow.',
    workspaceTopology: {
      expectedProjectCount: 1,
      expectedWorkspaceFileRelativePath: 'chat-scenarios.code-workspace',
      expectedProjectRelativePaths: ['OrderProject'],
      forbiddenProjectRelativePaths: ['OrderProject/OrderProject'],
      expectedWorkflowRelativePaths: ['OrderProject/ProcessOrder'],
      forbiddenWorkflowRelativePaths: ['OrderProject/OrderProject/ProcessOrder'],
      expectedWorkflowKind: 'Stateful',
      requireWorkflowKind: true,
      requireConnectionsJson: true,
      denyNestedProjects: true,
    },
    workflow: workflowAssertions({
      workflowJsonPath: `${workspaceRoot}/OrderProject/ProcessOrder/workflow.json`,
      workflow: blankStatefulWorkflow,
      exactWorkflow: true,
      shape: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
      },
    }),
  }),
  mutationPolicy: mutationPolicy({
    description: 'Only the requested root-level project, its initial workflow, and the workspace file may be added or changed.',
    scopes: ['workspace', 'project', 'workflow', 'settings'],
    allowProjectCreation: true,
    allowWorkflowCreation: true,
    allowedAddedPaths: [
      'OrderProject',
      'OrderProject/host.json',
      'OrderProject/local.settings.json',
      'OrderProject/connections.json',
      'OrderProject/ProcessOrder',
      'OrderProject/ProcessOrder/workflow.json',
    ],
    allowedChangedFilePaths: ['chat-scenarios.code-workspace'],
    deniedAddedPaths: ['OrderProject/OrderProject', 'OrderProject/OrderProject/host.json'],
  }),
  diagnostics: diagnostics({
    collectWorkspaceTopology: true,
    collectProtectedFileSnapshots: true,
    includeResponseTranscript: true,
    labels: ['create-project', 'workspace-root', 'no-nested-project'],
  }),
  metadata: {
    owner: 'test',
    tags: ['@logicapps', 'chat-scenario', 'create-project', 'workspace-root'],
  },
});

export const createSiblingProjectFromExistingProjectScenario = defineChatScenario({
  id: 'chat.create-project.sibling-from-existing-project',
  title: '@logicapps creates a sibling project when the workspace file is inside an existing project',
  description: 'Covers the common VS Code workspace shape where the opened .code-workspace lives in an existing Logic App project folder.',
  surfaces: ['exTester'],
  before: beforeState({
    summary: 'Workspace parent contains ExistingProject, and the opened workspace file is inside ExistingProject.',
    workspace: {
      workspaceRoot,
      workspaceFilePath: `${workspaceRoot}/ExistingProject/ExistingProject.code-workspace`,
      topologyAssertions: {
        expectedProjectCount: 1,
        expectedWorkspaceFileRelativePath: 'ExistingProject/ExistingProject.code-workspace',
        expectedProjectRelativePaths: ['ExistingProject'],
        expectedWorkflowRelativePaths: ['ExistingProject/Stateful1'],
        requireConnectionsJson: true,
        denyNestedProjects: true,
      },
    },
    workflow: {
      workflowJsonPath: `${workspaceRoot}/ExistingProject/Stateful1/workflow.json`,
      workflow: blankStatefulWorkflow,
      structure: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
      },
    },
  }),
  conversation: [
    promptStep({
      id: 'create-sibling-project',
      participant: '@logicapps',
      prompt: '@logicapps /createProject a Logic App project called NewProject with a stateful workflow called InitialWorkflow',
      expectedResponse: semanticResponse({
        intent: 'Create a new Logic App project as a sibling of ExistingProject.',
        shouldMention: ['NewProject', 'InitialWorkflow'],
        shouldReportSuccess: true,
      }),
      timeoutMs: 120_000,
    }),
  ],
  expected: expectedAfterState({
    summary: 'ExistingProject remains unchanged and NewProject is a sibling, not nested under ExistingProject.',
    workspaceTopology: {
      expectedProjectCount: 2,
      expectedWorkspaceFileRelativePath: 'ExistingProject/ExistingProject.code-workspace',
      expectedProjectRelativePaths: ['ExistingProject', 'NewProject'],
      forbiddenProjectRelativePaths: ['ExistingProject/NewProject'],
      expectedWorkflowRelativePaths: ['ExistingProject/Stateful1', 'NewProject/InitialWorkflow'],
      forbiddenWorkflowRelativePaths: ['ExistingProject/NewProject/InitialWorkflow'],
      expectedWorkflowKind: 'Stateful',
      requireWorkflowKind: true,
      requireConnectionsJson: true,
      denyNestedProjects: true,
    },
    workflow: workflowAssertions({
      workflowJsonPath: `${workspaceRoot}/NewProject/InitialWorkflow/workflow.json`,
      workflow: blankStatefulWorkflow,
      exactWorkflow: true,
      shape: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
      },
    }),
  }),
  mutationPolicy: mutationPolicy({
    description: 'Only the sibling NewProject and the ExistingProject workspace file may change.',
    scopes: ['workspace', 'project', 'workflow', 'settings'],
    allowProjectCreation: true,
    allowWorkflowCreation: true,
    allowedAddedPaths: [
      'NewProject',
      'NewProject/host.json',
      'NewProject/local.settings.json',
      'NewProject/connections.json',
      'NewProject/InitialWorkflow',
      'NewProject/InitialWorkflow/workflow.json',
    ],
    allowedChangedFilePaths: ['ExistingProject/ExistingProject.code-workspace'],
    deniedAddedPaths: [
      'ExistingProject/NewProject',
      'ExistingProject/NewProject/host.json',
      'ExistingProject/NewProject/InitialWorkflow',
      'ExistingProject/NewProject/InitialWorkflow/workflow.json',
    ],
  }),
  diagnostics: diagnostics({
    collectWorkspaceTopology: true,
    collectProtectedFileSnapshots: true,
    includeResponseTranscript: true,
    labels: ['create-project', 'sibling-project', 'no-nested-project'],
  }),
  metadata: {
    owner: 'test',
    tags: ['@logicapps', 'chat-scenario', 'create-project', 'sibling-project'],
  },
});

export const addWorkflowToIntendedProjectScenario = defineChatScenario({
  id: 'chat.add-workflow.intended-project',
  title: '@logicapps adds a workflow only to the named project',
  description: 'Covers workflow creation in a workspace with multiple projects where project targeting matters.',
  surfaces: ['extensionHost', 'exTester'],
  before: beforeState({
    summary: 'Workspace contains two projects; only OrderProject should receive the new workflow.',
    workspace: {
      workspaceRoot,
      workspaceFilePath,
      topologyAssertions: {
        expectedProjectCount: 2,
        expectedWorkspaceFileRelativePath: 'chat-scenarios.code-workspace',
        expectedProjectRelativePaths: ['OrderProject', 'InventoryProject'],
        expectedWorkflowRelativePaths: ['OrderProject/Stateful1', 'InventoryProject/Stateful1'],
        requireConnectionsJson: true,
        denyNestedProjects: true,
      },
    },
    knownConstraints: ['InventoryProject must not receive a ProcessReturn workflow for this prompt.'],
  }),
  conversation: [
    promptStep({
      id: 'create-workflow-in-order-project',
      participant: '@logicapps',
      prompt: '@logicapps create a stateful workflow called ProcessReturn in the OrderProject project',
      expectedResponse: semanticResponse({
        intent: 'Create the workflow in the explicitly named project.',
        shouldMention: ['OrderProject', 'ProcessReturn'],
        shouldReportSuccess: true,
      }),
      timeoutMs: 120_000,
    }),
  ],
  expected: expectedAfterState({
    summary: 'The new ProcessReturn workflow exists under OrderProject and not under InventoryProject.',
    workspaceTopology: {
      expectedProjectCount: 2,
      expectedWorkspaceFileRelativePath: 'chat-scenarios.code-workspace',
      expectedProjectRelativePaths: ['OrderProject', 'InventoryProject'],
      expectedWorkflowRelativePaths: ['OrderProject/Stateful1', 'OrderProject/ProcessReturn', 'InventoryProject/Stateful1'],
      forbiddenWorkflowRelativePaths: ['InventoryProject/ProcessReturn'],
      expectedWorkflowKind: 'Stateful',
      requireWorkflowKind: true,
      requireConnectionsJson: true,
      denyNestedProjects: true,
    },
    workflow: workflowAssertions({
      workflowJsonPath: `${workspaceRoot}/OrderProject/ProcessReturn/workflow.json`,
      workflow: blankStatefulWorkflow,
      exactWorkflow: true,
      shape: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
      },
    }),
  }),
  mutationPolicy: mutationPolicy({
    description: 'Only the requested workflow folder may be added, and it must be inside OrderProject.',
    scopes: ['workflow'],
    allowWorkflowCreation: true,
    allowedAddedPaths: ['OrderProject/ProcessReturn', 'OrderProject/ProcessReturn/workflow.json'],
    deniedAddedPaths: ['InventoryProject/ProcessReturn', 'InventoryProject/ProcessReturn/workflow.json'],
  }),
  diagnostics: diagnostics({
    collectWorkspaceTopology: true,
    collectProtectedFileSnapshots: true,
    includeResponseTranscript: true,
    labels: ['create-workflow', 'project-targeting'],
  }),
  metadata: {
    owner: 'test',
    tags: ['@logicapps', 'chat-scenario', 'create-workflow', 'project-targeting'],
  },
});

export const addActionToIntendedWorkflowScenario = defineChatScenario({
  id: 'chat.add-action.intended-workflow',
  title: '@logicapps adds a Response action only to the named workflow',
  description: 'Covers workflow targeting when adding an action to an existing workflow.',
  surfaces: ['extensionHost', 'exTester'],
  before: beforeState({
    summary: 'Workspace contains OrderProject/ProcessOrder and InventoryProject/ProcessOrder with matching workflow names.',
    workspace: {
      workspaceRoot,
      workspaceFilePath,
      topologyAssertions: {
        expectedProjectCount: 2,
        denyNestedProjects: true,
      },
    },
    workflow: {
      workflowJsonPath: `${workspaceRoot}/OrderProject/ProcessOrder/workflow.json`,
      workflow: httpRequestWorkflow,
      structure: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
        requireTrigger: true,
      },
    },
    knownConstraints: ['InventoryProject/ProcessOrder must remain unchanged.'],
  }),
  conversation: [
    promptStep({
      id: 'add-response-to-order-process',
      participant: '@logicapps',
      prompt:
        '@logicapps add a built-in Response action called Send_Ok to the ProcessOrder workflow in OrderProject. Set status code 200 and body "Order accepted".',
      expectedResponse: semanticResponse({
        intent: 'Add a Response action to the explicitly targeted workflow.',
        shouldMention: ['Send_Ok', 'ProcessOrder', 'OrderProject'],
        shouldReportSuccess: true,
      }),
      timeoutMs: 120_000,
    }),
  ],
  expected: expectedAfterState({
    summary: 'Only OrderProject/ProcessOrder has the new Send_Ok Response action.',
    workspaceTopology: {
      expectedProjectCount: 2,
      expectedWorkflowKind: 'Stateful',
      requireWorkflowKind: true,
      requireTrigger: true,
      denyNestedProjects: true,
    },
    workflow: workflowAssertions({
      workflowJsonPath: `${workspaceRoot}/OrderProject/ProcessOrder/workflow.json`,
      workflow: httpRequestWithResponseWorkflow,
      exactWorkflow: true,
      shape: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
        requireTrigger: true,
        requireAction: true,
      },
      requiredTriggers: [
        workflowOperationAssertion({
          expectation: { name: 'manual', type: 'Request', kind: 'Http', inputs: { schema: {} } },
          description: 'The original HTTP Request trigger should remain intact.',
        }),
      ],
      requiredActions: [
        workflowOperationAssertion({
          expectation: { name: 'Send_Ok', type: 'Response', inputs: { statusCode: 200, body: 'Order accepted' }, runAfter: {} },
          description: 'The chat request should add the requested Response action to the intended workflow.',
        }),
      ],
    }),
  }),
  mutationPolicy: mutationPolicy({
    description: 'Only the targeted workflow.json may change; no new projects, workflows, connections, or settings are expected.',
    scopes: ['workflow'],
    allowedChangedFilePaths: ['OrderProject/ProcessOrder/workflow.json'],
    deniedChangedFilePaths: [
      'InventoryProject/ProcessOrder/workflow.json',
      'OrderProject/connections.json',
      'OrderProject/local.settings.json',
    ],
  }),
  diagnostics: diagnostics({
    collectWorkspaceTopology: true,
    collectProtectedFileSnapshots: true,
    includeResponseTranscript: true,
    labels: ['add-action', 'workflow-targeting', 'built-in-response'],
  }),
  metadata: {
    owner: 'test',
    tags: ['@logicapps', 'chat-scenario', 'add-action', 'workflow-targeting'],
  },
});

export const ambiguousNoMutationClarificationScenario = defineChatScenario({
  id: 'chat.ambiguous-workflow.no-mutation',
  title: '@logicapps asks clarifying questions for an underspecified workflow request',
  description: 'Covers ambiguous workflow-generation prompts that must not create partial files before required details are known.',
  surfaces: ['extensionHost', 'exTester'],
  before: beforeState({
    summary: 'Workspace contains an existing project and workflow; the user asks for an underspecified queue-to-data-store workflow.',
    workspace: {
      workspaceRoot,
      workspaceFilePath,
      topologyAssertions: {
        minProjectCount: 1,
        denyNestedProjects: true,
      },
    },
    workflow: {
      workflowJsonPath: `${workspaceRoot}/OrderProject/Stateful1/workflow.json`,
      workflow: httpRequestWorkflow,
      structure: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
        requireTrigger: true,
      },
    },
    knownConstraints: [
      'Queue provider, queue name, authentication, SQL target, Cosmos target, branch condition, and payload mapping details are missing.',
    ],
  }),
  conversation: [
    promptStep({
      id: 'ask-ambiguous-queue-sql-cosmos-workflow',
      participant: '@logicapps',
      prompt:
        '@logicapps Create a workflow that listens to the queue and adds the message to either sql db or cosmos db based on the message type as SQL or Cosmos',
      expectedResponse: semanticResponse({
        intent: 'Ask for missing details instead of creating an incomplete workflow.',
        shouldMention: ['queue', 'sql', 'cosmos'],
        shouldAskClarifyingQuestion: true,
        shouldNotMention: ['created workflow', 'added action', 'saved workflow'],
      }),
      timeoutMs: 120_000,
    }),
  ],
  expected: expectedAfterState({
    summary: 'No workflow, connection, settings, or project files are created or changed until the user clarifies required details.',
    workspaceTopology: {
      minProjectCount: 1,
      denyNestedProjects: true,
    },
    workflow: workflowAssertions({
      workflow: httpRequestWorkflow,
      exactWorkflow: true,
      shape: {
        expectedWorkflowKind: 'Stateful',
        requireKind: true,
        requireTrigger: true,
      },
      requiredTriggers: [
        workflowOperationAssertion({
          expectation: { name: 'manual', type: 'Request', kind: 'Http', inputs: { schema: {} } },
          description: 'The original HTTP Request trigger should remain intact while the assistant asks follow-up questions.',
        }),
      ],
      forbiddenActions: [
        workflowOperationAssertion({
          expectation: { type: 'ServiceProvider' },
          description: 'An underspecified connector workflow must not add Service Provider actions before details are supplied.',
        }),
        workflowOperationAssertion({
          expectation: { type: 'ApiConnection' },
          description: 'An underspecified connector workflow must not add managed connector actions before details are supplied.',
        }),
      ],
    }),
  }),
  mutationPolicy: mutationPolicy({
    description: 'No mutation is allowed for ambiguous prompts; the assistant should ask follow-up questions first.',
    scopes: [],
    deniedChangedFilePaths: [
      'OrderProject/Stateful1/workflow.json',
      'OrderProject/connections.json',
      'OrderProject/local.settings.json',
      'chat-scenarios.code-workspace',
    ],
  }),
  diagnostics: diagnostics({
    collectWorkspaceTopology: true,
    collectProtectedFileSnapshots: true,
    includeResponseTranscript: true,
    labels: ['ambiguous', 'clarification', 'no-mutation'],
  }),
  metadata: {
    owner: 'test',
    tags: ['@logicapps', 'chat-scenario', 'ambiguous', 'clarification', 'no-mutation'],
    notes: [
      'This fixture intentionally validates response semantics and absence of side effects rather than connector-specific generation.',
    ],
  },
});

export const chatScenarioFixtures: readonly ChatScenarioDefinition[] = [
  helpResponseScenario,
  createProjectAtWorkspaceRootScenario,
  createSiblingProjectFromExistingProjectScenario,
  addWorkflowToIntendedProjectScenario,
  addActionToIntendedWorkflowScenario,
  ambiguousNoMutationClarificationScenario,
];
