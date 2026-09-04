# RAG Retrieval Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working semantic retrieval layer — ask a Vietnamese Grade 1–5 math question, get back the relevant curriculum chunks — backed by Cloudflare Vectorize and a Python ingestion pipeline.

**Architecture:** A Python pipeline converts source PDFs into reviewed Markdown, chunks it, and POSTs chunks to a new admin-only Pages Function. That function embeds them with Workers AI (`@cf/baai/bge-m3`) and upserts into Cloudflare Vectorize. A second function embeds an incoming query the same way and returns the nearest chunks. Index-time and query-time embeddings deliberately share one code path so they can never drift.

**Tech Stack:** Python 3.14 (pytest, requests, pymupdf) · Cloudflare Pages Functions (JS, ES modules) · Workers AI `@cf/baai/bge-m3` · Cloudflare Vectorize v2 · OpenRouter vision model (build-time only)

## Global Constraints

- **No Node.js/npm/wrangler on the dev machine.** Python 3.14.3 + pip 26.1.2 only. All tooling is Python. Do not add a Node toolchain.
- **No local Pages Functions runtime.** Function changes are verified against the deployed site. Each function change requires `git push` → Cloudflare auto-deploy (~1 min) before testing.
- **Deploy target:** `origin` = `testhetes/MeritsOfMath`, auto-deploys `main` to `https://meritsofmath.pages.dev`. This plan's work happens on branch `feat/socratic-rag-tutor`; test against that branch's Cloudflare **preview** URL, or merge to `main` when ready to test on production.
- **This plan is purely additive.** Do not modify `functions/api/chat.js`, `js/*.js`, `index.html`, or `style.css`. The existing app must keep working.
- **Embedding model is pinned:** `@cf/baai/bge-m3`. The Vectorize index dimension MUST equal the dimension this model actually returns (probed in Task 2, not assumed).
- **One embedding path:** both ingestion and query embed through Workers AI in a Pages Function. Never embed client-side or with a different model.
- **Chunk text is stored in Vectorize metadata.** Vectorize allows ≤10 KiB metadata per vector; chunks are capped at 1200 characters to stay well under it. No separate document store in this plan.
- **Secrets are never committed.** `INGEST_SECRET` lives in Cloudflare Pages env vars; local secrets come from environment variables only.
- **Content and queries are Vietnamese.** Any embedding model substitution must be multilingual.
- **Vector ID format:** `{doc_id}:{chunk_index:04d}` — stable, so re-ingesting updates rather than duplicates.

---

### Task 1: Python tooling and the Markdown chunker

Pure, local, no network. Establishes the Python project and the one piece of real logic we can unit-test properly.

**Files:**
- Create: `requirements.txt`
- Create: `scripts/rag/__init__.py`
- Create: `scripts/rag/chunker.py`
- Create: `tests/__init__.py`
- Test: `tests/test_chunker.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `chunk_markdown(md: str, doc_id: str, max_chars: int = 1200) -> list[dict]`, where each dict is
  `{"id": str, "text": str, "metadata": {"doc_id": str, "section": str, "chunk_index": int}}`.
  Used by Task 6 (uploader) and Task 9.

- [ ] **Step 1: Create the dependency file**

Create `requirements.txt`:

```text
pytest>=8,<9
requests>=2.31,<3
pymupdf>=1.24,<2
```

- [ ] **Step 2: Install dependencies**

Run: `python -m pip install -r requirements.txt`
Expected: all three install successfully.

- [ ] **Step 3: Create empty package markers**

Create `scripts/rag/__init__.py` with an empty file (zero bytes).
Create `tests/__init__.py` with an empty file (zero bytes).

- [ ] **Step 4: Write the failing test**

Create `tests/test_chunker.py`:

```python
from scripts.rag.chunker import chunk_markdown

SAMPLE = """# Phep cong trong pham vi 10

Phep cong la khi ta gop hai nhom lai voi nhau.

Vi du: 2 + 3 = 5.

## Luyen tap

Tinh 4 + 1.

Tinh 5 + 2.
"""


def test_splits_by_heading_and_records_section():
    chunks = chunk_markdown(SAMPLE, doc_id="g1-phepcong")
    sections = {c["metadata"]["section"] for c in chunks}
    assert "Phep cong trong pham vi 10" in sections
    assert "Luyen tap" in sections


def test_ids_are_stable_and_sequential():
    chunks = chunk_markdown(SAMPLE, doc_id="g1-phepcong")
    assert chunks[0]["id"] == "g1-phepcong:0000"
    assert chunks[1]["id"] == "g1-phepcong:0001"
    for i, c in enumerate(chunks):
        assert c["metadata"]["chunk_index"] == i


