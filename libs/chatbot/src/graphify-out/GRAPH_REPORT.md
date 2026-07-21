# Graph Report - src  (2026-07-21)

## Corpus Check
- 17 files · ~6,787 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 93 nodes · 130 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db11eba8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lib/ui/CopilotChatbot.tsx
- src/lib/ui/__test__/CopilotChatbot.spec.tsx
- lib/common/models/workflow.ts
- lib/ui/ChatbotUi.tsx
- src/lib/ui/CopilotChatbot.tsx
- Svg.d.ts
- src/lib/ui/ChatbotUi.tsx
- src/lib/common/models/workflow.ts

## God Nodes (most connected - your core abstractions)
1. `useChatbotStyles` - 5 edges
2. `useChatbotStyles` - 5 edges
3. `mockUseIntl()` - 4 edges
4. `CopilotPanelHeader()` - 4 edges
5. `mockUseIntl()` - 4 edges
6. `CopilotPanelHeader()` - 4 edges
7. `isSuccessResponse()` - 3 edges
8. `ChatbotUI()` - 3 edges
9. `AssistantChat()` - 3 edges
10. `CoPilotChatbot()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `CoPilotChatbot()` --calls--> `isSuccessResponse()`  [EXTRACTED]
  src/lib/ui/CopilotChatbot.tsx → src/lib/core/util/index.ts
- `ChatbotUI()` --calls--> `useChatbotStyles`  [EXTRACTED]
  src/lib/ui/ChatbotUi.tsx → src/lib/ui/styles.ts
- `CopilotPanelHeader()` --calls--> `useChatbotStyles`  [EXTRACTED]
  src/lib/ui/panelheader.tsx → src/lib/ui/styles.ts
- `ChatbotUI()` --calls--> `useChatbotStyles`  [EXTRACTED]
  lib/ui/ChatbotUi.tsx → lib/ui/styles.ts
- `CopilotPanelHeader()` --calls--> `useChatbotStyles`  [EXTRACTED]
  lib/ui/panelheader.tsx → lib/ui/styles.ts

## Import Cycles
- None detected.

## Communities (10 total, 1 thin omitted)

### Community 0 - "lib/ui/CopilotChatbot.tsx"
Cohesion: 0.15
Nodes (10): RequestData, ResponseData, capturedAssistantChatProps, defaultProps, mockGetCopilotResponse, mockGetWorkflowEdit, mockWorkflow, CoPilotChatbot() (+2 more)

### Community 1 - "src/lib/ui/__test__/CopilotChatbot.spec.tsx"
Cohesion: 0.16
Nodes (8): cache, intl, mockUseIntl(), capturedAssistantChatProps, defaultProps, mockGetCopilotResponse, mockGetWorkflowEdit, mockWorkflow

### Community 2 - "lib/common/models/workflow.ts"
Cohesion: 0.25
Nodes (7): ApiHubAuthentication, ConnectionReference, ConnectionReferences, Impersonation, ImpersonationSource, ReferenceKey, WorkflowParameter

### Community 3 - "lib/ui/ChatbotUi.tsx"
Cohesion: 0.16
Nodes (9): cache, intl, mockUseIntl(), AssistantChat(), ChatbotUI(), ChatbotUIProps, CopilotPanelHeader(), useChatbotDarkStyles (+1 more)

### Community 4 - "src/lib/ui/CopilotChatbot.tsx"
Cohesion: 0.23
Nodes (5): RequestData, ResponseData, isSuccessResponse(), CoPilotChatbot(), CoPilotChatbotProps

### Community 7 - "src/lib/ui/ChatbotUi.tsx"
Cohesion: 0.26
Nodes (6): AssistantChat(), ChatbotUI(), ChatbotUIProps, CopilotPanelHeader(), useChatbotDarkStyles, useChatbotStyles

### Community 8 - "src/lib/common/models/workflow.ts"
Cohesion: 0.25
Nodes (7): ApiHubAuthentication, ConnectionReference, ConnectionReferences, Impersonation, ImpersonationSource, ReferenceKey, WorkflowParameter

## Knowledge Gaps
- **37 isolated node(s):** `cache`, `intl`, `ResponseData`, `ConnectionReference`, `ApiHubAuthentication` (+32 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CopilotPanelHeader()` connect `lib/ui/ChatbotUi.tsx` to `lib/ui/CopilotChatbot.tsx`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `CopilotPanelHeader()` connect `src/lib/ui/ChatbotUi.tsx` to `src/lib/ui/__test__/CopilotChatbot.spec.tsx`, `src/lib/ui/CopilotChatbot.tsx`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `mockUseIntl()` connect `src/lib/ui/__test__/CopilotChatbot.spec.tsx` to `src/lib/ui/ChatbotUi.tsx`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `cache`, `intl`, `ResponseData` to the rest of the system?**
  _37 weakly-connected nodes found - possible documentation gaps or missing edges._