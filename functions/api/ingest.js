// Admin-only ingestion: embeds chunks with Workers AI and upserts them into Vectorize.
// Index-time embeddings deliberately share the same helper as query-time embeddings
// (see rag-status.js) so the two can never drift apart.

import { authFailure, embed, json } from './_rag.js';

const MAX_CHUNKS_PER_REQUEST = 50;
const MAX_TEXT_CHARS = 1200;

export async function onRequestPost({ request, env }) {
    const denied = authFailure(request, env);
    if (denied) return denied;

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
