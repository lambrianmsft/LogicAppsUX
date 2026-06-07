// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workspace and workflow file helpers for E2E tests.
 *
 * Provides functions to:
 *   - Read workflow.json files
 *   - Verify triggers and actions
 *   - Check connections.json entries
 *   - Validate workflow structure
 *
 * Usage:
 *   import { readWorkflowJson, hasAction, hasTrigger } from './helpers/workspaceHelper';
 */

import * as fs from 'fs';
import * as path from 'path';

// ===========================================================================
// Types
// ===========================================================================

export interface WorkflowDefinition {
  $schema: string;
  contentVersion: string;
  triggers: Record<string, WorkflowTrigger>;
  actions: Record<string, WorkflowAction>;
  parameters?: Record<string, unknown>;
  staticResults?: Record<string, unknown>;
}

export interface WorkflowTrigger {
  type: string;
  kind?: string;
  inputs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkflowAction {
  type: string;
  kind?: string;
  inputs?: Record<string, unknown>;
  runAfter?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface WorkflowJson {
  kind?: string;
  definition: WorkflowDefinition;
}

export interface ConnectionsJson {
  serviceProviderConnections?: Record<string, ServiceProviderConnection>;
  managedApiConnections?: Record<string, ManagedApiConnection>;
}

export interface FileTextSnapshot {
  filePath: string;
  exists: boolean;
  content?: string;
  parentDir: string;
  parentDirContents: string[];
}

export interface WorkspaceTopologyEntry {
  absolutePath: string;
  relativePath: string;
  kind: 'file' | 'dir';
}

export interface WorkflowTopologySnapshot {
  workflowDir: string;
  relativePath: string;
  workflowJsonPath: string;
  workflowJsonExists: boolean;
  workflow: WorkflowJson | null;
  kind: string | null;
  actionCount: number;
  triggerCount: number;
  actionNames: string[];
  triggerNames: string[];
}

export interface LogicAppProjectTopologySnapshot {
  projectDir: string;
  relativePath: string;
  hostJsonPath: string;
  localSettingsJsonPath: string;
  connectionsJsonPath: string;
  isWorkspaceRoot: boolean;
  isNestedProject: boolean;
  workflows: WorkflowTopologySnapshot[];
}

export interface WorkspaceTopologySnapshot {
  workspaceRoot: string;
  workspaceFilePath?: string;
  entries: WorkspaceTopologyEntry[];
  projects: LogicAppProjectTopologySnapshot[];
  protectedFiles: FileTextSnapshot[];
  timestamp: number;
}

export interface WorkspaceTopologySnapshotOptions {
  workspaceFilePath?: string;
  protectedFilePaths?: string[];
  includeDefaultProtectedFiles?: boolean;
  maxDepth?: number;
  ignoredDirectoryNames?: string[];
}

export interface ProtectedWorkspaceFileOptions {
  workspaceFilePath?: string;
  additionalFilePaths?: string[];
  includeWorkflowJson?: boolean;
  includeProjectSettings?: boolean;
}

export interface WorkspaceTopologyAssertionOptions {
  expectedProjectCount?: number;
  minProjectCount?: number;
  expectedWorkspaceFileRelativePath?: string;
  expectedProjectRelativePaths?: string[];
  forbiddenProjectRelativePaths?: string[];
  expectedWorkflowRelativePaths?: string[];
  forbiddenWorkflowRelativePaths?: string[];
  expectedWorkflowKind?: string;
  requireWorkflowKind?: boolean;
  requireTrigger?: boolean;
  requireAction?: boolean;
  requireConnectionsJson?: boolean;
  denyNestedProjects?: boolean;
}

export interface WorkspaceTopologyMutationPolicy {
  allowedAddedPaths?: string[];
  allowedRemovedPaths?: string[];
  allowedChangedFilePaths?: string[];
  deniedAddedPaths?: string[];
  deniedRemovedPaths?: string[];
  deniedChangedFilePaths?: string[];
  allowProjectCreation?: boolean;
  allowProjectRemoval?: boolean;
  allowWorkflowCreation?: boolean;
  allowWorkflowRemoval?: boolean;
  allowProtectedFileMutation?: boolean;
}

export interface WorkspaceTopologyMutationDiff {
  addedPaths: string[];
  removedPaths: string[];
  addedProjects: string[];
  removedProjects: string[];
  addedWorkflows: string[];
  removedWorkflows: string[];
  changedProtectedFiles: string[];
  violations: string[];
}

export const READ_ONLY_WORKSPACE_TOPOLOGY_POLICY: WorkspaceTopologyMutationPolicy = {};

export const ALLOW_WORKFLOW_CREATION_TOPOLOGY_POLICY: WorkspaceTopologyMutationPolicy = {
  allowWorkflowCreation: true,
  allowedChangedFilePaths: ['.code-workspace'],
};

export const ALLOW_PROJECT_CREATION_TOPOLOGY_POLICY: WorkspaceTopologyMutationPolicy = {
  allowProjectCreation: true,
  allowWorkflowCreation: true,
  allowedChangedFilePaths: ['.code-workspace'],
};

export interface LogicAppProjectStructureOptions {
  workflowName?: string;
  expectedWorkflowKind?: string;
  requireConnectionsJson?: boolean;
  requireKind?: boolean;
  requireTrigger?: boolean;
  requireAction?: boolean;
}

export interface WorkflowOperationExpectation {
  name?: string;
  type?: string;
  kind?: string;
  inputs?: Record<string, unknown>;
  runAfter?: Record<string, string[]>;
  description?: string;
}

export interface MissingPlaceholder {
  path: string;
  placeholder: string;
  value: string;
}

export interface MissingPlaceholderOptions {
  placeholderPattern?: RegExp;
  stripWorkflowExpressions?: boolean;
}

export interface ServiceProviderConnection {
  serviceProvider: {
    id: string;
  };
  connectionRuntimeUrl?: string;
  [key: string]: unknown;
}

export interface ManagedApiConnection {
  api: {
    id: string;
  };
  connection: {
    id: string;
  };
  connectionRuntimeUrl?: string;
  authentication?: Record<string, unknown>;
  [key: string]: unknown;
}

// ===========================================================================
// File Reading Functions
// ===========================================================================

/**
 * Reads and parses a workflow.json file.
 *
 * @param workflowDir - Path to the workflow directory (containing workflow.json)
 * @returns The parsed workflow JSON or null if not found/invalid
 */
export function readWorkflowJson(workflowDir: string): WorkflowJson | null {
  const workflowPath = path.join(workflowDir, 'workflow.json');

  try {
    if (!fs.existsSync(workflowPath)) {
      console.log(`[readWorkflowJson] File not found: ${workflowPath}`);
      return null;
    }

    const content = fs.readFileSync(workflowPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed as WorkflowJson;
  } catch (error: any) {
    console.log(`[readWorkflowJson] Error reading ${workflowPath}: ${error.message}`);
    return null;
  }
}

/**
 * Reads and parses the connections.json file in a Logic App project.
 *
 * @param projectDir - Path to the Logic App project directory
 * @returns The parsed connections JSON or null if not found/invalid
 */
export function readConnectionsJson(projectDir: string): ConnectionsJson | null {
  const connectionsPath = path.join(projectDir, 'connections.json');

  try {
    if (!fs.existsSync(connectionsPath)) {
      console.log(`[readConnectionsJson] File not found: ${connectionsPath}`);
      return null;
    }

    const content = fs.readFileSync(connectionsPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed as ConnectionsJson;
  } catch (error: any) {
    console.log(`[readConnectionsJson] Error reading ${connectionsPath}: ${error.message}`);
    return null;
  }
}

/**
 * Reads and parses the host.json file in a Logic App project.
 *
 * @param projectDir - Path to the Logic App project directory
 * @returns The parsed host.json or null if not found/invalid
 */
export function readHostJson(projectDir: string): Record<string, unknown> | null {
  const hostPath = path.join(projectDir, 'host.json');

  try {
    if (!fs.existsSync(hostPath)) {
      console.log(`[readHostJson] File not found: ${hostPath}`);
      return null;
    }

    const content = fs.readFileSync(hostPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    console.log(`[readHostJson] Error reading ${hostPath}: ${error.message}`);
    return null;
  }
}

// ===========================================================================
// Workflow Verification Functions
// ===========================================================================

/**
 * Checks if a workflow has a trigger with the specified name.
 *
 * @param workflow - The workflow JSON
 * @param triggerName - Name of the trigger to check
 * @returns true if trigger exists
 */
export function hasTrigger(workflow: WorkflowJson | null, triggerName: string): boolean {
  if (!workflow?.definition?.triggers) {
    return false;
  }
  return triggerName in workflow.definition.triggers;
}

/**
 * Checks if a workflow has any trigger of the specified type.
 *
 * @param workflow - The workflow JSON
 * @param triggerType - Type of trigger to check (e.g., "Request", "Recurrence")
 * @returns true if trigger of type exists
 */
export function hasTriggerOfType(workflow: WorkflowJson | null, triggerType: string): boolean {
  if (!workflow?.definition?.triggers) {
    return false;
  }

  return Object.values(workflow.definition.triggers).some((trigger) => trigger.type?.toLowerCase() === triggerType.toLowerCase());
}

/**
 * Gets a trigger by name.
 *
 * @param workflow - The workflow JSON
 * @param triggerName - Name of the trigger
 * @returns The trigger or null
 */
export function getTrigger(workflow: WorkflowJson | null, triggerName: string): WorkflowTrigger | null {
  if (!workflow?.definition?.triggers) {
    return null;
  }
  return workflow.definition.triggers[triggerName] || null;
}

/**
 * Checks if a workflow has an action with the specified name.
 *
 * @param workflow - The workflow JSON
 * @param actionName - Name of the action to check
 * @returns true if action exists
 */
export function hasAction(workflow: WorkflowJson | null, actionName: string): boolean {
  if (!workflow?.definition?.actions) {
    return false;
  }
  return actionName in workflow.definition.actions;
}

/**
 * Checks if a workflow has any action of the specified type.
 *
 * @param workflow - The workflow JSON
 * @param actionType - Type of action to check (e.g., "ApiConnection", "ServiceProvider")
 * @returns true if action of type exists
 */
export function hasActionOfType(workflow: WorkflowJson | null, actionType: string): boolean {
  if (!workflow?.definition?.actions) {
    return false;
  }

  return Object.values(workflow.definition.actions).some((action) => action.type?.toLowerCase() === actionType.toLowerCase());
}

/**
 * Gets an action by name.
 *
 * @param workflow - The workflow JSON
 * @param actionName - Name of the action
 * @returns The action or null
 */
export function getAction(workflow: WorkflowJson | null, actionName: string): WorkflowAction | null {
  if (!workflow?.definition?.actions) {
    return null;
  }
  return workflow.definition.actions[actionName] || null;
}

/**
 * Gets all action names in a workflow.
 *
 * @param workflow - The workflow JSON
 * @returns Array of action names
 */
export function getActionNames(workflow: WorkflowJson | null): string[] {
  if (!workflow?.definition?.actions) {
    return [];
  }
  return Object.keys(workflow.definition.actions);
}

/**
 * Gets all trigger names in a workflow.
 *
 * @param workflow - The workflow JSON
 * @returns Array of trigger names
 */
export function getTriggerNames(workflow: WorkflowJson | null): string[] {
  if (!workflow?.definition?.triggers) {
    return [];
  }
  return Object.keys(workflow.definition.triggers);
}

/**
 * Counts the number of actions in a workflow.
 *
 * @param workflow - The workflow JSON
 * @returns Number of actions
 */
export function countActions(workflow: WorkflowJson | null): number {
  return getActionNames(workflow).length;
}

/**
 * Counts the number of triggers in a workflow.
 *
 * @param workflow - The workflow JSON
 * @returns Number of triggers
 */
export function countTriggers(workflow: WorkflowJson | null): number {
  return getTriggerNames(workflow).length;
}

// ===========================================================================
// Connection Verification Functions
// ===========================================================================

/**
 * Checks if a service provider connection exists in connections.json.
 *
 * @param connections - The connections JSON
 * @param connectionName - Name or partial name of the connection
 * @returns true if connection exists
 */
export function hasServiceProviderConnection(connections: ConnectionsJson | null, connectionName: string): boolean {
  if (!connections?.serviceProviderConnections) {
    return false;
  }

  const lowerName = connectionName.toLowerCase();
  return Object.keys(connections.serviceProviderConnections).some((key) => key.toLowerCase().includes(lowerName));
}

/**
 * Checks if a managed API connection exists in connections.json.
 *
 * @param connections - The connections JSON
 * @param connectionName - Name or partial name of the connection
 * @returns true if connection exists
 */
export function hasManagedApiConnection(connections: ConnectionsJson | null, connectionName: string): boolean {
  if (!connections?.managedApiConnections) {
    return false;
  }

  const lowerName = connectionName.toLowerCase();
  return Object.keys(connections.managedApiConnections).some((key) => key.toLowerCase().includes(lowerName));
}

/**
 * Gets a service provider connection by name.
 *
 * @param connections - The connections JSON
 * @param connectionName - Name of the connection
 * @returns The connection or null
 */
export function getServiceProviderConnection(
  connections: ConnectionsJson | null,
  connectionName: string
): ServiceProviderConnection | null {
  if (!connections?.serviceProviderConnections) {
    return null;
  }
  return connections.serviceProviderConnections[connectionName] || null;
}

/**
 * Gets a managed API connection by name.
 *
 * @param connections - The connections JSON
 * @param connectionName - Name of the connection
 * @returns The connection or null
 */
export function getManagedApiConnection(connections: ConnectionsJson | null, connectionName: string): ManagedApiConnection | null {
  if (!connections?.managedApiConnections) {
    return null;
  }
  return connections.managedApiConnections[connectionName] || null;
}

// ===========================================================================
// Project Directory Functions
// ===========================================================================

/**
 * Finds all workflow directories in a Logic App project.
 *
 * @param projectDir - Path to the Logic App project directory
 * @returns Array of workflow directory paths
 */
export function findWorkflowDirs(projectDir: string): string[] {
  const workflows: string[] = [];

  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workflowJsonPath = path.join(projectDir, entry.name, 'workflow.json');
        if (fs.existsSync(workflowJsonPath)) {
          workflows.push(path.join(projectDir, entry.name));
        }
      }
    }
  } catch (error: any) {
    console.log(`[findWorkflowDirs] Error scanning ${projectDir}: ${error.message}`);
  }

  return workflows;
}

/**
 * Finds all Logic App project directories in a workspace.
 * A Logic App project is identified by having a host.json file.
 *
 * @param workspaceDir - Path to the workspace root
 * @returns Array of project directory paths
 */
export function findLogicAppProjects(workspaceDir: string): string[] {
  const projects: string[] = [];

  try {
    const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const hostJsonPath = path.join(workspaceDir, entry.name, 'host.json');
        if (fs.existsSync(hostJsonPath)) {
          projects.push(path.join(workspaceDir, entry.name));
        }
      }
    }
  } catch (error: any) {
    console.log(`[findLogicAppProjects] Error scanning ${workspaceDir}: ${error.message}`);
  }

