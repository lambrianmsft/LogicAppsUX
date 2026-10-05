# Isolated local candidate pickup suite

This is a reusable, **local-only extension-host suite**, not an ExTester UI
scenario and not part of PR CI. It launches actual VS Code in bounded phases, loading the
built Logic Apps extension as an installed extension. The tiny development
extension under `src/test/candidate` hosts the assertions; it does not replace
or mock the product. Do **not** use the normal `run-e2e.js` for this task: that
runner manages shared test caches and downloaded runtime fixtures.

## Prerequisites

- A complete, locally built `apps/vs-code-designer/dist`, including its runtime
  dependencies **and the normal `vs-code-react` webview build**. Build it
  separately using the repository's build instructions. An extension-host-only
  build is insufficient, even for `--scope activation`.
  The root `pnpm run build:extension` Turbo task builds both the extension host
  and the webview. Running host `tsup` plus `copyFiles` alone is incomplete.
  The webview's normal package command is
  `pnpm --dir apps\vs-code-react run build:extension`; it emits
  `apps\vs-code-designer\dist\vs-code-react`.
- Repository development dependencies, including the existing `typescript`
  parser used for read-only webview preflight. The runner does not install them.
- An existing VS Code **executable**, e.g. `Code.exe`, not `code.cmd`.
- A local .NET SDK executable. The independent build probe targets `net8.0`.
  The supplied candidate compiler also requires the .NET 9 runtime. The runner
  configures `dotnetAcquisitionExtension.sharedExistingDotnetPath` to this same
  executable so C# extension components use preinstalled runtimes rather than
  downloading into the private profile.
  On Windows, the isolated environment retains `PROCESSOR_ARCHITECTURE`:
  the .NET SDK Windows installer initializer requires it even for `dotnet --info`.
  Cache, profile, and credential isolation are unchanged. Existing manually
  launched windows require a user-controlled full process relaunch to receive
  environment changes; Reload Window does not replace the main Code environment.
- Existing Core Tools and Node executables; candidate activation does not
  auto-download missing dependencies.
- Offline extension payloads satisfying the product's `extensionDependencies`
  and their transitive `extensionDependencies`. `--extensions` is a
  **read-only input directory** containing installed extension directories, not
  the launch destination. Include one version per required extension. The
  runner copies only that dependency closure into the new private run. When
  `extensions.json` exists, its active entries select versions; obsolete
  directories left by VS Code updates are ignored.
- A schema-version-1 candidate manifest:

  ```json
  {
    "schemaVersion": 1,
    "bundle": { "path": "C:\\artifacts\\bundle.zip", "version": "1.2.3", "sha256": "<64 hex characters>" },
    "sdk": { "path": "C:\\artifacts\\Microsoft.Azure.Workflows.Sdk.1.2.3.nupkg", "packageId": "Microsoft.Azure.Workflows.Sdk", "version": "1.2.3", "sha256": "<64 hex characters>" }
  }
  ```

  `provenance` and `createdUtc` are optional. Supply trusted artifacts: extension
  activation and MSBuild execute code from them.
- Optional `--nuget-source` pointing to a vetted **offline** package directory
  for the candidate SDK's transitive dependencies. No nuget.org source or user
  package cache is inherited by the build probe. The runner also passes this
  directory as `LOGICAPPS_LOCAL_CANDIDATE_NUGET_SOURCE` so newly generated
  candidate projects explicitly map the SDK to its private full nupkg and all
  other packages to this offline source. Without this optional setting, new
  projects retain the normal public dependency source. Existing project
  configurations are not rewritten automatically.

Candidate workspace selection must remain inside `LOGICAPPS_LOCAL_CANDIDATE_ROOT`.
The wizard validates the selected parent folder before creation and the host
rechecks all destination paths before creating files or verifying the bundle.
Creation errors return to the existing wizard with its values retained and
the Creating state cleared. Candidate C# language-server startup does not wait
for the optional design-time auto-start question; trust and host startup
choices remain user-controlled.

The automated runner keeps Azure connector discovery disabled and silent
authentication enabled. A separately launched, user-controlled manual window
may opt in with `LOGICAPPS_LOCAL_CANDIDATE_MANUAL=true` and remove its private
`azureLogicAppsStandard.silentAuth` override. This restores normal Azure
sign-in/subscription UI, not credentials or automatic connection creation.
Candidate path checks and exact bundle/SDK selection remain mandatory.
Azure Resources APIs and the subscription picker are initialized before
command registration and LSP metadata discovery, so a manual Azure setup
prompt cannot race dependency initialization.

