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
//   OPENROUTER_API_KEY   OpenRouter key (free DeepSeek etc.)       https://openrouter.ai/keys
//   GEMINI_API_KEY       Google AI Studio key (biggest free tier)  https://aistudio.google.com/apikey
// Optional overrides:
//   GROQ_MODEL / OPENROUTER_MODEL / GEMINI_MODEL   pin a different model per provider
//   PROVIDER_ORDER   comma list, e.g. "groq,gemini,openrouter" (default: gemini,openrouter,groq
//                    — reliable + big free limit first, then smartest backup, then fast fallback)
//   ALLOWED_ORIGIN   e.g. https://meritsofmath.pages.dev — soft-blocks other origins

const MAX_TOKENS_CAP = 300;   // hard ceiling so a leaked endpoint can't run up huge bills
const MAX_MESSAGES = 40;      // cap conversation size per request

// Each provider exposes an OpenAI-compatible /chat/completions endpoint, so the response
// shape ({ choices:[{ message:{ content }}] }) is identical and passes straight through.
const PROVIDERS = {
    groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        keyEnv: 'GROQ_API_KEY',
        model: (env) => env.GROQ_MODEL || 'llama-3.1-8b-instant'
    },
    openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        keyEnv: 'OPENROUTER_API_KEY',
        // Free DeepSeek chat (not the R1 reasoning model — this one is faster and doesn't
        // emit <think> blocks, which suits the Socratic tutor better).
        model: (env) => env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3-0324:free'
    },
    gemini: {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        keyEnv: 'GEMINI_API_KEY',
        model: (env) => env.GEMINI_MODEL || 'gemini-2.0-flash'
    }
};

// Groq (llama-3.3-70b) is the reliable primary; OpenRouter (DeepSeek V3) is the backup.
// Gemini is intentionally out of the default — add it back via PROVIDER_ORDER if its free
// tier works for your account/region.
const DEFAULT_ORDER = ['groq', 'openrouter'];

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

    // Build the provider try-order: honor PROVIDER_ORDER, else default; then keep only
    // providers that actually have a key configured. Optional ?provider= forces one (debug).
    const url = new URL(request.url);
    const forced = url.searchParams.get('provider');
    let order = (env.PROVIDER_ORDER ? env.PROVIDER_ORDER.split(',') : DEFAULT_ORDER)
        .map((n) => n.trim())
        .filter((n) => PROVIDERS[n]);
    if (forced && PROVIDERS[forced]) order = [forced];
    order = order.filter((n) => env[PROVIDERS[n].keyEnv]);

    if (order.length === 0) {
        return json({ error: { message: 'No AI provider is configured on the server (set at least one *_API_KEY).' } }, 500);
    }

    let lastError = { status: 502, message: 'All providers failed' };

    for (const name of order) {
        const p = PROVIDERS[name];
        const payload = { model: p.model(env), messages, temperature, max_tokens: maxTokens };
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env[p.keyEnv]}`
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
                headers: { 'Content-Type': 'application/json', 'X-AI-Provider': name }
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

    // All providers failed. Show students a calm message; keep the technical detail in a
    // header (and Cloudflare logs) for debugging instead of dumping raw quota/billing errors.
    return new Response(
        JSON.stringify({ error: { message: 'The tutor is busy right now. Please wait a moment and try again.' } }),
        {
            status: 503,
            headers: {
                'Content-Type': 'application/json',
                'X-AI-Error': String(lastError.message).slice(0, 300)
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
