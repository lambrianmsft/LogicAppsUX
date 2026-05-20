# VS Code Chat Agent Testing Knowledge

Curated durable learnings for authenticated Copilot Chat extension-host tests and VS Code chat-agent regressions. Add entries through `session-knowledge-curator`.

## Triggers → use this file

- Authenticated Copilot Chat E2E / VS Code chat agent / `Chat Tests (Extension Host)`
- `runChatTests` / `sendChatAndWait` / `chatParticipant.test.ts`
- `azureLogicAppsStandard.startChatTests` / no-picker Chat Tests launch automation
- Chat participant orchestration, natural-language tool routing, model-mediated workflow generation
- Workflow-shape assertions for chat-created `workflow.json`

## Core Sources

- `.vscode/launch.json` (`Chat Tests (Extension Host)`)
- `apps/vs-code-designer/.vscode/launch.json`
- `apps/vs-code-designer/src/test/e2e/runChatTests.ts`
- `apps/vs-code-designer/src/test/e2e/integration/chatParticipant.test.ts`
- `apps/vs-code-designer/src/app/commands/startChatTests.ts`
- `apps/vs-code-designer/src/app/commands/registerCommands.ts`
- `apps/vs-code-designer/src/constants.ts`
- `apps/vs-code-designer/src/app/chat/logicAppsChatParticipant.ts`
- `apps/vs-code-designer/src/app/chat/tools/workflowTools.ts`

## Current Learnings

### Validated authenticated Chat Tests launch path

- Learning: The validated path for authenticated VS Code chat-agent E2E is the LogicAppsUX root `Chat Tests (Extension Host)` launch, or the equivalent `azureLogicAppsStandard.startChatTests` command, with all of the following: `runtimeExecutable: "${execPath}"`, `--extensionDevelopmentPath=.../apps/vs-code-designer/dist`, `--extensionTestsPath=.../apps/vs-code-designer/out/test/e2e/runChatTests`, the test workspace `apps/vs-code-designer/e2e/test-workspace/test-workspace.code-workspace`, and `LAUX_CHAT_TESTS=1`.
- Success signals: In the Extension Development Host, the Azure Logic Apps output channel should show `[chat-tests] Fast activation enabled. Registering chat participant and skipping startup services.`; the Chat UI should visibly run the automated prompts; and `apps/vs-code-designer/chat-test-results.log` should refresh, advance through suites, and eventually include `=== DONE: ... ===`.
- Why it matters: A normal Extension Development Host can look similar but will not run authenticated chat tests. The validated path proves the extension-test runner entered `runChatTests`, the Logic Apps chat participant/tools registered, and the full product startup path did not block Mocha.
- Source: User-confirmed successful authenticated F5 run on 2026-05-20 after adding `LAUX_CHAT_TESTS=1` fast activation; `.vscode/launch.json`, `apps/vs-code-designer/src/main.ts`, `apps/vs-code-designer/src/app/commands/startChatTests.ts`, `apps/vs-code-designer/src/test/e2e/runChatTests.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `chief-engineer`, `ci-sentinel`.
- Status: verified.

### Authenticated Copilot Chat E2Es must use the current VS Code auth session

- Learning: Authenticated chat tests must launch through the LogicAppsUX root `.vscode/launch.json` configuration `Chat Tests (Extension Host)`, or through an equivalent command that calls `vscode.debug.startDebugging` with that root config shape. The critical setting is `runtimeExecutable: "${execPath}"`, which reuses the currently authenticated VS Code executable/session so Copilot auth and model state are available.
- Why it matters: The nested `apps/vs-code-designer/.vscode/launch.json`, `vscode-test --label chatTests`, `code --extensionTestsPath`, and `apps/vs-code-designer/run-chat-tests.js` are not equivalent to authenticated current-window execution. They spawn or approximate a separate VS Code process/profile and can miss Copilot account, model, or profile state.
- Agent rule: Do not rely on picker-driven `workbench.action.debug.selectandstart` in multi-root workspaces. The command tool cannot reliably select the right debug config, and `debug.startFromConfig` requires object arguments that the command tool cannot pass. Use `azureLogicAppsStandard.startChatTests`, which stops any active debug session and then wraps `vscode.debug.startDebugging(...)` with the root chat test config.
- Launch hygiene: Stop existing Extension Host/debug sessions before starting Chat Tests. Multiple active debug hosts make it unclear which process owns `chat-test-results.log` and can leave stale or partial runs that look like current failures.
- Source: `.vscode/launch.json`, `apps/vs-code-designer/.vscode/launch.json`, `apps/vs-code-designer/src/app/commands/startChatTests.ts`, `apps/vs-code-designer/src/test/e2e/runChatTests.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `ci-sentinel`, `chief-engineer`.
- Status: verified.