Candidate design-time hosts deliberately do not pass `--offline`: Core Tools 4.15.2's
offline cache parser rejects exact four-part versions such as `[1.192.0.32]`.
`FUNCTIONS_CORE_TOOLS_OFFLINE=false` skips its connectivity probe and uses
the normal cache-first resolver. `ensureLatest=false`, the private download
path, exact version, and loopback-only bundle source still prevent public
bundle fallback. This Core Tools switch does not enable Azure connectors in
the automated suite. This does **not** work for the bundled older inproc8 CLI:
that CLI overwrites both downloadPath and ensureLatest with its OS-profile cache
and `true`. A private HOME/USERPROFILE or probingPaths does not fix that override.

For candidate F5 launches, the extension first verifies the installed candidate
bytes and rejects a candidate changed since activation. It refreshes only its generated
`func: host start` task before fetching tasks, even when general project
consistency checks are disabled or declined. It removes the obsolete
`--offline` argument and merges the current candidate runtime environment
into base, Windows, Linux, and macOS task options. Custom tasks, other
arguments, working directories, environment entries, and JSONC comments
are retained; launch/settings files are not regenerated. Before starting the
host, task resolution is retried for up to five seconds until it reflects the
current environment and arguments. Stale tasks fail instead of launching.
The original resolved task identity is retained so task dependencies still run.
Untrusted/outside-root workspaces, unsaved task edits, ambiguous host tasks,
custom prelaunch tasks, and non-generated host commands fail explicitly
instead of being overwritten.
Codeful candidate tasks invoke the packaged `localCandidateHost.js` through the
selected Node on PATH. The wrapper runs only after the existing clean/build task
dependencies finish. It verifies the immutable installed pair and the built SDK,
then creates a fresh host under `<candidate-root>/debug-hosts/host-*`.
Task admission and lifecycle tracking compare the exact helper using platform
path identity (Windows drive-letter casing can differ between disk and VS Code).
`tasks.fetchTasks()` can retain `${config:...}` arguments until task execution;
both that form and the resolved absolute executable are recognized without
replacing the returned task. Unrelated helpers and provider-backed tasks remain
rejected.
Windows PID selection waits within the configured host-readiness deadline for
the task's own Node wrapper to spawn `func` and its in-process host. It never
attaches to the wrapper/shell, a cached shell fallback, or another active terminal
while full-host staging is incomplete. PowerShell discovery directly launches the
owned query process with a ten-second timeout and reports CIM errors explicitly;
it does not leave a shell intermediary or an independent backup timer.
Before accepting HTTP host status, the selected loopback port must belong to that
same in-process host PID. A conflicting listener produces an explicit error with
its PID, never automatic termination or a port change.
The complete bundle is copied without changing any bundle entry. The complete
current build output (including PDBs and dependency subdirectories) is copied both
to the app root for worker RPC assembly resolution and to `lib/codeful` for
provider discovery. Every copied file is byte-verified. Only the derived root
`host.json` has its extensionBundle stanza removed; original project files and
settings remain untouched. Stale bundle resolver keys are also removed from the
derived local settings, never from the original file. Inherited bundle resolver options are removed for
the child. `ProjectDirectoryPath` is pinned to that derived host in both its root
local settings and child environment. `WORKFLOW_APPLICATION_ROOT_DIRECTORY` and
`AzureWebJobsScriptRoot` are set only in the child environment; Core Tools owns
script-root configuration and rejects a duplicate local setting. Case-variant
stale root settings are removed from both inputs. In particular,
the runtime uses `ProjectDirectoryPath` to select the codeful worker; retaining a
copied project's original path could launch an old SDK/app from a different root.
The wrapper rechecks the complete nupkg SHA against the candidate manifest,
derives the SDK assembly SHA from its packaged `lib/netstandard2.0` asset, verifies
the deployed assembly, and supplies `LOGIC_APPS_CSHARP_SDK_ASSEMBLY_PATH` plus
`LOGIC_APPS_CSHARP_SDK_ASSEMBLY_SHA256` to the child. The bundle must support this
explicit SDK-only runtime reference contract; a DLL merely present on disk or
listed in a sidecar does not prove Roslyn can use its types. The wrapper preserves
custom arguments but enforces loopback binding and no second build.

