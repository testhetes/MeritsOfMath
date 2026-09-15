// Cloudflare Pages Function — serves at /api/chat
//
// Holds AI provider keys server-side so the browser never sees them. The chat frontend
// (js/chat.js) POSTs an OpenAI-style { messages, max_tokens } body plus `ground` and `lang`;
// this function injects the right key, pins the model, and forwards it. With `ground: true`
// it first retrieves curriculum context and builds the Socratic system prompt server-side.
//
// MULTI-PROVIDER WITH FALLBACK: it tries providers in order and, if one is rate-limited
// (429) or erroring (5xx / network), falls through to the next. Only providers whose key
// is configured are attempted — so with just GROQ_API_KEY set it behaves as a plain Groq
// proxy; add more keys to stack free tiers for more effective capacity.
//
// Env vars (set in Cloudflare Pages → Settings → Environment variables, mark secret):
//   GROQ_API_KEY         Groq key (gsk_...)                        https://console.groq.com
//   OPENROUTER_API_KEY   OpenRouter key                            https://openrouter.ai/keys
//   GEMINI_API_KEY       Google AI Studio key                      https://aistudio.google.com/apikey
// Bindings (Pages project → Settings → Bindings):
//   AI                   Workers AI: the embeddings used for grounding, and the "workersai"
//                        provider — Llama 3.3 70B on your own Cloudflare account's daily
//                        allowance (not shared with other users), second in the default order.
//   VECTORIZE            the merits-kb index searched for grounding. Without it (or AI), a
//                        grounded request still answers, ungrounded, with X-RAG-Error set.
// Optional overrides:
//   GROQ_MODEL / OPENROUTER_MODEL / GEMINI_MODEL / WORKERSAI_MODEL   emergency use only: the
//                    defaults below are the source of truth, and a stale GROQ_MODEL once kept
//                    a retired model in place after the default was updated. Remove after use.
//   PROVIDER_ORDER   preferred comma list (default: groq,workersai,openrouter); configured
//                    providers not listed are auto-appended as last resorts
//   ALLOWED_ORIGIN   e.g. https://meritsofmath.pages.dev — soft-blocks other origins

import { search } from './_rag.js';

// Retrieval tuning. MIN_SCORE is a GARBAGE FILTER, not a relevance gate — it sits below
// every genuine retrieval that was measured (accented positives 0.442-0.723, unaccented
// 0.347-0.572) because the negative population (0.347-0.505) OVERLAPS the positive one.
// No cosine threshold separates them on this index, so raising this number does not buy
// precision; it just switches grounding off for children who type without diacritics.
// Relevance comes from buildRetrievalQuery() below and from the prompt's instruction to
// ignore reference that does not fit. See tests/test_retrieval_eval.py for the full
// distribution and the test that fails if anyone reintroduces a separating-floor assumption.
const RETRIEVAL_TOP_K = 5;
const MIN_SCORE = 0.30;
// Retrieval runs before the LLM call on every turn, so it adds directly to the student's
// wait. Past this budget we answer ungrounded rather than make a child stare at dots.
const RETRIEVAL_TIMEOUT_MS = 1800;

const MAX_TOKENS_CAP = 300;   // hard ceiling so a leaked endpoint can't run up huge bills
const MAX_MESSAGES = 40;      // cap conversation size per request

// HTTP providers expose an OpenAI-compatible /chat/completions endpoint, so the response
// shape ({ choices:[{ message:{ content }}] }) is identical and passes straight through.
// "workersai" is different: it runs on Cloudflare's own GPUs via the AI binding (env.AI),
// no external API involved, and its response is normalized to the same shape below.
const PROVIDERS = {
    groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        available: (env) => !!env.GROQ_API_KEY,
        key: (env) => env.GROQ_API_KEY,
        // Groq retired llama-3.3-70b-versatile for free/developer tiers on 2026-08-16.
        // Qwen 3.6 27B is its recommended replacement. It is a Preview model — the class
        // Groq retires at short notice — so tests/test_chat_providers.py forces this
        // provider and fails the day it disappears.
        model: (env) => env.GROQ_MODEL || 'qwen/qwen3.6-27b'
    },
    openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        available: (env) => !!env.OPENROUTER_API_KEY,
        key: (env) => env.OPENROUTER_API_KEY,
        // A different model family from the Groq primary (Qwen), so fallback replies can differ
        // in style. NOTE: OpenRouter :free models are shared capacity and often rate-limited; treat this as
        // a best-effort last layer. If the slug 404s ("paid version available"), pick a
        // current :free model from https://openrouter.ai/models and set OPENROUTER_MODEL.
        model: (env) => env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'
    },
    gemini: {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        available: (env) => !!env.GEMINI_API_KEY,
        key: (env) => env.GEMINI_API_KEY,
        model: (env) => env.GEMINI_MODEL || 'gemini-2.0-flash'
    },
    workersai: {
        binding: true,
        available: (env) => !!env.AI,
        // Llama 3.3 70B (a different family from the Qwen primary), served from this Cloudflare
        // account's own daily allowance — not shared with strangers, so it's the most
        // predictable layer in the chain.
        model: (env) => env.WORKERSAI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    }
};

