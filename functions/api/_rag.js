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
