// Shared helpers for the RAG endpoints. Not a route (leading underscore).
// Both ingestion and query embed through embed() so index-time and query-time
// vectors can never come from different models or pooling settings.

export const EMBEDDING_MODEL = '@cf/baai/bge-m3';

export function authorized(request, env) {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return Boolean(env.INGEST_SECRET) && token === env.INGEST_SECRET;
}

export function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

// Distinguishes a missing server-side secret (500, misconfiguration) from a
// wrong bearer token (401, client error) — from outside, authorized() alone
// makes those two cases indistinguishable, which cost hours of debugging.
export function authFailure(request, env) {
    if (!env.INGEST_SECRET) {
        return json({ error: 'INGEST_SECRET is not configured on the server' }, 500);
    }
    if (!authorized(request, env)) {
        return json({ error: 'Unauthorized' }, 401);
    }
    return null;
}

export async function embed(env, texts) {
    const out = await env.AI.run(EMBEDDING_MODEL, { text: texts });
    const vectors = out && out.data;
    if (!Array.isArray(vectors) || vectors.length === 0) {
        throw new Error('Embedding model returned no vectors');
    }
    // One vector per input text, in order — callers zip the two lists together
    // positionally (ingest.js pairs vectors[i] with chunks[i]). If the model
    // ever returned a different count, that zip would silently attach the
    // WRONG embedding to a chunk and corrupt the index in a way no later test
    // could detect. Fail loudly instead.
    if (vectors.length !== texts.length) {
        throw new Error(
            `Embedding model returned ${vectors.length} vectors for ` +
            `${texts.length} input texts`
        );
    }
    return vectors;
}

// --------------------------------------------------------------------------
// The single semantic search path.
//
// /api/retrieve (and therefore the retrieval eval) and Plan 2's chat endpoint
// both go through this function, so the eval measures exactly the code a
// student's question travels through. Anything that changes retrieval — the
// topK clamp, the score floor, the shape of a match — has to change here, once.
// --------------------------------------------------------------------------

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

// Errors carry a `stage` so callers can tell a missing binding from an
// embedding failure from a query failure without parsing message strings.
function stageError(stage, cause) {
    const error = new Error(String((cause && cause.message) || cause));
    error.stage = stage;
    return error;
}

export function clampTopK(value) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 1) return DEFAULT_TOP_K;
    return Math.min(n, MAX_TOP_K);
}

export async function search(env, query, options = {}) {
    if (!env.VECTORIZE) {
        throw stageError('binding', 'VECTORIZE binding is not configured');
    }

    const topK = clampTopK(options.topK);
    const minScore = typeof options.minScore === 'number' ? options.minScore : null;

    let queryVector;
    try {
        const vectors = await embed(env, [query]);
        queryVector = vectors[0];
    } catch (e) {
        throw stageError('embed', e);
    }

    let result;
    try {
        result = await env.VECTORIZE.query(queryVector, {
            topK,
            returnMetadata: 'all'
        });
    } catch (e) {
        throw stageError('query', e);
    }

    const matches = (result && result.matches) || [];
    return matches
        .filter((m) => minScore === null || m.score >= minScore)
        .map((m) => ({
            id: m.id,
            score: m.score,
            text: (m.metadata && m.metadata.text) || '',
            section: (m.metadata && m.metadata.section) || '',
            doc_id: (m.metadata && m.metadata.doc_id) || ''
        }));
}
