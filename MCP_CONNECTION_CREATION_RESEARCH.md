# MCP Server Integration Research — Connection Creation via Copilot Chat

**MCP Server Repository**: [https://github.com/laveeshb/logicapps-mcp](https://github.com/laveeshb/logicapps-mcp)
**npm package**: `logicapps-mcp` (v0.4.3)
**Related plan**: See `AgentChatConnectionCreation.md` in this repo for the designer panel flow

---

## Goal

Leverage the [Logic Apps MCP Server](https://github.com/laveeshb/logicapps-mcp) to discover required connection fields, prompt the user in the `@logicapps` Copilot chat, and automate managed API connection creation for Standard (local project) Logic Apps in VS Code.

## User Requirements

- **Target**: `@logicapps` VS Code native chat participant (Copilot Chat panel)
- **SKU**: Standard Logic Apps (local project with `connections.json`)
- **Integration style**: Build a wrapper in the extension that adapts the MCP server's logic programmatically
- **Scope**: Managed API connectors only (SQL, Office 365, Service Bus, etc.)
- **Trigger**: When a user adds an action that uses a managed API connector, automatically prompt for required connection fields
- **Flow**: Prompt → Collect → Create → Test → Re-prompt on failure with pre-filled values

---

## MCP Server — Connection Tools

The MCP server provides **6 connection-related tools** (out of 40 total):

| Tool | Purpose | Key Params |
|------|---------|------------|
| `get_connector_swagger` | Discover connector metadata & required connection params | `subscriptionId`, `location`, `connectorName` |
| `get_connections` | List existing ARM connections in a resource group | `subscriptionId`, `resourceGroupName` |
| `get_connection_details` | Get connection info including test status | `subscriptionId`, `resourceGroupName`, `connectionName` |
| `create_connection` | Create an ARM managed API connection | `subscriptionId`, `resourceGroupName`, `connectionName`, `connectorName`, `location`, optional `parameterValues` |
| `test_connection` | Test if a connection is valid | `subscriptionId`, `resourceGroupName`, `connectionName` |
| `invoke_connector_operation` | Call an operation using an existing connection | `subscriptionId`, `resourceGroupName`, `connectionName`, `operationId` |

### How Required Fields Are Discovered

The key tool is `get_connector_swagger`. It calls the Azure managed APIs endpoint and returns:

**API endpoint**: `GET /subscriptions/{sub}/providers/Microsoft.Web/locations/{location}/managedApis/{connectorName}?api-version=2018-07-01-preview`

**Response includes `connectionParameters`** — each parameter has:
- `type` (string, securestring, etc.)
- `uiDefinition` (display name, description, tooltip, constraints)
- Required/optional status
- `x-ms-dynamic-values` / `x-ms-dynamic-schema` for dynamic dropdowns

**MCP server source**: `src/tools/connections.ts:287-323`

### Connection Creation Flow in MCP Server

```
1. get_connector_swagger  →  discover required params
2. get_connections         →  check if connection already exists
3. create_connection       →  PUT to ARM Microsoft.Web/connections
4. (If OAuth)              →  returns portal URL for manual authorization
5. test_connection         →  validate
6. invoke_connector_operation → use connection
```

### Key MCP Server Source Files

| File | Purpose |
|------|---------|
| `src/tools/connections.ts` | All connection tool implementations (667 lines) |
| `src/tools/definitions.ts:227-370` | Tool input schemas/definitions |
| `src/tools/handler.ts:129-214` | Tool dispatch logic |
| `knowledge/authoring/connector-patterns.md` | Connector guidance & examples |
| `knowledge/authoring/README.md` | Recommended discovery → create flow |

### Important: Managed Connectors Only

The MCP server's connection tools only work with **managed connectors**:
- `create_connection` writes to `Microsoft.Web/locations/{location}/managedApis/{connectorName}`
- Built-in/service provider connectors don't use API Hub connections
- No custom connector creation tool exists

---

## LogicAppsUX Codebase — Connection Architecture

### Connection Service Interface

**File**: `libs/logic-apps-shared/src/designer-client-services/lib/connection.ts`

```typescript
interface IConnectionService {
  getConnector(connectorId: string): Promise<Connector>;
  getConnection(connectionId: string): Promise<Connection>;
  getConnections(connectorId?: string): Promise<Connection[]>;
  createConnection(connectionInfo: ConnectionCreationInfo, ...): Promise<Connection>;
  createAndAuthorizeOAuthConnection(...): Promise<CreateConnectionResult>;
  setupConnectionIfNeeded(connector: Connector): Promise<void>;
  getUniqueConnectionName(connectorId: string, ...): Promise<string>;
}
```

### ConnectionCreationInfo

```typescript
interface ConnectionCreationInfo {
  connectionParametersSet?: { name: string; values: Record<string, { value: any }> };
  connectionParameters?: Record<string, { value: any }>;
  alternativeParameterValues?: Record<string, any>;
  displayName?: string;
  appSettings?: Record<string, string>;
}
```

### Standard Connection Service

**File**: `libs/logic-apps-shared/src/designer-client-services/lib/standard/connection.ts`

- Creates ARM connections for managed API connectors
- Writes connection references to local `connections.json`
- Handles ACLs for managed-identity/API Hub connections
- Takes `readConnections()` / `writeConnection()` callbacks for local file I/O

### connections.json Structure

**File**: `libs/vscode-extension/src/lib/models/connection.ts`

```typescript
interface ConnectionsData {
  managedApiConnections: Record<string, ManagedApiConnection>;
  functionConnections: Record<string, FunctionConnection>;
  serviceProviderConnections: Record<string, ServiceProviderConnection>;
  apiManagementConnections: Record<string, ApiManagementConnection>;
  agentConnections: Record<string, AgentConnection>;
  agentMcpConnections: Record<string, McpConnection>;
}

// Managed API entry shape:
{
  connection: { id: "/subscriptions/.../connections/{name}" },
  api: { id: "/subscriptions/.../managedApis/{connector}" },
  connectionRuntimeUrl: "https://...",
  authentication: { type: "Raw", scheme: "Key", parameter: "@appsetting('...')" }
}
```

### Connection File I/O

**File**: `apps/vs-code-designer/src/app/utils/codeless/connection.ts`

- `getConnectionsJson()` — reads connections.json
- `addConnectionData()` / `saveConnectionReferences()` — writes back
- Connection keys generated via `listConnectionKeys` ARM call
- App settings updated with connection keys in `local.settings.json`

### Auto-Creation Logic

**File**: `libs/designer/src/lib/core/actions/bjsworkflow/connections.ts`

- Auto-creates connections when: not multi-auth, not Agent connector, simple or OAuth-only params
- Validation helpers: `needsSimpleConnection`, `hasOnlyOAuthParameters`, `needsConfigConnection`, `needsOAuth`

---

## Connector Parameter Examples

### SQL Server (`connectionParameters`):
```json
{
  "server": { "type": "string", "uiDefinition": { "displayName": "SQL server name" } },
  "database": { "type": "string", "uiDefinition": { "displayName": "SQL database name" } },
  "authType": { "type": "string", "allowedValues": [...], "uiDefinition": { "displayName": "Authentication Type" } },
  "username": { "type": "string" },
  "password": { "type": "securestring" }
}
```

### Service Bus:
```json
{
  "connectionString": { "type": "securestring", "uiDefinition": { "displayName": "Connection String" } }
}
```

---

## Azure REST API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET .../providers/Microsoft.Web/locations/{location}/managedApis/{connector}?api-version=2018-07-01-preview` | Get connector metadata + connection parameters |
| `PUT .../providers/Microsoft.Web/connections/{name}?api-version=2018-07-01-preview` | Create a connection |
| `POST .../connections/{name}/confirmConsentCode` | OAuth consent confirmation |
| `POST .../connections/{name}/listConnectionKeys` | Get connection runtime key |
| `GET .../connections/{name}` | Get connection details/status |

---

## Proposed Implementation Plan

### Phase 1: Connection Parameter Discovery Service

Build a service that fetches required connection parameters from Azure managed API metadata.

**Adapt from MCP server** (`src/tools/connections.ts:287-323`):
- Call `GET .../managedApis/{connectorName}`
- Extract `connectionParameters` from response
- Filter to user-facing parameters (skip internal `token`, `token:*` params)
- Return structured definitions with display names, types, descriptions

### Phase 2: Chat-Based Parameter Collection

In the `@logicapps` chat participant:
1. Detect when a user-created action requires a managed API connection
2. Use the discovery service to get required parameters
3. Present parameters as questions to the user in chat
4. Collect responses (handle `securestring` types appropriately)
5. Support re-prompting with pre-filled values on failure

### Phase 3: Connection Creation & Validation

1. Use collected parameters to create ARM connection via `StandardConnectionService.createConnection()`
2. Write connection reference to `connections.json`
3. Test connection using existing `testConnection` logic (or MCP-style `testLinks`)
4. On failure: display error, show previously entered values, let user correct

### Phase 4: OAuth Connector Handling

For connectors requiring OAuth (Office 365, Outlook, etc.):
1. Detect OAuth parameters in connector metadata
2. Open consent URL in browser via `vscode.env.openExternal()`
3. Handle callback/confirmation flow
4. Test the authorized connection

---

## How This Relates to AgentChatConnectionCreation.md

The existing `AgentChatConnectionCreation.md` plan focuses on **opening the designer panel** so users can fill in connections via the UI. This MCP integration is complementary:

| Approach | When to Use | User Experience |
|----------|-------------|-----------------|
| **Designer Panel** (existing plan) | OAuth connectors, complex multi-auth | Opens designer with connections panel visible |
| **Chat Prompting** (this plan) | Simple param connectors (connection string, server/database) | Conversational collection without leaving chat |

Both can coexist — the chat flow handles simple cases inline, and falls back to designer panel for OAuth or complex scenarios.

---

## Key Files in This Monorepo

| File | Role |
|------|------|
| `apps/vs-code-designer/src/app/chat/tools/workflowTools.ts` | Chat agent tools — where connection creation is triggered |
| `libs/logic-apps-shared/src/designer-client-services/lib/connection.ts` | IConnectionService interface |
| `libs/logic-apps-shared/src/designer-client-services/lib/standard/connection.ts` | Standard connection service (ARM + local) |
| `libs/vscode-extension/src/lib/models/connection.ts` | connections.json models |
| `apps/vs-code-designer/src/app/utils/codeless/connection.ts` | Connection file I/O |
| `libs/designer/src/lib/core/actions/bjsworkflow/connections.ts` | Auto-creation logic & validation helpers |
| `apps/vs-code-react/src/app/designer/servicesHelper.ts` | VS Code webview service wiring |

---

## Open Questions

1. Where exactly is the `@logicapps` chat participant code? (Branch/file location)
2. Should connection secrets be stored in `local.settings.json` (current pattern) or VS Code secret storage?
3. How should multi-auth connectors be handled? (e.g., SQL supports Windows auth, SQL auth, AAD)
4. Should we detect existing compatible connections before creating new ones?
5. How to handle the gap between ARM connection creation (cloud resource) and local `connections.json` sync?

---

## Implementation Status & Recommendations

### ✅ Implemented

The following capabilities have been integrated directly into `workflowTools.ts`:

#### Connector Parameter Discovery & Classification
- **`fetchConnectorMetadata()`** — Calls `GET .../managedApis/{connectorName}` to retrieve connector metadata including `connectionParameters` and `connectionParameterSets`
- **`classifyConnectorAuthType()`** — Classifies connectors as `'simple'` | `'oauthOnly'` | `'credential'` | `'multiAuth'` based on their parameter shape
- **`extractUserFacingParameters()`** — Filters out hidden/internal params (token, token:*, hidden-constrained, connection-type)
- **`extractPromptableParameters()`** — Further filters out OAuth params, leaving only credential fields the user needs to fill in
- **`isHiddenParam()`** — Determines whether a connection parameter is internal/hidden

#### Smart Connection Routing
`tryResolveManagedApiConnection()` now routes based on connector classification:
1. **Reuse existing** → auto-picks first matching connection in resource group
2. **Simple** → auto-creates with empty params
3. **Credential-based** → prompts user via `vscode.window.showInputBox` (with `password: true` for securestring) → creates ARM connection with `parameterValues`
4. **OAuth-only** → existing inline OAuth flow (browser popup + consent)
5. **Multi-auth** → falls back with message directing user to designer panel

#### Credential-Based Connection Creation
- **`createCredentialBasedConnection()`** — Creates ARM connection with user-provided `parameterValues` in the PUT body
- **`promptForCredentials()`** — Prompts for each parameter using VS Code input boxes (secure input for secrets, QuickPick for enum values)

#### `connectionRuntimeUrl` Fix (Critical Bug Fix)
- **`fetchConnectionKey()`** now returns `ConnectionKeyResult` with both `connectionKey` and `connectionRuntimeUrl` (from `runtimeUrls[0]`)
- **`addRealManagedApiConnection()`** now accepts and writes `connectionRuntimeUrl` to `connections.json`
- All callers (`tryReuseExistingConnection`, `createAndAuthManagedApiConnection`, `createCredentialBasedConnection`) updated

#### Post-Creation Connection Testing
- **`testManagedApiConnection()`** — Checks connection status and follows `testLinks`/`testRequests` after creation
- Non-blocking: logs warning on failure, shows VS Code warning message, but doesn't prevent connection use

### ⚠️ Resolved Open Questions

1. **Chat participant location**: `apps/vs-code-designer/src/app/chat/logicAppsChatParticipant.ts`
2. **Secret storage**: Secrets stay in `local.settings.json` (current pattern) — changing would break existing flows. Secrets are collected via `showInputBox({password: true})`, NOT in chat text, to avoid chat history/telemetry exposure.
3. **Multi-auth handling**: Falls back to designer panel with descriptive message listing available auth types.
4. **Existing connection detection**: Yes — `tryReuseExistingConnection()` checks resource group first.
5. **ARM/local sync**: `connectionRuntimeUrl` is now fetched from `listConnectionKeys` and written to `connections.json`.

### 🔮 Deferred / Future Work

- **ACL creation for API Hub connections** — The chat path doesn't create access policies on created connections. The `StandardConnectionService` does this, but it requires a fully initialized designer context. This could cause runtime failures when the Logic App's managed identity can't access the connection.
- **Dynamic parameter support** (`x-ms-dynamic-values`) — Some connectors have cascading dropdowns where field options depend on previously entered values. Not feasible in the current chat/input-box UX.
- **Connection reuse compatibility checks** — Current reuse picks the first matching connector by name. For connectors like SQL, this could silently bind to the wrong server/database. Future: check `parameterValues` match.
- **Rollback on partial failure** — If ARM connection creation succeeds but local file writes fail, orphaned Azure connections are left. Future: add cleanup logic.
- **Name generation alignment** — The chat path uses timestamped names; should align with `StandardConnectionService.getUniqueConnectionName()`.

### 📊 Test Coverage

- **86 unit tests** in `connectionResolution.test.ts` covering:
  - `classifyConnectorAuthType()` — all 4 auth types, edge cases, single/multi parameter sets
  - `extractUserFacingParameters()` — token filtering, hidden constraints, OAuth handling
  - `extractPromptableParameters()` — OAuth + hidden filtering
  - `isHiddenParam()` — all hidden types, case insensitivity
  - `addRealManagedApiConnection()` — connectionRuntimeUrl with Raw Keys, MSI, and combined
- **361 total tests** across all chat test files pass
