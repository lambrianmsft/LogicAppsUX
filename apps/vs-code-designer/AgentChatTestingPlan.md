# Chat Experience Test Plan

## Overview

Manual test cases for the `@logicapps` chat participant in the VS Code Logic Apps extension. Run these to verify chat-driven workflow authoring, connector support, and designer hot refresh.

## Prerequisites

- Open a workspace with at least one Logic App project (e.g., `TonyProject`)
- Project has `host.json` with the Logic Apps extension bundle
- `connections.json` has at least one managed API connection (e.g., `sql`, `msweather`)
- At least one workflow exists (e.g., `Stateful1`)
- Design-time runtime is started (required for built-in connector tests)
- Signed into Azure in VS Code (required for managed API swagger tests)

---

## 1. Help & Intent Routing

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 1.1 | `@logicapps /help` | Shows help markdown with all commands, workflow types, and tips | Help text includes `/createProject`, `/createWorkflow`, `/modifyAction` |
| 1.2 | `@logicapps what can you help me with?` | Routes to help (no slash command needed) | Same help content as 1.1 |
| 1.3 | `@logicapps how's the weather?` | General LLM response, no tool calls | No workflow.json changes |

---

## 2. List & Get Workflows (Read-Only)

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 2.1 | `@logicapps list all workflows` | Lists all workflows across all projects with name, type, project | Output includes project name + workflow name + kind |
| 2.2 | `@logicapps show me the definition of Workflow1 in TonyProject` | Returns JSON definition | JSON contains `$schema`, `triggers`, `actions` |
| 2.3 | `@logicapps get workflow definition for NonExistent` | Error message | "Workflow not found" message |
| 2.4 | `@logicapps get definition of Workflow1` (exists in 2 projects) | Disambiguation prompt | Lists both projects, asks to specify |

---

## 3. Create Project

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 3.1 | `@logicapps create a Logic App project called TestProject with a stateful workflow called OrderFlow` | Project created with initial workflow | `TestProject/host.json`, `TestProject/OrderFlow/workflow.json` exist; kind is `Stateful` |
| 3.2 | `@logicapps create a project called MyApp` (no workflow specified) | Asks what workflows to create | Follow-up prompt about workflow name/type |
| 3.3 | `@logicapps create project called TestProject` (already exists) | Redirects to add workflows to existing | Message says project exists |
| 3.4 | `@logicapps create a Logic App project with custom code` | Asks for project name, then creates with Functions project | `projectType` is `logicAppCustomCode` |

---

## 4. Create Workflows

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 4.1 | `@logicapps /createWorkflow a stateful workflow called OrderProcessor in TonyProject` | Workflow created | `TonyProject/OrderProcessor/workflow.json` with kind=Stateful |
| 4.2 | `@logicapps create 3 stateful workflows called Batch in TonyProject` | Creates Batch1, Batch2, Batch3 | Three folders with workflow.json, all Stateful |
| 4.3 | `@logicapps create 5 workflows from Test1-5 in TonyProject` | Asks for workflow type, then creates | After type reply: Test1..Test5 folders exist |
| 4.4 | `@logicapps create a workflow called 123Invalid` | Validation error | "must start with a letter" message |

---

## 5. Add Trigger

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 5.1 | `@logicapps add a Request trigger called manual_trigger to Workflow1 in TonyProject` | Trigger added | `definition.triggers.manual_trigger` has `type: "Request"`, `kind: "Http"` |
| 5.2 | `@logicapps add a Recurrence trigger to Workflow1` | Trigger added | `definition.triggers` has `type: "Recurrence"` |

---

## 6. Add Action — Built-in ServiceProvider Connectors

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 6.1 | `@logicapps add an Azure Blob read action called Read_Blob to Workflow1 in TonyProject` | ServiceProvider action created | `type: "ServiceProvider"`, `serviceProviderId: "/serviceProviders/AzureBlob"` |
| 6.2 | `@logicapps add a Service Bus send message action called Send_Message to Workflow1` | ServiceProvider action | `serviceProviderConfiguration.operationId` matches send operation |
| 6.3 | `@logicapps add a Cosmos DB action called Query_Items to Workflow1` | ServiceProvider action | `serviceProviderId` contains Cosmos |
| 6.4 | Verify connections.json after 6.1 | Placeholder entry added | `serviceProviderConnections.AzureBlob` exists |

