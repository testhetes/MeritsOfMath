# Deploying Merits of Math (free)

The app is a static site (`index.html` + `js/` + `style.css`) plus one serverless
function that hides the AI API key. Both halves fit comfortably in free tiers.

## Architecture

```
Browser (static app)  ──►  /api/chat  ──►  tries Groq → OpenRouter → Gemini (fallback)
                            (proxy holds all keys server-side)
```

Students never enter or see a key. The proxy pins the model and caps token usage
server-side, so a leaked endpoint can't run up large bills.

## AI providers (free tiers + fallback)

The proxy is multi-provider: it tries each configured provider in order and, if one is
rate-limited or erroring, falls through to the next. **Configure at least one; add more
to stack free tiers** for more effective capacity across many students. The frontend
needs no changes — it always just calls `/api/chat`.

| Config | Provider | Notes | Setup |
|---|---|---|---|
| `GROQ_API_KEY` (env var) | Groq | fast, generous free tier — the primary | https://console.groq.com |
| `OPENROUTER_API_KEY` (env var) | OpenRouter | shared free pool, often rate-limited — best-effort middle layer | https://openrouter.ai/keys |
| `AI` (binding, not env var) | Cloudflare Workers AI | runs on **your own account's daily allowance** — most predictable layer, ideal last resort | Pages project → **Settings → Bindings → Add → Workers AI**, name it `AI`, redeploy |
| `GEMINI_API_KEY` (env var) | Google Gemini | big free limit, but 429s in some regions | https://aistudio.google.com/apikey |

Optional env vars:
- `GROQ_MODEL` / `OPENROUTER_MODEL` / `GEMINI_MODEL` / `WORKERSAI_MODEL` — override the pinned
  model. Defaults: `llama-3.3-70b-versatile`, `meta-llama/llama-3.3-70b-instruct:free`,
  `gemini-2.0-flash`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — the Groq/OpenRouter/Workers AI
  defaults are all the same Llama 3.3 70B model on different infrastructure, so fallback
  replies are indistinguishable from primary ones.
- `PROVIDER_ORDER` — try-order (default `groq,openrouter,workersai`; add `gemini` only if its
  free tier works for your account/region).

Model notes: free-tier model slugs get retired without warning (OpenRouter's free DeepSeek
was removed in 2026 — a 404 naming a "paid version" means exactly this; pick a current
`:free` slug from https://openrouter.ai/models and set `OPENROUTER_MODEL`). Avoid *reasoning*
models (R1, gpt-oss) for tutoring: with this app's small token budget they spend everything
on hidden thinking and return empty replies.

The `X-AI-Provider` response header tells you which provider actually served each reply
(handy for debugging fallback).

## Recommended: Cloudflare Pages (static + Functions on one origin)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings: **Framework preset: None**, **Build command: empty**, **Output directory: `/`** (the repo root — it's already static).
4. After the first deploy, go to **Settings → Environment variables** and add **at least one**
   provider key from the [AI providers](#ai-providers-free-tiers--fallback) table below
   (mark each **encrypted/secret**), e.g. `GROQ_API_KEY`. Optionally add `ALLOWED_ORIGIN` =
   your site URL (e.g. `https://meritsofmath.pages.dev`) to soft-block other origins.
5. Redeploy. `functions/api/chat.js` is picked up automatically and served at `/api/chat` — no config file needed.

## Alternative: Netlify

Netlify serves functions under `/.netlify/functions/`, so add a redirect so the
frontend's `/api/chat` still resolves. Create `netlify.toml`:

```toml
[[redirects]]
  from = "/api/chat"
  to = "/.netlify/functions/chat"
  status = 200
```

Then port `functions/api/chat.js` to Netlify's handler signature
(`export default async (request, context) => {...}`, reading `Netlify.env.get('GROQ_API_KEY')`)
and place it at `netlify/functions/chat.js`. Set `GROQ_API_KEY` under
**Site settings → Environment variables**.

## Local development

- Open via a local server (not `file://`) so the service worker registers — e.g.
  `npx serve` or `python -m http.server`, then visit `http://localhost:<port>`.
- The `/api/chat` proxy only exists on a platform that runs the function. For local
  AI while developing, either:
  - open **Settings** and paste your own Groq key (cloud mode goes direct to Groq), or
  - open **Settings → Local** and point at a running Ollama instance, or
  - run `npx wrangler pages dev .` to emulate Cloudflare Pages Functions locally.

## Offline / PWA

`manifest.webmanifest` + `sw.js` make the app installable and cache the shell **and**
the CDN libraries after the first successful load, so it works offline on return
visits. Bump `CACHE` in `sw.js` when you ship changes.

## Next step: true offline-first (optional follow-up)

Runtime caching covers returning students but still needs the CDNs (MathJax, MathLive,
Font Awesome, Google Fonts, mathjs, marked) on the **first** load. To make even a cold
first load work with the CDNs blocked or unreachable, vendor those libraries into the
repo and precache them in `sw.js`. MathJax and MathLive lazy-load extra sub-files, so
this is a larger, separate task — done here intentionally as a follow-up.