  return projects;
}

/**
 * Gets the workflow kind (Stateful or Stateless).
 *
 * @param workflow - The workflow JSON
 * @returns The workflow kind or null
 */
export function getWorkflowKind(workflow: WorkflowJson | null): string | null {
  return workflow?.kind || null;
}

/**
 * Checks if a workflow is stateful.
 *
 * @param workflow - The workflow JSON
 * @returns true if workflow is stateful
 */
export function isStateful(workflow: WorkflowJson | null): boolean {
  return workflow?.kind?.toLowerCase() === 'stateful';
}

/**
 * Checks if a workflow is stateless.
 *
 * @param workflow - The workflow JSON
 * @returns true if workflow is stateless
 */
export function isStateless(workflow: WorkflowJson | null): boolean {
  return workflow?.kind?.toLowerCase() === 'stateless';
}

// ===========================================================================
// Snapshot Functions
// ===========================================================================

/**
 * Takes a snapshot of workflow.json for before/after comparison.
 *
 * @param workflowDir - Path to the workflow directory
 * @returns Snapshot object with action/trigger counts and names
 */
export function takeWorkflowSnapshot(workflowDir: string): {
  actionCount: number;
  triggerCount: number;
  actionNames: string[];
  triggerNames: string[];
  timestamp: number;
} {
  const workflow = readWorkflowJson(workflowDir);

  return {
    actionCount: countActions(workflow),
    triggerCount: countTriggers(workflow),
    actionNames: getActionNames(workflow),
    triggerNames: getTriggerNames(workflow),
    timestamp: Date.now(),
  };
}

