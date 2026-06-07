/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fse from 'fs-extra';
import { AsyncLocalStorage } from 'async_hooks';
import { CHAT_PARTICIPANT_ID, ChatCommand, ToolName, WorkflowTypeOption, ProjectTypeOption, TargetFrameworkOption } from './chatConstants';
import { registerWorkflowTools, registerProjectTools } from './tools';
import { createProjectFromToolInput } from './tools/projectTools';
import { createWorkflowInProject, type AddActionParams } from './tools/workflowTools';
import { localize } from '../../localize';
import { ext } from '../../extensionVariables';
import { extensionCommand, workflowFileName } from '../../constants';
import { ProjectType } from '@microsoft/vscode-extension-logic-apps';
import { isLogicAppProject } from '../utils/verifyIsProject';
import { appendChatTestDiagnostic, clearChatTestDiagnostics, getChatTestDiagnostics } from './chatTestDiagnostics';

/**
 * Chat result metadata for tracking follow-ups
 */
interface LogicAppsChatResult extends vscode.ChatResult {
  metadata: {
    command?: string;
    workflowName?: string;
    projectName?: string;
    needsParameter?: string;
    workflows?: WorkflowSpec[];
    targetProject?: string;
    pendingWorkflows?: WorkflowSpec[];
    includeCustomCode?: boolean;
    projectType?: ProjectTypeOption;
    targetFramework?: TargetFrameworkOption;
    functionName?: string;
    functionNamespace?: string;
    pendingModificationPrompt?: string;
    pendingProjectNames?: string[];
    pendingDuplicateAddAction?: AddActionParams;
  };
}

const chatParticipantTestCommands = {
  clearTranscript: 'azureLogicAppsStandard.chatTests.clearTranscript',
  getTranscript: 'azureLogicAppsStandard.chatTests.getTranscript',
  getDiagnostics: 'azureLogicAppsStandard.chatTests.getDiagnostics',
};

let chatParticipantTestTranscript = '';
let chatParticipantTestTranscriptGeneration = 0;
const chatParticipantTestTranscriptContext = new AsyncLocalStorage<number>();

/**
 * Logic App project information
 */
interface LogicAppProject {
  name: string;
  path: string;
}

/**
 * Specification for a workflow to create
 */
export interface WorkflowSpec {
  name: string;
  type?: WorkflowTypeOption;
}

/**
 * Prompt templates for the chat participant
 */
const SYSTEM_PROMPT = `You are an Azure Logic Apps assistant. Your job is to understand what the user wants and call the appropriate tool.

AVAILABLE ACTIONS:
1. CREATE_PROJECT - Create a new Logic App project
2. CREATE_WORKFLOWS - Create one or more workflows in an existing project
3. MODIFY_ACTION - Modify an action in a workflow
4. HELP - Show help information

When users want to create workflows, extract:
- Workflow names (can be a range like "Order4-8" meaning Order4, Order5, Order6, Order7, Order8)
- Workflow type: stateful (default), stateless, agentic, or agent
- Count if specified (e.g., "5 workflows")

When users want to create a project, extract:
- Project name
- Whether they want custom code support
- Initial workflow specifications

When a built-in connector tool result says it needs connection details, ask the user for those values in chat instead of sending them to a wizard or designer popup. Then call logicapps_addAction again with serviceProviderConnection fields.

DISTINGUISH TARGETS FROM ACTION PARAMETERS:
- Workflow names and project names must come from explicit workflow/project context, such as "to Stateful1", "in workflow OrderProcessor", or "in project ContosoApp".
- Do not treat connector parameters as workflow names, project names, or action names. Locations, units, enum display names, auth fields, table names, queue names, and payload fields are action parameters unless the user explicitly says they are a workflow/project/action name.
- Weather examples: "for Seattle, WA" is the Location parameter; "in Imperial units", "in F", and "in Fahrenheit" are units parameters; "in Metric units", "in C", and "in Celsius" are units parameters. None of those units are project or workflow names.
- If the user says "Add an action to Stateful1 that gets the current weather for Seattle, WA in Imperial units", use workflowName "Stateful1", a weather action name such as "Get_Current_Weather", and parameters { Location: "Seattle, WA", units: "Imperial" }. Do not set projectName to "Imperial".

CARRY USER-PROVIDED VALUES ACROSS TURNS:
- Re-read the prior turns of the conversation before each tool invocation and re-use any concrete values the user has already given (city, table name, file path, status code, etc.).
- Never emit literal placeholder tokens like {Location}, {param}, {Path}, {Body}, or @parameters('X') in inputs.path, inputs.queries, inputs.uri, inputs.body, or any other field. If you don't have a concrete value yet, ask the user before calling the tool.
- Example: if the user said "weather in Seattle" earlier and now asks you to add an msnweather action, set inputs.path to /current/Seattle, WA (or the appropriate resolved value) — do not leave {Location} unsubstituted.

CHAIN DEPENDENT ACTIONS WITH runAfter:
- When a new action consumes the output of a previous action (for example a Response that references body('Get_X'), or any step that depends on the success of another), set configuration.runAfter to { "<PreviousActionName>": ["Succeeded"] } so it runs sequentially.
- For HTTP request → weather → Response workflows, wait for the weather addAction tool result, use the actual action name it added in the Response body expression (for example body('Get_Current_Weather')), and set Response runAfter to that exact weather action name.
- If you omit runAfter when adding to a workflow that already has actions, the tool will default to chaining after the most recently added action; pass an explicit runAfter (including {} for parallel execution) only when you intentionally want a different topology.

PASS PARAMETERS BY NAME, NOT BY SLOT:
- For ApiConnection actions (managed connectors), supply values via the top-level "parameters" field on logicapps_addAction — a flat object keyed by the swagger parameter name. Example: parameters: { Location: 'Seattle, WA', units: 'Imperial' }.
- If you know the user gave connector parameter values but you are not sure of the swagger parameter names, still call logicapps_addAction with the action intent and connector hints; the tool also receives the user's natural request as parameterText and can infer safe values from connector swagger metadata.
- Do NOT hand-craft inputs.queries, inputs.body, inputs.headers, or substitute path placeholders yourself. The tool reads the connector's swagger and routes each value to the correct slot, encodes path parameters as @{encodeURIComponent('value')}, and translates enum display names (e.g. "Imperial") to their underlying code values (e.g. "I").
- For logicapps_modifyAction, put the same "parameters" object inside the modification JSON.

PROMPT FOR MISSING REQUIRED PARAMETERS:
- If logicapps_addAction or logicapps_modifyAction returns an error listing missing required parameters (the message starts with "Missing required parameters for ..."), immediately ask the user for those values in plain language (for example: "Which location should the weather action use?") before retrying the tool call.
- Do not invent defaults, do not guess, and do not retry with placeholders. Wait for the user's answer, then re-invoke the tool with the values under "parameters".

IMPORTANT: Always use the tools provided to execute actions. Do not just describe what you would do.`;

const RESPONSE_GUARDRAILS = `
- Do not fabricate local file paths or clickable markdown links to workspace files.
- Only mention plain filenames (for example, connections.json) unless a tool returned an exact file path.
`;

/**
 * Extracted intent from user prompt
 * @internal Exported for testing
 */
export interface ParsedIntent {
  action: 'createProject' | 'createWorkflows' | 'modifyAction' | 'help' | 'unknown';
  projectName?: string;
  workflows?: WorkflowSpec[];
  targetProject?: string;
  includeCustomCode?: boolean;
  projectType?: ProjectTypeOption;
  targetFramework?: TargetFrameworkOption;
  functionName?: string;
  functionNamespace?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Register the Logic Apps chat participant
 */
export function registerChatParticipant(context: vscode.ExtensionContext): void {
  // Register language model tools
  registerWorkflowTools(context);
  registerProjectTools(context);
  registerChatParticipantTestCommands(context);

  // Create the chat participant
  const participant = vscode.chat.createChatParticipant(CHAT_PARTICIPANT_ID, createChatRequestHandlerForEnvironment());

  // Set participant properties
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'dark', 'LogicApp.svg');

  // Register follow-up provider
  participant.followupProvider = {
    provideFollowups(result: LogicAppsChatResult, _context: vscode.ChatContext, _token: vscode.CancellationToken) {
      const followups: vscode.ChatFollowup[] = [];

      if (result.metadata?.command === ChatCommand.createProject) {
        followups.push({
          prompt: 'Create a stateful workflow in this project',
          label: localize('followupCreateWorkflow', 'Create a workflow'),
        });
      } else if (result.metadata?.command === ChatCommand.createWorkflow) {
        followups.push({
          prompt: `Open the ${result.metadata.workflowName} workflow in the designer`,
          label: localize('followupOpenDesigner', 'Open in designer'),
        });
        followups.push({
          prompt: `Add an HTTP trigger to ${result.metadata.workflowName}`,
          label: localize('followupAddTrigger', 'Add a trigger'),
        });
      } else if (result.metadata?.needsParameter) {
        // Provide suggestions for missing parameters
        if (result.metadata.needsParameter === 'workflowType') {
          followups.push(
            { prompt: 'Create a stateful workflow', label: 'Stateful' },
            { prompt: 'Create a stateless workflow', label: 'Stateless' },
            { prompt: 'Create an agentic workflow', label: 'Autonomous Agent' },
            { prompt: 'Create a conversational agent workflow', label: 'Conversational Agent' }
          );
        } else if (result.metadata.needsParameter === 'projectType') {
          followups.push(
            { prompt: 'Create a standard Logic App project', label: 'Standard' },
            { prompt: 'Create a Logic App project with custom code support', label: 'With Custom Code' }
          );
        }
      } else if (result.metadata?.pendingDuplicateAddAction) {
        followups.push(
          {
            prompt: 'Replace the existing action',
            label: localize('followupReplaceAction', 'Replace existing'),
          },
          {
            prompt: 'Add a separate action',
            label: localize('followupAddSeparateAction', 'Add separate'),
          }
        );
      } else {
        // Default follow-ups
        followups.push({
          prompt: 'What can you help me with?',
          label: localize('followupHelp', 'Show help'),
        });
      }

      return followups;
    },
  };

  context.subscriptions.push(participant);

  ext.outputChannel.appendLine('Logic Apps chat participant registered successfully');
}

function registerChatParticipantTestCommands(context: vscode.ExtensionContext): void {
  if (process.env.LAUX_CHAT_TESTS !== '1') {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(chatParticipantTestCommands.clearTranscript, () => {
      chatParticipantTestTranscript = '';
      clearChatTestDiagnostics();
      chatParticipantTestTranscriptGeneration += 1;
    }),
    vscode.commands.registerCommand(chatParticipantTestCommands.getTranscript, () => chatParticipantTestTranscript),
    vscode.commands.registerCommand(chatParticipantTestCommands.getDiagnostics, () => getChatTestDiagnostics())
  );
  appendChatTestDiagnostic('chat-participant-diagnostics-ready', {
    distLoaded: true,
    commandCount: Object.keys(chatParticipantTestCommands).length,
  });
}

function createChatRequestHandlerForEnvironment(): typeof handleChatRequest {
  if (process.env.LAUX_CHAT_TESTS !== '1') {
    return handleChatRequest;
  }

  return async (request, context, stream, token) =>
    chatParticipantTestTranscriptContext.run(
      chatParticipantTestTranscriptGeneration,
      async () => await handleChatRequest(request, context, stream, token)
    );
}

/**
 * @internal Exported for testing.
 */
export function writeChatMarkdown(
  stream: vscode.ChatResponseStream,
  markdown: Parameters<vscode.ChatResponseStream['markdown']>[0]
): ReturnType<vscode.ChatResponseStream['markdown']> {
  if (process.env.LAUX_CHAT_TESTS === '1' && chatParticipantTestTranscriptContext.getStore() === chatParticipantTestTranscriptGeneration) {
    chatParticipantTestTranscript += typeof markdown === 'string' ? markdown : markdown.value;
  }

  return stream.markdown(markdown);
}

/**
 * Handle incoming chat requests
 *
 * HYBRID APPROACH:
 * 1. Use LLM (when available) to understand intent and extract parameters
 * 2. Fall back to explicit parsing for common patterns
 * 3. Route to explicit handlers for actual execution
 * 4. Handlers manage state and collect missing parameters
 */
async function handleChatRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<LogicAppsChatResult> {
  // Handle explicit slash commands directly
  if (request.command === ChatCommand.createWorkflow) {
    return await handleCreateWorkflowCommand(request, context, stream, token);
  }

  if (request.command === ChatCommand.createProject) {
    return await handleCreateProjectCommand(request, context, stream, token);
  }

  if (request.command === ChatCommand.modifyAction) {
    return await handleModifyActionCommand(request, context, stream, token);
  }

  if (request.command === ChatCommand.help) {
    return await handleHelpCommand(stream);
  }

  if (isUnderspecifiedWorkflowCompositionRequest(request.prompt)) {
    return askForWorkflowCompositionDetails(stream);
  }

  if (isConnectorInformationRequest(request.prompt)) {
    return handleConnectorInformationRequest(stream);
  }

  // Check if user is responding to a pending question (state machine)
  const lastResult = getLastChatResult(context);

  // Prioritize duplicate add-action follow-ups before intent parsing. Replies such as
  // "no" or "add separate" are meaningful only in the pending duplicate context and
  // may otherwise be parsed as unknown/general chat.
  if (lastResult?.metadata?.command === ChatCommand.modifyAction && lastResult.metadata.pendingDuplicateAddAction) {
    return await handleModifyActionCommand(request, context, stream, token);
  }

  // Prioritize modify-action continuations to avoid stale create state hijacking follow-up replies
  if (lastResult?.metadata?.needsParameter && lastResult.metadata.command === ChatCommand.modifyAction) {
    return await handleModifyActionCommand(request, context, stream, token);
  }

  // Prioritize explicit modify prompts over pending create states
  const explicitIntent = parseIntentFromPrompt(request.prompt);
  if (explicitIntent.action === 'modifyAction') {
    const parsedIntent = await parseIntent(request, context, stream, token);
    const modifyIntent = parsedIntent.action === 'modifyAction' ? parsedIntent : explicitIntent;
    return await handleModifyActionCommand(request, context, stream, token, modifyIntent);
  }

  if (lastResult?.metadata?.needsParameter) {
    if (lastResult.metadata.command === ChatCommand.createWorkflow) {
      return await handleCreateWorkflowCommand(request, context, stream, token);
    }

    if (lastResult.metadata.command === ChatCommand.createProject) {
      return await handleCreateProjectCommand(request, context, stream, token);
    }
  }

  // Parse intent - try LLM first, fall back to explicit parsing
  const intent = await parseIntent(request, context, stream, token);

  // Route to explicit handlers based on intent
  switch (intent.action) {
    case 'createProject':
      return await handleCreateProjectCommand(request, context, stream, token, intent);
    case 'createWorkflows':
      return await handleCreateWorkflowCommand(request, context, stream, token, intent);
    case 'modifyAction':
      return await handleModifyActionCommand(request, context, stream, token, intent);
    case 'help':
      return await handleHelpCommand(stream);
    default:
      // Unknown intent - let LLM handle conversationally
      return await handleGeneralRequest(request, context, stream, token);
  }
}

