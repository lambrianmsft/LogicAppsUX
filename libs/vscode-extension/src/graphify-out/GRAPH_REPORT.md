# Graph Report - src  (2026-05-26)

## Corpus Check
- 31 files · ~4,891 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 224 nodes · 285 edges · 39 communities (38 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ea53459a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]

## God Nodes (most connected - your core abstractions)
1. `HttpClient` - 10 edges
2. `HttpClient` - 9 edges
3. `IProjectWizardContext` - 7 edges
4. `IWorkflowTemplate` - 6 edges
5. `isArmResourceId()` - 5 edges
6. `JwtTokenHelper` - 5 edges
7. `FuncVersion` - 5 edges
8. `ProjectLanguage` - 5 edges
9. `JwtTokenHelper` - 5 edges
10. `isArmResourceId()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `IProjectWizardContext` --references--> `WorkflowProjectType`  [EXTRACTED]
  lib/models/project.ts → lib/models/workflow.ts
- `IProjectWizardContext` --references--> `TargetFramework`  [EXTRACTED]
  lib/models/project.ts → lib/models/workflow.ts
- `IFunctionWizardContext` --references--> `IWorkflowTemplate`  [EXTRACTED]
  lib/models/functions.ts → lib/models/templates/IWorkflowTemplate.ts
- `IProjectWizardContext` --references--> `IWorkerRuntime`  [EXTRACTED]
  lib/models/project.ts → lib/models/cliFeed.ts
- `IDesignerPanelMetadata` --references--> `Parameter`  [EXTRACTED]
  lib/models/workflow.ts → lib/models/parameter.ts

## Communities (39 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.29
Nodes (6): getExtraHeaders(), HttpClient, isArmResourceId(), isSuccessResponse(), isUrl(), parseResponse()

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (25): ICliFeed, IRelease, ITag, IWorkerRuntime, IBundleMetadata, IHostJsonV1, IHostJsonV2, IParsedHostJson (+17 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (19): Artifacts, FileDetails, IArtifactFile, IGitHubReleaseInfo, IParametersFileContent, Parameter, ParametersData, AzureConnectorDetails (+11 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (16): AgentConnectionModel, AgentMcpConnectionModel, AllCustomCodeFiles, APIManagementConnectionModel, ConnectionAcl, ConnectionAndSettings, ConnectionReferenceModel, ConnectionsData (+8 more)

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (11): getExtraHeaders(), HttpClient, HttpOptions, isArmResourceId(), isSuccessResponse(), isUrl(), parseResponse(), errorMessage (+3 more)

### Community 35 - "Community 35"
Cohesion: 0.14
Nodes (17): IBundleDependencyFeed, IBundleFeed, IFunctionWizardContext, BindingSettingValue, IBindingSetting, IBindingTemplate, IEnumValue, ResourceType (+9 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (21): FetchSchemaData, InitializeData, MapDefinitionData, MessageToVsix, MessageToWebview, SchemaPathData, XsltData, ExtensionCommand (+13 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (4): getBaseGraphApi(), IDecodedJwtToken, JwtTokenConstants, JwtTokenHelper

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (17): StorageOptions, ICreateLogicAppContext, IDebugModeContext, IIdentityWizardContext, ILogicAppWizardContext, azureFunctionsVersion, FuncVersion, ICommandResult (+9 more)

## Knowledge Gaps
- **96 isolated node(s):** `JwtTokenConstants`, `IDecodedJwtToken`, `httpClientOptions`, `responseData`, `options` (+91 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `JwtTokenConstants`, `IDecodedJwtToken`, `httpClientOptions` to the rest of the system?**
  _96 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.082010582010582 - nodes in this community are weakly interconnected._
- **Should `Community 32` be split into smaller, more focused modules?**
  _Cohesion score 0.11688311688311688 - nodes in this community are weakly interconnected._
- **Should `Community 33` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Community 35` be split into smaller, more focused modules?**
  _Cohesion score 0.1380952380952381 - nodes in this community are weakly interconnected._
- **Should `Community 36` be split into smaller, more focused modules?**
  _Cohesion score 0.07126436781609195 - nodes in this community are weakly interconnected._
- **Should `Community 38` be split into smaller, more focused modules?**
  _Cohesion score 0.14210526315789473 - nodes in this community are weakly interconnected._