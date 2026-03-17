# VS Code Extension E2E Tests

This directory contains end-to-end tests for the Logic Apps VS Code extension using the official `@vscode/test-cli` framework and the Extension Development Host.

## Test Categories

### 1. CLI Tests (`extension.test.ts`, `commands.test.ts`)
Basic extension activation and command registration tests. Run in an isolated VS Code instance — no Copilot or authentication needed.

### 2. Integration Tests (`integration/`)
Workflow file handling, designer panel, workspace configurations. Run in an isolated VS Code with the extension loaded.

### 3. Chat Participant Tests (`integration/chatParticipant.test.ts`) ⭐
**67 tests** covering the `@logicapps` chat participant — tool registration, tool invocation with disk verification, LLM availability, and chat-driven workflows. **Requires GitHub Copilot** and runs in the Extension Development Host with your real authentication.

## Test Structure

```
src/test/e2e/
├── extension.test.ts                    # Extension activation tests
├── commands.test.ts                     # Command registration tests
├── runTest.ts                           # CLI test runner entry point
├── runChatTests.ts                      # Chat test runner (Extension Host)
└── integration/
    ├── chatParticipant.test.ts          # Chat participant tests (67 tests)
    ├── workflow.test.ts                 # Workflow file tests
    ├── designer.test.ts                 # Designer panel tests
    ├── createWorkspace.test.ts          # Workspace creation tests
    ├── designerOpens.test.ts            # Designer open tests
    ├── nodeLoading.test.ts              # Node loading tests
    ├── debugging.test.ts                # Debug tests
    ├── workspaceConfigurations.test.ts  # Workspace config tests
    └── workspaceConversion.test.ts      # Workspace conversion tests
```

## Running Tests

### Chat Participant Tests (recommended method)

These tests require **GitHub Copilot** to be installed and authenticated. They run in the Extension Development Host, which inherits your real VS Code extensions and authentication.

#### Method 1: VS Code Debug (F5) — interactive

1. Build the extension: `pnpm run build:extension` (from repo root)
2. Compile tests: `cd apps/vs-code-designer && pnpm run test:e2e-cli:compile`
3. Open the **Run and Debug** panel (`Ctrl+Shift+D`)
4. Select **"Chat Tests (Extension Host)"** from the dropdown
5. Press **F5**
6. Results appear in the **Debug Console** panel

The Extension Development Host window will open with your test workspace, run all 67 tests, and close automatically. Results are also written to `chat-test-results.log` in the project root.

#### Method 2: CLI (isolated, no Copilot)

Runs in an isolated VS Code — tool registration and schema tests pass, but tool invocation and LLM tests will skip because Copilot isn't available.

```bash
cd apps/vs-code-designer
pnpm run test:e2e-cli:compile
node node_modules/@vscode/test-cli/out/bin.mjs --label chatTests
```

### CLI Tests (basic)

```bash
# Run all CLI tests (no Copilot needed)
cd apps/vs-code-designer
pnpm run test:e2e-cli --label unitTests

# Compile tests only
pnpm run test:e2e-cli:compile
```

## Chat Participant Test Suites

| Suite | Tests | What's Verified |
|-------|-------|----------------|
| **Tool Registration & Schema** | 6 | All 6 tools registered, descriptions non-empty, schema structure (required/optional fields) |
| **listWorkflows** | 5 | Finds Stateful1, reports type, count format, project/workflow path |
| **getWorkflowDefinition** | 7 | JSON structure ($schema, triggers, actions, kind), not-found, empty name |
| **createWorkflow** | 2 | Valid name opens wizard, no files created |
| **createProject Validation** | 5 | Invalid name, empty name, missing workflow/type, invalid type |
| **addAction** | 5 | Compose with inputs verification, disk existence, type=Compose, cross-check via getWorkflowDefinition |
| **createWorkflow Validation** | 4 | Invalid name, empty, special chars, valid accepted |
| **Chat-driven Workflow** | 2 | Stateful workflow created on disk (definition, $schema, kind), appears in listWorkflows |
| **Chat-driven Add Action** | 1 | Action snapshot before/after, new actions have type |
| **LLM Availability** | 1 | Models available (filtered) |
| **Chat Commands (E2E)** | 5 | /help, list workflows cross-check, get definition file unchanged, general question no side effects |
| **Multiple Action Types** | 4 | Request trigger (type+kind), Response (type), HTTP (type), empty name |
| **Stateless Workflow** | 1 | Stateless kind verified on disk |
| **modifyAction** | 5 | Modify inputs verified on disk, non-existent action/workflow, invalid JSON |
| **Recurrence Trigger** | 2 | Type=Recurrence in triggers on disk |
| **Error Cases** | 2 | Fake connector, ApiConnection without method/path |
| **Schema Validation** | 2 | modifyAction and createProject required fields |
| **Natural Language Help** | 1 | No workspace side effects |
| **ServiceProvider Connectors** | 3 | AzureBlob/ServiceBus actions, connections.json structure |
| **Multi-Project** | 3 | Multiple projects listed, disambiguation triggered, direct project resolution |
| **Chat ServiceProvider** | 1 | Chat-driven ServiceProvider action with disk verification |

## Test Workspace

The test workspace at `e2e/test-workspace/` contains:
- `host.json` — Logic Apps extension bundle (makes it a valid Logic App project)
- `Stateful1/workflow.json` — A stateful workflow with empty triggers/actions
- `local.settings.json` — Azure subscription settings
- `test-workspace.code-workspace` — Workspace file (required to avoid conversion prompts)
- `.funcignore`, `package.json` — Standard project files

## Test Design Principles

### Disk verification over response text
Every test that creates or modifies something verifies the **actual file on disk**, not just the tool's response text. This catches bugs where the tool claims "Successfully added" but the file doesn't reflect the change.

### Polling over fixed sleeps
Chat-driven tests use `sendChatAndWait()` which polls for file changes (500ms intervals) instead of sleeping a fixed 20-30 seconds. This reduced total runtime from ~4 minutes to ~90 seconds.

### Cleanup after every suite
Each test suite cleans up its artifacts (created workflows, actions, project folders) in `suiteTeardown`. The first suite also runs `cleanupTestArtifacts()` to remove leftovers from previous failed runs.

### Strict assertions catch product bugs
Assertions check specific values (e.g., `type === 'Compose'`, `kind === 'Http'`, inputs preserved) rather than just existence. This approach already caught a real bug: `buildActionDefinition()` was dropping non-object `inputs` values for Compose actions.

## Configuration

### `.vscode-test.mjs`
Defines test configurations:
- `unitTests` — isolated, `--disable-extensions`
- `integrationTests` — isolated with extension loaded
- `chatTests` — loads extension from `dist/`, opens test workspace

### `.vscode/launch.json` (workspace root)
Contains the **"Chat Tests (Extension Host)"** debug configuration that runs `runChatTests.ts`.

### `tsconfig.e2e.json`
TypeScript config for e2e tests — compiles to `out/test/e2e/`.

## Adding New Tests

1. Add your test in `integration/chatParticipant.test.ts`
2. Use the `invokeTool()` helper for direct tool testing
3. Use `sendChatAndWait()` for chat-driven testing with polling
4. Always verify file system side effects, not just response text
5. Clean up in `suiteTeardown`
6. Compile: `pnpm run test:e2e-cli:compile`
7. Run: F5 with "Chat Tests (Extension Host)"