/**
 * Parse user intent from prompt text - pure function for testing
 * @internal Exported for testing
 */
export function parseIntentFromPrompt(prompt: string): ParsedIntent {
  const lowerPrompt = prompt.toLowerCase();

  // Fast path: Explicit pattern matching for common intents
  // This works without LLM and handles most cases

  const leadingExistingWorkflowTargetMatch =
    /^\s*(?:@\w+\s+)?(?:in|inside|within)\s+([A-Za-z][\w.-]*)(?:\s*,|\s+(?=(?:add|insert|append|create|build|make|set up|setup|configure|have|receives?|listens?|replies?|responds?)\b))/i.exec(
      prompt
    );
  const actionTargetWorkflowMatch = /\b(?:action|trigger|response|reply)\b\s+(?:to|in|inside|within)\s+([A-Za-z][\w.-]*)\b/i.exec(prompt);
  const hasLeadingExistingWorkflowTarget = Boolean(
    leadingExistingWorkflowTargetMatch?.[1] && isLikelyWorkflowReference(leadingExistingWorkflowTargetMatch[1])
  );
  const hasActionTargetWorkflow = Boolean(actionTargetWorkflowMatch?.[1] && isLikelyWorkflowReference(actionTargetWorkflowMatch[1]));
  const hasWorkflowMutationIntent =
    /\b(?:add|insert|append|create|build|make|set up|setup|configure|have)\b.*\b(?:action|trigger|http request|request|response|reply|replies|weather)\b/i.test(
      prompt
    ) || /\b(?:receives?|listens? to|replies?|responds?)\b/i.test(prompt);
  const isExplicitNewWorkflowRequest =
    /\b(?:new|additional)\s+workflows?\b/i.test(prompt) ||
    /\b(?:add|create|build|make|set up|setup)\s+(?:a\s+|an\s+|\d+\s+)?(?:stateful\s+|stateless\s+|agentic\s+|agent\s+)?workflows?\b/i.test(
      prompt
    );

  if ((hasLeadingExistingWorkflowTarget || (hasActionTargetWorkflow && !isExplicitNewWorkflowRequest)) && hasWorkflowMutationIntent) {
    return { action: 'modifyAction', confidence: 'high' };
  }

  // Check for workflow creation first - adding workflows to existing project
  // "logic app workflow" is a compound term meaning workflow creation
  if (lowerPrompt.includes('logic app workflow')) {
    return { action: 'createWorkflows', confidence: 'high' };
  }

  // "add/create workflow to/in/under [project]" = adding to existing project
  if (
    (lowerPrompt.includes('add') || lowerPrompt.includes('create') || lowerPrompt.includes('new')) &&
    lowerPrompt.includes('workflow') &&
    (lowerPrompt.includes('to the project') ||
      lowerPrompt.includes('to project') ||
      lowerPrompt.includes('to my project') ||
      /(?:under|in|into|for)\s+[A-Z]/i.test(prompt))
  ) {
    return { action: 'createWorkflows', confidence: 'high' };
  }

  // Check for project creation - "create logic app" is always project creation
  // even if workflows are mentioned (they're part of the new project)
  // Also detect rules engine and custom code patterns as project creation
  if (
    (lowerPrompt.includes('create') || lowerPrompt.includes('new')) &&
    (lowerPrompt.includes('project') ||
      lowerPrompt.includes('workspace') ||
      lowerPrompt.includes('logic app') ||
      lowerPrompt.includes('rules engine') ||
      lowerPrompt.includes('rule engine') ||
      lowerPrompt.includes('custom code'))
  ) {
    return { action: 'createProject', confidence: 'high' };
  }

  // Check for workflow creation - creating/adding workflows
  if ((lowerPrompt.includes('create') || lowerPrompt.includes('new') || lowerPrompt.includes('add')) && lowerPrompt.includes('workflow')) {
    return { action: 'createWorkflows', confidence: 'high' };
  }

  // Check for workflow range pattern (e.g., "Order4-8", "5 workflows") - adding to existing
  if (/\d+\s*(additional\s+)?workflows?/i.test(prompt) || /[A-Za-z]+\d+-\d+/.test(prompt)) {
    return { action: 'createWorkflows', confidence: 'high' };
  }

  // Check for modification intent
  if (lowerPrompt.includes('modify') || lowerPrompt.includes('change') || lowerPrompt.includes('update')) {
    return { action: 'modifyAction', confidence: 'medium' };
  }

  // Check for help
  if (lowerPrompt.includes('help') || lowerPrompt.includes('what can you')) {
    return { action: 'help', confidence: 'high' };
  }

  // Low confidence - will fall through to LLM
  return { action: 'unknown', confidence: 'low' };
}

function isLikelyWorkflowReference(value: string): boolean {
  return (
    /\b(?:workflow|stateful|stateless|agentic|agent)\b/i.test(value) || /\d/.test(value) || /[a-z][A-Z]/.test(value) || /[_.-]/.test(value)
  );
}

/**
 * Parse user intent - wrapper that uses the pure function
 */
