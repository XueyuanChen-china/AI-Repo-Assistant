# AI Repo Assisant

Day 1 scaffold for a Web-based AI Repo Assistant MVP.

## What is included today

- `web`: React + Vite workspace shell
- `server`: Fastify API with mock repo/chat endpoints
- `shared`: shared types and zod schemas
- Three-panel layout:
  - left: file tree
  - center: chat workspace
  - right: code preview / diff preview
- Zustand store for the core UI state

## What is intentionally mocked for Day 1

- repository tree
- file contents
- AI reply generation
- diff suggestion output

This keeps the first day focused on architecture and UI flow. Real file-system
access and model calls can replace the mock services from Day 2 onward.

## Run later after installing dependencies

In two terminals:

```bash
bun run dev:server
bun run dev:web
```

## Suggested Day 2 follow-up

- replace mock repo service with local file-system traversal
- replace mock file content loader with real file reads
- keep the `shared` API shapes stable so the UI does not need major rewrites