This is **explicit private-host deployment**, not proof of Core Tools cache
selection. No HTTP ZIP feed or shared-cache fallback is used. Each F5 sees the
latest completed build and does not overwrite a prior running host. Retained
private debug-host folders can contain copied application settings; treat them
like the original project, and remove only known inactive folders when no longer
needed. Normal non-candidate F5 is unchanged. Startup proof must include loaded
engine identity and functioning workflow metadata: `Running` status alone can
occur even when the bundle or individual workflow failed to load.

### Native connector paths in designer metadata

Both designer versions recognize the SDK's native
`#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, "/route/{0}", argument)}`
path shape for Swagger operation inference and path-parameter initialization.
This is static structural inspection, not C# evaluation or a workflow rewrite.
It preserves each argument, including URL-encoding calls, as native expression
text. Multiple, repeated, reordered, and embedded format placeholders are supported,
as are balanced nested arguments and ordinary/verbatim quoted argument strings.
Literal and WDL paths retain their existing handling.

The bounded decoder rejects nonliteral format strings, other culture providers,
alignment/format specifiers, raw/interpolated argument strings, comments, and
top-level generic argument syntax. Multiple named Swagger parameters within one
segment, duplicate parameter names, and multiple matching operations are not
guessed. Such definitions retain explicit metadata errors; runtime execution is
unmodified. A successful connector run can therefore coexist with an unsupported
designer metadata shape. Do not change user expressions or pre-encode values to
hide a metadata error.

## Command

```powershell
node apps\vs-code-designer\scripts\run-candidate-e2e.js `
  --manifest C:\artifacts\candidate.json `
  --root C:\private-runs\candidate-001 `
  --code "C:\Program Files\Microsoft VS Code\Code.exe" `
  --dotnet C:\tools\dotnet\dotnet.exe `
  --func C:\tools\func\func.exe `
  --extensions C:\artifacts\offline-vscode-extensions `
  --nuget-source C:\artifacts\offline-nuget `
  --timeout-ms 600000
```