async function parseIntent(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  _stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<ParsedIntent> {
  // Try LLM first for comprehensive understanding of intent + parameters
  if (request.model) {
    const llmIntent = await parseRequestWithLLM(request, token);
    if (llmIntent && llmIntent.action !== 'unknown') {
      return llmIntent;
    }
  }

  // Fall back to regex-based parsing (fast, no LLM needed)
  return parseIntentFromPrompt(request.prompt);
}

/**
 * Use LLM to parse the full intent and all parameters from a user prompt in one call.
 * This replaces complex regex patterns with natural language understanding.
 * Falls back gracefully if LLM is unavailable.
 */
async function parseRequestWithLLM(request: vscode.ChatRequest, token: vscode.CancellationToken): Promise<ParsedIntent | undefined> {
  if (!request.model) {
    return undefined;
  }

  try {
    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You are parsing a user request for Azure Logic Apps. Analyze the request and extract structured data.

Return a JSON object with these fields:
- "action": One of "createProject", "createWorkflows", "modifyAction", "help", "unknown"
  - "createProject": user wants to create a new Logic App project/app
  - "createWorkflows": user wants to add NEW workflow files/folders to an existing project
  - "modifyAction": user wants to modify an EXISTING workflow, including adding triggers/actions/responses to a named workflow
  - "help": user asks for help or capabilities
- "projectName": Name of a NEW project to create (only for createProject action)
- "targetProject": Name of an EXISTING Logic App project folder for createWorkflows OR modifyAction. Extract only from explicit project/workspace context like "under project TonyProject", "in project MyApp", "within workspace ProjectX", or "in TonyProject, Workflow1". Do not extract locations, units, connector names, enum display names, or action parameters as projects. For example, "in Imperial units" is NOT a project.
- "workflows": Array of workflow objects, each with:
  - "name": string - the workflow name
  - "type": "stateful" | "stateless" | "agentic" | "agent" (OMIT if user didn't specify a type)
- "projectType": One of "logicApp", "logicAppCustomCode", "rulesEngine". Detect from:
  - "rules engine" or "rules" or "business rules" → "rulesEngine"
  - "custom code" or "C#" or ".NET" or "dotnet" or "functions" → "logicAppCustomCode"
  - Otherwise → "logicApp"
- "includeCustomCode": true if projectType is "logicAppCustomCode" or "rulesEngine"
- "targetFramework": Only for customCode projects. "net8" (default) or "net472" (if user says ".NET Framework", "NetFx", "net472", or "Framework")
- "functionName": Only for customCode/rulesEngine. The C# function/method name if specified (e.g. "function called ProcessOrder"). Default to project name + "Functions" if not specified but project is customCode/rulesEngine.
- "functionNamespace": Only for customCode/rulesEngine. The C# namespace if specified. Default to project name + ".Functions" if not specified but project is customCode/rulesEngine.

IMPORTANT rules for extracting workflow names:
- "Add an action to Stateful1 that gets the weather..." → action is "modifyAction"; Stateful1 is an existing workflow target, NOT a workflow to create
- "In Stateful1, build a workflow that receives an HTTP request and replies..." → action is "modifyAction"; Stateful1 is an existing workflow target, NOT a workflow to create
- "5 stateful workflows from Stateful1-5" → Stateful1, Stateful2, Stateful3, Stateful4, Stateful5 (all stateful)
- "5 stateful workflows from Stateful1 to Stateful5" → same as above
- "Order4-8" → Order4, Order5, Order6, Order7, Order8
- "3 workflows called Order" → Order1, Order2, Order3
- "a workflow called OrderProcessor" → just OrderProcessor
- "5 stateful workflows under TonyProject from Stateful1-5" → targetProject is "TonyProject", workflows are Stateful1-5

User request: "${request.prompt}"

Respond with ONLY a JSON object, no explanation or markdown.`
      ),
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let responseText = '';
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        responseText += part.value;
      }
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Map workflow types to our enum
      if (parsed.workflows && Array.isArray(parsed.workflows)) {
        parsed.workflows = parsed.workflows.map((w: { name: string; type?: string }) => ({
          name: w.name,
          type: w.type ? mapExtractedType(w.type) : undefined,
        }));
      }

      return {
        action: parsed.action || 'unknown',
        projectName: parsed.projectName,
        targetProject: parsed.targetProject,
        workflows: parsed.workflows,
        includeCustomCode: parsed.includeCustomCode,
        projectType: mapParsedProjectType(parsed.projectType),
        targetFramework: mapParsedTargetFramework(parsed.targetFramework),
        functionName: parsed.functionName,
        functionNamespace: parsed.functionNamespace,
        confidence: 'high',
      };
    }
  } catch {
    // LLM unavailable or failed, fall back to regex
  }

  return undefined;
}

/**
 * Check if a response is a confirmation (yes, sure, ok, etc.)
 * @internal Exported for testing
 */
export function isConfirmationResponse(prompt: string): boolean {
  const confirmations = [
    'yes',
    'yeah',
    'yep',
    'yup',
    'sure',
    'ok',
    'okay',
    'sounds good',
    'go ahead',
    'do it',
    'please',
    'thanks',
    'that works',
    'perfect',
    'great',
    'fine',
    'correct',
    'right',
  ];
  const lower = prompt.toLowerCase().trim();
  return confirmations.some((c) => lower === c || lower.startsWith(`${c} `) || lower.endsWith(` ${c}`));
}

export function getDuplicateActionChoice(prompt: string): AddActionParams['duplicateActionBehavior'] | undefined {
  const normalized = prompt
    .replace(/^\s*@logicapps\s*/i, '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/\b(?:separate|another|additional|new|add separate|add another)\b/.test(normalized)) {
    return 'addNew';
  }

  if (/^(?:no|nope|nah)\b/.test(normalized)) {
    return 'addNew';
  }

  if (isConfirmationResponse(normalized) || /\b(?:replace|update|overwrite|change|modify)\b/.test(normalized)) {
    return 'replace';
  }

  return undefined;
}

function normalizeProjectToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Extract project names from ambiguity response text:
 * Workflow "X" exists in multiple projects...\n- ProjectA\n- ProjectB
 * @internal Exported for testing
 */
export function extractProjectNamesFromAmbiguityResponse(text: string): string[] {
  const projectNames: string[] = [];
  const bulletRegex = /^\s*(?:-|\*|•)\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/gm;

  let match: RegExpExecArray | null;
  while ((match = bulletRegex.exec(text)) !== null) {
    const projectName = match[1];
    if (!projectNames.includes(projectName)) {
      projectNames.push(projectName);
    }
  }

  return projectNames;
}

/**
 * Resolve a user's project selection response against available project names.
 * Supports exact, case-insensitive, punctuation-tolerant, and contextual matches.
 * @internal Exported for testing
 */
export function resolveSelectedProjectName(response: string, projectNames: string[]): string | undefined {
  const sanitizedResponse = response.replace(/^\s*@logicapps\s*/i, '').trim();
  if (!sanitizedResponse || projectNames.length === 0) {
    return undefined;
  }

  const exactMatch = projectNames.find((name) => name.toLowerCase() === sanitizedResponse.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedResponse = normalizeProjectToken(sanitizedResponse);
  if (!normalizedResponse) {
    return undefined;
  }

  const normalizedMatches = projectNames.filter((name) => {
    const normalizedName = normalizeProjectToken(name);
    return normalizedResponse.includes(normalizedName) || normalizedName.includes(normalizedResponse);
  });

  if (normalizedMatches.length === 1) {
    return normalizedMatches[0];
  }

  return undefined;
}

/**
 * Extract an existing project name from freeform modify prompts.
 * @internal Exported for testing
 */
export function extractTargetProjectFromPrompt(prompt: string): string | undefined {
  const explicitContextMatch = prompt.match(/\bin\s+([A-Z][A-Za-z0-9_-]*)\s*,\s*Workflow/i);
  if (explicitContextMatch?.[1]) {
    return explicitContextMatch[1];
  }

  const candidates = Array.from(
    prompt.matchAll(/\b(?:under|within|inside)\s+(?:the\s+)?(?:project\s+|workspace\s+)?([A-Z][A-Za-z0-9_-]*)\b/g),
    (match) => match[1]
  );
  candidates.push(
    ...Array.from(prompt.matchAll(/\b(?:project|workspace)\s+(?:named\s+|called\s+)?([A-Z][A-Za-z0-9_-]*)\b/g), (match) => match[1])
  );

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (/^workflow\d*$/i.test(candidate)) {
      continue;
    }

    return candidate;
  }

  return undefined;
}

/**
 * Detect workflow composition requests that describe a full workflow shape but omit
 * details the chat agent needs before it can safely write workflow.json.
 *
 * @internal Exported for testing
 */
export function isUnderspecifiedWorkflowCompositionRequest(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  if (!/\b(?:create|add|build|make)\b/.test(lowerPrompt) || !lowerPrompt.includes('workflow')) {
    return false;
  }

  const describesTriggerOrAction =
    /\b(?:listen|listens|trigger|when|queue|service bus|storage queue|sql|cosmos|database|db|based on|message type)\b/i.test(prompt);

  return describesTriggerOrAction;
}

function askForWorkflowCompositionDetails(stream: vscode.ChatResponseStream): LogicAppsChatResult {
  writeChatMarkdown(
    stream,
    localize(
      'workflowCompositionDetailsRequired',
      [
        'I can help create that workflow, but I need a few required details before I write project or workflow files:',
        '',
        '- Workflow name and target Logic App project',
        '- Queue provider (Service Bus queue or Azure Storage queue), queue name, and connection/auth details',
        '- Where the message type is located in the message payload and what should happen for unknown values',
        '- SQL server/database/table/auth details and how to map the message payload to columns',
        '- Cosmos DB account/database/container/partition key/auth details and how to map the message payload to the document',
        '',
        'Please provide those details, or tell me which existing connections and workflow name to use.',
      ].join('\n')
    )
  );
  return { metadata: { command: ChatCommand.createWorkflow, needsParameter: 'workflowCompositionDetails' } };
}

function isConnectorInformationRequest(prompt: string): boolean {
  const normalizedPrompt = prompt.replace(/^\s*@logicapps\s*/i, '').trim();
  return (
    /^(?:what\s+(?:is|are)\s+(?:a\s+)?(?:logic apps\s+)?connectors?|explain\s+(?:logic apps\s+)?connectors?)\??$/i.test(normalizedPrompt) ||
    /^what\s+is\s+a\s+connector\s+in\s+azure\s+logic\s+apps\??$/i.test(normalizedPrompt)
  );
}

function handleConnectorInformationRequest(stream: vscode.ChatResponseStream): LogicAppsChatResult {
  writeChatMarkdown(
    stream,
    [
      'A connector in Azure Logic Apps is a packaged integration point for an app, service, protocol, or system.',
      '',
      'Connectors provide triggers and actions that a workflow can use, such as listening for a message, calling an API, reading a file, or writing to a database.',
      'Some connectors require connection details or authentication before an action can be added to a workflow.',
    ].join('\n')
  );

  return { metadata: { command: ChatCommand.help } };
}

interface InvokableTool {
  name: string;
  description?: string;
  inputSchema?: object;
}

interface ToolOrchestrationResult {
  toolResponseText: string;
  invokedToolNames: string[];
  mutationApplied: boolean;
  mutationCount: number;
  requestedProjectDisambiguation: boolean;
  duplicateAddActionInput?: AddActionParams;
}

const workflowProjectScopedTools = new Set<string>([
  ToolName.getWorkflowDefinition,
  ToolName.addAction,
  ToolName.modifyAction,
  ToolName.deleteAction,
]);

const mutatingWorkflowTools = new Set<string>([ToolName.addAction, ToolName.modifyAction, ToolName.deleteAction]);

const readOnlyWorkflowTools = new Set<string>([ToolName.getWorkflowDefinition, ToolName.listWorkflows]);

const MAX_TOOL_PARAMETER_TEXT_LENGTH = 512;

function logChatDiagnostics(label: string, payload: Record<string, unknown>): void {
  appendChatTestDiagnostic(label, payload);
}

function previewDiagnosticValue(value: unknown, key?: string): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (key && /(key|secret|token|password|connectionstring|authorization|authentication)/i.test(key)) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }

  if (typeof value === 'object') {
    return { keys: Object.keys(value as Record<string, unknown>) };
  }

  return String(value);
}

function summarizeParameterContainer(value: unknown): { keys: string[]; preview: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { keys: [], preview: {} };
  }

  const record = value as Record<string, unknown>;
  return {
    keys: Object.keys(record),
    preview: Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, previewDiagnosticValue(entry, key)])),
  };
}

function summarizeAddActionToolInput(value: unknown): Record<string, unknown> {
  const input = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const configuration =
    typeof input.configuration === 'object' && input.configuration !== null ? (input.configuration as Record<string, unknown>) : {};
  const inputs =
    typeof configuration.inputs === 'object' && configuration.inputs !== null ? (configuration.inputs as Record<string, unknown>) : {};

  return {
    keys: Object.keys(input),
    workflowName: previewDiagnosticValue(input.workflowName),
    actionName: previewDiagnosticValue(input.actionName),
    actionType: previewDiagnosticValue(input.actionType),
    connectorReference: previewDiagnosticValue(input.connectorReference),
    connectorId: previewDiagnosticValue(input.connectorId),
    operationId: previewDiagnosticValue(input.operationId),
    method: previewDiagnosticValue(input.method),
    path: previewDiagnosticValue(input.path),
    parameterTextLength: typeof input.parameterText === 'string' ? input.parameterText.length : 0,
    parameterTextPreview: previewDiagnosticValue(input.parameterText, 'parameterText'),
    topLevelParameters: summarizeParameterContainer(input.parameters),
    configurationKeys: Object.keys(configuration),
    configurationParameters: summarizeParameterContainer(configuration.parameters),
    inputKeys: Object.keys(inputs),
    inputParameters: summarizeParameterContainer(inputs.parameters),
  };
}

function logAddActionToolInputDiagnostics(rawInput: unknown, normalizedInput: unknown): void {
  logChatDiagnostics('addAction-tool-input', {
    raw: summarizeAddActionToolInput(rawInput),
    normalized: summarizeAddActionToolInput(normalizedInput),
  });
}

function truncateParameterTextPreservingEdges(value: string): string {
  if (value.length <= MAX_TOOL_PARAMETER_TEXT_LENGTH) {
    return value;
  }

  const separator = '\n...\n';
  const availableLength = MAX_TOOL_PARAMETER_TEXT_LENGTH - separator.length;
  const headLength = Math.floor(availableLength * 0.4);
  const tailLength = availableLength - headLength;
  return `${value.slice(0, headLength)}${separator}${value.slice(-tailLength)}`;
}

function withForcedProjectNameOnToolInput(toolName: string, input: object, forcedProjectName?: string): object {
  if (!forcedProjectName) {
    return input;
  }

  if (!workflowProjectScopedTools.has(toolName)) {
    return input;
  }

  if (typeof input !== 'object' || input === null) {
    return input;
  }

  const inputRecord = { ...(input as Record<string, unknown>) };
  if (typeof inputRecord.workflowName !== 'string') {
    return input;
  }

  inputRecord.projectName = forcedProjectName;
  return inputRecord;
}

/**
 * Remove model-inferred project names that do not correspond to actual Logic App projects.
 *
 * @internal Exported for testing.
 */
export function sanitizeWorkflowProjectNameOnToolInput(toolName: string, input: object, validProjectNames: string[]): object {
  if (!workflowProjectScopedTools.has(toolName) || typeof input !== 'object' || input === null) {
    return input;
  }

  const inputRecord = input as Record<string, unknown>;
  if (typeof inputRecord.projectName !== 'string' || !inputRecord.projectName.trim()) {
    return input;
  }

  const trimmedProjectName = inputRecord.projectName.trim();
  const hasMatchingProject = validProjectNames.some((projectName) => projectName.toLowerCase() === trimmedProjectName.toLowerCase());
  if (hasMatchingProject) {
    return input;
  }

  const sanitizedInput = { ...inputRecord };
  delete sanitizedInput.projectName;
  return sanitizedInput;
}

export function withParameterTextOnAddActionToolInput(toolName: string, input: object, prompt: string): object {
  if (toolName !== ToolName.addAction || typeof input !== 'object' || input === null) {
    return input;
  }

  const inputRecord = input as Record<string, unknown>;
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return input;
  }

  if (typeof inputRecord.parameterText === 'string' && inputRecord.parameterText.trim()) {
    const existingParameterText = inputRecord.parameterText.trim();
    if (existingParameterText.includes(trimmedPrompt)) {
      return input;
    }

    const userRequestText = `User request: ${trimmedPrompt}`;
    if (userRequestText.length >= MAX_TOOL_PARAMETER_TEXT_LENGTH) {
      return {
        ...inputRecord,
        parameterText: truncateParameterTextPreservingEdges(userRequestText),
      };
    }

    const maxExistingLength = MAX_TOOL_PARAMETER_TEXT_LENGTH - userRequestText.length - 2;
    const preservedExistingText = maxExistingLength > 0 ? existingParameterText.slice(0, maxExistingLength).trimEnd() : '';

    return {
      ...inputRecord,
      parameterText: preservedExistingText ? `${preservedExistingText}\n\n${userRequestText}` : userRequestText,
    };
  }

  return {
    ...inputRecord,
    parameterText: truncateParameterTextPreservingEdges(trimmedPrompt),
  };
}

function coerceToolInputToObject(input: unknown): object {
  if (typeof input === 'object' && input !== null) {
    return input;
  }

  return {};
}

export function normalizeChatToolInput(
  toolName: string,
  input: unknown,
  prompt: string,
  options: { forcedProjectName?: string; validProjectNames?: string[] } = {}
): object {
  const baseInput = coerceToolInputToObject(input);
  const forcedToolInput = withForcedProjectNameOnToolInput(toolName, baseInput, options.forcedProjectName);
  const projectScopedInput =
    !options.forcedProjectName && options.validProjectNames && workflowProjectScopedTools.has(toolName)
      ? sanitizeWorkflowProjectNameOnToolInput(toolName, forcedToolInput, options.validProjectNames)
      : forcedToolInput;
  return withParameterTextOnAddActionToolInput(toolName, projectScopedInput, prompt);
}

export function isSuccessfulMutatingWorkflowToolResult(toolText: string): boolean {
  const normalized = toolText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/(?:missing required parameters|not found|could not|unable to|failed|invalid|please specify projectname|error)/i.test(normalized)) {
    return false;
  }

  return /\b(?:successfully|deleted)\b/i.test(normalized);
}

/**
 * Detect prompts that ask chat to build the complete HTTP → weather → Response workflow.
 *
 * @internal Exported for testing.
 */
export function isFullWeatherWorkflowRequest(prompt: string): boolean {
  const normalized = prompt.replace(/^\s*@logicapps\s*/i, '').toLowerCase();
  return (
    /\bweather\b/.test(normalized) &&
    /\b(?:receives?|listens?|trigger(?:ed)?|http request|request)\b/.test(normalized) &&
    /\b(?:repl(?:y|ies)|responds?|returns?|response)\b/.test(normalized)
  );
}

/**
 * Extract the named workflow target from a modification prompt.
 *
 * @internal Exported for testing.
 */
export function extractTargetWorkflowNameFromPrompt(prompt: string): string | undefined {
  const sanitizedPrompt = prompt.replace(/^\s*@logicapps\s*/i, '').trim();
  const patterns = [
    /^(?:in|inside|within)\s+([A-Za-z][\w.-]*)(?:\s*,|\s+(?=(?:add|insert|append|create|build|make|set up|setup|configure|have|receives?|listens?|replies?|responds?)\b))/i,
    /\b(?:action|trigger|response|reply)\b\s+(?:to|in|inside|within)\s+([A-Za-z][\w.-]*)\b/i,
    /\bworkflow\s+([A-Za-z][\w.-]*)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(sanitizedPrompt);
    const workflowName = match?.[1]?.trim();
    if (workflowName && isLikelyWorkflowReference(workflowName)) {
      return workflowName;
    }
  }

  return undefined;
}

function isWeatherActionEntry(_name: string, action: unknown): boolean {
  if (typeof action !== 'object' || action === null) {
    return false;
  }

  const actionRecord = action as Record<string, unknown>;
  if (actionRecord.type !== 'ApiConnection') {
    return false;
  }

  const inputs =
    typeof actionRecord.inputs === 'object' && actionRecord.inputs !== null ? (actionRecord.inputs as Record<string, unknown>) : {};
  const host = typeof inputs.host === 'object' && inputs.host !== null ? (inputs.host as Record<string, unknown>) : {};
  const connection = typeof host.connection === 'object' && host.connection !== null ? (host.connection as Record<string, unknown>) : {};
  const referenceName = connection.referenceName;
  const operationPath = inputs.path;

  return (
    (typeof referenceName === 'string' && referenceName.toLowerCase().includes('weather')) ||
    (typeof operationPath === 'string' && operationPath.startsWith('/current/'))
  );
}

function responseReferencesWeatherAction(action: unknown, weatherActionName: string): boolean {
  if (typeof action !== 'object' || action === null) {
    return false;
  }

  const actionRecord = action as Record<string, unknown>;
  if (actionRecord.type !== 'Response') {
    return false;
  }

  const runAfter = typeof actionRecord.runAfter === 'object' && actionRecord.runAfter !== null ? actionRecord.runAfter : undefined;
  if (!runAfter || !Object.prototype.hasOwnProperty.call(runAfter, weatherActionName)) {
    return false;
  }

  const inputs = typeof actionRecord.inputs === 'object' && actionRecord.inputs !== null ? actionRecord.inputs : {};
  const bodyText = JSON.stringify((inputs as Record<string, unknown>).body ?? inputs);
  return bodyText.includes(`body('${weatherActionName}')`) || bodyText.includes(`body(&#39;${weatherActionName}&#39;)`);
}

function findFullWeatherWorkflowState(workflowDefinition: unknown): {
  weatherActionName?: string;
  responseActionName?: string;
  hasChainedResponse: boolean;
} {
  const definition =
    typeof workflowDefinition === 'object' && workflowDefinition !== null
      ? (workflowDefinition as Record<string, unknown>).definition
      : undefined;
  const actions =
    typeof definition === 'object' && definition !== null && typeof (definition as Record<string, unknown>).actions === 'object'
      ? ((definition as Record<string, unknown>).actions as Record<string, unknown>)
      : {};
  const weatherEntry = Object.entries(actions).find(([name, action]) => isWeatherActionEntry(name, action));
  const weatherActionName = weatherEntry?.[0];
  const responseEntry = Object.entries(actions).find(([, action]) => {
    return typeof action === 'object' && action !== null && (action as Record<string, unknown>).type === 'Response';
  });
  const responseActionName = responseEntry?.[0];

  return {
    weatherActionName,
    responseActionName,
    hasChainedResponse: Boolean(weatherActionName && responseEntry && responseReferencesWeatherAction(responseEntry[1], weatherActionName)),
  };
}

async function readWorkflowDefinitionFromWorkspace(
  workflowName: string,
  projectName?: string
): Promise<{ workflowPath: string; definition: unknown } | undefined> {
  const projects = await findLogicAppProjects();
  const matchingProjects = projectName ? projects.filter((project) => project.name.toLowerCase() === projectName.toLowerCase()) : projects;

  for (const project of matchingProjects) {
    const workflowPath = path.join(project.path, workflowName, workflowFileName);
    if (await fse.pathExists(workflowPath)) {
      return {
        workflowPath,
        definition: await fse.readJson(workflowPath),
      };
    }
  }

  return undefined;
}

async function ensureFullWeatherWorkflowResponse(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  prompt: string,
  projectName?: string
): Promise<boolean> {
  const workflowName = extractTargetWorkflowNameFromPrompt(prompt);
  if (!workflowName) {
    return false;
  }

  const workflow = await readWorkflowDefinitionFromWorkspace(workflowName, projectName);
  if (!workflow) {
    return false;
  }

  const state = findFullWeatherWorkflowState(workflow.definition);
  if (!state.weatherActionName || state.hasChainedResponse) {
    return false;
  }

  const actionName = state.responseActionName ?? 'Response';
  const addResponseInput: AddActionParams = {
    workflowName,
    projectName,
    actionType: 'Response',
    actionName,
    configuration: {
      inputs: {
        statusCode: 200,
        body: `@body('${state.weatherActionName}')`,
      },
      runAfter: {
        [state.weatherActionName]: ['Succeeded'],
      },
    },
    duplicateActionBehavior: state.responseActionName ? 'replace' : undefined,
  };

  stream.progress(localize('executingTool', 'Executing...'));
  const result = await vscode.lm.invokeTool(
    ToolName.addAction,
    { input: addResponseInput, toolInvocationToken: request.toolInvocationToken },
    token
  );

  for (const content of result.content) {
    if (content instanceof vscode.LanguageModelTextPart) {
      writeChatMarkdown(stream, content.value);
    }
  }

  logChatDiagnostics('weather-workflow-response-continuation', {
    workflowName,
    projectName,
    weatherActionName: state.weatherActionName,
    responseActionName: actionName,
  });

  return true;
}

export function buildModifyActionOrchestrationPrompt(effectivePrompt: string): string {
  return `${SYSTEM_PROMPT}
${RESPONSE_GUARDRAILS}

Modify the workflow action as requested: ${effectivePrompt}

Additional modify-action rules:
- If adding "When a HTTP request is received", create it as a trigger in definition.triggers using type "Request", not an action in definition.actions.
- For managed connectors (for example SQL, Service Bus, Office 365, Weather), prefer ApiConnection actions over raw Http calls and include connectorReference plus operation method/path when available from connector metadata.
- If a built-in connector needs connection details, ask for them in chat and retry with serviceProviderConnection fields instead of asking the user to use a wizard.
- If the user asks for a workflow that receives an HTTP request and replies/responds with weather, complete all three steps before stopping: add a Request trigger, add the msnweather current-weather ApiConnection action with the user-provided Location, then add a Response action whose body references the actual weather action output and whose runAfter chains after that actual weather action name.
- After the weather addAction tool succeeds, use the returned action name for the Response body and runAfter. For example, if the tool added "Get_Current_Weather", the Response body should reference body('Get_Current_Weather') and runAfter should be { "Get_Current_Weather": ["Succeeded"] }.
- Respect duplicate-action tool results. If addAction says the requested trigger or action name already exists, ask whether to replace it or add a separate action; do not assume replace.
- Do not fabricate local file paths or clickable markdown links. Mention plain filenames unless a tool returns an exact path.`;
}

export function buildToolResultContinuationInstruction(
  options: { minMutationCount?: number; mutationNudge?: string } | undefined,
  projectedMutationCount: number
): string {
  if (options?.minMutationCount && projectedMutationCount < options.minMutationCount) {
    return (
      options.mutationNudge ??
      'More workflow changes are still required. Continue applying the requested workflow changes by calling the remaining mutating workflow tools.'
    );
  }

  return 'Continue only if more tool actions are required.';
}

function getToolCallSignature(toolName: string, input: unknown): string {
  try {
    return `${toolName}:${JSON.stringify(input)}`;
  } catch {
    return `${toolName}:${String(input)}`;
  }
}

async function runToolOrchestration(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  tools: readonly InvokableTool[],
  initialMessages: vscode.LanguageModelChatMessage[],
  options?: {
    forcedProjectName?: string;
    maxIterations?: number;
    requireMutation?: boolean;
    mutationNudge?: string;
    minMutationCount?: number;
  }
): Promise<ToolOrchestrationResult> {
  if (!request.model) {
    return {
      toolResponseText: '',
      invokedToolNames: [],
      mutationApplied: false,
      mutationCount: 0,
      requestedProjectDisambiguation: false,
    };
  }

  const messages = [...initialMessages];
  const maxIterations = options?.maxIterations ?? 4;
  const calledSignatures = new Set<string>();

  const invokedToolNames: string[] = [];
  let toolResponseText = '';
  let mutationApplied = false;
  let mutationCount = 0;
  let readToolUsed = false;
  let requestedProjectDisambiguation = false;
  let duplicateAddActionInput: AddActionParams | undefined;
  let mutationNudgeSent = false;
  let validProjectNames: string[] | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await request.model.sendRequest(
      messages,
      {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema,
        })),
      },
      token
    );

    let assistantText = '';
    const toolCalls: Array<{ name: string; input: unknown }> = [];

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        writeChatMarkdown(stream, part.value);
        assistantText += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({ name: part.name, input: part.input });
      }
    }

    logChatDiagnostics('tool-orchestration-turn', {
      iteration,
      assistantTextLength: assistantText.length,
      toolCallNames: toolCalls.map((toolCall) => toolCall.name),
      readToolUsed,
      mutationApplied,
      mutationCount,
    });

    if (assistantText.trim()) {
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantText));
    }

    if (toolCalls.length === 0) {
      if (options?.minMutationCount && mutationCount < options.minMutationCount && !mutationNudgeSent) {
        logChatDiagnostics('tool-orchestration-nudge', {
          iteration,
          reason: 'minimum-mutation-count',
          mutationCount,
          minMutationCount: options.minMutationCount,
          assistantTextLength: assistantText.length,
        });
        messages.push(
          vscode.LanguageModelChatMessage.User(
            options.mutationNudge ?? 'Continue applying the requested workflow changes by calling the remaining mutating workflow tools.'
          )
        );
        mutationNudgeSent = true;
        continue;
      }

      if (options?.requireMutation && readToolUsed && !mutationApplied && !mutationNudgeSent) {
        logChatDiagnostics('tool-orchestration-nudge', {
          iteration,
          reason: 'read-tool-without-mutation',
          assistantTextLength: assistantText.length,
        });
        messages.push(
          vscode.LanguageModelChatMessage.User(
            options.mutationNudge ?? 'You have inspected the workflow. Apply the requested change now by calling a mutating workflow tool.'
          )
        );
        mutationNudgeSent = true;
        continue;
      }

      logChatDiagnostics('tool-orchestration-no-tools', {
        iteration,
        requireMutation: options?.requireMutation === true,
        readToolUsed,
        mutationApplied,
        mutationCount,
        mutationNudgeSent,
        assistantTextLength: assistantText.length,
      });
      break;
    }

    let executedAnyTool = false;

    for (const toolCall of toolCalls) {
      stream.progress(localize('executingTool', 'Executing...'));

      if (!options?.forcedProjectName && workflowProjectScopedTools.has(toolCall.name)) {
        validProjectNames ??= (await findLogicAppProjects()).map((project) => project.name);
      }
      const toolInput = normalizeChatToolInput(toolCall.name, toolCall.input, request.prompt, {
        forcedProjectName: options?.forcedProjectName,
        validProjectNames,
      });
      if (toolCall.name === ToolName.addAction) {
        logAddActionToolInputDiagnostics(toolCall.input, toolInput);
      }

      const signature = getToolCallSignature(toolCall.name, toolInput);
      if (calledSignatures.has(signature)) {
        logChatDiagnostics('tool-orchestration-duplicate-tool-call', {
          toolName: toolCall.name,
          signature,
        });
        continue;
      }

      calledSignatures.add(signature);
      executedAnyTool = true;
      invokedToolNames.push(toolCall.name);

      if (readOnlyWorkflowTools.has(toolCall.name)) {
        readToolUsed = true;
      }

      const result = await vscode.lm.invokeTool(
        toolCall.name,
        { input: toolInput, toolInvocationToken: request.toolInvocationToken },
        token
      );

      let toolText = '';
      for (const content of result.content) {
        if (content instanceof vscode.LanguageModelTextPart) {
          writeChatMarkdown(stream, content.value);
          toolText += `\n${content.value}`;
        }
      }

      if (toolText.trim()) {
        logChatDiagnostics('tool-orchestration-tool-result', {
          toolName: toolCall.name,
          textLength: toolText.length,
          successClassifiedAsMutation: mutatingWorkflowTools.has(toolCall.name) && isSuccessfulMutatingWorkflowToolResult(toolText),
          textPreview: previewDiagnosticValue(toolText, 'toolText'),
        });
        const successfulMutation = mutatingWorkflowTools.has(toolCall.name) && isSuccessfulMutatingWorkflowToolResult(toolText);
        const projectedMutationCount = mutationCount + (successfulMutation ? 1 : 0);

        toolResponseText += toolText;
        messages.push(
          vscode.LanguageModelChatMessage.User(
            `Tool ${toolCall.name} result:\n${toolText}\n${buildToolResultContinuationInstruction(options, projectedMutationCount)}`
          )
        );
      }

      if (toolCall.name === ToolName.addAction && /already exists in workflow/i.test(toolText)) {
        duplicateAddActionInput = toolInput as AddActionParams;
      }

      if (mutatingWorkflowTools.has(toolCall.name) && isSuccessfulMutatingWorkflowToolResult(toolText)) {
        mutationApplied = true;
        mutationCount += 1;
        mutationNudgeSent = false;
      }

      if (/please specify projectname/i.test(toolText)) {
        requestedProjectDisambiguation = true;
      }
    }

    if (!executedAnyTool || requestedProjectDisambiguation) {
      break;
    }
  }

  return {
    toolResponseText,
    invokedToolNames,
    mutationApplied,
    mutationCount,
    requestedProjectDisambiguation,
    duplicateAddActionInput,
  };
}

