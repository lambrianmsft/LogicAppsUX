# Auto-Create Connections from Chat Agent via Designer Panel

## Summary

When the chat agent adds actions requiring connections, instead of writing empty placeholder stubs and asking the user to "open designer to authenticate," the agent should automatically open the designer and navigate it to the connections panel so the user can fill in connection strings or complete OAuth sign-in. This requires: (1) adding a new `ExtensionCommand` to trigger connection panel navigation, (2) handling it in the webview to open the connections panel, (3) modifying the chat agent to open the designer after creating the workflow, and (4) passing initialization hints so the designer knows to show the connections panel.

## Steps

### 1. Add initialization hint to `IDesignerPanelMetadata`

**File**: [apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesignerBase.ts](apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesignerBase.ts) (or its type definition)

Add an optional `pendingConnectionNodes?: string[]` field that lists `nodeId`s with incomplete connections. This will be included in the `initialize_frame` payload sent to the webview.

### 2. Add new `ExtensionCommand` for opening the connections flow

**File**: [libs/vscode-extension/src/lib/models/extensioncommand.ts](libs/vscode-extension/src/lib/models/extensioncommand.ts)

Add `openConnectionsPanel: 'open-connections-panel'` to the `ExtensionCommand` const. This enables the extension host to tell the webview to navigate to the connections panel after initialization.

### 3. Handle `pendingConnectionNodes` on designer initialization

**File**: [apps/vs-code-react/src/app/designer/app.tsx](apps/vs-code-react/src/app/designer/app.tsx)

After the designer finishes loading (workflow parsed, nodes initialized), check if `pendingConnectionNodes` was provided in the initialization data. If so, dispatch the Redux action `openPanel({ nodeId: pendingConnectionNodes[0], panelMode: 'Connection' })` to open the connections panel for the first incomplete connection. This leverages the existing `panelSlice` action at [libs/designer/src/lib/core/state/panel/panelSlice.ts](libs/designer/src/lib/core/state/panel/panelSlice.ts).

### 4. Handle `openConnectionsPanel` as a post-init message

**File**: [apps/vs-code-react/src/webviewCommunication.tsx](apps/vs-code-react/src/webviewCommunication.tsx)

Add a case for `ExtensionCommand.openConnectionsPanel` in the message listener. When received, dispatch `openPanel({ nodeIds: msg.nodeIds, panelMode: 'Connection' })` to show the "All Connections" view listing all nodes with incomplete connections. This approach works for scenarios where the designer is already open and the agent adds a new action.

### 5. Modify the chat agent's `AddActionTool`

**File**: [apps/vs-code-designer/src/app/chat/tools/workflowTools.ts](apps/vs-code-designer/src/app/chat/tools/workflowTools.ts)

After calling `addPlaceholderServiceProviderConnection()` or `addPlaceholderManagedApiConnection()`, instead of just returning "Open designer to authenticate":
- Call `vscode.commands.executeCommand('azureLogicAppsStandard.openDesigner', workflowUri)` to open the designer
- Send a follow-up `openConnectionsPanel` message to the webview with the node IDs that need connections
- Update the chat response text to say "Opening designer — please fill in the connection details in the connections panel"

### 6. Extend `openDesigner` command to accept options

**File**: [apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesigner.ts](apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesigner.ts)

Add an optional `OpenDesignerOptions` parameter: `{ showConnectionsPanel?: boolean, pendingConnectionNodeIds?: string[] }`. Pass this through to `OpenDesignerForLocalProject` and include it in the `initialize_frame` payload.

### 7. Service provider connections (connection string)

For service provider connections (Azure Blob, Service Bus, SQL built-in, etc.), we now use Azure resource picker similar to the Portal:

1. **Check Azure context** - Read `WORKFLOWS_SUBSCRIPTION_ID` and `WORKFLOWS_TENANT_ID` from `local.settings.json`
2. **List Azure resources** - If authenticated, query ARM API to list resources (Service Bus namespaces, Storage accounts, Event Hub namespaces)
3. **Show quick pick** - Display available resources using `vscode.window.showQuickPick`
4. **Fetch connection string automatically** - Call the appropriate listKeys/AuthorizationRules API to get the connection string
5. **Create complete connection** - Write to `connections.json` with `@appsetting()` reference, store connection string in `local.settings.json`

**Supported resource types:**
- Service Bus namespaces (`Microsoft.ServiceBus/namespaces`)
- Storage accounts (`Microsoft.Storage/storageAccounts`) - for Blob, Queues, Tables, Files
- Event Hub namespaces (`Microsoft.EventHub/namespaces`)

**Fallback behavior:**
- If no Azure context is configured, prompts for manual connection string entry
- If no resources are found, asks user if they want to enter manually
- If user cancels resource picker, falls back to placeholder connection

**File**: [apps/vs-code-designer/src/app/chat/tools/workflowTools.ts](apps/vs-code-designer/src/app/chat/tools/workflowTools.ts)

### 8. API Hub managed connections (OAuth)

No changes needed to the creation UI — the existing `createAndAuthorizeOAuthConnection` flow already works in VS Code. It opens a browser via `vscode.env.openExternal(consentUrl)`, user signs in, redirect completes the flow via `ExtensionCommand.completeOauthLogin`. The panel already shows "Sign in" for OAuth connectors.

### 9. Handle "designer already open" scenario

**File**: [apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesignerForLocalProject.ts](apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesignerForLocalProject.ts)

If the designer panel already exists for the workflow, instead of creating a new one, send a `refresh_workflow` message (already supported) followed by `openConnectionsPanel` to re-initialize and navigate to the connections panel.

### 10. Improve placeholder connection detection