The parent of `--root` must exist; `--root` itself **must not exist**. It is never
cleaned or reused. `--extension` can override the built product directory.
`--func`, `--dotnet`, and `--code` are required for activation.
`--node` selects an existing absolute executable (defaults to this runner's Node).
`--timeout-ms` bounds each process (default 180000; maximum 1800000).
For complete production-sized bundles, use the example's 600000ms budget:
extension dependency startup and full archive/tree integrity validation can
take several minutes in Electron. A timeout is a failed diagnostic run, not
permission to skip integrity checks.
`--scope activation` runs only actual activation/installation in a genuinely
empty window, without opening any project or invoking project operations.
This can diagnose installation while project trust awaits a user decision;
it is explicitly not a pickup/reopen/LSP/build pass. The default scope is
`pickup`. Failed window phases stop subsequent UI attempts.
`LOGICAPPS_LOCAL_CANDIDATE_MANIFEST` and `LOGICAPPS_LOCAL_CANDIDATE_ROOT` are
alternative opt-in inputs for the corresponding flags. No candidate VS Code
setting is required. The CLI's root is the **run envelope**. Child VS Code receives
`LOGICAPPS_LOCAL_CANDIDATE_ROOT=<runRoot>/candidate`, while HOME/USERPROFILE is
`<runRoot>/home` and temporary files are `<runRoot>/temp`. The candidate root is
initially absent and is created atomically by the product installer, not the
harness. If `dist/localCandidate.js` is staged, the harness first invokes its real
`ensureLocalCandidateInstalled()` export in an isolated Node child. This compiled
entrypoint must include or resolve its product dependencies (including
`adm-zip`, `semver`, `xml2js`, and `vscode-nls`). No extra harness npm dependency
is needed. Without that entrypoint, actual empty-window VS Code activation is
the bootstrap fallback. Thus candidate bundle/dependency paths remain relative to
`candidate.root`; profile paths and receipts are outside that owned subtree.

The suite preserves workspace trust. If VS Code requests trust, the user must
make that decision in the private window. The suite waits, then reports a
blocker rather than disabling trust, granting trust itself, or substituting
mock evidence. Approve only the generated private workspace if its contents
are trusted; do not trust a broader parent directory. The example allows ten
minutes per process for this manual decision. A timed-out run is retained;
retry with a fresh root rather than editing its receipt or reusing its profile.
No sign-in is performed. Silent auth and empty subscription
selection are configured; no designer connector or cloud operation is invoked.
Portable mode is not enabled: it overrides the explicit private profile and
extension-directory flags and is unsupported by the Windows User installer.

## What the receipt proves (and does not prove)

`<root>/receipt.json` records stage failures as well as successes. Detailed
extension-host receipts are `bootstrap.json`, `pickup.json`, and `reopen.json`; logs are under
`logs/`. A nonzero exit indicates a failed pickup/build stage.

Optional `missingPlatformAssets` diagnostics returned by the product installer
or inspector are retained as evidence, not promoted to bundle-install failures.
Platform/native and broker support remain explicitly `untested`, even when
installation, managed builds, or LSP checks pass.

1. Validate manifest and both archive SHA256 hashes. Validate the webview
   payload before copying extensions or starting any child process. A failed
   `webview-payload` stage stops both activation and pickup scopes, including
   the independent package build.
2. Copy the built extension and offline dependencies to private extensions.
   Record IDs, versions, paths, package-manifest hashes and entrypoint hashes.
   Revalidate the copied product webview before allowing activation, and record
   an `installed-webview-payload` recheck after the window phases before success.
3. Bootstrap through the compiled product installer when available, otherwise
   an empty VS Code window with private `--user-data-dir` and `--extensions-dir`.
   In the fallback, activate the real extension and inspect the candidate so
   the product creates its absent, owned root. No workspace is opened outside
   that root. After successful installation, create only an empty scratch
   directory inside it and launch the pickup phase. Wait for workspace trust,
   activate the installed product, invoke its opt-in
   `localCandidateSmoke({ workspacePath })` export to run the real SDK/LSP
   installer, then invoke `azureLogicAppsStandard.inspectLocalCandidate`.
   Installed server paths are recorded separately from post-start LSP selection.
4. Assert the real selection returns existing `bundlePath` and `sdkPath` under
   the private root, and that SDK bytes match the manifest. Mandatory managed
   `.runtime` dependency closure matches the normal extension health check.
   Omitted platform-specific native/RID assets are recorded separately in
   `missingPlatformAssets`; passing pickup does not prove their runtime paths
   work. Optional localized satellite assemblies are not required for health.
   Invoke the bounded
   `azureLogicAppsStandard.createLocalCandidateWorkspace` adapter, which must
   call actual product workspace creation. Require an empty
   `WORKFLOWS_SUBSCRIPTION_ID`. Replace **only the generated fixture's**
   `CandidateWorkflow.cs` managed-weather sample with a built-in HTTP trigger
   and Response returning `local-candidate-ok`. Record before/after hashes;
   leave the generated SDK reference, project, host, tasks, and Program.cs alone.
5. Run normal `dotnet restore` and `dotnet build --no-restore` on that actual
   generated project before reopening it. An explicit private offline
   `RestoreConfigFile` applies to nested restore targets too; generated NuGet
   configuration is not rewritten. Retain `generated-restore.log`,
   `generated-build.log`, `generated-build.binlog`, and preprocessed imports.
   Missing offline transitive dependencies produce a concrete failed restore,
   not a substituted successful project.
6. Reopen the generated `.code-workspace` in a fresh VS Code process and compare
   installed paths/hashes. Open the generated source and poll the inspection
   command for actual LSP startup selection. Assert `lspSdkPath` has the candidate
   SDK hash. The product smoke export's installed `lspServerPath` must be
   `<candidateRoot>/dependencies/LSPServer/SdkLspServer.dll`, not a DLL assumed
   to exist directly in the bundle. Its hash is installation evidence, not an
   independently observed LSP process path.
7. Independently restore and build a normal `PackageReference` project against
   the unmodified candidate nupkg. Check the restored nupkg hash and the
   `buildTransitive` and `tools` directories. Retain the binlog, preprocessed
   imports, and generated NuGet targets. The probe has no hand-written SDK
   import or direct task invocation.

The inspection command must report actual product install/selection code;
`lspSdkPath` must only be recorded after `languageClient.start()` completes.
Absent commands or selection evidence are failures; there is no synthetic
fallback. If the optional real creation adapter is absent, creation is recorded
as `not-run`; the second VS Code process still reopens the private empty workspace
to exercise installation persistence, then explicitly fails the LSP-start stage
for lack of a real codeful fixture. The creation adapter accepts
`{ parentPath, workspaceName, logicAppName, workflowName }` and returns
`{ workspaceFile, projectPath }`, without auto-opening the workspace. This
exercises the real creation pipeline, **not the wizard UI**. F5 and HTTP workflow
execution remain explicitly `not-run`. The standalone build probe is separate
from the generated Logic App workspace. Its `package-reference-build` receipt
does not substitute for the separate `generated-project-build` receipt.

## Isolation and limits

### Webview payload preflight

The reusable synchronous export `validateWebviewPayload(extensionDirectory)`
accepts the **extension directory**, not the `vs-code-react` directory. It reads
only; it can validate either build output or an already repaired private
installation without copying files or launching Code:

```powershell
node -e "const { validateWebviewPayload } = require('./apps/vs-code-designer/scripts/run-candidate-e2e'); console.log(JSON.stringify(validateWebviewPayload(process.argv[1]), null, 2));" "C:\private-runs\candidate-001\extensions\ms-azuretools.vscode-azurelogicapps"
```

It requires a nonempty `vs-code-react/index.html`, a local script and stylesheet,
and nonempty regular files for the statically discoverable reference closure:

- HTML `src`, link `href`, and media `poster` references.
- JavaScript literal imports/re-exports, literal dynamic imports, literal
  `new URL(..., import.meta.url)` references, and Vite `assets/...` filename string literals
  (including preload chunk/CSS tables, resolved relative to the webview root).
- CSS `url(...)` and quoted `@import` references, followed recursively.

JavaScript is parsed without executing it. Import-looking comments and string
examples are not treated as imports. Query strings/fragments are removed for
filesystem lookup. URL-encoded paths are checked after decoding. References
cannot escape the webview root or use absolute filesystem/root-relative URLs;
symlinks/junctions and noncanonical HTML base overrides are rejected. The normal
index's `<base href="/">` (or `./`) is accepted for package-root asset lookup;
this does not prove browser URL resolution. In-root `../` references are allowed.

The returned evidence lists checked relative `files`, `externalReferences` that
were **not fetched or verified**, and the count of nonliteral `computedImports`
whose targets cannot be determined statically. This is an emitted-Vite-payload
existence check, **not proof of every possible runtime asset**: arbitrary computed
URLs (including directory prefixes such as `/assets/icons/`), runtime fetches,
HTML `srcset`, CSS escape syntax, and dynamically generated
markup are outside its coverage. It does not validate font/image encoding,
execute the webview, or prove rendering, CSP compatibility, designer behavior,
or wizard success. No Vite manifest is assumed or build configuration changed.
The unit fixtures are tiny test-only resources, never replacement product files.

The runner writes only into its newly created root: private home/AppData/temp,
VS Code settings and storage, extensions, dependency artifacts and NuGet
caches. It does not copy credential environment variables or user profiles.
It performs no install/download command, commits, pushes or cloud operations.
The caller supplies all executable and package inputs. VS Code and third-party
extensions are not an OS network sandbox; use an externally network-isolated
environment if an enforceable process-wide egress prohibition is required.

Timeout cleanup targets only the child process tree launched by this runner,
using explicit PIDs, never process names or global cache cleanup. Keep receipts
and private profile logs local; review logs before sharing them.

## Manually switching candidates without losing edited source

This runner validates one candidate selection per run. Day-to-day manual testing
instead opens a real, user-controlled VS Code window against an already-installed
candidate and iterates: edit the generated project's source (for example
`CandidateWorkflow.cs`), F5, inspect, repeat. Candidate selection itself is just
the existing `LOGICAPPS_LOCAL_CANDIDATE_MANIFEST` and `LOGICAPPS_LOCAL_CANDIDATE_ROOT`
environment variables (or their per-window equivalents) read by `getLocalCandidate()`
and `ensureLocalCandidateInstalled()`; there is no separate product "selection file."