/**
 * Extracted conversational response from LLM
 */
interface ConversationalResponse {
  projectName?: string;
  workflows?: WorkflowSpec[];
  workflowType?: WorkflowTypeOption;
  targetProject?: string;
  confirmed?: boolean;
}

/**
 * Use LLM to understand a conversational response when we're waiting for a parameter
 * This handles natural language responses like:
 * - "Name it MyLogicApp" → {projectName: "MyLogicApp"}
 * - "sure" → {confirmed: true}
 * - "5 stateful workflows" → {workflows: [...]}
 */
async function extractConversationalResponse(
  request: vscode.ChatRequest,
  lastResult: LogicAppsChatResult,
  token: vscode.CancellationToken
): Promise<ConversationalResponse | undefined> {
  if (!request.model) {
    return undefined;
  }

  const needsParameter = lastResult.metadata.needsParameter;

  let extractionPrompt = '';

  switch (needsParameter) {
    case 'projectName':
      extractionPrompt = `The user was asked to provide a project name for a Logic App.
Extract the project name from their response. 
If they're confirming/agreeing without providing a name (e.g., "sure", "yes", "ok"), set "confirmed" to true.
If they say something like "Name it X" or "Call it X", extract X as the projectName.
Return JSON: {"projectName": "ExtractedName"} or {"confirmed": true}`;
      break;

    case 'workflows':
      extractionPrompt = `The user was asked to specify what workflows to create.
Extract workflow specifications from their response.
Workflow types: stateful, stateless, agentic, agent
Handle patterns like:
- "a stateful workflow called OrderProcessor"
- "5 stateful workflows from Order1 to Order5"  
- "default" means one stateful workflow called Workflow1
Return JSON: {"workflows": [{"name": "WorkflowName", "type": "stateful"}]}`;
      break;

    case 'workflowType':
      extractionPrompt = `The user was asked to select a workflow type.
Valid types: stateful, stateless, agentic, agent
Extract which type they chose from their response.
Return JSON: {"workflowType": "stateful"}`;
      break;

    case 'targetProject':
      extractionPrompt = `The user was asked which Logic App project to use.
Extract the project name they selected from their response.
Return JSON: {"targetProject": "ProjectName"}`;
      break;

    default:
      return undefined;
  }

  try {
    const messages = [
      vscode.LanguageModelChatMessage.User(
        `${extractionPrompt}\n\nUser response: "${request.prompt}"\n\nRespond with ONLY a JSON object, no explanation.`
      ),
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let responseText = '';
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        responseText += part.value;
      }
    }

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Map workflowType string to WorkflowTypeOption
      if (parsed.workflowType && typeof parsed.workflowType === 'string') {
        parsed.workflowType = mapExtractedType(parsed.workflowType);
      }

      // Map workflow types in array
      if (parsed.workflows && Array.isArray(parsed.workflows)) {
        parsed.workflows = parsed.workflows.map((w: { name: string; type: string }) => ({
          name: w.name,
          type: mapExtractedType(w.type) || WorkflowTypeOption.stateful,
        }));
      }

      return parsed as ConversationalResponse;
    }
  } catch {
    // LLM extraction failed, return undefined
  }

  return undefined;
}

/**
 * Handle /createWorkflow command
 */
