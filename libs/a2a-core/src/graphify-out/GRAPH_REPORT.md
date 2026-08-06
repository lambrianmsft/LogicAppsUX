# Graph Report - src  (2026-08-06)

## Corpus Check
- 140 files · ~79,496 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 793 nodes · 2092 edges · 48 communities (40 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `82cc1784`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- history-types.ts
- schemas.ts
- a2a-client.ts
- registry.ts
- plugins/index.ts
- SessionManager
- react/components/Message/Message.tsx
- ChatInterface
- SSEClient
- A2A Chat React Components
- DataTransferPolyfill
- MockSSEClient
- react/components/FileUpload/FileUpload.tsx
- src/react/components/Message/Message.tsx
- useChatStore
- src/react/components/ChatWidget/ChatWidget.tsx
- mock-agent-card.ts
- src/react/types/index.ts
- src/react/components/ChatWindow/ChatWindow.tsx
- react/index.ts
- agent-discovery.ts
- src/react/components/MessageList/MessageList.tsx
- AgentCard
- react/types/index.ts
- react/components/ChatWidget/ChatWidget.tsx
- useChatStore
- DataTransferPolyfill
- MockSSEClient
- AuthRequiredPart
- MockSSEClient
- MockSSEClient
- src/react/components/FileUpload/FileUpload.tsx

## God Nodes (most connected - your core abstractions)
1. `AgentCard` - 43 edges
2. `A2AClient` - 31 edges
3. `SessionManager` - 29 edges
4. `ChatSession` - 26 edges
5. `AuthConfig` - 26 edges
6. `HttpClient` - 25 edges
7. `ChatInterface` - 23 edges
8. `SSEClient` - 21 edges
9. `Message` - 20 edges
10. `Message` - 20 edges

## Surprising Connections (you probably didn't know these)
- `ChatState` --references--> `A2AClient`  [EXTRACTED]
  react/store/chatStore.ts → src/client/a2a-client.ts
- `AgentConfig` --references--> `AuthConfig`  [EXTRACTED]
  react/types/index.ts → src/client/types.ts
- `ChatWidgetProps` --references--> `AuthConfig`  [EXTRACTED]
  react/types/index.ts → src/client/types.ts
- `AuthPartState` --inherits--> `AuthRequiredPart`  [EXTRACTED]
  react/components/Message/AuthenticationMessage.tsx → src/client/types.ts
- `Message` --references--> `AuthRequiredPart`  [EXTRACTED]
  react/types/index.ts → src/client/types.ts

## Import Cycles
- None detected.

## Communities (48 total, 8 thin omitted)

### Community 0 - "history-types.ts"
Cohesion: 0.06
Nodes (47): createHistoryApi(), HistoryApi, HistoryApiClient, HistoryApiConfig, JsonRpcRequest, IMPORTANT: The method name is "context/update" (singular), not "contexts/update", extractAuthEventFromMessage(), extractLastMessage() (+39 more)

### Community 1 - "schemas.ts"
Cohesion: 0.06
Nodes (52): formatErrorMessage(), getUserFriendlyErrorMessage(), A2AError, AuthenticationError, createJsonRpcError(), extractErrorDetails(), isJsonRpcErrorResponse(), JsonRpcErrorCode (+44 more)

### Community 2 - "a2a-client.ts"
Cohesion: 0.11
Nodes (27): A2AClientConfig, WaitForCompletionOptions, HttpClient, AuthConfig, AuthRequiredEvent, AuthRequiredHandler, HttpClientOptions, RequestConfig (+19 more)

### Community 3 - "registry.ts"
Cohesion: 0.21
Nodes (4): AgentRegistry, AgentSummary, EnterpriseAgentRegistry, PublicAgentRegistry

### Community 4 - "plugins/index.ts"
Cohesion: 0.08
Nodes (19): AnalyticsConfig, AnalyticsEvent, AnalyticsPlugin, LoggerConfig, LoggerPlugin, LogLevel, AnalyticsConfig, AnalyticsEvent (+11 more)

### Community 5 - "SessionManager"
Cohesion: 0.10
Nodes (10): LocalStoragePlugin, SessionManager, mockLocalStorage, mockSessionStorage, SessionChangeEvent, SessionData, SessionEventMap, SessionOptions (+2 more)

### Community 6 - "react/components/Message/Message.tsx"
Cohesion: 0.10
Nodes (18): CodeBlockHeader(), CodeBlockHeaderProps, useStyles, escapeAttr(), formatTime(), link(), Message, MessageComponent() (+10 more)

### Community 7 - "ChatInterface"
Cohesion: 0.18
Nodes (9): ChatInterface, ChatInterfaceConfig, ChatEventMap, ChatMessage, ChatOptions, ChatRole, ConversationExport, StreamUpdate (+1 more)

### Community 8 - "SSEClient"
Cohesion: 0.18
Nodes (7): SSEClient, MockEventSource, ErrorHandler, MessageHandler, SSEClientOptions, SSEMessage, SSEParser

### Community 9 - "A2A Chat React Components"
Cohesion: 0.17
Nodes (11): A2A Chat React Components, Components, Features, Hooks, Important: CSS Import Required, Main Component, State Management, TypeScript Support (+3 more)

### Community 21 - "src/react/components/Message/Message.tsx"
Cohesion: 0.12
Nodes (17): CodeBlockHeader(), CodeBlockHeaderProps, useStyles, escapeAttr(), formatFileSize(), formatTime(), link(), Message (+9 more)

### Community 22 - "useChatStore"
Cohesion: 0.18
Nodes (15): MessageInput(), MessageInputProps, useStyles, StatusMessage(), StatusMessageProps, useStyles, useChatStore, Attachment (+7 more)

### Community 23 - "src/react/components/ChatWidget/ChatWidget.tsx"
Cohesion: 0.24
Nodes (11): ChatWidget(), useStyles, ChatThemeProvider(), ChatThemeProviderProps, adjustBrightness(), createCustomTheme(), defaultBrandColors, defaultDarkTheme (+3 more)

### Community 24 - "mock-agent-card.ts"
Cohesion: 0.25
Nodes (6): mockAgentCard, mockAgentCard, mockAgentCard, getMockAgentCard(), mockAgentCard, Task

### Community 25 - "src/react/types/index.ts"
Cohesion: 0.23
Nodes (10): CompanyLogo(), CompanyLogoProps, AgentConfig, AttachmentStatus, Branding, ChatConfig, ChatTheme, FileAttachment (+2 more)

### Community 26 - "src/react/components/ChatWindow/ChatWindow.tsx"
Cohesion: 0.24
Nodes (9): ChatWindow(), ChatWindowProps, useStyles, mockUseChatWidget, applyTheme(), DEFAULT_THEME, mergeTheme(), useTheme() (+1 more)

### Community 27 - "react/index.ts"
Cohesion: 0.27
Nodes (11): ChatMessage, ServerHistoryStorageConfig, adjustBrightness(), createCustomTheme(), defaultBrandColors, defaultDarkTheme, defaultLightTheme, generateBrandVariants() (+3 more)

### Community 28 - "agent-discovery.ts"
Cohesion: 0.27
Nodes (4): AgentDiscovery, AgentDiscoveryOptions, CacheEntry, AgentCardSchema

### Community 29 - "src/react/components/MessageList/MessageList.tsx"
Cohesion: 0.26
Nodes (5): MessageList(), MessageListProps, useStyles, TypingIndicator(), TypingIndicatorProps

### Community 30 - "AgentCard"
Cohesion: 0.25
Nodes (4): A2AClient, UseA2AReturn, AgentCapabilities, AgentCard

### Community 31 - "react/types/index.ts"
Cohesion: 0.22
Nodes (9): IdentityProvider, AgentConfig, AttachmentStatus, Branding, ChatConfig, ChatWidgetProps, FileAttachment, MessageRole (+1 more)

### Community 33 - "useChatStore"
Cohesion: 0.06
Nodes (35): ChatWindow(), ChatWindowProps, useStyles, CompanyLogo(), CompanyLogoProps, AuthStateExample(), CustomChatImplementation(), ManualAuthUIExample() (+27 more)

### Community 36 - "AuthRequiredPart"
Cohesion: 0.15
Nodes (19): AuthRequiredPart, ExampleWithHooks(), manualAuthFlow(), AuthenticationMessage(), AuthenticationMessageProps, AuthPartState, useStyles, AuthenticationMessage() (+11 more)

### Community 39 - "src/react/components/FileUpload/FileUpload.tsx"
Cohesion: 0.53
Nodes (3): FileUpload(), FileUploadProps, formatFileSize()

## Knowledge Gaps
- **59 isolated node(s):** `JsonRpcRequest`, `mockAgentCard`, `mockAgentCard`, `mockAgentCard`, `mockUseChatWidget` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Message` connect `react/components/Message/Message.tsx` to `history-types.ts`, `useChatStore`, `a2a-client.ts`, `plugins/index.ts`, `AuthRequiredPart`, `ChatInterface`, `mock-agent-card.ts`, `react/index.ts`, `react/types/index.ts`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `AgentCard` connect `AgentCard` to `schemas.ts`, `a2a-client.ts`, `registry.ts`, `ChatInterface`, `mock-agent-card.ts`, `src/react/types/index.ts`, `src/react/components/ChatWindow/ChatWindow.tsx`, `agent-discovery.ts`, `react/types/index.ts`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `A2AClient` connect `AgentCard` to `history-types.ts`, `a2a-client.ts`, `AuthRequiredPart`, `plugins/index.ts`, `ChatInterface`, `mock-agent-card.ts`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **What connects `JsonRpcRequest`, `mockAgentCard`, `mockAgentCard` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `history-types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05767790262172284 - nodes in this community are weakly interconnected._
- **Should `schemas.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06126126126126126 - nodes in this community are weakly interconnected._
- **Should `a2a-client.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10765027322404372 - nodes in this community are weakly interconnected._