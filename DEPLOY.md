# Deploying Merits of Math (free)

The app is a static chat page (`index.html` + `chat.css` + `js/`) plus serverless
functions that hide the AI API keys. Both halves fit comfortably in free tiers.

## Architecture

```
Browser (static chat)  ──►  /api/chat  ──►  retrieve curriculum context (Vectorize, when ground: true)
                                        ──►  tries Groq → Workers AI → OpenRouter
                            (all keys and bindings stay server-side)
```

Students never enter or see a key. The chat always sends `ground: true`, so `/api/chat`
first retrieves matching lesson text through `search()` in `functions/api/_rag.js`, builds
the Socratic system prompt server-side, and then calls the providers. The proxy pins the
model and caps token usage, so a leaked endpoint can't run up large bills. The retrieval
endpoints (`/api/retrieve`, `/api/ingest`, `/api/rag-status`) are secret-gated; see
[docs/RAG-OPERATIONS.md](docs/RAG-OPERATIONS.md) for the index, ingestion and capacity.

## AI providers (free tiers + fallback)

The proxy tries each configured provider in order and, if one is rate-limited or erroring,
falls through to the next. The frontend needs no changes — it always calls `/api/chat`.

| Config | Provider | Default model | Notes |
|---|---|---|---|
| `GROQ_API_KEY` (env var) | Groq | `qwen/qwen3.6-27b` | fast primary. Qwen3 reasons by default and puts that reasoning inside `<think>` tags in the reply; the proxy sends `reasoning_effort: 'none'` for it so a child never sees that monologue |
| `AI` (binding, not env var) | Cloudflare Workers AI | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | runs on your own account's daily allowance, so it is the dependable second layer |
| `OPENROUTER_API_KEY` (env var) | OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | shared free pool, often rate-limited; best-effort layer after Workers AI |
| `GEMINI_API_KEY` (env var) | Google Gemini | `gemini-2.0-flash` | not in the default order. Setting the key alone appends Gemini after the others as a last resort; list it in `PROVIDER_ORDER` to try it earlier. Its free tier 429s in some regions |

The fallback layers run a different model family from the Groq primary, so their replies can
differ in style.

**Do not set `GROQ_MODEL` (or any other `*_MODEL` override) in Cloudflare.** The defaults in
`functions/api/chat.js` are the single source of truth. When Groq retired its previous model,
the code default was updated, but a leftover `GROQ_MODEL` variable kept pointing at the retired
model and took the primary down until it was deleted. The overrides exist for emergencies
only; remove one as soon as the code default is fixed.

Other optional env vars:
- `PROVIDER_ORDER` — preferred try-order (default `groq,workersai,openrouter`). A preference,
  not a whitelist: every configured provider is auto-appended as a last resort, so a stale
  value can't exclude a working layer.
- `ALLOWED_ORIGIN` — e.g. `https://meritsofmath.pages.dev`; soft-blocks other browser origins.

Free-tier model slugs get retired without warning. `tests/test_chat_providers.py` forces the
Groq and Workers AI providers so a retired default fails a test instead of silently degrading.

Response headers for debugging: `X-AI-Provider` (who answered), `X-AI-Chain` (try order),
`X-RAG-Chunks` (how many lesson chunks grounded the reply) and `X-RAG-Error` (a fixed code
such as `timeout` or `no_binding` when retrieval fell back to an ungrounded reply).

## Cloudflare Pages setup

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings: **Framework preset: None**, **Build command: empty**, **Output directory: `/`**
   (the repo root — it's already static).
4. **Settings → Environment variables**: add at least one provider key from the table above,
   marked **encrypted/secret**, and `INGEST_SECRET` for the secret-gated retrieval endpoints.
5. **Settings → Bindings**: add **Workers AI** named `AI` and the **Vectorize** index `merits-kb`
   named `VECTORIZE`. Both are needed for grounding: without them the chat still answers, but
   ungrounded, with `X-RAG-Error` set.
6. Redeploy. **Cloudflare applies env vars and bindings only on a new build** — saving a
   setting does nothing until the next deploy.

`functions/api/*.js` are picked up automatically and served under `/api/` — no config file needed.

## Local development

- Open the page through a local server (not `file://`) so the service worker registers —
  e.g. `python -m http.server`, then visit `http://localhost:<port>`.
- `/api/chat` only exists where Pages Functions run. The simplest way to exercise it is against
  the deployed site. Running Functions locally with `npx wrangler pages dev .` would need a
  provider key, plus the `AI` and `VECTORIZE` bindings for grounding, configured for local use,
  which this project has not set up.
- `python -m pytest tests` runs the offline tests anywhere. The live tests run against a deployed
  site and skip themselves unless it is configured: see `tests/conftest.py` for `RAG_BASE_URL`
  and `INGEST_SECRET`. Write tests stay skipped unless `RAG_ALLOW_PROD_WRITES=1` is set
  deliberately.

## Offline / PWA

`manifest.webmanifest` + `sw.js` make the app installable. The service worker fetches the app
files **network-first**, so a returning visitor's next load runs the deployed code, and falls
back to its cache only when the network fails. CDN files — MathJax, marked and DOMPurify, each
pinned to an exact version, plus the Google Fonts stylesheet — are cached after the first
successful load, and only when the worker can read the response as a success. Bump `CACHE` in
`sw.js` only to purge everything, for example when files are deleted — routine deploys don't
need it.

## Next step: true offline-first (optional follow-up)

Runtime caching covers returning students but still needs the CDNs (MathJax, marked, DOMPurify,
Google Fonts) on the **first** load. To make even a cold first load work with the CDNs blocked
or unreachable, vendor those libraries into the repo and precache them in `sw.js`. MathJax
lazy-loads extra sub-files (including `ui/safe.js` and fonts), so this is a larger, separate task.