async function handleCreateWorkflowCommand(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  intent?: ParsedIntent
): Promise<LogicAppsChatResult> {
  stream.progress(localize('analyzingRequest', 'Analyzing your request...'));

  if (isUnderspecifiedWorkflowCompositionRequest(request.prompt)) {
    return askForWorkflowCompositionDetails(stream);
  }

  // Check if user is responding to a project selection question
  const lastResult = getLastChatResult(context);
  if (lastResult?.metadata?.needsParameter === 'targetProject' && lastResult?.metadata?.pendingWorkflows) {
    return await handleProjectSelectionResponse(request, lastResult, stream, token);
  }

  // Check if user is responding to a workflow type question
  if (lastResult?.metadata?.needsParameter === 'workflowType' && lastResult?.metadata?.pendingWorkflows) {
    return await handleWorkflowTypeResponse(request, lastResult, stream, token);
  }

  // --- LLM-first parsing ---
  // Use pre-parsed intent from parseIntent() if available (already did LLM call)
  let workflows: WorkflowSpec[] = intent?.workflows ?? [];
  let specifiedProject: string | undefined = intent?.targetProject;
  let workflowName: string | undefined;

  // If no pre-parsed intent (e.g., slash command), try LLM extraction directly
  if (workflows.length === 0 && !intent && request.model) {
    const llmIntent = await parseRequestWithLLM(request, token);
    if (llmIntent) {
      workflows = llmIntent.workflows ?? [];
      specifiedProject = specifiedProject ?? llmIntent.targetProject;
    }
  }

  // --- Regex fallback (when LLM is unavailable or didn't extract) ---
  if (workflows.length === 0) {
    // Extract target project name from the prompt (e.g., "under TonyProject", "in MyApp")
    if (!specifiedProject) {
      const projectRefMatch = request.prompt.match(/(?:under|in|into|for|to)\s+([A-Z][a-zA-Z0-9_-]+)/i);
      if (projectRefMatch) {
        const candidate = projectRefMatch[1];
        if (!['Stateful', 'Stateless', 'Agentic', 'Agent', 'Workflow', 'The', 'This', 'My'].includes(candidate)) {
          specifiedProject = candidate;
        }
      }
    }

    // Try parseWorkflowSpecs (handles range patterns, named lists, etc.)
    workflows = parseWorkflowSpecs(request.prompt);

    // Try additional patterns (Order4-8 shorthand)
    if (workflows.length === 0) {
      const { workflows: additionalWorkflows, baseName } = parseAdditionalWorkflowSpecs(request.prompt);
      workflows = additionalWorkflows;
      workflowName = baseName;
    }

    // Try basic single workflow extraction
    if (workflows.length === 0) {
      const { name, type } = parseWorkflowRequest(request.prompt);
      if (name) {
        workflowName = name;
        if (type) {
          workflows = [{ name, type }];
        }
      }
    }
  }

  if (workflows.length === 0 && !workflowName) {
    writeChatMarkdown(
      stream,
      localize(
        'workflowNameRequired',
        'I need a name for the workflow. What would you like to call it?\n\nFor example: `@logicapps /createWorkflow OrderProcessing`'
      )
    );
    return {
      metadata: { command: ChatCommand.createWorkflow, needsParameter: 'workflowName' },
    };
  }

  // Find Logic App projects in the workspace
  const projects = await findLogicAppProjects();

  if (projects.length === 0) {
    writeChatMarkdown(
      stream,
      localize(
        'noLogicAppProjects',
        'No Logic App projects found in this workspace.\n\n' +
          'Please create a Logic App project first using `@logicapps /createProject` or the command palette.'
      )
    );
    return {
      metadata: { command: ChatCommand.createWorkflow, needsParameter: 'project' },
    };
  }

  // Try to match specified project name to a discovered project
  let targetProject: LogicAppProject | undefined;
  if (specifiedProject) {
    targetProject = projects.find((p) => p.name.toLowerCase() === specifiedProject!.toLowerCase());
  }

  // If no match and multiple projects, ask which one
  if (!targetProject && projects.length > 1) {
    const projectList = projects.map((p) => `- **${p.name}**`).join('\n');
    writeChatMarkdown(
      stream,
      localize('selectProject', `Multiple Logic App projects found. Which project should I add the workflow(s) to?\n\n${projectList}`)
    );
    return {
      metadata: {
        command: ChatCommand.createWorkflow,
        needsParameter: 'targetProject',
        pendingWorkflows: workflows,
      },
    };
  }

  // Single project or matched project
  if (!targetProject) {
    targetProject = projects[0];
  }
  const needsType = workflows.some((w) => w.type === undefined);
  if (needsType) {
    const workflowDesc = workflows.length === 1 ? workflowName || workflows[0]?.name : `${workflows[0]?.name}...`;
    writeChatMarkdown(
      stream,
      localize(
        'workflowTypeQuestion',
        `What type of workflow would you like to create for **${workflowDesc}**?\n\n- **Stateful**: Maintains state and run history (recommended for most scenarios)\n- **Stateless**: High-throughput, low-latency, no run history\n- **Agentic**: Autonomous AI agent workflow\n- **Agent**: Conversational AI agent workflow`
      )
    );
    return {
      metadata: {
        command: ChatCommand.createWorkflow,
        needsParameter: 'workflowType',
        pendingWorkflows: workflows,
        targetProject: targetProject.path,
      },
    };
  }

  // Single project with type specified - create workflows directly
  return await createWorkflowsInProject(targetProject, workflows, stream, token);
}

/**
 * Get the last chat result from context
 */
function getLastChatResult(context: vscode.ChatContext): LogicAppsChatResult | undefined {
  for (let i = context.history.length - 1; i >= 0; i--) {
    const item = context.history[i];
    if (item instanceof vscode.ChatResponseTurn && item.result) {
      return item.result as LogicAppsChatResult;
    }
  }
  return undefined;
}

/**
 * Handle user's response to project selection question
 */