---

## 7. Add Action — Managed API Connectors (Existing in connections.json)

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 7.1 | `@logicapps add an action called List_Orders using SQL to list rows from Orders to Workflow1 in TonyProject` | ApiConnection with canonical SQL path | `type: "ApiConnection"`, path contains `encodeURIComponent`, `operationId` present |
| 7.2 | `@logicapps add an action called Get_Order_By_Id using SQL to get a row by id` | Single-item SQL path | Path includes `items/` suffix with encoded id |
| 7.3 | `@logicapps add a weather action to get Seattle weather to Workflow1` | Weather connector action | Uses existing `msweather` reference |

---

## 8. Add Action — Managed API Connectors (NOT in connections.json)

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 8.1 | `@logicapps add a SharePoint action called Get_Files to Workflow1 using sharepoint` | ApiConnection + placeholder | `managedApiConnections.sharepoint` in connections.json |
| 8.2 | `@logicapps add an Office 365 send email action called Send_Email to Workflow1` | Action + placeholder | `managedApiConnections.office365` in connections.json |
| 8.3 | Verify connections.json after 8.1 | Placeholder has correct ARM path | `api.id` starts with `/subscriptions/` (not `@appsetting()`) |

---

## 9. Add Action — Error Cases

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 9.1 | `@logicapps add an action to NonExistentWorkflow` | Workflow not found | Error message |
| 9.2 | `@logicapps add an action using connectorReference fakeconnector` | Connector not found | Error listing available refs |
| 9.3 | `@logicapps add an ApiConnection action without method or path` | Validation error | "requires method and path" |

---

## 10. Modify Action

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 10.1 | `@logicapps /modifyAction in Workflow1, change the Response action status code to 201` | Response action updated | `statusCode` is `201` in workflow.json |
| 10.2 | `@logicapps change the timeout on Send_Email to 60 seconds in Workflow1` | Action updated | Timeout property present |
| 10.3 | `@logicapps modify NonExistentAction in Workflow1` | Action not found | "not found in workflow" message |

---

## 11. @appsetting() Resolution

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 11.1 | Add any managed connector action when `connections.json` uses `@appsetting('WORKFLOWS_SUBSCRIPTION_ID')` | Resolves to real subscription ID | Diagnostic should NOT show `@appsetting` in connector ID |

---

## 12. {connectionId} Path Normalization

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 12.1 | Add any managed connector action via swagger | Path clean | `inputs.path` has no `{connectionId}` prefix |

---

## 13. Designer Hot Refresh — With Designer Open

**Setup:** Open the designer for the target workflow FIRST, then run the chat prompt. Verify the designer updates without closing/reopening.

### Triggers

| # | Prompt (with designer open) | Expected Designer Behavior | Verify |
|---|----------------------------|---------------------------|--------|
| 13.1 | `@logicapps add a Request trigger called HTTP_Trigger to Stateful1 in TonyProject` | Trigger node appears at top of canvas | Node visible, no error badge |
| 13.2 | `@logicapps add a Recurrence trigger called Schedule to Stateful1` | Recurrence trigger node appears | Node visible, no error badge |

### Built-in ServiceProvider Actions

| # | Prompt (with designer open) | Expected Designer Behavior | Verify |
|---|----------------------------|---------------------------|--------|
| 13.3 | `@logicapps add an Azure Blob read action called Read_Blob to Stateful1 in TonyProject` | ServiceProvider node appears | Azure Blob icon, no error |
| 13.4 | `@logicapps add a Service Bus send message called Send_SB_Message to Stateful1` | ServiceProvider node appears | Service Bus icon, no error |
| 13.5 | `@logicapps add a Cosmos DB action called Query_Cosmos to Stateful1` | ServiceProvider node appears | Cosmos DB icon, no error |

### Managed API Connectors (existing in connections.json)

| # | Prompt (with designer open) | Expected Designer Behavior | Verify |
|---|----------------------------|---------------------------|--------|
| 13.6 | `@logicapps add an action called List_SQL_Items using SQL to list rows to Stateful1 in TonyProject` | ApiConnection node appears | SQL icon, no "Unable to initialize" error |
| 13.7 | `@logicapps add a weather action called Get_Weather to Stateful1` | ApiConnection node appears | Weather icon, no error |

### Managed API Connectors (NOT in connections.json)