### Launch success requires completion evidence

- Learning: Prior session history shows the team identified the correct authenticated launch mechanism, but it does not prove an agent-launched Chat Tests run completed successfully. Treat a launch as successful only when `apps/vs-code-designer/chat-test-results.log` has a fresh run timestamp, advances beyond the initial suite header, and includes the `=== DONE: 0 failure(s) ===` completion marker or explicit pass/fail counts from `runChatTests.ts`.
- Why it matters: A visible Extension Host window, a compiled `out/test/e2e/runChatTests.js`, or a freshly written log header can still represent a wrong debug config, stale/partial run, or runner startup failure. These signals are not enough to validate authenticated Chat Tests.
- Source: Copilot session-history review on 2026-05-19 across current and prior Chat Tests sessions; `apps/vs-code-designer/src/test/e2e/runChatTests.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `ci-sentinel`, `chief-engineer`.
- Status: verified.

### Chat Tests workspace must suppress startup runtime work

- Learning: If `Chat Tests (Extension Host)` opens the Extension Development Host but no chat automation appears, check whether `apps/vs-code-designer/chat-test-results.log` starts only as the host is shutting down. A log containing only `Tool Registration & Schema`, paired with extension-host logs showing `workspaceContains:host.json`, dependency validation, or `func host start`, means the extension test runner was delayed behind Logic Apps startup onboarding/runtime work.
- Fix pattern: The dedicated chat test workspace must set `azureLogicAppsStandard.autoRuntimeDependenciesValidationAndInstallation=false`, `azureLogicAppsStandard.autoStartDesignTime=false`, `azureLogicAppsStandard.showStartDesignTimeMessage=false`, `azureLogicAppsStandard.autoStartAzurite=false`, `azureLogicAppsStandard.silentAuth=true`, disable extension auto updates, and set `update.mode=none` in both `.vscode/settings.json` and `test-workspace.code-workspace` settings.
- Why it matters: The authenticated launch can be correct and still look inert because VS Code waits for startup activation before Mocha begins. The runner may write its first log line only after the user stops the host, which misleads debugging toward chat UI automation even though the test body never got a clean start.
- Source: Regression diagnosis on 2026-05-20; `apps/vs-code-designer/e2e/test-workspace/.vscode/settings.json`, `apps/vs-code-designer/e2e/test-workspace/test-workspace.code-workspace`, `apps/vs-code-designer/src/test/e2e/runChatTests.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `chief-engineer`.
- Status: verified.

### Chat Tests launch must use fast activation

