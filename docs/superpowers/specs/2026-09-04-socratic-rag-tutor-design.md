# Socratic RAG Math-Tutor Chatbot — Design Spec

- **Date:** 2026-09-04
- **Status:** Approved (design) — pending implementation plan
- **Author:** testhetes (with Claude)

## 1. Context & motivation

MeritsOfMath today is a gamified Grade-11 logarithms demo (skill tree, battles, XP)
with a keyword-matching "RAG" (`rag.js`) feeding a Socratic AI tutor. Two problems:

1. The content is a Grade-11 demo, not the PRD's actual target (**Grades 1–5 Vietnamese
   arithmetic & algebra**).
2. Retrieval is crude keyword term-frequency matching that won't scale to real material.

**Decision:** pivot to a focused **Socratic math-tutor chatbot** — chat-first, grounded in
a real vector-search knowledge base of Grade 1–5 content — and retire the game. This keeps
the PRD's pedagogical soul (guided tutoring that never hands over answers) while dropping
the complexity that isn't serving learning.

## 2. Goals / non-goals

**Goals**
- A clean chat app: student asks in Vietnamese (or English), the tutor **guides Socratically**.
- **Real semantic retrieval** (embeddings + vector search) grounded in a curated Grade 1–5 KB.
- An ingestion pipeline that turns source PDFs into clean, reviewable Markdown without
  hand-authoring everything or trusting raw OCR.
- Scales from tens of chunks to a full textbook library; stays on free/low-cost tiers.
- Reuse the existing Cloudflare deploy, multi-provider AI proxy, i18n, PWA, and chat UI.

**Non-goals (v1)**
- No XP, streaks, skill tree, battles, dashboard, or onboarding wizard.
- No per-student uploads (KB is a **curated shared library**).
- No direct-answer "study assistant" mode — the bot guides, it does not solve for the student.
- No offline generation (LLM calls need the network; retrieval also needs the network).

## 3. Product behavior

- **Chat-first.** One screen: a conversation with the tutor. Optional suggested prompts /
  topic hints to help young students start.
- **Socratic + grounded.** Retrieved textbook content is given to the model as *reference
  for its own eyes* with an explicit rule: use it to ask sharper leading questions and catch
  misconceptions, but **do not quote the worked solution or final answer**. Retrieval makes
  the guidance smarter without turning the bot into an answer key.
- **Bilingual.** Keep the existing vi/en i18n; default Vietnamese. The tutor replies in the
  student's chosen language (already wired in `buildPrompt`).
- **Audience:** Grade 1–5. Language and tone must be simple, warm, and age-appropriate
  (the tutor-prompt rework already moved this direction).

## 4. Architecture — Cloudflare-native

Two halves, testable in isolation.

### Build-time (offline, run by the team; never in production) — `scripts/ingest/`
1. **convert** — render each source PDF page to an image, send to a **vision-capable LLM**
   with a "transcribe to clean Markdown, formulas as LaTeX" prompt → `content/<grade>/<topic>.md`.
   Output committed to git; a human skims for errors (read, not write).
2. **chunk** — split each Markdown doc into ~200–400-token retrieval chunks along headings,
   attaching metadata: `{ source, grade, topic, section, page }`.
3. **embed-upload** — embed each chunk with a **multilingual** Workers AI model and upsert
   the vector + metadata into **Cloudflare Vectorize**.

Content (`content/`) is the source of truth in git, so re-chunking / re-embedding is reproducible.

### Runtime (Cloudflare Pages)
- **`/api/chat`** (existing proxy, extended) — the only endpoint the app calls. It:
  1. embeds the student's message via Workers AI,
  2. queries Vectorize for top-k relevant chunks,
  3. builds the Socratic system prompt with that context ("reference, do not reveal"),
  4. runs the existing provider chain (Groq → Workers AI → OpenRouter, with retries).
  One round trip — important for slow connections.
- **`/api/retrieve`** — thin endpoint returning top-k chunks only. Not used by the app;
  exists for debugging and retrieval-quality evals (and the `/debug` page).