**File**: [apps/vs-code-designer/src/app/chat/tools/workflowTools.ts](apps/vs-code-designer/src/app/chat/tools/workflowTools.ts#L153-L210)

In `addPlaceholderServiceProviderConnection` and `addPlaceholderManagedApiConnection`, track which node IDs map to placeholder connections so they can be passed to the designer's connections panel opener.

## Verification

- Run `pnpm run test:lib` to validate no regressions in designer and vscode-extension unit tests
- Manual test: Use the chat agent to request "Add a Service Bus action to my workflow" → verify the designer opens with the connections panel showing the Service Bus connection creation form with connection string input
- Manual test: Use the chat agent to request "Add an Office 365 send email action" → verify the designer opens with the connections panel showing the OAuth sign-in button
- Manual test: If designer is already open, add an action via chat agent → verify the connections panel opens for the new connection
- Run `pnpm run test:e2e --grep @mock` for E2E validation

## Design Decisions

- **Azure resource picker for service provider connections** — When the chat agent adds an action requiring a service provider connection, it uses the same approach as the Portal: list Azure resources via ARM API and let the user pick one. This avoids manual connection string entry and matches the Portal experience
- **Automatic connection string retrieval** — After the user selects a resource, the connection string is fetched automatically using the appropriate ARM API (listKeys for storage, AuthorizationRules + listKeys for Service Bus/Event Hub)
- **Graceful fallback** — If Azure is not configured, no resources are found, or the user cancels, falls back to manual connection string entry or placeholder connection
- **API Hub managed connections open the designer** — OAuth-based connections still require browser interaction, so the designer opens with the connections panel visible
- **Chose `initialize_frame` hint + post-init message** over modifying the Redux initial state directly — this keeps the extension host → webview boundary clean and works for both fresh-open and already-open designer scenarios
- **Chose to open connections panel per-node** (starting with first incomplete connection) rather than all at once — the existing connections panel UX handles one node at a time, and once one is completed the designer's error-level validation will flag remaining ones
- **Placeholder stubs are still written to `connections.json`** for managed API connections — this ensures the workflow definition references are valid and the designer can load the workflow. The designer's `isConnectionReferenceValid` check will flag them as invalid and show the error banner, reinforcing that the user needs to complete the connection

## Architecture Context

### Current Flow (Before)

```
Chat Agent → addPlaceholderConnection() → writes empty stub to connections.json
           → returns "Open designer to authenticate"
           → USER must manually open designer and find the connection to fix
```

### New Flow (After)

```
Service Provider Connections (connection string based):
Chat Agent → check Azure context from local.settings.json
           → if Azure configured:
               → list Azure resources via ARM API
               → show quick pick for resource selection
               → fetch connection string from selected resource (listKeys API)
               → create complete connection
           → if no Azure or user cancels:
               → prompt for manual connection string entry
               → create complete connection
           → Connection ready to use immediately (no designer needed)

API Hub Managed Connections (OAuth based):
Chat Agent → addPlaceholderConnection() → writes stub to connections.json
           → openDesigner(workflowUri, { showConnectionsPanel: true, pendingConnectionNodeIds })
           → Designer opens with connections panel visible
           → User clicks Sign In for OAuth
           → Connection created and persisted automatically
```

### Key Files

| File | Purpose |
|------|---------|
| `libs/vscode-extension/src/lib/models/extensioncommand.ts` | Extension commands for connection flow |
| `apps/vs-code-react/src/app/designer/servicesHelper.ts` | VS Code webview service initialization with connection callbacks |
| `apps/vs-code-react/src/app/designer/services/oAuth.ts` | VS Code OAuth popup via `env.openExternal` |
| `apps/vs-code-designer/src/app/utils/codeless/connection.ts` | Extension host connection utilities — file I/O, MSI support |
| `apps/vs-code-designer/src/app/commands/workflows/openDesigner/openDesignerForLocalProject.ts` | Message handler dispatching webview commands |
| `apps/vs-code-designer/src/app/chat/tools/workflowTools.ts` | Chat agent tool that adds actions with connections |
| `libs/designer/src/lib/ui/panel/connectionsPanel/createConnection/createConnectionInternal.tsx` | Connection creation UI orchestrator |
| `libs/designer/src/lib/core/state/panel/panelSlice.ts` | Redux panel state with `openPanel` action |
| `libs/logic-apps-shared/src/designer-client-services/lib/standard/connection.ts` | `StandardConnectionService` — routes to local or API Hub creation |

### Connection Type → Flow Path

| Connection Type | ARM Resource? | Auth Method | Code Path | Auto-creation Feasibility |
|---|---|---|---|---|
| Service Provider (built-in) with connection string | No | Connection string in app settings | `createServiceProviderConnection` → Azure resource picker → listKeys API → write to connections.json + local.settings.json | **Implemented** — uses Azure resource picker like Portal, falls back to manual entry |
| Service Provider with Managed Identity | No | MI token | Same local path, different parameter set | **Easy** — select MI parameter set, no secret needed |
| API Hub / Managed (OAuth) | Yes | Interactive OAuth browser popup | `_createConnectionInApiHub` → `createAndAuthorizeOAuthConnection` → popup → confirmConsent | **Works** — existing OAuth popup flow via `vscode.env.openExternal` |
| API Hub / Managed (non-OAuth) | Yes | Service principal / key | `_createConnectionInApiHub` → `createConnectionInApiHub` | **Medium** — supply credentials, needs Azure sub |
| FileSystem | No | net use command | `connectionCreationClients.FileSystem` → exec `net use` | **Easy** — existing pattern |
| Functions / APIM | No | Resource picker + key | `createConnectionInLocal` → specific converter | **Medium** — need function key / APIM subscription key |
