window.DashboardStats = {
    perfectAttempts: 0,
    totalAttempts: 0,

    // Recalculates concepts mastered, accuracy ratios, next unlocks, and adaptive priorities
    updateStats() {
        try {
            if (!window.ProgressionManager || !window.DB) return;
            const userProfile = window.ProgressionManager.getProfile();
            if (!userProfile) return;

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
                    nextUnlockEl.textContent = `🔓 ${nextUnlock.label} is ready!`;
                } else {
                    const anyLocked = skillNodes.find(n => userProfile.nodes[n.id]?.status === 'locked');
                    if (anyLocked) {
                        const prereqs = anyLocked.prerequisites
                            .map(pid => skillNodes.find(pn => pn.id === pid))
                            .filter(n => n && (!userProfile.nodes[n.id] || userProfile.nodes[n.id].status !== 'mastered'))
                            .map(n => n.label)
                            .join(', ');
                        nextUnlockEl.textContent = prereqs ? `Master: ${prereqs}` : 'Requirement met!';
                    } else {
                        nextUnlockEl.textContent = 'All skills unlocked!';
                    }
                }
            }

            const weakestEl = document.getElementById('stat-weakest-area-content');
            let weakestNode = null;
            if (weakestEl) {
                const practiced = skillNodes.filter(n => (userProfile.nodes[n.id]?.mastery || 0) > 0);
                if (practiced.length === 0) {
                    weakestEl.textContent = 'Start practicing to see recommendations';
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
                let btnText = "Start Practice";

                const rMastery = (recommendNode && nodes[recommendNode.id]) ? nodes[recommendNode.id].mastery : 0;

                if (recommendNode) {
                    title = `<i class="fa-solid fa-microchip"></i> Adaptive Priority`;
                    tag = `<span class="tag tag-red">Pattern-Based: ${rMastery}%</span>`;
                    body = `Intelligence analysis suggests prioritizing <strong>${recommendNode.label}</strong> to optimize your mastery path.`;
                    btnText = "Begin Socratic Battle";
                    if (recommendedCountEl) recommendedCountEl.textContent = "You have 1 recommended action based on pattern analysis.";
                    const otherNodes = skillNodes.filter(n => n.id !== 'chap6exam');
                    const allOthers100 = otherNodes.every(n => (nodes[n.id]?.mastery || 0) >= 100);
                    const finalExamNode = skillNodes.find(n => n.id === 'chap6exam');
                    const finalStatus = nodes['chap6exam'];

                    if (allOthers100 && finalExamNode && (finalStatus?.mastery || 0) < 100) {
                        recommendNode = finalExamNode;
                        title = `<i class="fa-solid fa-graduation-cap"></i> Final Challenge`;
                        tag = `<span class="tag tag-gold" style="background: rgba(255, 215, 0, 0.15); color: #ffd700; border: 1px solid rgba(255, 215, 0, 0.3);">UNLOCKED</span>`;
                        body = `Outstanding achievement! You have reached 100% mastery in all topics. You are now prepared for the <strong>Final Exam</strong>.`;
                        btnText = "Start Final Exam";
                        if (recommendedCountEl) recommendedCountEl.textContent = "It's time. The final assessment is ready for you.";
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
                                title = `<i class="fa-solid fa-rocket"></i> Get Started`;
                                tag = `<span class="tag tag-blue" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa;">New</span>`;
                                body = `Welcome! Start your journey by mastering <strong>${nextAvailable.label}</strong> through a Socratic battle.`;
                                btnText = "Start Socratic Battle";
                            } else if (curMastery < 95) {
                                title = `<i class="fa-solid fa-seedling"></i> Strengthen Foundation`;
                                tag = `<span class="tag tag-orange" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">Partial: ${curMastery}%</span>`;
                                body = `You've made progress on <strong>${nextAvailable.label}</strong>! Continue your Socratic battle to secure this foundation.`;
                                btnText = "Continue Learning";
                            } else {
                                title = `<i class="fa-solid fa-unlock"></i> Refine Mastery`;
                                tag = `<span class="tag tag-green" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">Review: ${curMastery}%</span>`;
                                body = `Excellent foundation in <strong>${nextAvailable.label}</strong>. Practice now to achieve perfect 100% mastery.`;
                                btnText = "Refine This Skill";
                            }
                            
                            if (recommendedCountEl) recommendedCountEl.textContent = curMastery === 0 ? "Begin your first challenge today." : "You have progress to build upon.";
                        } else if (otherNodes.every(n => nodes[n.id]?.mastery >= 100)) {
                            title = `<i class="fa-solid fa-trophy"></i> Master of Logarithms`;
                            tag = `<span class="tag" style="background: var(--tag-green-bg); color: var(--tag-green-text);">Champion</span>`;
                            body = `Legendary! You have completed the curriculum at 100% proficiency. You can review any skill anytime!`;
                            btnText = "Review a Skill";
                            if (recommendedCountEl) recommendedCountEl.textContent = "Curriculum complete. You have achieved peak mastery.";
                        } else {
                            const firstNode = skillNodes[0];
                            recommendNode = firstNode;
                            title = `<i class="fa-solid fa-rocket"></i> Get Started`;
                            tag = `<span class="tag tag-blue" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa;">New</span>`;
                            body = `Welcome! Start your journey by mastering <strong>${firstNode ? firstNode.label : 'Mathematics'}</strong> through a Socratic battle.`;
                            btnText = "Start Socratic Battle";
                            if (recommendedCountEl) recommendedCountEl.textContent = "Begin your first challenge today.";
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
                if (recommendedCountEl) recommendedCountEl.textContent = "Welcome back! Check your tree.";
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