Moving to a **new** candidate (a new manifest/root pointing at a rebuilt SDK or
bundle) normally means rerunning `azureLogicAppsStandard.createLocalCandidateWorkspace`,
which always scaffolds a brand-new project from the standard new-workspace wizard
pipeline — it does not carry forward an already-edited project's source. Preserving
that edited source across a candidate switch was previously done by hand, copying
the existing project directory into a new location. `copy-candidate-workspace.js`
is the generic, parameterized replacement for that manual step:

```powershell
node apps\vs-code-designer\scripts\copy-candidate-workspace.js `
  --source C:\private-runs\candidate-001\candidate\MyLogicApp `
  --dest   C:\private-runs\candidate-002\candidate\MyLogicApp
```

- `--source` and `--dest` are both required, absolute paths.
- `--source` must look like a Logic Apps workspace or project: it (or an
  immediate subdirectory) must contain `host.json`, `local.settings.json`, or a
  `.code-workspace` file. Arbitrary directories are rejected.
- **Overwrite protection only**: `--dest` must not already exist (its parent must).
  The helper never overwrites, merges into, or cleans an existing destination —
  consistent with this runner's own `--root` contract above. Retry with a new
  `--dest` rather than reusing one. This check only prevents clobbering another
  candidate's workspace at copy time; it does **not** detect edits made to
  `--source` afterward, and a copy does not become "stale" on its own — see the
  drift check below for that.
