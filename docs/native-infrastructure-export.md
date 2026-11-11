# Native infrastructure export in VS Code

The existing **Generate Deployment Scripts** command now offers these artifact choices:

- **Azure DevOps Pipeline**: choose the deployment target, then **ARM** or **Bicep** for Standard / App Service. Hybrid remains ARM-only. ARM generates the existing templates and pipeline artifacts; Bicep generates an infrastructure-only deployment pipeline, not an application package. Updated Standard ARM backends emit `AzureResourceManagerTemplateDeployment@3`; the client still accepts legacy ARM output.
- **Azure Deployment Center**: existing Deployment Center behavior.
- **Terraform infrastructure only (Standard / App Service)**.

For either native format, choose the target subscription and an **existing resource group**, storage account name, App Service plan name and Logic App name. No workspace name or resource ID is requested, following the existing ARM convention. Resource-group creation is disabled for native export. Confirm the format-specific plaintext-credential warning. Generation does not run deployments or pipelines, package workflows/application source, parameterize source connections, rewrite workflow metadata, or update the workspace file. Starting the normal design-time host can still prepare its host/local settings and design-time configuration. Bicep includes infrastructure pipeline files; Terraform remains export-only with no pipeline.

The Bicep command path is **Generate Deployment Scripts → Azure DevOps Pipeline → Standard (Azure App Service) → Bicep**. ARM, Bicep and Terraform execute one shared orchestration in `GenerateADODeploymentScriptsStep.execute`: source discovery, host/connection generation, output handling and completion. There is one host-generation branch and one connection-download loop, not separate end-to-end native and ARM generators. ARM retains child-first requests, source parameterization, incremental extraction, workspace integration and workflow metadata updates. Bicep/Terraform retain host-first validation, source-ID resolution, full-export validation and staged publication without source changes. The ordering difference prevents native cloud exports before host contract validation while preserving existing ARM behavior. Hybrid retains local ARM generation instead of calling the Standard host. Format-specific confirmation, contract checks and output handling remain explicit branches; the native validation helper is not a deployment script. Neither Bicep nor Terraform adds a workspace prompt. Terraform keeps its separate export-only wizard entry and does not appear as an Azure DevOps pipeline format.

Saved subscription IDs are initial selections, not authenticated Azure contexts. Before listing existing resource groups, the native wizard resolves the subscription through the Azure account provider so that credentials and cloud endpoints come from the selected account. With multiple subscriptions, a saved ID alone does not bypass subscription selection.

For **Bicep**, these selections describe the initial exported environment, not a deployment lock. The generated pipeline takes its deployment subscription, resource group, app, location, hosting plan and storage account from six required pipeline variables. Configure them in the Azure DevOps pipeline UI or variable groups; no source-environment values are embedded as YAML variable defaults. The workspace defaults to the existing ARM convention in the effective deployment subscription, not the export subscription. Changing deployment targets does not require regenerating or rewriting the exported files.

## Backend and Azure DevOps task prerequisites

Both the local design-time workflow host and the cloud managed-connection export service must include the native infrastructure export implementation. There is no capabilities endpoint or minimum deployed version guaranteed by this client. Updating only the extension is insufficient.

The Bicep pipeline also requires an Azure DevOps extension build containing **`AzureLogicAppsStandardConnectionsDeployment` major version `1`** (V1 manifest `1.0.0`) to be released and installed in the target Azure DevOps organization. Generated native task references select **`AzureLogicAppsStandardConnectionsDeployment@1`**, not a full patch-version pin. The original **`@0` remains available for existing users and legacy pipelines**; it does not satisfy the native Bicep export contract and must not silently run instead of `@1`. An existing Marketplace installation containing only V0 is not proof of native capability. Backend deployment and task publication/installation are separate prerequisites; neither is performed by generation, and no released backend or task version is assumed.

This client validates the export contract; it does not publish or install the Azure DevOps task. Native task implementation, V1 packaging and offline validation belong to the separate Azure DevOps task project; task publication/organization installation and matching backend rollout remain prerequisites. Source implementation and export validation are not evidence that the required task is available in an organization or that a live pipeline has run.

