# Framewoven

AI-powered creative studio for branded social content: design Instagram carousels by chatting with Claude. Next.js 16 + React 19 + TypeScript + Tailwind v4.

Derived from the MIT-licensed Open Carrusel project and now independently maintained. `LICENSE` and its copyright notice must stay unchanged; see `docs/PROVENANCE.md` for origin and attribution and `docs/MAINTAINING.md` for process.

## Architecture

- **Frontend**: React app (localhost:3000 by default; `/start [port]` and `PORT` override it) with chat panel (left), carousel preview (center), slide filmstrip (bottom)
- **AI Agent**: Claude CLI spawned as subprocess via `/api/chat`, communicates through SSE streaming
- **Storage**: JSON files in `/data/` with async-mutex locking and atomic writes
- **Export**: Puppeteer screenshots HTML slides to PNG at exact Instagram dimensions
- **Slides**: Full HTML documents rendered in sandboxed iframes. `wrapSlideHtml()` in `src/lib/slide-html.ts` is the shared rendering contract between preview and export.

## Key Files

- `src/lib/chat-system-prompt.ts` — Dynamic system prompt (injects brand config + carousel context)
- `src/lib/slide-html.ts` — `wrapSlideHtml()` wraps slide body HTML into full documents
- `src/lib/data.ts` — JSON storage with proper async-mutex and atomic writes
- `src/lib/carousels.ts` — Carousel and slide CRUD with version history
- `src/lib/claude-path.ts` — Portable Claude CLI discovery

## API Routes

Served by the running app, on whichever port it was started with. The origin the
design agent is told to call is derived per request by `resolveAppOrigin()` in
`src/lib/request-origin.ts`; never hardcode a port in the system prompt.

- `POST /api/chat` — Claude CLI subprocess + SSE streaming
- `GET/POST /api/carousels` — List/create carousels
- `GET/PUT/DELETE /api/carousels/[id]` — Single carousel
- `POST /api/carousels/[id]/slides` — Add slide
- `PUT/DELETE /api/carousels/[id]/slides/[slideId]` — Update/delete slide
- `PUT /api/carousels/[id]/slides` — Reorder slides (body: { slideIds: [...] })
- `POST /api/carousels/[id]/slides/[slideId]/undo` — Undo slide change
- `POST /api/carousels/[id]/export` — Export all slides to PNG ZIP (default, or `?format=png`) or to one LinkedIn PDF (`?format=pdf`)
- `GET/PUT /api/brand` — Brand configuration
- `GET/POST /api/templates` — Templates
- `POST /api/upload` — Upload (images PNG/JPG/WebP, fonts WOFF2/TTF; max 10MB, type checked by magic bytes)
- `GET /api/fonts` — Google Fonts list

## Conventions

- Components max ~300 lines per file
- Use `cn()` from `src/lib/utils.ts` for class merging
- Types in `src/types/`, libs in `src/lib/`, components in `src/components/`
- All data mutations go through `src/lib/data.ts` (never direct fs writes for JSON)
- Update routes never pass a parsed request body straight to a mutator. They select the fields the endpoint defines as mutable via `src/lib/api-input.ts`; everything else is server-owned
- iframe slides always use `sandbox=""` attribute (no JavaScript execution)
- The Claude subprocess gets `--allowedTools Bash WebFetch Read`: `Bash` to curl the local API routes, `WebFetch` to research while designing, `Read` to view reference images

## Instagram Dimensions

- 1:1 = 1080x1080 (square)
- 4:5 = 1080x1350 (portrait, recommended)
- 9:16 = 1080x1920 (story)
- Max 20 slides per carousel (`MAX_SLIDES` in `src/types/carousel.ts`)

## Slide HTML Rules

Slides store body-level HTML only (no `<html>`, `<head>`, `<!DOCTYPE>`). The `wrapSlideHtml()` function adds the full document structure, font loading, and dimension constraints. Slides should:

- Use inline styles or `<style>` tags
- Reference images as `/uploads/{filename}` paths
- Use Google Font family names in font-family declarations
- NOT contain `<script>` tags (enforced by iframe sandbox)
- Target the carousel's aspect ratio dimensions
