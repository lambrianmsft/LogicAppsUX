# Graph Report - src  (2026-07-21)

## Corpus Check
- 31 files · ~4,960 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 345 nodes · 511 edges · 12 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db11eba8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lib/models/project.ts
- src/lib/models/project.ts
- lib/models/workflow.ts
- lib/models/templates/index.ts
- lib/models/index.ts
- lib/models/connection.ts
- HttpClient
- src/index.ts
- src/lib/models/connection.ts
- src/lib/models/index.ts
- src/lib/models/templates/index.ts
- HttpClient

## God Nodes (most connected - your core abstractions)
1. `HttpClient` - 10 edges
2. `HttpClient` - 10 edges
3. `IProjectWizardContext` - 8 edges
4. `IProjectWizardContext` - 8 edges
5. `FuncVersion` - 6 edges
6. `IProjectTreeItem` - 6 edges
7. `IWorkflowTemplate` - 6 edges
8. `IWorkflowTemplate` - 6 edges
9. `Artifacts` - 5 edges
10. `FileDetails` - 5 edges

## Surprising Connections (you probably didn't know these)
- `IFunctionWizardContext` --inherits--> `IProjectWizardContext`  [EXTRACTED]
  src/lib/models/functions.ts → src/lib/models/project.ts
- `IProjectWizardContext` --references--> `FuncVersion`  [EXTRACTED]
  lib/models/project.ts → lib/models/functions.ts
- `IFunctionWizardContext` --references--> `IWorkflowTemplate`  [EXTRACTED]
  lib/models/functions.ts → lib/models/templates/IWorkflowTemplate.ts
- `ConnectionPanelMetadata` --references--> `Artifacts`  [EXTRACTED]
  src/lib/models/connection.ts → src/lib/models/artifact.ts
- `DesignerPanelMetadata` --references--> `Artifacts`  [EXTRACTED]
  src/lib/models/workflow.ts → src/lib/models/artifact.ts

## Import Cycles
- None detected.

## Communities (12 total, 0 thin omitted)

### Community 0 - "lib/models/project.ts"
Cohesion: 0.06
Nodes (39): ICliFeed, IRelease, ITag, IWorkerRuntime, azureFunctionsVersion, ICommandResult, ICreateFunctionOptions, IFunctionWizardContext (+31 more)

### Community 1 - "src/lib/models/project.ts"
Cohesion: 0.05
Nodes (45): ICliFeed, IRelease, ITag, IWorkerRuntime, StorageOptions, ICreateLogicAppContext, IDebugModeContext, IIdentityWizardContext (+37 more)

### Community 2 - "lib/models/workflow.ts"
Cohesion: 0.12
Nodes (18): Artifacts, FileDetails, IArtifactFile, IGitHubReleaseInfo, IParametersFileContent, Parameter, ParametersData, AzureConnectorDetails (+10 more)

### Community 3 - "lib/models/templates/index.ts"
Cohesion: 0.15
Nodes (16): IBundleDependencyFeed, IBundleFeed, BindingSettingValue, IBindingSetting, IBindingTemplate, IEnumValue, ResourceType, ValueType (+8 more)

### Community 4 - "lib/models/index.ts"
Cohesion: 0.07
Nodes (21): FetchSchemaData, InitializeData, MapDefinitionData, MessageToVsix, MessageToWebview, SchemaPathData, XsltData, ExtensionCommand (+13 more)

### Community 5 - "lib/models/connection.ts"
Cohesion: 0.10
Nodes (22): AgentConnectionModel, AgentMcpConnectionModel, AllCustomCodeFiles, APIManagementConnectionModel, ConnectionAcl, ConnectionAndSettings, ConnectionReferenceModel, ConnectionsData (+14 more)

### Community 6 - "HttpClient"
Cohesion: 0.25
Nodes (7): getExtraHeaders(), HttpClient, HttpOptions, isArmResourceId(), isSuccessResponse(), isUrl(), parseResponse()

### Community 7 - "src/index.ts"
Cohesion: 0.09
Nodes (8): getBaseGraphApi(), getBaseGraphApi(), IDecodedJwtToken, JwtTokenConstants, JwtTokenHelper, IDecodedJwtToken, JwtTokenConstants, JwtTokenHelper

### Community 8 - "src/lib/models/connection.ts"
Cohesion: 0.07
Nodes (35): Artifacts, FileDetails, IArtifactFile, IGitHubReleaseInfo, AgentConnectionModel, AgentMcpConnectionModel, AllCustomCodeFiles, APIManagementConnectionModel (+27 more)

### Community 9 - "src/lib/models/index.ts"
Cohesion: 0.08
Nodes (19): CodeSelection, FetchSchemaData, InitializeData, MapDefinitionData, MessageToVsix, MessageToWebview, SchemaPathData, XsltData (+11 more)

### Community 10 - "src/lib/models/templates/index.ts"
Cohesion: 0.13
Nodes (17): IBundleDependencyFeed, IBundleFeed, IFunctionWizardContext, BindingSettingValue, IBindingSetting, IBindingTemplate, IEnumValue, ResourceType (+9 more)

### Community 11 - "HttpClient"
Cohesion: 0.25
Nodes (7): getExtraHeaders(), HttpClient, HttpOptions, isArmResourceId(), isSuccessResponse(), isUrl(), parseResponse()

## Knowledge Gaps
- **178 isolated node(s):** `IArtifactFile`, `IGitHubReleaseInfo`, `IBundleDependencyFeed`, `ICliFeed`, `IRelease` (+173 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `IArtifactFile`, `IGitHubReleaseInfo`, `IBundleDependencyFeed` to the rest of the system?**
  _178 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib/models/project.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06236786469344609 - nodes in this community are weakly interconnected._
- **Should `src/lib/models/project.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `lib/models/workflow.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12380952380952381 - nodes in this community are weakly interconnected._
- **Should `lib/models/templates/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14736842105263157 - nodes in this community are weakly interconnected._
- **Should `lib/models/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07126436781609195 - nodes in this community are weakly interconnected._
- **Should `lib/models/connection.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._