The extension uses the existing local `generateDeploymentArtifacts` endpoint on the **discovered design-time port**, with the original six target fields and optional `infrastructureFormat: Bicep | Terraform`. It independently calls the existing managed-connection `generateDeploymentArtifacts?api-version=2018-07-01-preview` endpoint with `TargetLogicAppName`, `ConnectionReferenceName`, and `InfrastructureFormat`. Connection resource IDs are resolved read-only from local workflow parameters and app settings; the source connection's subscription/resource group identify the resource to export. The selected target scope is passed to the host. For default/ARM requests, the new format field is omitted for compatibility.

Older services can ignore the format and return a successful ARM ZIP. The extension requires matching descriptors where present and exact file inventories. **Bicep host exports require schema `4.0`, `pipelineSupport: AzureDevOps`, the pipeline/settings descriptor fields, and all five files below.** Older Bicep schema-1.0 infrastructure-only, schema-2.0 PowerShell-helper and schema-3.0 JSON-parameter ZIPs are rejected with regenerate guidance, not silently upgraded. Deploy the matching host and cloud managed-connection backend before regenerating. The parsed native pipeline must select exactly one connections-task `@1` invocation with nine required, correctly bound inputs; only optional `connectionNames` and `workspaceResourceId` variable bindings are accepted in addition. Separate host/cleanup tasks, helpers and inline-script substitutes remain unsupported. The older three-input pipeline that derived deployment targets from exported files is rejected, even if its schema/task major match. Both native host descriptors require `requiredInputs: []`: regenerate earlier experimental exports that declare a mandatory workspace, because their modules do not implement this default. Bicep connections use exactly two flat files named for the physical source connection, with no connection descriptor. Older nested Bicep connection ZIPs and descriptor-bearing variants are rejected. Both Terraform modules retain schema `1.0`, `pipelineSupport: None`, and their three-file layout. The extension rejects ARM fallback, mismatched/partial output, unsafe paths and oversized archives before publication. Authentication/network failures retain their original errors and are not classified as unsupported versions.

All required modules are validated before output files are written. Archives are limited to 5 MiB compressed and 20 MiB expanded; each complete export is limited to 20 MiB and 100 connections. Optional directory entries, including bounded identical repeats emitted by the ZIP writer, do not count as files; duplicate files and case-alias paths remain errors. Output is staged in a newly reserved directory and published under `deployment/bicep-<unique>/artifacts/` or `deployment/terraform-<unique>/artifacts/`. Existing exports are never overwritten. Failed publication removes only the newly allocated directory.

## Diagnosing export failures

The native export confirmation is always shown before generation. It is a credential/artifact-scope warning, not a capability probe, user-identity restriction, or indication that an old backend was detected.

The local design-time host export runs first. Only after its ZIP passes validation does the client export managed connections through the separate cloud service. HTTP failures identify the format, local/cloud boundary, HTTP status and `POST` route template without resource identifiers, query strings, request values or credentials. Only five known backend error codes are included when present in the structured `error.code` field: `LogicAppTargetDeploymentArtifactsInputInvalid`, `InvalidRequestContent`, `MissingIaCFile`, `InvalidApiConnectionDeploymentArtifactsGenerationRequest` and `WorkflowParametersInvalidExpression`. Unrecognized codes and raw server messages/bodies are not displayed. Optional error-body parsing is bounded to 16 KiB; malformed or oversized bodies retain the stage/status diagnostic. Check the indicated host or service diagnostics for the underlying failure; HTTP 400 alone does not establish a bundle/version mismatch.

Renaming a bundle directory does not rebuild its assemblies, prove which bundle a running design-time host loaded, restart that host, or update the cloud managed-connection service. Verify the selected/running host and its server-side error before attributing a failure to bundle selection. No live host restart or cloud operation is performed by these diagnostic changes.

### ARM parameterization

ARM generation still offers parameterization when a connection needs it. Existing runtime URL `@appsetting(...)` bindings are recognized alongside `@parameters(...)` bindings, including case variants, so a literal API ID alone does not trigger a redundant prompt for such a connection. If another connection does need parameterization, repeated processing preserves existing authentication parameter values, runtime URL parameter values and their local setting values.

An authentication reference such as `@parameters('arm-1-Authentication')` is valid in **connections.json**. Its referenced value in runtime **parameters.json** must contain the actual authentication object or an allowed app-setting binding, not another `@parameters(...)` lookup. In particular, a value that references its own parameter is invalid. ARM generation and the parameterization command reject missing or parameter-linked authentication values before parameterization writes or export requests.