// Groq is the fast primary. Workers AI comes SECOND: it runs on this account's own
// allowance (nobody else's traffic can exhaust it), so when Groq blips — which happens
// per-IP at busy Cloudflare edges, i.e. exactly when "other devices" report failures —
// the dependable layer catches it immediately instead of after a doomed hop through
// OpenRouter's often-rate-limited shared pool. Gemini is not in the default order: setting
// GEMINI_API_KEY appends it after the others as a last resort (see the auto-append in
// onRequestPost), and listing it in PROVIDER_ORDER tries it earlier.
const DEFAULT_ORDER = ['groq', 'workersai', 'openrouter'];

export async function onRequestPost({ request, env }) {
    // Soft origin check — cheap abuse deterrent, not real auth.
    const allowed = env.ALLOWED_ORIGIN;
    const origin = request.headers.get('Origin');
    if (allowed && origin && origin !== allowed) {
        return json({ error: { message: 'Origin not allowed' } }, 403);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    let messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0) {
        return json({ error: { message: 'messages[] is required' } }, 400);
    }
    // Cap conversation size, but always keep a leading system prompt — it carries the
    // Socratic rules and the answer target, so dropping it would quietly wreck tutoring.
    if (messages.length > MAX_MESSAGES) {
        const head = messages[0].role === 'system' ? [messages[0]] : [];
        messages = head.concat(messages.slice(messages.length - (MAX_MESSAGES - head.length)));
    }
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.1;
    const maxTokens = Math.min(Number(body.max_tokens) || 150, MAX_TOKENS_CAP);

    // Grounded mode: retrieve curriculum context and prepend our own Socratic system
    // prompt, replacing any the client sent. Opt-in via `ground`: the chat frontend always
    // sends it, and ungrounded requests (a client-supplied prompt) still work for API and
    // test callers.
    let ragChunkCount = null;
    let ragError = null;
    if (body.ground === true) {
        const { chunks, error } = await retrieveContext(env, buildRetrievalQuery(messages));
        ragChunkCount = chunks.length;
        ragError = error;
        const systemPrompt = buildSocraticPrompt(chunks, body.lang);
        messages = [{ role: 'system', content: systemPrompt }]
            .concat(messages.filter((m) => m && m.role !== 'system'));
    }

    // Build the provider try-order. PROVIDER_ORDER (or the default) is a PREFERENCE, not a
    // whitelist: any other provider that is configured gets appended as a last resort, so a
    // stale order env var can never silently exclude a working provider from the chain.
    // Optional ?provider= forces exactly one (debug).
    const url = new URL(request.url);
    const forced = url.searchParams.get('provider');
    let order = (env.PROVIDER_ORDER ? env.PROVIDER_ORDER.split(',') : DEFAULT_ORDER)
        .map((n) => n.trim())
        .filter((n) => PROVIDERS[n]);
    for (const name of Object.keys(PROVIDERS)) {
        if (!order.includes(name)) order.push(name);
    }
    if (forced && PROVIDERS[forced]) order = [forced];
    order = order.filter((n) => PROVIDERS[n].available(env));

    if (order.length === 0) {
        return json({ error: { message: 'No AI provider is configured on the server (set at least one *_API_KEY, or add the Workers AI binding).' } }, 500);
    }

    let lastError = { status: 502, message: 'All providers failed' };
    const chainHeader = order.join(',');

    // Up to two passes over the chain: per-minute rate limits are often gone within a
    // second or two, so one short-delay retry absorbs most transient blips server-side
    // instead of surfacing "tutor is busy" to the student.
    for (let pass = 0; pass < 2; pass++) {
        if (pass > 0) await new Promise((resolve) => setTimeout(resolve, 1300));

    for (const name of order) {
        const p = PROVIDERS[name];

        if (p.binding) {
            // Workers AI: runs on Cloudflare's GPUs via env.AI — no HTTP, no external key.
            try {
                const result = await env.AI.run(p.model(env), {
                    messages,
                    temperature,
                    max_tokens: maxTokens
                });
                // Normalize to the OpenAI response shape the frontend expects.
                return withRagHeaders(new Response(JSON.stringify({
                    model: p.model(env),
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: result.response || '' },
                        finish_reason: 'stop'
                    }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', 'X-AI-Provider': name, 'X-AI-Chain': chainHeader }
                }), ragChunkCount, ragError);
            } catch (e) {
                lastError = { status: 502, message: `${name}: ${String(e && e.message).slice(0, 200)}` };
                continue; // try next provider
            }
        }

        const payload = { model: p.model(env), messages, temperature, max_tokens: maxTokens };
        // Qwen 3 models reason by default and put that reasoning inside <think> tags in
        // message.content. A 200 carrying a <think> monologue would reach the student,
        // and the fallback chain never reacts to a 200. reasoning_effort "none" stops
        // reasoning tokens entirely. reasoning_format "hidden" is NOT equivalent: it still
        // spends reasoning tokens against max_tokens, which yields empty replies.
        if (name === 'groq' && /^qwen\/qwen3/.test(payload.model)) {
            payload.reasoning_effort = 'none';
        }
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${p.key(env)}`
        };
        // OpenRouter uses these for attribution/ranking (optional).
        if (name === 'openrouter' && allowed) {
            headers['HTTP-Referer'] = allowed;
            headers['X-Title'] = 'Merits of Math';
        }

        let res;
        try {
            res = await fetch(p.url, { method: 'POST', headers, body: JSON.stringify(payload) });
        } catch {
            lastError = { status: 502, message: `${name}: network error` };
            continue; // try next provider
        }

        if (res.ok) {
            // Success — pass the provider's response straight through, tag which one served it.
            const text = await res.text();
            return withRagHeaders(new Response(text, {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'X-AI-Provider': name, 'X-AI-Chain': chainHeader }
            }), ragChunkCount, ragError);
        }

        // Rate-limited or server error → fall through to the next provider.
        // Other 4xx (bad key, bad request) also fall through but are recorded.
        const errText = await res.text().catch(() => '');
        lastError = { status: res.status, message: `${name}: ${res.status} ${errText.slice(0, 200)}` };
        if (res.status !== 429 && res.status < 500) {
            // Non-retryable config error for this provider; keep trying others but note it.
            continue;
        }
    }
    } // end retry passes

    // All providers failed twice. Show students a calm message; keep the technical detail in
    // headers (and Cloudflare logs) for debugging instead of dumping raw quota/billing errors.
    return withRagHeaders(new Response(
        JSON.stringify({ error: { message: 'The tutor is busy right now. Please wait a moment and try again.' } }),
        {
            status: 503,
            headers: {
                'Content-Type': 'application/json',
                'X-AI-Error': String(lastError.message).slice(0, 300),
                'X-AI-Chain': chainHeader
            }
        }
    ), ragChunkCount, ragError);
}

// Only POST is handled here. GET and HEAD fall through to the static site, which answers with
// the app page (Cloudflare Pages' single-page fallback); other methods such as OPTIONS and PUT
// get a 405 (measured with curl, 2026-09-15).

// Build the retrieval query from the last two student turns, not just the latest one.
// Most chat turns are short replies — "5", "em không biết", "dạ" — which retrieve nothing
// on their own, so grounding would flicker on and off mid-problem. Including the previous
// turn keeps the conversation anchored to the topic it started on.
function buildRetrievalQuery(messages) {
    return messages
        .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
        .slice(-2)
        .map((m) => m.content.trim())
        .filter(Boolean)
        .join('\n');
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Retrieval never throws into the request path. If embedding or Vectorize fails or is slow,
// the tutor answers ungrounded rather than showing the student an error — a slightly less
// informed reply beats no reply.
//
// Errors are reported as FIXED CODES, never as e.message. A raw message can contain CR/LF or
// non-Latin-1 characters, which make Headers.set() throw — so passing it through would turn a
// retrieval failure into a crash of the whole chat, the exact opposite of this function's job.
// It would also leak internal error text on a public endpoint.
async function retrieveContext(env, query) {
    // A missing binding is a misconfiguration, not an empty result. Report it, so a deploy
    // that silently lost its binding does not run ungrounded unnoticed.
    if (!env.VECTORIZE) {
        return { chunks: [], error: 'no_binding' };
    }
    if (typeof query !== 'string' || !query.trim()) {
        return { chunks: [], error: null };
    }
    try {
        const matches = await withTimeout(
            search(env, query, { topK: RETRIEVAL_TOP_K, minScore: MIN_SCORE }),
            RETRIEVAL_TIMEOUT_MS
        );
        const chunks = matches
            .map((m) => ({ text: m.text || '', section: m.section || '' }))
            .filter((c) => c.text);
        return { chunks, error: null };
    } catch (e) {
        return { chunks: [], error: e && e.name === 'TimeoutError' ? 'timeout' : 'retrieval_failed' };
    }
}

// The tutor's character. Built server-side so the "never reveal the answer" rule and the
// retrieved reference material stay out of the browser, where a curious student could
// read or edit them.
function buildSocraticPrompt(chunks, lang) {
    const language = lang === 'en' ? 'English' : 'Vietnamese';

    const lines = [
        'You are a warm, patient maths tutor for Vietnamese primary-school children (Grades 1 to 5).',
        `LANGUAGE: Write every word of your reply in ${language}. Keep numbers as digits.`,
        '',
        'HOW YOU TEACH:',
        '- You never state the final answer. Not when asked directly, not when the student says they give up, not "just this once".',
        '- Ask ONE short question at a time: the next small step, never the whole path.',
        '- Use words a child aged 6 to 11 knows. Short sentences, one idea each.',
        '- When the student is wrong, never say "wrong". Ask something that lets them notice it themselves.',
        '- When the student is right, say so warmly in a few words, then ask what comes next.',
        '- Use everyday things: sweets, apples, marbles, fingers, steps.',
        '- If the student is stuck twice on the same step, make the step smaller. Do not answer it for them.',
        '- Keep replies under about 60 words.',
        '- Write any maths in LaTeX between \\( and \\). Never use $ signs for maths.'
    ];

    // Vietnamese teacher-to-pupil register. Without an explicit rule, Qwen drifted between
    // "em" (correct for a teacher speaking to a child) and "bạn" (peer register) across
    // consecutive replies measured on 2026-09-13.
    if (lang !== 'en') {
        lines.push('- Speak like a Vietnamese primary-school teacher: call the student "em" and refer to yourself as "cô". Never call the student "bạn".');
    }

    // Maths delimiters matter for rendering, not just style. The chat frontend runs replies
    // through marked, and CommonMark treats \( and \[ as escaped brackets — so the frontend
    // has to protect maths before marked runs. The same model emitted both $...$ and \(...\)
    // in consecutive replies, so this rule narrows the output but the frontend must still
    // cope with either (see Task 3).

    if (chunks.length > 0) {
        lines.push(
            '',
            'REFERENCE MATERIAL (for your eyes only):',
            chunks.map((c, i) => `[${i + 1}] ${c.section ? c.section + ' — ' : ''}${c.text}`).join('\n\n'),
            '',
            'Use the reference to ask sharper questions and to recognise the mistakes it describes.',
            'NEVER quote it, never mention that you have it, and never read out a worked solution or a final answer from it.',
            'The reference is selected by similarity, so some or all of it may be about a DIFFERENT topic than the student asked about.',
            'Judge it yourself. If a passage does not fit the question, ignore that passage completely — do not stretch the conversation toward it, and do not steer the student to the topic it covers.',
            'It is always better to answer from your own knowledge of primary-school maths than to follow reference material that does not match what the student actually asked.'
        );
    }

    return lines.join('\n');
}

// Attaches retrieval diagnostics to whichever response the provider chain produced.
// null means grounding was not requested, so the header is omitted entirely.
function withRagHeaders(response, ragChunkCount, ragError) {
    if (ragChunkCount === null) return response;
    const headers = new Headers(response.headers);
    headers.set('X-RAG-Chunks', String(ragChunkCount));
    if (ragError) headers.set('X-RAG-Error', ragError);
    return new Response(response.body, { status: response.status, headers });
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
