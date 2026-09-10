// Admin-only semantic retrieval over the Vectorize index. Kept separate from chat so
// retrieval quality can be tested and evaluated on its own. Plan 2's chat endpoint will
// perform retrieval internally rather than calling this over HTTP.

import { authFailure, embed, json } from './_rag.js';

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

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