| # | Prompt (with designer open) | Expected Designer Behavior | Verify |
|---|----------------------------|---------------------------|--------|
| 13.8 | `@logicapps add a SharePoint action called Get_SP_Files to Stateful1 using sharepointonline` | ApiConnection node appears | Node visible; connections.json has placeholder |
| 13.9 | `@logicapps add an Office 365 send email called Send_Email to Stateful1 using office365` | ApiConnection node appears | Node visible; placeholder connection added |

### Generic Actions

| # | Prompt (with designer open) | Expected Designer Behavior | Verify |
|---|----------------------------|---------------------------|--------|
| 13.10 | `@logicapps add an HTTP action called Call_API to Stateful1 with method GET and uri https://api.example.com` | HTTP action node appears | HTTP icon, no error |
| 13.11 | `@logicapps add a Response action called Return_200 to Stateful1 with status code 200` | Response node appears | Response icon |

### Modify Existing Action (with designer open)

| # | Prompt (with designer open) | Expected Designer Behavior | Verify |
|---|----------------------------|---------------------------|--------|
| 13.12 | `@logicapps modify the Return_200 action in Stateful1 to have status code 201` | Existing node updates | Click node → statusCode=201 |

### Stress & Edge Cases

| # | Action | Expected Designer Behavior | Verify |
|---|--------|---------------------------|--------|
| 13.13 | Run 3 consecutive add-action prompts in quick succession | Designer refreshes after each | All 3 nodes visible, no duplicates |
| 13.14 | Make a change in designer UI, click Save | No flicker/double-refresh | Save completes cleanly |

---

## 14. Multi-Project Disambiguation

| # | Prompt | Expected Result | Verify |
|---|--------|----------------|--------|
| 14.1 | `@logicapps add action to Workflow1` (exists in 2 projects) | Asks which project | Lists both projects |
| 14.2 | Reply `TonyProject` to 14.1 | Action added to correct project | Correct workflow.json updated |
| 14.3 | `@logicapps in TonyProject, add action to Workflow1` | No disambiguation needed | Direct execution |

---

## 15. Regression Guards

Run these after EVERY change:

| # | What to Check | How to Verify |
|---|--------------|---------------|
| 15.1 | No "Unable to initialize operation details" on new actions | Open designer after every add-action test |
| 15.2 | `operationId` present on ApiConnection actions | Check workflow.json |
| 15.3 | No fabricated file links in chat responses | Scan response text |
| 15.4 | `connections.json` placeholders well-formed | `api.id` is valid ARM path, `serviceProvider.id` starts with `/serviceProviders/` |
| 15.5 | Unit tests pass | `pnpm run test:extension-unit` — 246+ tests, 0 failures |
| 15.6 | Build passes | `pnpm --dir apps/vs-code-designer exec tsc --noEmit` |

---

## Verification Protocol for Designer-Open Tests (Section 13)

After every designer-open test, check these **5 things**:

1. **Node visible** — New action/trigger node appears on canvas within ~2 seconds
2. **No error badge** — No red/orange "Unable to initialize operation details" error
3. **Clickable** — Clicking the node opens its parameters panel without error
4. **Correct shape** — Parameters panel shows expected connector type and operation
5. **workflow.json consistent** — JSON file matches what the designer shows

---

## Failure Modes Reference

| Failure | What It Looks Like | Root Cause to Check |
|---------|-------------------|---------------------|
| Node doesn't appear | Designer unchanged after chat completes | FileSystemWatcher not firing; check `refresh_workflow` command path |
| Node has error badge | "Unable to initialize operation details" | Non-canonical path; check `{connectionId}` stripping, `@appsetting()` resolution |
| Designer goes blank | White screen or error boundary | `resetWorkflowState` conflict with in-flight operations |
| Double refresh flicker | Canvas re-renders twice | Save suppress flag not working |
| Old action disappears | Previously working action shows error | `resetWorkflowState` clearing cached connector metadata |

---

## Test Execution Cadence

| When | Run These Sections |
|------|--------------------|
| Before each PR | 1–3, 5–7, 13.1–13.7, 15 |
| After connector changes | 6–9, 11–12 |
| After chat routing changes | 1–4, 10, 14 |
| After designer integration changes | 13 (all) |
| Always (non-negotiable) | 15 (regression guards) |
