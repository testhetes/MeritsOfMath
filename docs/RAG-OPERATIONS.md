# RAG operations runbook

How the retrieval half of Merits of Math is provisioned, how to put curriculum
into it, and how to get out of the traps this project has already fallen into.

Written for someone who has never seen this project before. If you only read
one section, read [The build-time trap](#the-build-time-trap) — it has cost
this project hours twice.

`DEPLOY.md` covers the chat proxy and its AI providers. This document covers
the vector index only.

---

## What exists

| Thing | Value | Where it lives |
|---|---|---|
| Vectorize index | `merits-kb` | Cloudflare account, Vectorize (v2) |
| Dimensions | **1024** | fixed at index creation, cannot be changed |
| Metric | **cosine** | fixed at index creation |
| Embedding model | **`@cf/baai/bge-m3`** | Workers AI, pinned in `functions/api/_rag.js` |
| Binding name | `VECTORIZE` | Pages project → Settings → Bindings |
| Admin secret | `INGEST_SECRET` | Pages project → Settings → Environment variables |
| Contents today | 88 vectors from 16 Markdown lessons under `content/` | — |

The dimension, the metric and the model are one decision, not three. `bge-m3`
produces 1024-dimensional vectors, so an index created with any other
dimension will reject every write. If the model is ever changed, the index has
to be **recreated** at the new dimension and all content re-uploaded; there is
no migration.

### The endpoints

All four live in `functions/api/`, but only three of them require the
`Authorization: Bearer $INGEST_SECRET` header: `/api/rag-status`,
`/api/ingest` and `/api/retrieve` are secret-gated and unreachable by a
student. `/api/chat` is deliberately **public** — a student's browser has no
secret to send and must be able to reach it directly. That is exactly why the
AI provider keys (`GROQ_API_KEY` and friends) live server-side in
`functions/api/chat.js` rather than in the frontend: the one thing that must
stay secret never reaches the browser, and the endpoint the browser calls
needs no secret of its own. `/api/chat` does not retrieve from the index
today — it is a straight proxy to the configured AI providers.

| Endpoint | Purpose |
|---|---|
| `POST /api/rag-status` | secret-gated. diagnostics: embedding model, live embedding dimension, index description (`vectorCount`, `processedUpToMutation`) |
| `POST /api/ingest` | secret-gated. the **only** way anything is written: upserts chunks, deletes ids |
| `POST /api/retrieve` | secret-gated. semantic search, used by the eval |
| `POST /api/chat` | public. the student-facing endpoint; proxies to an AI provider, no retrieval yet |

`_rag.js` is shared by all of them. In particular `embed()` is the single
embedding path — index-time and query-time vectors can never come from
different models or settings — and `search()` is the single query path, so the
retrieval eval exercises exactly the code a child's question travels through.

---

## The build-time trap

**Cloudflare Pages applies environment variables and bindings at BUILD time,
not at request time.**

Saving `INGEST_SECRET` in the dashboard, or adding the `VECTORIZE` binding,
changes **nothing** about the deployment that is currently live. The running
code keeps the values it was built with. `env.VECTORIZE` stays `undefined` and
`env.INGEST_SECRET` stays unset until the project is built again.

This has cost this project hours on two separate occasions, both times
presenting as "I set it, why is it still broken".

**After adding or changing any variable or binding, you must redeploy.**
Either push a commit to the production branch, or use
*Deployments → the latest deployment → Retry deployment* in the dashboard.

How to tell which case you are in:

- `POST /api/rag-status` returns `{"error": "INGEST_SECRET is not configured
  on the server"}` with **HTTP 500** → the secret is missing from the build.
  A wrong token gives **HTTP 401** instead. The two are deliberately
  distinguished, because from outside they otherwise look identical.
- `rag-status` returns `200` with `"index": null` → the `VECTORIZE` binding is
  missing from the build. The retrieval eval fails immediately and says so
  rather than waiting two minutes for an index that will never appear.

### Production only

`INGEST_SECRET` and the `VECTORIZE` binding exist in the **Production**
environment only. They are deliberately **not** set for Preview. A preview
deployment therefore cannot read or write the index, and every RAG endpoint on
a preview URL will fail with the 500 above. That is expected. There is no
separate test index: `RAG_BASE_URL` points at the live site, and the index the
tests touch is the one children's chat retrieves from.

---

## Adding or updating content

Content is Markdown under `content/grade<N>/<doc-id>.md`. The filename stem
becomes the `doc_id`. `scripts/rag/chunker.py` splits a file on its headings
and packs paragraphs into chunks of at most 1200 characters; each chunk gets
the id `{doc_id}:{chunk_index:04d}` and carries `doc_id`, `section`,
`chunk_index` and its own text as metadata.

```powershell
# from the repo root
$env:RAG_BASE_URL  = "https://meritsofmath.pages.dev"
$env:INGEST_SECRET = [Environment]::GetEnvironmentVariable('INGEST_SECRET','User')

python -m scripts.rag.upload content/grade2/phep-cong-co-nho-trong-pham-vi-100.md
```

The uploader publishes the **working-tree** copy of the file, uncommitted
edits included. Run it from a checkout whose copy of the file is the one you
mean children to read.

Each file is uploaded in batches of 25 chunks, then pruned, then confirmed.

### Why the prune step exists

Chunk ids are positional and an upsert only ever overwrites the ids it is
given. A lesson edited from 7 chunks down to 5 would leave `{doc_id}:0005` and
`{doc_id}:0006` in the index **forever** — and a child could later be shown
text that was deleted from the curriculum months earlier.

Vectorize has no "list this document's ids" API. So after uploading N chunks
the uploader deletes the window `{doc_id}:{N:04d}` through
`{doc_id}:{N+199:04d}`. Deleting an id that does not exist is a harmless
no-op, which is exactly what makes a blind window safe. A document would have
to lose more than 200 chunks in one edit for a stale vector to survive; the
largest lesson today produces 9.

### Why the wait step exists

Vectorize is **eventually consistent**. A write is not queryable the moment
the request returns.

The obvious wait — poll `vectorCount` until it stops changing — is broken in
the case that matters most. Re-uploading an edited lesson whose chunk count
did not change leaves `vectorCount` **identical**, so the wait returns
immediately and whatever reads the index next is served the **old** vectors.
That is how a retrieval eval can grade the content it was supposed to be
replacing and report success.

So `/api/ingest` returns Vectorize's `mutationId`, and the uploader polls
`processedUpToMutation` from `/api/rag-status` until it reaches that id.
`processedUpToMutation` is a watermark, so waiting on the last mutation a
document issued proves every earlier one landed too. If it does not arrive
within 180 seconds the uploader raises `MutationTimeout` rather than letting
you carry on reading stale vectors.

### Deleting vectors by hand

Every write goes through `/api/ingest`, including deletion:

```powershell
$headers = @{ Authorization = "Bearer $env:INGEST_SECRET" }
$body = '{"delete_ids":["some-doc:0005","some-doc:0006"]}'
Invoke-RestMethod -Method Post -Uri "$env:RAG_BASE_URL/api/ingest" `
    -Headers $headers -ContentType "application/json" -Body $body
```

The response is `{"upserted":0,"mutationId":null,"deleted":2,
"deleteMutationId":"..."}`. Poll `/api/rag-status` until
`processedUpToMutation` equals that `deleteMutationId`, then check
`vectorCount`.

Limits enforced by the endpoint: at most 50 chunks, or **100** `delete_ids`,
per request. 100 is Vectorize's own hard limit on `deleteByIds` — 101 ids
returns `VECTOR_DELETE_ERROR 40007`. Split a wider range into batches of 100,
as the uploader does for its 200-wide prune window. Ids must be non-blank
strings within **64 bytes** (Vectorize's limit is in bytes, not characters — a
Vietnamese-titled file produces multi-byte ids), and no id may appear twice in
one batch.

---

## Renaming a content file — a manual cleanup

**This is the one case the uploader deliberately does not handle.**

Renaming `content/grade3/old-name.md` to `new-name.md` changes the `doc_id`.
Uploading it writes a complete new set of `new-name:NNNN` vectors, and **every
`old-name:NNNN` vector is orphaned** — outside any prune window, invisible to
the chunk count, and still fully retrievable. A child can be served the old
document under its old name indefinitely.

It is not automated because doing so safely would mean deleting by a
`doc_id` the uploader can no longer see, and a bug in that logic deletes live
curriculum. A rename is rare and deliberate; the cleanup is a deliberate step
too.

After renaming a file:

1. Note the **old** stem and how many chunks it had. If you do not know, a
   generous over-estimate is fine — deleting ids that do not exist is a no-op.
2. Delete the old document's whole range through `/api/ingest`, **in batches
   of 100** — that is Vectorize's limit, and a larger batch is rejected:

   ```powershell
   $headers = @{ Authorization = "Bearer $env:INGEST_SECRET" }
   foreach ($start in 0, 100) {
       $ids = $start..($start + 99) | ForEach-Object { "old-name:{0:d4}" -f $_ }
       $body = @{ delete_ids = $ids } | ConvertTo-Json -Compress
       Invoke-RestMethod -Method Post -Uri "$env:RAG_BASE_URL/api/ingest" `
           -Headers $headers -ContentType "application/json" -Body $body
   }
   ```

3. Upload the renamed file normally.
4. Confirm `vectorCount` from `/api/rag-status` matches what you expect. This
   is the only check that catches a missed orphan.

The same procedure removes a lesson that has been withdrawn entirely.

---

## Running the tests

The suite lives in `tests/` and talks to the live site. **Always run the whole
directory**, never a single file — a directory-level collection error has
already hidden a broken suite behind green single-file runs.

```powershell
python -m pytest tests -v
```

Three modes, by which variables are set:

| Mode | Variables | What runs |
|---|---|---|
| Offline | none | chunker, uploader logic, eval case guards, secret redaction. Everything live skips with a clear reason. |
| Live, read-only | `INGEST_SECRET`, `RAG_BASE_URL` | the above plus every endpoint and the full retrieval eval. **Writes nothing.** |
| Live, writing | the above plus `RAG_ALLOW_PROD_WRITES=1` | also the tests that upsert and delete. |

### `RAG_ALLOW_PROD_WRITES`

There is no test index. A test that writes, writes to the index children
read from — and test fixtures in that index are not inert: the two
`test-doc:*` fixtures that used to live there were the only unaccented text in
an otherwise fully accented Vietnamese index, so an unaccented question
retrieved **test data as if it were curriculum**. They have since been
deleted.

So every writing test sits behind the `allow_prod_writes` fixture and runs
only when `RAG_ALLOW_PROD_WRITES=1` is set deliberately. Set it for one
command, never in a profile, and never from CI. The writing tests clean up
after themselves; confirm `vectorCount` afterwards anyway.

### Secrets in test output

`tests/conftest.py` installs a report hook that redacts `INGEST_SECRET`,
`CF_API_TOKEN` and `CF_ACCOUNT_ID` — and any long fragment of them — from
every pytest report, and `pytest.ini` sets `--tb=short` so tracebacks never
print a failing function's arguments. This exists because pytest's default
traceback prints fixture values, and a fixture held the raw token. Do not
remove either layer, and do not put a secret into an assertion message.
`tests/test_secret_redaction.py` proves the hook works; if it fails, stop and
fix it before running anything else against the live site.

### What the retrieval eval measures

`tests/test_retrieval_eval.py` runs 16 realistic Vietnamese questions, 16
unaccented variants of them, and 6 negative cases, and prints a full score
table at the end of the run. Two things about it are worth knowing before you
touch retrieval:

- **Each case is a paraphrase, never a quote.** An offline guard rejects any
  case sharing a contiguous 5-token span with its own target document, and a
  mirror guard rejects a negative sharing one with *any* document. A case that
  can be won on lexical overlap would make the whole eval falsely reassuring —
  which has happened here before.
- **There is no usable score floor.** Measured on this index, genuine
  retrievals score 0.347–0.723 and irrelevant queries score 0.347–0.505. The
  ranges overlap and invert at the boundary. The old 0.45 floor rejected a
  correct retrieval, rejected ten of sixteen unaccented questions, and still
  admitted five of fourteen negatives. `SCORE_FLOOR` is now 0.30 and is
  documented as a garbage filter, **not** a relevance gate. Relevance comes
  from the query construction — a two-turn query scores 0.659–0.750 on the
  same index — and from the prompt.

---

## Rotating `INGEST_SECRET`

Rotate immediately if the value has ever been printed, pasted, committed, or
included in a log or a bug report.

1. Generate a new value locally (never in a shared terminal):

   ```powershell
   $new = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

2. Cloudflare dashboard → the Pages project → **Settings → Environment
   variables → Production** → edit `INGEST_SECRET`. Use the **Encrypt**
   option so the value cannot be read back afterwards.
3. **Redeploy.** Until you do, the old secret is still the live one — see
   [The build-time trap](#the-build-time-trap).
4. Update your own machine:

   ```powershell
   setx INGEST_SECRET $new
   ```

   `setx` affects **new** shells only. Close and reopen the terminal, and
   restart any editor or agent that inherited the old environment.
5. Verify: `POST /api/rag-status` with the new token returns `200`; with the
   old token it returns `401`. If the old token still returns `200`, the
   redeploy in step 3 did not happen.

`CF_API_TOKEN` and `CF_ACCOUNT_ID` are only needed for direct Cloudflare REST
API work (the one-off fixture deletion, for example). Ordinary operations go
through `/api/ingest` and do not need them.

---

## Capacity

**Written 2026-09-13, before Task 1 of the socratic-chat plan wired retrieval
into `/api/chat`.** Every grounded student message will cost one Workers AI
embedding call, one Vectorize query, and one LLM call (Groq first, falling
through to Workers AI, then OpenRouter). This section checks the free-tier
ceilings against that before the chat UI is built, so the tutor is not
discovered to be under-provisioned in front of a classroom.

Nothing here changes code. If a number below is later contradicted by a real
Cloudflare or Groq account dashboard, trust the dashboard over this document.

### Published limits (fetched today; not from memory)

| Limit | Value | Source |
|---|---|---|
| Workers AI free daily allowance | **10,000 Neurons / day**, resets 00:00 UTC, shared across Free and Paid Workers plans | <https://developers.cloudflare.com/workers-ai/platform/pricing/> |
| Neuron → USD | $0.011 per 1,000 Neurons (base rate; internally consistent with the two model prices below) | same |
| `@cf/baai/bge-m3` (embedding) | **1075 Neurons per 1M input tokens** ($0.012/M tokens) | same |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (LLM fallback) | **26,668 Neurons per 1M input tokens** ($0.293/M) · **204,805 Neurons per 1M output tokens** ($2.253/M) | same |
| Vectorize stored vector dimensions, free | **5,000,000 / month** | <https://developers.cloudflare.com/vectorize/platform/pricing/> |
| Vectorize queried vector dimensions, free | **30,000,000 / month** | same |
| Vectorize "queried vector dimensions" definition | Quoted verbatim: *"If you have 10,000 vectors with 384-dimensions in an index, and make 100 queries against that index, your total queried vector dimensions would sum to 3.878 million `(10000 + 100) * 384`."* I.e. **cost = (vectors_stored + queries_made) × dimensions** — a query's marginal cost is one vector's worth of dimensions, **not** `topK × dimensions`. This is the page's own formula, not an assumption; `topK` does not appear in it. | same |
| Vectorize max dimensions per vector | 1536 | <https://developers.cloudflare.com/vectorize/platform/limits/> |
| Vectorize max vectors per index | 20,000,000 | same |
| Vectorize max indexes per account (Free plan) | 100 | same |
| Vectorize `topK` cap | 50 (with values/metadata returned) / 100 (without) | same |
| Groq free-tier rate limits (`qwen/qwen3.6-27b`) | **30 RPM · 1,000 RPD · 8,000 TPM · 200,000 TPD** | <https://console.groq.com/docs/rate-limits> |

**Workers AI page caveats found:** none about beta status or missing SLA; the
only stated behaviour is "if you exceed any one of the above limits, further
operations will fail with an error," and limits reset daily at 00:00 UTC.

**Groq primary model retired; replaced 2026-09-13:** `llama-3.3-70b-versatile`,
the model this project's whole chat chain treated as its primary path, was
shut down by Groq for free and developer tiers on **2026-08-16** (announced by
email 2026-06-17; see <https://console.groq.com/docs/deprecations>). Every
`/api/chat` request had been returning `model_not_found` from Groq since that
date and silently falling through to Workers AI — undetected, because the
fallback chain reacts only to 429/5xx/network errors and no test called
`/api/chat`.

**The user's decision:** switch Groq to `qwen/qwen3.6-27b` on the **free**
tier. Its verified free-tier limits, read directly from the rate-limits page
above, are **30 RPM · 1,000 RPD · 8,000 TPM · 200,000 TPD** — no login or
account access required, unlike the old model's now-moot gap. The model is
labelled **Preview** on Groq, the class of model that gets retired at short
notice, as its predecessor just was; `tests/test_chat_providers.py` now forces
this provider so the next retirement fails a test the same day instead of
silently degrading for weeks. Qwen 3.6 27B also reasons by default and puts
that reasoning inside `<think>` tags in `message.content` unless
`reasoning_effort: "none"` is set; `functions/api/chat.js` now sets it for
every `qwen/qwen3*` model so a child is never shown the model's internal
monologue.

### Latency (`/api/retrieve`, 10 sequential calls, `topK=5`)

Measured with the plan's exact script, secret read from the Windows User
environment scope in the same PowerShell invocation, never printed.

| Run | p50 | p95 | min | max |
|---|---|---|---|---|
| 1 | 1040 ms | 1168 ms | 708 ms | 1674 ms |
| 2 (≈1 min later) | 1068 ms | 1224 ms | 691 ms | 1224 ms |

Both runs land in the same band (p50 ≈ 1.0–1.1 s, p95 ≈ 1.17–1.22 s), so this
is not a cold-start artifact of a single run. Against
`RETRIEVAL_TIMEOUT_MS = 1800`: p95 sits at **65–68% of the budget** in both
runs (1168/1800 and 1224/1800). That is short of the plan's own "within ~30%"
trigger phrase read strictly (p95 ≥ 1260 ms), but only by about 3–8%, and it
leaves just ~580–630 ms of headroom on a *typical* request before the
1800 ms budget bites — with run 1's max (1674 ms) using 93% of the budget on
its own. Retrieval is also only one leg of a chat turn: the LLM call Task 1
adds happens *after* this, so a student's total wait is retrieval latency plus
whatever Groq/Workers AI/OpenRouter take, not bounded by
`RETRIEVAL_TIMEOUT_MS` itself. **Verdict: not a hard breach, but close enough
that it deserves attention, not silence** — a few hundred ms of regression
(e.g. Workers AI under load) would push p95 past the "within 30%" line for
real.

### Headroom arithmetic

All estimates below that are not directly from a pricing page are computed
from figures actually measured in this repository (word/character counts of
the plan's own prompt text, and the real chunk sizes produced by
`scripts/rag/chunker.py` against every file in `content/`) — not invented.
Running the chunker over all 16 lesson files today gives:

```
16 docs, 88 chunks total (matches the index's 88 vectors)
chunks per doc: min 3, mean 5.5, max 7
chunk length (chars): min 46, mean 165.6, median 147, max 405 (chunker's own cap is 1200 — never reached by real content)
```

**Token estimate for the grounded LLM system prompt**, using ~1 token per 4
characters (the plan's `buildSocraticPrompt`, counted directly from the text
in the plan doc):

- Fixed instruction skeleton: 157 words / 843 chars ≈ 210 tokens.
- "Reference material" framing text (only added when chunks > 0): 126 words /
  715 chars ≈ 180 tokens.
- 5 retrieved chunks (`topK = 5`): typical ≈ 5 × 166 chars ≈ 830 chars ≈
  ~207 tokens; worst *observed* (5 × the real 405-char max) ≈ ~506 tokens;
  theoretical worst at the chunker's 1200-char cap (never actually reached)
  ≈ ~1500 tokens.
- Student message (10–40 words, ~1.5 tokens/word for Vietnamese) ≈ 15–60
  tokens. Assumed conversation history for a mid-conversation turn: ~100
  tokens (assumption, not measured).
- **Total input tokens per grounded LLM call: ~740 typical, ~1100 on
  observed-worst chunk lengths, ~2100 on the chunker's theoretical cap.**
- Output: `max_tokens ≈ 220` (the value the plan's own sample requests use;
  server caps at 300).

**Messages per day, normal case** (Groq serves the LLM call; Workers AI only
does the embedding, on every message):

- Embedding query text = last two user turns (`buildRetrievalQuery`) ≈ 75
  tokens typical (up to ~120 tokens at 40 words × 2 turns).
- Neuron cost = tokens × (1075 / 1,000,000) ≈ **0.08–0.13 neurons/message.**
- 10,000 neurons/day ÷ ~0.08–0.13 ≈ **≈77,000–125,000 messages/day.**
  Workers AI's daily allowance is not a meaningful constraint in the normal
  case — it is consumed almost entirely by embeddings, which are cheap.
  This is not the binding constraint in practice, though: Groq's own daily
  token budget (≈150–210 messages/day, computed below) is far smaller and
  binds first.

**Messages per day, bad case** (Groq is rate-limited; Workers AI serves both
the embedding *and* the LLM call for every message):

- LLM neuron cost = input_tokens × (26,668 / 1,000,000) + 220 ×
  (204,805 / 1,000,000).
  - Typical (740 input tokens): 19.7 + 45.1 ≈ **64.8 neurons/message.**
  - Observed-worst chunk lengths (1100 tokens): 29.3 + 45.1 ≈ **74.4
    neurons/message.**
  - Theoretical chunker-cap worst (2100 tokens): 56.0 + 45.1 ≈ **101.1
    neurons/message.**
  - Embedding cost on top is ≤0.13 neurons/message — negligible next to the
    LLM cost.
- 10,000 neurons/day ÷ (64.8 to 101.1) ≈ **≈99 to ≈154 messages/day.**

**This bad-case figure is below the plan's 500 messages/day gate.** If Groq
is rate-limited for any sustained stretch during school hours, Workers AI's
own free allowance would exhaust after roughly **100–150 grounded chat
turns** for that whole day, across all students combined, before every
further request (even the embedding-only part) starts failing with an error
per the pricing page's stated behaviour.

**Messages per month, Vectorize queried-dimension budget:**

- Formula from the pricing page: `(vectors_stored + queries_made) ×
  dimensions ≤ 30,000,000`.
- This index: 88 vectors × 1024 dims.
- `queries_made ≤ 30,000,000 / 1024 − 88 ≈ 29,208 − 88 ≈ 29,208` (the −88 term
  is negligible at this scale).
- **≈29,200 grounded messages/month** (≈973/day averaged over 30 days) before
  Vectorize's free queried-dimension budget is exhausted. This comfortably
  clears the 500/day (≈15,000/month) gate — **Vectorize is not the
  bottleneck; Workers AI's neuron allowance in the Groq-degraded case is.**

**Storage headroom:**

- Stored today: 88 × 1024 = 90,112 dimensions, against a 5,000,000 free
  budget → **1.8% used.**
- Remaining: (5,000,000 − 90,112) / 1024 ≈ **4,794 more vectors** could be
  stored free. At the measured 5.5 chunks/lesson average, that is roughly
  **≈870 more lessons** — storage is not a near-term constraint at all.

**Groq's own capacity ceiling** (now knowable from `qwen/qwen3.6-27b`'s
published limits — the binding constraints are **tokens per day and tokens
per minute, not requests**; at these message sizes 1,000 RPD and 30 RPM never
bind first):

- Per-message token cost end-to-end, from the input-token estimate above plus
  the ~220-token output cap: **~960 tokens/message typical** (740 input + 220
  output), **~1,320 tokens/message on observed-worst chunk lengths** (1,100
  input + 220 output).
- **Messages per day**: 200,000 TPD ÷ 960–1,320 tokens/message ≈ **150–210
  grounded messages/day** on Groq before its daily token budget is exhausted
  and further requests fall through to Workers AI for the rest of the day.
- **Concurrent children** (assuming each actively-working child sends one
  message roughly every 20–30 seconds, i.e. ~2.0–3.0 messages/minute, midpoint
  ≈2.4/min): 8,000 TPM ÷ 960–1,320 tokens/message ≈ 6.1–8.3 messages/minute of
  Groq capacity, ÷ ≈2.4 messages/minute/child ≈ **≈2.5–3.5 children chatting
  at once** before requests start falling through to Workers AI.
- **Combined with Workers AI absorbing the overflow** (its own bad-case
  ceiling of ≈99–154 messages/day, computed above, once it is carrying both
  the embedding and the LLM call): **≈250–360 grounded messages/day combined**
  across both providers before both free allowances are exhausted for the
  day.
- This is now a **resolved, verified figure** — no login to Groq's account
  limits page was needed; the public rate-limits page names `qwen/qwen3.6-27b`
  explicitly, unlike the retired model.

### UNKNOWNs carried forward

1. **Average conversation length / history size per real chat session** —
   used an assumed ~100 tokens of prior-turn history in the bad-case token
   estimate; no real chat sessions exist yet to measure this from (Task 1 is
   unbuilt), so it is an assumption, not a measurement.
2. **Exact tokenizer behaviour for Vietnamese text** on both `bge-m3`'s
   tokenizer and Qwen 3.6 27B's tokenizer — used a ~4 chars/token, ~1.5
   tokens/word approximation throughout. Neither Cloudflare's nor Groq's
   pages state a Vietnamese-specific ratio; the true figure could shift every
   token-based estimate above by some margin in either direction.
3. **Whether the 10,000 Neurons/day free allowance is per-account or could be
   affected by other Workers AI usage on the same Cloudflare account** outside
   this project — the pricing page does not distinguish per-project
   allowances.

### Gate verdict

**Accepted below the gate — a deliberate trade, not an oversight.** Both
flagged figures now come from verified `qwen/qwen3.6-27b` limits rather than
an unknown:

- Groq's own daily ceiling (**≈150–210 grounded messages/day**) and
  concurrency (**≈2.5–3.5 children at once**) both fall below the plan's
  500/day and 5-child gate. Combined with Workers AI absorbing overflow, the
  two providers together cap out around **≈250–360 grounded messages/day**.
- **The user's decision (2026-09-13):** run Qwen 3.6 27B on Groq's free tier
  anyway, for zero cost, fully aware this sits below the pre-flight gate. This
  is a deliberate trade for a free tutor serving a small classroom, not a gap
  to silently work around. **Revisit before real classroom use** — a paid
  Groq tier, a different/larger model, or a caching layer in front of repeat
  questions would all raise this ceiling.

Retrieval latency (p95 ≈ 1.17–1.22 s against an 1800 ms budget) is not itself
a gate breach but is close enough — 65–68% of budget on every run measured —
that it should be watched once Task 1 adds the LLM call on top, rather than
assumed safe indefinitely.

None of this blocks Task 1's implementation work, which does not touch these
limits by itself. It **is** a product decision for whoever owns this project:
whether a Groq-degraded day capping out around 100–150 messages is acceptable
for a single classroom's traffic, and whether it is worth requesting a higher
Groq tier, adding a cache in front of repeat questions, or accepting the risk
before this ships to real students.