/**
 * Compares two workflow snapshots to detect changes.
 *
 * @param before - Snapshot before operation
 * @param after - Snapshot after operation
 * @returns Object describing the changes
 */
export function compareSnapshots(
  before: ReturnType<typeof takeWorkflowSnapshot>,
  after: ReturnType<typeof takeWorkflowSnapshot>
): {
  addedActions: string[];
  removedActions: string[];
  addedTriggers: string[];
  removedTriggers: string[];
  hasChanges: boolean;
} {
  const addedActions = after.actionNames.filter((name) => !before.actionNames.includes(name));
  const removedActions = before.actionNames.filter((name) => !after.actionNames.includes(name));
  const addedTriggers = after.triggerNames.filter((name) => !before.triggerNames.includes(name));
  const removedTriggers = before.triggerNames.filter((name) => !after.triggerNames.includes(name));

  return {
    addedActions,
    removedActions,
    addedTriggers,
    removedTriggers,
    hasChanges: addedActions.length > 0 || removedActions.length > 0 || addedTriggers.length > 0 || removedTriggers.length > 0,
  };
}

/**
 * Takes exact text snapshots for files that should not be mutated by a test.
 * Missing files are snapshotted too, so later creation is treated as a mutation.
 */
export function takeFileTextSnapshots(filePaths: string[]): FileTextSnapshot[] {
  return filePaths.map((filePath) => {
    const parentDir = path.dirname(filePath);
    const exists = fs.existsSync(filePath);
    return {
      filePath,
      exists,
      content: exists ? fs.readFileSync(filePath, 'utf-8') : undefined,
      parentDir,
      parentDirContents: listDirectoryContents(parentDir),
    };
  });
}

