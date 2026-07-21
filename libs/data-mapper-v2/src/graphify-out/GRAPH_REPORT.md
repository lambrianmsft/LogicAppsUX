# Graph Report - src  (2026-07-21)

## Corpus Check
- 143 files · ~77,576 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1278 nodes · 3746 edges · 62 communities (54 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 58 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db11eba8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- MapDefinitionDeserializer
- MapDefinitionSerializer.ts
- images/FunctionIcons/FunctionIcons.tsx
- images/FunctionIcons/DataType16Icons.tsx
- images/FunctionIcons/DataType24Icons.tsx
- MapChecker.Utils.ts
- core/services/dataMapperApiService/index.ts
- DataMapDataProvider.tsx
- Schema.Utils.ts
- core/state/DataMapSlice.ts
- DataMap.Utils.ts
- TrieTree
- components/common/selector/FileSelector.tsx
- isFunctionNode
- components/schema/useSchema.ts
- src/images/FunctionIcons/FunctionIcons.tsx
- components/test/TestPanel.tsx
- Edge.Utils.ts
- Function.Utils.ts
- components/schema/SchemaPanel.tsx
- FunctionCategory
- components/canvas/ReactFlow.tsx
- applyConnectionValue
- Connection.Utils.ts
- ThemeConect.ts
- core/index.ts
- FunctionData
- src/core/state/DataMapSlice.ts
- components/canvas/useReactflowStates.ts
- src/core/state/selectors/selectors.ts
- src/components/common/reactflow/FunctionNode.tsx
- RootState
- src/components/functionsPanel/FunctionPanel.tsx
- DataMapperDesigner.tsx
- src/core/state/PanelSlice.ts
- addTargetReactFlowPrefix
- Icon.Utils.tsx
- src/core/state/ErrorsSlice.ts
- intl-test-helper.tsx
- utils/reactFlowTesting/NodeInspector.tsx
- ReactFlow.ts
- Svg.d.ts
- src/components/canvas/ReactFlow.tsx
- src/images/FunctionIcons/DataType16Icons.tsx
- src/images/FunctionIcons/DataType24Icons.tsx
- src/components/schema/useSchema.ts
- src/components/common/selector/FileSelector.tsx
- TrieTree
- core/state/PanelSlice.ts
- core/state/Store.ts
- DataMapperApiService
- DataMapperApiService
- src/components/schema/SchemaPanel.tsx
- components/commandBar/EditorCommandBar.tsx
- src/core/state/Store.ts
- FunctionManifest
- src/core/state/ModalSlice.ts
- src/utils/reactFlowTesting/NodeInspector.tsx

## God Nodes (most connected - your core abstractions)
1. `FunctionData` - 59 edges
2. `isSchemaNodeExtended()` - 43 edges
3. `ConnectionDictionary` - 38 edges
4. `MapDefinitionDeserializer` - 37 edges
5. `applyConnectionValue()` - 35 edges
6. `isNodeConnection()` - 32 edges
7. `RootState` - 31 edges
8. `RootState` - 31 edges
9. `convertSchemaToSchemaExtended()` - 30 edges
10. `isCustomValueConnection()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `FunctionListItemProps` --references--> `FunctionData`  [EXTRACTED]
  components/functionList/FunctionListItem.tsx → src/models/Function.ts
- `InputDropdownProps` --references--> `FunctionData`  [EXTRACTED]
  components/functionConfigurationMenu/inputDropdown/InputDropdown.tsx → src/models/Function.ts
- `FunctionState` --references--> `FunctionData`  [EXTRACTED]
  core/state/FunctionSlice.ts → src/models/Function.ts
- `ExtendedRenderOptions` --references--> `RootState`  [EXTRACTED]
  src/__test__/redux-test-helper-dm.tsx → core/state/Store.ts
- `InitialDataMapAction` --references--> `ConnectionDictionary`  [EXTRACTED]
  core/state/DataMapSlice.ts → src/models/Connection.ts

## Import Cycles
- None detected.

## Communities (62 total, 8 thin omitted)

### Community 0 - "MapDefinitionDeserializer"
Cohesion: 0.12
Nodes (11): DataProviderInner(), MapDefinitionDeserializer, createSchemaNodeOrFunction(), getSingleValueMetadata(), getSourceNode(), isTokenCustomValue(), separateFunctions(), addSourceReactFlowPrefix() (+3 more)

### Community 1 - "MapDefinitionSerializer.ts"
Cohesion: 0.14
Nodes (31): addConditionalToNewPathItems(), addLoopingForToNewPathItems(), applyValueAtPath(), convertToArray(), convertToMapDefinition(), createNewPathItems(), createSourcePath(), createYamlFromMap() (+23 more)

### Community 2 - "images/FunctionIcons/FunctionIcons.tsx"
Cohesion: 0.05
Nodes (20): AbsoluteValue32Regular, AngleIcon, CeilingValue32Regular, Count32Regular, Divide32Regular, EPowerX32Regular, FloorValue32Regular, GreaterThan32Regular (+12 more)

### Community 3 - "images/FunctionIcons/DataType16Icons.tsx"
Cohesion: 0.08
Nodes (12): Any16Filled, Any16Regular, Array16Filled, Array16Regular, Binary16Filled, Binary16Regular, Decimal16Filled, Decimal16Regular (+4 more)

### Community 4 - "images/FunctionIcons/DataType24Icons.tsx"
Cohesion: 0.08
Nodes (12): Any24Filled, Any24Regular, Array24Filled, Array24Regular, Binary24Filled, Binary24Regular, Decimal24Filled, Decimal24Regular (+4 more)

### Community 5 - "MapChecker.Utils.ts"
Cohesion: 0.11
Nodes (22): getConnectionForAnyKey(), hasExpectedConnection(), isEqualToCustomValue(), Connection, CustomValueConnection, NodeConnection, functionMock, getConnectionForAnyKey() (+14 more)

### Community 6 - "core/services/dataMapperApiService/index.ts"
Cohesion: 0.23
Nodes (9): DataMapperApiServiceOptions, DmErrorResponse, dataMapperApiVersions, defaultDataMapperApiServiceOptions, GenerateXsltResponse, IDataMapperApiService, InitDataMapperApiService(), exampleTree (+1 more)

### Community 7 - "DataMapDataProvider.tsx"
Cohesion: 0.08
Nodes (22): DataMapDataProviderProps, appSlice, AppState, initialState, functionSlice, FunctionState, initialFunctionState, initialSchemaState (+14 more)

### Community 8 - "Schema.Utils.ts"
Cohesion: 0.15
Nodes (14): calculateIndexValue(), functionDropDownItemText(), functionInputHasInputs(), getFunctionOutputValue(), removeQuotesFromString(), convertSchemaNodeToSchemaNodeExtended(), convertSchemaToSchemaExtended(), deepestNode() (+6 more)

### Community 9 - "core/state/DataMapSlice.ts"
Cohesion: 0.09
Nodes (26): DataMapOperationState, InitialDataMapAction, ConnectionDictionary, FunctionDictionary, ComponentState, DataMapOperationState, dataMapSlice, DataMapState (+18 more)

### Community 10 - "DataMap.Utils.ts"
Cohesion: 0.11
Nodes (28): mapNodeParams, reservedMapDefinitionKeysArray, ConditionalMetadata, getLoopTargetNode(), getLoopTargetNodeWithJson(), LoopMetadata, indexed, addParentConnectionForRepeatingElementsNested() (+20 more)

### Community 11 - "TrieTree"
Cohesion: 0.15
Nodes (3): TrieTree, TrieTreeNode, AppState

### Community 12 - "components/common/selector/FileSelector.tsx"
Cohesion: 0.15
Nodes (15): useStyles, DataMapperFileService(), FileDropdownTree(), FileDropdownTreeProps, CustomListItem(), InputTabContents(), useStyles, XsltFilePicker() (+7 more)

### Community 13 - "isFunctionNode"
Cohesion: 0.17
Nodes (21): MapCheckerItem(), MapCheckerItemProps, MapCheckerPanel(), useMapCheckerItemStyles, useStyles, getCoordinatesForHandle(), MapCheckerItem(), MapCheckerItemProps (+13 more)

### Community 14 - "components/schema/useSchema.ts"
Cohesion: 0.25
Nodes (14): HandleResponseProps, useSchema(), useSchemaProps, SchemaTree(), SchemaTreeProps, SchemaTreeNode(), SchemaTreeNodeProps, TypeAnnotation() (+6 more)

### Community 15 - "src/images/FunctionIcons/FunctionIcons.tsx"
Cohesion: 0.05
Nodes (20): AbsoluteValue32Regular, AngleIcon, CeilingValue32Regular, Count32Regular, Divide32Regular, EPowerX32Regular, FloorValue32Regular, GreaterThan32Regular (+12 more)

### Community 16 - "components/test/TestPanel.tsx"
Cohesion: 0.22
Nodes (11): Panel(), PanelProps, PanelXButton(), PanelXButtonProps, useStyles, AppDispatch, useStyles, TestPanel() (+3 more)

### Community 17 - "Edge.Utils.ts"
Cohesion: 0.19
Nodes (17): BoundingBox, convertCanvasToGridPoint(), convertGridToCanvasPoint(), findPath(), generateBoundingBoxes(), generatePathfindingGrid(), getLinearDistance(), getLineStretchLength() (+9 more)

### Community 18 - "Function.Utils.ts"
Cohesion: 0.07
Nodes (42): InputDropdown(), InputDropdownProps, InputOptionProps, useStyles, InputCustomInfoLabel(), CommonProps, CustomListItem(), CustomListItemProps (+34 more)

### Community 19 - "components/schema/SchemaPanel.tsx"
Cohesion: 0.25
Nodes (12): FileWithVsCodePath, SchemaFile, SchemaPanelNodeReactFlowDataProps, ConfigPanelProps, schemaFileQuerySettings, SchemaPanel(), SchemaPanelBody(), SchemaPanelBodyProps (+4 more)

### Community 20 - "FunctionCategory"
Cohesion: 0.11
Nodes (32): FunctionIcon(), FunctionIconProps, FunctionDataTreeItem, FunctionList(), FunctionListProps, fuseFunctionSearchOptions, loopFuseFunctionSearchOptions, NOTE: Explicitly use this instead of isAddingInlineFunction to track inlineFunct (+24 more)

### Community 21 - "components/canvas/ReactFlow.tsx"
Cohesion: 0.13
Nodes (18): EdgePopOver(), EdgePopOverProps, DMReactFlowProps, edgeTypes, nodeTypes, ReactFlowWrapper(), reactFlowStyle, useStyles (+10 more)

### Community 22 - "applyConnectionValue"
Cohesion: 0.28
Nodes (13): reservedMapDefinitionKeys, addConnection(), createSchemaToSchemaNodeConnection(), directAccessPseudoFunction, indexPseudoFunction, addConnection(), createSchemaToSchemaNodeConnection(), addRepeatingInputConnection() (+5 more)

### Community 23 - "Connection.Utils.ts"
Cohesion: 0.12
Nodes (32): handleDirectAccessConnection(), FunctionInput, ifPseudoFunction, NOTE: These values must be in alphabetical order (used in sorting within Functio, handleDirectAccessConnection(), mockBoundedFunctionInputs, parentManyToOneTargetNode, parentTargetNode (+24 more)

### Community 24 - "ThemeConect.ts"
Cohesion: 0.11
Nodes (20): FunctionCategoryColorToken, customDarkTokens, customTokens, DataMapperTheme, extendedWebDarkTheme, extendedWebLightTheme, fnColors, spacingOverrides (+12 more)

### Community 25 - "core/index.ts"
Cohesion: 0.07
Nodes (33): EditorCommandBar(), EditorCommandBarProps, useStyles, Panel(), PanelProps, PanelXButton(), PanelXButtonProps, useStyles (+25 more)

### Community 26 - "FunctionData"
Cohesion: 0.16
Nodes (19): OutputTabContents(), validateAndCreateConnectionOutput(), SetConnectionInputAction, InputOptionProps, InputCustomInfoLabel(), CommonProps, CustomListItemProps, InputListProps (+11 more)

### Community 27 - "src/core/state/DataMapSlice.ts"
Cohesion: 0.07
Nodes (31): ComponentState, dataMapSlice, DataMapState, DeleteConnectionAction, deleteConnectionFromConnections(), deleteNodeFromConnections(), deleteParentRepeatingConnections(), Draft2 (+23 more)

### Community 28 - "components/canvas/useReactflowStates.ts"
Cohesion: 0.44
Nodes (7): ReactFlowStatesProps, useReactFlowStates(), ReactFlowStatesProps, useReactFlowStates(), createEdgeId(), getFunctionNode(), convertWholeDataMapToLayoutTree()

### Community 29 - "src/core/state/selectors/selectors.ts"
Cohesion: 0.36
Nodes (7): ConnectedEdge(), useHoverEdge(), useHoverNode(), useSelectedEdge(), useSelectedIntermediateEdge(), useHoverNode(), getReactFlowNodeId()

### Community 30 - "src/components/common/reactflow/FunctionNode.tsx"
Cohesion: 0.12
Nodes (20): CanvasNode(), CanvasNodeProps, CardProps, FunctionCardProps, FunctionNode(), useStyles, DetailsTabContents(), FunctionConfigurationPopover() (+12 more)

### Community 31 - "RootState"
Cohesion: 0.42
Nodes (6): CodeViewPanel(), CodeViewPanelProps, CodeViewPanelBody(), CodeViewPanelBodyProps, useStyles, RootState

### Community 32 - "src/components/functionsPanel/FunctionPanel.tsx"
Cohesion: 0.26
Nodes (7): FunctionPanel(), PanelProps, useStyles, FunctionPanel(), PanelProps, useStyles, FunctionsSVG()

### Community 33 - "DataMapperDesigner.tsx"
Cohesion: 0.10
Nodes (14): DataMapperWrappedContext, ScrollLocation, ScrollProps, IDataMapperFileService, InitDataMapperFileService(), SchemaFile, IDataMapperFileService, InitDataMapperFileService() (+6 more)

### Community 34 - "src/core/state/PanelSlice.ts"
Cohesion: 0.11
Nodes (20): DataMapperApiServiceOptions, DmErrorResponse, NOTE: From BPM repo, looks like two schema files with the same name will prefer, dataMapperApiVersions, defaultDataMapperApiServiceOptions, GenerateXsltResponse, InitDataMapperApiService(), TestMapResponse (+12 more)

### Community 35 - "addTargetReactFlowPrefix"
Cohesion: 0.22
Nodes (10): getCoordinatesForHandle(), useEdgePath(), NodeIds, ReactFlowEdgeType, ReactFlowNodeType, fixMapDefinitionCustomValues(), loadMapDefinition(), TODO: Handle arrays better, currently fine for XML, but this will need to be re- (+2 more)

### Community 36 - "Icon.Utils.tsx"
Cohesion: 0.19
Nodes (6): CollectionRegular, StringCategory20Regular, CollectionRegular, StringCategory20Regular, iconSize, mapCheckerIconStyle

### Community 37 - "src/core/state/ErrorsSlice.ts"
Cohesion: 0.28
Nodes (7): errorsSlice, ErrorsState, initialFunctionState, errorsSlice, ErrorsState, initialFunctionState, MapIssue

### Community 44 - "src/components/canvas/ReactFlow.tsx"
Cohesion: 0.12
Nodes (20): EdgePopOver(), EdgePopOverProps, DMReactFlowProps, edgeTypes, nodeTypes, NOTE: Putting this useEffect here for vis next to onSave, ReactFlowWrapper(), reactFlowStyle (+12 more)

### Community 45 - "src/images/FunctionIcons/DataType16Icons.tsx"
Cohesion: 0.08
Nodes (12): Any16Filled, Any16Regular, Array16Filled, Array16Regular, Binary16Filled, Binary16Regular, Decimal16Filled, Decimal16Regular (+4 more)

### Community 46 - "src/images/FunctionIcons/DataType24Icons.tsx"
Cohesion: 0.08
Nodes (12): Any24Filled, Any24Regular, Array24Filled, Array24Regular, Binary24Filled, Binary24Regular, Decimal24Filled, Decimal24Regular (+4 more)

### Community 47 - "src/components/schema/useSchema.ts"
Cohesion: 0.21
Nodes (17): SchemaPanelBody(), usePanelBodyStyles, SchemaTree(), SchemaTreeProps, SchemaTreeNode(), SchemaTreeNodeProps, TypeAnnotation(), SchemaTreeNodeHandle() (+9 more)

### Community 48 - "src/components/common/selector/FileSelector.tsx"
Cohesion: 0.17
Nodes (14): FileDropdownTree(), FileDropdownTreeProps, MockFileService, FileSelectorOption, FileSelectorProps, SchemaFileSelector(), U, useStyles (+6 more)

### Community 49 - "TrieTree"
Cohesion: 0.20
Nodes (3): TrieTree, TrieTreeNode, AppState

### Community 50 - "core/state/PanelSlice.ts"
Cohesion: 0.16
Nodes (13): TestMapResponse, InputListWrapper, CodeViewState, ConfigPanelView, FunctionPanelState, initialState, MapCheckPanelState, MapCheckTabType (+5 more)

### Community 51 - "core/state/Store.ts"
Cohesion: 0.22
Nodes (9): reactPlugin, DataMapperDesignerContext, DataMapperDesignerProvider(), DataMapperDesignerProviderProps, reactPlugin, store, getCustomizedTheme(), includedActionsForUndo (+1 more)

### Community 54 - "src/components/schema/SchemaPanel.tsx"
Cohesion: 0.27
Nodes (8): ConfigPanelProps, schemaFileQuerySettings, SchemaPanel(), usePanelStyles, useStyles, flattenSchemaNodeMap(), getFileNameAndPath(), parsePropertiesIntoNodeProperties()

### Community 55 - "components/commandBar/EditorCommandBar.tsx"
Cohesion: 0.24
Nodes (8): EditorCommandBar(), EditorCommandBarProps, useStyles, MetaMapDefinition, initialState, modalSlice, ModalState, WarningModalState

### Community 56 - "src/core/state/Store.ts"
Cohesion: 0.35
Nodes (7): CodeViewPanel(), CodeViewPanelProps, CodeViewPanelBody(), CodeViewPanelBodyProps, useStyles, includedActionsForUndo, RootState

### Community 58 - "src/core/state/ModalSlice.ts"
Cohesion: 0.33
Nodes (5): initialState, modalSlice, ModalState, NOTE: Currently, modal is just used for discard data map changes warning, WarningModalState

## Knowledge Gaps
- **190 isolated node(s):** `cache`, `intl`, `EdgePopOverProps`, `DMReactFlowProps`, `nodeTypes` (+185 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FunctionData` connect `FunctionData` to `MapDefinitionDeserializer`, `MapChecker.Utils.ts`, `DataMapDataProvider.tsx`, `Schema.Utils.ts`, `core/state/DataMapSlice.ts`, `DataMap.Utils.ts`, `Function.Utils.ts`, `FunctionCategory`, `applyConnectionValue`, `Connection.Utils.ts`, `ThemeConect.ts`, `core/index.ts`, `src/core/state/DataMapSlice.ts`, `src/components/common/reactflow/FunctionNode.tsx`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `MapDefinitionDeserializer` connect `MapDefinitionDeserializer` to `MapChecker.Utils.ts`, `src/core/state/ErrorsSlice.ts`, `DataMapDataProvider.tsx`, `DataMap.Utils.ts`, `FunctionData`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `IDataMapperFileService` connect `DataMapperDesigner.tsx` to `src/components/common/selector/FileSelector.tsx`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `cache`, `intl`, `EdgePopOverProps` to the rest of the system?**
  _190 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MapDefinitionDeserializer` be split into smaller, more focused modules?**
  _Cohesion score 0.12010796221322537 - nodes in this community are weakly interconnected._
- **Should `MapDefinitionSerializer.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13636363636363635 - nodes in this community are weakly interconnected._
- **Should `images/FunctionIcons/FunctionIcons.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._