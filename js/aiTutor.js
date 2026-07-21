window.AiTutor = (function () {
    let cloudKey = localStorage.getItem('groqApiKey') || '';
    let localUrl = localStorage.getItem('localApiBaseUrl') || 'http://localhost:11434/v1';
    let localModel = localStorage.getItem('localModelName') || 'llama3';
    let activeProvider = localStorage.getItem('aiProvider') || 'cloud';

    // Same-origin serverless endpoint that holds the Groq key server-side (see functions/api/chat.js).
    // Used by default in cloud mode so students never need — or ever see — an API key.
    const PROXY_ENDPOINT = '/api/chat';
    const CLOUD_MODEL = 'llama-3.1-8b-instant';

    // Sets key parameters for cloud and local AI endpoints
    function setProviders(cloudParams, localParams) {
        if (cloudParams && cloudParams.key !== undefined) {
            cloudKey = cloudParams.key;
            localStorage.setItem('groqApiKey', cloudKey);
        }
        if (localParams) {
            if (localParams.url !== undefined) {
                localUrl = localParams.url;
                localStorage.setItem('localApiBaseUrl', localUrl);
            }
            if (localParams.model !== undefined) {
                localModel = localParams.model;
                localStorage.setItem('localModelName', localModel);
            }
        }
    }

    // Assigns the default active model provider choice
    function setProvider(provider) {
        activeProvider = provider;
        localStorage.setItem('aiProvider', provider);
    }

    // Resolves endpoint settings for the active API configuration
    function getActiveConfig() {
        if (activeProvider === 'local') {
            return { key: '', baseUrl: localUrl, model: localModel, isProxy: false };
        }
        // Power users / developers may supply their own key to hit Groq directly.
        if (cloudKey) {
            return { key: cloudKey, baseUrl: 'https://api.groq.com/openai/v1', model: CLOUD_MODEL, isProxy: false };
        }
        // Default hosted deployment: call the same-origin proxy, which injects the key server-side.
        return { key: '', baseUrl: PROXY_ENDPOINT, model: CLOUD_MODEL, isProxy: true };
    }

    // Compares student calculations to expected solutions utilizing mathematical equivalence
    function compareMath(input, expected) {
        if (!window.math) return false;

        function sanitize(val) {
            if (!val) return "";
            const computerMathMatch = val.match(/Computer-readable math:\s*(.*)/i);
            if (computerMathMatch) return computerMathMatch[1].trim();

            let s = val.toString()
                .replace(/Mathematical calculation:|Text explanation:|Computer-readable math:/gi, '')
                .replace(/\\/g, '')
                .replace(/[\$\(\)\{\}]/g, '')
                .trim();

            s = s.replace(/^(may be|maybe|it is|its|it's|is|the answer is|answer is|result is)\s+/i, '')
                .replace(/[?!.=,]+$/, '')
                .trim();
            return s;
        }

        try {
            const s1 = sanitize(input);
            const s2 = sanitize(expected);
            if (!s1 || !s2) return false;

            const v1 = window.math.evaluate(s1);
            const v2 = window.math.evaluate(s2);
            const n1 = (typeof v1 === 'number') ? v1 : (v1 && v1.valueOf ? v1.valueOf() : NaN);
            const n2 = (typeof v2 === 'number') ? v2 : (v2 && v2.valueOf ? v2.valueOf() : NaN);

            if (!isNaN(n1) && !isNaN(n2)) {
                return Math.abs(n1 - n2) < 0.0001;
            }
        } catch (e) {
            console.warn("MathJS evaluation failed:", e);
        }
        return false;
    }

    // Retrieves active API key
    function getApiKey() { return getActiveConfig().key; }

    // Retrieves active API base URL
    function getApiBaseUrl() { return getActiveConfig().baseUrl; }

    // Retrieves active model name
    function getModelName() { return getActiveConfig().model; }

    // Formulates the system prompt, pedagogical strategy, and auditor rules injected with retrieved curriculum memory
    function buildPrompt(challenge, isSolved = false, mistakeCount = 0, userInput = "", retrievedContext = "") {
        // Reply in the student's chosen interface language (math/LaTeX stays universal).
        const replyLang = (window.I18n && window.I18n.getLang() === 'vi') ? 'Vietnamese' : 'English';
        const langRule = `\nLANGUAGE: Write ALL of your prose to the student in ${replyLang}. Keep every number, variable, and formula in LaTeX \\( ... \\) exactly as-is.`;

        if (isSolved) {
            return `YOU ARE A WARM, ENCOURAGING MATH TUTOR.
The student just reached the correct answer: ${challenge.expectedAnswer}.
YOUR TASK:
1. Congratulate them warmly and specifically (one short sentence).
2. In one clear, simple sentence, restate the key idea they just used, with LaTeX \\( ... \\) for ALL math.
3. Do NOT ask a question and do NOT start a new problem — the app moves to the next challenge automatically.
4. START your response with "[SOLVED]". Keep it under 30 words, friendly and clear.${langRule}`;
        }

        let strategy = "";
        if (mistakeCount < 3) {
            strategy = `GUIDE, DON'T TELL (attempt ${mistakeCount + 1}):
            - First, warmly acknowledge what the student did and say clearly whether their last step was right or wrong.
            - Do NOT state the final answer. Break the problem into the SINGLE next small step.
            - Ask ONE clear, concrete question about that one step. Be direct about WHAT to look at or do next — just don't do it for them.
            - Use plain, simple words. A small concrete example beats an abstract hint.`;
        } else if (mistakeCount === 3) {
            strategy = `SHOW THE PATH (the student is stuck):
            - Clearly explain, in simple words, the key idea or formula they need.
            - Walk through the FIRST step explicitly with them, then ask them to try the next one.
            - Still do not give the final answer.`;
        } else {
            strategy = `LEAN IN — ALMOST THERE (the student is really stuck):
            - Give the exact next step as a clear target and explain why it works.
            - If it helps, show the same idea worked out on a DIFFERENT, simpler example, then ask them to finish the original problem.`;
        }

        const internalAlerts = [];
        try {
            const numberMap = {};
            const numMatches = challenge.question.match(/([a-zA-Z]+)\s*=\s*([0-9\.\^-]+)/g);
            if (numMatches) {
                numMatches.forEach(m => {
                    const [key, val] = m.split('=').map(s => s.trim());
                    numberMap[key] = val;
                });
            }

            if (challenge.question.includes('15500')) {
                const a = numberMap['a'] || 8850;
                const targetVal = 5 - (a / 15500);
                const studentMath = userInput.toLowerCase();
                if (studentMath.includes('log') || studentMath.includes('=')) {
                    const studentExpr = userInput.replace(/log_?10?\s*p\s*=\s*/gi, '').replace(/\\/g, '').trim();
                    if (studentExpr.length > 2) {
                        const val = window.math.evaluate(studentExpr, numberMap);
                        if (Math.abs(val - targetVal) > 0.001) {
                            internalAlerts.push(`[SYSTEM MATH CHECK: Student isolating log p. Expected target result is ${targetVal.toFixed(4)}. Student result was ${val.toFixed(4)}. CRITICAL ERROR: Sign flip or constant mismatch.]`);
                        } else {
                            internalAlerts.push(`[SYSTEM MATH CHECK: Student algebra for isolating log p is SOUND.]`);
                        }
                    }
                }
            } else if (challenge.question.includes('10\\log')) {
                const I = numberMap['I'] || 1e-7;
                const I0 = numberMap['I0'] || 1e-12;
                const targetL = 10 * Math.log10(I / I0);
                const val = window.math.evaluate(userInput.replace(/\\/g, ''), numberMap);
                if (Math.abs(val - targetL) > 0.01) {
                    internalAlerts.push(`[SYSTEM MATH CHECK: Student result is ${val.toFixed(2)}, expected ${targetL.toFixed(2)}. INVALID calculation.]`);
                }
            }
        } catch (e) {}

        const alertStr = internalAlerts.join('\n');

        return `YOU ARE A WARM, PATIENT MATH TUTOR who helps students reach the answer themselves.
Your job: guide with clear, simple, one-step-at-a-time questions. Never confusing, never showing off.

CURRENT CHALLENGE:
- Question: ${challenge.question}
- Concept: ${challenge.concept}
- The answer (for YOUR eyes only — never say it outright): ${challenge.expectedAnswer}

HOW TO RESPOND (mistake count: ${mistakeCount}):
${strategy}

${retrievedContext}

RULES:
1. Work ONLY on the challenge above. NEVER invent a new problem, switch topics, or ask what they want to do next — the app automatically moves to the next challenge once this one is solved.
2. CHECK THE STUDENT'S MATH carefully; gently and clearly correct any wrong step before moving on.
3. Use LaTeX \\( ... \\) for ALL numbers and math.
4. If the student has NOT reached the answer yet: guide ONE small step at a time — warm, simple, 2-3 short sentences — end with ONE clear question, and START your reply with "[STAY]".
5. Declare success ONLY when the student clearly states their FINAL answer and it matches the target (${challenge.expectedAnswer}) — NOT when the target number merely appears somewhere in their working. When they truly have it: START your reply with "[SOLVED]", congratulate in one sentence, and STOP — no new question, no new problem. If they're still working or unsure, keep guiding with "[STAY]".
${langRule}

${alertStr}`;
    }

    // Retrieves adaptive RAG context and requests completions from the configured endpoint
    async function generateResponse(userInput, battleHistory, challenge, isSolved = false, mistakeCount = 0) {
        const config = getActiveConfig();
        const isLocal = config.baseUrl.includes('localhost') || config.baseUrl.includes('127.0.0.1');
        if (!config.key && !isLocal && !config.isProxy) return window.I18n.t('aiTutor.notSetup');

        try {
            const activeNodeId = window.BattleSystem ? window.BattleSystem.getState().currentBattleNodeId : null;
            const currentStep = window.BattleSystem ? window.BattleSystem.getState().currentStep : 0;
            
            const ragResult = window.RAGEngine ? window.RAGEngine.adaptiveRetrieve(userInput, {
                nodeId: activeNodeId,
                mistakes: mistakeCount,
                challengeIndex: currentStep
            }) : { strategy: 'Fallback', chunks: [] };

            let retrievedContext = "";
            if (ragResult.chunks && ragResult.chunks.length > 0) {
                retrievedContext = "\n--- ADAPTIVE CURRICULUM RETRIEVAL (RAG) ---\n" +
                    `Strategy: ${ragResult.strategy}\n` +
                    ragResult.chunks.map(c => `[${c.type.toUpperCase()}] ${c.title}:\n${c.text}`).join('\n\n') +
                    "\n------------------------------------------\n";
            }

            const prompt = buildPrompt(challenge, isSolved, mistakeCount, userInput, retrievedContext);
            const messages = [{ role: 'system', content: prompt }];
            battleHistory.forEach(msg => messages.push({ role: msg.role, content: msg.content }));

            const headers = { 'Content-Type': 'application/json' };
            if (config.key) headers['Authorization'] = `Bearer ${config.key}`;

            let fetchUrl;
            if (config.isProxy) {
                // Proxy is a single fixed endpoint; don't append the OpenAI path.
                fetchUrl = config.baseUrl;
            } else {
                fetchUrl = config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/';
                if (!fetchUrl.endsWith('chat/completions')) {
                    fetchUrl += 'chat/completions';
                }
            }

            const requestInit = {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    model: config.model,
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: 250
                })
            };

            let response = await fetch(fetchUrl, requestInit);
            if (!response.ok) {
                // Transient blip (rate limit etc.) — wait briefly and retry once before
                // giving up, so momentary hiccups never reach the student.
                await new Promise(resolve => setTimeout(resolve, 2000));
                response = await fetch(fetchUrl, requestInit);
            }

            const data = await response.json();
            if (!response.ok || data.error || !data.choices) {
                const detail = (data.error && data.error.message) || `HTTP ${response.status}`;
                console.error('AI provider error:', detail, response.headers.get('X-AI-Error') || '');
                return window.I18n.t('aiTutor.busy');
            }

            let content = data.choices[0].message.content;
            // Strip reasoning-model scratchpads (<thinking> from some models, <think> from DeepSeek R1 etc.)
            content = content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();

            content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            return content;
        } catch (err) {
            console.error('AI Error:', err);
            return window.I18n.t('aiTutor.busy');
        }
    }

    // Assesses if the conversation history has resolved in a correct answer match
    function evaluateResponse(aiResponse, userInput = '', challenge = null) {
        let isCorrect = false;
        const aiSaysSolved = aiResponse.toUpperCase().includes('[SOLVED]');
        const aiSaysCorrect = aiResponse.toUpperCase().includes('CORRECT') || aiResponse.toUpperCase().includes('EXACTLY');

        if (challenge) {
            const cleanTarget = challenge.expectedAnswer.trim();
            const targetRegex = new RegExp(`(^|\\s|[^0-9a-zA-Z])${cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^0-9a-zA-Z])`, 'i');
            const includesTarget = targetRegex.test(userInput);

            const matchesExpected = compareMath(userInput, challenge.expectedAnswer);
            const matchesQuestion = compareMath(userInput, challenge.question);

            if (matchesExpected) {
                if (matchesQuestion) {
                    isCorrect = false;
                } else {
                    const cleanInput = userInput.toLowerCase();
                    const hasUnsolvedOperator = (challenge.question.includes('^') && cleanInput.includes('^')) ||
                        (challenge.question.includes('sqrt') && cleanInput.includes('sqrt')) ||
                        (challenge.question.includes('/') && cleanInput.includes('/')) ||
                        ((cleanInput.includes('+') || cleanInput.includes('-') || cleanInput.includes('*')) && !challenge.expectedAnswer.includes('+') && !challenge.expectedAnswer.includes('-') && !challenge.expectedAnswer.includes('*'));

                    const expectedHasOperator = (challenge.expectedAnswer.includes('^') ||
                        challenge.expectedAnswer.includes('sqrt') ||
                        challenge.expectedAnswer.includes('/') ||
                        challenge.expectedAnswer.includes('+') ||
                        challenge.expectedAnswer.includes('-') ||
                        challenge.expectedAnswer.includes('*'));

                    if (hasUnsolvedOperator && !expectedHasOperator) {
                        isCorrect = false;
                    } else {
                        isCorrect = true;
                    }
                }
            }

            if (!isCorrect && includesTarget) {
                const cleanExpected = challenge.expectedAnswer.replace(/[\\()]/g, '').trim();
                const targetNum = parseFloat(cleanExpected);
                const isNumericAnswer = !isNaN(targetNum) && cleanExpected.length < 5 && !/,/.test(cleanExpected);
                if (isNumericAnswer) {
                    // Accept only if EVERY number the student wrote equals the target — so a bare
                    // "2" or "x = 2" counts, but the target buried in working like "2 x 6 and 3x2"
                    // (which has other numbers) does not.
                    const nums = userInput.match(/-?\d+(?:\.\d+)?/g) || [];
                    if (nums.length > 0 && nums.every(n => parseFloat(n) === targetNum)) {
                        isCorrect = true;
                    }
                }
            }

            const userProvidedLiteral = userInput.includes(challenge.expectedAnswer.trim());
            if (isCorrect) {
                const aiConfirmed = aiSaysSolved || aiSaysCorrect || userProvidedLiteral;
                if (!aiConfirmed) {
                    isCorrect = false;
                }
            }

            // Fallback for answers we can't verify numerically (multi-part like "2, 4", or forms
            // like "e^2", "None"): trust an explicit [SOLVED]. We deliberately DON'T do this for
            // simple numbers, which we verify above — otherwise an over-eager [SOLVED] on a digit
            // spotted inside the student's working would advance wrongly.
            const cleanExp = challenge.expectedAnswer.replace(/[\\()]/g, '').trim();
            const answerIsSimpleNumber = !isNaN(parseFloat(cleanExp)) && cleanExp.length < 5 && !/,/.test(cleanExp);
            if (!isCorrect && aiSaysSolved && !answerIsSimpleNumber) {
                isCorrect = true;
            }
        } else {
            isCorrect = aiSaysSolved || aiSaysCorrect;
        }

        return { isCorrect: isCorrect, match: isCorrect ? '[SOLVED]' : '[STAY]' };
    }

    // Strips response code identifiers and isolates clean Socratic dialogue
    function cleanResponse(aiResponse, isSolved = false) {
        let cleaned = aiResponse.replace(/\s*\[(SOLVED|STAY|CORRECT|INCORRECT)\]\s*/gi, '').trim();
        if (isSolved) {
            cleaned = cleaned.replace(/[^.!?]+\?\s*/g, '').trim();
            if (!cleaned) cleaned = "Correct!";
            if (cleaned.endsWith('?')) cleaned = cleaned.slice(0, -1) + '!';
        }
        return cleaned;
    }

    return {
        setProviders,
        setProvider,
        getProvider: () => activeProvider,
        getCloudKey: () => cloudKey,
        getLocalUrl: () => localUrl,
        getLocalModel: () => localModel,
        getApiKey,
        getApiBaseUrl,
        getModelName,
        buildPrompt,
        generateResponse,
        evaluateResponse,
        cleanResponse
    };
})();