def test_respects_max_chars():
    long_md = "# Big\n\n" + ("x" * 400 + "\n\n") * 10
    chunks = chunk_markdown(long_md, doc_id="d", max_chars=1200)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c["text"]) <= 1200


def test_no_empty_chunks_and_doc_id_recorded():
    chunks = chunk_markdown(SAMPLE, doc_id="g1-phepcong")
    assert len(chunks) > 0
    for c in chunks:
        assert c["text"].strip() != ""
        assert c["metadata"]["doc_id"] == "g1-phepcong"
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `python -m pytest tests/test_chunker.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.rag.chunker'`

- [ ] **Step 6: Write the implementation**

Create `scripts/rag/chunker.py`:

```python
"""Split reviewed Markdown into retrieval chunks with section metadata."""

import re

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def _sections(md: str):
    """Yield (section_title, body_text) pairs. Text before any heading uses ''."""
    current_title = ""
    buffer: list[str] = []
    for line in md.splitlines():
        m = _HEADING.match(line)
        if m:
            if buffer:
                yield current_title, "\n".join(buffer)
                buffer = []
            current_title = m.group(2).strip()
        else:
            buffer.append(line)
    if buffer:
        yield current_title, "\n".join(buffer)


def _pack(paragraphs: list[str], max_chars: int) -> list[str]:
    """Greedily pack paragraphs into chunks no longer than max_chars."""
    out: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = para if not current else current + "\n\n" + para
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            out.append(current)
        # A single paragraph longer than the cap is hard-split.
        while len(para) > max_chars:
            out.append(para[:max_chars])
            para = para[max_chars:]
        current = para
    if current:
        out.append(current)
    return out


def chunk_markdown(md: str, doc_id: str, max_chars: int = 1200) -> list[dict]:
    """Turn Markdown into a list of retrieval chunks.

    Each chunk carries its section heading so retrieval results are explainable.
    """
    chunks: list[dict] = []
    for title, body in _sections(md):
        paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
        if not paragraphs:
            continue
        for text in _pack(paragraphs, max_chars):
            text = text.strip()
            if not text:
                continue
            index = len(chunks)
            chunks.append(
                {
                    "id": f"{doc_id}:{index:04d}",
                    "text": text,
                    "metadata": {
                        "doc_id": doc_id,
                        "section": title,
                        "chunk_index": index,
                    },
                }
            )
    return chunks
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python -m pytest tests/test_chunker.py -v`
Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add requirements.txt scripts/rag/__init__.py scripts/rag/chunker.py tests/__init__.py tests/test_chunker.py
git commit -m "feat(rag): add Markdown chunker with section metadata"
```

---

### Task 2: `/api/rag-status` endpoint — probe the real embedding dimension

We cannot create the Vectorize index until we know the exact vector length `@cf/baai/bge-m3` returns. This endpoint tells us, and stays as an ops/debug surface.

**Files:**
- Create: `functions/api/_rag.js` (shared helpers — the `_` prefix means Pages does NOT route it)
- Create: `functions/api/rag-status.js`
- Test: `tests/test_rag_status.py`

**Interfaces:**
- Consumes: existing Cloudflare `AI` binding; new `INGEST_SECRET` env var.
- Produces, from `functions/api/_rag.js`:
  - `EMBEDDING_MODEL: string` — the pinned model id.
  - `authorized(request, env) -> boolean` — bearer-token check against `INGEST_SECRET`.
  - `embed(env, texts: string[]) -> Promise<number[][]>` — one vector per input text.
  - `json(obj, status = 200) -> Response` — JSON response helper.
  Tasks 4 and 5 import all four from `./_rag.js`.
- Produces: `POST /api/rag-status` → `{ "embeddingModel": string, "embeddingDim": number, "index": object | null }`.
  Task 3 extends the `index` field.

- [ ] **Step 1: Add the INGEST_SECRET environment variable**

In the Cloudflare dashboard → your Pages project → **Settings → Variables and secrets → Production**, add:
- Name: `INGEST_SECRET`
- Value: a long random string (generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"`)
- Type: **Secret**

Save it locally too (you will need it for tests), in PowerShell:

```powershell
$env:INGEST_SECRET = "<the same value>"
$env:RAG_BASE_URL = "https://meritsofmath.pages.dev"
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_rag_status.py`:

