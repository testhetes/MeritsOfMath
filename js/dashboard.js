window.DashboardStats = {
    perfectAttempts: 0,
    totalAttempts: 0,

    // Recalculates concepts mastered, accuracy ratios, next unlocks, and adaptive priorities
    updateStats() {
        try {
            if (!window.ProgressionManager || !window.DB) return;
            const userProfile = window.ProgressionManager.getProfile();
            if (!userProfile) return;

            const t = (k, v) => window.I18n.t(k, v);
            const skillNodes = window.DB.skillNodes;

            const masterCount = skillNodes.filter(n => userProfile.nodes[n.id]?.status === 'mastered').length;
            const masterEl = document.getElementById('stat-concepts-mastered');
            if (masterEl) masterEl.textContent = masterCount;

            const xpEl = document.getElementById('stat-total-xp');
            if (xpEl) xpEl.textContent = userProfile.xp;

            const accuracyEl = document.getElementById('stat-accuracy-rate');
            if (accuracyEl) {
                if (this.totalAttempts === 0) {
                    accuracyEl.textContent = '—';
                } else {
                    const accuracyPercent = Math.round((this.perfectAttempts / this.totalAttempts) * 100);
                    accuracyEl.textContent = `${accuracyPercent}%`;
                }
            }

            const nextUnlockEl = document.getElementById('stat-next-unlock-content');
            if (nextUnlockEl) {
                const nextUnlock = skillNodes.find(n => 
                    userProfile.nodes[n.id]?.status === 'locked' && 
                    n.prerequisites.every(pid => userProfile.nodes[pid]?.status === 'mastered')
                );
                if (nextUnlock) {
                    nextUnlockEl.textContent = `🔓 ${t('dash.readyToLearn', { name: nextUnlock.label })}`;
                } else {
                    const anyLocked = skillNodes.find(n => userProfile.nodes[n.id]?.status === 'locked');
                    if (anyLocked) {
                        const prereqs = anyLocked.prerequisites
                            .map(pid => skillNodes.find(pn => pn.id === pid))
                            .filter(n => n && (!userProfile.nodes[n.id] || userProfile.nodes[n.id].status !== 'mastered'))
                            .map(n => n.label)
                            .join(', ');
                        nextUnlockEl.textContent = prereqs ? t('dash.masterFirst', { names: prereqs }) : t('dash.reqMet');
                    } else {
                        nextUnlockEl.textContent = t('dash.allUnlocked');
                    }
                }
            }

            const weakestEl = document.getElementById('stat-weakest-area-content');
            let weakestNode = null;
            if (weakestEl) {
                const practiced = skillNodes.filter(n => (userProfile.nodes[n.id]?.mastery || 0) > 0);
                if (practiced.length === 0) {
                    weakestEl.textContent = t('dash.startPractice');
                } else {
                    weakestNode = practiced.reduce((a, b) => {
                        const masteryA = userProfile.nodes[a.id]?.mastery ?? 100;
                        const masteryB = userProfile.nodes[b.id]?.mastery ?? 100;
                        return masteryA < masteryB ? a : b;
                    });
                    const masteryPct = userProfile.nodes[weakestNode.id]?.mastery ?? 0;
                    weakestEl.textContent = `📍 ${weakestNode.label} (${masteryPct}%)`;
                }
            }

            const diagnosticCard = document.getElementById('diagnostic-card');
            const recommendedCountEl = document.getElementById('recommended-action-count');
            
            if (diagnosticCard) {
                const nodes = userProfile.nodes || {};

                // Fall back to the first unlocked node (or the very first node) so a brand-new
                // profile with zero practiced concepts still gets a working recommendation —
                // previously this rendered an empty card whose button had no click handler.
                let recommendNode = weakestNode
                    || skillNodes.find(n => nodes[n.id] && nodes[n.id].status !== 'locked')
                    || skillNodes[0];
                let title = "";
                let body = "";
                let tag = "";
                let btnText = t('rec.getStarted');

                const rMastery = (recommendNode && nodes[recommendNode.id]) ? nodes[recommendNode.id].mastery : 0;

                if (recommendNode) {
                    title = `<i class="fa-solid fa-microchip"></i> ${t('rec.adaptivePriority')}`;
                    tag = `<span class="tag tag-red">${t('rec.patternTag', { pct: rMastery })}</span>`;
                    body = t('rec.adaptiveBody', { name: recommendNode.label });
                    btnText = t('rec.beginBattle');
                    if (recommendedCountEl) recommendedCountEl.textContent = t('rec.oneAction');
                    const otherNodes = skillNodes.filter(n => n.id !== 'chap6exam');
                    const allOthers100 = otherNodes.every(n => (nodes[n.id]?.mastery || 0) >= 100);
                    const finalExamNode = skillNodes.find(n => n.id === 'chap6exam');
                    const finalStatus = nodes['chap6exam'];

                    if (allOthers100 && finalExamNode && (finalStatus?.mastery || 0) < 100) {
                        recommendNode = finalExamNode;
                        title = `<i class="fa-solid fa-graduation-cap"></i> ${t('rec.finalChallenge')}`;
                        tag = `<span class="tag tag-gold" style="background: rgba(255, 215, 0, 0.15); color: #ffd700; border: 1px solid rgba(255, 215, 0, 0.3);">${t('rec.unlocked')}</span>`;
                        body = t('rec.finalBody');
                        btnText = t('rec.startFinal');
                        if (recommendedCountEl) recommendedCountEl.textContent = t('rec.finalReady');
                    } else {
                        const nextAvailable = otherNodes.find(n => {
                            const nodeState = nodes[n.id];
                            if (!nodeState) return false;
                            if (nodeState.mastery < 100) {
                                return n.prerequisites.every(pid => (nodes[pid]?.mastery || 0) >= 30);
                            }
                            return false;
                        });

                        if (nextAvailable) {
                            recommendNode = nextAvailable;
                            const rNodeState = nodes[nextAvailable.id] || { mastery: 0 };
                            const curMastery = rNodeState.mastery || 0;

                            if (curMastery === 0) {
                                title = `<i class="fa-solid fa-rocket"></i> ${t('rec.getStarted')}`;
                                tag = `<span class="tag tag-blue" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa;">${t('rec.newTag')}</span>`;
                                body = t('rec.welcomeBody', { name: nextAvailable.label });
                                btnText = t('rec.startBattle');
                            } else if (curMastery < 95) {
                                title = `<i class="fa-solid fa-seedling"></i> ${t('rec.strengthen')}`;
                                tag = `<span class="tag tag-orange" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">${t('rec.partialTag', { pct: curMastery })}</span>`;
                                body = t('rec.strengthenBody', { name: nextAvailable.label });
                                btnText = t('rec.continueLearning');
                            } else {
                                title = `<i class="fa-solid fa-unlock"></i> ${t('rec.refineMastery')}`;
                                tag = `<span class="tag tag-green" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">${t('rec.reviewTag', { pct: curMastery })}</span>`;
                                body = t('rec.refineBody', { name: nextAvailable.label });
                                btnText = t('rec.refineSkill');
                            }

                            if (recommendedCountEl) recommendedCountEl.textContent = curMastery === 0 ? t('rec.beginFirst') : t('rec.buildProgress');
                        } else if (otherNodes.every(n => nodes[n.id]?.mastery >= 100)) {
                            title = `<i class="fa-solid fa-trophy"></i> ${t('rec.master')}`;
                            tag = `<span class="tag" style="background: var(--tag-green-bg); color: var(--tag-green-text);">${t('rec.champion')}</span>`;
                            body = t('rec.masterBody');
                            btnText = t('rec.reviewSkill');
                            if (recommendedCountEl) recommendedCountEl.textContent = t('rec.complete');
                        } else {
                            const firstNode = skillNodes[0];
                            recommendNode = firstNode;
                            title = `<i class="fa-solid fa-rocket"></i> ${t('rec.getStarted')}`;
                            tag = `<span class="tag tag-blue" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa;">${t('rec.newTag')}</span>`;
                            body = t('rec.welcomeBody', { name: firstNode ? firstNode.label : 'Mathematics' });
                            btnText = t('rec.startBattle');
                            if (recommendedCountEl) recommendedCountEl.textContent = t('rec.beginFirst');
                        }
                    }
                }

                diagnosticCard.innerHTML = `
                    <div class="card-header">
                        <h3>${title}</h3>
                        ${tag}
                    </div>
                    <div class="card-body">
                        <p>${body}</p>
                        <div class="action-btn-container">
                            <button class="btn btn-primary" id="start-battle-btn">${btnText}</button>
                        </div>
                    </div>
                `;

                const newStartBtn = document.getElementById('start-battle-btn');
                if (newStartBtn && recommendNode) {
                    newStartBtn.onclick = (e) => {
                        e.preventDefault();
                        if (window.BattleArena && window.BattleArena.startBattle) window.BattleArena.startBattle(recommendNode.id);
                    };
                }
            } else {
                if (recommendedCountEl) recommendedCountEl.textContent = t('dash.checkTree');
            }
        } catch (err) {
            console.warn('[DASHBOARD] Caught error in updateStats:', err);
        }
    },

    // Increments accuracy rate variables based on answer correctness
    recordAttempt(isCorrect) {
        this.totalAttempts++;
        if (isCorrect) {
            this.perfectAttempts++;
        }
    }
};