/**
 * Asserts that files previously captured with takeFileTextSnapshots are unchanged.
 */
export function assertFileTextSnapshotsUnchanged(snapshots: FileTextSnapshot[], label = 'Expected files to remain unchanged'): void {
  const failures: string[] = [];

  for (const snapshot of snapshots) {
    const currentlyExists = fs.existsSync(snapshot.filePath);
    const currentParentContents = listDirectoryContents(snapshot.parentDir);

    if (currentlyExists !== snapshot.exists) {
      failures.push(
        [
          `${snapshot.filePath}: existence changed from ${snapshot.exists} to ${currentlyExists}`,
          `Before ${snapshot.parentDir}: ${formatDirectoryContents(snapshot.parentDirContents)}`,
          `After ${snapshot.parentDir}: ${formatDirectoryContents(currentParentContents)}`,
        ].join('\n')
      );
      continue;
    }

    if (!currentlyExists) {
      continue;
    }

    const currentContent = fs.readFileSync(snapshot.filePath, 'utf-8');
    if (currentContent !== snapshot.content) {
      failures.push(
        [
          `${snapshot.filePath}: file content changed`,
          `Before length: ${snapshot.content?.length ?? 0}`,
          `After length: ${currentContent.length}`,
          `Directory ${snapshot.parentDir}: ${formatDirectoryContents(currentParentContents)}`,
        ].join('\n')
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`${label}\n${failures.join('\n\n')}`);
  }
}

/**
 * Asserts the generated Logic App project has the expected on-disk structure and workflow.json shape.
 */
export function assertLogicAppProjectStructure(projectDir: string, options: LogicAppProjectStructureOptions = {}): void {
  assertDirectoryExists(projectDir, `Logic App project directory is missing: ${projectDir}`);
  assertJsonFileObject(path.join(projectDir, 'host.json'), 'host.json');
  assertJsonFileObject(path.join(projectDir, 'local.settings.json'), 'local.settings.json');

  const connectionsPath = path.join(projectDir, 'connections.json');
  if (options.requireConnectionsJson || fs.existsSync(connectionsPath)) {
    assertJsonFileObject(connectionsPath, 'connections.json');
  }

  const workflowDirs = options.workflowName ? [path.join(projectDir, options.workflowName)] : findWorkflowDirs(projectDir);
  if (workflowDirs.length === 0) {
    throw new Error(
      `No workflow folders with workflow.json found in ${projectDir}. Contents: ${formatDirectoryContents(listDirectoryContents(projectDir))}`
    );
  }

  for (const workflowDir of workflowDirs) {
    assertDirectoryExists(workflowDir, `Workflow folder is missing: ${workflowDir}`);
    const workflowPath = path.join(workflowDir, 'workflow.json');
    const workflow = assertJsonFileObject(workflowPath, 'workflow.json') as unknown as WorkflowJson;
    assertWorkflowJsonShape(workflow, workflowPath, {
      expectedWorkflowKind: options.expectedWorkflowKind,
      requireKind: options.requireKind ?? true,
      requireTrigger: options.requireTrigger,
      requireAction: options.requireAction,
    });
  }
}

/**
 * Asserts the minimal workflow.json contract used by VS Code chat and UI E2E tests.
 */
export function assertWorkflowJsonShape(
  workflow: WorkflowJson | null,
  context = 'workflow.json',
  options: Pick<LogicAppProjectStructureOptions, 'expectedWorkflowKind' | 'requireKind' | 'requireTrigger' | 'requireAction'> = {}
): asserts workflow is WorkflowJson {
  if (!isRecord(workflow)) {
    throw new Error(`${context}: workflow must be a JSON object. Got: ${JSON.stringify(workflow)}`);
  }

  if (options.requireKind ?? true) {
    assertString((workflow as WorkflowJson).kind, `${context}.kind`);
  }
  if (options.expectedWorkflowKind) {
    const actualKind = (workflow as WorkflowJson).kind;
    if (actualKind !== options.expectedWorkflowKind) {
      throw new Error(`${context}.kind expected ${options.expectedWorkflowKind}, got ${actualKind}`);
    }
  }

  const definition = (workflow as WorkflowJson).definition;
  if (!isRecord(definition)) {
    throw new Error(`${context}.definition must be an object. Got: ${JSON.stringify(definition)}`);
  }
  assertString(definition.$schema, `${context}.definition.$schema`);
  assertRecord(definition.triggers, `${context}.definition.triggers`);
  assertRecord(definition.actions, `${context}.definition.actions`);

  if (options.requireTrigger && Object.keys(definition.triggers).length === 0) {
    throw new Error(`${context}.definition.triggers should contain at least one trigger`);
  }
  if (options.requireAction && Object.keys(definition.actions).length === 0) {
    throw new Error(`${context}.definition.actions should contain at least one action`);
  }
}

export function assertWorkflowHasAction(
  workflow: WorkflowJson | null,
  expectation: string | WorkflowOperationExpectation,
  expectedType?: string
): WorkflowAction {
  assertWorkflowJsonShape(workflow, 'workflow', { requireKind: false });
  const action = findExpectedOperation(workflow.definition.actions, toOperationExpectation(expectation, expectedType));
  if (!action) {
    throw new Error(
      `Expected action ${formatOperationExpectation(expectation)}. Available actions: ${formatOperations(workflow.definition.actions)}`
    );
  }
  return action as WorkflowAction;
}

export function assertWorkflowHasTrigger(
  workflow: WorkflowJson | null,
  expectation: string | WorkflowOperationExpectation,
  expectedType?: string
): WorkflowTrigger {
  assertWorkflowJsonShape(workflow, 'workflow', { requireKind: false });
  const trigger = findExpectedOperation(workflow.definition.triggers, toOperationExpectation(expectation, expectedType));
  if (!trigger) {
    throw new Error(
      `Expected trigger ${formatOperationExpectation(expectation)}. Available triggers: ${formatOperations(workflow.definition.triggers)}`
    );
  }
  return trigger as WorkflowTrigger;
}

export function findMissingPlaceholders(value: unknown, options: MissingPlaceholderOptions = {}): MissingPlaceholder[] {
  const findings: MissingPlaceholder[] = [];
  const placeholderPattern = options.placeholderPattern ?? /\{[A-Za-z_][A-Za-z0-9_.-]*\}/g;
  const stripExpressions = options.stripWorkflowExpressions ?? true;

  function visit(current: unknown, currentPath: string): void {
    if (typeof current === 'string') {
      const valueToScan = stripExpressions ? stripWorkflowExpressionBlocks(current) : current;
      for (const match of valueToScan.matchAll(
        new RegExp(
          placeholderPattern.source,
          placeholderPattern.flags.includes('g') ? placeholderPattern.flags : `${placeholderPattern.flags}g`
        )
      )) {
        findings.push({ path: currentPath, placeholder: match[0], value: current });
      }
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }

    if (isRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        visit(child, appendJsonPath(currentPath, key));
      }
    }
  }

  visit(value, '$');
  return findings;
}