```python
import os
import requests

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]


def _post(path, body=None, token=SECRET):
    return requests.post(
        f"{BASE}{path}",
        json=body or {},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )


def test_requires_auth():
    r = _post("/api/rag-status", token="wrong-token")
    assert r.status_code == 401


def test_reports_embedding_dimension():
    r = _post("/api/rag-status")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["embeddingModel"] == "@cf/baai/bge-m3"
    assert isinstance(data["embeddingDim"], int)
    assert data["embeddingDim"] > 0
    print("EMBEDDING DIMENSION:", data["embeddingDim"])
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest tests/test_rag_status.py -v -s`
Expected: FAIL — the endpoint does not exist yet (404, so the 200 assertion fails).

- [ ] **Step 4: Write the shared helper module**

Create `functions/api/_rag.js`. The leading underscore matters: Cloudflare Pages routes every
file under `functions/`, except those whose name starts with `_`. This file is shared code, not
an endpoint.

```js
// Shared helpers for the RAG endpoints. Not a route (leading underscore).
// Both ingestion and query embed through embed() so index-time and query-time
// vectors can never come from different models or pooling settings.

export const EMBEDDING_MODEL = '@cf/baai/bge-m3';

export function authorized(request, env) {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return Boolean(env.INGEST_SECRET) && token === env.INGEST_SECRET;
}

export async function embed(env, texts) {
    const out = await env.AI.run(EMBEDDING_MODEL, { text: texts });
    const vectors = out && out.data;
    if (!Array.isArray(vectors) || vectors.length === 0) {
        throw new Error('Embedding model returned no vectors');
    }
    return vectors;
}

export function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
```

- [ ] **Step 5: Write the endpoint**

Create `functions/api/rag-status.js`:

```js
// Admin-only RAG diagnostics: reports the live embedding dimension and, once the
// Vectorize binding exists, the index description. Used to provision and debug the
// retrieval stack. Requires the INGEST_SECRET bearer token.

import { EMBEDDING_MODEL, authorized, embed, json } from './_rag.js';

export async function onRequestPost({ request, env }) {
    if (!authorized(request, env)) {
        return json({ error: 'Unauthorized' }, 401);
    }

    let embeddingDim = null;
    let embeddingError = null;
    try {
        const vectors = await embed(env, ['xin chao']);
        embeddingDim = vectors[0].length;
    } catch (e) {
        embeddingError = String(e && e.message);
    }

    let index = null;
    if (env.VECTORIZE) {
        try {
            index = await env.VECTORIZE.describe();
        } catch (e) {
            index = { error: String(e && e.message) };
        }
    }

    return json({
        embeddingModel: EMBEDDING_MODEL,
        embeddingDim,
        embeddingError,
        index
    });
}
```

- [ ] **Step 6: Deploy**

```bash
git add functions/api/_rag.js functions/api/rag-status.js tests/test_rag_status.py
git commit -m "feat(rag): add admin rag-status endpoint with embedding probe"
git push origin feat/socratic-rag-tutor
```

Then merge to `main` (or use the branch preview URL) so the endpoint is live, and wait for the Cloudflare build to finish.

- [ ] **Step 7: Run the test to verify it passes and record the dimension**

Run: `python -m pytest tests/test_rag_status.py -v -s`
Expected: 2 passed, and the output prints `EMBEDDING DIMENSION: <N>`.

**Write the printed number down — Task 3 requires it.** (Expected 1024 for bge-m3, but use the printed value, not this note.)

---

### Task 3: Provision the Vectorize index and binding

**Files:**
- Modify: `tests/test_rag_status.py` (add an index assertion)

**Interfaces:**
- Consumes: `embeddingDim` from Task 2.
- Produces: a bound `VECTORIZE` index named `merits-kb`, available as `env.VECTORIZE` to all functions. Tasks 4 and 5 depend on it.

- [ ] **Step 1: Create the index**

Generate a Cloudflare API token (dashboard → My Profile → API Tokens → Create Token → permission **Vectorize: Edit**), then in PowerShell (replace `<DIM>` with the number from Task 2, and fill in your account ID and token):

```powershell
$env:CF_ACCOUNT_ID = "<your account id>"
$env:CF_API_TOKEN  = "<your vectorize token>"

$body = '{"name":"merits-kb","description":"Grade 1-5 math KB","config":{"dimensions":<DIM>,"metric":"cosine"}}'
Invoke-RestMethod -Method POST `
  -Uri "https://api.cloudflare.com/client/v4/accounts/$env:CF_ACCOUNT_ID/vectorize/v2/indexes" `
  -Headers @{ Authorization = "Bearer $env:CF_API_TOKEN" } `
  -ContentType "application/json" -Body $body
