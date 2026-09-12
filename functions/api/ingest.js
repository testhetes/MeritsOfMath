// Admin-only ingestion: embeds chunks with Workers AI and upserts them into Vectorize,
// and — via the optional delete_ids — removes vectors. Every write to the index goes
// through this one secret-gated endpoint.
//
// Index-time embeddings deliberately share the same helper as query-time embeddings
// (see rag-status.js) so the two can never drift apart.
//
// Both operations return Vectorize's mutationId. That id is the ONLY reliable signal
// that a write has actually been applied: Vectorize is eventually consistent, and
// vectorCount cannot detect a same-count re-upload (re-uploading a document whose
// chunk count is unchanged leaves the count identical, so a settle-wait that watches
// the count returns immediately and reads the OLD vectors). rag-status reports
// `processedUpToMutation`; a caller polls that until it reaches this id.

import { authFailure, embed, json } from './_rag.js';

const MAX_CHUNKS_PER_REQUEST = 50;
// Vectorize's own hard limit on deleteByIds, confirmed against the live index:
// 101 ids returns VECTOR_DELETE_ERROR 40007 "max id count is 100". Enforcing it
// here turns that into a clear 400 instead of a 502 raised from inside
// Vectorize. Callers pruning a wider range split it into batches of this size.
const MAX_DELETE_IDS_PER_REQUEST = 100;
const MAX_TEXT_CHARS = 1200;
// Vectorize caps a vector ID at 64 BYTES, not 64 characters. Chunk IDs are
// `{doc_id}:{chunk_index:04d}` and doc_ids are ASCII slugs today (longest is
// 39 bytes), but a Vietnamese-titled file would produce a multi-byte id where
// the character count understates the byte count. Measure bytes.
const MAX_ID_BYTES = 64;

const encoder = new TextEncoder();

function idByteLength(id) {
    return encoder.encode(id).length;
}

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

    const chunks = Array.isArray(body && body.chunks) ? body.chunks : [];
    const hasDeleteIds = body && body.delete_ids !== undefined;

    if (hasDeleteIds && !Array.isArray(body.delete_ids)) {
        return json({ error: 'delete_ids must be an array of strings' }, 400);
    }
    const deleteIds = hasDeleteIds ? body.delete_ids : [];
    if (hasDeleteIds) {
        if (deleteIds.length === 0) {
            return json({ error: 'delete_ids must not be empty when provided' }, 400);
        }
        if (deleteIds.length > MAX_DELETE_IDS_PER_REQUEST) {
            return json({
                error: `Send at most ${MAX_DELETE_IDS_PER_REQUEST} delete_ids per request`
            }, 400);
        }
        for (const id of deleteIds) {
            if (typeof id !== 'string' || !id.trim()) {
                return json({ error: 'Each delete_ids entry must be a non-blank string' }, 400);
            }
            if (idByteLength(id) > MAX_ID_BYTES) {
                return json({
                    error: `delete_ids entry exceeds Vectorize's ${MAX_ID_BYTES}-byte id limit`
                }, 400);
            }
        }
    }

    // chunks[] stays exactly as strict as before. It becomes optional ONLY when
    // delete_ids was supplied, so a delete-only request is possible; a request
    // with neither is still the same 400 it has always been.
    if (chunks.length === 0 && !hasDeleteIds) {
        return json({ error: 'chunks[] is required and must not be empty' }, 400);
    }
    if (chunks.length === 0 && hasDeleteIds) {
        // Delete-only request: skip embedding entirely.
        let deleteMutationId = null;
        try {
            const deleted = await env.VECTORIZE.deleteByIds(deleteIds);
            deleteMutationId = (deleted && deleted.mutationId) || null;
        } catch (e) {
            return json({ error: `Delete failed: ${String(e && e.message)}` }, 502);
        }
        return json({
            upserted: 0,
            mutationId: null,
            deleted: deleteIds.length,
            deleteMutationId
        });
    }
    if (chunks.length > MAX_CHUNKS_PER_REQUEST) {
        return json({ error: `Send at most ${MAX_CHUNKS_PER_REQUEST} chunks per request` }, 400);
    }
    const seenIds = new Set();
    for (const c of chunks) {
        if (!c || typeof c.id !== 'string' || typeof c.text !== 'string' || !c.text.trim()) {
            return json({ error: 'Each chunk needs a string id and non-empty text' }, 400);
        }
        if (!c.id.trim()) {
            return json({ error: 'Chunk id must not be blank' }, 400);
        }
        if (c.text.length > MAX_TEXT_CHARS) {
            return json({ error: `Chunk ${c.id} exceeds ${MAX_TEXT_CHARS} characters` }, 400);
        }
        if (idByteLength(c.id) > MAX_ID_BYTES) {
            return json({
                error: `Chunk id ${c.id} exceeds Vectorize's ${MAX_ID_BYTES}-byte id limit`
            }, 400);
        }
        // A batch containing the same id twice is an upsert racing itself: only
        // one of the two texts survives, chosen arbitrarily, and the caller is
        // told all n were upserted. Almost always a chunker bug. Reject it.
        if (seenIds.has(c.id)) {
            return json({ error: `Duplicate chunk id in this request: ${c.id}` }, 400);
        }
        seenIds.add(c.id);
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

    let mutationId = null;
    try {
        const upserted = await env.VECTORIZE.upsert(records);
        mutationId = (upserted && upserted.mutationId) || null;
    } catch (e) {
        return json({ error: `Upsert failed: ${String(e && e.message)}` }, 502);
    }

    // Deletions run AFTER the upsert so their mutationId is the later of the two.
    // processedUpToMutation is a watermark, so waiting on the later id implies the
    // upsert has been applied too.
    let deleteMutationId = null;
    if (deleteIds.length > 0) {
        try {
            const deleted = await env.VECTORIZE.deleteByIds(deleteIds);
            deleteMutationId = (deleted && deleted.mutationId) || null;
        } catch (e) {
            return json({ error: `Delete failed: ${String(e && e.message)}` }, 502);
        }
    }

    return json({
        upserted: records.length,
        mutationId,
        deleted: deleteIds.length,
        deleteMutationId
    });
}