export function assertNoMissingPlaceholders(value: unknown, label = 'Value should not contain unresolved placeholders'): void {
  const findings = findMissingPlaceholders(value);
  if (findings.length === 0) {
    return;
  }

  const details = findings.map((finding) => `${finding.path}: ${finding.placeholder} in ${JSON.stringify(finding.value)}`).join('\n');
  throw new Error(`${label}\n${details}`);
}

/**
 * Recursively finds Logic App projects below a workspace root.
 * A project is identified by a host.json file in the project directory.
 */
export function findLogicAppProjectsDeep(
  workspaceRoot: string,
  options: Pick<WorkspaceTopologySnapshotOptions, 'maxDepth' | 'ignoredDirectoryNames'> = {}
): string[] {
  const ignoredDirectoryNames = new Set(options.ignoredDirectoryNames ?? ['.git', 'node_modules', 'workflow-designtime', 'bin', 'obj']);
  const maxDepth = options.maxDepth ?? 4;
  const projects: string[] = [];

  function visit(currentDir: string, depth: number): void {
    if (depth > maxDepth || !directoryExists(currentDir)) {
      return;
    }

    if (fs.existsSync(path.join(currentDir, 'host.json'))) {
      projects.push(currentDir);
    }

    for (const entry of readDirectoryEntries(currentDir)) {
      if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name)) {
        visit(path.join(currentDir, entry.name), depth + 1);
      }
    }
  }

  visit(workspaceRoot, 0);
  return [...new Set(projects)].sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

/**
 * Returns default files whose mutations are usually meaningful in chat tests:
 * workflow.json files, project settings, connections, and the .code-workspace file.
 */