If a previous parameterization already replaced an authentication value with a self-reference, the original object is no longer present there. Restore the affected parameter's original value from source control or a known-good backup; also review any runtime URL local settings overwritten with expression text. Do not infer an authentication type or credentials from the connector name, and do not replace every connection reference with an app-setting reference. This fix prevents new corruption but does not reconstruct missing authentication or modify an existing customer project automatically. Bicep/Terraform export remains read-only with respect to these source files.

## Output and caller responsibilities

Each export contains `<app>/infrastructure/`:

| Module | Bicep | Terraform |
|---|---|---|
| Host | `<logicappname>.bicep`, `<logicappname>.bicepparam`, `infrastructure-export.json`, `infrastructure-pipeline.yml`, `pipeline-settings.json` | `main.tf`, `terraform.tfvars.json`, `infrastructure-export.json` |
| Each connection | `<connectionname>.bicep`, `<connectionname>.bicepparam` directly in `infrastructure/` | `connections/<reference>/{main.tf,inputs.json,export.json}` |

The Bicep basenames are the exact-case **source** app and physical connection resource names, not workflow references, display names or deployment-target overrides. All files remain flat. Before export requests, the client rejects unsafe Windows stems (including reserved devices and trailing dots/spaces), host/connection equality, repeated physical connection names across references or scopes, and case-only collisions within one app's infrastructure directory. It does not suffix, normalize, deduplicate or move pairs into subfolders. Correct conflicting source names before retrying; target `connectionNames` overrides cannot resolve a source-file collision.

Generated host `<logicappname>.bicepparam` / `terraform.tfvars.json` files omit `workspaceResourceId`; the client does not inject it or rewrite the host template. Bicep defaults this parameter using deployment-time `subscription().subscriptionId`; Terraform derives it from the effective target `var.subscriptionId`. The existing ARM default is `/subscriptions/<deployment-subscription-id>/resourceGroups/defaultresourcegroup-eus/providers/microsoft.operationalinsights/workspaces/defaultworkspace-<deployment-subscription-id>-eus`. This names an **existing** East US default workspace; it does not discover or create one. Review its availability before deployment. An optional valid explicit workspace ID in a standalone host input file is preserved unchanged. Bicep pipeline settings contain no duplicate workspace/scope/name inputs. Review remaining authentication/target inputs before deployment; Terraform connection descriptors still list their required inputs. Native export is not a ready-made application release or a guarantee of authenticated connectors.

Bicep parameter files are genuine native syntax: the host starts with `using './<logicappname>.bicep'`; each child starts with `using './<connectionname>.bicep'`. The reference `main` remains valid independently of filenames; a physical name `main` is valid only when it does not collide with another source stem. Known scalar parameters are quoted Bicep strings. Only the object inputs `authentication` and `additionalAppSettings` use `json('<escaped JSON object>')`, supporting nested JSON values and literal expression-looking text. Numeric support is conditional on the Bicep compiler preserving the value, not arbitrary-precision fidelity. The client reads this closed generated profile without executing Bicep or requiring a compiler. It rejects interpolation, other functions, imports/extends, comments, unknown or duplicate declarations, duplicate JSON object keys, trailing content, wrong template bindings and invalid known types before publication. Existing ZIP byte limits apply; object nesting is bounded to 64 containers and 100,000 structural/value tokens. Original parameter bytes are never rewritten, including large integer text. Client validation retains JavaScript's existing JSON number semantics and therefore does not establish compiler numeric fidelity.

The numeric-fidelity policy is **reject values that Bicep cannot preserve, with a clear error**, never silently accept rounding. Ordinary fractional values and Int64 values remain supported when the compiler preserves them. For example, Bicep `0.38.33` rounds the decimal `0.1234567890123456789012345678` to `0.12345678901234568`; preserving the original text in the exported file or forwarding raw authentication data does not make ordinary compiler consumption lossless. The producer preserves exact source numeric text rather than approximating the compiler's behavior. The matching task is the enforcement authority: it must compare raw source numbers with actual compiler output and reject changed values before any Azure operation, including for manually edited object values. Client acceptance and successful generation alone do not certify numeric fidelity. The client neither runs a compiler nor substitutes a lossy JavaScript-number comparison. Direct compiler consumers outside the task must enforce the same fidelity check rather than deploy rounded output. Use matching backend and task builds containing these safeguards; no released rollout is assumed.

