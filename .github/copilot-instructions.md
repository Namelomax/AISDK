# AI Agent Guide (AISDK)

## Big picture
- Next.js App Router chat app with streaming AI responses and a right-side document panel. Main UI is in [app/page.tsx](app/page.tsx).
- API boundary lives under [app/api](app/api). Chat traffic goes through [app/api/chat/route.ts](app/api/chat/route.ts) which builds system prompts, parses attachments, and streams responses.
- Agent pipeline: `classifyIntent()` -> `decideNextAction()` -> `runChatAgent()` or `runDocumentAgent()` (see [app/api/chat/agents/classifier.ts](app/api/chat/agents/classifier.ts), [app/api/chat/agents/orchestrator.ts](app/api/chat/agents/orchestrator.ts), [app/api/chat/agents/main-agent.ts](app/api/chat/agents/main-agent.ts)).

## Document generation/editing flow
- Document mode streams custom data parts (`data-title`, `data-documentPatch`) and applies `DocumentPatch` logic to update Markdown (see [app/api/chat/agents/document-agent.ts](app/api/chat/agents/document-agent.ts) and [lib/documentPatches.ts](lib/documentPatches.ts)).
- Edit requests use patch mode: headings are matched and replaced/append/delete/rename instead of regenerating the whole document. Preserve this behavior when changing doc logic.
- UI renders document and diagram in [components/document/DocumentPanel.tsx](components/document/DocumentPanel.tsx). Keep document state updates in sync with right-panel view (see `updateEngineDocument()` in [app/page.tsx](app/page.tsx)).

## Attachments and hidden text
- Attachments are parsed server-side in [app/api/chat/route.ts](app/api/chat/route.ts) (PDF/DOC/XLSX/PPTX) and injected into messages using `<AI-HIDDEN>...</AI-HIDDEN>` blocks.
- The UI hides hidden blocks and shows a placeholder (see `sanitizeUserText()` in [components/chat/MessageRenderer.tsx](components/chat/MessageRenderer.tsx)). If you add new message formatting, preserve hidden-tag handling.
- Upload API performs local extraction and falls back to Gemini upload (see [app/api/upload/route.ts](app/api/upload/route.ts)).

## Persistence (SurrealDB)
- All prompts/users/conversations are stored in SurrealDB via [lib/getPromt.ts](lib/getPromt.ts). `connectDB()` defines schema and uses env vars: `SURREAL_NAMESPACE`, `SURREAL_DATABASE`, `SURREAL_USER`, `SURREAL_PASS` (and optional `SURREAL_LOG`).
- Conversations store `messages`, `messages_raw`, and `document_content`. Use `sanitizeMessage()` when persisting new messages.

## Conventions and patterns
- Message payloads are AI SDK `UIMessage`-style (`parts` with `text`/`file`). Avoid sending plain strings to the UI; use `parts` and `metadata.attachments` consistently (see [app/page.tsx](app/page.tsx) and [components/chat/MessageRenderer.tsx](components/chat/MessageRenderer.tsx)).
- The default model uses OpenRouter with reasoning enabled in [app/api/chat/route.ts](app/api/chat/route.ts). If you change providers, keep streaming and reasoning metadata intact.

## Dev workflows
- Dev server: `npm run dev` (Next.js + Turbopack).
- Build: `npm run build`, Start: `npm start`.
- Lint/format: `npm run lint` / `npm run format` (Biome).
- Tests: `npm test` (Jest).

## External integrations
- OpenRouter: `OPENROUTER_API_KEY` (see [app/api/chat/route.ts](app/api/chat/route.ts)).
- Gemini file upload: `GOOGLE_GENERATIVE_AI_API_KEY` (server) and `NEXT_PUBLIC_GOOGLE_API_KEY` (client) (see [app/api/upload/route.ts](app/api/upload/route.ts) and [lib/uploadGeminiFile.ts](lib/uploadGeminiFile.ts)).