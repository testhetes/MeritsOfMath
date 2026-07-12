// Cloudflare Pages Function — serves at /api/chat
//
// Holds AI provider keys server-side so the browser never sees them. The frontend
// (js/aiTutor.js) POSTs an OpenAI-style { messages, temperature, max_tokens } body;
// this function injects the right key, pins the model, and forwards it.
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
// Bindings (Pages project → Settings → Bindings → Add → Workers AI, name it "AI"):
//   AI                   enables the "workersai" provider — Llama 70B running on your own
//                        Cloudflare account's daily allowance (not shared with other users,
//                        so it's the most predictable free layer; ideal last resort).
// Optional overrides:
//   GROQ_MODEL / OPENROUTER_MODEL / GEMINI_MODEL / WORKERSAI_MODEL   pin a different model
//   PROVIDER_ORDER   comma list (default: groq,openrouter,workersai)
//   ALLOWED_ORIGIN   e.g. https://meritsofmath.pages.dev — soft-blocks other origins

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
        model: (env) => env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    },
    openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        available: (env) => !!env.OPENROUTER_API_KEY,
        key: (env) => env.OPENROUTER_API_KEY,
        // Same model as the Groq primary, so fallback replies are indistinguishable. NOTE:
        // OpenRouter :free models are shared capacity and often rate-limited; treat this as
        // a best-effort middle layer. If the slug 404s ("paid version available"), pick a
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
        // Same Llama 70B family, served from this Cloudflare account's own daily allowance —
        // not shared with strangers, so it's the most predictable layer in the chain.
        model: (env) => env.WORKERSAI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    }
};

// Groq is the fast primary; OpenRouter is a best-effort middle layer (shared free pool);
// Workers AI is the dependable last resort on our own allowance. Gemini is out of the
// default — add it via PROVIDER_ORDER if its free tier works for your account/region.
const DEFAULT_ORDER = ['groq', 'openrouter', 'workersai'];

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
                return new Response(JSON.stringify({
                    model: p.model(env),
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: result.response || '' },
                        finish_reason: 'stop'
                    }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', 'X-AI-Provider': name, 'X-AI-Chain': chainHeader }
                });
            } catch (e) {
                lastError = { status: 502, message: `${name}: ${String(e && e.message).slice(0, 200)}` };
                continue; // try next provider
            }
        }

        const payload = { model: p.model(env), messages, temperature, max_tokens: maxTokens };
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
            return new Response(text, {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'X-AI-Provider': name, 'X-AI-Chain': chainHeader }
            });
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
    return new Response(
        JSON.stringify({ error: { message: 'The tutor is busy right now. Please wait a moment and try again.' } }),
        {
            status: 503,
            headers: {
                'Content-Type': 'application/json',
                'X-AI-Error': String(lastError.message).slice(0, 300),
                'X-AI-Chain': chainHeader
            }
        }
    );
}

// Non-POST methods receive Cloudflare's automatic 405 (no handler defined for them).

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