async function handleProjectSelectionResponse(
  request: vscode.ChatRequest,
  lastResult: LogicAppsChatResult,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<LogicAppsChatResult> {
  const projects = await findLogicAppProjects();
  let targetProject: LogicAppProject | undefined;

  // Try LLM first to understand the response
  if (request.model) {
    const extracted = await extractConversationalResponse(request, lastResult, token);
    if (extracted?.targetProject) {
      targetProject = projects.find((p) => p.name.toLowerCase() === extracted.targetProject!.toLowerCase());
    }
  }

  // Fallback: explicit matching
  if (!targetProject) {
    const prompt = request.prompt.toLowerCase();
    for (const project of projects) {
      if (prompt.includes(project.name.toLowerCase())) {
        targetProject = project;
        break;
      }
    }
  }

  if (!targetProject) {
    const projectNames = projects.map((p) => p.name);
    writeChatMarkdown(
      stream,
      localize(
        'projectNotFound',
        `I couldn't find a project matching "${request.prompt}". Please specify one of these project names:\n\n${projectNames.map((n) => `- **${n}**`).join('\n')}`
      )
    );
    return {
      metadata: {
        command: ChatCommand.createWorkflow,
        needsParameter: 'targetProject',
        pendingWorkflows: lastResult.metadata.pendingWorkflows,
      },
    };
  }

  const workflows = lastResult.metadata.pendingWorkflows!;

  // Check if workflows need type specification
  const needsType = workflows.some((w) => w.type === undefined);
  if (needsType) {
    const baseName = workflows[0]?.name?.replace(/\d+$/, '') || 'workflows';
    const workflowDesc = workflows.length === 1 ? workflows[0].name : `${baseName}...`;
    writeChatMarkdown(
      stream,
      localize(
        'workflowTypeQuestion',
        `What type of workflow would you like to create for **${workflowDesc}**?\n\n- **Stateful**: Maintains state and run history (recommended for most scenarios)\n- **Stateless**: High-throughput, low-latency, no run history\n- **Agentic**: Autonomous AI agent workflow\n- **Agent**: Conversational AI agent workflow`
      )
    );
    return {
      metadata: {
        command: ChatCommand.createWorkflow,
        needsParameter: 'workflowType',
        pendingWorkflows: workflows,
        targetProject: targetProject.path,
      },
    };
  }

  return await createWorkflowsInProject(targetProject, workflows, stream, token);
}

/**
 * Handle user's response to workflow type question
 */
async function handleWorkflowTypeResponse(
  request: vscode.ChatRequest,
  lastResult: LogicAppsChatResult,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<LogicAppsChatResult> {
  let workflowType: WorkflowTypeOption | undefined;

  // Try LLM first to understand the response
  if (request.model) {
    const extracted = await extractConversationalResponse(request, lastResult, token);
    if (extracted?.workflowType) {
      workflowType = extracted.workflowType;
    }
  }

  // Fallback: explicit pattern matching
  if (!workflowType) {
    const prompt = request.prompt.toLowerCase();
    if (prompt.includes('stateless')) {
      workflowType = WorkflowTypeOption.stateless;
    } else if (prompt.includes('agentic') || prompt.includes('autonomous')) {
      workflowType = WorkflowTypeOption.agentic;
    } else if (prompt.includes('agent') || prompt.includes('conversational')) {
      workflowType = WorkflowTypeOption.agent;
    } else {
      workflowType = WorkflowTypeOption.stateful; // Default to stateful
    }
  }

  // Update workflows with the type
  const workflows: WorkflowSpec[] = lastResult.metadata.pendingWorkflows!.map((w) => ({
    name: w.name,
    type: workflowType!,
  }));

  // Check if we already have a target project
  if (lastResult.metadata.targetProject) {
    const targetProject: LogicAppProject = {
      name: path.basename(lastResult.metadata.targetProject),
      path: lastResult.metadata.targetProject,
    };
    return await createWorkflowsInProject(targetProject, workflows, stream, token);
  }

  // Find projects and check if we need to ask
  const projects = await findLogicAppProjects();

  if (projects.length === 0) {
    writeChatMarkdown(
      stream,
      localize(
        'noLogicAppProjects',
        'No Logic App projects found in this workspace.\n\n' + 'Please create a Logic App project first using `@logicapps /createProject`.'
      )
    );
    return {
      metadata: { command: ChatCommand.createWorkflow, needsParameter: 'project' },
    };
  }

  if (projects.length === 1) {
    return await createWorkflowsInProject(projects[0], workflows, stream, token);
  }

  // Multiple projects - ask which one
  const projectList = projects.map((p) => `- **${p.name}**`).join('\n');
  writeChatMarkdown(
    stream,
    localize('selectProject', `Multiple Logic App projects found. Which project should I add the workflow(s) to?\n\n${projectList}`)
  );
  return {
    metadata: {
      command: ChatCommand.createWorkflow,
      needsParameter: 'targetProject',
      pendingWorkflows: workflows,
    },
  };
}

/**
 * Create workflows in a specific project
 */
async function createWorkflowsInProject(
  project: LogicAppProject,
  workflows: WorkflowSpec[],
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<LogicAppsChatResult> {
  try {
    const workflowCount = workflows.length;
    const parallelMsg =
      workflowCount > 1 ? `I'll create all ${workflowCount} workflows concurrently since they're independent of each other.` : '';

    if (parallelMsg) {
      writeChatMarkdown(stream, `${parallelMsg}\n\n`);
    }

    stream.progress(localize('creatingWorkflows', `Preparing to create ${workflowCount} workflow(s) in "${project.name}"...`));

    // Check for existing workflow conflicts before creating
    const conflicting: string[] = [];
    const toCreate: WorkflowSpec[] = [];
    const requestedWorkflowNames = new Set<string>();
    for (const workflow of workflows) {
      const normalizedWorkflowName = workflow.name.toLowerCase();
      if (requestedWorkflowNames.has(normalizedWorkflowName)) {
        conflicting.push(workflow.name);
        continue;
      }
      requestedWorkflowNames.add(normalizedWorkflowName);

      const workflowDir = path.join(project.path, workflow.name);
      if (await fse.pathExists(workflowDir)) {
        conflicting.push(workflow.name);
      } else {
        toCreate.push(workflow);
      }
    }

    if (conflicting.length > 0 && toCreate.length === 0) {
      // All workflows already exist
      const conflictList = conflicting.map((n) => `- **${n}**`).join('\n');
      writeChatMarkdown(
        stream,
        localize(
          'allWorkflowsExist',
          `All specified workflows already exist in **"${project.name}"**:\n${conflictList}\n\nPlease choose different names.`
        )
      );
      return { metadata: { command: ChatCommand.createWorkflow, targetProject: project.path } };
    }

    if (conflicting.length > 0) {
      const conflictList = conflicting.map((n) => `**${n}**`).join(', ');
      writeChatMarkdown(
        stream,
        localize('someWorkflowsExist', `Skipping ${conflictList} (already exist). Creating the remaining workflows...\n\n`)
      );
    }

    stream.progress(localize('creatingWorkflows', `Creating ${toCreate.length} workflow(s) in "${project.name}"...`));

    // Create non-conflicting workflows
    const createdWorkflows: string[] = [];
    const failedWorkflows: string[] = [];
    let wasCancelled = false;

    const maxConcurrency = Math.min(4, Math.max(1, toCreate.length));
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (token.isCancellationRequested) {
          wasCancelled = true;
          return;
        }

        const index = nextIndex;
        nextIndex += 1;

        if (index >= toCreate.length) {
          return;
        }

        const workflow = toCreate[index];
        if (!workflow) {
          return;
        }

        try {
          stream.progress(localize('creatingSingleWorkflow', `Creating workflow "${workflow.name}"...`));
          const result = await createAdditionalWorkflow(project.path, workflow.name, workflow.type!);
          if (!result.success) {
            failedWorkflows.push(`- **${workflow.name}**: ${sanitizeWorkflowErrorMessage(result.error ?? result.message)}`);
            stream.progress(localize('failedSingleWorkflow', `Failed to create workflow "${workflow.name}".`));
            continue;
          }
          createdWorkflows.push(`- **${workflow.name}** (${workflow.type})`);
          stream.progress(localize('createdSingleWorkflow', `Created workflow "${workflow.name}".`));
        } catch (error) {
          const rawErrorMessage = error instanceof Error ? error.message : String(error);
          const errorMessage = sanitizeWorkflowErrorMessage(rawErrorMessage);
          failedWorkflows.push(`- **${workflow.name}**: ${errorMessage}`);
          stream.progress(localize('failedSingleWorkflow', `Failed to create workflow "${workflow.name}".`));
        }
      }
    };

    await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

    createdWorkflows.sort((a, b) => a.localeCompare(b));
    failedWorkflows.sort((a, b) => a.localeCompare(b));

    // Build response message
    let message = '';
    if (createdWorkflows.length > 0) {
      message += localize(
        'workflowsCreated',
        `Successfully created ${createdWorkflows.length} workflow(s) in **"${project.name}"**!\n\n` +
          `**Workflows created:**\n${createdWorkflows.join('\n')}\n\n`
      );
    }

    if (failedWorkflows.length > 0) {
      message += localize('workflowsFailed', `\n**Failed to create:**\n${failedWorkflows.join('\n')}\n`);
    }

    if (wasCancelled) {
      message += localize('workflowCreateCancelled', '\nWorkflow creation was cancelled before all requested workflows were processed.\n');
    }

    if (createdWorkflows.length > 0) {
      message += 'You can now open any workflow in the designer or run and debug your Logic App locally.';
    }

    writeChatMarkdown(stream, message);

    return {
      metadata: {
        command: ChatCommand.createWorkflow,
        workflowName: workflows[0]?.name,
        workflows,
        targetProject: project.path,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeChatMarkdown(stream, localize('workflowCreationError', `Failed to create workflows: ${errorMessage}`));
    return { metadata: { command: ChatCommand.createWorkflow } };
  }
}

function sanitizeWorkflowErrorMessage(error: string): string {
  if (!error) {
    return 'Unknown error';
  }

  const trimmed = error.trim();
  if (trimmed.length > 200) {
    return `${trimmed.slice(0, 197)}...`;
  }

  return trimmed;
}

/**
 * Handle /createProject command
 */
async function handleCreateProjectCommand(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  intent?: ParsedIntent
): Promise<LogicAppsChatResult> {
  stream.progress(localize('analyzingProjectRequest', 'Analyzing your project request...'));

  // Check if user is responding to a previous question
  const lastResult = getLastChatResult(context);
  let projectName = lastResult?.metadata?.projectName;
  let finalWorkflows: WorkflowSpec[] | undefined = lastResult?.metadata?.workflows;
  let includeCustomCode = lastResult?.metadata?.includeCustomCode ?? false;
  let projectType: ProjectTypeOption = lastResult?.metadata?.projectType ?? ProjectTypeOption.logicApp;
  let targetFramework: TargetFrameworkOption | undefined = lastResult?.metadata?.targetFramework;
  let functionName: string | undefined = lastResult?.metadata?.functionName;
  let functionNamespace: string | undefined = lastResult?.metadata?.functionNamespace;

  // If we're waiting for a parameter, use LLM to understand the conversational response
  if (lastResult?.metadata?.needsParameter && request.model) {
    const extracted = await extractConversationalResponse(request, lastResult, token);

    if (extracted) {
      if (extracted.projectName) {
        projectName = extracted.projectName;
      }
      if (extracted.workflows) {
        finalWorkflows = extracted.workflows;
      }
      if (extracted.confirmed && lastResult.metadata.needsParameter === 'projectName' && !projectName) {
        projectName = 'MyLogicApp'; // Default when user confirms without providing name
      }
    }
  }

  // Use pre-parsed intent data if available (from parseIntent LLM call)
  if (intent && !projectName) {
    projectName = intent.projectName;
  }
  if (intent?.workflows && (!finalWorkflows || finalWorkflows.length === 0)) {
    finalWorkflows = intent.workflows;
  }
  if (intent?.includeCustomCode) {
    includeCustomCode = true;
  }
  if (intent?.projectType) {
    projectType = intent.projectType;
    if (projectType === ProjectTypeOption.logicAppCustomCode || projectType === ProjectTypeOption.rulesEngine) {
      includeCustomCode = true;
    }
  }
  if (intent?.targetFramework) {
    targetFramework = intent.targetFramework;
  }
  if (intent?.functionName) {
    functionName = intent.functionName;
  }
  if (intent?.functionNamespace) {
    functionNamespace = intent.functionNamespace;
  }

  // Fallback: Parse the user's prompt explicitly if LLM didn't extract
  if (!projectName || !finalWorkflows) {
    const parsed = parseProjectRequest(request.prompt);
    if (parsed.name && !projectName) {
      projectName = parsed.name;
    }
    if (parsed.workflows && parsed.workflows.length > 0 && !finalWorkflows) {
      finalWorkflows = parsed.workflows;
    }
    if (parsed.includeCustomCode) {
      includeCustomCode = parsed.includeCustomCode;
    }
    if (parsed.type) {
      projectType = parsed.type;
    }
  }

  // Final fallback: Handle simple confirmation responses
  if (!projectName && lastResult?.metadata?.needsParameter === 'projectName') {
    if (isConfirmationResponse(request.prompt)) {
      projectName = 'MyLogicApp';
    }
  }

  if (!projectName) {
    writeChatMarkdown(
      stream,
      localize(
        'projectNameRequired',
        'I need a name for the project. What would you like to call it?\n\nFor example: `@logicapps /createProject MyLogicApp`'
      )
    );
    return {
      metadata: {
        command: ChatCommand.createProject,
        needsParameter: 'projectName',
        // Preserve workflows parsed from original prompt so we don't ask again
        workflows: finalWorkflows,
        includeCustomCode,
        projectType,
        targetFramework,
        functionName,
        functionNamespace,
      },
    };
  }

  // Handle "default" response for workflows
  if (lastResult?.metadata?.needsParameter === 'workflows' && request.prompt.toLowerCase().includes('default')) {
    finalWorkflows = [{ name: 'Workflow1', type: WorkflowTypeOption.stateful }];
  }

  // Handle workflow type confirmation response
  if (lastResult?.metadata?.needsParameter === 'workflowType' && finalWorkflows) {
    const lowerResponse = request.prompt.toLowerCase().trim();
    let selectedType: WorkflowTypeOption | undefined;

    if (lowerResponse.includes('stateful')) {
      selectedType = WorkflowTypeOption.stateful;
    } else if (lowerResponse.includes('stateless')) {
      selectedType = WorkflowTypeOption.stateless;
    } else if (lowerResponse.includes('agentic')) {
      selectedType = WorkflowTypeOption.agentic;
    } else if (lowerResponse.includes('agent')) {
      selectedType = WorkflowTypeOption.agent;
    }

    if (selectedType) {
      finalWorkflows = finalWorkflows.map((w) => ({
        ...w,
        type: w.type ?? selectedType,
      }));
    }
  }

  // If no workflows specified, ask the user what workflows they want
  if (!finalWorkflows || finalWorkflows.length === 0) {
    writeChatMarkdown(
      stream,
      localize(
        'workflowsQuestion',
        `What workflows would you like to create for **${projectName}**?\n\nYou can specify:\n- A single workflow: "a stateful workflow called OrderProcessing"\n- Multiple workflows: "5 stateful workflows from Workflow1 to Workflow5"\n- Named list: "stateful workflows: OrderProcessing, PaymentHandler, NotificationService"\n- Mixed types: "3 stateful workflows called Order and 2 agentic workflows called Agent"\n\nOr just say "default" to create a single stateful workflow.`
      )
    );
    return {
      metadata: { command: ChatCommand.createProject, projectName, needsParameter: 'workflows' },
    };
  }

  // Check if any workflows are missing a type — ask user to confirm
  const workflowsMissingType = finalWorkflows.some((w) => !w.type);
  if (workflowsMissingType) {
    const workflowNames = finalWorkflows.map((w) => `**${w.name}**`).join(', ');
    writeChatMarkdown(
      stream,
      localize(
        'workflowTypeQuestion',
        `What type should the workflow(s) ${workflowNames} be?\n\n- **Stateful** – Persists run history, supports retries and long-running operations\n- **Stateless** – Lightweight, high-throughput, no run history persistence\n- **Agentic** – AI-powered with agent capabilities\n`
      )
    );
    return {
      metadata: {
        command: ChatCommand.createProject,
        projectName,
        workflows: finalWorkflows,
        includeCustomCode,
        projectType,
        targetFramework,
        functionName,
        functionNamespace,
        needsParameter: 'workflowType',
      },
    };
  }

  // Directly create the project
  try {
    // For custom code projects: collect target framework if not specified
    if (projectType === ProjectTypeOption.logicAppCustomCode && !targetFramework) {
      // Handle response to targetFramework question
      if (lastResult?.metadata?.needsParameter === 'targetFramework') {
        const lowerResponse = request.prompt.toLowerCase().trim();
        if (lowerResponse.includes('472') || lowerResponse.includes('framework') || lowerResponse.includes('netfx')) {
          targetFramework = TargetFrameworkOption.netFx;
        } else {
          targetFramework = TargetFrameworkOption.net8; // Default to .NET 8
        }
      } else {
        writeChatMarkdown(
          stream,
          localize(
            'targetFrameworkQuestion',
            `Which .NET version would you like for the custom code project **${projectName}**?\n\n- **.NET 8** (recommended) – Latest cross-platform runtime\n- **.NET Framework (net472)** – Windows-only, legacy support\n\nOr just say "default" for .NET 8.`
          )
        );
        return {
          metadata: {
            command: ChatCommand.createProject,
            projectName,
            workflows: finalWorkflows,
            includeCustomCode,
            projectType,
            functionName,
            functionNamespace,
            needsParameter: 'targetFramework',
          },
        };
      }
    }

    // Default target framework
    if (!targetFramework) {
      targetFramework = TargetFrameworkOption.net8;
    }

    // For custom code / rules engine: default function name and namespace if not provided
    const isCustomCodeOrRules = projectType === ProjectTypeOption.logicAppCustomCode || projectType === ProjectTypeOption.rulesEngine;
    if (isCustomCodeOrRules) {
      if (!functionName) {
        functionName = `${projectName}Functions`;
      }
      if (!functionNamespace) {
        functionNamespace = `${projectName}.Functions`;
      }
    }

    stream.progress(localize('creatingProject', `Creating project "${projectName}" with ${finalWorkflows.length} workflow(s)...`));

    // Check if we're in a workspace - required for project creation
    if (!vscode.workspace.workspaceFile) {
      // Not in a workspace, need to create one first
      writeChatMarkdown(
        stream,
        localize(
          'needsWorkspace',
          `To create a Logic App project, you need to be in a Logic Apps workspace first.\n\nI'll open the workspace creation wizard for you. After creating the workspace, ask me again to create the "${projectName}" project.`
        )
      );
      await vscode.commands.executeCommand(extensionCommand.createWorkspace);
      return {
        metadata: { command: ChatCommand.createProject, projectName, workflows: finalWorkflows },
      };
    }

    // Determine project type
    const finalProjectType =
      projectType === ProjectTypeOption.rulesEngine
        ? ProjectType.rulesEngine
        : includeCustomCode || projectType === ProjectTypeOption.logicAppCustomCode
          ? ProjectType.customCode
          : ProjectType.logicApp;

    // Use the first workflow for the initial project creation
    const firstWorkflow = finalWorkflows[0];

    // Build the function folder name for custom code / rules engine
    const functionFolderName = isCustomCodeOrRules ? functionName : undefined;

    const createProjectResult = await createProjectFromToolInput({
      projectName,
      projectType,
      workflowName: firstWorkflow.name,
      workflowType: firstWorkflow.type ?? WorkflowTypeOption.stateful,
      includeCustomCode: finalProjectType === ProjectType.customCode,
      targetFramework,
      functionName: functionFolderName,
      functionNamespace,
    });

    if (!createProjectResult.success) {
      if (createProjectResult.code === 'projectExists' && createProjectResult.projectPath) {
        writeChatMarkdown(
          stream,
          localize('projectExistsAddingWorkflows', `Project **"${projectName}"** already exists. Adding workflow(s) to it...`)
        );
        const existingProject: LogicAppProject = { name: projectName, path: createProjectResult.projectPath };
        return await createWorkflowsInProject(existingProject, finalWorkflows, stream, token);
      }

      writeChatMarkdown(stream, createProjectResult.message);
      return {
        metadata: { command: ChatCommand.createProject, projectName },
      };
    }

    if (!createProjectResult.projectPath) {
      throw new Error('Project creation completed without returning the project path.');
    }

    const logicAppFolderPath = createProjectResult.projectPath;

    // Create additional workflows if specified
    if (finalWorkflows.length > 1) {
      stream.progress(localize('creatingAdditionalWorkflows', 'Creating additional workflows...'));

      for (let i = 1; i < finalWorkflows.length; i++) {
        const workflow = finalWorkflows[i];
        const result = await createAdditionalWorkflow(logicAppFolderPath, workflow.name, workflow.type ?? WorkflowTypeOption.stateful);
        if (!result.success) {
          throw new Error(result.message);
        }
      }
    }

    // Build workflow list for the success message
    const workflowListItems = finalWorkflows.map((w) => `- **${w.name}** (${w.type})`).join('\n');

    // Build project-type-specific details for the success message
    let projectIncludes =
      '**Project includes:**\n' + '- Configuration files (host.json, local.settings.json)\n' + '- VS Code settings for debugging\n';

    if (finalProjectType === ProjectType.customCode) {
      projectIncludes +=
        `- Custom code function project (**${functionName}**) with .NET ${targetFramework === TargetFrameworkOption.netFx ? 'Framework (net472)' : '8'}\n` +
        `- Namespace: **${functionNamespace}**\n`;
    } else if (finalProjectType === ProjectType.rulesEngine) {
      projectIncludes += `- Rules engine function project (**${functionName}**)\n- Sample rule set and schema files\n- Namespace: **${functionNamespace}**\n`;
    }

    writeChatMarkdown(
      stream,
      localize(
        'projectCreatedWithWorkflows',
        `Successfully created Logic App project **"${projectName}"** with ${finalWorkflows.length} workflow(s)!\n\n**Workflows created:**\n${workflowListItems}\n\n${projectIncludes}\nYou can now:\n- Open any workflow in the designer\n- Create additional workflows with \`@logicapps /createWorkflow\`\n- Run and debug your Logic App locally`
      )
    );

    return {
      metadata: { command: ChatCommand.createProject, projectName, workflows: finalWorkflows },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeChatMarkdown(stream, localize('projectCreationError', `Failed to create project: ${errorMessage}`));
    return { metadata: { command: ChatCommand.createProject } };
  }
}

/**
 * Create an additional workflow in an existing Logic App project using the same
 * product scaffolding path as the VS Code Create Workflow command.
 */
async function createAdditionalWorkflow(
  logicAppFolderPath: string,
  workflowName: string,
  workflowType: WorkflowTypeOption
): ReturnType<typeof createWorkflowInProject> {
  return createWorkflowInProject(logicAppFolderPath, workflowName, workflowType);
}

/**
 * Handle /modifyAction command
 */
async function handleModifyActionCommand(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  intent?: ParsedIntent
): Promise<LogicAppsChatResult> {
  stream.progress(localize('analyzingModification', 'Analyzing your modification request...'));

  const lastResult = getLastChatResult(context);
  if (lastResult?.metadata?.command === ChatCommand.modifyAction && lastResult.metadata.pendingDuplicateAddAction) {
    const duplicateChoice = getDuplicateActionChoice(request.prompt);
    if (!duplicateChoice) {
      writeChatMarkdown(
        stream,
        localize(
          'duplicateActionChoiceRequired',
          `An action or trigger named "${lastResult.metadata.pendingDuplicateAddAction.actionName}" already exists. Reply with "replace" to update it, or "add separate" to create a separate action with a unique name.`
        )
      );
      return {
        metadata: {
          command: ChatCommand.modifyAction,
          pendingDuplicateAddAction: lastResult.metadata.pendingDuplicateAddAction,
        },
      };
    }

    const addActionInput: AddActionParams = {
      ...lastResult.metadata.pendingDuplicateAddAction,
      duplicateActionBehavior: duplicateChoice,
    };
    const result = await vscode.lm.invokeTool(
      ToolName.addAction,
      { input: addActionInput, toolInvocationToken: request.toolInvocationToken },
      token
    );
    for (const content of result.content) {
      if (content instanceof vscode.LanguageModelTextPart) {
        writeChatMarkdown(stream, content.value);
      }
    }
    return { metadata: { command: ChatCommand.modifyAction } };
  }

  const pendingModificationPrompt =
    lastResult?.metadata?.pendingModificationPrompt && lastResult.metadata.command === ChatCommand.modifyAction
      ? lastResult.metadata.pendingModificationPrompt
      : request.prompt;

  let effectivePrompt = pendingModificationPrompt;
  let forcedProjectName: string | undefined;

  if (lastResult?.metadata?.needsParameter === 'targetProject' && lastResult.metadata.command === ChatCommand.modifyAction) {
    const pendingProjectNames = lastResult.metadata.pendingProjectNames ?? [];
    const selectedProjectName = resolveSelectedProjectName(request.prompt, pendingProjectNames);

    if (pendingProjectNames.length > 0 && !selectedProjectName) {
      const projectOptions = pendingProjectNames.map((name) => `- ${name}`).join('\n');
      writeChatMarkdown(
        stream,
        localize(
          'projectSelectionRequiredForModify',
          `I couldn't match "${request.prompt}" to a project. Please choose one of these projects:\n${projectOptions}`
        )
      );
      return {
        metadata: {
          command: ChatCommand.modifyAction,
          needsParameter: 'targetProject',
          pendingModificationPrompt,
          pendingProjectNames,
        },
      };
    }

    const projectNameFromReply = selectedProjectName ?? request.prompt.replace(/^\s*@logicapps\s*/i, '').trim();
    forcedProjectName = projectNameFromReply;
    effectivePrompt = `${pendingModificationPrompt}\nProject name: ${projectNameFromReply}`;
  }

  if (!forcedProjectName) {
    forcedProjectName = intent?.targetProject?.trim() || extractTargetProjectFromPrompt(pendingModificationPrompt);
  }

  if (forcedProjectName) {
    const projects = await findLogicAppProjects();
    const matchingProject = projects.find((project) => project.name.toLowerCase() === forcedProjectName!.toLowerCase());
    if (matchingProject) {
      forcedProjectName = matchingProject.name;
    } else {
      forcedProjectName = undefined;
    }
  }

  if (forcedProjectName && !/project name\s*:/i.test(effectivePrompt)) {
    effectivePrompt = `${effectivePrompt}\nProject name: ${forcedProjectName}`;
  }

  if (!request.model) {
    writeChatMarkdown(stream, localize('modelUnavailableForModify', 'A language model is required to modify workflow actions from chat.'));
    return { metadata: { command: ChatCommand.modifyAction } };
  }

  try {
    const tools = vscode.lm.tools.filter(
      (tool) => tool.name.startsWith('logicapps_') && tool.name !== ToolName.createProject && tool.name !== ToolName.createWorkflow
    );

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(buildModifyActionOrchestrationPrompt(effectivePrompt)),
    ];

    const requiresCompleteWeatherWorkflow = isFullWeatherWorkflowRequest(effectivePrompt);
    const orchestrationResult = await runToolOrchestration(request, stream, token, tools, messages, {
      forcedProjectName,
      requireMutation: true,
      maxIterations: requiresCompleteWeatherWorkflow ? 6 : undefined,
      minMutationCount: requiresCompleteWeatherWorkflow ? 3 : undefined,
      mutationNudge: requiresCompleteWeatherWorkflow
        ? 'The user asked for a complete HTTP request → current weather → Response workflow. Continue by calling logicapps_addAction for any missing step: a Request trigger, the msnweather current-weather action with the user-provided Location, and a Response action whose body references the weather action output and whose runAfter chains after that weather action.'
        : 'You have inspected the workflow. Now apply the requested modification by calling logicapps_modifyAction or logicapps_addAction with concrete parameters.',
    });

    let projectNames = extractProjectNamesFromAmbiguityResponse(orchestrationResult.toolResponseText);
    const needsProjectDisambiguation =
      orchestrationResult.requestedProjectDisambiguation || /please specify projectname/i.test(orchestrationResult.toolResponseText);

    if (orchestrationResult.duplicateAddActionInput) {
      return {
        metadata: {
          command: ChatCommand.modifyAction,
          pendingDuplicateAddAction: orchestrationResult.duplicateAddActionInput,
        },
      };
    }

    if (needsProjectDisambiguation && projectNames.length === 0) {
      const projects = await findLogicAppProjects();
      projectNames = projects.map((project) => project.name);
    }

    if (needsProjectDisambiguation) {
      return {
        metadata: {
          command: ChatCommand.modifyAction,
          needsParameter: 'targetProject',
          pendingModificationPrompt,
          pendingProjectNames: projectNames,
        },
      };
    }

    if (requiresCompleteWeatherWorkflow) {
      await ensureFullWeatherWorkflowResponse(request, stream, token, effectivePrompt, forcedProjectName);
    }

    return {
      metadata: { command: ChatCommand.modifyAction },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeChatMarkdown(stream, localize('modificationError', `Failed to modify action: ${errorMessage}`));
    return { metadata: { command: ChatCommand.modifyAction } };
  }
}

/**
 * Handle /help command
 */
async function handleHelpCommand(stream: vscode.ChatResponseStream): Promise<LogicAppsChatResult> {
  writeChatMarkdown(
    stream,
    `# Azure Logic Apps Assistant

I can help you create and manage Logic Apps workflows and projects. Here's what I can do:

## Commands

- **\`/createProject\`** - Create a new Logic App project
  - Example: \`/createProject MyLogicApp\`
  - Example: \`/createProject OrderProcessor with custom code support\`

- **\`/createWorkflow\`** - Create a new workflow in your project
  - Example: \`/createWorkflow OrderProcessing\`
  - Example: \`/createWorkflow a stateless workflow called HighThroughputAPI\`

- **\`/modifyAction\`** - Modify an action in an existing workflow
  - Example: \`/modifyAction change the timeout on SendEmail action to 5 minutes\`

- **\`/help\`** - Show this help message

## Workflow Types

- **Stateful** - Maintains state and run history (recommended for most scenarios)
- **Stateless** - High-throughput, low-latency, no run history
- **Agentic** - Autonomous AI agent workflows
- **Agent** - Conversational AI agent workflows

## Tips

- I can understand natural language, so feel free to describe what you want to create
- If I need more information, I'll ask you follow-up questions
- You can always open workflows in the designer for visual editing
`
  );

  return { metadata: { command: ChatCommand.help } };
}

/**
 * Handle general chat requests
 */
async function handleGeneralRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<LogicAppsChatResult> {
  // Check if a language model is available
  if (!request.model) {
    writeChatMarkdown(
      stream,
      localize(
        'modelUnavailable',
        'I can help you with Logic Apps! Here are some things you can do:\n\n' +
          '- **Create a project**: `@logicapps /createProject MyProjectName`\n' +
          '- **Create a workflow**: `@logicapps /createWorkflow MyWorkflowName`\n' +
          '- **Get help**: `@logicapps /help`\n\n' +
          'For more advanced assistance, please ensure GitHub Copilot is enabled.'
      )
    );
    return { metadata: {} };
  }

  try {
    const tools = vscode.lm.tools.filter(
      (tool) =>
        tool.name.startsWith('logicapps_') &&
        // Exclude project/workflow creation tools — these are handled by explicit routing
        tool.name !== ToolName.createProject &&
        tool.name !== ToolName.createWorkflow
    );
    const messages: vscode.LanguageModelChatMessage[] = [vscode.LanguageModelChatMessage.User(`${SYSTEM_PROMPT}\n${RESPONSE_GUARDRAILS}`)];

    // Add relevant history
    for (const historyItem of context.history) {
      if (historyItem instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(historyItem.prompt));
      } else if (historyItem instanceof vscode.ChatResponseTurn) {
        const responseText = historyItem.response
          .map((part) => {
            if (part instanceof vscode.ChatResponseMarkdownPart) {
              return part.value.value;
            }
            return '';
          })
          .join('');
        messages.push(vscode.LanguageModelChatMessage.Assistant(responseText));
      }
    }

    // Add current request
    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    await runToolOrchestration(request, stream, token, tools, messages);

    return { metadata: {} };
  } catch (error) {
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === vscode.LanguageModelError.NotFound.name) {
        writeChatMarkdown(
          stream,
          localize('modelNotFound', 'The language model is not available. Please ensure you have GitHub Copilot installed and activated.')
        );
      } else if (error.code === vscode.LanguageModelError.Blocked.name) {
        writeChatMarkdown(stream, localize('requestBlocked', 'The request was blocked. Please try rephrasing your question.'));
      } else {
        writeChatMarkdown(stream, localize('languageModelError', `Language model error: ${error.message}`));
      }
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      writeChatMarkdown(stream, localize('generalError', `An error occurred: ${errorMessage}`));
    }

    return { metadata: {} };
  }
}

/**
 * Parse workflow creation request to extract name and type
 * @internal Exported for testing
 */
export function parseWorkflowRequest(prompt: string): { name?: string; type?: WorkflowTypeOption } {
  let name: string | undefined;
  let type: WorkflowTypeOption | undefined;

  // Extract workflow type from prompt
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('stateless')) {
    type = WorkflowTypeOption.stateless;
  } else if (lowerPrompt.includes('agentic') || lowerPrompt.includes('autonomous')) {
    type = WorkflowTypeOption.agentic;
  } else if (lowerPrompt.includes('agent') || lowerPrompt.includes('conversational')) {
    type = WorkflowTypeOption.agent;
  } else if (lowerPrompt.includes('stateful')) {
    type = WorkflowTypeOption.stateful;
  }

  // Extract workflow name - look for quoted names or capitalized words
  const quotedMatch = prompt.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    name = quotedMatch[1];
  } else {
    // Look for "called X" or "named X" with a capitalized name (at least 3 chars)
    const namedMatch = prompt.match(/(?:called|named)\s+([A-Z][a-zA-Z0-9_-]{2,})/);
    if (namedMatch) {
      name = namedMatch[1];
    } else {
      // Try to find any PascalCase word that could be a name (at least 3 chars)
      const words = prompt.split(/\s+/);
      for (const word of words) {
        if (/^[A-Z][a-zA-Z0-9_-]+$/.test(word) && word.length > 2) {
          // Skip common words
          if (!['Stateful', 'Stateless', 'Agentic', 'Agent', 'Workflow', 'Logic', 'App', 'Create'].includes(word)) {
            name = word;
            break;
          }
        }
      }
    }
  }

  return { name, type };
}