```

Expected: JSON with `"success": true`.

- [ ] **Step 2: Bind the index to the Pages project**

Cloudflare dashboard → Pages project → **Settings → Bindings → Add → Vectorize**:
- Variable name: `VECTORIZE`
- Index: `merits-kb`

Then **Deployments → ⋯ → Retry deployment** (bindings only apply to new builds).

- [ ] **Step 3: Write the failing assertion**

Append to `tests/test_rag_status.py`:

```python
def test_index_is_bound_with_matching_dimensions():
    r = _post("/api/rag-status")
    assert r.status_code == 200, r.text
    data = r.json()
    index = data["index"]
    assert index is not None, "VECTORIZE binding missing"
    assert "error" not in index, index
    assert index["dimensions"] == data["embeddingDim"]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_rag_status.py -v`
Expected: 3 passed. If `index` is `None`, the binding or the redeploy is missing.

- [ ] **Step 5: Commit**

```bash
git add tests/test_rag_status.py
git commit -m "test(rag): assert Vectorize index bound with matching dimensions"
```

---

### Task 4: `/api/ingest` — embed and upsert chunks

**Files:**
- Create: `functions/api/ingest.js`
- Test: `tests/test_ingest.py`

**Interfaces:**
- Consumes: `authorized`, `embed`, `json` from `functions/api/_rag.js`; `env.VECTORIZE`.
- Produces: `POST /api/ingest` with body `{ "chunks": [{ "id": str, "text": str, "metadata": object }] }` → `{ "upserted": number }`. Task 6 (uploader) calls this.

- [ ] **Step 1: Write the failing test**

Create `tests/test_ingest.py`:

```python
import os
import requests

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]

HEADERS = {"Authorization": f"Bearer {SECRET}"}

FIXTURE = [
    {
        "id": "test-doc:0000",
        "text": "Phep cong la khi ta gop hai nhom lai voi nhau. Vi du 2 + 3 = 5.",
        "metadata": {"doc_id": "test-doc", "section": "Phep cong", "chunk_index": 0},
    },
    {
        "id": "test-doc:0001",
        "text": "Phep tru la khi ta bot di mot so luong. Vi du 5 - 2 = 3.",
        "metadata": {"doc_id": "test-doc", "section": "Phep tru", "chunk_index": 1},
    },
]


def test_requires_auth():
    r = requests.post(f"{BASE}/api/ingest", json={"chunks": FIXTURE},
                      headers={"Authorization": "Bearer nope"}, timeout=60)
    assert r.status_code == 401


def test_rejects_empty_chunks():
    r = requests.post(f"{BASE}/api/ingest", json={"chunks": []},
                      headers=HEADERS, timeout=60)
    assert r.status_code == 400


def test_upserts_chunks():
    r = requests.post(f"{BASE}/api/ingest", json={"chunks": FIXTURE},
                      headers=HEADERS, timeout=120)
    assert r.status_code == 200, r.text
    assert r.json()["upserted"] == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_ingest.py -v`
Expected: FAIL — endpoint does not exist.

- [ ] **Step 3: Write the implementation**

Create `functions/api/ingest.js`:

```js
// Admin-only ingestion: embeds chunks with Workers AI and upserts them into Vectorize.
// Index-time embeddings deliberately share the same helper as query-time embeddings
// (see rag-status.js) so the two can never drift apart.

import { authorized, embed, json } from './_rag.js';

const MAX_CHUNKS_PER_REQUEST = 50;
const MAX_TEXT_CHARS = 1200;