- Learning: Workspace settings alone do not prevent `workspaceContains:host.json` from activating the full Logic Apps extension dependency chain before the VS Code extension-test runner starts. If the Extension Development Host opens, `chat-test-results.log` stays stale, and logs show only `Loading development extension` plus dependency activation, the runner is waiting behind extension startup.
- Fix pattern: `Chat Tests (Extension Host)` launch configs and `azureLogicAppsStandard.startChatTests` must set `LAUX_CHAT_TESTS=1`. `main.activate()` uses that flag to initialize the extension shell and register the chat participant/tools, then skip onboarding, resource-tree setup, language server startup, dependency validation, and design-time startup.
- Source: Regression diagnosis on 2026-05-20; `.vscode/launch.json`, `apps/vs-code-designer/.vscode/launch.json`, `apps/vs-code-designer/src/main.ts`, `apps/vs-code-designer/src/app/commands/startChatTests.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `chief-engineer`.
- Status: verified.

### VS Code command-tool completion is not handler execution proof

- Learning: The Copilot `run_vscode_command` tool can report `Finished running command` for `azureLogicAppsStandard.startChatTests` without proving that the installed Logic Apps extension handler ran. Diagnostic breadcrumbs added to `startChatTests.ts` must appear in the Azure Logic Apps output log as `[chat-tests] Command invoked.` before treating the command path as having entered the extension code.
- Why it matters: After installing a diagnostic build, invoking `azureLogicAppsStandard.startChatTests` through the command tool left `chat-test-results.log` stale, produced no matching `runChatTests`/`extensionTestsPath` process, and emitted no `[chat-tests]` output-channel lines. Manual Command Palette/F5 launch still exercises the VS Code workbench/debug control plane differently from this command tool path.
- Retest: On 2026-05-20, after `pnpm run build:extension` and `pnpm run test:e2e-cli:compile` succeeded, the command contribution was present in both `apps/vs-code-designer/src/package.json` and `apps/vs-code-designer/dist/package.json`. The Copilot command tool again reported completion for `azureLogicAppsStandard.startChatTests`, but `apps/vs-code-designer/chat-test-results.log` stayed stale at the previous run, no matching `Code.exe` process contained `extensionTestsPath`/`runChatTests`, and recent logs had no fresh `[chat-tests] Command invoked.` breadcrumb.
- Source: Diagnostic retry on 2026-05-20 with `apps/vs-code-designer/src/app/commands/startChatTests.ts` breadcrumbs and VS Code output-log inspection.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `ci-sentinel`, `chief-engineer`.
- Status: verified.

### Terminal-only Chat Tests launch routes are not validated autonomous paths

- Learning: Retested terminal-only routes on 2026-05-20 after `LAUX_CHAT_TESTS=1` fast activation was wired. `code.cmd --reuse-window --command azureLogicAppsStandard.startChatTests` exited `0` but VS Code warned that `command` is not a known option; `chat-test-results.log` stayed stale. `code.cmd --reuse-window --extensionDevelopmentPath=... --extensionTestsPath=... test-workspace.code-workspace` also exited `0` with no fresh `runChatTests` process, no `[chat-tests]` log evidence, and no results-log refresh. `node apps/vs-code-designer/run-chat-tests.js` with `LAUX_CHAT_TESTS=1` reached `@vscode/test-electron` but failed before tests because extension tests from the command line cannot reuse the real `Code` user-data dir while this VS Code instance is already running.
- Why it matters: A terminal command can open or focus a VS Code window, return success, or even start the wrong kind of test-electron process without entering the authenticated `Chat Tests (Extension Host)` runner. Treat these routes as invalid/limited until hard evidence proves otherwise.
- Required proof for any future terminal automation: fresh `apps/vs-code-designer/chat-test-results.log` timestamp, visible suite progress, `=== DONE: ... ===`, and matching process/log evidence for `--extensionTestsPath=.../runChatTests` plus `[chat-tests] Fast activation enabled...`.
- Source: Chief-engineer retest on 2026-05-20 using absolute VS Code CLI shim, direct extension-test CLI args, and `run-chat-tests.js` with `LAUX_CHAT_TESTS=1`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `ci-sentinel`, `chief-engineer`.
- Status: verified.

### Chat regressions must exercise the chat participant path

- Learning: Chat regression tests must send prompts through `sendChatAndWait` in `apps/vs-code-designer/src/test/e2e/integration/chatParticipant.test.ts`, loaded by `apps/vs-code-designer/src/test/e2e/runChatTests.ts`. Direct `vscode.lm.invokeTool(...)` or helper-level tool calls are useful tool-implementation coverage, but they are not true chat-path regression coverage.
- Why it matters: Chat-path bugs can live in prompt interpretation, model/tool routing, parameter extraction, or participant orchestration. Calling the tool directly bypasses those layers and can falsely pass.
- Source: `apps/vs-code-designer/src/test/e2e/integration/chatParticipant.test.ts`, `apps/vs-code-designer/src/test/e2e/runChatTests.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `senior-swe-reviewer`.
- Status: verified.

### Chat regression prompts should stay natural

- Learning: Chat-agent E2E prompts should resemble real user requests. Avoid telling the model the exact connector reference, operation name, action names, missing-parameter diagnosis, or optional-parameter rules unless that detail is itself part of the user scenario. Prefer workflow diffs and generated `workflow.json` shape assertions over hardcoded action names.
- Why it matters: Overly prescriptive prompts can make tests follow a formula and hide weaknesses in natural-language intent extraction, connector/action selection, swagger-required parameter discovery, clarification behavior, and parameter routing.
- Source: `apps/vs-code-designer/src/test/e2e/integration/chatParticipant.test.ts` Suite 30 and Suite 31 parameter-routing coverage.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `senior-swe-reviewer`.
- Status: verified.

### Weather chat regressions assert the written workflow shape

- Learning: Full chat E2E coverage for msnweather parameter routing must assert the resulting `workflow.json`, not only chat/tool success text.
- Required assertions: the weather action path is `/current/@{encodeURIComponent('...Seattle...')}`, the path does not contain `{Location}`, the path does not use the removed `98101` Seattle hardcode, there are no top-level `inputs.location`, `inputs.Location`, `inputs.units`, `inputs.Units`, or `inputs.parameters` fields, and `inputs.queries.units === 'I'` when the user asks for Imperial units.
- Why it matters: The regression involved routing user-provided connector parameters into the correct path/query locations. Text-only assertions or direct tool calls can miss malformed workflow JSON that still appears successful.
- Source: `apps/vs-code-designer/src/test/e2e/integration/chatParticipant.test.ts`.
- Applies to: `vscode-test-specialist`, `test`, `vscode`, `senior-swe-reviewer`.
- Status: verified.