- Regenerated or candidate-run-specific content is excluded from the copy so a
  previous candidate's stale build output, derived debug host, or project-local
  NuGet restore cache is never carried into the new selection: `bin/`, `obj/`,
  `.vs/`, `.nuget/`, `node_modules/`, `debug-hosts/`, `lib\codeful\` (the csproj's
  `AfterTargets="Build;Publish"` regenerated output, see `codeful.ts`), and the
  installed-candidate-root owner marker file. Everything else, including edited
  source, is copied byte-for-byte.
- Symbolic links are rejected rather than followed.
- A `.copied-from-candidate-workspace.json` receipt is written into `--dest`
  recording the source path, timestamp, file counts, and a SHA-256 fingerprint of
  every copied file.
- **Source-drift guard**: call `assertOriginalSourceUnchangedSincePrepare(dest)`
  (exported from the same script) before treating an already-copied `--dest` as
  launch-ready. It recomputes fingerprints for the ORIGINAL `--source` directory
  (not `dest`) and throws, naming the exact files, if anything was changed,
  added, or removed in `source` since the copy ran — this is what actually
  detects source drift; `--dest` overwrite protection above does not. Editing
  the copied `dest` itself afterward is the expected normal F5/iterate workflow
  and is never flagged by this check. A separate, lower-priority
  `assertDestinationCopyIntegrity(dest)` instead checks whether `dest` was
  externally corrupted (not edited) since it was copied; most callers want
  `assertOriginalSourceUnchangedSincePrepare`, not that one.
- This is a pure file-system operation: it never launches VS Code, dotnet, or
  `func`, and never changes which candidate is selected.

### Retargeting the copy's package/feed bindings to a new candidate

Copying preserves source but does not, by itself, make the copied project build
against the new candidate's SDK/LSP. Of the project's bindings to a candidate,
only some retarget automatically the first time each subsystem runs against the
project in its new location, via existing product code — the rest must be
rewritten explicitly. This was confirmed by direct source inspection, not
assumed from naming:

- **Automatic**: debug tasks/host environment, via `migrateLocalCandidateTasks`
  (`app/utils/localCandidateTasks.ts`), applied at F5 time through
  `fetchLocalCandidateDebugTasks`. Confirmed to rewrite only `.vscode/tasks.json`
  (`options.env`, the node-launcher command/args wrapper, and the `--offline`
  flag), gated on `assertLocalCandidateProject`/`assertLocalCandidateInstalled`,
  which only require the project to physically live under the active
  candidate's root — satisfied by the copy step above.
- **Automatic**: language server SDK selection. `languageServer.ts`'s
  `this.sdkNupkgPath` is extension-host runtime state computed directly from the
  active candidate, not anything stored in the project's files;
  `recordLocalCandidateLspSdk` is only a post-start sanity assertion, not a
  retargeting mechanism — there is nothing project-side to rewrite here at all.
- **NOT automatic**: the generated `.csproj`'s
  `<PackageReference Include="Microsoft.Azure.Workflows.Sdk" Version="...">` and
  `nuget.config`'s `packageSources/current` value. Both are literal strings
  rendered exactly once, at fresh-project-creation time, by
  `createCodefulWorkflowFile`
  (`app/commands/createNewCodeProject/CodeProjectBase/CreateLogicAppWorkspace.ts`),
  inside the `else` branch of `if (await fse.pathExists(programFilePath))` —
  permanently skipped once `Program.cs` exists, which is true for any copied
  project. `invalidateCodefulSdkCacheIfNeeded` (`app/utils/codeful.ts`) only
  clears a project-local NuGet cache entry for a same-version VSIX content
  change; its own gate, `codefulNugetConfigUsesExtensionSdkCache`, requires
  `nuget.config`'s `packageSources/current` to *already* equal the new
  candidate's LSP directory, so it no-ops (does not rewrite anything) for a
  genuine cross-candidate retarget.

`retarget-candidate-workspace.js` rewrites exactly those two NOT-automatic
values, reusing `CreateLogicAppWorkspace.ts`'s exact literal-replace technique
and XML attribute escaping rather than reimplementing new logic. It never
touches any other file or value (user config/connections are untouched), and
fails closed — throws rather than guessing — if either file's expected literal
shape is not found:

```powershell
node apps\vs-code-designer\scripts\retarget-candidate-workspace.js `
  --project            C:\private-runs\candidate-002\candidate\MyLogicApp `
  --candidate-manifest C:\private-runs\candidate-002\candidate.json `
  --candidate-root     C:\private-runs\candidate-002\candidate
```

