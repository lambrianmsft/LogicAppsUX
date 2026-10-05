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

## Harness-only tests

These unit tests do not launch VS Code or download anything:

```powershell
node --test apps\vs-code-designer\src\test\candidate\runner.test.js
```