The existing optional host `skuCode` remains a quoted string; `numberOfWorkers` accepts only one decimal integer literal from 1 through 100 (no fractions, exponents or expressions). The producer does not add either optional field. These names are not accepted in child parameter files.

The deployment task privately compiles `.bicepparam` to effective ARM parameters before applying the existing authoritative pipeline-target overrides. Template dependency restrictions, ambient Bicep configuration and compiler isolation are task responsibilities: client acceptance is not permission to compile arbitrary templates, and `--no-restore` alone is not isolation. `pipeline-settings.json` remains schema `1.0`, and the unreleased native task remains `@1` / manifest `1.0.0`; this migration does not change ARM, Terraform or V0 contracts.

Bicep connections have **no `.export.json` file**. Each pair's decoded `connectionName` must match its physical basename exactly; decoded `connectionReferenceName` binds it one-to-one to the existing `pipeline-settings.json` reference/runtime-setting mapping. References are never inferred from filenames. The bounded root inventory excludes the descriptor-declared host pair and rejects orphan, extra, duplicate or unlisted pairs. Older experimental fixed-name exports must be regenerated with matching host/service builds unless their names and all other contents already satisfy this contract. The remaining host `infrastructure-export.json` and Terraform descriptors describe the format/schema, module kind, scope/reference where applicable, entrypoint/input filenames, complete file inventory, sensitive files, required inputs and infrastructure-only exclusions. They also carry runtime-linkage and credential/state-handling guidance. The client requires descriptor scope to match the initial export request as provenance. For Bicep deployment, that provenance is not a target-scope constraint: the task applies the required pipeline targets in private staged copies before deployment validation. Descriptors contain metadata, not connection credentials; input files can still contain plaintext credentials.

## Bicep infrastructure pipeline configuration

The generated pipeline invokes **`AzureLogicAppsStandardConnectionsDeployment@1` once**:

```yaml
- task: AzureLogicAppsStandardConnectionsDeployment@1
  inputs:
    connectedServiceName: ${{ parameters.serviceConnectionName }}
    infrastructureFormat: Bicep
    infrastructureDirectory: $(Build.SourcesDirectory)/${{ parameters.infrastructureDirectory }}
    subscriptionId: $(subscriptionId)
    resourceGroupName: $(resourceGroupName)
    appName: $(logicAppName)
    location: $(resourceGroupLocation)
    hostingPlanName: $(hostingPlanName)
    storageAccountName: $(storageAccountName)
```

Define all six target variables in the pipeline UI or variable groups:

| Pipeline variable | Task input | Meaning |
|---|---|---|
| `subscriptionId` | `subscriptionId` | Target subscription ID |
| `resourceGroupName` | `resourceGroupName` | Target resource group |
| `logicAppName` | `appName` | Target Standard Logic App name |
| `resourceGroupLocation` | `location` | Deployment location for host and connections |
| `hostingPlanName` | `hostingPlanName` | Target App Service plan name |
| `storageAccountName` | `storageAccountName` | Target storage account name |

These are required native task inputs. Blank values or unresolved macros fail before authentication; there is no fallback to the descriptor or host parameters for these six targets. Other exported host options, such as SKU, workers and additional app settings, remain file inputs and require review for the chosen environment.

No workspace pipeline variable is required or emitted. To override the ARM default explicitly, optionally add task input `workspaceResourceId: '$(workspaceResourceId)'` and define that variable as a full workspace resource ID, including an intentional cross-subscription ID when needed. An absent or blank task input uses the module's deployment-subscription default; a nonblank unresolved macro or malformed ID fails before authentication. Without this explicit task override, the task omits even an existing source-file workspace value from its private effective host parameters, so an old export-subscription workspace cannot silently override the deployment target. Exported source files remain unchanged.

The task owns the complete lifecycle: validate the effective target host/connection inventory and exact runtime mappings before Azure operations, preserve settings from the actual deployment target, deploy the host, deploy every connection/access policy using that host's actual identity and target location, link runtime URLs only after all connection deployments succeed, then clean up its private temporary inputs internally even on failure. Exported source/child files remain unchanged. There are no public lifecycle inputs, working-directory inputs, output-variable wiring or separate host/cleanup steps to configure. These responsibilities belong to the separate Azure DevOps task, not this client; offline validation does not demonstrate a live pipeline run.