`--candidate-manifest` is the same `{schemaVersion: 1, sdk: {packageId, version}}`
manifest consumed elsewhere in this document; `--candidate-root` is the
installed candidate's root directory, whose `dependencies/LanguageServerLogicApps`
subdirectory (matching `LocalCandidate.dependenciesPath` exactly) supplies the
new `nuget.config` value. Calling it again with the same candidate is a no-op
(`changed: false` in its JSON result) — safe to call unconditionally before
every relaunch.

### Refusing to relaunch into an already-active profile

Relaunching VS Code with a `--user-data-dir` that a running process already
owns does not open a second, independent window against the new candidate — it
silently attaches to/reuses the existing window and ignores the new launch's
arguments and environment variables, producing a misleadingly "successful"
launch that is not actually running against the intended candidate. No
existing code in this repo detects that condition (confirmed by search).
`detect-active-candidate-profile.js` is new, narrowly-scoped, **read-only**
functionality for it: it enumerates processes once (`Get-CimInstance
Win32_Process` on Windows, `ps -axo pid=,ppid=,command=` elsewhere) and matches
the normalized `--user-data-dir` value in each command line. It never kills,
signals, or otherwise touches any process — on a match it only throws, naming
the exact owning PID(s), parent PID(s), and command line(s); resolving the
conflict (closing that window yourself, or picking a different root) is left
to whoever reads that error.

```js
const { assertNoActiveProfile } = require('./detect-active-candidate-profile');
assertNoActiveProfile('C:\\private-runs\\candidate-002\\candidate\\user-data'); // throws on conflict, otherwise returns
```

### Composed guarded launch

`launch-candidate-workspace.js` composes the three pieces above —
`copyCandidateWorkspace`/`assertOriginalSourceUnchangedSincePrepare`,
`retargetCodefulProject`, and `assertNoActiveProfile` — into a single
`prepareCandidateWorkspace` (pure file-system; never spawns anything) followed
by a `launchCandidateWorkspace` step that refuses (read-only) if the target
`--user-data-dir` is already active, then spawns the given VS Code binary
detached (`--new-window`, `--user-data-dir`, `--extensions-dir`, the prepared
`--dest`), with `LOGICAPPS_LOCAL_CANDIDATE_MANIFEST`/`ROOT` set on top of the
caller's own real environment:

```powershell
node apps\vs-code-designer\scripts\launch-candidate-workspace.js `
  --source             C:\private-runs\candidate-001\candidate\MyLogicApp `
  --dest               C:\private-runs\candidate-002\candidate\MyLogicApp `
  --candidate-manifest C:\private-runs\candidate-002\candidate.json `
  --candidate-root     C:\private-runs\candidate-002\candidate
```

