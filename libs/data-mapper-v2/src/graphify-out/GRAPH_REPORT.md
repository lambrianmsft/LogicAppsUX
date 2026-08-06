# Graph Report - src  (2026-08-06)

## Corpus Check
- 143 files · ~77,576 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1292 nodes · 3807 edges · 67 communities (61 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `82cc1784`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- MapDefinitionDeserializer
- MapDefinitionSerializer.ts
- images/FunctionIcons/FunctionIcons.tsx
- images/FunctionIcons/DataType16Icons.tsx
- images/FunctionIcons/DataType24Icons.tsx
- FunctionData
- core/state/PanelSlice.ts
- DataMapDataProvider.tsx
- Schema.Utils.ts
- core/state/DataMapSlice.ts
- DataMap.Utils.ts
- TrieTree
- components/common/selector/FileSelector.tsx
- isFunctionNode
- components/schema/useSchema.ts
- src/images/FunctionIcons/FunctionIcons.tsx
- DataMapperApiServiceInstance
- Edge.Utils.ts
- FunctionConstants.tsx
- components/schema/SchemaPanel.tsx
- ThemeConect.ts
- components/canvas/ReactFlow.tsx
- MapDefinitionDeserializer.ts
- Icon.Utils.tsx
- Function.ts
- CustomValue.Utils.ts
- components/common/reactflow/FunctionNode.tsx
- ReactFlow.Util.ts
- src/components/canvas/useReactflowStates.ts
- core/state/selectors/selectors.ts
- components/functionConfigurationMenu/functionConfigurationPopover.tsx
- core/state/Store.ts
- src/core/services/dataMapperApiService/index.ts
- src/core/state/DataMapSlice.ts
- src/components/functionConfigurationMenu/inputTab/inputTab.tsx
- src/images/FunctionIcons/DataType24Icons.tsx
- src/components/schema/useSchema.ts
- MapChecker.Utils.ts
- intl-test-helper.tsx
- utils/reactFlowTesting/NodeInspector.tsx
- ReactFlow.ts
- Svg.d.ts
- src/core/state/Store.ts
- TrieTree
- src/components/common/selector/FileSelector.tsx
- Connection.Utils.ts
- src/components/test/TestPanel.tsx
- src/components/canvas/ReactFlow.tsx
- Function.Utils.ts
- DataMapperDesignerProvider.tsx
- src/components/commandBar/EditorCommandBar.tsx
- src/components/schema/SchemaPanel.tsx
- IDataMapperFileService
- DataMapperDesigner.tsx
- components/commandBar/EditorCommandBar.tsx
- src/core/state/selectors/selectors.ts
- core/index.ts
- src/mapHandling/__test__/MapDefinitionDeserializer.spec.ts
- src/ui/hooks/useAutoLayout.ts
- src/core/state/AppSlice.ts
- src/core/state/SchemaSlice.ts
- MapDefinition.Utils.ts
- src/utils/reactFlowTesting/NodeInspector.tsx

## God Nodes (most connected - your core abstractions)
1. `FunctionData` - 60 edges
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
- `FunctionState` --references--> `FunctionData`  [EXTRACTED]
  core/state/FunctionSlice.ts → src/models/Function.ts
- `FunctionIconProps` --references--> `FunctionCategory`  [EXTRACTED]
  components/functionIcon/FunctionIcon.tsx → src/models/Function.ts
- `ExtendedRenderOptions` --references--> `RootState`  [EXTRACTED]
  src/__test__/redux-test-helper-dm.tsx → core/state/Store.ts
- `InitialDataMapAction` --references--> `ConnectionDictionary`  [EXTRACTED]
  core/state/DataMapSlice.ts → src/models/Connection.ts

## Import Cycles
- None detected.

## Communities (67 total, 6 thin omitted)

### Community 0 - "MapDefinitionDeserializer"
Cohesion: 0.13
Nodes (8): DataProviderInner(), getLoopTargetNode(), getLoopTargetNodeWithJson(), MapDefinitionDeserializer, DSeparators, separateFunctions(), addSourceReactFlowPrefix(), createReactFlowFunctionKey()

### Community 1 - "MapDefinitionSerializer.ts"
Cohesion: 0.15
Nodes (28): addConditionalToNewPathItems(), addLoopingForToNewPathItems(), applyValueAtPath(), createNewPathItems(), createSourcePath(), createYamlFromMap(), findKeyInMap(), generateMapDefinitionBody() (+20 more)

### Community 2 - "images/FunctionIcons/FunctionIcons.tsx"
Cohesion: 0.05
Nodes (20): AbsoluteValue32Regular, AngleIcon, CeilingValue32Regular, Count32Regular, Divide32Regular, EPowerX32Regular, FloorValue32Regular, GreaterThan32Regular (+12 more)

### Community 3 - "images/FunctionIcons/DataType16Icons.tsx"
Cohesion: 0.08
Nodes (12): Any16Filled, Any16Regular, Array16Filled, Array16Regular, Binary16Filled, Binary16Regular, Decimal16Filled, Decimal16Regular (+4 more)

### Community 4 - "images/FunctionIcons/DataType24Icons.tsx"
Cohesion: 0.08
Nodes (12): Any24Filled, Any24Regular, Array24Filled, Array24Regular, Binary24Filled, Binary24Regular, Decimal24Filled, Decimal24Regular (+4 more)

### Community 5 - "FunctionData"
Cohesion: 0.11
Nodes (31): DetailsTabContents(), FunctionConfigurationPopover(), FunctionConfigurationPopoverProps, TabTypes, InputDropdownProps, OutputTabContents(), validateAndCreateConnectionOutput(), useStyles (+23 more)

### Community 6 - "core/state/PanelSlice.ts"
Cohesion: 0.07
Nodes (28): DataMapperApiService, DataMapperApiServiceOptions, DmErrorResponse, dataMapperApiVersions, defaultDataMapperApiServiceOptions, GenerateXsltResponse, IDataMapperApiService, InitDataMapperApiService() (+20 more)

### Community 7 - "DataMapDataProvider.tsx"
Cohesion: 0.12
Nodes (11): DataMapDataProviderProps, DataMapperWrappedContext, appSlice, AppState, initialState, functionSlice, FunctionState, initialFunctionState (+3 more)

### Community 8 - "Schema.Utils.ts"
Cohesion: 0.16
Nodes (14): convertSchemaNodeToSchemaNodeExtended(), convertSchemaToSchemaExtended(), deepestNode(), findNodeForKey(), getFileNameAndPath(), maxProperties(), nodeCount(), NodeScrollDirectionType (+6 more)

### Community 9 - "core/state/DataMapSlice.ts"
Cohesion: 0.08
Nodes (34): DataMapOperationState, InitialDataMapAction, convertConnectionShorthandToId(), generateFunctionConnectionMetadata(), generateMapMetadata(), ConnectionDictionary, FunctionDictionary, ComponentState (+26 more)

### Community 10 - "DataMap.Utils.ts"
Cohesion: 0.13
Nodes (21): directAccessPseudoFunctionKey, indexed, amendSourceKeyForDirectAccessIfNeeded(), createSchemaNodeOrFunction(), getDestinationKey(), getDestinationNode(), getSingleValueMetadata(), getSourceNode() (+13 more)

### Community 11 - "TrieTree"
Cohesion: 0.15
Nodes (3): TrieTree, TrieTreeNode, AppState

### Community 12 - "components/common/selector/FileSelector.tsx"
Cohesion: 0.19
Nodes (12): useStyles, DataMapperFileService(), FileDropdownTree(), FileDropdownTreeProps, XsltFilePicker(), XsltFilePickerProps, FileSelectorProps, SchemaFileSelector() (+4 more)

### Community 13 - "isFunctionNode"
Cohesion: 0.30
Nodes (14): MapCheckerItem(), MapCheckerItemProps, useMapCheckerItemStyles, getCoordinatesForHandle(), MapCheckerItem(), MapCheckerItemProps, useMapCheckerItemStyles, iconForMapCheckerSeverity() (+6 more)

### Community 14 - "components/schema/useSchema.ts"
Cohesion: 0.25
Nodes (14): HandleResponseProps, useSchema(), useSchemaProps, SchemaTree(), SchemaTreeProps, SchemaTreeNode(), SchemaTreeNodeProps, TypeAnnotation() (+6 more)

### Community 15 - "src/images/FunctionIcons/FunctionIcons.tsx"
Cohesion: 0.05
Nodes (20): AbsoluteValue32Regular, AngleIcon, CeilingValue32Regular, Count32Regular, Divide32Regular, EPowerX32Regular, FloorValue32Regular, GreaterThan32Regular (+12 more)

### Community 16 - "DataMapperApiServiceInstance"
Cohesion: 0.26
Nodes (7): DataMapperApiServiceInstance(), SchemaFile, pseudoFunctions, generateDataMapXslt(), testDataMap(), getFunctions(), getSelectedSchema()

### Community 17 - "Edge.Utils.ts"
Cohesion: 0.19
Nodes (17): BoundingBox, convertCanvasToGridPoint(), convertGridToCanvasPoint(), findPath(), generateBoundingBoxes(), generatePathfindingGrid(), getLinearDistance(), getLineStretchLength() (+9 more)

### Community 18 - "FunctionConstants.tsx"
Cohesion: 0.11
Nodes (14): collectionBranding, conversionBranding, customBranding, dateTimeBranding, FunctionGroupBranding, logicalBranding, mathBranding, stringBranding (+6 more)

### Community 19 - "components/schema/SchemaPanel.tsx"
Cohesion: 0.23
Nodes (13): FileWithVsCodePath, SchemaFile, SchemaPanelNode(), SchemaPanelNodeReactFlowDataProps, ConfigPanelProps, schemaFileQuerySettings, SchemaPanel(), SchemaPanelBody() (+5 more)

### Community 20 - "ThemeConect.ts"
Cohesion: 0.05
Nodes (56): CanvasNode(), CanvasNodeProps, ConnectionLineComponent(), CardProps, FunctionCardProps, FunctionNode(), useStyles, FunctionIcon() (+48 more)

### Community 21 - "components/canvas/ReactFlow.tsx"
Cohesion: 0.13
Nodes (17): EdgePopOver(), EdgePopOverProps, DMReactFlowProps, edgeTypes, nodeTypes, ReactFlowWrapper(), reactFlowStyle, useStyles (+9 more)

### Community 22 - "MapDefinitionDeserializer.ts"
Cohesion: 0.13
Nodes (18): mapDefinitionVersion, mapNodeParams, reservedMapDefinitionKeysArray, reservedMapNodeParamsArray, ConditionalMetadata, LoopMetadata, getConnectionForAnyKey(), hasExpectedConnection() (+10 more)

### Community 23 - "Icon.Utils.tsx"
Cohesion: 0.09
Nodes (15): Any16Filled, Any16Regular, Array16Filled, Array16Regular, Binary16Filled, Binary16Regular, Decimal16Filled, Decimal16Regular (+7 more)

### Community 24 - "Function.ts"
Cohesion: 0.14
Nodes (30): reservedMapDefinitionKeys, addConnection(), convertToArray(), generateMapDefinitionHeader(), createSchemaToSchemaNodeConnection(), directAccessPseudoFunction, FunctionCategory, FunctionInput (+22 more)

### Community 25 - "CustomValue.Utils.ts"
Cohesion: 0.73
Nodes (3): checkIfValueNeedsQuotes(), quoteSelectedCustomValue(), quoteString()

### Community 26 - "components/common/reactflow/FunctionNode.tsx"
Cohesion: 0.31
Nodes (8): CanvasNode(), CanvasNodeProps, CardProps, FunctionCardProps, FunctionNode(), useStyles, useHoverFunctionNode(), useSelectedNode()

### Community 27 - "ReactFlow.Util.ts"
Cohesion: 0.13
Nodes (15): functionPrefix, ReactFlowEdgeType, ReactFlowNodeType, sourcePrefix, targetPrefix, ContainerLayoutNode, isIntermediateNode(), LayoutContainer (+7 more)

### Community 28 - "src/components/canvas/useReactflowStates.ts"
Cohesion: 0.40
Nodes (8): ReactFlowStatesProps, useReactFlowStates(), ReactFlowStatesProps, useReactFlowStates(), NodeIds, createEdgeId(), getFunctionNode(), convertWholeDataMapToLayoutTree()

### Community 29 - "core/state/selectors/selectors.ts"
Cohesion: 0.33
Nodes (7): useHoverNode(), ConnectedEdge(), useEdgePath(), useHoverEdge(), useHoverNode(), useSelectedEdge(), getReactFlowNodeId()

### Community 30 - "components/functionConfigurationMenu/functionConfigurationPopover.tsx"
Cohesion: 0.36
Nodes (7): DetailsTabContents(), FunctionConfigurationPopover(), FunctionConfigurationPopoverProps, TabTypes, useStyles, OutputTabContents(), isFileDropdownFunction()

### Community 31 - "core/state/Store.ts"
Cohesion: 0.32
Nodes (8): CodeViewPanel(), CodeViewPanelProps, CodeViewPanelBody(), CodeViewPanelBodyProps, useStyles, AppDispatch, includedActionsForUndo, RootState

### Community 32 - "src/core/services/dataMapperApiService/index.ts"
Cohesion: 0.10
Nodes (14): DataMapperApiService, DataMapperApiServiceOptions, DmErrorResponse, NOTE: From BPM repo, looks like two schema files with the same name will prefer…, dataMapperApiVersions, defaultDataMapperApiServiceOptions, GenerateXsltResponse, IDataMapperApiService (+6 more)

### Community 33 - "src/core/state/DataMapSlice.ts"
Cohesion: 0.09
Nodes (29): UnboundedInput, ComponentState, dataMapSlice, DataMapState, DeleteConnectionAction, deleteConnectionFromConnections(), deleteNodeFromConnections(), deleteParentRepeatingConnections() (+21 more)

### Community 34 - "src/components/functionConfigurationMenu/inputTab/inputTab.tsx"
Cohesion: 0.19
Nodes (19): InputOptionProps, InputCustomInfoLabel(), CommonProps, CustomListItem(), CustomListItemProps, InputList(), InputListProps, InputListWrapper (+11 more)

### Community 35 - "src/images/FunctionIcons/DataType24Icons.tsx"
Cohesion: 0.08
Nodes (12): Any24Filled, Any24Regular, Array24Filled, Array24Regular, Binary24Filled, Binary24Regular, Decimal24Filled, Decimal24Regular (+4 more)

### Community 36 - "src/components/schema/useSchema.ts"
Cohesion: 0.21
Nodes (17): SchemaPanelBody(), usePanelBodyStyles, SchemaTree(), SchemaTreeProps, SchemaTreeNode(), SchemaTreeNodeProps, TypeAnnotation(), SchemaTreeNodeHandle() (+9 more)

### Community 37 - "MapChecker.Utils.ts"
Cohesion: 0.07
Nodes (35): Panel(), PanelProps, PanelXButton(), PanelXButtonProps, useStyles, MapCheckerPanel(), useStyles, errorsSlice (+27 more)

### Community 44 - "src/core/state/Store.ts"
Cohesion: 0.18
Nodes (14): CodeViewPanel(), CodeViewPanelProps, CodeViewPanelBody(), CodeViewPanelBodyProps, useStyles, functionSlice, FunctionState, initialFunctionState (+6 more)

### Community 45 - "TrieTree"
Cohesion: 0.20
Nodes (3): TrieTree, TrieTreeNode, AppState

### Community 46 - "src/components/common/selector/FileSelector.tsx"
Cohesion: 0.18
Nodes (12): FileDropdownTree(), FileDropdownTreeProps, MockFileService, FileSelectorProps, SchemaFileSelector(), U, useStyles, MockFileService (+4 more)

### Community 47 - "Connection.Utils.ts"
Cohesion: 0.22
Nodes (15): InputDropdown(), useStyles, addRepeatingInputConnection(), areAllFunctionInputsFilled(), collectSourceNodeIdsForConnectionChain(), collectTargetNodeIdsForConnectionChain(), getActiveNodes(), isEmptyConnection() (+7 more)

### Community 48 - "src/components/test/TestPanel.tsx"
Cohesion: 0.21
Nodes (12): useStyles, TestPanel(), TestPanelProps, TestPanelBody(), TestPanelBodyProps, useStyles, TestPanel(), TestPanelProps (+4 more)

### Community 49 - "src/components/canvas/ReactFlow.tsx"
Cohesion: 0.18
Nodes (14): EdgePopOver(), EdgePopOverProps, DMReactFlowProps, edgeTypes, nodeTypes, NOTE: Putting this useEffect here for vis next to onSave, ReactFlowWrapper(), reactFlowStyle (+6 more)

### Community 50 - "Function.Utils.ts"
Cohesion: 0.22
Nodes (11): InputTextbox(), InputTextboxProps, InputTextbox(), InputTextboxProps, addQuotesToString(), calculateIndexValue(), functionDropDownItemText(), functionInputHasInputs() (+3 more)

### Community 51 - "DataMapperDesignerProvider.tsx"
Cohesion: 0.20
Nodes (10): reactPlugin, DataMapperDesignerContext, ScrollLocation, ScrollProps, DataMapperDesignerProvider(), DataMapperDesignerProviderProps, reactPlugin, store (+2 more)

### Community 52 - "src/components/commandBar/EditorCommandBar.tsx"
Cohesion: 0.22
Nodes (9): EditorCommandBar(), EditorCommandBarProps, useStyles, initialState, modalSlice, ModalState, NOTE: Currently, modal is just used for discard data map changes warning, WarningModalState (+1 more)

### Community 53 - "src/components/schema/SchemaPanel.tsx"
Cohesion: 0.26
Nodes (10): FileSelectorOption, ConfigPanelProps, schemaFileQuerySettings, SchemaPanel(), SchemaPanelBodyProps, usePanelStyles, useStyles, getSelectedSchema() (+2 more)

### Community 55 - "DataMapperDesigner.tsx"
Cohesion: 0.27
Nodes (8): InitDataMapperFileService(), IDataMapperFileService, InitDataMapperFileService(), DataMapperDesigner(), DataMapperDesignerProps, DialogView(), useStaticStyles, useStyles

### Community 56 - "components/commandBar/EditorCommandBar.tsx"
Cohesion: 0.24
Nodes (8): EditorCommandBar(), EditorCommandBarProps, useStyles, MetaMapDefinition, initialState, modalSlice, ModalState, WarningModalState

### Community 57 - "src/core/state/selectors/selectors.ts"
Cohesion: 0.38
Nodes (7): ConnectedEdge(), getCoordinatesForHandle(), useEdgePath(), useHoverEdge(), useSelectedEdge(), useSelectedIntermediateEdge(), flattenSchemaNode()

### Community 58 - "core/index.ts"
Cohesion: 0.44
Nodes (4): generateDataMapXslt(), testDataMap(), getFunctions(), DataMapperApiServiceInstance()

### Community 59 - "src/mapHandling/__test__/MapDefinitionDeserializer.spec.ts"
Cohesion: 0.22
Nodes (5): isEqualToCustomValue(), CustomValueConnection, ifPseudoFunctionKey, indexPseudoFunctionKey, isEqualToCustomValue()

### Community 60 - "src/ui/hooks/useAutoLayout.ts"
Cohesion: 0.32
Nodes (7): autoLayout(), Direction, elk, elkLayout(), LayoutAlgorithm, LayoutOptions, panelWidth

### Community 61 - "src/core/state/AppSlice.ts"
Cohesion: 0.50
Nodes (3): appSlice, AppState, initialState

### Community 62 - "src/core/state/SchemaSlice.ts"
Cohesion: 0.50
Nodes (3): initialSchemaState, schemaSlice, SchemaState

### Community 63 - "MapDefinition.Utils.ts"
Cohesion: 0.67
Nodes (3): fixMapDefinitionCustomValues(), loadMapDefinition(), TODO: Handle arrays better, currently fine for XML, but this will need to be…

## Knowledge Gaps
- **195 isolated node(s):** `cache`, `intl`, `EdgePopOverProps`, `DMReactFlowProps`, `nodeTypes` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FunctionData` connect `FunctionData` to `MapDefinitionDeserializer`, `DataMapDataProvider.tsx`, `Schema.Utils.ts`, `core/state/DataMapSlice.ts`, `DataMap.Utils.ts`, `DataMapperApiServiceInstance`, `ThemeConect.ts`, `MapDefinitionDeserializer.ts`, `Function.ts`, `components/common/reactflow/FunctionNode.tsx`, `ReactFlow.Util.ts`, `components/functionConfigurationMenu/functionConfigurationPopover.tsx`, `src/core/state/DataMapSlice.ts`, `src/components/functionConfigurationMenu/inputTab/inputTab.tsx`, `MapChecker.Utils.ts`, `src/core/state/Store.ts`, `Connection.Utils.ts`, `Function.Utils.ts`, `core/index.ts`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `LogCategory` connect `src/components/test/TestPanel.tsx` to `Schema.Utils.ts`, `DataMapperApiServiceInstance`, `Edge.Utils.ts`, `Function.Utils.ts`, `src/components/commandBar/EditorCommandBar.tsx`, `ThemeConect.ts`, `Icon.Utils.tsx`, `components/commandBar/EditorCommandBar.tsx`, `core/index.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `MapDefinitionDeserializer` connect `MapDefinitionDeserializer` to `MapChecker.Utils.ts`, `FunctionData`, `DataMapDataProvider.tsx`, `MapDefinitionDeserializer.ts`, `src/mapHandling/__test__/MapDefinitionDeserializer.spec.ts`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `cache`, `intl`, `EdgePopOverProps` to the rest of the system?**
  _195 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MapDefinitionDeserializer` be split into smaller, more focused modules?**
  _Cohesion score 0.1253968253968254 - nodes in this community are weakly interconnected._
- **Should `MapDefinitionSerializer.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1471264367816092 - nodes in this community are weakly interconnected._
- **Should `images/FunctionIcons/FunctionIcons.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._