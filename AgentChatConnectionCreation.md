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

No changes needed to the creation UI — the existing `CreateConnectionWrapper` component already shows the correct form with connection string fields based on the connector's `connectionParameterSets`. When the user selects "Connection String" from the multi-auth dropdown and provides the value, `StandardConnectionService.createConnectionInLocal()` stores the secret in `local.settings.json` via `@appsetting()` references automatically.

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

- **Chose `initialize_frame` hint + post-init message** over modifying the Redux initial state directly — this keeps the extension host → webview boundary clean and works for both fresh-open and already-open designer scenarios
- **Chose to open connections panel per-node** (starting with first incomplete connection) rather than all at once — the existing connections panel UX handles one node at a time, and once one is completed the designer's error-level validation will flag remaining ones
- **No new UI for connection string collection** — the existing `CreateConnection` component already renders the correct form fields based on connector metadata (`connectionParameterSets` with `parameterSource: AppConfiguration`). We just need to navigate to it automatically
- **Placeholder stubs are still written to `connections.json`** before opening the designer — this ensures the workflow definition references are valid and the designer can load the workflow. The designer's `isConnectionReferenceValid` check will flag them as invalid and show the error banner, reinforcing that the user needs to complete the connection

## Architecture Context

### Current Flow (Before)

```
Chat Agent → addPlaceholderConnection() → writes empty stub to connections.json
           → returns "Open designer to authenticate"
           → USER must manually open designer and find the connection to fix
```

### New Flow (After)

```
Chat Agent → addPlaceholderConnection() → writes stub to connections.json
           → openDesigner(workflowUri, { showConnectionsPanel: true, pendingConnectionNodeIds })
           → Designer opens with connections panel visible
           → User fills in connection string / clicks Sign In for OAuth
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
| Service Provider (built-in) with connection string | No | Connection string in app settings | `createConnectionInLocal` → `convertToServiceProviderConnectionsData` → `createLocalConnectionsData` | **Easy** — supply conn string programmatically |
| Service Provider with Managed Identity | No | MI token | Same local path, different parameter set | **Easy** — select MI parameter set, no secret needed |
| API Hub / Managed (OAuth) | Yes | Interactive OAuth browser popup | `_createConnectionInApiHub` → `createAndAuthorizeOAuthConnection` → popup → confirmConsent | **Works** — existing OAuth popup flow via `vscode.env.openExternal` |
| API Hub / Managed (non-OAuth) | Yes | Service principal / key | `_createConnectionInApiHub` → `createConnectionInApiHub` | **Medium** — supply credentials, needs Azure sub |
| FileSystem | No | net use command | `connectionCreationClients.FileSystem` → exec `net use` | **Easy** — existing pattern |
| Functions / APIM | No | Resource picker + key | `createConnectionInLocal` → specific converter | **Medium** — need function key / APIM subscription key |
