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

All four live in `functions/api/` and all four require the
`Authorization: Bearer $INGEST_SECRET` header. None of them is reachable by a
student — the chat endpoint retrieves internally, in-process.

| Endpoint | Purpose |
|---|---|
| `POST /api/rag-status` | diagnostics: embedding model, live embedding dimension, index description (`vectorCount`, `processedUpToMutation`) |
| `POST /api/ingest` | the **only** way anything is written: upserts chunks, deletes ids |
| `POST /api/retrieve` | semantic search, used by the eval |
| `POST /api/chat` | the student-facing endpoint; retrieves in-process |

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

Limits enforced by the endpoint: at most 50 chunks or 500 `delete_ids` per
request; ids must be non-blank strings within **64 bytes** (Vectorize's limit
is in bytes, not characters — a Vietnamese-titled file produces multi-byte
ids); no duplicate ids within one batch.

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
2. Delete the old document's whole range through `/api/ingest`:

   ```powershell
   $ids = 0..199 | ForEach-Object { "old-name:{0:d4}" -f $_ }
   $body = @{ delete_ids = $ids } | ConvertTo-Json -Compress
   Invoke-RestMethod -Method Post -Uri "$env:RAG_BASE_URL/api/ingest" `
       -Headers @{ Authorization = "Bearer $env:INGEST_SECRET" } `
       -ContentType "application/json" -Body $body
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