export function getProtectedWorkspaceFilePaths(workspaceRoot: string, options: ProtectedWorkspaceFileOptions = {}): string[] {
  const includeWorkflowJson = options.includeWorkflowJson ?? true;
  const includeProjectSettings = options.includeProjectSettings ?? true;
  const filePaths = new Set<string>();

  if (options.workspaceFilePath) {
    filePaths.add(options.workspaceFilePath);
  }

  for (const projectDir of findLogicAppProjectsDeep(workspaceRoot)) {
    if (includeProjectSettings) {
      filePaths.add(path.join(projectDir, 'host.json'));
      filePaths.add(path.join(projectDir, 'local.settings.json'));
      filePaths.add(path.join(projectDir, 'connections.json'));
    }

    if (includeWorkflowJson) {
      for (const workflowDir of findWorkflowDirs(projectDir)) {
        filePaths.add(path.join(workflowDir, 'workflow.json'));
      }
    }
  }

  for (const filePath of options.additionalFilePaths ?? []) {
    filePaths.add(filePath);
  }

  return [...filePaths].sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

/**
 * Captures a reusable before/after snapshot of the workspace's Logic App topology.
 */
export function takeWorkspaceTopologySnapshot(
  workspaceRoot: string,
  options: WorkspaceTopologySnapshotOptions = {}
): WorkspaceTopologySnapshot {
  const protectedFilePaths =
    options.protectedFilePaths ??
    (options.includeDefaultProtectedFiles === false
      ? []
      : getProtectedWorkspaceFilePaths(workspaceRoot, { workspaceFilePath: options.workspaceFilePath }));

  return {
    workspaceRoot,
    workspaceFilePath: options.workspaceFilePath,
    entries: takeWorkspaceEntrySnapshot(workspaceRoot, options),
    projects: findLogicAppProjectsDeep(workspaceRoot, options).map((projectDir) =>
      takeLogicAppProjectTopologySnapshot(workspaceRoot, projectDir)
    ),
    protectedFiles: takeFileTextSnapshots(protectedFilePaths),
    timestamp: Date.now(),
  };
}

/**
 * Asserts the captured topology has the expected project/workflow shape.
 */
export function assertWorkspaceTopologySnapshot(
  snapshot: WorkspaceTopologySnapshot,
  options: WorkspaceTopologyAssertionOptions = {}
): void {
  if (!directoryExists(snapshot.workspaceRoot)) {
    throw new Error(`Workspace root is missing: ${snapshot.workspaceRoot}`);
  }

  if (options.expectedProjectCount !== undefined && snapshot.projects.length !== options.expectedProjectCount) {
    throw new Error(
      `Expected ${options.expectedProjectCount} Logic App project(s), found ${snapshot.projects.length}: ${formatProjects(snapshot)}`
    );
  }

  if (options.minProjectCount !== undefined && snapshot.projects.length < options.minProjectCount) {
    throw new Error(
      `Expected at least ${options.minProjectCount} Logic App project(s), found ${snapshot.projects.length}: ${formatProjects(snapshot)}`
    );
  }

  if (options.denyNestedProjects) {
    const nestedProjects = snapshot.projects.filter((project) => project.isNestedProject);
    if (nestedProjects.length > 0) {
      throw new Error(
        `Expected no nested Logic App projects. Nested projects: ${nestedProjects.map((project) => project.relativePath).join(', ')}`
      );
    }
  }

  if (options.expectedWorkspaceFileRelativePath) {
    const actualWorkspaceFileRelativePath = snapshot.workspaceFilePath
      ? normalizeRelativePath(snapshot.workspaceRoot, snapshot.workspaceFilePath)
      : undefined;
    const expectedWorkspaceFileRelativePath = normalizePath(options.expectedWorkspaceFileRelativePath);
    if (actualWorkspaceFileRelativePath !== expectedWorkspaceFileRelativePath) {
      throw new Error(`Expected workspace file ${expectedWorkspaceFileRelativePath}, got ${actualWorkspaceFileRelativePath ?? '<none>'}`);
    }
  }

  const projectRelativePaths = snapshot.projects.map((project) => project.relativePath);
  const workflowRelativePaths = snapshot.projects.flatMap((project) => project.workflows.map((workflow) => workflow.relativePath));
  assertContainsRelativePaths(projectRelativePaths, options.expectedProjectRelativePaths, 'Expected Logic App project');
  assertExcludesRelativePaths(projectRelativePaths, options.forbiddenProjectRelativePaths, 'Forbidden Logic App project');
  assertContainsRelativePaths(workflowRelativePaths, options.expectedWorkflowRelativePaths, 'Expected workflow');
  assertExcludesRelativePaths(workflowRelativePaths, options.forbiddenWorkflowRelativePaths, 'Forbidden workflow');

  for (const project of snapshot.projects) {
    assertLogicAppProjectStructure(project.projectDir, {
      expectedWorkflowKind: options.expectedWorkflowKind,
      requireKind: options.requireWorkflowKind,
      requireTrigger: options.requireTrigger,
      requireAction: options.requireAction,
      requireConnectionsJson: options.requireConnectionsJson,
    });
  }
}

/**
 * Compares before/after topology snapshots and applies an allow/deny mutation policy.
 */
export function compareWorkspaceTopologySnapshots(
  before: WorkspaceTopologySnapshot,
  after: WorkspaceTopologySnapshot,
  policy: WorkspaceTopologyMutationPolicy = {}
): WorkspaceTopologyMutationDiff {
  const beforePaths = before.entries.map((entry) => entry.relativePath);
  const afterPaths = after.entries.map((entry) => entry.relativePath);
  const addedPaths = afterPaths.filter((relativePath) => !beforePaths.includes(relativePath));
  const removedPaths = beforePaths.filter((relativePath) => !afterPaths.includes(relativePath));
  const addedProjects = after.projects
    .map((project) => project.relativePath)
    .filter((relativePath) => !before.projects.some((project) => project.relativePath === relativePath));
  const removedProjects = before.projects
    .map((project) => project.relativePath)
    .filter((relativePath) => !after.projects.some((project) => project.relativePath === relativePath));
  const addedWorkflows = flattenWorkflowRelativePaths(after).filter(
    (relativePath) => !flattenWorkflowRelativePaths(before).includes(relativePath)
  );
  const removedWorkflows = flattenWorkflowRelativePaths(before).filter(
    (relativePath) => !flattenWorkflowRelativePaths(after).includes(relativePath)
  );
  const changedProtectedFiles = compareFileTextSnapshots(before.protectedFiles, after.protectedFiles);
  const violations = collectMutationViolations(
    { addedPaths, removedPaths, addedProjects, removedProjects, addedWorkflows, removedWorkflows, changedProtectedFiles, violations: [] },
    policy
  );

  return {
    addedPaths,
    removedPaths,
    addedProjects,
    removedProjects,
    addedWorkflows,
    removedWorkflows,
    changedProtectedFiles,
    violations,
  };
}

/**
 * Asserts that the after snapshot satisfies the expected topology mutation policy.
 */
export function assertWorkspaceTopologyMutation(
  before: WorkspaceTopologySnapshot,
  after: WorkspaceTopologySnapshot,
  policy: WorkspaceTopologyMutationPolicy = {},
  label = 'Workspace topology mutation did not match expected policy'
): WorkspaceTopologyMutationDiff {
  const diff = compareWorkspaceTopologySnapshots(before, after, policy);
  if (diff.violations.length > 0) {
    throw new Error(`${label}\n${diff.violations.join('\n')}`);
  }
  return diff;
}

function assertDirectoryExists(dirPath: string, message: string): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    const parentDir = path.dirname(dirPath);
    throw new Error(`${message}. Parent contents (${parentDir}): ${formatDirectoryContents(listDirectoryContents(parentDir))}`);
  }
}