export async function onRequestPost({ request, env }) {
    if (!authorized(request, env)) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!env.VECTORIZE) {
        return json({ error: 'VECTORIZE binding is not configured' }, 500);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const chunks = Array.isArray(body.chunks) ? body.chunks : [];
    if (chunks.length === 0) {
        return json({ error: 'chunks[] is required and must not be empty' }, 400);
    }
    if (chunks.length > MAX_CHUNKS_PER_REQUEST) {
        return json({ error: `Send at most ${MAX_CHUNKS_PER_REQUEST} chunks per request` }, 400);
    }
    for (const c of chunks) {
        if (!c || typeof c.id !== 'string' || typeof c.text !== 'string' || !c.text.trim()) {
            return json({ error: 'Each chunk needs a string id and non-empty text' }, 400);
        }
        if (c.text.length > MAX_TEXT_CHARS) {
            return json({ error: `Chunk ${c.id} exceeds ${MAX_TEXT_CHARS} characters` }, 400);
        }
    }

    let vectors;
    try {
        vectors = await embed(env, chunks.map((c) => c.text));
    } catch (e) {
        return json({ error: `Embedding failed: ${String(e && e.message)}` }, 502);
    }

    const records = chunks.map((c, i) => ({
        id: c.id,
        values: vectors[i],
        // The chunk text rides along in metadata so retrieval can return it without a
        // separate document store. Stays well under Vectorize's 10 KiB metadata limit.
        metadata: { ...(c.metadata || {}), text: c.text }
    }));

    try {
        await env.VECTORIZE.upsert(records);
    } catch (e) {
        return json({ error: `Upsert failed: ${String(e && e.message)}` }, 502);
    }

    return json({ upserted: records.length });
}
```

- [ ] **Step 4: Deploy**

```bash
git add functions/api/ingest.js tests/test_ingest.py
git commit -m "feat(rag): add admin ingest endpoint (embed + upsert)"
git push origin feat/socratic-rag-tutor
```

Merge to `main` (or use the preview URL) and wait for the build.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_ingest.py -v`
Expected: 3 passed.

---

### Task 5: `/api/retrieve` — semantic search over the index

**Files:**
- Create: `functions/api/retrieve.js`
- Test: `tests/test_retrieve.py`

**Interfaces:**
- Consumes: `authorized`, `embed`, `json` from `functions/api/_rag.js`; `env.VECTORIZE`; chunks upserted by Task 4.
- Produces: `POST /api/retrieve` with body `{ "query": str, "topK": int }` → `{ "matches": [{ "id": str, "score": number, "text": str, "section": str, "doc_id": str }] }`. Task 7 (evals) and Plan 2 (chat) consume this shape.

- [ ] **Step 1: Write the failing test**

Create `tests/test_retrieve.py`:

```python
import os
import requests

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]
HEADERS = {"Authorization": f"Bearer {SECRET}"}


def _retrieve(query, top_k=3):
    r = requests.post(f"{BASE}/api/retrieve", json={"query": query, "topK": top_k},
                      headers=HEADERS, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()["matches"]


def test_requires_auth():
    r = requests.post(f"{BASE}/api/retrieve", json={"query": "phep cong"},
                      headers={"Authorization": "Bearer nope"}, timeout=60)
    assert r.status_code == 401


def test_rejects_empty_query():
    r = requests.post(f"{BASE}/api/retrieve", json={"query": "  "},
                      headers=HEADERS, timeout=60)
    assert r.status_code == 400


def test_finds_the_addition_chunk_for_an_addition_question():
    matches = _retrieve("Phep cong la gi?", top_k=2)
    assert len(matches) > 0
    top = matches[0]
    assert top["id"] == "test-doc:0000", matches
    assert "cong" in top["text"].lower()
    assert isinstance(top["score"], float)


def test_finds_the_subtraction_chunk_for_a_subtraction_question():
    matches = _retrieve("Lam sao de bot di mot so luong?", top_k=2)
    assert matches[0]["id"] == "test-doc:0001", matches
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_retrieve.py -v`
Expected: FAIL — endpoint does not exist.

- [ ] **Step 3: Write the implementation**

Create `functions/api/retrieve.js`:

```js
// Admin-only semantic retrieval over the Vectorize index. Kept separate from chat so
// retrieval quality can be tested and evaluated on its own. Plan 2's chat endpoint will
// perform retrieval internally rather than calling this over HTTP.

import { authorized, embed, json } from './_rag.js';

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

export async function onRequestPost({ request, env }) {
    if (!authorized(request, env)) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!env.VECTORIZE) {
        return json({ error: 'VECTORIZE binding is not configured' }, 500);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
        return json({ error: 'query is required' }, 400);
    }
    const topK = Math.min(Number(body.topK) || DEFAULT_TOP_K, MAX_TOP_K);

    let queryVector;
    try {
        const vectors = await embed(env, [query]);
        queryVector = vectors[0];
    } catch (e) {
        return json({ error: `Embedding failed: ${String(e && e.message)}` }, 502);
    }

    let result;
    try {
        result = await env.VECTORIZE.query(queryVector, {
            topK,
            returnMetadata: 'all'
        });
    } catch (e) {
        return json({ error: `Query failed: ${String(e && e.message)}` }, 502);
    }

    const matches = (result.matches || []).map((m) => ({
        id: m.id,
        score: m.score,
        text: (m.metadata && m.metadata.text) || '',
        section: (m.metadata && m.metadata.section) || '',
        doc_id: (m.metadata && m.metadata.doc_id) || ''
    }));

    return json({ matches });
}
```