- **Frontend** — a minimal chat app reusing the current chat UI (message rendering, MathLive
  input, MathJax, markdown parsing, friendly-error handling), i18n, and PWA/service worker.

## 5. Data flow

**Ingest:** `PDF → vision LLM → Markdown (git, reviewed) → chunker → Workers AI embed → Vectorize`

**Chat:** `student msg → /api/chat → embed query → Vectorize top-k → Socratic prompt
(context marked "reference, do NOT reveal") → LLM chain → guided reply`

## 6. Keep / retire / repurpose

**Keep**
- Cloudflare Pages deploy (fork `testhetes/MeritsOfMath` → meritsofmath.pages.dev).
- Multi-provider `/api/chat` proxy: Groq → Workers AI → OpenRouter, auto-append, retries,
  friendly errors, `X-AI-Provider`/`X-AI-Chain` headers.
- i18n (vi/en) engine and toggle.
- PWA / service worker (cache:reload precache).
- Chat UI pieces: message rendering, MathLive math input, MathJax, markdown, typing indicator.

**Retire**
- Skill tree (`db.js` graph + tree rendering + `SkillTree` in `app.js`).
- Battles / progression / XP (`battleSystem.js`, `progression.js`, `dashboard.js`).
- Onboarding wizard (replace with a minimal welcome or none).
- Keyword retrieval (`rag.js`) — replaced by Vectorize.
- The Grade-11 logarithm curriculum in `db.js` — **not** reused as seed content.

**Repurpose**
- The tutor system-prompt logic in `aiTutor.js` (`buildPrompt`) — carried over and extended
  with the "grounded reference, do not reveal" instruction and retrieved context.

## 7. Content

- **Grades 1–5 Vietnamese math** (arithmetic & algebra per the PRD), from official curriculum
  textbooks / exam banks the team supplies as PDFs.
- Ingested via the LLM-assisted convert→review→chunk→embed pipeline (§4).
- **Start small:** ingest one chapter (or one grade's one topic) first, validate end-to-end,
  then scale. "Thorough" refers to the pipeline, not day-one corpus size.

## 8. Error handling & graceful degradation

- **Retrieval failure** (Vectorize empty/down, embedding fails) → the tutor answers
  **ungrounded** rather than erroring; log the failure. Retrieval never breaks chat.
- **LLM chain failure** → existing friendly "tutor is busy" message + one retry pass.
- **Empty KB** (before any content is ingested) → tutor still works ungrounded; a small
  notice can indicate content is being added.

## 9. Testing / verification

- **Unit:** chunker splits deterministically; metadata attached correctly.
- **Retrieval evals:** a small fixed set of Vietnamese Grade 1–5 questions asserts that the
  expected chunks are returned (guards retrieval quality and embedding-model choice).
- **E2E (in-browser):** drive the chat, confirm grounded-but-Socratic behavior, confirm
  graceful degrade when Vectorize is empty/down.
- **Debug surface:** extend `/debug` to probe `/api/retrieve` (query → top-k with scores).

## 10. Staging

- **Phase 1:** build the full pipeline + Vectorize + `/api/retrieve` + extended `/api/chat`
  + minimal chat frontend; ingest ONE Grade 1–5 chapter; prove quality end-to-end.
- **Phase 2:** scale content across grades, add source citations in the UI, suggested prompts,
  and polish.

The implementation plan will target **Phase 1**.

## 11. Open items / risks

- **Vietnamese embedding quality** on Workers AI — pick a multilingual model (candidate:
  `@cf/baai/bge-m3`) and validate with the retrieval eval set before committing. Fallback:
  a different multilingual model or an external embedding API if quality is poor.
- **Vectorize free-tier limits** — verify storage/query quotas cover the intended corpus.
- **Vision-LLM transcription cost/quality** for math — a build-time cost only; validate on a
  sample chapter before bulk conversion.
- **Math fidelity** end-to-end (LaTeX through convert → chunk → embed → render) — verify
  formulas survive and render via MathJax.