/**
 * Parse project creation request to extract name, type, and workflow specifications
 * @internal Exported for testing
 */
export function parseProjectRequest(prompt: string): {
  name?: string;
  type?: ProjectTypeOption;
  includeCustomCode?: boolean;
  workflows?: WorkflowSpec[];
} {
  let name: string | undefined;
  let type: ProjectTypeOption = ProjectTypeOption.logicApp;
  let includeCustomCode = false;

  const lowerPrompt = prompt.toLowerCase();

  // Check for rules engine project
  if (lowerPrompt.includes('rules engine') || lowerPrompt.includes('rule engine') || lowerPrompt.includes('business rules')) {
    type = ProjectTypeOption.rulesEngine;
    includeCustomCode = true;
  }
  // Check for custom code support
  else if (
    lowerPrompt.includes('custom code') ||
    lowerPrompt.includes('functions') ||
    lowerPrompt.includes('c#') ||
    lowerPrompt.includes('dotnet')
  ) {
    type = ProjectTypeOption.logicAppCustomCode;
    includeCustomCode = true;
  }

  // Extract project name - look for quoted names or capitalized words
  const quotedMatch = prompt.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    name = quotedMatch[1];
  } else {
    // Look for "name it X", "call it X" patterns first (handles "Name it MyLogicApp")
    const nameItMatch = prompt.match(/(?:name|call)\s+it\s+([A-Z][a-zA-Z0-9_-]{2,})/i);
    if (nameItMatch) {
      name = nameItMatch[1];
    } else {
      // Look for "called X" or "named X" with a capitalized name (at least 3 chars)
      const namedMatch = prompt.match(/(?:called|named)\s+([A-Z][a-zA-Z0-9_-]{2,})/);
      if (namedMatch) {
        name = namedMatch[1];
      } else {
        // Try to find any PascalCase word that could be a name (at least 3 chars)
        const words = prompt.split(/\s+/);
        for (const word of words) {
          if (/^[A-Z][a-zA-Z0-9_-]+$/.test(word) && word.length > 2) {
            // Skip common words
            if (!['Logic', 'App', 'Project', 'Custom', 'Code', 'Functions', 'Create', 'Name', 'Call', 'New'].includes(word)) {
              name = word;
              break;
            }
          }
        }
      }
    }
  }

  // Parse workflow specifications
  const workflows = parseWorkflowSpecs(prompt);

  return { name, type, includeCustomCode, workflows };
}

