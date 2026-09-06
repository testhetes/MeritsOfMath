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