function assertJsonFileObject(filePath: string, label: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} missing at ${filePath}. Parent contents: ${formatDirectoryContents(listDirectoryContents(path.dirname(filePath)))}`
    );
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!isRecord(parsed)) {
      throw new Error(`${label} must parse to a JSON object. Got: ${JSON.stringify(parsed)}`);
    }
    return parsed;
  } catch (error: any) {
    throw new Error(`${label} could not be read as JSON at ${filePath}: ${error.message}`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string. Got: ${JSON.stringify(value)}`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object. Got: ${JSON.stringify(value)}`);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listDirectoryContents(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return ['<missing directory>'];
    }
    return fs.readdirSync(dirPath).sort();
  } catch (error: any) {
    return [`<error reading directory: ${error.message}>`];
  }
}

function formatDirectoryContents(entries: string[]): string {
  return entries.length > 0 ? entries.join(', ') : '<empty>';
}

function directoryExists(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function readDirectoryEntries(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function normalizeRelativePath(rootDir: string, targetPath: string): string {
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath ? normalizePath(relativePath) : '.';
}

function assertContainsRelativePaths(actualPaths: string[], expectedPaths: string[] | undefined, label: string): void {
  for (const expectedPath of expectedPaths ?? []) {
    const normalizedExpectedPath = normalizePath(expectedPath);
    if (!actualPaths.some((actualPath) => normalizePath(actualPath) === normalizedExpectedPath)) {
      throw new Error(`${label} missing: ${normalizedExpectedPath}. Actual: ${actualPaths.join(', ') || '<none>'}`);
    }
  }
}

function assertExcludesRelativePaths(actualPaths: string[], forbiddenPaths: string[] | undefined, label: string): void {
  for (const forbiddenPath of forbiddenPaths ?? []) {
    const normalizedForbiddenPath = normalizePath(forbiddenPath);
    if (actualPaths.some((actualPath) => normalizePath(actualPath) === normalizedForbiddenPath)) {
      throw new Error(`${label} was present: ${normalizedForbiddenPath}. Actual: ${actualPaths.join(', ') || '<none>'}`);
    }
  }
}

function takeWorkspaceEntrySnapshot(
  workspaceRoot: string,
  options: Pick<WorkspaceTopologySnapshotOptions, 'maxDepth' | 'ignoredDirectoryNames'> = {}
): WorkspaceTopologyEntry[] {
  const ignoredDirectoryNames = new Set(options.ignoredDirectoryNames ?? ['.git', 'node_modules', 'workflow-designtime', 'bin', 'obj']);
  const maxDepth = options.maxDepth ?? 6;
  const entries: WorkspaceTopologyEntry[] = [];

  function visit(currentDir: string, depth: number): void {
    if (depth > maxDepth || !directoryExists(currentDir)) {
      return;
    }

    for (const entry of readDirectoryEntries(currentDir)) {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      entries.push({
        absolutePath,
        relativePath: normalizeRelativePath(workspaceRoot, absolutePath),
        kind: entry.isDirectory() ? 'dir' : 'file',
      });

      if (entry.isDirectory()) {
        visit(absolutePath, depth + 1);
      }
    }
  }

  visit(workspaceRoot, 0);
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function takeLogicAppProjectTopologySnapshot(workspaceRoot: string, projectDir: string): LogicAppProjectTopologySnapshot {
  const relativePath = normalizeRelativePath(workspaceRoot, projectDir);

  return {
    projectDir,
    relativePath,
    hostJsonPath: path.join(projectDir, 'host.json'),
    localSettingsJsonPath: path.join(projectDir, 'local.settings.json'),
    connectionsJsonPath: path.join(projectDir, 'connections.json'),
    isWorkspaceRoot: relativePath === '.',
    isNestedProject: hasAncestorLogicAppProject(workspaceRoot, projectDir),
    workflows: findWorkflowDirs(projectDir).map((workflowDir) => takeWorkflowTopologySnapshot(workspaceRoot, workflowDir)),
  };
}

function takeWorkflowTopologySnapshot(workspaceRoot: string, workflowDir: string): WorkflowTopologySnapshot {
  const workflow = readWorkflowJson(workflowDir);
  const workflowJsonPath = path.join(workflowDir, 'workflow.json');

  return {
    workflowDir,
    relativePath: normalizeRelativePath(workspaceRoot, workflowDir),
    workflowJsonPath,
    workflowJsonExists: fs.existsSync(workflowJsonPath),
    workflow,
    kind: getWorkflowKind(workflow),
    actionCount: countActions(workflow),
    triggerCount: countTriggers(workflow),
    actionNames: getActionNames(workflow),
    triggerNames: getTriggerNames(workflow),
  };
}

function hasAncestorLogicAppProject(workspaceRoot: string, projectDir: string): boolean {
  let currentDir = path.dirname(projectDir);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

  while (path.resolve(currentDir).startsWith(resolvedWorkspaceRoot)) {
    if (fs.existsSync(path.join(currentDir, 'host.json'))) {
      return true;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return false;
}

function flattenWorkflowRelativePaths(snapshot: WorkspaceTopologySnapshot): string[] {
  return snapshot.projects.flatMap((project) => project.workflows.map((workflow) => workflow.relativePath));
}

function compareFileTextSnapshots(beforeSnapshots: FileTextSnapshot[], afterSnapshots: FileTextSnapshot[]): string[] {
  const changedFiles: string[] = [];
  const afterByPath = new Map(afterSnapshots.map((snapshot) => [snapshot.filePath, snapshot]));

  for (const snapshot of beforeSnapshots) {
    const afterSnapshot = afterByPath.get(snapshot.filePath);
    const currentlyExists = afterSnapshot?.exists ?? fs.existsSync(snapshot.filePath);
    if (currentlyExists !== snapshot.exists) {
      changedFiles.push(snapshot.filePath);
      continue;
    }

    const currentContent = afterSnapshot?.content ?? (currentlyExists ? fs.readFileSync(snapshot.filePath, 'utf-8') : undefined);
    if (currentlyExists && currentContent !== snapshot.content) {
      changedFiles.push(snapshot.filePath);
    }
  }

  return changedFiles;
}

function collectMutationViolations(diff: WorkspaceTopologyMutationDiff, policy: WorkspaceTopologyMutationPolicy): string[] {
  const violations: string[] = [];

  addDeniedPathViolations(violations, diff.addedPaths, policy.deniedAddedPaths, 'Added denied path');
  addDeniedPathViolations(violations, diff.removedPaths, policy.deniedRemovedPaths, 'Removed denied path');
  addDeniedPathViolations(violations, diff.changedProtectedFiles, policy.deniedChangedFilePaths, 'Changed denied protected file');

  for (const addedPath of diff.addedPaths) {
    if (!isAddedPathAllowed(addedPath, diff, policy)) {
      violations.push(`Unexpected added path: ${addedPath}`);
    }
  }

  for (const removedPath of diff.removedPaths) {
    if (!isRemovedPathAllowed(removedPath, diff, policy)) {
      violations.push(`Unexpected removed path: ${removedPath}`);
    }
  }

  for (const changedFile of diff.changedProtectedFiles) {
    if (!isPathMatched(changedFile, policy.allowedChangedFilePaths) && !policy.allowProtectedFileMutation) {
      violations.push(`Unexpected protected file mutation: ${changedFile}`);
    }
  }

  if (!policy.allowProjectCreation) {
    for (const project of diff.addedProjects) {
      if (!isPathMatched(project, policy.allowedAddedPaths)) {
        violations.push(`Unexpected Logic App project creation: ${project}`);
      }
    }
  }

  if (!policy.allowProjectRemoval) {
    for (const project of diff.removedProjects) {
      if (!isPathMatched(project, policy.allowedRemovedPaths)) {
        violations.push(`Unexpected Logic App project removal: ${project}`);
      }
    }
  }

  if (!policy.allowWorkflowCreation) {
    for (const workflow of diff.addedWorkflows) {
      if (!isPathMatched(workflow, policy.allowedAddedPaths)) {
        violations.push(`Unexpected workflow creation: ${workflow}`);
      }
    }
  }

  if (!policy.allowWorkflowRemoval) {
    for (const workflow of diff.removedWorkflows) {
      if (!isPathMatched(workflow, policy.allowedRemovedPaths)) {
        violations.push(`Unexpected workflow removal: ${workflow}`);
      }
    }
  }

  return violations;
}

function addDeniedPathViolations(violations: string[], pathsToCheck: string[], deniedPaths: string[] | undefined, message: string): void {
  for (const filePath of pathsToCheck) {
    if (isPathMatched(filePath, deniedPaths)) {
      violations.push(`${message}: ${filePath}`);
    }
  }
}

function isAddedPathAllowed(relativePath: string, diff: WorkspaceTopologyMutationDiff, policy: WorkspaceTopologyMutationPolicy): boolean {
  return (
    isPathMatched(relativePath, policy.allowedAddedPaths) ||
    (policy.allowProjectCreation === true && isPathWithinAny(relativePath, diff.addedProjects)) ||
    (policy.allowWorkflowCreation === true && isPathWithinAny(relativePath, diff.addedWorkflows))
  );
}

function isRemovedPathAllowed(relativePath: string, diff: WorkspaceTopologyMutationDiff, policy: WorkspaceTopologyMutationPolicy): boolean {
  return (
    isPathMatched(relativePath, policy.allowedRemovedPaths) ||
    (policy.allowProjectRemoval === true && isPathWithinAny(relativePath, diff.removedProjects)) ||
    (policy.allowWorkflowRemoval === true && isPathWithinAny(relativePath, diff.removedWorkflows))
  );
}

function isPathWithinAny(relativePath: string, parentPaths: string[]): boolean {
  return parentPaths.some((parentPath) => relativePath === parentPath || relativePath.startsWith(`${parentPath}/`));
}

function isPathMatched(filePath: string, expectedPaths: string[] | undefined): boolean {
  if (!expectedPaths || expectedPaths.length === 0) {
    return false;
  }

  const normalizedFilePath = normalizePath(filePath);
  return expectedPaths.some((expectedPath) => {
    const normalizedExpectedPath = normalizePath(expectedPath);
    return normalizedFilePath === normalizedExpectedPath || normalizedFilePath.endsWith(`/${normalizedExpectedPath}`);
  });
}

function formatProjects(snapshot: WorkspaceTopologySnapshot): string {
  return snapshot.projects.length > 0 ? snapshot.projects.map((project) => project.relativePath).join(', ') : '<none>';
}

function toOperationExpectation(expectation: string | WorkflowOperationExpectation, expectedType?: string): WorkflowOperationExpectation {
  return typeof expectation === 'string' ? { name: expectation, type: expectedType } : expectation;
}

function findExpectedOperation(
  operations: Record<string, WorkflowAction | WorkflowTrigger>,
  expectation: WorkflowOperationExpectation
): WorkflowAction | WorkflowTrigger | undefined {
  if (expectation.name) {
    const operation = operations[expectation.name];
    return operationMatches(operation, expectation) ? operation : undefined;
  }

  return Object.values(operations).find((operation) => operationMatches(operation, expectation));
}

function operationMatches(operation: WorkflowAction | WorkflowTrigger | undefined, expectation: WorkflowOperationExpectation): boolean {
  if (!operation) {
    return false;
  }
  if (expectation.type && operation.type?.toLowerCase() !== expectation.type.toLowerCase()) {
    return false;
  }
  if (expectation.kind && operation.kind?.toLowerCase() !== expectation.kind.toLowerCase()) {
    return false;
  }
  if (expectation.inputs !== undefined && !jsonValuesEqual(operation.inputs, expectation.inputs)) {
    return false;
  }
  if ('runAfter' in expectation && !jsonValuesEqual((operation as WorkflowAction).runAfter, expectation.runAfter)) {
    return false;
  }
  return true;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortJsonValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function formatOperationExpectation(expectation: string | WorkflowOperationExpectation): string {
  if (typeof expectation === 'string') {
    return `"${expectation}"`;
  }
  return JSON.stringify(expectation);
}

function formatOperations(operations: Record<string, WorkflowAction | WorkflowTrigger>): string {
  const entries = Object.entries(operations).map(
    ([name, operation]) => `${name}(type=${operation.type ?? '<missing>'}, kind=${operation.kind ?? '<none>'})`
  );
  return entries.length > 0 ? entries.join(', ') : '<none>';
}

function stripWorkflowExpressionBlocks(value: string): string {
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value[index] === '@' && value[index + 1] === '{') {
      index += 2;
      let depth = 1;
      while (index < value.length && depth > 0) {
        if (value[index] === '{') {
          depth++;
        } else if (value[index] === '}') {
          depth--;
        }
        index++;
      }
      continue;
    }

    result += value[index];
    index++;
  }

  return result;
}

function appendJsonPath(base: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}