/**
 * Parse workflow specifications from a prompt
 * Supports patterns like:
 * - "a stateful workflow called OrderProcessing"
 * - "5 stateful workflows from Stateful1 to Stateful5"
 * - "3 stateful workflows called Order and 2 agentic workflows called Agent"
 * @internal Exported for testing
 */
export function parseWorkflowSpecs(prompt: string): WorkflowSpec[] {
  const workflows: WorkflowSpec[] = [];

  // Pattern 1a: "N <type> workflows from X1 to XN" (e.g., "5 stateful workflows from Stateful1 to Stateful5")
  // Allows extra words between "workflows" and "from" (e.g., "under ProjectName")
  const rangePattern =
    /(\d+)\s+(stateful|stateless|agentic|agent)\s+workflows?\s+(?:[\w\s]*?)from\s+([A-Za-z][A-Za-z0-9_-]*?)(\d+)\s+to\s+\3(\d+)/gi;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangePattern.exec(prompt)) !== null) {
    const count = Number.parseInt(rangeMatch[1], 10);
    const workflowType = mapWorkflowType(rangeMatch[2]);
    const baseName = rangeMatch[3];
    const startNum = Number.parseInt(rangeMatch[4], 10);
    const endNum = Number.parseInt(rangeMatch[5], 10);

    for (let i = startNum; i <= endNum && i - startNum < count; i++) {
      const workflowName = `${baseName}${i}`;
      if (!workflows.some((w) => w.name === workflowName)) {
        workflows.push({ name: workflowName, type: workflowType });
      }
    }
  }

  // If range pattern matched, return early to avoid double-matching
  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 1b: "N <type> workflows from X1-N" shorthand (e.g., "5 stateful workflows from Stateful1-5")
  // Allows extra words between "workflows" and "from"
  const rangeShortPattern2 =
    /(\d+)\s+(stateful|stateless|agentic|agent)\s+workflows?\s+(?:[\w\s]*?)from\s+([A-Za-z][A-Za-z0-9_-]*?)(\d+)-(\d+)/gi;
  let rangeShortMatch2: RegExpExecArray | null;
  while ((rangeShortMatch2 = rangeShortPattern2.exec(prompt)) !== null) {
    const workflowType = mapWorkflowType(rangeShortMatch2[2]);
    const baseName = rangeShortMatch2[3];
    const startNum = Number.parseInt(rangeShortMatch2[4], 10);
    const endNum = Number.parseInt(rangeShortMatch2[5], 10);

    for (let i = startNum; i <= endNum; i++) {
      const workflowName = `${baseName}${i}`;
      if (!workflows.some((w) => w.name === workflowName)) {
        workflows.push({ name: workflowName, type: workflowType });
      }
    }
  }

  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 1c: "N workflows from X1-N" without type (e.g., "5 workflows from Stateful1-5")
  // Allows extra words between "workflows" and "from"
  const rangeNoTypePattern = /(\d+)\s+workflows?\s+(?:[\w\s]*?)from\s+([A-Za-z][A-Za-z0-9_-]*?)(\d+)-(\d+)/gi;
  let rangeNoTypeMatch: RegExpExecArray | null;
  while ((rangeNoTypeMatch = rangeNoTypePattern.exec(prompt)) !== null) {
    const baseName = rangeNoTypeMatch[2];
    const startNum = Number.parseInt(rangeNoTypeMatch[3], 10);
    const endNum = Number.parseInt(rangeNoTypeMatch[4], 10);

    for (let i = startNum; i <= endNum; i++) {
      const workflowName = `${baseName}${i}`;
      if (!workflows.some((w) => w.name === workflowName)) {
        workflows.push({ name: workflowName });
      }
    }
  }

  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 2: "N <type> workflows called X" (e.g., "3 stateful workflows called Order")
  // This pattern handles multiple instances like "3 stateful called Order and 2 agentic called Agent"
  const countNamePattern = /(\d+)\s+(stateful|stateless|agentic|agent)\s+workflows?\s+(?:called|named)\s+([A-Za-z][A-Za-z0-9_-]*)/gi;
  let countMatch: RegExpExecArray | null;
  while ((countMatch = countNamePattern.exec(prompt)) !== null) {
    const count = Number.parseInt(countMatch[1], 10);
    const workflowType = mapWorkflowType(countMatch[2]);
    const baseName = countMatch[3];

    for (let i = 1; i <= count; i++) {
      const workflowName = count > 1 ? `${baseName}${i}` : baseName;
      if (!workflows.some((w) => w.name === workflowName)) {
        workflows.push({ name: workflowName, type: workflowType });
      }
    }
  }

  // If count pattern matched, return (don't early return, allow multiple matches above)
  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 2b: "N workflows called X" (no type specified → type left undefined for confirmation)
  const countNoTypePattern = /(\d+)\s+workflows?\s+(?:called|named)\s+([A-Za-z][A-Za-z0-9_-]*)/gi;
  let countNoTypeMatch: RegExpExecArray | null;
  while ((countNoTypeMatch = countNoTypePattern.exec(prompt)) !== null) {
    const count = Number.parseInt(countNoTypeMatch[1], 10);
    const baseName = countNoTypeMatch[2];

    for (let i = 1; i <= count; i++) {
      const workflowName = count > 1 ? `${baseName}${i}` : baseName;
      if (!workflows.some((w) => w.name === workflowName)) {
        workflows.push({ name: workflowName });
      }
    }
  }

  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 3: "a <type> workflow called X" (single workflow with explicit type)
  const singlePattern = /(?:a|an|one)\s+(stateful|stateless|agentic|agent)\s+workflow\s+(?:called|named)\s+([A-Za-z][A-Za-z0-9_-]+)/gi;
  let singleMatch: RegExpExecArray | null;
  while ((singleMatch = singlePattern.exec(prompt)) !== null) {
    const workflowType = mapWorkflowType(singleMatch[1]);
    const workflowName = singleMatch[2];

    if (!workflows.some((w) => w.name === workflowName)) {
      workflows.push({ name: workflowName, type: workflowType });
    }
  }

  // If single pattern matched, return
  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 3b: "a workflow called X" (single workflow, no type specified → type left undefined for confirmation)
  const singleNoTypePattern = /(?:a|an|one)\s+workflow\s+(?:called|named)\s+([A-Za-z][A-Za-z0-9_-]+)/gi;
  let singleNoTypeMatch: RegExpExecArray | null;
  while ((singleNoTypeMatch = singleNoTypePattern.exec(prompt)) !== null) {
    const workflowName = singleNoTypeMatch[1];

    if (!workflows.some((w) => w.name === workflowName)) {
      workflows.push({ name: workflowName });
    }
  }

  // If no-type pattern matched, return
  if (workflows.length > 0) {
    return workflows;
  }

  // Pattern 4: Simple workflow specification like "with a stateful workflow"
  const simplePattern = /(?:with\s+)?(?:a|an|one)\s+(stateful|stateless|agentic|agent)\s+workflow(?!\s+(?:called|named))/gi;
  const simpleMatch = simplePattern.exec(prompt);
  if (simpleMatch) {
    const workflowType = mapWorkflowType(simpleMatch[1]);
    workflows.push({ name: 'Workflow1', type: workflowType });
  }

  return workflows;
}

/**
 * Map workflow type string to WorkflowTypeOption
 */
function mapWorkflowType(typeStr: string): WorkflowTypeOption {
  const lower = typeStr.toLowerCase();
  if (lower === 'stateless') {
    return WorkflowTypeOption.stateless;
  }
  if (lower === 'agentic') {
    return WorkflowTypeOption.agentic;
  }
  if (lower === 'agent') {
    return WorkflowTypeOption.agent;
  }
  return WorkflowTypeOption.stateful;
}

/**
 * Map LLM-extracted type string to WorkflowTypeOption
 * Returns undefined if type wasn't specified so we know to ask
 * @internal Exported for testing
 */
export function mapExtractedType(typeStr: string | undefined): WorkflowTypeOption | undefined {
  if (!typeStr) {
    return undefined;
  }
  const lower = typeStr.toLowerCase();
  if (lower === 'stateless') {
    return WorkflowTypeOption.stateless;
  }
  if (lower === 'agentic') {
    return WorkflowTypeOption.agentic;
  }
  if (lower === 'agent') {
    return WorkflowTypeOption.agent;
  }
  if (lower === 'stateful') {
    return WorkflowTypeOption.stateful;
  }
  return undefined; // Unknown type - will need to ask
}

/**
 * Map LLM-extracted project type string to ProjectTypeOption
 * @internal Exported for testing
 */
export function mapParsedProjectType(typeStr: string | undefined): ProjectTypeOption | undefined {
  if (!typeStr) {
    return undefined;
  }
  const lower = typeStr.toLowerCase();
  if (lower === 'rulesengine' || lower === 'rules engine' || lower === 'rules') {
    return ProjectTypeOption.rulesEngine;
  }
  if (lower === 'logicappcustomcode' || lower === 'customcode' || lower === 'custom code') {
    return ProjectTypeOption.logicAppCustomCode;
  }
  if (lower === 'logicapp' || lower === 'logic app') {
    return ProjectTypeOption.logicApp;
  }
  return undefined;
}

/**
 * Map LLM-extracted target framework string to TargetFrameworkOption
 * @internal Exported for testing
 */
export function mapParsedTargetFramework(framework: string | undefined): TargetFrameworkOption | undefined {
  if (!framework) {
    return undefined;
  }
  const lower = framework.toLowerCase();
  if (lower === 'net472' || lower === 'netfx' || lower === 'net framework' || lower === '.net framework') {
    return TargetFrameworkOption.netFx;
  }
  if (lower === 'net8' || lower === 'net 8' || lower === '.net 8') {
    return TargetFrameworkOption.net8;
  }
  return undefined;
}

/**
 * Find all Logic App projects in the workspace
 * A Logic App project is identified by the same project predicate as product commands.
 * Excludes workflow-designtime folders (build artifacts) and deduplicates results
 */
async function findLogicAppProjects(): Promise<LogicAppProject[]> {
  const projects: LogicAppProject[] = [];
  const seenPaths = new Set<string>();

  if (!vscode.workspace.workspaceFolders) {
    return projects;
  }

  // Search for host.json files, excluding node_modules and workflow-designtime folders
  const hostJsonFiles = await vscode.workspace.findFiles('**/host.json', '{**/node_modules/**,**/workflow-designtime/**,**/.debug/**}');

  for (const hostJsonUri of hostJsonFiles) {
    const hostJsonPath = hostJsonUri.fsPath;
    const projectPath = path.dirname(hostJsonPath);
    const projectName = path.basename(projectPath);

    // Skip if we've already seen this path (deduplication)
    if (seenPaths.has(projectPath)) {
      continue;
    }

    // Skip workflow-designtime folders (double check in case glob didn't catch it)
    if (projectPath.includes('workflow-designtime') || projectPath.includes('.debug')) {
      continue;
    }

    if (await isLogicAppProject(projectPath)) {
      seenPaths.add(projectPath);
      projects.push({ name: projectName, path: projectPath });
    }
  }

  return projects;
}

/**
 * Parse workflow specifications for adding workflows to existing projects
 * Supports patterns like:
 * - "5 additional workflows Order4-8" -> Order4, Order5, Order6, Order7, Order8
 * - "create workflows Order4-8" -> Order4, Order5, Order6, Order7, Order8
 * - "5 stateful workflows Order4-8" -> Order4, Order5, Order6, Order7, Order8 (all stateful)
 * @internal Exported for testing
 */
export function parseAdditionalWorkflowSpecs(prompt: string): { workflows: WorkflowSpec[]; baseName?: string } {
  const workflows: WorkflowSpec[] = [];

  // Check for workflow type in prompt
  const lowerPrompt = prompt.toLowerCase();
  let defaultType: WorkflowTypeOption | undefined;
  if (lowerPrompt.includes('stateless')) {
    defaultType = WorkflowTypeOption.stateless;
  } else if (lowerPrompt.includes('agentic')) {
    defaultType = WorkflowTypeOption.agentic;
  } else if (lowerPrompt.includes('agent') && !lowerPrompt.includes('agentic')) {
    defaultType = WorkflowTypeOption.agent;
  } else if (lowerPrompt.includes('stateful')) {
    defaultType = WorkflowTypeOption.stateful;
  }

  // Pattern 1: "X workflows Name1-N" or "X additional workflows Name1-N" (e.g., "5 workflows Order4-8")
  const rangeShortPattern =
    /(\d+)\s+(?:additional\s+)?(?:stateful|stateless|agentic|agent)?\s*workflows?\s+([A-Za-z][A-Za-z0-9_-]*)(\d+)-(\d+)/i;
  const rangeShortMatch = rangeShortPattern.exec(prompt);
  if (rangeShortMatch) {
    const baseName = rangeShortMatch[2];
    const startNum = Number.parseInt(rangeShortMatch[3], 10);
    const endNum = Number.parseInt(rangeShortMatch[4], 10);

    for (let i = startNum; i <= endNum; i++) {
      workflows.push({ name: `${baseName}${i}`, type: defaultType });
    }
    return { workflows, baseName };
  }

  // Pattern 2: Just "Name1-N" (e.g., "Order4-8" as a follow-up)
  const simpleRangePattern = /^([A-Za-z][A-Za-z0-9_-]*)(\d+)-(\d+)$/;
  const simpleRangeMatch = simpleRangePattern.exec(prompt.trim());
  if (simpleRangeMatch) {
    const baseName = simpleRangeMatch[1];
    const startNum = Number.parseInt(simpleRangeMatch[2], 10);
    const endNum = Number.parseInt(simpleRangeMatch[3], 10);

    for (let i = startNum; i <= endNum; i++) {
      workflows.push({ name: `${baseName}${i}`, type: defaultType });
    }
    return { workflows, baseName };
  }

  return { workflows };
}