- [ ] **Step 4: Deploy**

```bash
git add functions/api/retrieve.js tests/test_retrieve.py
git commit -m "feat(rag): add admin retrieve endpoint (semantic search)"
git push origin feat/socratic-rag-tutor
```

Merge to `main` (or use the preview URL) and wait for the build.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_retrieve.py -v`
Expected: 4 passed.

**This is the first proof the whole stack works:** a Vietnamese question returns the semantically correct chunk. If the two semantic tests fail while auth tests pass, the embedding model is not handling Vietnamese well — stop and reconsider the model (see Task 9's note).

---

### Task 6: Python uploader — Markdown file to ingested chunks

**Files:**
- Create: `scripts/rag/upload.py`
- Create: `content/grade1/phep-cong-trong-pham-vi-10.md`
- Test: `tests/test_upload.py`

**Interfaces:**
- Consumes: `chunk_markdown` (Task 1); `POST /api/ingest` (Task 4).
- Produces: `upload_markdown_file(path: str, base_url: str, secret: str, doc_id: str | None = None) -> int` returning the number of chunks upserted. Task 9 calls this.

- [ ] **Step 1: Create a small real content file**

Create `content/grade1/phep-cong-trong-pham-vi-10.md`:

```markdown
# Phép cộng trong phạm vi 10

Phép cộng là khi ta gộp hai nhóm đồ vật lại với nhau để đếm tổng số.

Ví dụ: Em có 2 quả táo, mẹ cho thêm 3 quả nữa. Tất cả em có 2 + 3 = 5 quả táo.

## Cách đếm để cộng

Khi cộng, em có thể đếm tiếp từ số lớn hơn. Với 2 + 3, em bắt đầu từ 3 rồi đếm thêm 2 bước: 4, 5. Kết quả là 5.

## Luyện tập

Tính 4 + 1. Em hãy đếm tiếp từ 4 thêm một bước.

Tính 5 + 2. Em hãy đếm tiếp từ 5 thêm hai bước.
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_upload.py`:

```python
import os
from scripts.rag.upload import upload_markdown_file

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]


def test_uploads_a_markdown_file():
    count = upload_markdown_file(
        "content/grade1/phep-cong-trong-pham-vi-10.md",
        base_url=BASE,
        secret=SECRET,
    )
    assert count > 0
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest tests/test_upload.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.rag.upload'`

- [ ] **Step 4: Write the implementation**

Create `scripts/rag/upload.py`:

```python
"""Chunk a reviewed Markdown file and push it to the /api/ingest endpoint."""

import os
import pathlib
import sys

import requests

from scripts.rag.chunker import chunk_markdown

BATCH_SIZE = 25


def upload_markdown_file(path: str, base_url: str, secret: str,
                         doc_id: str | None = None) -> int:
    """Upload one Markdown file. Returns the number of chunks upserted."""
    file_path = pathlib.Path(path)
    md = file_path.read_text(encoding="utf-8")
    doc_id = doc_id or file_path.stem

    chunks = chunk_markdown(md, doc_id=doc_id)
    if not chunks:
        return 0

    headers = {"Authorization": f"Bearer {secret}"}
    total = 0
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        response = requests.post(
            f"{base_url}/api/ingest",
            json={"chunks": batch},
            headers=headers,
            timeout=180,
        )
        response.raise_for_status()
        total += response.json()["upserted"]
    return total


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.rag.upload <markdown-file> [more-files...]")
        raise SystemExit(2)
    base_url = os.environ["RAG_BASE_URL"]
    secret = os.environ["INGEST_SECRET"]
    grand_total = 0
    for path in sys.argv[1:]:
        count = upload_markdown_file(path, base_url=base_url, secret=secret)
        print(f"{path}: {count} chunks")
        grand_total += count
    print(f"TOTAL: {grand_total} chunks")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest tests/test_upload.py -v`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add scripts/rag/upload.py content/grade1/phep-cong-trong-pham-vi-10.md tests/test_upload.py
