// Admin-only semantic retrieval over the Vectorize index. Kept separate from chat so
// retrieval quality can be tested and evaluated on its own. Plan 2's chat endpoint
// performs retrieval internally via the SAME shared search() helper, so the eval that
// runs against this endpoint measures exactly the path a student's question takes.

import { authFailure, json, search } from './_rag.js';

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

    const query = typeof (body && body.query) === 'string' ? body.query.trim() : '';
    if (!query) {
        return json({ error: 'query is required' }, 400);
    }

    // minScore is deliberately NOT applied here. This endpoint reports what the
    // index actually returned, scores included, so the eval can measure the score
    // DISTRIBUTION and re-derive the chat's floor from it. Applying the floor here
    // would hide exactly the numbers the eval exists to observe.
    let matches;
    try {
        // topK is validated and clamped inside search() (1..MAX_TOP_K).
        matches = await search(env, query, { topK: body.topK });
    } catch (e) {
        if (e && e.stage === 'binding') {
            return json({ error: 'VECTORIZE binding is not configured' }, 500);
        }
        const label = e && e.stage === 'embed' ? 'Embedding' : 'Query';
        return json({ error: `${label} failed: ${String(e && e.message)}` }, 502);
    }

    return json({ matches });
}
