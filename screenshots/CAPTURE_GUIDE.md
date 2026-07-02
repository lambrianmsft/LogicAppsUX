# LogicAppsUX VS Code — Screenshot Capture Guide

**Purpose:** Curated PNG screenshots for ADO test plan 9712199 (Logic Apps OGF).
**Extension source:** `apps/vs-code-designer` in this worktree.
**Bundle:** `apps/vs-code-designer/dist/main.js` (already built — see "Build status" below).

> The capture session assistant could not drive VS Code UI headlessly. This document is a click-by-click script for you (a human) to execute against a live VS Code Extension Development Host and drop PNGs into `screenshots/` (and mirror to `C:\Users\lambrian\.copilot\session-state\40e537fd-a419-4d5a-9100-af8a638b987a\files\new-testcases\screenshots\`).

---

## 0. Build status

- `pnpm install` completed cleanly at repo root.
- `pnpm --filter vscode-designer run build:extension` finished with tsup output in `apps/vs-code-designer/dist/` (main.js ~19 MB, node_modules installed).
- **Caveat:** the tsup type-check step reported 22 pre-existing TS errors across 8 files (mostly `Buffer` / `Uint8Array<ArrayBufferLike>` typing regressions from `@types/node`, plus `azureClients.ts`). tsup still bundled successfully so the extension loads in an EDH. If VS Code activation fails, run `pnpm --filter vscode-designer exec tsup` alone to bypass the type-check gate and re-verify.

## 1. Launch the Extension Development Host

Open a fresh terminal in the repo root (`D:\dev\copilot-worktrees\LogicAppsUX\lambrianmsft-glowing-couscous`) and run:

```powershell
code --extensionDevelopmentPath="D:\dev\copilot-worktrees\LogicAppsUX\lambrianmsft-glowing-couscous\apps\vs-code-designer\dist" --new-window
```

Then, in the launched EDH window:

1. Open Output panel (`Ctrl+Shift+U`) → dropdown → **Azure Logic Apps (Standard)**. Confirm activation.
2. Set the color theme you want in the shots (**File → Preferences → Color Theme → Dark Modern** is what the ADO cases use).
3. Zoom to 100% (`Ctrl+0`), maximize the window, and hide the Minimap (`View → Appearance → Minimap`) for cleaner shots.
4. Optional: hide the sidebar-activity-bar badges (`Ctrl+B` twice to toggle) for full-canvas shots.

**Screenshot tool:** Windows `Snipping Tool` (Win+Shift+S) → save as PNG. Do **not** compress to JPG.
**Naming convention:** `NN-flow-step.png` (e.g., `01a-createWorkspace-empty.png`). See "File map" at bottom.

---

## 2. Flow 1 — Create Logic App Workspace webview

**Command:** Command Palette (`Ctrl+Shift+P`) → **Azure Logic Apps (Standard): Create new logic app workspace…**
Command ID: `azureLogicAppsStandard.createWorkspace`

### 1a. Empty form
- Trigger the command. The **Create workspace** webview opens (title bar: "Create workspace").
- Do not fill anything. Capture the initial step: workspace-path picker + workspace-name input, both empty. Step indicator reads **Step 1 of 2 — Project setup**.
- **Save as:** `01a-createWorkspace-empty.png`

### 1b. Filled form + validation
- Pick a workspace folder outside `dist` (e.g. `C:\temp\LAX-shots`).
- Enter workspace name `MyLAWorkspace` (valid).
- Then temporarily change the name to something invalid like `bad name!` — the inline validation error appears (red text under the Field, `Next` disabled).
- Capture with the validation error visible.
- **Save as:** `01b-createWorkspace-filled-validation.png`

### 1c. Resulting Explorer tree
- Fix the name back to `MyLAWorkspace`, click **Next**, select **Standard logic app**, name it `MyLA`, accept defaults through Review + Create, click **Create workspace**.
- After the reload, capture Explorer view showing `MyLAWorkspace.code-workspace`, `MyLA/` project folder with `workflow-designtime/`, `local.settings.json`, `host.json`, `connections.json`, `.vscode/`.
- **Save as:** `01c-createWorkspace-tree.png`

---

## 3. Flow 2 — Create New Project webview (Standard / Hybrid / Custom Code)

**Command:** In an already-open Logic Apps workspace, Command Palette → **Azure Logic Apps (Standard): Create new logic app project…**
Command ID: `azureLogicAppsStandard.createProject`

The webview reuses the same `CreateWorkspace` React shell but with `flowType = createLogicApp`. The **Logic App type** control is a `RadioGroup` in `logicAppTypeStep.tsx` with these options: **Standard**, **Hybrid**, **Custom Code**, **Rules Engine**, plus **Codeful** (behind flag).

### 2a. Standard toggle
- On the "Project setup" step, select **Standard**. Capture the whole webview showing the radio state + downstream fields (Logic app name input visible).
- **Save as:** `02a-createProject-standard-toggle.png`

### 2b. Hybrid toggle
- Same webview, switch selection to **Hybrid** (fields may change: target framework picker, etc.).
- **Save as:** `02b-createProject-hybrid-toggle.png`

### 2c. Custom Code toggle
- Switch to **Custom Code**. Extra fields appear: **Function folder name**, **Namespace**, **Function name**, **.NET target framework**.
- **Save as:** `02c-createProject-customCode-toggle.png`

### 2d–f. Resulting project trees
For each of Standard, Hybrid, Custom Code — complete the wizard end-to-end (Standard→`StandardApp`, Hybrid→`HybridApp`, CustomCode→`CCApp` + Functions folder `MyFunctions`). Capture the Explorer tree of each new logic app folder immediately after creation.

- **Save as:** `02d-standard-tree.png`, `02e-hybrid-tree.png`, `02f-customCode-tree.png`

---

## 4. Flow 3 — Create New Workflow webview (from inside a workspace)

**Command:** Right-click the logic app folder in Explorer → **Create workflow…**, OR Command Palette → **Azure Logic Apps (Standard): Create workflow…**
Command ID: `azureLogicAppsStandard.createWorkflow`

### 3a. Stateful vs Stateless picker
- Trigger command against `StandardApp`. The webview opens (`Create workflow`).
- On the Setup step, workflow-type radios visible: **Stateful** / **Stateless**.
- Capture showing both radios with **Stateful** selected.
- **Save as:** `03a-createWorkflow-stateful.png`
- Toggle to **Stateless** and take a second shot.
- **Save as:** `03a2-createWorkflow-stateless.png`

### 3b. Validation error on duplicate/invalid name
- First create `Workflow1` successfully. Trigger the command again.
- Enter the name `Workflow1` — a validation error should appear ("A workflow with this name already exists" or similar).
- Also try `bad name!` to show the invalid-character validation.
- Capture both.
- **Save as:** `03b-createWorkflow-validation-duplicate.png`, `03b2-createWorkflow-validation-invalid.png`

### 3c. Resulting workflow.json in tree
- Complete the wizard with a valid name (`Workflow2`). Expand the `StandardApp/Workflow2/` folder in Explorer showing the freshly written `workflow.json` (opened in the editor tab is a nice touch).
- **Save as:** `03c-createWorkflow-tree.png`

---

## 5. Flow 4 — Create Workflow invoked outside any Logic Apps workspace

The command handler (`createWorkflow.ts`) calls `getWorkspaceRoot()`, which returns `undefined` when no logic-app project is open. This bubbles up as a VS Code error toast.

- Close the LA workspace (`File → Close Workspace`) so VS Code is on an empty/no-folder window.
- Command Palette → **Azure Logic Apps (Standard): Create workflow…**
- Capture the error notification / prompt VS Code shows (bottom-right toast + Output channel log).
- **Save as:** `04-createWorkflow-noWorkspace.png`

> If you'd rather show it from a non-LA folder (e.g., a plain JS project), open a folder that has no `local.settings.json`/`host.json` and trigger the command there — same code path.

---

## 6. Flow 5 — Custom Code (referenceable .cs helper functions)

**Prereqs on the machine:** .NET SDK 6/8, Azure Functions Core Tools v4, and the Azure Logic Apps runtime binaries (extension will prompt to install on first F5).

### 5a. Enable Custom Code on project create
- Re-run Flow 2c end-to-end. Capture the moment right before clicking **Create** on the **Review + Create** step, so reviewers see the Custom-Code fields (Function folder = `MyFunctions`, Namespace = `Contoso.Functions`, Function name = `Transform`).
- **Save as:** `05a-customCode-review.png`

### 5b. Resulting Functions/ folder with .cs
- After creation, expand Explorer to show: `CCApp/` (codeless workflow app) **and** `MyFunctions/` sibling folder containing `Transform.cs`, `MyFunctions.csproj`, `Startup.cs` (as generated).
- Open `Transform.cs` in an editor tab so the code is visible.
- **Save as:** `05b-customCode-tree-with-cs.png`

### 5c. Workflow action referencing the .cs helper
- Create a stateful workflow in `CCApp` (Flow 3 recipe). In the designer, add a **Call a local function in this logic app** action (built-in connector, appears when a functions folder is linked).
- In the parameters panel, pick `Transform` from the dropdown. Capture the designer with the action selected and the function name filled in.
- **Save as:** `05c-customCode-workflow-action.png`

### 5d. Breakpoint hit during F5
- Set a breakpoint on the first executable line inside `Transform.Run(...)` in `Transform.cs`.
- Press F5 → choose **Attach to logic app (custom code)**. Once the runtime starts, trigger the workflow (Overview page → **Run trigger** for a Request trigger, or the workflow-list overview).
- Capture the debug session with execution paused on the breakpoint: yellow arrow in gutter, Call Stack panel populated, Variables showing the workflow context, debug toolbar visible.
- **Save as:** `05d-customCode-breakpoint.png`

---

## 7. Flow 6 — Codeful (.cs workflow files)

Codeful is behind the extension's `EnableCodeful` setting. Enable it first:
- `Ctrl+,` → search **Azure Logic Apps Standard: Enable Codeful** → check the box.
- Reload window.

### 6a. Create codeful project
- Command Palette → **Create new logic app project…** → on the Logic App type step, pick **Codeful** (new radio option that appears with the flag on).
- Complete the wizard (`CodefulApp`, namespace `Contoso.Codeful`).
- Capture the Explorer tree of `CodefulApp/` showing `Program.cs`, `.csproj`, `local.settings.json`, `host.json`, and (if a workflow was auto-scaffolded) a `Workflows/` folder.
- **Save as:** `06a-codeful-tree.png`

### 6b. Create a new .cs workflow via webview
- Right-click `CodefulApp` → **Create workflow…**. Because `isCodefulProject(projectRoot)` returns true, the webview initializes with `logicAppType = codeful` and the workflow-file output will be a `.cs` file instead of `workflow.json`.
- Name it `OrderProcessing`, choose Stateful. Capture the completed webview just before **Create**.
- **Save as:** `06b-codeful-createWorkflow-webview.png`
- After creation, capture the tree with `OrderProcessing.cs` visible under `CodefulApp/Workflows/`.
- **Save as:** `06b2-codeful-workflow-tree.png`

### 6c. F5 breakpoint hit inside .cs workflow
- Set a breakpoint at the entry of the `OrderProcessing` workflow method.
- Press F5 → **Debug codeful logic app** (or the codeful-specific launch config the extension registers — check `.vscode/launch.json` after step 6a).
- Trigger the workflow. Capture paused breakpoint (same style as 5d).
- **Save as:** `06c-codeful-breakpoint.png`

### 6d. Project tree showing codeful + codeless side-by-side
- Open a multi-root workspace containing both `CCApp` (from Flow 5) and `CodefulApp`. Or drop them both under `MyLAWorkspace` and capture the Explorer showing:
  - `CodefulApp/Workflows/OrderProcessing.cs` (codeful)
  - `CCApp/StatefulWorkflow1/workflow.json` (codeless)
  - `MyFunctions/Transform.cs` (custom code helper)
- **Save as:** `06d-codeful-vs-codeless-tree.png`

---

## 8. File map (target output)

Place PNGs (identical copies) in **both**:

- `D:\dev\copilot-worktrees\LogicAppsUX\lambrianmsft-glowing-couscous\screenshots\`
- `C:\Users\lambrian\.copilot\session-state\40e537fd-a419-4d5a-9100-af8a638b987a\files\new-testcases\screenshots\`

```
01a-createWorkspace-empty.png
01b-createWorkspace-filled-validation.png
01c-createWorkspace-tree.png
02a-createProject-standard-toggle.png
02b-createProject-hybrid-toggle.png
02c-createProject-customCode-toggle.png
02d-standard-tree.png
02e-hybrid-tree.png
02f-customCode-tree.png
03a-createWorkflow-stateful.png
03a2-createWorkflow-stateless.png
03b-createWorkflow-validation-duplicate.png
03b2-createWorkflow-validation-invalid.png
03c-createWorkflow-tree.png
04-createWorkflow-noWorkspace.png
05a-customCode-review.png
05b-customCode-tree-with-cs.png
05c-customCode-workflow-action.png
05d-customCode-breakpoint.png
06a-codeful-tree.png
06b-codeful-createWorkflow-webview.png
06b2-codeful-workflow-tree.png
06c-codeful-breakpoint.png
06d-codeful-vs-codeless-tree.png
```

Once captured, ping the general-chat session and the follow-up assistant can generate ADO markdown snippets embedding these images.

---

## 9. Blockers the assistant hit (for your awareness)

1. **No headless GUI:** the CLI session runs in a shell context and cannot open / interact with the VS Code EDH window nor screenshot it.
2. **F5 / breakpoint flows (5d, 6c)** need Azure Functions Core Tools + .NET SDK + Logic Apps runtime binaries on the machine, plus a live workflow trigger. Only reproducible by a human on their dev box.
3. **Codeful flag (Flow 6)** is opt-in via extension setting — must be toggled by the user before Flow 6 commands appear.
4. **Type-check errors** in `apps/vs-code-designer` are pre-existing (Buffer/Uint8Array typing regression) and unrelated to this task — did not block the tsup bundle. Please don't try to fix them in this session per instructions ("do not modify product code").