git commit -m "feat(rag): add Markdown uploader and first Grade 1 content"
```

---

### Task 7: Retrieval quality eval harness

A fixed set of realistic Vietnamese questions with expected source documents. This is the guardrail that tells you whether a model or chunking change made retrieval better or worse.

**Files:**
- Create: `tests/evals/retrieval_cases.json`
- Test: `tests/test_retrieval_eval.py`

**Interfaces:**
- Consumes: `POST /api/retrieve` (Task 5); content uploaded in Task 6.
- Produces: a repeatable pass/fail retrieval quality gate. No code consumed by later tasks.

- [ ] **Step 1: Create the eval cases**

Create `tests/evals/retrieval_cases.json`:

```json
[
  {
    "query": "Phép cộng là gì?",
    "expect_doc_id": "phep-cong-trong-pham-vi-10"
  },
  {
    "query": "Làm sao để đếm tiếp khi cộng hai số?",
    "expect_doc_id": "phep-cong-trong-pham-vi-10"
  },
  {
    "query": "Em có 2 quả táo và được cho thêm 3 quả, tất cả là mấy quả?",
    "expect_doc_id": "phep-cong-trong-pham-vi-10"
  }
]
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_retrieval_eval.py`:

```python
import json
import os
import pathlib

import pytest
import requests

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]

