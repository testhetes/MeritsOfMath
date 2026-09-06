// Admin-only RAG diagnostics: reports the live embedding dimension and, once the
// Vectorize binding exists, the index description. Used to provision and debug the
// retrieval stack. Requires the INGEST_SECRET bearer token.

import { EMBEDDING_MODEL, authorized, embed, json } from './_rag.js';

async function fingerprint(s) {
    if (!s) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

export async function onRequestPost({ request, env }) {
    if (!authorized(request, env)) {
        const diag = {
            envKeys: Object.keys(env).sort(),
            secretConfigured: Boolean(env.INGEST_SECRET),
            secretLength: env.INGEST_SECRET ? env.INGEST_SECRET.length : 0,
            secretFingerprint: await fingerprint(env.INGEST_SECRET)
        };
        return json({ error: 'Unauthorized', diag }, 401);
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