`--user-data-dir`/`--extensions-dir`/`--code` default to
`<candidate-root>\user-data`, `<candidate-root>\extensions`, and `code`
respectively, and can be overridden. Unlike this runner's own `isolatedEnv`,
this does **not** fabricate a brand-new sandboxed HOME/dotnet/NuGet
environment — the scenario is an interactive manual relaunch against the
developer's real VS Code install and real machine environment, only
overlaying the two candidate-selection environment variables the product
already reads. If `--dest` already exists, it is re-validated and
re-retargeted (both idempotent) rather than recopied, so editing the prepared
copy and rerunning this same command is the expected iterate loop. This
script is not invoked by any agent session; it exists for the user (or a
future authorized step) to run directly. **Not covered by this helper**:
proving the relaunched window actually loaded the new engine — guarded F5
acceptance is unchanged from the rest of this document: a `Running` host
status alone is not acceptance. Confirm the loaded engine identity and that
the specific edited workflow's metadata actually loaded before treating a
manual relaunch as successful, per "What the receipt proves (and does not
prove)" above.

### Tests for all four pieces

`src/test/candidate/copyCandidateWorkspace.test.js`,
`retargetCandidateWorkspace.test.js`, `detectActiveCandidateProfile.test.js`,
and `launchCandidateWorkspace.test.js` cover the copy/fingerprint/drift
semantics, csproj/nuget.config rewriting against realistic fixtures (including
the `packageSourceMapping` block), process-match detection, and the composed
prepare/launch flow — all with real temporary directories but an injected
`spawnSyncImpl`/`spawnImpl`/`assertNoActiveProfileImpl`, so none of them
enumerate this machine's real processes or launch a real VS Code/dotnet/func
process. Run with `node --test` against each file directly (they are plain
`node:test` files, not part of the ExTester suite).
- **Package/feed/LSP/task retargeting is not reimplemented here** — it already
  happens automatically, the first time each subsystem runs against the project
  in its new location, via existing product code, all gated on
  `assertLocalCandidateProject` (`app/utils/localCandidateRuntime.ts`), which
  requires the project to physically live under the active candidate's root (the
  copy above is what satisfies that):
  - NuGet/package cache: `invalidateCodefulSdkCacheIfNeeded` (`app/utils/codeful.ts`),
    invoked from `publishCodefulProject.ts` on build/publish. It compares the
    project-local `.nuget/.lspsdk-hash` marker against the active candidate's
    installed SDK hash and, on mismatch, deletes the stale versioned package
    folder plus `obj/project.assets.json`/`obj/project.nuget.cache`.
  - Language server SDK selection: `recordLocalCandidateLspSdk`
    (`app/utils/localCandidateRuntime.ts`) and the `lspSdkHashMarkerName` marker
    (`app/utils/languageServerProtocolConstants.ts`), compared on language client
    start.
  - Debug tasks/host environment: `migrateLocalCandidateTasks`
    (`app/utils/localCandidateTasks.ts`), applied at F5 time, exactly as
    described above for the automated runner — this helper does not duplicate or
    bypass that logic.
- Guarded F5 acceptance is unchanged from the rest of this document: a `Running`
  host status alone is not acceptance. Confirm the loaded engine identity and that
  the specific edited workflow's metadata actually loaded before treating a manual
  relaunch as successful, per "What the receipt proves (and does not prove)" above.
- **Not covered by this helper**: refusing to operate against an already-active
  private VS Code profile/extension-host, and actually composing this copy step
  with this runner's isolated-launch machinery into a single tool that starts an
  editor window. Both would mean this script (or a new one) launching a real
  editor/process, which conflicts with this repo's existing automated-runner
  design (launch stays inside `run-candidate-e2e.js`'s own isolated
  profile/process lifecycle, never ad hoc). Treat those as a separate, explicitly
  scoped decision rather than an implicit extension of this copy helper.

## Harness-only tests

These unit tests do not launch VS Code or download anything:

```powershell
node --test apps\vs-code-designer\src\test\candidate\runner.test.js
node --test apps\vs-code-designer\src\test\candidate\copyCandidateWorkspace.test.js
```
