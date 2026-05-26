# Graph Report - src  (2026-05-26)

## Corpus Check
- 143 files · ~77,576 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1507 nodes · 2808 edges · 173 communities (166 shown, 7 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 118 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ea53459a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 121|Community 121]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 124|Community 124]]
- [[_COMMUNITY_Community 125|Community 125]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 127|Community 127]]
- [[_COMMUNITY_Community 128|Community 128]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 131|Community 131]]
- [[_COMMUNITY_Community 132|Community 132]]
- [[_COMMUNITY_Community 133|Community 133]]
- [[_COMMUNITY_Community 134|Community 134]]
- [[_COMMUNITY_Community 135|Community 135]]
- [[_COMMUNITY_Community 136|Community 136]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 139|Community 139]]
- [[_COMMUNITY_Community 140|Community 140]]
- [[_COMMUNITY_Community 141|Community 141]]
- [[_COMMUNITY_Community 142|Community 142]]
- [[_COMMUNITY_Community 143|Community 143]]
- [[_COMMUNITY_Community 144|Community 144]]
- [[_COMMUNITY_Community 145|Community 145]]
- [[_COMMUNITY_Community 146|Community 146]]
- [[_COMMUNITY_Community 147|Community 147]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 149|Community 149]]
- [[_COMMUNITY_Community 150|Community 150]]
- [[_COMMUNITY_Community 151|Community 151]]
- [[_COMMUNITY_Community 152|Community 152]]
- [[_COMMUNITY_Community 153|Community 153]]
- [[_COMMUNITY_Community 154|Community 154]]
- [[_COMMUNITY_Community 155|Community 155]]
- [[_COMMUNITY_Community 156|Community 156]]
- [[_COMMUNITY_Community 157|Community 157]]
- [[_COMMUNITY_Community 158|Community 158]]
- [[_COMMUNITY_Community 159|Community 159]]
- [[_COMMUNITY_Community 160|Community 160]]
- [[_COMMUNITY_Community 161|Community 161]]
- [[_COMMUNITY_Community 162|Community 162]]
- [[_COMMUNITY_Community 163|Community 163]]
- [[_COMMUNITY_Community 164|Community 164]]
- [[_COMMUNITY_Community 165|Community 165]]
- [[_COMMUNITY_Community 166|Community 166]]
- [[_COMMUNITY_Community 168|Community 168]]
- [[_COMMUNITY_Community 172|Community 172]]
- [[_COMMUNITY_Community 173|Community 173]]

## God Nodes (most connected - your core abstractions)
1. `FunctionData` - 35 edges
2. `RootState` - 31 edges
3. `isSchemaNodeExtended()` - 24 edges
4. `ConnectionDictionary` - 24 edges
5. `applyConnectionValue()` - 21 edges
6. `convertSchemaToSchemaExtended()` - 18 edges
7. `isEmptyConnection()` - 18 edges
8. `isCustomValueConnection()` - 18 edges
9. `isNodeConnection()` - 17 edges
10. `AppDispatch` - 16 edges

## Surprising Connections (you probably didn't know these)
- `getInputTypeFromNode()` --calls--> `isSchemaNodeExtended()`  [INFERRED]
  components/functionConfigurationMenu/inputTab/inputTab.tsx → utils/Schema.Utils.ts
- `InputDropdownProps` --references--> `FunctionData`  [EXTRACTED]
  components/functionConfigurationMenu/inputDropdown/InputDropdown.tsx → models/Function.ts
- `FunctionIconProps` --references--> `FunctionCategory`  [EXTRACTED]
  components/functionIcon/FunctionIcon.tsx → models/Function.ts
- `SchemaPanelBody()` --calls--> `DataMapperFileService()`  [INFERRED]
  components/schema/SchemaPanelBody.tsx → core/services/dataMapperFileService/dataMapperFileService.ts
- `SchemaFileSelector()` --calls--> `DataMapperFileService()`  [INFERRED]
  components/common/selector/FileSelector.tsx → core/services/dataMapperFileService/dataMapperFileService.ts

