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
