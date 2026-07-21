window.ProgressionManager = (function() {
    let userProfile = null;

    // Restores profile state from localStorage and runs dashboard rendering updates
    function init() {
        if (!window.DB) return;
        if (!userProfile) {
            const saved = localStorage.getItem('meritsProfile_v2');
            if (saved) {
                try {
                    userProfile = JSON.parse(saved);
                    window.DB.skillNodes.forEach(n => {
                        if (!userProfile.nodes[n.id]) {
                            userProfile.nodes[n.id] = { status: n.status, mastery: n.mastery, startStep: 0 };
                        }
                    });
                } catch (e) {
                    userProfile = null;
                }
            }
        }
        if (!userProfile) return; 
        updateDashboardUI();
    }

    // Creates and initializes a new user profile with standard starting metrics
    function initProfile(name, grade, confidence) {
        userProfile = {
            name: name || 'Student',
            grade: grade || 'Grade 11',
            confidence: confidence || 3,
            xp: 0,
            level: 1,
            questTime: 0,
            nodes: {}
        };
        window.DB.skillNodes.forEach(n => {
            userProfile.nodes[n.id] = { status: n.status, mastery: n.mastery, startStep: 0 };
        });
        saveProfile();
        updateDashboardUI();
        return userProfile;
    }

    // Persists profile structure in browser storage and fires stats updates
    function saveProfile() {
        if (!userProfile) return;
        localStorage.setItem('meritsProfile_v2', JSON.stringify(userProfile));
        syncDBWithProfile();
        updateDashboardUI();
        if (window.DashboardStats) window.DashboardStats.updateStats();
    }

    // Syncs skill tree memory flags based on active mastery values
    function syncDBWithProfile() {
        if (!userProfile || !window.DB) return;
        window.DB.skillNodes.forEach(node => {
            const savedNode = userProfile.nodes[node.id];
            if (savedNode) {
                const mastery = savedNode.mastery || 0;
                const isLocked = node.prerequisites && node.prerequisites.length > 0 &&
                    !node.prerequisites.every(pid => (userProfile.nodes[pid]?.mastery || 0) >= 30);
                if (isLocked) {
                    node.status = 'locked';
                } else {
                    node.status = (mastery >= 95) ? 'mastered' : 'partial';
                }
                node.mastery = mastery;
                savedNode.status = node.status;
            }
        });
    }

    // Dynamically appends a brief floating XP alert box to the DOM
    function showXPToast(xpStr) {
        const toast = document.createElement('div');
        toast.className = 'xp-toast';
        toast.innerHTML = `<i class="fa-solid fa-star"></i> ${xpStr.toString().includes('Level') ? xpStr : '+' + xpStr + ' XP'}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // Increases accumulated XP points and triggers level-up transitions if valid
    function addXP(amount) {
        userProfile.xp += amount;
        const newLevel = Math.floor(Math.sqrt(userProfile.xp / 10)) + 1;
        if (newLevel > userProfile.level) {
            userProfile.level = newLevel;
            showXPToast(window.I18n.t('toast.levelUp', { n: newLevel }));
        }
        saveProfile();
    }

    // Updates text values, avatars, daily study goals, and top concepts in the dashboard UI
    function updateDashboardUI() {
        if (!userProfile) return;
        const dashName = document.getElementById('dash-user-name');
        const sidebarName = document.querySelector('.user-name');
        const sidebarAvatar = document.querySelector('.avatar');
        if (dashName) dashName.textContent = userProfile.name;
        if (sidebarName) sidebarName.textContent = userProfile.name;
        if (sidebarAvatar) sidebarAvatar.textContent = userProfile.name.charAt(0).toUpperCase();

        const uiLevel = document.getElementById('ui-user-level');
        if (uiLevel) {
            uiLevel.textContent = window.I18n.t('user.level', { n: userProfile.level });
        }

        const progressBar = document.getElementById('quest-progress-bar');
        const progressText = document.getElementById('quest-progress-text');
        const questFocus = document.getElementById('quest-focus');
        if (progressBar && progressText) {
            const minutes = Math.min(15, userProfile.questTime || 0);
            progressBar.style.width = `${(minutes / 15) * 100}%`;
            progressText.textContent = window.I18n.t('quest.mins', { n: minutes });
            if (questFocus) {
                const skillNodes = window.DB.skillNodes;
                const practiced = skillNodes.filter(n => userProfile.nodes[n.id]?.mastery > 0);
                const weakest = practiced.length > 0 ? practiced.reduce((a, b) =>
                    userProfile.nodes[a.id].mastery < userProfile.nodes[b.id].mastery ? a : b
                ) : null;
                if (weakest && userProfile.nodes[weakest.id].mastery < 85) {
                    questFocus.textContent = window.I18n.t('quest.focus', { name: weakest.label });
                } else {
                    const nextAvailable = skillNodes.find(n => {
                        const status = userProfile.nodes[n.id]?.status;
                        if (status === 'mastered') return false;
                        if (status === 'partial') return true;
                        if (status === 'locked') {
                            return n.prerequisites.every(pid => userProfile.nodes[pid]?.status === 'mastered');
                        }
                        return false;
                    });
                    questFocus.textContent = nextAvailable ? window.I18n.t('quest.nextUp', { name: nextAvailable.label }) : window.I18n.t('quest.allMastered');
                }
            }
        }

        const masteryList = document.getElementById('mastery-list');
        if (masteryList) {
            masteryList.innerHTML = '';
            const practizedNodes = window.DB.skillNodes
                .filter(n => userProfile.nodes[n.id] && userProfile.nodes[n.id].mastery > 0)
                .sort((a, b) => userProfile.nodes[b.id].mastery - userProfile.nodes[a.id].mastery)
                .slice(0, 3);
            if (practizedNodes.length === 0) {
                masteryList.innerHTML = `<li><em>${window.I18n.t('dash.noConceptsYet')}</em></li>`;
            } else {
                practizedNodes.forEach(node => {
                    const mst = userProfile.nodes[node.id].mastery;
                    const li = document.createElement('li');
                    li.innerHTML = `${node.label} <span class="mastery-score ${mst >= 85 ? 'high' : (mst > 40 ? 'medium' : 'low')}" id="mastery-${node.id}">${mst}%</span>`;
                    masteryList.appendChild(li);
                });
            }
        }
        if (window.DashboardStats) {
            window.DashboardStats.updateStats();
        }
    }

    // Resolves complete challenge stats, updates local mastery percentages, and advances unlocks
    function completeQuest(nodeId, currentMistakes, elapsedSeconds, solvedCount = 0, totalCount = 1) {
        const baseXP = 100;
        const xpEarned = Math.max(10, baseXP - (currentMistakes * 15));
        const performanceFactor = Math.max(0.1, (100 - (currentMistakes * 10)) / 100);
        const solveRate = solvedCount / Math.max(1, totalCount);
        const masteryEarned = Math.round(100 * performanceFactor * solveRate);

        showXPToast(xpEarned);
        const nodeData = window.DB.skillNodes.find(n => n.id === nodeId);
        if (nodeData) {
            nodeData.mastery = Math.min(100, (nodeData.mastery || 0) + masteryEarned);
            nodeData.status = (nodeData.mastery >= 95) ? 'mastered' : 'partial';
            userProfile.nodes[nodeId] = { 
                status: nodeData.status, 
                mastery: nodeData.mastery,
                startStep: userProfile.nodes[nodeId]?.startStep || 0 
            };
        }

        window.DB.skillEdges.forEach(edge => {
            if (edge.from === nodeId && nodeData && nodeData.status === 'mastered') {
                const child = window.DB.skillNodes.find(n => n.id === edge.to);
                if (child && child.status === 'locked') {
                    const allPrereqsMet = child.prerequisites.every(pid => {
                        const prereq = window.DB.skillNodes.find(n => n.id === pid);
                        return prereq && prereq.status === 'mastered';
                    });
                    if (allPrereqsMet) {
                        child.status = 'partial';
                        child.mastery = 0;
                        userProfile.nodes[child.id] = { status: 'partial', mastery: 0 };
                    }
                }
            }
        });

        const elapsedMinutes = Math.min(15, Math.max(1, Math.round(elapsedSeconds / 60)));
        userProfile.questTime = (userProfile.questTime || 0) + elapsedMinutes;
        addXP(xpEarned);

        return { nodeData, masteryEarned };
    }

    return {
        init,
        initProfile,
        saveProfile,
        syncDBWithProfile,
        completeQuest,
        getProfile: () => userProfile
    };
})();