CASES = json.loads(
    pathlib.Path("tests/evals/retrieval_cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=[c["query"] for c in CASES])
def test_expected_document_is_retrieved(case):
    response = requests.post(
        f"{BASE}/api/retrieve",
        json={"query": case["query"], "topK": 3},
        headers={"Authorization": f"Bearer {SECRET}"},
        timeout=60,
    )
    assert response.status_code == 200, response.text
    matches = response.json()["matches"]
    assert matches, "no matches returned"
    doc_ids = [m["doc_id"] for m in matches]
    assert case["expect_doc_id"] in doc_ids, (
        f"expected {case['expect_doc_id']} in top-3, got {doc_ids}"
    )
```

- [ ] **Step 3: Run the eval to verify it passes**

Run: `python -m pytest tests/test_retrieval_eval.py -v`
Expected: 3 passed. (This runs against content already uploaded in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add tests/evals/retrieval_cases.json tests/test_retrieval_eval.py
git commit -m "test(rag): add retrieval quality eval harness"
```

---

### Task 8: PDF to Markdown converter (vision LLM)

The one step with an external, fuzzy dependency. It is build-time only and its output is reviewed by a human before ingestion.

**Files:**
- Create: `scripts/rag/convert.py`
- Test: `tests/test_convert.py`

**Interfaces:**
- Consumes: `pymupdf`; OpenRouter API (env `OPENROUTER_API_KEY`, `OPENROUTER_VISION_MODEL`).
- Produces: `render_page_png(pdf_path: str, page_number: int, zoom: float = 2.0) -> bytes` and
  `convert_pdf_to_markdown(pdf_path: str, out_path: str, first_page: int = 0, last_page: int | None = None) -> str`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_convert.py`:

```python
import pathlib

import fitz  # pymupdf
import pytest

from scripts.rag.convert import render_page_png


@pytest.fixture
def tiny_pdf(tmp_path) -> str:
    """Create a one-page PDF so the renderer can be tested without real material."""
    path = tmp_path / "tiny.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "2 + 3 = 5")
    doc.save(str(path))
    doc.close()
    return str(path)


def test_renders_a_page_to_png_bytes(tiny_pdf):
    png = render_page_png(tiny_pdf, page_number=0)
    assert isinstance(png, bytes)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(png) > 1000


def test_rejects_out_of_range_page(tiny_pdf):
    with pytest.raises(IndexError):
        render_page_png(tiny_pdf, page_number=5)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_convert.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.rag.convert'`

- [ ] **Step 3: Write the implementation**

Create `scripts/rag/convert.py`:

```python
"""Convert source PDFs into clean Markdown using a vision LLM.

Build-time only. Output is written to content/ for human review before ingestion.
Vision transcription is used instead of OCR because it preserves mathematical
structure (fractions, exponents) that OCR mangles.
"""

import base64
import os
import pathlib
import sys

import fitz  # pymupdf
import requests

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-001"

PROMPT = (
    "Transcribe this textbook page into clean Markdown. Rules: "
    "keep the original Vietnamese text exactly; use # and ## for headings; "
    "write every mathematical expression in LaTeX between \\( and \\); "
    "ignore page numbers, headers, and decorative images; "
    "output only the Markdown, with no commentary."
)


def render_page_png(pdf_path: str, page_number: int, zoom: float = 2.0) -> bytes:
    """Render one PDF page to PNG bytes. Raises IndexError if the page is missing."""
    with fitz.open(pdf_path) as doc:
        if page_number < 0 or page_number >= doc.page_count:
            raise IndexError(f"page {page_number} out of range (0..{doc.page_count - 1})")
        page = doc.load_page(page_number)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        return pixmap.tobytes("png")


def transcribe_png(png: bytes) -> str:
    """Send one page image to the vision model and return Markdown."""
    api_key = os.environ["OPENROUTER_API_KEY"]
    model = os.environ.get("OPENROUTER_VISION_MODEL", DEFAULT_VISION_MODEL)
    data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")

    response = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            "temperature": 0,
        },
        timeout=180,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def convert_pdf_to_markdown(pdf_path: str, out_path: str, first_page: int = 0,
                            last_page: int | None = None) -> str:
    """Convert a page range to Markdown and write it to out_path."""
    with fitz.open(pdf_path) as doc:
        total = doc.page_count
    end = total - 1 if last_page is None else min(last_page, total - 1)

    parts: list[str] = []
    for page_number in range(first_page, end + 1):
        print(f"  page {page_number + 1}/{end + 1}...", flush=True)
        png = render_page_png(pdf_path, page_number)
        parts.append(transcribe_png(png))

    markdown = "\n\n".join(p for p in parts if p)
    out = pathlib.Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(markdown, encoding="utf-8")
    return markdown


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python -m scripts.rag.convert <input.pdf> <output.md> "
              "[first_page] [last_page]")
        raise SystemExit(2)
    pdf_path, out_path = sys.argv[1], sys.argv[2]
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    last = int(sys.argv[4]) if len(sys.argv) > 4 else None
    convert_pdf_to_markdown(pdf_path, out_path, first_page=first, last_page=last)
    print(f"Wrote {out_path} — review it before uploading.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_convert.py -v`
Expected: 2 passed. (These test rendering only; transcription is exercised for real in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add scripts/rag/convert.py tests/test_convert.py
git commit -m "feat(rag): add PDF-to-Markdown vision converter"
```

---

### Task 9: Ingest one real Grade 1–5 chapter end to end

**Files:**
- Create: `content/<grade>/<chapter-slug>.md` (generated, then hand-reviewed)
- Modify: `tests/evals/retrieval_cases.json` (add cases for the real chapter)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a populated knowledge base and a passing eval suite. Plan 2 (chat) builds on this.

- [ ] **Step 1: Set the conversion credentials**

```powershell
$env:OPENROUTER_API_KEY = "<your OpenRouter key>"
```

- [ ] **Step 2: Convert a short page range first**

Pick one chapter from a Grade 1–5 textbook PDF and convert only its first 3 pages:

Run: `python -m scripts.rag.convert "<path-to-textbook.pdf>" content/grade1/chapter.md 0 2`
Expected: `content/grade1/chapter.md` is written.

- [ ] **Step 3: Review the Markdown by hand**

Open `content/grade1/chapter.md` and check: Vietnamese diacritics intact, headings sensible, formulas in `\( ... \)`, no page numbers or junk. Fix anything wrong directly in the file.

**Gate:** if formulas are badly mangled, stop and try a different `OPENROUTER_VISION_MODEL` before converting more pages.

- [ ] **Step 4: Convert the rest of the chapter**

Run: `python -m scripts.rag.convert "<path-to-textbook.pdf>" content/grade1/chapter.md 0 <last-page>`
Then review the file again.

- [ ] **Step 5: Upload the chapter**

Run: `python -m scripts.rag.upload content/grade1/chapter.md`
Expected: prints the chunk count and `TOTAL: <n> chunks`.

- [ ] **Step 6: Add eval cases for the real chapter**

Add three entries to `tests/evals/retrieval_cases.json` using questions a Grade 1–5 student would actually ask about this chapter, each with `expect_doc_id` set to `chapter` (the filename stem). Example shape:

```json
  {
    "query": "<a real question about this chapter>",
    "expect_doc_id": "chapter"
  }
```

- [ ] **Step 7: Run the full test suite**

Run: `python -m pytest tests -v`
Expected: all tests pass, including the new eval cases.

- [ ] **Step 8: Commit**

```bash
git add content tests/evals/retrieval_cases.json
git commit -m "feat(rag): ingest first Grade 1-5 chapter and extend retrieval evals"
git push origin feat/socratic-rag-tutor
```

---

## Definition of done

- `python -m pytest tests -v` passes end to end.
- `/api/retrieve` returns relevant Grade 1–5 chunks for real Vietnamese questions.
- The existing app at meritsofmath.pages.dev still works, untouched.
- Follow-up: **Plan 2 — chat experience** (retrieval inside `/api/chat`, Socratic grounding prompt, retire the game, minimal chat frontend).
