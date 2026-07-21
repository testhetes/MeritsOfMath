document.addEventListener('DOMContentLoaded', () => {
    const requiredModules = {
        'DB': window.DB,
        'RAGEngine': window.RAGEngine,
        'ProgressionManager': window.ProgressionManager,
        'BattleSystem': window.BattleSystem,
        'AiTutor': window.AiTutor,
        'UIHelpers': window.UIHelpers
    };

    for (const [name, mod] of Object.entries(requiredModules)) {
        if (!mod) {
            console.error(`[BOOT] Critical Error: Module "${name}" is missing or failed to globalize.`);
            return;
        }
    }

    const onboardingView = document.getElementById('onboarding-view');
    const appContainer = document.getElementById('app');
    const t = (k, v) => window.I18n.t(k, v);

    // Re-render dynamic (JS-generated) UI when the language changes. Static [data-i18n]
    // markup is handled by I18n.apply(); these functions rebuild the computed strings.
    document.addEventListener('langchange', () => {
        if (window.ProgressionManager && window.ProgressionManager.getProfile()) {
            window.ProgressionManager.syncDBWithProfile();
        }
        if (window.DashboardStats) window.DashboardStats.updateStats();
        if (window.SkillTree && window.SkillTree.render) window.SkillTree.render();
    });

    // Restore any saved profile BEFORE deciding whether to show onboarding — otherwise a
    // returning student is sent through onboarding again and the dashboard never populates.
    window.ProgressionManager.init();
    window.ProgressionManager.syncDBWithProfile();

    // Assesses if a profile exists to skip the onboarding layout step
    function initOnboarding() {
        window.addEventListener('resize', () => {
            if (window._resizeTimeout) clearTimeout(window._resizeTimeout);
            window._resizeTimeout = setTimeout(() => {
                const canvas = document.getElementById('grid-canvas');
                if (canvas) {
                    canvas.width = window.innerWidth;
                    canvas.height = window.innerHeight;
                    initGrid();
                }
                if (window.SkillTree) window.SkillTree.drawConnections();
            }, 250);
        });

        const profile = window.ProgressionManager.getProfile();
        if (profile && profile.name && profile.name !== 'Lam' && profile.name !== 'Student') {
            onboardingView.classList.add('hidden');
            appContainer.classList.remove('hidden-view');
            stopOnboardingAnimations();
            return false;
        }

        onboardingView.classList.remove('hidden');
        appContainer.classList.add('hidden-view');
        initGrid();
        createMathParticles();
        setupStepper();
        return true;
    }

    let particles = [];
    let mouseX = -1000;
    let mouseY = -1000;
    let onboardingAnimId = null;

    // Clears onboarding canvas frames and removes the elements from DOM
    function stopOnboardingAnimations() {
        if (onboardingAnimId) {
            cancelAnimationFrame(onboardingAnimId);
            onboardingAnimId = null;
        }
        if (onboardingView) {
            onboardingView.remove();
        }
    }

    // Creates particle vectors containing mathematical symbols floating in the canvas background
    function createMathParticles() {
        const container = document.getElementById('math-particles');
        const symbols = ['π', 'Σ', '∞', '∫', 'Δ', 'θ', 'λ', '√', '≈', 'f(x)'];
        container.innerHTML = '';
        particles = [];

        for (let i = 0; i < 25; i++) {
            const el = document.createElement('div');
            el.className = 'particle';
            el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
            const op = Math.random() * 0.25 + 0.1;
            el.style.opacity = op;
            container.appendChild(el);

            particles.push({
                el: el,
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                originX: Math.random() * window.innerWidth,
                originY: Math.random() * window.innerHeight,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 20 + 30,
                baseOp: op
            });
        }

        window.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });

        requestAnimationFrame(updateParticles);
    }

    let gridPoints = [];
    const canvas = document.getElementById('grid-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // Defines coordinate nodes forming the background dot layout
    function initGrid() {
        if (!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gridPoints = [];
        const spacing = 45;

        for (let x = 0; x < canvas.width + spacing; x += spacing) {
            for (let y = 0; y < canvas.height + spacing; y += spacing) {
                gridPoints.push({ x, y, originX: x, originY: y });
            }
        }
    }

    // Connects coordinate points to draw static and mouse-swelled dots in canvas view
    function drawGrid() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#a5b4fc';
        ctx.beginPath();
        const maxDistSq = 62500;

        gridPoints.forEach(p => {
            const dx = mouseX - p.originX;
            const dy = mouseY - p.originY;
            const distSq = dx * dx + dy * dy;

            if (distSq < maxDistSq) {
                const dist = Math.sqrt(distSq);
                const pull = Math.pow((250 - dist) / 250, 2);
                const drawX = p.originX + dx * pull * 0.4;
                const drawY = p.originY + dy * pull * 0.4;
                const size = 1 + pull * 3;
                ctx.moveTo(drawX + size, drawY);
                ctx.arc(drawX, drawY, size, 0, Math.PI * 2);
            } else {
                ctx.rect(p.originX - 0.5, p.originY - 0.5, 1, 1);
            }
        });
        ctx.fill();
    }

    // Handles movement friction, spring forces, mouse deflection, and redraw loops for screen particles
    function updateParticles() {
        drawGrid();
        particles.forEach(p => {
            const dx_origin = p.originX - p.x;
            const dy_origin = p.originY - p.y;
            p.vx += dx_origin * 0.002;
            p.vy += dy_origin * 0.002;
            p.vx += (Math.random() - 0.5) * 0.05;
            p.vy += (Math.random() - 0.5) * 0.05;

            const dx_mouse = p.x - mouseX;
            const dy_mouse = p.y - mouseY;
            const dist = Math.sqrt(dx_mouse * dx_mouse + dy_mouse * dy_mouse);
            const reach = 200;

            if (dist < reach) {
                const force = (reach - dist) / reach;
                p.vx += (dx_mouse / dist) * force * 1.5;
                p.vy += (dy_mouse / dist) * force * 1.5;
            }

            p.vx *= 0.95;
            p.vy *= 0.95;
            p.x += p.vx;
            p.y += p.vy;

            p.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
            p.el.style.fontSize = `${p.size}px`;
        });
        onboardingAnimId = requestAnimationFrame(updateParticles);
    }

    // Binds event listeners for stepper progression pages and snaps configuration confidence slider
    function setupStepper() {
        const nextBtns = document.querySelectorAll('.next-step');
        const backBtns = document.querySelectorAll('.back-step');
        const confSlider = document.getElementById('ob-confidence');
        const confVal = document.getElementById('conf-val');

        if (confSlider && confVal) {
            confSlider.min = 0;
            confSlider.max = 1000;
            confSlider.step = 1;
            // The HTML default of "3" was written for the old 1-5 scale; on the 0-1000
            // scale it lands at confidence 1. Start at the middle (level 3) instead.
            confSlider.value = 500;

            const updateSliderUI = (isSnapping = false) => {
                const val = parseInt(confSlider.value);
                const perc = (val / 1000) * 100;
                confSlider.style.background = `linear-gradient(90deg, #818cf8 ${perc}%, rgba(129, 140, 248, 0.2) ${perc}%)`;
                const displayLevel = Math.max(1, Math.min(5, Math.ceil(val / 200) || 1));
                confVal.textContent = displayLevel;
                if (isSnapping) {
                    confSlider.style.transition = 'all 0.5s cubic-bezier(0.34, 1.2, 0.64, 1)';
                    setTimeout(() => confSlider.style.transition = 'none', 500);
                }
            };

            confSlider.oninput = () => updateSliderUI(false);
            const elasticEaseOut = (t) => {
                return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
            };

            confSlider.onchange = () => {
                const startVal = parseInt(confSlider.value);
                const targetVal = Math.round(startVal / 250) * 250;
                if (startVal === targetVal) return;
                let startTime = null;
                const duration = 500;

                const animateSnap = (timestamp) => {
                    if (!startTime) startTime = timestamp;
                    const progress = timestamp - startTime;
                    const t = Math.min(progress / duration, 1);
                    const easeT = elasticEaseOut(t);
                    const currentVal = startVal + (targetVal - startVal) * easeT;
                    confSlider.value = currentVal;
                    updateSliderUI(true);
                    if (progress < duration) {
                        requestAnimationFrame(animateSnap);
                    } else {
                        confSlider.value = targetVal;
                        updateSliderUI(false);
                    }
                };
                requestAnimationFrame(animateSnap);
            };
            updateSliderUI();
        }

        const accordionHeaders = document.querySelectorAll('.accordion-header');
        accordionHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const item = header.parentElement;
                if (item.style.opacity === '0.5') return;
                item.classList.toggle('custom-dropdown-active');
                const icon = item.querySelector('i');
                if (item.classList.contains('custom-dropdown-active')) {
                    if (icon) icon.className = 'fa-solid fa-chevron-up';
                } else {
                    if (icon) icon.className = 'fa-solid fa-chevron-down';
                }
            });
        });

        const curInput = document.getElementById('ob-curriculum');
        const subBox = document.getElementById('sub-knowledge-box');
        const dynamicSubPills = document.getElementById('dynamic-sub-pills');

        if (dynamicSubPills && window.DB && window.DB.skillNodes) {
            window.DB.skillNodes.forEach(node => {
                if (node.id === 'chap6exam') return;
                const pill = document.createElement('div');
                pill.className = 'sub-knowledge-pill';
                pill.textContent = node.label;
                pill.dataset.node = node.id;
                pill.addEventListener('click', () => {
                    pill.classList.toggle('selected-sub-pill');
                });
                dynamicSubPills.appendChild(pill);
            });
        }

        const pills = document.querySelectorAll('.module-pill:not(.disabled-pill)');
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => p.classList.remove('active-pill'));
                pill.classList.add('active-pill');
                if (pill.id === 'log-pill') {
                    curInput.value = 'logarithms';
                    if (subBox) subBox.style.display = 'block';
                }
            });
        });

        if (document.getElementById('log-pill').classList.contains('active-pill')) {
            if (subBox) subBox.style.display = 'block';
        }

        nextBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const nextStep = btn.getAttribute('data-next');
                if (nextStep === "2") {
                    const name = document.getElementById('ob-name').value.trim();
                    if (!name) {
                        window.UIHelpers.showNotification(t('ob.needNameTitle'), t('ob.needNameMsg'), "warning");
                        return;
                    }
                }
                if (nextStep === "done") {
                    finishOnboarding();
                } else {
                    showStep(nextStep);
                }
            });
        });

        backBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const prevStep = btn.getAttribute('data-prev');
                showStep(prevStep);
            });
        });
    }

    // Transitions view layers to open specific steps
    function showStep(stepNum) {
        document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
        document.getElementById(`step-${stepNum}`).classList.add('active');
    }

    // Creates user profiles, assigns adaptive skill progress values, and swaps views to active app state
    function finishOnboarding() {
        try {
            const finalNameInput = document.getElementById('ob-name');
            const finalNameValue = finalNameInput ? finalNameInput.value.trim() : "";

            if (!finalNameValue || finalNameValue === "") {
                window.UIHelpers.showNotification(t('ob.needNameTitle'), t('ob.needNameBackMsg'), "warning");
                showStep(1);
                return;
            }

            const gradeBtn = document.querySelector('.grade-option.active');
            const grade = gradeBtn ? gradeBtn.getAttribute('data-grade') : 'Grade 11';
            const curriculum = document.getElementById('ob-curriculum') ? document.getElementById('ob-curriculum').value : 'logarithms';
            const confidenceVal = parseInt(document.getElementById('ob-confidence').value);
            const confidence = Math.max(1, Math.min(5, Math.ceil(confidenceVal / 200) || 1));

            const profile = window.ProgressionManager.initProfile(finalNameValue, grade, confidence);

            if (curriculum === 'logarithms' && window.DB && window.DB.skillNodes) {
                const selectedPills = Array.from(document.querySelectorAll('.selected-sub-pill')).map(p => p.dataset.node);

                const propagatePrerequisiteMastery = (nodeId, baseMastery) => {
                    const node = window.DB.skillNodes.find(n => n.id === nodeId);
                    if (!node || !node.prerequisites) return;

                    node.prerequisites.forEach(prereqId => {
                        const prereqNode = profile.nodes[prereqId];
                        if (prereqNode) {
                            const selectedPills = Array.from(document.querySelectorAll('.selected-sub-pill')).map(p => p.dataset.node);
                            const wasSelected = selectedPills.includes(prereqId);
                            let aqMastery;
                            if (wasSelected) {
                                aqMastery = Math.max(prereqNode.mastery || 0, baseMastery - 15);
                            } else {
                                aqMastery = Math.max(prereqNode.mastery || 0, 40);
                            }

                            prereqNode.mastery = aqMastery;
                            prereqNode.status = (aqMastery >= 95) ? 'mastered' : 'partial';
                            prereqNode.startStep = 0;
                            propagatePrerequisiteMastery(prereqId, aqMastery);
                        }
                    });
                };

                let firstUnmastered = null;
                window.DB.skillNodes.forEach(node => {
                    if (node.id === 'chap6exam') return;
                    if (selectedPills.includes(node.id)) {
                        const masteryMap = [60, 70, 80, 90, 100];
                        const calcMastery = masteryMap[confidence - 1] || 100;
                        profile.nodes[node.id].mastery = calcMastery;
                        profile.nodes[node.id].status = (calcMastery >= 95) ? 'mastered' : 'partial';
                        profile.nodes[node.id].startStep = 0;
                        propagatePrerequisiteMastery(node.id, calcMastery);
                    } else if (!firstUnmastered) {
                        firstUnmastered = node;
                    }
                });

                if (firstUnmastered) {
                    if (confidence === 5) {
                        profile.nodes[firstUnmastered.id].startStep = 0;
                        profile.nodes[firstUnmastered.id].mastery = 40;
                        profile.nodes[firstUnmastered.id].status = 'partial';
                    } else if (confidence === 4) {
                        profile.nodes[firstUnmastered.id].startStep = 0;
                        profile.nodes[firstUnmastered.id].mastery = 25;
                        profile.nodes[firstUnmastered.id].status = 'partial';
                    } else if (confidence === 3) {
                        profile.nodes[firstUnmastered.id].startStep = 0;
                        profile.nodes[firstUnmastered.id].mastery = 10;
                        profile.nodes[firstUnmastered.id].status = 'partial';
                    } else {
                        profile.nodes[firstUnmastered.id].startStep = 0;
                        profile.nodes[firstUnmastered.id].mastery = 0;
                        profile.nodes[firstUnmastered.id].status = 'partial';
                    }
                }
            }

            window.ProgressionManager.saveProfile();
            onboardingView.classList.add('hidden');
            appContainer.classList.remove('hidden-view');
            stopOnboardingAnimations();

            window.ProgressionManager.init();
            window.ProgressionManager.syncDBWithProfile();

            if (window.SkillTree) {
                window.SkillTree.init();
                window.SkillTree.render();
            }

            const sidebarName = document.querySelector('.user-name');
            const dashName = document.getElementById('dash-user-name');
            const sidebarAvatar = document.querySelector('.avatar');

            if (finalNameValue && finalNameValue !== "") {
                if (sidebarName) sidebarName.textContent = finalNameValue;
                if (dashName) dashName.textContent = finalNameValue;
                if (sidebarAvatar) sidebarAvatar.textContent = finalNameValue.charAt(0).toUpperCase();
            }

            if (window.DashboardStats) {
                window.DashboardStats.updateStats();
            }
        } catch (err) {
            console.error('[ONBOARDING] Critical failure in bridge:', err);
            onboardingView.classList.add('hidden');
            appContainer.classList.remove('hidden-view');
        }
    }

    initOnboarding();

    const skillNodes = window.DB.skillNodes;
    const skillEdges = window.DB.skillEdges;

    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');
    const cloudKeyInput = document.getElementById('cloud-key-input');
    const localUrlInput = document.getElementById('local-url-input');
    const localModelInput = document.getElementById('local-model-input');
    const navSettings = document.getElementById('nav-settings');

    const providerCloudBtn = document.getElementById('label-cloud');
    const providerLocalBtn = document.getElementById('label-local');
    const cloudRadio = document.getElementById('provider-cloud');
    const localRadio = document.getElementById('provider-local');

    const cloudConfigSection = document.getElementById('config-cloud-section');
    const localConfigSection = document.getElementById('config-local-section');

    // Updates border colors and toggle parameters depending on selected model providers
    function updateSettingsSelection(provider) {
        if (provider === 'cloud') {
            cloudRadio.checked = true;
            providerCloudBtn.style.borderColor = 'var(--accent-primary)';
            providerCloudBtn.style.color = 'var(--accent-primary)';
            providerCloudBtn.style.background = 'rgba(59, 130, 246, 0.1)';
            providerLocalBtn.style.borderColor = 'var(--border-color)';
            providerLocalBtn.style.color = 'var(--text-secondary)';
            providerLocalBtn.style.background = 'transparent';
            if (cloudConfigSection) cloudConfigSection.style.display = 'block';
            if (localConfigSection) localConfigSection.style.display = 'none';
        } else {
            localRadio.checked = true;
            providerLocalBtn.style.borderColor = 'var(--accent-primary)';
            providerLocalBtn.style.color = 'var(--accent-primary)';
            providerLocalBtn.style.background = 'rgba(59, 130, 246, 0.1)';
            providerCloudBtn.style.borderColor = 'var(--border-color)';
            providerCloudBtn.style.color = 'var(--text-secondary)';
            providerCloudBtn.style.background = 'transparent';
            if (cloudConfigSection) cloudConfigSection.style.display = 'none';
            if (localConfigSection) localConfigSection.style.display = 'block';
        }
    }

    if (providerCloudBtn) {
        providerCloudBtn.addEventListener('click', () => updateSettingsSelection('cloud'));
    }
    if (providerLocalBtn) {
        providerLocalBtn.addEventListener('click', () => updateSettingsSelection('local'));
    }

    if (navSettings) {
        navSettings.addEventListener('click', () => {
            if (cloudKeyInput) cloudKeyInput.value = window.AiTutor.getCloudKey();
            if (localUrlInput) localUrlInput.value = window.AiTutor.getLocalUrl();
            if (localModelInput) localModelInput.value = window.AiTutor.getLocalModel();
            updateSettingsSelection(window.AiTutor.getProvider());
            settingsModal.classList.remove('hidden');
        });
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    }

    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', () => {
            const selectedProvider = cloudRadio.checked ? 'cloud' : 'local';
            window.AiTutor.setProvider(selectedProvider);
            window.AiTutor.setProviders(
                { key: cloudKeyInput.value.trim() },
                { url: localUrlInput.value.trim(), model: localModelInput.value.trim() }
            );
            settingsModal.classList.add('hidden');
        });
    }

    const navItems = document.querySelectorAll('.nav-item');
    const viewSections = document.querySelectorAll('.view-section');

    // Switches current layout to focus on active view ID
    function switchView(targetId) {
        navItems.forEach(item => item.classList.toggle('active', item.dataset.target === targetId));
        viewSections.forEach(section => section.classList.toggle('active', section.id === targetId));

        if (targetId === 'battle-view') {
            window.UIHelpers.triggerMathJax();
            window.UIHelpers.scrollToBottom(document.getElementById('chat-messages'));
        }
        if (targetId === 'skilltree-view') {
            window.UIHelpers.triggerMathJax();
            window.SkillTree.redrawConnections();
        }
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (item.disabled) return;
            if (item.id === 'nav-settings') return;
            switchView(item.dataset.target);
        });
    });

    window.SkillTree = {
        container: document.getElementById('skill-tree-container'),
        svg: document.getElementById('tree-svg'),
        nodeDetailPanel: document.getElementById('node-detail-panel'),
        closePanelBtn: document.getElementById('close-panel-btn'),
        selectedNodeId: null,

        // Binds tree close handlers and initializes rendering triggers
        init() {
            this.closePanelBtn.addEventListener('click', () => this.deselectNode());
            let resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => this.redrawConnections(), 150);
            });
            this.render();
        },

        // Triggers node creation and edge drawing pipelines
        render() {
            window.UIHelpers.renderSkillTree(this.container, skillNodes);
            this.redrawConnections();
        },

        // Prompts connections redraw helper
        redrawConnections() {
            window.UIHelpers.drawConnections(this.container, this.svg, skillNodes, skillEdges);
        },

        // Locks user out or displays description panels upon clicking a specific node
        onNodeClick(nodeId) {
            const node = skillNodes.find(n => n.id === nodeId);
            if (!node) return;

            if (nodeId === 'chap6exam') {
                const otherNodes = skillNodes.filter(n => n.id !== 'chap6exam');
                const userProfile = window.ProgressionManager.getProfile();
                const isReady = otherNodes.every(n => (userProfile.nodes[n.id]?.mastery || 0) >= 100);

                if (!isReady) {
                    window.UIHelpers.showNotification(t('tree.finalLockedTitle'), t('tree.finalLockedMsg'), "error");
                    return;
                }
            }

            if (this.selectedNodeId === nodeId) {
                this.deselectNode();
                return;
            }

            this.selectedNodeId = nodeId;
            this.container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
            const el = document.getElementById(`node-${nodeId}`);
            if (el) el.classList.add('selected');

            this.showNodeDetails(node);
            this.nodeDetailPanel.classList.remove('hidden');
            window.UIHelpers.triggerMathJax();
        },

        // Configures action buttons and textual summaries for the selected node detail slide
        showNodeDetails(node) {
            document.getElementById('node-detail-icon').textContent = node.icon;
            document.getElementById('node-detail-name').textContent = node.lesson.title;

            const statusEl = document.getElementById('node-detail-status');
            const statusMap = {
                mastered: { text: t('tree.status.mastered', { pct: node.mastery }), class: 'status-mastered' },
                partial: { text: t('tree.status.partial', { pct: node.mastery }), class: 'status-partial' },
                critical: { text: t('tree.status.critical', { pct: node.mastery }), class: 'status-critical' },
                locked: { text: t('tree.status.locked'), class: 'status-locked' }
            };
            const statusInfo = statusMap[node.status];
            statusEl.textContent = statusInfo.text;
            statusEl.className = `node-detail-status ${statusInfo.class}`;

            document.getElementById('node-detail-body').innerHTML = node.lesson.body;

            const actionsEl = document.getElementById('node-detail-actions');
            actionsEl.innerHTML = '';

            if (node.status !== 'locked') {
                const btn = document.createElement('button');
                btn.className = 'btn btn-primary';
                const btnLabel = node.status === 'critical' ? t('tree.startBattle') : t('tree.practiceSkill');
                btn.innerHTML = `<i class="fa-solid fa-gamepad"></i> ${btnLabel}`;
                btn.addEventListener('click', () => window.BattleArena.startBattle(node.id));
                actionsEl.appendChild(btn);
            } else {
                const prereqNames = node.prerequisites
                    .map(pid => skillNodes.find(n => n.id === pid))
                    .filter(Boolean)
                    .map(n => n.label)
                    .join(', ');
                const info = document.createElement('p');
                info.style.cssText = 'color: var(--text-tertiary); font-size: 14px; font-style: italic; margin: 0;';
                info.textContent = t('tree.requires', { names: prereqNames });
                actionsEl.appendChild(info);
            }
        },

        // De-selects the active node element
        deselectNode() {
            this.selectedNodeId = null;
            this.container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
            this.nodeDetailPanel.classList.add('hidden');
        }
    };

    window.BattleArena = {
        chatContainer: document.getElementById('chat-messages'),
        battleProgressEl: document.getElementById('battle-progress'),
        navBattleBtn: document.getElementById('nav-battle'),
        battleBadge: document.getElementById('battle-badge'),
        leaveBattleBtn: document.getElementById('leave-battle'),
        chatInputText: document.getElementById('user-text'),
        chatInputMath: document.getElementById('user-math'),
        sendBtn: document.getElementById('send-btn'),
        toggleInputModeBtn: document.getElementById('toggle-input-mode'),
        startBattleBtn: document.getElementById('start-battle-btn'),
        inputMode: 'text',

        // Hooks user inputs, keyboards, and buttons to active events
        init() {
            this.navBattleBtn.disabled = true;
            this.leaveBattleBtn.addEventListener('click', () => this.leaveBattle());
            this.sendBtn.addEventListener('click', () => this.handleUserInput());

            this.chatInputMath.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleUserInput();
                }
            });

            this.chatInputText.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleUserInput();
                }
            });

            this.updateToggleButton();
            this.toggleInputModeBtn.addEventListener('click', () => this.toggleInputMode());
        },

        // Configures colors and labels on the active input mode toggler
        updateToggleButton() {
            if (this.inputMode === 'text') {
                this.toggleInputModeBtn.innerHTML = 'T';
                this.toggleInputModeBtn.style.background = '#10b981';
                this.toggleInputModeBtn.style.borderColor = '#10b981';
            } else {
                this.toggleInputModeBtn.innerHTML = 'f(x)';
                this.toggleInputModeBtn.style.background = '#3b82f6';
                this.toggleInputModeBtn.style.borderColor = '#3b82f6';
            }
        },

        // Swaps keyboard interfaces between standard text and virtual math boards
        toggleInputMode() {
            this.inputMode = this.inputMode === 'text' ? 'math' : 'text';
            if (this.inputMode === 'text') {
                this.chatInputText.style.display = 'block';
                this.chatInputMath.style.display = 'none';
                this.chatInputText.focus();
            } else {
                this.chatInputText.style.display = 'none';
                this.chatInputMath.style.display = 'block';
                this.chatInputMath.focus();
            }
            this.updateToggleButton();
        },

        // Initiates a new battle layout targeting the selected skill node
        startBattle(nodeId) {
            const result = window.BattleSystem.startBattle(nodeId);
            const node = result.node;
            if (!node) return;

            document.getElementById('battle-title').textContent = t('battle.socraticTitle', { name: node.label });
            document.getElementById('battle-topic').textContent = t('battle.topic', { name: node.lesson.title });

            this.navBattleBtn.disabled = false;
            this.battleBadge.classList.remove('hidden');
            this.resetBattle();
            switchView('battle-view');
        },

        // Empties conversation views and resets step tracking indicators
        resetBattle() {
            window.BattleSystem.resetBattle();
            this.chatContainer.innerHTML = '';
            this.updateBattleProgress();
            this.inputMode = 'text';

            this.chatInputText.disabled = false;
            this.chatInputMath.disabled = false;
            this.sendBtn.disabled = false;
            window.BattleSystem.isProcessing = false;

            this.chatInputText.style.display = 'block';
            this.chatInputMath.style.display = 'none';
            this.chatInputText.focus();
            this.updateToggleButton();

            const firstChallenge = window.BattleSystem.getCurrentChallenge();
            if (firstChallenge) {
                const intro = `
                    ${t('battle.welcomeIntro')}
                    <div class="math-block">${firstChallenge.question}</div>
                `;
                window.UIHelpers.addMessage(intro, 'ai', this.chatContainer, ['task-message']);
            } else {
                window.UIHelpers.addMessage(t('battle.comingSoon'), 'ai', this.chatContainer);
            }
        },

        // Renders updated challenge step counts in header
        updateBattleProgress() {
            const state = window.BattleSystem.getState();
            window.UIHelpers.updateBattleProgress(this.battleProgressEl, state.currentStep, state.totalChallenges);
        },

        // Discards current battle logs and swaps screen back to main dashboard
        leaveBattle() {
            window.BattleSystem.init();
            this.navBattleBtn.disabled = true;
            this.battleBadge.classList.add('hidden');
            const skipContainer = document.getElementById('floating-skip-container');
            if (skipContainer) skipContainer.classList.add('hidden');
            switchView('dashboard-view');
        },

        // Submits input vectors to AiTutor, prints text dialogues, and manages stepping logic
        async handleUserInput() {
            const rawText = this.chatInputText.value.trim();
            const rawMath = this.chatInputMath.value.trim();
            const mathjsValue = this.chatInputMath.getValue('mathjs');

            if ((!rawText && !rawMath) || window.BattleSystem.isProcessing) return;

            const challenge = window.BattleSystem.getCurrentChallenge();
            if (!challenge) return;

            let displayHtml = '';
            if (rawText) displayHtml += `<p>${window.UIHelpers.sanitizeHTML(rawText)}</p>`;
            if (rawMath) displayHtml += `<div class="math-block">\\( ${rawMath} \\)</div>`;

            window.UIHelpers.addMessage(displayHtml, 'user', this.chatContainer);
            this.chatInputText.value = '';
            this.chatInputMath.value = '';

            window.BattleSystem.isProcessing = true;
            const typingId = window.UIHelpers.showTypingIndicator(this.chatContainer);

            try {
                let combinedUserMessage = "";
                if (rawText) combinedUserMessage += `Text explanation: ${rawText}\n`;
                if (rawMath) combinedUserMessage += `Mathematical calculation: \\( ${rawMath} \\)\n`;
                if (mathjsValue) combinedUserMessage += `Computer-readable math: ${mathjsValue}\n`;

                window.BattleSystem.recordUserInput(combinedUserMessage);

                const preCheck = window.AiTutor.evaluateResponse("", combinedUserMessage, challenge);
                const isSolvedPre = preCheck.isCorrect;

                const aiResponse = await window.AiTutor.generateResponse(combinedUserMessage, window.BattleSystem.battleHistory, challenge, isSolvedPre, window.BattleSystem.currentMistakes);
                window.UIHelpers.removeTypingIndicator(typingId);

                let evaluation = window.AiTutor.evaluateResponse(aiResponse, combinedUserMessage, challenge);
                if (isSolvedPre) evaluation.isCorrect = true;

                const isCorrect = evaluation.isCorrect;

                if (window.DashboardStats) {
                    window.DashboardStats.recordAttempt(isCorrect);
                }

                let cleanReply = window.AiTutor.cleanResponse(aiResponse, isCorrect);
                cleanReply = window.UIHelpers.parseMarkdown(cleanReply);

                window.UIHelpers.addMessage(cleanReply, 'ai', this.chatContainer, isCorrect ? ['solved-state'] : []);
                window.BattleSystem.recordAIResponse(cleanReply);

                const skipContainer = document.getElementById('floating-skip-container');

                if (isCorrect) {
                    if (skipContainer) skipContainer.classList.add('hidden');
                    window.BattleSystem.recordAttempt(true);

                    this.chatInputText.disabled = true;
                    this.chatInputMath.disabled = true;
                    this.sendBtn.disabled = true;
                    this.updateBattleProgress();

                    const nextChallenge = window.BattleSystem.getNextChallenge();
                    setTimeout(() => {
                        const btnContainer = document.createElement('div');
                        btnContainer.className = 'advance-btn-container';

                        if (nextChallenge) {
                            const advanceBtn = document.createElement('button');
                            advanceBtn.className = 'btn btn-primary';
                            advanceBtn.style.cssText = 'margin: 12px auto 0; display: block;';
                            advanceBtn.innerHTML = `<i class="fa-solid fa-arrow-right"></i> ${t('battle.nextChallenge')}`;
                            advanceBtn.addEventListener('click', () => {
                                btnContainer.remove();
                                this.chatContainer.innerHTML = '';
                                window.BattleSystem.advanceToNextChallenge();

                                this.chatInputText.disabled = false;
                                this.chatInputMath.disabled = false;
                                this.sendBtn.disabled = false;
                                this.chatInputText.focus();

                                const currentChallenge = window.BattleSystem.getCurrentChallenge();
                                if (currentChallenge) {
                                    const nextMsg = `${t('battle.excellentNext')}
                                                    <div class="math-block">${currentChallenge.question}</div>`;
                                    window.UIHelpers.addMessage(nextMsg, 'ai', this.chatContainer, ['task-message']);
                                }
                                window.BattleSystem.isProcessing = false;
                            });
                            btnContainer.appendChild(advanceBtn);
                        } else {
                            const finishBtn = document.createElement('button');
                            finishBtn.className = 'btn btn-primary';
                            finishBtn.style.cssText = 'margin: 12px auto 0; display: block;';
                            finishBtn.innerHTML = `<i class="fa-solid fa-trophy"></i> ${t('battle.finishBattle')}`;
                            finishBtn.addEventListener('click', () => {
                                btnContainer.remove();
                                this.chatInputText.disabled = false;
                                this.chatInputMath.disabled = false;
                                this.sendBtn.disabled = false;
                                this.completeQuest();
                            });
                            btnContainer.appendChild(finishBtn);
                        }
                        this.chatContainer.appendChild(btnContainer);
                        window.UIHelpers.scrollToBottom(this.chatContainer);
                    }, 400);
                } else {
                    window.BattleSystem.recordAttempt(false);
                    const mistakes = window.BattleSystem.currentMistakes;
                    if (mistakes >= 2 && !document.getElementById('skip-challenge-btn')) {
                        const skipContainer = document.getElementById('floating-skip-container');
                        if (!skipContainer) return;
                        skipContainer.innerHTML = '';

                        const skipBtn = document.createElement('button');
                        skipBtn.id = 'skip-challenge-btn';
                        skipBtn.className = 'btn btn-secondary skip-btn';
                        skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${t('battle.skip')}`;
                        skipBtn.onclick = () => {
                            skipContainer.classList.add('hidden');
                            this.chatContainer.innerHTML = '';
                            window.BattleSystem.advanceToNextChallenge(true);
                            this.updateBattleProgress();

                            const next = window.BattleSystem.getCurrentChallenge();
                            if (next) {
                                const msg = `${t('battle.rotate')}
                                            <div class="math-block">${next.question}</div>`;
                                window.UIHelpers.addMessage(msg, 'ai', this.chatContainer, ['task-message']);
                            } else {
                                this.completeQuest();
                            }
                        };
                        skipContainer.appendChild(skipBtn);
                        skipContainer.classList.remove('hidden');
                    }
                }
            } catch (err) {
                console.error("Battle Interaction Error:", err);
                window.UIHelpers.removeTypingIndicator(typingId);
                window.UIHelpers.addMessage(t('battle.interrupted'), 'ai', this.chatContainer);
            } finally {
                window.BattleSystem.isProcessing = false;
            }
        },

        // Saves battle metrics and reloads dashboard metrics and connection SVG vectors
        completeQuest() {
            window.BattleSystem.finalizeBattle();
            const diagCard = document.getElementById('diagnostic-card');
            if (diagCard) {
                diagCard.innerHTML = `
                    <div class="card-header">
                        <h3><i class="fa-solid fa-circle-check"></i> ${t('battle.complete')}</h3>
                    </div>
                    <div class="card-body">
                        <p>${t('battle.processing')}</p>
                    </div>`;
            }

            setTimeout(() => {
                window.SkillTree.render();
                window.SkillTree.deselectNode();
                switchView('skilltree-view');
                this.battleBadge.classList.add('hidden');
                this.navBattleBtn.disabled = true;
                if (window.DashboardStats) window.DashboardStats.updateStats();
                if (window.ProgressionManager) {
                    window.ProgressionManager.saveProfile();
                }
            }, 2000);
        }
    };

    window.SkillTree.init();
    window.BattleArena.init();
    window.SkillTree.render();
    if (window.DashboardStats) window.DashboardStats.updateStats();
    if (window.RAGEngine) window.RAGEngine.init();
});