There is **no exported `Invoke-BicepInfrastructure.ps1`, inline PowerShell or script-task replacement**. Connection deployment and its preflight/linkage logic belong to the Azure DevOps task, not generated scripts. No application package or deployment workflow parameters are generated. Existing ARM task behavior remains the default; the generated Bicep steps select the native format explicitly.

Configure the queue parameters **`serviceConnectionName`** and **`infrastructureDirectory`**, authorize the Azure DevOps service connection, and review target connection resource/display names and authentication in each `<connectionname>.bicepparam`. Keep each pair alongside the five host files. The service connection and infrastructure path are deployment configuration, not local export credentials. The backend's default infrastructure directory is `<app>/infrastructure`; when retaining the extension's directory structure in a repository, set it to `deployment/bicep-<unique>/artifacts/<app>/infrastructure` relative to the repository root.

The infrastructure directory continues to identify the original export even when `logicAppName` names a different target app. To override connection resource names without editing their files, optionally add task input `connectionNames: '$(connectionNames)'` and define that pipeline variable as a JSON object such as `{"stable-reference":"target-connection-name"}`. This input is omitted from generated YAML; no variable is needed when not using overrides. Omitted entries retain their exported resource names. The task rejects malformed/duplicate JSON keys, unknown references and duplicate effective resource names before authentication. References, pair filenames, display names, authentication and runtime-setting mappings are not renamed.

Opaque authentication values, nested resource IDs/endpoints and environment-specific additional app settings are **not automatically retargeted**. Review them explicitly for the target environment; changing pipeline scope is not a credential migration or a guarantee of authenticated connections.

The client populates `pipeline-settings.json` with **every connection module actually assembled**:

```json
{
  "schemaVersion": "1.0",
  "connections": [
    { "connectionReferenceName": "reference", "runtimeUrlSettingName": "exact-consumed-appsetting-key" },
    { "connectionReferenceName": "needs-review", "runtimeUrlSettingName": null }
  ]
}
```

Only exact static source `@appsetting(...)` bindings, or one workflow parameter whose value is an exact app-setting binding, are recognized. Local settings/secret URL values are not evaluated to infer keys. Literal URLs, missing bindings and arbitrary expression/parameter indirection remain **null and require explicit review**. The connections task rejects null/omitted mappings before Azure operations; it does not silently substitute a reference-based naming convention. Set the intended exact key explicitly, including `<reference>-ConnectionRuntimeUrl` only when deliberately chosen for the application. Protected host runtime/context settings cannot be linkage destinations. The client does not modify source connections or workflow parameters to make a convention fit.

An application with no managed connections receives an explicitly empty inventory. Every configured reference requires its flat Bicep template/parameters pair. Missing, extra or malformed dependencies fail preflight; generation failures publish no partial export. Input files may contain plaintext auth material even though pipeline settings contain names only.

## Terraform caller composition

Terraform connection modules are **child modules for one application root**, not separate states. `inputs.json` is input data, not an automatically loaded tfvars file. Compose host/connection modules and identity outputs yourself. Import existing resources and access policies before applying infrastructure.

Runtime URLs are not created during generation. The Bicep infrastructure pipeline obtains and publishes them after successful child deployment using the explicitly configured exact keys; Terraform still requires caller-managed post-deployment URL linkage. The Terraform descriptor's `<reference>-ConnectionRuntimeUrl` convention is reference-based, not the legacy pipeline task's display-name convention, and does not discover arbitrary source indirection. Preserve the distinctions between connection reference, resource name and display name. Supply all published settings on subsequent host deployments.

**Input files may contain plaintext credentials returned by management APIs.** Pipelines and secure/sensitive parameter typing do not encrypt these files or Terraform state. Protect files, output directories and state; use appropriate ACLs and do not commit credentials. Native exports do not include workflows, source `connections.json` or deployment workflow parameters. Hybrid native export and Terraform pipelines are unsupported. Deploying the revised backend is required for the Bicep pipeline and Standard ARM task migration; installing connections-task major `@1` is additionally required for Bicep. No deployed service/task release is assumed by this client.
