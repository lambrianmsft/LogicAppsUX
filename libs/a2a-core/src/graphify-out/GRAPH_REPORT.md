# Graph Report - src  (2026-07-21)

## Corpus Check
- 140 files · ~79,496 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 793 nodes · 2090 edges · 48 communities (40 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db11eba8`
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
- src/react/types/index.ts
- react/components/ChatWidget/ChatWidget.tsx
- mock-agent-card.ts
- src/react/components/ChatWindow/ChatWindow.tsx
- react/index.ts
- agent-discovery.ts
- AgentCard
- src/react/components/ChatWidget/ChatWidget.tsx
- DataTransferPolyfill
- MockSSEClient
- useChatStore
- MockSSEClient
- src/react/components/SessionList/SessionList.tsx
- AuthRequiredPart
- MockSSEClient
- ChatTheme
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
Cohesion: 0.10
Nodes (38): createHistoryApi(), HistoryApi, HistoryApiClient, HistoryApiConfig, JsonRpcRequest, IMPORTANT: The method name is "context/update" (singular), not "contexts/update", extractAuthEventFromMessage(), extractLastMessage() (+30 more)

### Community 1 - "schemas.ts"
Cohesion: 0.06
Nodes (53): mockStreamReturnValue, formatErrorMessage(), getUserFriendlyErrorMessage(), A2AError, AuthenticationError, createJsonRpcError(), extractErrorDetails(), isJsonRpcErrorResponse() (+45 more)

### Community 2 - "a2a-client.ts"
Cohesion: 0.06
Nodes (35): ChatSession, Message, A2AClientConfig, WaitForCompletionOptions, HttpClient, AuthConfig, AuthRequiredEvent, AuthRequiredHandler (+27 more)

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
Cohesion: 0.12
Nodes (17): CodeBlockHeader(), CodeBlockHeaderProps, useStyles, escapeAttr(), formatTime(), link(), Message, MessageComponent() (+9 more)

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
Cohesion: 0.10
Nodes (20): CodeBlockHeader(), CodeBlockHeaderProps, useStyles, escapeAttr(), formatFileSize(), formatTime(), link(), Message (+12 more)

### Community 22 - "useChatStore"
Cohesion: 0.18
Nodes (15): MessageInput(), MessageInputProps, useStyles, StatusMessage(), StatusMessageProps, useStyles, useChatStore, Attachment (+7 more)

### Community 23 - "src/react/types/index.ts"
Cohesion: 0.15
Nodes (16): IdentityProvider, AgentConfig, AttachmentStatus, Branding, ChatConfig, FileAttachment, MessageRole, MessageStatus (+8 more)

### Community 24 - "react/components/ChatWidget/ChatWidget.tsx"
Cohesion: 0.22
Nodes (11): ChatWidget(), useStyles, adjustBrightness(), createCustomTheme(), defaultBrandColors, defaultDarkTheme, defaultLightTheme, generateBrandVariants() (+3 more)

### Community 25 - "mock-agent-card.ts"
Cohesion: 0.25
Nodes (6): mockAgentCard, mockAgentCard, mockAgentCard, getMockAgentCard(), mockAgentCard, Task

### Community 26 - "src/react/components/ChatWindow/ChatWindow.tsx"
Cohesion: 0.24
Nodes (9): ChatWindow(), ChatWindowProps, useStyles, mockUseChatWidget, applyTheme(), DEFAULT_THEME, mergeTheme(), useTheme() (+1 more)

### Community 27 - "react/index.ts"
Cohesion: 0.29
Nodes (11): ChatThemeProvider(), ChatThemeProviderProps, adjustBrightness(), createCustomTheme(), defaultBrandColors, defaultDarkTheme, defaultLightTheme, generateBrandVariants() (+3 more)

### Community 28 - "agent-discovery.ts"
Cohesion: 0.27
Nodes (4): AgentDiscovery, AgentDiscoveryOptions, CacheEntry, AgentCardSchema

### Community 29 - "AgentCard"
Cohesion: 0.25
Nodes (4): A2AClient, UseA2AReturn, AgentCapabilities, AgentCard

### Community 33 - "useChatStore"
Cohesion: 0.06
Nodes (35): ChatWindow(), ChatWindowProps, useStyles, CompanyLogo(), CompanyLogoProps, AuthStateExample(), CustomChatImplementation(), ManualAuthUIExample() (+27 more)

### Community 35 - "src/react/components/SessionList/SessionList.tsx"
Cohesion: 0.48
Nodes (3): SessionList(), SessionListProps, useStyles

### Community 36 - "AuthRequiredPart"
Cohesion: 0.15
Nodes (19): AuthRequiredPart, ExampleWithHooks(), manualAuthFlow(), AuthenticationMessage(), AuthenticationMessageProps, AuthPartState, useStyles, AuthenticationMessage() (+11 more)

### Community 38 - "ChatTheme"
Cohesion: 0.60
Nodes (3): CompanyLogo(), CompanyLogoProps, ChatTheme

### Community 39 - "src/react/components/FileUpload/FileUpload.tsx"
Cohesion: 0.53
Nodes (3): FileUpload(), FileUploadProps, formatFileSize()

## Knowledge Gaps
- **59 isolated node(s):** `JsonRpcRequest`, `mockAgentCard`, `mockAgentCard`, `mockAgentCard`, `mockUseChatWidget` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Message` connect `react/components/Message/Message.tsx` to `useChatStore`, `a2a-client.ts`, `plugins/index.ts`, `AuthRequiredPart`, `ChatInterface`, `src/react/types/index.ts`, `mock-agent-card.ts`, `react/index.ts`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `AgentCard` connect `AgentCard` to `schemas.ts`, `a2a-client.ts`, `registry.ts`, `ChatInterface`, `src/react/types/index.ts`, `mock-agent-card.ts`, `src/react/components/ChatWindow/ChatWindow.tsx`, `agent-discovery.ts`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `A2AClient` connect `AgentCard` to `a2a-client.ts`, `AuthRequiredPart`, `plugins/index.ts`, `ChatInterface`, `mock-agent-card.ts`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **What connects `JsonRpcRequest`, `mockAgentCard`, `mockAgentCard` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `history-types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09545454545454546 - nodes in this community are weakly interconnected._
- **Should `schemas.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05760905760905761 - nodes in this community are weakly interconnected._
- **Should `a2a-client.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06498363721365123 - nodes in this community are weakly interconnected._