## Communities (173 total, 7 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.10
Nodes (16): areAllFunctionInputsFilled(), collectSourceNodeIdsForConnectionChain(), collectTargetNodeIdsForConnectionChain(), createCustomInputConnection(), getActiveNodes(), getConnectedSourceSchemaNodes(), getConnectedTargetSchemaNodes(), isFunctionInputSlotAvailable() (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (28): ConnectedEdge(), EdgePopOver(), getLoopTargetNode(), getLoopTargetNodeWithJson(), MapDefinitionDeserializer, convertSchemaNodeToSchemaNodeExtended(), convertSchemaToSchemaExtended(), deepestNode() (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (15): connectionDoesExist(), isCustomValueConnection(), getDestinationKey(), getDestinationNode(), getSourceNode(), calculateIndexValue(), findFunctionForFunctionName(), findFunctionForKey() (+7 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (13): amendSourceKeyForDirectAccessIfNeeded(), collectConditionalValues(), collectFunctionValue(), collectSequenceValue(), combineFunctionAndInputs(), createSchemaNodeOrFunction(), extractScopeFromLoop(), getInputValues() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.18
Nodes (3): TrieTree, TrieTreeNode, useSearch()

### Community 5 - "Community 5"
Cohesion: 0.31
Nodes (6): isNodeConnection(), generateFunctionConnectionMetadata(), getIDForTargetConnection(), removeConnection(), updateConnection(), validateAndCreateConnection()

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (6): generateDataMapXslt(), testDataMap(), DataMapperApiService, getFunctions(), DataMapperApiServiceInstance(), getSelectedSchema()

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (18): addRepeatingInputConnection(), applyConnectionValue(), createConnectionEntryIfNeeded(), createNewEmptyConnection(), createNodeConnection(), generateInputHandleId(), isEmptyConnection(), getParentId() (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (12): addConditionalToNewPathItems(), addLoopingForToNewPathItems(), convertToArray(), convertToMapDefinition(), createYamlFromMap(), findKeyInMap(), generateMapDefinitionBody(), generateMapDefinitionHeader() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (12): findLast(), nodeHasSpecificInputEventually(), addParentConnectionForRepeatingElementsNested(), isParentTargetNode(), getPathForSrcSchemaNode(), addSourceReactFlowPrefix(), addTargetReactFlowPrefix(), getTreeNodeId() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.23
Nodes (12): convertCanvasToGridPoint(), findPath(), generateBoundingBoxes(), generatePathfindingGrid(), getLinearDistance(), getLineStretchLength(), getNextPointFromPosition(), getQuadraticCurve() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.01
Nodes (144): actualForLoopObject, actualForLoopObjectKeys, addFunctionId, categorizedCatalogChildren, categorizedCatalogObject, complexArray1Object, complexArrayObject, concatFunctionId (+136 more)

### Community 14 - "Community 14"
Cohesion: 0.28
Nodes (5): addQuotesToString(), updateCustomInputConnection(), updateInput(), validateAndCreateConnection(), onCustomTextBoxChange()

### Community 15 - "Community 15"
Cohesion: 0.25
Nodes (4): FunctionIcon(), iconForFunctionCategory(), iconForNormalizedDataType(), TypeAnnotation()

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (4): DataMapperDesigner(), DataMapperFileService(), InitDataMapperFileService(), XsltFilePicker()

### Community 18 - "Community 18"
Cohesion: 0.40
Nodes (3): createFileDropdownTree(), MockFileService, render()

### Community 121 - "Community 121"
Cohesion: 0.13
Nodes (13): useStyles, PanelXButton(), PanelXButtonProps, nodeHasSourceNodeEventually(), IntlMessage, collectWarningsForMapChecker(), convertMapIssuesToMessages(), DeserializationError (+5 more)

### Community 122 - "Community 122"
Cohesion: 0.06
Nodes (22): AbsoluteValue32Regular, AngleIcon, CeilingValue32Regular, Count32Regular, Divide32Regular, EPowerX32Regular, FloorValue32Regular, GreaterThan32Regular (+14 more)

### Community 123 - "Community 123"
Cohesion: 0.21
Nodes (12): EdgePopOver(), EdgePopOverProps, DMReactFlowProps, edgeTypes, nodeTypes, ReactFlowWrapper(), reactFlowStyle, useStyles (+4 more)

### Community 124 - "Community 124"
Cohesion: 0.21
Nodes (11): collectionBranding, conversionBranding, customBranding, dateTimeBranding, FunctionGroupBranding, logicalBranding, mathBranding, stringBranding (+3 more)

### Community 125 - "Community 125"
Cohesion: 0.05
Nodes (39): mapNodeParams, reservedMapDefinitionKeys, reservedMapDefinitionKeysArray, reservedMapNodeParamsArray, absoluteKey, amendedSourceKey, backoutRegex, childKey (+31 more)

### Community 126 - "Community 126"
Cohesion: 0.06
Nodes (33): ifPseudoFunction, indexPseudoFunction, atypicallyMockFunctionNode, connections, dummyNode, extendedComprehensiveSourceSchema, extendedComprehensiveTargetSchema, extendedSourceSchema (+25 more)

### Community 127 - "Community 127"
Cohesion: 0.05
Nodes (48): DataMapperFileService(), FunctionConfigurationPopover(), FunctionConfigurationPopoverProps, TabTypes, useStyles, InputDropdown(), InputDropdownProps, InputOptionProps (+40 more)

### Community 128 - "Community 128"
Cohesion: 0.15
Nodes (12): deleteNodeFromConnections(), connectionDict, connections, connections1, destinationId, extendedSchema, functionData, functionDict (+4 more)

### Community 129 - "Community 129"
Cohesion: 0.14
Nodes (19): addConditionalToNewPathItems(), convertToArray(), convertToMapDefinition(), createNewPathItems(), createYamlFromMap(), findKeyInMap(), generateMapDefinitionBody(), generateMapDefinitionHeader() (+11 more)

### Community 130 - "Community 130"
Cohesion: 0.08
Nodes (20): a, aName, children, customerTarget, extendedAdjSchema, extendedComprehensiveSourceSchema, extendedComprehensiveTargetSchema, extendedLoopSource (+12 more)

### Community 131 - "Community 131"
Cohesion: 0.11
Nodes (20): directAccessPseudoFunction, amendSourceKeyForDirectAccessIfNeeded(), createSchemaNodeOrFunction(), DReservedToken, DSeparators, FunctionCreationMetadata, getDestinationNode(), getSingleValueMetadata() (+12 more)

### Community 132 - "Community 132"
Cohesion: 0.06
Nodes (48): useStyles, FileDropdownTree(), FileDropdownTreeProps, InputListWrapper, FileWithVsCodePath, SchemaFile, SchemaPanelNodeReactFlowDataProps, ConfigPanelProps (+40 more)

### Community 133 - "Community 133"
Cohesion: 0.14
Nodes (15): InputConnection, SetConnectionInputAction, addRepeatingInputConnection(), areAllFunctionInputsFilled(), collectSourceNodeIdsForConnectionChain(), collectTargetNodeIdsForConnectionChain(), getActiveNodes(), inputFromHandleId() (+7 more)

### Community 134 - "Community 134"
Cohesion: 0.10
Nodes (21): ComponentState, dataMapSlice, DataMapState, DeleteConnectionAction, deleteConnectionFromConnections(), deleteParentRepeatingConnections(), Draft2, emptyPristineState (+13 more)

### Community 135 - "Community 135"
Cohesion: 0.08
Nodes (12): Any16Filled, Any16Regular, Array16Filled, Array16Regular, Binary16Filled, Binary16Regular, Decimal16Filled, Decimal16Regular (+4 more)

### Community 136 - "Community 136"
Cohesion: 0.08
Nodes (12): Any24Filled, Any24Regular, Array24Filled, Array24Regular, Binary24Filled, Binary24Regular, Decimal24Filled, Decimal24Regular (+4 more)

### Community 137 - "Community 137"
Cohesion: 0.15
Nodes (3): TrieTree, TrieTreeNode, AppState

### Community 138 - "Community 138"
Cohesion: 0.20
Nodes (8): FunctionCategoryColorToken, customDarkTokens, customTokens, DataMapperTheme, extendedWebDarkTheme, extendedWebLightTheme, fnColors, spacingOverrides

### Community 139 - "Community 139"
Cohesion: 0.15
Nodes (21): getCoordinatesForHandle(), useEdgePath(), MapCheckerItem(), MapCheckerItemProps, useMapCheckerItemStyles, SchemaTreeDataProps, generateInputHandleId(), iconForMapCheckerSeverity() (+13 more)

### Community 140 - "Community 140"
Cohesion: 0.07
Nodes (34): DataProviderInner(), functionMock, extendedSchema, connectionDictionary, extendedSource, extendedTarget, getConnectionForAnyKey(), hasExpectedConnection() (+26 more)

### Community 141 - "Community 141"
Cohesion: 0.29
Nodes (8): CanvasNode(), CanvasNodeProps, CardProps, FunctionNode(), useStyles, useHoverFunctionNode(), useSelectedNode(), isEmptyConnection()

### Community 142 - "Community 142"
Cohesion: 0.11
Nodes (17): DataMapperApiService, DataMapperApiServiceOptions, DmErrorResponse, filename, formattedFilePath, dataMapperApiVersions, defaultDataMapperApiServiceOptions, GenerateXsltResponse (+9 more)

### Community 143 - "Community 143"
Cohesion: 0.16
Nodes (16): BoundingBox, convertCanvasToGridPoint(), findPath(), generateBoundingBoxes(), generatePathfindingGrid(), getLinearDistance(), getLineStretchLength(), getNextPointFromPosition() (+8 more)

### Community 144 - "Community 144"
Cohesion: 0.36
Nodes (6): useStyles, TestPanelProps, TestPanelBody(), TestPanelBodyProps, LogCategory, LogMessage

### Community 145 - "Community 145"
Cohesion: 0.26
Nodes (11): FunctionDataTreeItem, FunctionListProps, fuseFunctionSearchOptions, loopFuseFunctionSearchOptions, FunctionListHeader(), FunctionListHeaderProps, DropResult, FunctionListItem() (+3 more)

### Community 146 - "Community 146"
Cohesion: 0.21
Nodes (11): DataMapperWrappedContext, ScrollLocation, ScrollProps, IDataMapperFileService, InitDataMapperFileService(), SchemaFile, TestPanel(), DataMapperDesigner() (+3 more)

### Community 147 - "Community 147"
Cohesion: 0.33
Nodes (5): EditorCommandBar(), EditorCommandBarProps, useStyles, MetaMapDefinition, collectErrorsForMapChecker()

### Community 148 - "Community 148"
Cohesion: 0.13
Nodes (14): connections, extendedSource, extendedTarget, flattenedSource, flattenedTarget, indexed, mockFunctionData, mockSchemaNodeExtended (+6 more)

### Community 149 - "Community 149"
Cohesion: 0.16
Nodes (13): MapCheckerPanel(), CodeViewState, ConfigPanelView, FunctionPanelState, initialState, MapCheckPanelState, MapCheckTabType, panelSlice (+5 more)

### Community 150 - "Community 150"
Cohesion: 0.26
Nodes (12): addConnection(), setUpBackoutLoopTest(), createSchemaToSchemaNodeConnection(), isEqualToCustomValue(), mockFunctionData, mockSchemaNodeExtended, applyConnectionValue(), createConnectionEntryIfNeeded() (+4 more)

### Community 151 - "Community 151"
Cohesion: 0.16
Nodes (12): FailedMapDefinition, Connection, CustomValueConnection, EmptyConnection, NodeConnection, conn, errors, functionConn (+4 more)

### Community 152 - "Community 152"
Cohesion: 0.21
Nodes (7): FunctionIcon(), FunctionIconProps, CollectionRegular, StringCategory20Regular, result, iconForFunction(), iconForFunctionCategory()

### Community 153 - "Community 153"
Cohesion: 0.20
Nodes (16): addLoopingForToNewPathItems(), createSourcePath(), collectTargetNodesForConnectionChain(), collectConditionalValues(), collectFunctionValue(), collectSequenceValue(), combineFunctionAndInputs(), extractScopeFromLoop() (+8 more)

### Community 154 - "Community 154"
Cohesion: 0.40
Nodes (4): InputTextbox(), InputTextboxProps, FunctionInput, addQuotesToString()

### Community 155 - "Community 155"
Cohesion: 0.21
Nodes (8): FunctionList(), FunctionPanel(), PanelProps, useStyles, FunctionsSVG(), Panel(), PanelProps, useStyles

### Community 156 - "Community 156"
Cohesion: 0.29
Nodes (7): checkIfValueNeedsQuotes(), quoteSelectedCustomValue(), quoteString(), changeValue(), onChange(), onOptionSelect(), selectCustomValueOnClose()

### Community 157 - "Community 157"
Cohesion: 0.15
Nodes (12): extendedSourceSchema, indexValue, indexValueA, indexValueB, inputArgs, mockConnections, modifiedQuotesString, noQuotesString (+4 more)

### Community 158 - "Community 158"
Cohesion: 0.39
Nodes (5): CodeViewPanel(), CodeViewPanelProps, CodeViewPanelBody(), CodeViewPanelBodyProps, useStyles

### Community 159 - "Community 159"
Cohesion: 0.26
Nodes (9): convertConnectionShorthandToId(), generateFunctionConnectionMetadata(), generateMapMetadata(), ConnectionDictionary, FunctionDictionary, DataMapOperationState, InitialDataMapAction, isNodeConnection() (+1 more)

### Community 160 - "Community 160"
Cohesion: 0.36
Nodes (6): reactPlugin, DataMapperDesignerContext, DataMapperDesignerProvider(), DataMapperDesignerProviderProps, getCustomizedTheme(), store

### Community 161 - "Community 161"
Cohesion: 0.43
Nodes (5): ConnectedEdge(), useHoverEdge(), useHoverNode(), useSelectedEdge(), getReactFlowNodeId()

### Community 162 - "Community 162"
Cohesion: 0.35
Nodes (6): DataMapperApiServiceInstance(), pseudoFunctions, generateDataMapXslt(), testDataMap(), getFunctions(), getSelectedSchema()

### Community 163 - "Community 163"
Cohesion: 0.29
Nodes (5): autoLayout(), Direction, elk, LayoutAlgorithm, LayoutOptions

### Community 164 - "Community 164"
Cohesion: 0.40
Nodes (5): nodeHasSpecificInputEventually(), addParentConnectionForRepeatingElementsNested(), isParentTargetNode(), addSourceReactFlowPrefix(), addTargetReactFlowPrefix()

### Community 165 - "Community 165"
Cohesion: 0.17
Nodes (12): DataMapDataProviderProps, FunctionListItemProps, MapDefinitionDeserializer, FunctionData, FunctionCardProps, errorsSlice, ErrorsState, initialFunctionState (+4 more)

### Community 168 - "Community 168"
Cohesion: 0.31
Nodes (7): ReactFlowStatesProps, useReactFlowStates(), NodeIds, ReactFlowEdgeType, ReactFlowNodeType, getFunctionNode(), convertWholeDataMapToLayoutTree()

## Knowledge Gaps
- **405 isolated node(s):** `ConditionalMetadata`, `connections`, `parsedYamlKeys`, `formattedTargetKey`, `error` (+400 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FunctionData` connect `Community 165` to `Community 128`, `Community 162`, `Community 131`, `Community 133`, `Community 134`, `Community 11`, `Community 140`, `Community 141`, `Community 145`, `Community 148`, `Community 125`, `Community 150`, `Community 151`, `Community 121`, `Community 124`, `Community 157`, `Community 126`, `Community 127`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `RootState` connect `Community 127` to `Community 161`, `Community 132`, `Community 168`, `Community 139`, `Community 155`, `Community 141`, `Community 144`, `Community 145`, `Community 146`, `Community 147`, `Community 121`, `Community 123`, `Community 158`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `ConnectionDictionary` connect `Community 159` to `Community 128`, `Community 129`, `Community 130`, `Community 131`, `Community 133`, `Community 134`, `Community 11`, `Community 140`, `Community 139`, `Community 148`, `Community 150`, `Community 157`, `Community 151`, `Community 121`, `Community 124`, `Community 125`, `Community 126`, `Community 127`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `ConditionalMetadata`, `connections`, `parsedYamlKeys` to the rest of the system?**
  _405 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.10333333333333333 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0595959595959596 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.1076923076923077 - nodes in this community are weakly interconnected._