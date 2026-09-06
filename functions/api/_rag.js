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
