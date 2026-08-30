(function () {
    "use strict";

    // ============================================================
    // 1. CONSTANTES
    // ============================================================

    const STORAGE_KEY = 'torneoData_v18';
    const TORNEO_LIST_KEY = 'torneoList_v1';
    const THEME_STORAGE_KEY = 'beybladex_theme';

    // ============================================================
    // 2. ESTADO GLOBAL
    // ============================================================

    let tournamentName = 'LaMafia BEYBLADEX';
    let tournamentVisible = false;
    let tournamentFinished = false;
    let tournamentWinner = null;
    let tournamentId = null; // ID único para el torneo actual

    // Participantes
    let participants = [];
    let accumulatedPoints = {};

    // Helpers
    function generateParticipantId() {
        return 'p_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 10000);
    }

    function generateTournamentId() {
        return 't_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000000);
    }

    function getParticipantById(id) {
        if (!id) return null;
        return participants.find(p => p && (p.id === id || p.id === String(id))) || null;
    }

    function getParticipantNameById(id) {
        const p = getParticipantById(id);
        return p ? p.name : null;
    }

    function getParticipantIdByName(name) {
        if (!name) return null;
        const p = participants.find(p => p && p.name === name);
        return p ? p.id : null;
    }

    function participantExistsByName(name) {
        const normalized = (name || '').trim().toLocaleLowerCase();
        return participants.some(p => p && (p.name || '').trim().toLocaleLowerCase() === normalized);
    }

    function ensureParticipantsObjects() {
        if (participants.length === 0) return;
        if (participants[0] && typeof participants[0] === 'string') {
            const names = [...participants];
            participants = names.map(n => ({ id: generateParticipantId(), name: n }));
            const newAccum = {};
            for (const p of participants) {
                newAccum[p.id] = (accumulatedPoints && (accumulatedPoints[p.name] || accumulatedPoints[p.id])) || 0;
            }
            accumulatedPoints = newAccum;
            const nameToId = {};
            participants.forEach(p => nameToId[p.name] = p.id);
            versus.forEach(v => {
                if (v.playerA && nameToId[v.playerA]) v.playerAId = nameToId[v.playerA];
                if (v.playerB && nameToId[v.playerB]) v.playerBId = nameToId[v.playerB];
            });
            matchHistory.forEach(h => {
                if (h.playerA && nameToId[h.playerA]) h.playerAId = nameToId[h.playerA];
                if (h.playerB && nameToId[h.playerB]) h.playerBId = nameToId[h.playerB];
            });
        }
    }

    // Partidos
    let versus = [];
    let matchHistory = [];
    let nextVersusId = 1;

    // Fases
    let currentPhase = 1;
    let groupRound = 0;
    let knockoutRound = 0;
    let currentPhaseView = 'groups';
    let selectedRound = 'all';

    // Configuración
    let customQualifiedCount = 8;

    // Eliminatorias
    let semifinalLosers = [];
    let semifinalWinners = [];
    let preFinalMatch = null;
    let preFinalPlayed = false;
    let finalMatch = null;
    let finalPlayed = false;

    // Podio
    let podium = {
        first: null,
        second: null,
        third: null,
        fourth: null
    };

    // ============================================================
    // 3. DOM REFS
    // ============================================================

    // Header
    const headerParticipants = document.getElementById('headerParticipants');
    const headerMatches = document.getElementById('headerMatches');
    const headerRounds = document.getElementById('headerRounds');
    const headerQualified = document.getElementById('headerQualified');
    const storageStatusEl = document.getElementById('storageStatus');
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    // Tema
    function applyTheme(theme) {
        const isLight = theme === 'light';
        document.body.classList.toggle('light-theme', isLight);
        if (themeToggleBtn) {
            themeToggleBtn.textContent = isLight ? '🌙 Tema oscuro' : '☀️ Tema claro';
            themeToggleBtn.setAttribute('aria-pressed', String(isLight));
            themeToggleBtn.title = isLight ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';
        }
    }

    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'dark');
    themeToggleBtn?.addEventListener('click', function () {
        const nextTheme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
    });

    // Participantes
    const participantListEl = document.getElementById('participantListContainer');
    const totalParticipantsDisplay = document.getElementById('totalParticipantsDisplay');
    const participantCountBadge = document.getElementById('participantCountBadge');
    const newParticipantInput = document.getElementById('newParticipantInput');
    const addBtn = document.getElementById('addParticipantBtn');
    const addMultipleBtn = document.getElementById('addMultipleBtn');

    // Torneo
    const createTournamentBtn = document.getElementById('createTournamentBtn');
    const listTournamentsBtn = document.getElementById('listTournamentsBtn');

    // Enfrentamientos
    const versusListEl = document.getElementById('versusListContainer');
    const roundSelectorContainer = document.getElementById('roundSelectorContainer');
    const phaseDisplayEl = document.getElementById('phaseDisplay');
    const roundDisplayEl = document.getElementById('roundDisplay');
    const winnerMessageEl = document.getElementById('winnerMessage');
    const thirdPlaceMessageEl = document.getElementById('thirdPlaceMessage');

    // Estadísticas
    const scoreSummaryEl = document.getElementById('scoreSummaryContainer');
    const totalScoreTableEl = document.getElementById('totalScoreTableContainer');
    const totalMatchesDisplay = document.getElementById('totalMatchesDisplay');
    const totalRoundsDisplay = document.getElementById('totalRoundsDisplay');
    const qualifiedCountDisplay = document.getElementById('qualifiedCountDisplay');
    const qualifiedCountInput = document.getElementById('qualifiedCountInput');
    const applyQualifiedBtn = document.getElementById('applyQualifiedBtn');

    // Gestión de rondas
    const generateGroupBtn = document.getElementById('generateGroupStageBtn');
    const startKnockoutBtn = document.getElementById('startKnockoutBtn');
    const resetAllBtn = document.getElementById('resetAllBtn');
    const clearVersusBtn = document.getElementById('clearVersusBtn');

    // Import/Export
    const exportDataBtn = document.getElementById('exportDataBtn');
    const importDataBtn = document.getElementById('importDataBtn');
    const fileInput = document.getElementById('fileInput');

    // ============================================================
    // 4. FUNCIONES DE LOCALSTORAGE
    // ============================================================

    function saveToLocalStorage() {
        try {
            // Guardar torneo actual
            const data = {
                tournamentId,
                tournamentName,
                participants,
                versus,
                matchHistory,
                nextVersusId,
                currentPhase,
                tournamentWinner,
                knockoutRound,
                groupRound,
                accumulatedPoints,
                customQualifiedCount,
                tournamentFinished,
                semifinalLosers,
                semifinalWinners,
                preFinalMatch,
                preFinalPlayed,
                finalMatch,
                finalPlayed,
                podium,
                tournamentVisible
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

            // Guardar en la lista de torneos
            saveTournamentToList();

            storageStatusEl.textContent = '💾 Datos guardados';
            storageStatusEl.style.background = 'rgba(223, 240, 230, 0.9)';
            storageStatusEl.style.color = '#1e5a3a';
            setTimeout(() => {
                storageStatusEl.style.background = 'rgba(240, 244, 249, 0.8)';
                storageStatusEl.style.color = '#6e7f94';
            }, 2000);
        } catch (e) {
            console.error('Error al guardar en localStorage:', e);
            storageStatusEl.textContent = '❌ Error al guardar';
            storageStatusEl.style.background = 'rgba(252, 233, 236, 0.9)';
            storageStatusEl.style.color = '#a13d4b';
        }
    }

    function loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;

            const data = JSON.parse(stored);
            tournamentId = data.tournamentId || null;
            tournamentName = data.tournamentName || 'LaMafia BEYBLADEX';
            participants = data.participants || [];
            versus = data.versus || [];
            matchHistory = data.matchHistory || [];
            nextVersusId = data.nextVersusId || 1;
            currentPhase = data.currentPhase || 1;
            tournamentWinner = data.tournamentWinner || null;
            knockoutRound = data.knockoutRound || 0;
            groupRound = data.groupRound || 0;
            accumulatedPoints = data.accumulatedPoints || {};
            customQualifiedCount = data.customQualifiedCount || 8;
            tournamentFinished = data.tournamentFinished || false;
            semifinalLosers = data.semifinalLosers || [];
            semifinalWinners = data.semifinalWinners || [];
            preFinalMatch = data.preFinalMatch || null;
            preFinalPlayed = data.preFinalPlayed || false;
            finalMatch = data.finalMatch || null;
            finalPlayed = data.finalPlayed || false;
            podium = data.podium || { first: null, second: null, third: null, fourth: null };
            tournamentVisible = data.tournamentVisible || false;

            ensureParticipantsObjects();
            participants.forEach(p => {
                if (!(p.id in accumulatedPoints)) accumulatedPoints[p.id] = accumulatedPoints[p.name] || 0;
            });

            recalculateAccumulatedPoints();
            qualifiedCountInput.value = customQualifiedCount;

            storageStatusEl.textContent = '✅ Datos cargados';
            storageStatusEl.style.background = 'rgba(223, 240, 230, 0.9)';
            storageStatusEl.style.color = '#1e5a3a';
            setTimeout(() => {
                storageStatusEl.style.background = 'rgba(240, 244, 249, 0.8)';
                storageStatusEl.style.color = '#6e7f94';
            }, 2000);

            renderAll();
            return true;
        } catch (e) {
            console.error('Error al cargar desde localStorage:', e);
            return false;
        }
    }

    // ============================================================
    // 5. GESTIÓN DE LISTA DE TORNEOS
    // ============================================================

    function getTournamentList() {
        try {
            const stored = localStorage.getItem(TORNEO_LIST_KEY);
            if (!stored) return [];
            return JSON.parse(stored);
        } catch (e) {
            return [];
        }
    }

    function saveTournamentToList() {
        try {
            let list = getTournamentList();
            
            // Buscar si ya existe este torneo
            const existingIndex = list.findIndex(t => t.id === tournamentId);
            
            const entry = {
                id: tournamentId || generateTournamentId(),
                name: tournamentName,
                participantes: participants.length,
                fecha: new Date().toISOString(),
                finalizado: tournamentFinished,
                currentPhase: currentPhase
            };

            if (!tournamentId) {
                tournamentId = entry.id;
            }

            if (existingIndex >= 0) {
                list[existingIndex] = entry;
            } else {
                list.push(entry);
            }

            localStorage.setItem(TORNEO_LIST_KEY, JSON.stringify(list));
        } catch (e) {
            console.error('Error al guardar lista de torneos:', e);
        }
    }

    function deleteTournamentFromList(id) {
        try {
            let list = getTournamentList();
            list = list.filter(t => t.id !== id);
            localStorage.setItem(TORNEO_LIST_KEY, JSON.stringify(list));
        } catch (e) {
            console.error('Error al eliminar torneo de la lista:', e);
        }
    }

    function loadTournamentById(id) {
        try {
            // Guardar el torneo actual antes de cargar otro
            if (tournamentId && tournamentId !== id) {
                saveToLocalStorage();
            }

            // Buscar en la lista de torneos guardados
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;

            const data = JSON.parse(stored);
            if (data.tournamentId !== id) return false;

            // Aplicar datos
            tournamentId = data.tournamentId;
            tournamentName = data.tournamentName || 'LaMafia BEYBLADEX';
            participants = data.participants || [];
            versus = data.versus || [];
            matchHistory = data.matchHistory || [];
            nextVersusId = data.nextVersusId || 1;
            currentPhase = data.currentPhase || 1;
            tournamentWinner = data.tournamentWinner || null;
            knockoutRound = data.knockoutRound || 0;
            groupRound = data.groupRound || 0;
            accumulatedPoints = data.accumulatedPoints || {};
            customQualifiedCount = data.customQualifiedCount || 8;
            tournamentFinished = data.tournamentFinished || false;
            semifinalLosers = data.semifinalLosers || [];
            semifinalWinners = data.semifinalWinners || [];
            preFinalMatch = data.preFinalMatch || null;
            preFinalPlayed = data.preFinalPlayed || false;
            finalMatch = data.finalMatch || null;
            finalPlayed = data.finalPlayed || false;
            podium = data.podium || { first: null, second: null, third: null, fourth: null };
            tournamentVisible = data.tournamentVisible || false;

            ensureParticipantsObjects();
            participants.forEach(p => {
                if (!(p.id in accumulatedPoints)) accumulatedPoints[p.id] = accumulatedPoints[p.name] || 0;
            });

            recalculateAccumulatedPoints();
            qualifiedCountInput.value = customQualifiedCount;
            renderAll();
            saveToLocalStorage();
            return true;
        } catch (e) {
            console.error('Error al cargar torneo:', e);
            return false;
        }
    }

    // ============================================================
    // 6. FUNCIONES DE PARTICIPANTES
    // ============================================================

    function addParticipant(name) {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        if (participantExistsByName(trimmed)) return null;
        const id = generateParticipantId();
        const obj = { id, name: trimmed };
        participants.push(obj);
        accumulatedPoints[id] = accumulatedPoints[id] || 0;
        saveToLocalStorage();
        return obj;
    }

    function removeParticipantById(id) {
        const idx = participants.findIndex(p => p.id === id);
        if (idx === -1) return false;
        const name = participants[idx].name;
        participants.splice(idx, 1);
        if (accumulatedPoints && Object.prototype.hasOwnProperty.call(accumulatedPoints, id)) {
            delete accumulatedPoints[id];
        }
        versus = versus.filter(v => {
            const aId = v.playerAId || getParticipantIdByName(v.playerA);
            const bId = v.playerBId || getParticipantIdByName(v.playerB);
            return aId !== id && bId !== id && v.playerA !== name && v.playerB !== name;
        });
        matchHistory = matchHistory.filter(h => {
            const aId = h.playerAId || getParticipantIdByName(h.playerA);
            const bId = h.playerBId || getParticipantIdByName(h.playerB);
            return aId !== id && bId !== id && h.playerA !== name && h.playerB !== name;
        });
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
        return true;
    }

    function renameParticipant(id, newName) {
        const p = getParticipantById(id);
        if (!p) return;
        const oldName = p.name;
        p.name = newName;

        versus.forEach(v => {
            if (v.playerAId === id || v.playerA === oldName) {
                v.playerA = newName;
                v.playerAId = id;
            }
            if (v.playerBId === id || v.playerB === oldName) {
                v.playerB = newName;
                v.playerBId = id;
            }
        });
        matchHistory.forEach(h => {
            if (h.playerAId === id || h.playerA === oldName) {
                h.playerA = newName;
                h.playerAId = id;
            }
            if (h.playerBId === id || h.playerB === oldName) {
                h.playerB = newName;
                h.playerBId = id;
            }
        });

        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function clearAllParticipants() {
        const hasMatches = matchHistory.some(v => v.playerA || v.playerB);
        const hasVersus = versus.some(v => v.playerA || v.playerB);

        if (hasMatches || hasVersus) {
            alert('❌ No se pueden borrar los participantes porque tienen partidos registrados.\n\nPrimero debes reiniciar el torneo o archivar las rondas.');
            renderAll();
            saveToLocalStorage();
            return;
        }

        if (participants.length === 0) {
            alert('No hay participantes para borrar.');
            renderAll();
            saveToLocalStorage();
            return;
        }

        if (!confirm(`⚠️ ¿Estás seguro de borrar TODOS los ${participants.length} participantes?\n\nEsta acción no se puede deshacer.`)) {
            renderAll();
            saveToLocalStorage();
            return;
        }

        participants = [];
        accumulatedPoints = {};
        tournamentVisible = false;
        document.getElementById('tournamentSection').style.display = 'none';
        renderAll();
        saveToLocalStorage();
        alert('✅ Todos los participantes han sido eliminados.');
    }

    // ============================================================
    // 7. FUNCIONES DE PUNTUACIÓN
    // ============================================================

    function getAccumulatedScore(identifier) {
        if (!identifier) return 0;
        if (accumulatedPoints[identifier] !== undefined) return accumulatedPoints[identifier] || 0;
        const id = getParticipantIdByName(identifier);
        if (id && accumulatedPoints[id] !== undefined) return accumulatedPoints[id] || 0;
        return 0;
    }

    function recalculateAccumulatedPoints() {
        ensureParticipantsObjects();

        participants.forEach(p => {
            if (p && p.id) accumulatedPoints[p.id] = 0;
        });

        const POINTS_PER_WIN = 3;

        for (let v of matchHistory) {
            if (v.round && v.round > 0) {
                const aId = v.playerAId || getParticipantIdByName(v.playerA);
                const bId = v.playerBId || getParticipantIdByName(v.playerB);
                if (v.scoreA > v.scoreB) {
                    if (aId) accumulatedPoints[aId] = (accumulatedPoints[aId] || 0) + POINTS_PER_WIN;
                } else if (v.scoreB > v.scoreA) {
                    if (bId) accumulatedPoints[bId] = (accumulatedPoints[bId] || 0) + POINTS_PER_WIN;
                }
            }
        }

        for (let v of versus) {
            if (v.round && v.round > 0) {
                const existsInHistory = matchHistory.some(h =>
                    h.id === v.id &&
                    (h.playerAId === v.playerAId || h.playerA === v.playerA) &&
                    (h.playerBId === v.playerBId || h.playerB === v.playerB)
                );
                if (!existsInHistory) {
                    const aId = v.playerAId || getParticipantIdByName(v.playerA);
                    const bId = v.playerBId || getParticipantIdByName(v.playerB);
                    if (v.scoreA > v.scoreB) {
                        if (aId) accumulatedPoints[aId] = (accumulatedPoints[aId] || 0) + POINTS_PER_WIN;
                    } else if (v.scoreB > v.scoreA) {
                        if (bId) accumulatedPoints[bId] = (accumulatedPoints[bId] || 0) + POINTS_PER_WIN;
                    }
                }
            }
        }
    }

    function getGroupRanking() {
        const groupMatches = [...matchHistory, ...versus].filter(v => v.round && v.round > 0);
        const ranking = participants.map(p => {
            const pid = p.id || getParticipantIdByName(p.name || p);
            const points = getAccumulatedScore(pid);

            const playerMatches = groupMatches.filter(v => {
                const aId = v.playerAId || getParticipantIdByName(v.playerA);
                const bId = v.playerBId || getParticipantIdByName(v.playerB);
                return aId === pid || bId === pid || v.playerA === p.name || v.playerB === p.name;
            });

            const wins = playerMatches.filter(v => {
                const aId = v.playerAId || getParticipantIdByName(v.playerA);
                const bId = v.playerBId || getParticipantIdByName(v.playerB);
                if (aId === pid) return v.scoreA > v.scoreB;
                if (bId === pid) return v.scoreB > v.scoreA;
                if (v.playerA === p.name) return v.scoreA > v.scoreB;
                if (v.playerB === p.name) return v.scoreB > v.scoreA;
                return false;
            }).length;

            let pointsFor = 0, pointsAgainst = 0;
            playerMatches.forEach(v => {
                if ((v.playerAId && v.playerAId === pid) || v.playerA === p.name) {
                    pointsFor += v.scoreA || 0;
                    pointsAgainst += v.scoreB || 0;
                } else {
                    pointsFor += v.scoreB || 0;
                    pointsAgainst += v.scoreA || 0;
                }
            });
            const pointDifference = pointsFor - pointsAgainst;

            return { id: pid, name: p.name, points, wins, pointDifference };
        });

        ranking.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
            return (b.wins || 0) - (a.wins || 0);
        });
        return ranking;
    }

    function getQualifiedCount() {
        const total = participants.length;
        if (customQualifiedCount >= 2 && customQualifiedCount <= total) {
            return customQualifiedCount;
        }
        if (total < 2) return 0;
        if (total <= 4) return 2;
        if (total <= 6) return 4;
        if (total <= 10) return 4;
        if (total <= 14) return 8;
        if (total <= 20) return 8;
        if (total <= 28) return 16;
        return 16;
    }

    function getTotalRounds() {
        const rounds = new Set();
        matchHistory.forEach(v => {
            if (v.round && v.round > 0) rounds.add(v.round);
        });
        versus.forEach(v => {
            if (v.round && v.round > 0) rounds.add(v.round);
        });
        return rounds.size;
    }

    function getAvailableRounds() {
        const rounds = new Set();
        matchHistory.forEach(v => {
            if (v.round && v.round > 0) rounds.add(v.round);
        });
        versus.forEach(v => {
            if (v.round && v.round > 0) rounds.add(v.round);
        });
        return Array.from(rounds).sort((a, b) => a - b);
    }

    // ============================================================
    // 8. FUNCIONES DE GENERACIÓN DE PARTIDOS
    // ============================================================

    function generatePairings(players) {
        const shuffled = [...players];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const pairings = [];
        const numPairs = Math.floor(shuffled.length / 2);

        for (let i = 0; i < numPairs; i++) {
            const a = shuffled[i * 2];
            const b = shuffled[i * 2 + 1];
            const aName = (typeof a === 'string') ? a : (a && a.name) || '';
            const bName = (typeof b === 'string') ? b : (b && b.name) || '';
            const aId = (typeof a === 'object' && a && a.id) ? a.id : getParticipantIdByName(aName);
            const bId = (typeof b === 'object' && b && b.id) ? b.id : getParticipantIdByName(bName);
            pairings.push({ playerA: aName, playerB: bName, playerAId: aId, playerBId: bId });
        }

        return pairings;
    }

    function getKnockoutRoundName(round) {
        const names = {
            2: '🏆 FINAL',
            4: '🥇 SEMIFINAL',
            8: '⚔️ CUARTOS DE FINAL',
            16: '⚔️ OCTAVOS DE FINAL',
            32: '⚔️ 16AVOS DE FINAL',
            64: '⚔️ 32AVOS DE FINAL'
        };
        return names[round] || `⚔️ Ronda ${round}`;
    }

    function getRoundTitle() {
        if (currentPhase === 1) {
            return `📋 Fase de Grupos - Ronda ${groupRound}`;
        } else if (currentPhase === 2 && tournamentFinished) {
            return '🏆 TORNEO FINALIZADO';
        } else if (currentPhase === 2) {
            if (preFinalMatch && !preFinalPlayed) {
                return '🥉 PRE-FINAL (3er y 4to Lugar)';
            }
            if (finalMatch && !finalPlayed) {
                return '🏆 FINAL';
            }
            const activePlayers = new Set();
            versus.forEach(v => {
                activePlayers.add(v.playerA);
                activePlayers.add(v.playerB);
            });
            const count = activePlayers.size;
            const roundName = getKnockoutRoundName(count);
            return `${roundName} (${count} jugadores)`;
        }
        return '⚔️ Enfrentamientos';
    }

    function archiveMatches(matches) {
        if (!matches || matches.length === 0) return;
        for (let v of matches) {
            const exists = matchHistory.some(h => h.id === v.id);
            if (!exists) {
                matchHistory.push({
                    ...v,
                    archivedAt: Date.now()
                });
            }
        }
    }

    function archiveAndClearVersus() {
        if (versus.length === 0) return;
        archiveMatches(versus);
        versus = [];
        recalculateAccumulatedPoints();
    }

    // ============================================================
    // 9. FUNCIONES DE RENDERIZADO
    // ============================================================

    function renderAll() {
        console.log('🎨 Renderizando UI...');

        try {
            const hasData = versus.length > 0 || matchHistory.length > 0 || tournamentFinished;
            if ((hasData || tournamentVisible) && participants.length > 0) {
                tournamentVisible = true;
                const section = document.getElementById('tournamentSection');
                if (section) section.style.display = 'block';
            } else {
                tournamentVisible = false;
                const section = document.getElementById('tournamentSection');
                if (section) section.style.display = 'none';
            }

            renderTournamentName();
            renderParticipants();
            renderRoundSelector();
            renderVersus();
            renderScores();
            renderTotalScoreTable();
            renderRoundManagement();
            updateStats();
            updateParticipantCountBadge();

            console.log('✅ UI renderizada correctamente');
        } catch (error) {
            console.error('❌ Error al renderizar UI:', error);
        }
    }

    function renderTournamentName() {
        document.title = `${tournamentName} · BeybladeX`;
        const titleEl = document.getElementById('siteTitle');
        if (titleEl) titleEl.textContent = tournamentName;
        const scoreTitle = document.getElementById('scoreTournamentName');
        if (scoreTitle) scoreTitle.textContent = tournamentName;
    }

    function renderParticipants() {
        if (participants.length === 0) {
            participantListEl.innerHTML = `<span class="empty-message">Aún no hay participantes</span>`;
            return;
        }
        let html = '';
        const sorted = [...participants].slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        sorted.forEach(p => {
            const pts = getAccumulatedScore(p.id || p.name);
            html += `<span class="participant-tag">${p.name} (${pts} pts) <button class="edit-name-btn" data-id="${p.id}" title="Editar nombre">✎</button> <button class="remove-btn" data-id="${p.id}" title="Eliminar">✕</button></span>`;
        });
        participantListEl.innerHTML = html;

        document.querySelectorAll('.participant-tag .remove-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.dataset.id;
                removeParticipantById(id);
            });
        });

        document.querySelectorAll('.participant-tag .edit-name-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.dataset.id;
                const old = getParticipantById(id);
                const oldName = old ? old.name : '';
                const newName = prompt('Nuevo nombre para el participante:', oldName);
                if (!newName) return;
                const trimmed = newName.trim();
                if (trimmed === '' || trimmed === oldName) return;
                if (participantExistsByName(trimmed)) {
                    alert('Ya existe un participante con ese nombre.');
                    return;
                }
                renameParticipant(id, trimmed);
            });
        });

        updateStats();
    }

    function renderRoundSelector() {
        const rounds = getAvailableRounds();

        let html = `<span class="label">📅 Rondas:</span>`;
        const totalCount = matchHistory.length + versus.length;
        html += `<button class="btn-round-selector ${selectedRound === 'all' ? 'active' : ''}" data-round="all">Todas <span class="matches-count">(${totalCount})</span></button>`;

        rounds.forEach(r => {
            const allMatches = [...matchHistory, ...versus];
            const count = allMatches.filter(v => v.round === r).length;
            const active = selectedRound === r ? 'active' : '';
            html += `<button class="btn-round-selector ${active}" data-round="${r}">R${r} <span class="matches-count">(${count})</span></button>`;
        });

        roundSelectorContainer.innerHTML = html;

        roundSelectorContainer.querySelectorAll('.btn-round-selector').forEach(btn => {
            btn.addEventListener('click', function () {
                const round = this.dataset.round;
                if (round === 'all') {
                    selectedRound = 'all';
                } else {
                    selectedRound = parseInt(round, 10);
                }

                roundSelectorContainer.querySelectorAll('.btn-round-selector').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                renderVersus();
            });
        });
    }

    function renderPodium() {
        return `
            <div class="podium-container">
                <div class="podium-title">🏆 ${tournamentName} 🏆</div>
                <div class="podium-grid">
                    <div class="podium-place place-2">
                        <div class="medal">🥈</div>
                        <div class="place-name">${podium.second || '—'}</div>
                        <div class="place-points">Subcampeón</div>
                        <div class="podium-base silver"></div>
                    </div>
                    <div class="podium-place place-1">
                        <div class="medal">🥇</div>
                        <div class="place-name">${podium.first || '—'}</div>
                        <div class="place-points">🏆 Campeón</div>
                        <div class="podium-base gold"></div>
                    </div>
                    <div class="podium-place place-3">
                        <div class="medal">🥉</div>
                        <div class="place-name">${podium.third || '—'}</div>
                        <div class="place-points">3er Lugar</div>
                        <div class="podium-base bronze"></div>
                    </div>
                    <div class="podium-place place-4">
                        <div class="medal">4️⃣</div>
                        <div class="place-name">${podium.fourth || '—'}</div>
                        <div class="place-points">4to Lugar</div>
                        <div class="podium-base fourth"></div>
                    </div>
                </div>
                <div class="podium-footer">
                    <span class="tourney-name">🏆 ${tournamentName}</span>
                    ${podium.third ? `<span style="color:#00FF88;"> · 🥉 3er Lugar: ${podium.third}</span>` : ''}
                    ${podium.fourth ? `<span style="color:#4A4A6A;"> · 4️⃣ 4to Lugar: ${podium.fourth}</span>` : ''}
                </div>
            </div>
        `;
    }

    function renderVersus() {
        const roundTitle = getRoundTitle();
        const titleEl = document.querySelector('.phase-indicator h2');
        if (titleEl) {
            titleEl.textContent = roundTitle;
        }

        if (tournamentFinished && tournamentWinner) {
            versusListEl.innerHTML = renderPodium();
            winnerMessageEl.innerHTML = '';
            thirdPlaceMessageEl.innerHTML = '';

            phaseDisplayEl.textContent = `🏆 Torneo Finalizado`;
            phaseDisplayEl.style.background = 'rgba(0, 255, 136, 0.2)';
            phaseDisplayEl.style.color = '#00FF88';
            roundDisplayEl.textContent = `Campeón: ${tournamentWinner}`;

            updateStats();
            return;
        }

        let matchesToShow = [...versus];
        if (preFinalMatch && !preFinalPlayed) {
            matchesToShow.push(preFinalMatch);
        }
        if (finalMatch && !finalPlayed) {
            matchesToShow.push(finalMatch);
        }
        if (selectedRound !== 'all') {
            matchesToShow = matchesToShow.filter(v => v.round === selectedRound);
        }

        if (matchesToShow.length > 0) {
            let html = '';
            const sortedMatches = matchesToShow;

            sortedMatches.forEach((v, index) => {
                const isPlayed = (v.scoreA !== 0 || v.scoreB !== 0);
                const statusClass = isPlayed ? 'played' : 'unplayed';
                const isPreFinal = v === preFinalMatch;
                const isFinal = v === finalMatch;

                let extraClass = '';
                let badgeText = 'VS';
                let badgeColor = '#FFB800';
                let controlButtons = '';

                if (isPreFinal) {
                    extraClass = 'prefinal-match';
                    badgeText = '🥉 3er/4to Lugar';
                    badgeColor = '#7C3AED';
                    controlButtons = `
                        <div class="match-controls">
                            <button class="btn-sm play-btn" data-action="play-pre-final">✅ Marcar como jugado</button>
                            <button class="btn-sm auto-btn" data-action="auto-pre-final">⚡ Finalizar automático</button>
                        </div>
                    `;
                } else if (isFinal) {
                    extraClass = 'final-match';
                    badgeText = '🏆 FINAL';
                    badgeColor = '#FFD700';
                    const disabled = !preFinalPlayed ? 'disabled' : '';
                    const disabledStyle = !preFinalPlayed ? 'opacity:0.5; cursor:not-allowed;' : '';
                    controlButtons = `
                        <div class="match-controls">
                            <button class="btn-sm play-btn" data-action="play-final" ${disabled} style="${disabledStyle}">✅ Marcar como jugado</button>
                            <button class="btn-sm auto-btn" data-action="auto-final" ${disabled} style="${disabledStyle}">⚡ Finalizar automático</button>
                        </div>
                        ${!preFinalPlayed ? '<span style="font-size:0.6rem; color:#4A4A6A; margin-left:0.5rem;">⏳ Esperando PRE-FINAL...</span>' : ''}
                    `;
                }

                html += `
                    <div class="versus-item ${extraClass} ${statusClass}" data-vsindex="${index}">
                        ${isPreFinal ? `<div class="prefinal-badge">🥉 PRE-FINAL</div>` : ''}
                        ${isFinal ? `<div class="final-badge">🏆 FINAL</div>` : ''}
                        <div class="match-content">
                            <div class="match-players">
                                <div class="player-score-block">
                                    <div class="score-control">
                                        <button class="dec-score" data-player="${v.playerA}" data-vsid="${v.id}" data-dir="-1">−</button>
                                        <div class="score-display">${v.scoreA}</div>
                                        <button class="inc-score" data-player="${v.playerA}" data-vsid="${v.id}" data-dir="1">+</button>
                                    </div>
                                    <span class="player-name">${v.playerA}</span>
                                </div>

                                <span class="vs-badge" style="color:${badgeColor};">${badgeText}</span>

                                <div class="player-score-block">
                                    <div class="score-control">
                                        <button class="dec-score" data-player="${v.playerB}" data-vsid="${v.id}" data-dir="-1">−</button>
                                        <div class="score-display">${v.scoreB}</div>
                                        <button class="inc-score" data-player="${v.playerB}" data-vsid="${v.id}" data-dir="1">+</button>
                                    </div>
                                    <span class="player-name">${v.playerB}</span>
                                </div>
                            </div>
                            ${controlButtons}
                        </div>
                    </div>
                `;
            });

            versusListEl.innerHTML = html;

            document.querySelectorAll('.inc-score, .dec-score').forEach(btn => {
                btn.addEventListener('click', function () {
                    const vsId = this.dataset.vsid;
                    const player = this.dataset.player;
                    const dir = parseInt(this.dataset.dir, 10);
                    const vsIdNum = vsId;
                    const isArchived = this.dataset.archived === 'true';

                    if (isArchived) {
                        updateArchivedScore(vsIdNum, player, dir);
                    } else if (preFinalMatch && String(preFinalMatch.id) === String(vsIdNum)) {
                        updatePreFinalScore(player, dir);
                    } else if (finalMatch && String(finalMatch.id) === String(vsIdNum)) {
                        updateFinalScore(player, dir);
                    } else {
                        updateScore(vsIdNum, player, dir);
                    }
                });
            });

            document.querySelectorAll('[data-action="play-pre-final"]').forEach(btn => {
                btn.addEventListener('click', markPreFinalPlayed);
            });
            document.querySelectorAll('[data-action="auto-pre-final"]').forEach(btn => {
                btn.addEventListener('click', autoFinishPreFinal);
            });
            document.querySelectorAll('[data-action="play-final"]').forEach(btn => {
                btn.addEventListener('click', function () {
                    if (preFinalPlayed) markFinalPlayed();
                });
            });
            document.querySelectorAll('[data-action="auto-final"]').forEach(btn => {
                btn.addEventListener('click', function () {
                    if (preFinalPlayed) autoFinishFinal();
                });
            });

        } else if (matchHistory.length > 0 && selectedRound !== 'all') {
            const filteredMatches = matchHistory.filter(v => v.round === selectedRound);
            if (filteredMatches.length > 0) {
                let html = '';
                filteredMatches.forEach((v) => {
                    const roundLabel = v.round ? `R${v.round}` : 'KO';
                    html += `
                    <div class="versus-item archived-match" style="opacity:0.9;">
                        <div style="font-size:.7rem;color:#00D4FF;margin-bottom:.35rem;">📅 Ronda anterior · editable</div>
                        <div class="match-content">
                            <div class="match-players">
                            <div class="player-score-block">
                                <div class="score-control">
                                    <button class="dec-score" data-archived="true" data-player="${v.playerA}" data-vsid="${v.id}" data-dir="-1">−</button>
                                    <div class="score-display">${v.scoreA}</div>
                                    <button class="inc-score" data-archived="true" data-player="${v.playerA}" data-vsid="${v.id}" data-dir="1">+</button>
                                </div>
                                <span class="player-name">${v.playerA}</span>
                            </div>
                            <span class="vs-badge" style="color:#4A4A6A;">✅ VS <span class="round-tag">${roundLabel}</span></span>
                            <div class="player-score-block">
                                <div class="score-control">
                                    <button class="dec-score" data-archived="true" data-player="${v.playerB}" data-vsid="${v.id}" data-dir="-1">−</button>
                                    <div class="score-display">${v.scoreB}</div>
                                    <button class="inc-score" data-archived="true" data-player="${v.playerB}" data-vsid="${v.id}" data-dir="1">+</button>
                                </div>
                                <span class="player-name">${v.playerB}</span>
                            </div>
                            </div>
                        </div>
                    </div>
                    `;
                });
                versusListEl.innerHTML = html;

                document.querySelectorAll('.inc-score[data-archived], .dec-score[data-archived]').forEach(btn => {
                    btn.addEventListener('click', function () {
                        const vsId = this.dataset.vsid;
                        const player = this.dataset.player;
                        const dir = parseInt(this.dataset.dir, 10);
                        updateArchivedScore(vsId, player, dir);
                    });
                });

            } else {
                versusListEl.innerHTML = `<div class="empty-message">No hay enfrentamientos en la Ronda ${selectedRound}.</div>`;
            }
        } else {
            versusListEl.innerHTML = `<div class="empty-message">Sin enfrentamientos activos. Genera una ronda de grupos o inicia eliminatorias.</div>`;
        }

        thirdPlaceMessageEl.innerHTML = '';

        if (currentPhase === 1) {
            phaseDisplayEl.textContent = 'Fase 1 · Grupos';
            phaseDisplayEl.style.background = 'rgba(234, 241, 250, 0.9)';
            phaseDisplayEl.style.color = '#000704';
            roundDisplayEl.textContent = `Ronda ${groupRound}`;
        } else if (currentPhase === 2 && !tournamentFinished) {
            if (preFinalMatch && !preFinalPlayed) {
                phaseDisplayEl.textContent = '🥉 PRE-FINAL';
                phaseDisplayEl.style.background = 'rgba(124, 58, 237, 0.15)';
                phaseDisplayEl.style.color = '#7C3AED';
                roundDisplayEl.textContent = '3er y 4to Lugar';
            } else if (finalMatch && !finalPlayed) {
                phaseDisplayEl.textContent = '🏆 FINAL';
                phaseDisplayEl.style.background = 'rgba(255, 215, 0, 0.15)';
                phaseDisplayEl.style.color = '#FFD700';
                roundDisplayEl.textContent = '¡La Gran Final!';
            } else {
                const activePlayers = new Set();
                versus.forEach(v => {
                    activePlayers.add(v.playerA);
                    activePlayers.add(v.playerB);
                });
                const count = activePlayers.size;
                const roundName = getKnockoutRoundName(count);
                phaseDisplayEl.textContent = `Fase 2 · Eliminatorias`;
                phaseDisplayEl.style.background = 'rgba(0, 212, 255, 0.12)';
                phaseDisplayEl.style.color = '#00D4FF';
                roundDisplayEl.textContent = roundName;
            }
        }

        updateStats();
    }

    function renderScores() {
        if (participants.length === 0) {
            scoreSummaryEl.innerHTML = `<div class="empty-message">Sin participantes.</div>`;
            return;
        }
        const ranking = getGroupRanking();
        const qualifiedCount = getQualifiedCount();

        let html = `<div style="display: flex; flex-direction: column; gap: 0.3rem;">`;
        html += `<div style="font-size:0.75rem; color:#4A4A6A; margin-bottom:0.3rem;">📊 Puntos de Fase de Grupos</div>`;
        ranking.forEach((item, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
            const pts = item.points;
            const cls = pts > 0 ? 'positive' : pts < 0 ? 'negative' : '';
            const isQualified = idx < qualifiedCount && currentPhase === 1 && !tournamentFinished;
            const qualifiedBadge = isQualified ? '<span class="qualified-badge">✅ Clasificado</span>' : '';
            html += `<div class="stat-badge ${cls}"><strong>${medal} ${item.name}</strong>  ${pts} pts ${qualifiedBadge}</div>`;
        });
        html += `</div>`;

        const totalPoints = ranking.reduce((acc, p) => acc + p.points, 0);
        html += `<div style="margin-top: 0.5rem; font-size:0.8rem; color:#4A4A6A;">Suma total de puntos: ${totalPoints}</div>`;
        html += `<div style="font-size:0.8rem; color:#4A4A6A;">Partidos totales: ${matchHistory.length + versus.length}</div>`;
        html += `<div style="font-size:0.8rem; color:#4A4A6A;">Clasificados: ${qualifiedCount} de ${participants.length}</div>`;
        scoreSummaryEl.innerHTML = html;
    }

    function renderTotalScoreTable() {
        if (participants.length === 0) {
            totalScoreTableEl.innerHTML = `<div class="empty-message">Sin participantes.</div>`;
            return;
        }

        const ranking = getGroupRanking();
        const groupMatches = [...matchHistory, ...versus].filter(v => v.round && v.round > 0);

        let html = `
            <div style="font-size:0.75rem; color:#4A4A6A; margin-bottom:0.5rem;">📊 Estadísticas de Fase de Grupos</div>
            <table class="total-score-table">
                <thead>
                    <tr>
                        <th>Pos.</th>
                        <th>Participante</th>
                        <th>Puntos</th>
                        <th>Dif. Pts</th>
                        <th>Partidos</th>
                        <th>Victorias</th>
                        <th>Derrotas</th>
                        <th>Rondas</th>
                    </tr>
                </thead>
                <tbody>
        `;

        ranking.forEach((item, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
            const cls = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';

            const playerMatches = groupMatches.filter(v => v.playerA === item.name || v.playerB === item.name);
            const wins = playerMatches.filter(v =>
                (v.playerA === item.name && v.scoreA > v.scoreB) ||
                (v.playerB === item.name && v.scoreB > v.scoreA)
            ).length;
            const losses = playerMatches.filter(v =>
                (v.playerA === item.name && v.scoreA < v.scoreB) ||
                (v.playerB === item.name && v.scoreB < v.scoreA)
            ).length;

            const roundsPlayed = new Set();
            playerMatches.forEach(v => {
                if (v.round && v.round > 0) roundsPlayed.add(v.round);
            });

            const pts = item.points;
            const ptsClass = pts > 0 ? 'positive' : pts < 0 ? 'negative' : '';

            html += `
                <tr class="${cls}">
                    <td><span class="medal-icon">${medal}</span></td>
                    <td class="name-cell">${item.name}</td>
                    <td class="points-cell ${ptsClass}">${pts}</td>
                    <td class="matches-cell" style="color:#0099FF;">${item.pointDifference > 0 ? '+' : ''}${item.pointDifference}</td>
                    <td class="matches-cell">${playerMatches.length}</td>
                    <td class="matches-cell" style="color:#00FF88;">${wins}</td>
                    <td class="matches-cell" style="color:#FF1744;">${losses}</td>
                    <td class="matches-cell">${roundsPlayed.size}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        totalScoreTableEl.innerHTML = html;

        const exportBtnId = 'exportScoreXlsxBtn';
        if (!document.getElementById(exportBtnId)) {
            const btn = document.createElement('button');
            btn.id = exportBtnId;
            btn.className = 'btn-sm';
            btn.textContent = '📥 Descargar Excel (.xlsx)';
            btn.style.marginTop = '0.5rem';
            totalScoreTableEl.appendChild(btn);
            btn.addEventListener('click', exportScoreTableXlsx);
        }
    }

    function getScoreTableRows() {
        const ranking = getGroupRanking();
        const groupMatches = [...matchHistory, ...versus].filter(v => v.round && v.round > 0);
        return ranking.map((item, idx) => {
            const playerMatches = groupMatches.filter(v =>
                v.playerAId === item.id || v.playerBId === item.id || v.playerA === item.name || v.playerB === item.name
            );
            const wins = playerMatches.filter(v =>
                (v.playerAId === item.id || v.playerA === item.name) && v.scoreA > v.scoreB ||
                (v.playerBId === item.id || v.playerB === item.name) && v.scoreB > v.scoreA
            ).length;
            const losses = playerMatches.filter(v =>
                (v.playerAId === item.id || v.playerA === item.name) && v.scoreA < v.scoreB ||
                (v.playerBId === item.id || v.playerB === item.name) && v.scoreB < v.scoreA
            ).length;
            const rounds = new Set(playerMatches.map(v => v.round).filter(Boolean));
            return {
                Posicion: idx + 1,
                Participante: item.name,
                Puntos: item.points,
                'Diferencia de puntos': item.pointDifference,
                Partidos: playerMatches.length,
                Victorias: wins,
                Derrotas: losses,
                Rondas: rounds.size
            };
        });
    }

    function exportScoreTableXlsx() {
        if (!window.XLSX) {
            alert('La librería XLSX no está cargada. Descargando como CSV...');
            exportScoreTableCSV();
            return;
        }
        const worksheet = XLSX.utils.json_to_sheet(getScoreTableRows());
        worksheet['!cols'] = [
            { wch: 10 }, { wch: 28 }, { wch: 12 }, { wch: 22 },
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Puntuación final');
        const safeName = (tournamentName || 'torneo').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
        XLSX.writeFile(workbook, `tabla_puntuacion_${safeName}_${Date.now()}.xlsx`);
    }

    function exportScoreTableCSV() {
        const rows = getScoreTableRows();
        const headers = Object.keys(rows[0] || {});
        const csvContent = [
            headers.join(','),
            ...rows.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tabla_puntuacion_${tournamentName.replace(/\s+/g, '_')}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function renderRoundManagement() {
        const switchInput = document.getElementById('phaseSwitch');
        const groupPanel = document.getElementById('groupPhasePanel');
        const knockoutPanel = document.getElementById('knockoutPhasePanel');
        const grupoLabel = document.querySelector('.phase-label.fase-grupos');
        const eliminatoriaLabel = document.querySelector('.phase-label.fase-eliminatorias');
        const knockoutSpecial = document.getElementById('knockoutSpecialMatches');
        const specialStatus = document.getElementById('specialMatchesStatus');

        if (currentPhaseView === 'groups') {
            switchInput.checked = false;
        } else {
            switchInput.checked = true;
        }

        if (currentPhaseView === 'groups') {
            groupPanel.className = 'phase-panel phase-panel-active grupos-panel';
            knockoutPanel.className = 'phase-panel phase-panel-inactive';
            grupoLabel.classList.add('active');
            eliminatoriaLabel.classList.remove('active');
        } else {
            groupPanel.className = 'phase-panel phase-panel-inactive';
            knockoutPanel.className = 'phase-panel phase-panel-active eliminatorias-panel';
            grupoLabel.classList.remove('active');
            eliminatoriaLabel.classList.add('active');
        }

        document.getElementById('groupRoundInfo').textContent = `Ronda ${groupRound}`;

        if (currentPhase === 2 && !tournamentFinished) {
            const activePlayers = new Set();
            versus.forEach(v => {
                activePlayers.add(v.playerA);
                activePlayers.add(v.playerB);
            });
            const count = activePlayers.size;
            const roundName = getKnockoutRoundName(count);
            document.getElementById('knockoutRoundInfo').textContent = roundName;
        } else if (tournamentFinished) {
            document.getElementById('knockoutRoundInfo').textContent = '🏆 Torneo Finalizado';
        } else {
            document.getElementById('knockoutRoundInfo').textContent = '⚔️ Esperando inicio';
        }

        if (preFinalMatch || finalMatch) {
            knockoutSpecial.style.display = 'block';

            let statusText = '';
            if (preFinalMatch && !preFinalPlayed) {
                statusText = `🥉 PRE-FINAL: ${preFinalMatch.playerA} vs ${preFinalMatch.playerB}`;
            } else if (preFinalMatch && preFinalPlayed) {
                statusText = `✅ PRE-FINAL jugada · 🥉 ${podium.third} · 4️⃣ ${podium.fourth}`;
            } else if (finalMatch && !finalPlayed) {
                statusText = `🏆 FINAL: ${finalMatch.playerA} vs ${finalMatch.playerB}`;
            } else if (finalMatch && finalPlayed) {
                statusText = `🏆 FINAL jugada · 🥇 ${podium.first} · 🥈 ${podium.second}`;
            }
            specialStatus.textContent = statusText;

            const playPreFinal = document.getElementById('playPreFinalBtn');
            const autoPreFinal = document.getElementById('autoPreFinalBtn');
            const playFinal = document.getElementById('playFinalBtn');
            const autoFinal = document.getElementById('autoFinalBtn');

            if (preFinalMatch && !preFinalPlayed) {
                playPreFinal.style.display = 'block';
                autoPreFinal.style.display = 'block';
                playFinal.style.display = 'none';
                autoFinal.style.display = 'none';
            } else if (finalMatch && !finalPlayed) {
                playPreFinal.style.display = 'none';
                autoPreFinal.style.display = 'none';
                playFinal.style.display = 'block';
                autoFinal.style.display = 'block';
                if (preFinalPlayed) {
                    playFinal.style.opacity = '1';
                    playFinal.style.cursor = 'pointer';
                    autoFinal.style.opacity = '1';
                    autoFinal.style.cursor = 'pointer';
                }
            } else {
                playPreFinal.style.display = 'none';
                autoPreFinal.style.display = 'none';
                playFinal.style.display = 'none';
                autoFinal.style.display = 'none';
            }
        } else {
            knockoutSpecial.style.display = 'none';
        }

        const startBtn = document.getElementById('startKnockoutBtn');
        const nextBtn = document.getElementById('nextKnockoutRoundBtn');

        if (currentPhase === 2 && !tournamentFinished) {
            startBtn.textContent = '⏳ En curso';
            startBtn.style.opacity = '0.6';
            startBtn.disabled = true;
            nextBtn.style.display = 'block';
            nextBtn.disabled = false;
        } else if (tournamentFinished) {
            startBtn.textContent = '🏆 Finalizado';
            startBtn.style.opacity = '0.6';
            startBtn.disabled = true;
            nextBtn.style.display = 'none';
        } else {
            startBtn.textContent = '🏁 Iniciar eliminatorias';
            startBtn.style.opacity = '1';
            startBtn.disabled = false;
            nextBtn.style.display = 'block';
            nextBtn.disabled = true;
            nextBtn.style.opacity = '0.5';
        }

        if (currentPhase === 1 && versus.length === 0 && matchHistory.length === 0) {
            startBtn.textContent = '🏁 Iniciar eliminatorias';
            startBtn.style.opacity = '0.5';
            startBtn.disabled = true;
            startBtn.title = 'Necesitas jugar al menos una ronda de grupos primero';
        } else if (currentPhase === 1 && versus.length > 0) {
            startBtn.textContent = '🏁 Iniciar eliminatorias';
            startBtn.style.opacity = '1';
            startBtn.disabled = false;
            startBtn.title = '';
        }
    }

    function updateStats() {
        const qualified = getQualifiedCount();
        qualifiedCountDisplay.textContent = qualified;
        let totalMatches = matchHistory.length + versus.length;
        if (preFinalMatch && preFinalPlayed) totalMatches++;
        if (finalMatch && finalPlayed) totalMatches++;
        totalMatchesDisplay.textContent = totalMatches;
        totalRoundsDisplay.textContent = getTotalRounds();
        totalParticipantsDisplay.textContent = participants.length;

        headerParticipants.textContent = participants.length;
        headerMatches.textContent = totalMatches;
        headerRounds.textContent = getTotalRounds();
        headerQualified.textContent = qualified;
    }

    function updateParticipantCountBadge() {
        if (participantCountBadge) {
            participantCountBadge.textContent = participants.length;
        }
    }

    // ============================================================
    // 10. FUNCIONES DE ACTUALIZACIÓN DE PUNTUACIONES
    // ============================================================

    function updateScore(vsId, player, direction) {
        const vs = versus.find(v => String(v.id) === String(vsId));
        if (!vs) return;

        if (vs.playerA === player) {
            const newVal = vs.scoreA + direction;
            if (newVal < 0) { alert('Los puntos del partido no pueden ser negativos.'); return; }
            vs.scoreA = newVal;
        } else if (vs.playerB === player) {
            const newVal = vs.scoreB + direction;
            if (newVal < 0) { alert('Los puntos del partido no pueden ser negativos.'); return; }
            vs.scoreB = newVal;
        } else {
            return;
        }
        vs.jugado = vs.scoreA !== 0 || vs.scoreB !== 0;

        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function updateArchivedScore(matchId, player, dir) {
        const idx = matchHistory.findIndex(h => String(h.id) === String(matchId));
        if (idx === -1) return;
        const match = matchHistory[idx];
        if (player === match.playerA) {
            match.scoreA = Math.max(0, (match.scoreA || 0) + dir);
        } else if (player === match.playerB) {
            match.scoreB = Math.max(0, (match.scoreB || 0) + dir);
        }
        matchHistory[idx] = match;
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function updatePreFinalScore(player, direction) {
        if (!preFinalMatch) return;
        if (preFinalMatch.playerA === player) {
            const newVal = preFinalMatch.scoreA + direction;
            if (newVal < 0) { alert('Los puntos del partido no pueden ser negativos.'); return; }
            preFinalMatch.scoreA = newVal;
        } else if (preFinalMatch.playerB === player) {
            const newVal = preFinalMatch.scoreB + direction;
            if (newVal < 0) { alert('Los puntos del partido no pueden ser negativos.'); return; }
            preFinalMatch.scoreB = newVal;
        } else {
            return;
        }
        renderAll();
        saveToLocalStorage();
    }

    function updateFinalScore(player, direction) {
        if (!finalMatch) return;
        if (finalMatch.playerA === player) {
            const newVal = finalMatch.scoreA + direction;
            if (newVal < 0) { alert('Los puntos del partido no pueden ser negativos.'); return; }
            finalMatch.scoreA = newVal;
        } else if (finalMatch.playerB === player) {
            const newVal = finalMatch.scoreB + direction;
            if (newVal < 0) { alert('Los puntos del partido no pueden ser negativos.'); return; }
            finalMatch.scoreB = newVal;
        } else {
            return;
        }
        renderAll();
        saveToLocalStorage();
    }

    // ============================================================
    // 11. FUNCIONES DE GESTIÓN DE TORNEO
    // ============================================================

    function generateGroupRound() {
        if (participants.length < 2) {
            alert('Necesitas al menos 2 participantes.');
            return;
        }

        if (currentPhase === 2) {
            if (!confirm('Estás en fase eliminatoria. ¿Quieres volver a fase de grupos? Se archivarán los enfrentamientos actuales.')) {
                return;
            }
            archiveAndClearVersus();
            currentPhase = 1;
            tournamentWinner = null;
            tournamentFinished = false;
            knockoutRound = 0;
            preFinalMatch = null;
            preFinalPlayed = false;
            finalMatch = null;
            finalPlayed = false;
            semifinalLosers = [];
            semifinalWinners = [];
            podium = { first: null, second: null, third: null, fourth: null };
        } else {
            if (versus.length > 0) {
                if (!confirm('Hay enfrentamientos actuales. ¿Archivarlos y generar una nueva ronda?')) {
                    return;
                }
                archiveAndClearVersus();
            }
        }

        groupRound++;
        const pairings = generatePairings(participants);

        if (pairings.length === 0) {
            alert('No se pudieron generar enfrentamientos.');
            return;
        }

        const newVersus = pairings.map(p => ({
            playerA: p.playerA,
            playerB: p.playerB,
            playerAId: p.playerAId,
            playerBId: p.playerBId,
            scoreA: 0,
            scoreB: 0,
            id: nextVersusId++,
            round: groupRound
        }));

        versus = versus.concat(newVersus);

        const restantes = participants.length - (pairings.length * 2);
        if (restantes > 0) {
            alert(`⚠️ ${restantes} participante(s) descansan esta ronda (número impar de jugadores).`);
        }

        selectedRound = groupRound;
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function startKnockout() {
        if (participants.length < 2) {
            alert('Necesitas al menos 2 participantes.');
            return;
        }

        const qualifiedCount = getQualifiedCount();
        if (qualifiedCount < 2) {
            alert(`No hay suficientes participantes para eliminatorias. Clasificados: ${qualifiedCount}`);
            return;
        }

        const ranking = getGroupRanking();
        const qualified = ranking.slice(0, qualifiedCount).map(p => ({ id: p.id, name: p.name }));

        if (qualified.length < 2) {
            alert('No hay suficientes participantes con puntos para eliminatorias.');
            return;
        }

        if (currentPhase === 1) {
            if (!confirm(`Los puntos de fase de grupos se conservarán. ${qualified.length} jugadores pasan a eliminatorias. ¿Continuar?`)) {
                return;
            }
            archiveAndClearVersus();
        } else {
            archiveAndClearVersus();
        }

        tournamentWinner = null;
        tournamentFinished = false;
        currentPhase = 2;
        knockoutRound = 1;
        preFinalMatch = null;
        preFinalPlayed = false;
        finalMatch = null;
        finalPlayed = false;
        semifinalLosers = [];
        semifinalWinners = [];
        podium = { first: null, second: null, third: null, fourth: null };

        const shuffled = [...qualified];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        for (let i = 0; i < shuffled.length; i += 2) {
            if (i + 1 < shuffled.length) {
                versus.push({
                    playerA: shuffled[i].name,
                    playerB: shuffled[i + 1].name,
                    playerAId: shuffled[i].id,
                    playerBId: shuffled[i + 1].id,
                    scoreA: 0,
                    scoreB: 0,
                    id: nextVersusId++,
                    round: 0
                });
            }
        }

        if (versus.length === 0) {
            alert('No se pudieron generar enfrentamientos.');
            currentPhase = 1;
            return;
        }

        currentPhaseView = 'knockout';
        document.getElementById('phaseSwitch').checked = true;

        selectedRound = 'all';
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();

        alert(`✅ Eliminatorias iniciadas con ${versus.length} enfrentamientos.\n\n📊 ${qualified.length} jugadores clasificados.`);
    }

    function nextKnockoutRound() {
        if (currentPhase !== 2) {
            alert('No estás en fase de eliminatorias.');
            return;
        }

        if (preFinalMatch && !preFinalPlayed) {
            alert('⚠️ Primero debes jugar la PRE-FINAL (3er y 4to lugar).');
            return;
        }
        if (finalMatch && !finalPlayed) {
            alert('⚠️ Primero debes jugar la FINAL.');
            return;
        }

        if (versus.length === 0) {
            alert('No hay enfrentamientos en esta ronda.');
            return;
        }

        for (let v of versus) {
            if (v.scoreA === 0 && v.scoreB === 0) {
                alert('Hay enfrentamientos sin jugar (0-0). Asigna puntos primero.');
                return;
            }
            if (v.scoreA === v.scoreB) {
                alert('Hay un empate en un enfrentamiento. Debe haber un ganador para avanzar.');
                return;
            }
        }

        const winners = [];
        const losers = [];
        for (let v of versus) {
            if (v.scoreA > v.scoreB) {
                winners.push(v.playerA);
                losers.push(v.playerB);
            } else if (v.scoreB > v.scoreA) {
                winners.push(v.playerB);
                losers.push(v.playerA);
            }
        }

        if (versus.length === 2) {
            semifinalLosers = losers;
            semifinalWinners = winners;
            archiveAndClearVersus();

            if (semifinalLosers.length === 2 && semifinalWinners.length === 2) {
                preFinalMatch = {
                    playerA: semifinalLosers[0],
                    playerB: semifinalLosers[1],
                    scoreA: 0,
                    scoreB: 0,
                    id: nextVersusId++
                };
                preFinalPlayed = false;

                finalMatch = {
                    playerA: semifinalWinners[0],
                    playerB: semifinalWinners[1],
                    scoreA: 0,
                    scoreB: 0,
                    id: nextVersusId++
                };
                finalPlayed = false;

                alert(`🥇 SEMIFINALES FINALIZADAS!\n\n🥉 PRE-FINAL (3er y 4to Lugar):\n${semifinalLosers[0]} vs ${semifinalLosers[1]}\n\n🏆 FINAL:\n${semifinalWinners[0]} vs ${semifinalWinners[1]}\n\n👉 Juega primero la PRE-FINAL, luego la FINAL.`);

                recalculateAccumulatedPoints();
                renderAll();
                saveToLocalStorage();
                return;
            }
        }

        archiveAndClearVersus();

        const nextRoundPlayers = [...new Set(winners)];
        let shuffled = [...nextRoundPlayers];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const newVersus = [];
        for (let i = 0; i < shuffled.length; i += 2) {
            if (i + 1 < shuffled.length) {
                newVersus.push({
                    playerA: shuffled[i],
                    playerB: shuffled[i + 1],
                    scoreA: 0,
                    scoreB: 0,
                    id: nextVersusId++,
                    round: 0
                });
            }
        }

        versus = newVersus;
        knockoutRound++;
        selectedRound = 'all';
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    // ============================================================
    // 12. FUNCIONES DE PARTIDOS ESPECIALES
    // ============================================================

    function markPreFinalPlayed() {
        if (!preFinalMatch) return;
        if (preFinalMatch.scoreA === 0 && preFinalMatch.scoreB === 0) {
            alert('Por favor, asigna puntuaciones antes de marcar como jugado.');
            return;
        }
        if (preFinalMatch.scoreA === preFinalMatch.scoreB) {
            alert('No puede haber empate en la PRE-FINAL. Asigna un ganador.');
            return;
        }
        finalizePreFinal();
    }

    function autoFinishPreFinal() {
        if (!preFinalMatch) return;
        if (preFinalMatch.scoreA === 0 && preFinalMatch.scoreB === 0) {
            preFinalMatch.scoreA = Math.floor(Math.random() * 5) + 1;
            preFinalMatch.scoreB = Math.floor(Math.random() * 5) + 1;
            while (preFinalMatch.scoreA === preFinalMatch.scoreB) {
                preFinalMatch.scoreB = Math.floor(Math.random() * 5) + 1;
            }
            if (preFinalMatch.scoreA < preFinalMatch.scoreB) {
                [preFinalMatch.scoreA, preFinalMatch.scoreB] = [preFinalMatch.scoreB, preFinalMatch.scoreA];
            }
        }
        finalizePreFinal();
    }

    function finalizePreFinal() {
        if (!preFinalMatch) return;
        preFinalPlayed = true;

        podium.third = preFinalMatch.scoreA > preFinalMatch.scoreB ?
            preFinalMatch.playerA : preFinalMatch.playerB;
        podium.fourth = preFinalMatch.playerA === podium.third ?
            preFinalMatch.playerB : preFinalMatch.playerA;

        const preFinalCopy = {
            ...preFinalMatch,
            id: preFinalMatch.id,
            round: 0,
            archivedAt: Date.now()
        };
        matchHistory.push(preFinalCopy);
        preFinalMatch = null;

        renderAll();
        saveToLocalStorage();
        alert(`✅ PRE-FINAL finalizada!\n🥉 ${podium.third} es el 3er Lugar.\n4️⃣ ${podium.fourth} es el 4to Lugar.\n\n🏆 ¡Ahora la FINAL!`);
    }

    function markFinalPlayed() {
        if (!finalMatch) return;
        if (finalMatch.scoreA === 0 && finalMatch.scoreB === 0) {
            alert('Por favor, asigna puntuaciones antes de marcar como jugado.');
            return;
        }
        if (finalMatch.scoreA === finalMatch.scoreB) {
            alert('No puede haber empate en la final. Asigna un ganador.');
            return;
        }
        finalizeFinal();
    }

    function autoFinishFinal() {
        if (!finalMatch) return;
        if (finalMatch.scoreA === 0 && finalMatch.scoreB === 0) {
            finalMatch.scoreA = Math.floor(Math.random() * 5) + 1;
            finalMatch.scoreB = Math.floor(Math.random() * 5) + 1;
            while (finalMatch.scoreA === finalMatch.scoreB) {
                finalMatch.scoreB = Math.floor(Math.random() * 5) + 1;
            }
            if (finalMatch.scoreA < finalMatch.scoreB) {
                [finalMatch.scoreA, finalMatch.scoreB] = [finalMatch.scoreB, finalMatch.scoreA];
            }
        }
        finalizeFinal();
    }

    function finalizeFinal() {
        if (!finalMatch) return;
        finalPlayed = true;
        tournamentWinner = finalMatch.scoreA > finalMatch.scoreB ?
            finalMatch.playerA : finalMatch.playerB;
        const loser = finalMatch.playerA === tournamentWinner ?
            finalMatch.playerB : finalMatch.playerA;

        podium.first = tournamentWinner;
        podium.second = loser;
        tournamentFinished = true;

        const finalCopy = {
            ...finalMatch,
            id: finalMatch.id,
            round: 0,
            archivedAt: Date.now()
        };
        matchHistory.push(finalCopy);
        finalMatch = null;

        renderAll();
        saveToLocalStorage();

        let message = `🏆 ¡CAMPEÓN: ${tournamentWinner}! 🏆\n🥈 Subcampeón: ${loser}`;
        if (podium.third) {
            message += `\n🥉 3er Lugar: ${podium.third}`;
        }
        if (podium.fourth) {
            message += `\n4️⃣ 4to Lugar: ${podium.fourth}`;
        }
        alert(message);
    }

    // ============================================================
    // 13. FUNCIONES DE UTILIDAD
    // ============================================================

    function startTournament() {
        if (participants.length < 2) {
            alert('❌ Necesitas al menos 2 participantes para iniciar el torneo.');
            return;
        }

        if (!tournamentId) {
            tournamentId = generateTournamentId();
        }

        tournamentVisible = true;
        document.getElementById('tournamentSection').style.display = 'block';

        setTimeout(() => {
            const section = document.getElementById('tournamentSection');
            if (section) {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);

        renderAll();
        saveToLocalStorage();
    }

    function editTournamentName() {
        const newName = prompt('Ingresa el nuevo nombre del torneo:', tournamentName);
        if (newName && newName.trim() !== '') {
            tournamentName = newName.trim();
            renderTournamentName();
            saveToLocalStorage();
        }
    }

    function resetTournament() {
        if (!confirm('⚠️ ¿Reiniciar el torneo?\n\nSe eliminarán TODOS los enfrentamientos y el progreso.\nLos participantes se mantienen.')) return;

        versus = [];
        matchHistory = [];
        accumulatedPoints = {};
        nextVersusId = 1;
        currentPhase = 1;
        tournamentWinner = null;
        tournamentFinished = false;
        knockoutRound = 0;
        groupRound = 0;
        selectedRound = 'all';
        preFinalMatch = null;
        preFinalPlayed = false;
        finalMatch = null;
        finalPlayed = false;
        semifinalLosers = [];
        semifinalWinners = [];
        podium = { first: null, second: null, third: null, fourth: null };
        tournamentVisible = false;

        participants.forEach(p => accumulatedPoints[p.id] = 0);

        renderAll();
        saveToLocalStorage();
        alert('✅ Torneo reiniciado. Los participantes se mantienen.');
    }

    // ============================================================
    // 14. FUNCIONES DE LISTA DE TORNEOS
    // ============================================================

    function showTournamentList() {
        const modal = document.getElementById('tournamentListModal');
        const container = document.getElementById('tournamentListContainer');

        modal.classList.add('active');
        const list = getTournamentList();

        if (list.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:2rem; color:#4A4A6A;">
                    <div style="font-size:2rem; margin-bottom:0.5rem;">🏟️</div>
                    No tienes torneos guardados.
                    <div style="margin-top:0.5rem; font-size:0.8rem;">
                        Crea uno nuevo desde el botón "Crear torneo".
                    </div>
                </div>
            `;
            return;
        }

        let html = '';
        const sorted = list.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        sorted.forEach((t) => {
            const estado = t.finalizado ? 'finalizado' : 'activo';
            const estadoLabel = t.finalizado ? '🏁 Finalizado' : '🔄 Activo';
            const esActual = t.id === tournamentId;
            const fecha = new Date(t.fecha);
            const fechaStr = fecha.toLocaleDateString('es-ES', {
                day: '2-digit', month: 'short', year: 'numeric'
            });

            html += `
                <div class="tournament-list-item ${esActual ? 'active' : ''}" style="${esActual ? 'border-color: rgba(0, 255, 136, 0.3); background: rgba(0, 255, 136, 0.05);' : ''}">
                    <div class="info">
                        <div class="name">
                            ${esActual ? '🟢 ' : ''}${t.name}
                            ${esActual ? '<span style="font-size:0.6rem; color:#00FF88; margin-left:0.3rem;">(Actual)</span>' : ''}
                        </div>
                        <div class="details">
                            <span>👥 ${t.participantes || 0} participantes</span>
                            <span>📅 ${fechaStr}</span>
                            <span class="status ${estado}">${estadoLabel}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.3rem;">
                        ${!esActual ? `<button class="btn-cargar" data-torneo-id="${t.id}">📂 Cargar</button>` : ''}
                        <button class="btn-eliminar" data-torneo-id="${t.id}">🗑️</button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('.btn-cargar').forEach(btn => {
            btn.addEventListener('click', function () {
                const torneoId = this.dataset.torneoId;
                if (loadTournamentById(torneoId)) {
                    document.getElementById('tournamentListModal').classList.remove('active');
                    alert('✅ Torneo cargado correctamente');
                } else {
                    alert('❌ Error al cargar el torneo');
                }
            });
        });

        container.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const torneoId = this.dataset.torneoId;
                const torneo = sorted.find(t => t.id === torneoId);

                if (!confirm(`⚠️ ¿Eliminar el torneo "${torneo?.name}"?\n\nEsta acción eliminará todos los datos asociados.`)) {
                    return;
                }

                if (torneoId === tournamentId) {
                    if (!confirm('⚠️ Estás eliminando el torneo actual. ¿Continuar?')) {
                        return;
                    }
                    // Limpiar estado actual
                    tournamentId = null;
                    participants = [];
                    versus = [];
                    matchHistory = [];
                    accumulatedPoints = {};
                    tournamentVisible = false;
                    document.getElementById('tournamentSection').style.display = 'none';
                    localStorage.removeItem(STORAGE_KEY);
                }

                deleteTournamentFromList(torneoId);
                showTournamentList();
                renderAll();
                alert('✅ Torneo eliminado');
            });
        });

        const searchInput = document.getElementById('tournamentSearchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = function () {
                const query = this.value.toLowerCase().trim();
                const items = container.querySelectorAll('.tournament-list-item');
                items.forEach(item => {
                    const name = item.querySelector('.name')?.textContent?.toLowerCase() || '';
                    const match = name.includes(query);
                    item.style.display = match ? 'flex' : 'none';
                });
            };
            setTimeout(() => searchInput.focus(), 100);
        }
    }

    // ============================================================
    // 15. FUNCIONES DE INICIALIZACIÓN
    // ============================================================

    function initializeWith16Participants() {
        const nombres = [
            'Alejandro', 'Beatriz', 'Carlos', 'Daniela',
            'Eduardo', 'Fernanda', 'Gabriel', 'Helena',
            'Ignacio', 'Julieta', 'Kevin', 'Laura',
            'Manuel', 'Natalia', 'Óscar', 'Paula'
        ];

        if (!tournamentId) {
            tournamentId = generateTournamentId();
        }

        participants = nombres.map(n => ({ id: generateParticipantId(), name: n }));
        participants.forEach(p => { if (p && p.id) accumulatedPoints[p.id] = accumulatedPoints[p.id] || 0; });

        groupRound = 1;
        const pairings = generatePairings(participants);

        const newVersus = pairings.map(p => ({
            playerA: p.playerA,
            playerB: p.playerB,
            playerAId: p.playerAId || getParticipantIdByName(p.playerA),
            playerBId: p.playerBId || getParticipantIdByName(p.playerB),
            scoreA: 0,
            scoreB: 0,
            id: nextVersusId++,
            round: groupRound
        }));

        versus = newVersus;

        const ejemplo = [
            { a: 'Alejandro', b: 'Beatriz', sa: 3, sb: 2 },
            { a: 'Carlos', b: 'Daniela', sa: 4, sb: 1 },
            { a: 'Eduardo', b: 'Fernanda', sa: 2, sb: 3 },
            { a: 'Gabriel', b: 'Helena', sa: 5, sb: 0 },
            { a: 'Ignacio', b: 'Julieta', sa: 1, sb: 4 },
            { a: 'Kevin', b: 'Laura', sa: 3, sb: 3 },
            { a: 'Manuel', b: 'Natalia', sa: 2, sb: 2 },
            { a: 'Óscar', b: 'Paula', sa: 4, sb: 2 },
        ];

        ejemplo.forEach(e => {
            const v = versus.find(v =>
                (v.playerA === e.a && v.playerB === e.b) ||
                (v.playerA === e.b && v.playerB === e.a)
            );
            if (v) {
                if (v.playerA === e.a) {
                    v.scoreA = e.sa;
                    v.scoreB = e.sb;
                } else {
                    v.scoreA = e.sb;
                    v.scoreB = e.sa;
                }
            }
        });

        customQualifiedCount = 8;
        qualifiedCountInput.value = 8;
        selectedRound = 1;
        recalculateAccumulatedPoints();
        tournamentVisible = true;
        saveToLocalStorage();
    }

    function initializeApp() {
        console.log('🚀 Iniciando aplicación...');

        try {
            const loaded = loadFromLocalStorage();

            if (loaded) {
                console.log('✅ Datos cargados desde localStorage');
                renderAll();
            } else {
                console.log('📋 Inicializando con datos de ejemplo');
                initializeWith16Participants();
                renderAll();
            }

            console.log('🚀 App inicializada correctamente');
        } catch (error) {
            console.error('❌ Error al inicializar app:', error);
        }
    }

    // ============================================================
    // 16. EVENT LISTENERS
    // ============================================================

    // --- Crear torneo ---
    createTournamentBtn.addEventListener('click', function () {
        if (tournamentId) {
            if (!confirm('⚠️ Ya estás en un torneo. ¿Quieres crear uno nuevo?\n\nEsto desconectará el torneo actual.')) {
                return;
            }
            // Guardar el torneo actual antes de crear uno nuevo
            saveToLocalStorage();
        }

        const nombre = prompt('🏗️ Nombre del torneo:', 'Torneo BeybladeX');
        if (!nombre || nombre.trim() === '') return;

        // Crear nuevo torneo
        tournamentId = generateTournamentId();
        tournamentName = nombre.trim();
        participants = [];
        versus = [];
        matchHistory = [];
        accumulatedPoints = {};
        nextVersusId = 1;
        currentPhase = 1;
        tournamentWinner = null;
        tournamentFinished = false;
        knockoutRound = 0;
        groupRound = 0;
        preFinalMatch = null;
        preFinalPlayed = false;
        finalMatch = null;
        finalPlayed = false;
        semifinalLosers = [];
        semifinalWinners = [];
        podium = { first: null, second: null, third: null, fourth: null };
        tournamentVisible = false;
        selectedRound = 'all';
        customQualifiedCount = 8;
        qualifiedCountInput.value = 8;

        document.getElementById('tournamentSection').style.display = 'none';
        renderAll();
        saveToLocalStorage();

        alert(`✅ Torneo "${nombre}" creado!\n\n📝 Ahora puedes agregar participantes y empezar el torneo.`);

        const addInitial = confirm('¿Quieres agregar participantes ahora?');
        if (addInitial) {
            const names = prompt('Ingresa los nombres separados por comas:\n(ej: Ana, Carlos, Marta)');
            if (names) {
                const nameList = names.split(',').map(n => n.trim()).filter(n => n);
                for (const name of nameList) {
                    if (!participantExistsByName(name)) {
                        addParticipant(name);
                    }
                }
                renderAll();
                saveToLocalStorage();
                alert(`✅ ${nameList.length} participantes agregados.`);
            }
        }
    });

    // --- Listar torneos ---
    listTournamentsBtn.addEventListener('click', showTournamentList);

    // --- Cerrar modal de lista ---
    document.getElementById('closeTournamentListModal')?.addEventListener('click', function () {
        document.getElementById('tournamentListModal').classList.remove('active');
    });

    document.getElementById('tournamentListModal')?.addEventListener('click', function (e) {
        if (e.target === this) {
            this.classList.remove('active');
        }
    });

    document.getElementById('refreshTournamentListBtn')?.addEventListener('click', showTournamentList);

    // --- Switch de fase ---
    document.getElementById('phaseSwitch').addEventListener('change', function () {
        if (this.checked) {
            currentPhaseView = 'knockout';
        } else {
            currentPhaseView = 'groups';
        }
        renderAll();
        saveToLocalStorage();
    });

    // --- Participantes ---
    addBtn.addEventListener('click', function () {
        const name = newParticipantInput.value.trim();
        if (!name) {
            alert('Escribe un nombre.');
            return;
        }
        if (participantExistsByName(name)) {
            alert(`"${name}" ya está en la lista.`);
            return;
        }
        addParticipant(name);
        newParticipantInput.value = '';
        renderAll();
        saveToLocalStorage();
    });

    newParticipantInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addBtn.click();
    });

    addMultipleBtn.addEventListener('click', function () {
        const names = prompt('Ingresa los nombres separados por comas (ej: Juan, María, Pedro, Ana):');
        if (!names) return;
        const nameList = names.split(',').map(n => n.trim()).filter(n => n);
        let added = 0;
        nameList.forEach(name => {
            if (!participantExistsByName(name) && name) {
                addParticipant(name);
                added++;
            }
        });
        if (added > 0) {
            renderAll();
            saveToLocalStorage();
            alert(`✅ Se agregaron ${added} participantes.`);
        } else {
            alert('No se agregaron nuevos participantes.');
        }
    });

    document.getElementById('clearAllParticipantsBtn')?.addEventListener('click', function (e) {
        e.preventDefault();
        clearAllParticipants();
    });

    document.getElementById('startTournamentBtn')?.addEventListener('click', startTournament);

    document.getElementById('editTournamentNameBtn')?.addEventListener('click', editTournamentName);

    // --- Gestión de rondas ---
    generateGroupBtn.addEventListener('click', generateGroupRound);

    document.getElementById('nextGroupRoundBtn').addEventListener('click', function () {
        generateGroupRound();
    });

    document.getElementById('reshuffleGroupsBtn').addEventListener('click', function () {
        if (currentPhase !== 1) {
            alert('Solo disponible en fase de grupos.');
            return;
        }
        const roundToReshuffle = selectedRound !== 'all' ? selectedRound : groupRound;
        const pendingMatches = versus.filter(v =>
            v.round === roundToReshuffle && v.scoreA === 0 && v.scoreB === 0
        );
        if (pendingMatches.length < 2) {
            alert('Se necesitan al menos dos enfrentamientos 0-0 en la ronda seleccionada para cambiar los cruces.');
            return;
        }
        if (!confirm('⚠️ ¿Cambiar los cruces 0-0 de esta ronda?\n\nSolo se modificarán los enfrentamientos sin puntos; los ya jugados permanecerán intactos.')) return;

        const players = pendingMatches.flatMap(match => ([
            { id: match.playerAId || getParticipantIdByName(match.playerA), name: match.playerA },
            { id: match.playerBId || getParticipantIdByName(match.playerB), name: match.playerB }
        ]));
        const pairKey = pair => [String(pair.playerAId), String(pair.playerBId)].sort().join('|');
        const originalKeys = pendingMatches.map(pairKey);
        let pairings = [];
        for (let attempt = 0; attempt < 30; attempt++) {
            const candidate = generatePairings(players);
            const candidateKeys = candidate.map(pairKey);
            const changed = candidateKeys.some((key, index) => key !== originalKeys[index]);
            const movedOldPair = candidateKeys.some((key, index) => originalKeys.includes(key) && key !== originalKeys[index]);
            if (changed && !movedOldPair) {
                pairings = candidate;
                break;
            }
        }
        if (pairings.length === 0) {
            alert('No se pudo generar una combinación de cruces distinta. Inténtalo nuevamente.');
            return;
        }

        pendingMatches.forEach((match, index) => {
            const pairing = pairings[index];
            match.playerA = pairing.playerA;
            match.playerB = pairing.playerB;
            match.playerAId = pairing.playerAId;
            match.playerBId = pairing.playerBId;
        });
        renderAll();
        saveToLocalStorage();
    });

    applyQualifiedBtn.addEventListener('click', function () {
        const val = parseInt(qualifiedCountInput.value, 10);
        if (isNaN(val) || val < 2) {
            alert('El número de clasificados debe ser al menos 2.');
            qualifiedCountInput.value = customQualifiedCount;
            return;
        }
        if (val > participants.length) {
            alert(`No puede haber más clasificados que participantes (${participants.length}).`);
            qualifiedCountInput.value = customQualifiedCount;
            return;
        }
        customQualifiedCount = val;
        renderAll();
        saveToLocalStorage();
        alert(`✅ Clasificados establecidos en ${customQualifiedCount}.`);
    });

    qualifiedCountInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyQualifiedBtn.click();
    });

    // --- Eliminatorias ---
    startKnockoutBtn.addEventListener('click', function () {
        if (participants.length < 2) {
            alert('❌ Necesitas al menos 2 participantes.');
            return;
        }

        if (currentPhase === 1 && versus.length > 0) {
            const allPlayed = versus.every(v => v.scoreA !== 0 || v.scoreB !== 0);
            if (!allPlayed) {
                if (!confirm('⚠️ Hay enfrentamientos sin jugar en la ronda actual.\n\n¿Quieres iniciar eliminatorias de todas formas? Los enfrentamientos sin jugar se archivarán.')) {
                    return;
                }
            }
        }

        if (currentPhase === 1 && versus.length === 0 && matchHistory.length === 0) {
            alert('⚠️ Primero debes jugar al menos una ronda de grupos.\n\nHaz clic en "Nueva ronda" en el panel de grupos.');
            return;
        }

        startKnockout();
    });

    document.getElementById('nextKnockoutRoundBtn').addEventListener('click', function () {
        if (currentPhase !== 2) {
            alert('⚠️ No estás en fase eliminatoria.');
            return;
        }

        if (tournamentFinished) {
            alert('🏆 El torneo ya ha finalizado.');
            return;
        }

        if (preFinalMatch && !preFinalPlayed) {
            alert('⚠️ Primero debes jugar la PRE-FINAL (3er y 4to lugar).\nUsa los botones en el panel de eliminatorias.');
            return;
        }
        if (finalMatch && !finalPlayed) {
            alert('⚠️ Primero debes jugar la FINAL.\nUsa los botones en el panel de eliminatorias.');
            return;
        }

        if (versus.length === 0) {
            alert('No hay enfrentamientos en esta ronda.');
            return;
        }

        const allPlayed = versus.every(v => v.scoreA !== 0 || v.scoreB !== 0);
        if (!allPlayed) {
            alert('⚠️ Hay enfrentamientos sin jugar (0-0). Asigna puntos primero.');
            return;
        }

        const hasDraw = versus.some(v => v.scoreA === v.scoreB);
        if (hasDraw) {
            alert('⚠️ Hay un empate en un enfrentamiento. Debe haber un ganador para avanzar.');
            return;
        }

        nextKnockoutRound();
    });

    // --- Partidos especiales ---
    document.getElementById('playPreFinalBtn').addEventListener('click', markPreFinalPlayed);
    document.getElementById('autoPreFinalBtn').addEventListener('click', autoFinishPreFinal);
    document.getElementById('playFinalBtn').addEventListener('click', markFinalPlayed);
    document.getElementById('autoFinalBtn').addEventListener('click', autoFinishFinal);

    // --- Reset y archivar ---
    resetAllBtn.addEventListener('click', resetTournament);

    clearVersusBtn.addEventListener('click', function () {
        if (versus.length === 0 && !preFinalMatch && !finalMatch) {
            alert('No hay enfrentamientos activos para borrar.');
            return;
        }

        if (!confirm('¿Archivar y eliminar TODOS los enfrentamientos actuales? Los puntos se conservarán en el historial.')) return;

        archiveAndClearVersus();
        preFinalMatch = null;
        preFinalPlayed = false;
        finalMatch = null;
        finalPlayed = false;
        semifinalLosers = [];
        semifinalWinners = [];

        tournamentWinner = null;
        tournamentFinished = false;
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    });

    // --- Import/Export ---
    exportDataBtn.addEventListener('click', function () {
        const data = {
            tournamentId,
            tournamentName,
            participants,
            versus,
            matchHistory,
            nextVersusId,
            currentPhase,
            tournamentWinner,
            knockoutRound,
            groupRound,
            accumulatedPoints,
            customQualifiedCount,
            tournamentFinished,
            semifinalLosers,
            semifinalWinners,
            preFinalMatch,
            preFinalPlayed,
            finalMatch,
            finalPlayed,
            podium,
            tournamentVisible
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `torneo_${tournamentName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    importDataBtn.addEventListener('click', function () {
        fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
        if (this.files && this.files[0]) {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.participants) {
                        alert('Archivo inválido. Faltan datos requeridos.');
                        return;
                    }
                    tournamentId = data.tournamentId || generateTournamentId();
                    tournamentName = data.tournamentName || 'Torneo Importado';
                    participants = data.participants || [];
                    versus = data.versus || [];
                    matchHistory = data.matchHistory || [];
                    nextVersusId = data.nextVersusId || 1;
                    currentPhase = data.currentPhase || 1;
                    tournamentWinner = data.tournamentWinner || null;
                    knockoutRound = data.knockoutRound || 0;
                    groupRound = data.groupRound || 0;
                    accumulatedPoints = data.accumulatedPoints || {};
                    customQualifiedCount = data.customQualifiedCount || 8;
                    tournamentFinished = data.tournamentFinished || false;
                    semifinalLosers = data.semifinalLosers || [];
                    semifinalWinners = data.semifinalWinners || [];
                    preFinalMatch = data.preFinalMatch || null;
                    preFinalPlayed = data.preFinalPlayed || false;
                    finalMatch = data.finalMatch || null;
                    finalPlayed = data.finalPlayed || false;
                    podium = data.podium || { first: null, second: null, third: null, fourth: null };
                    tournamentVisible = data.tournamentVisible || false;

                    ensureParticipantsObjects();
                    participants.forEach(p => {
                        if (!(p.id in accumulatedPoints)) accumulatedPoints[p.id] = accumulatedPoints[p.name] || 0;
                    });
                    selectedRound = 'all';
                    qualifiedCountInput.value = customQualifiedCount;
                    recalculateAccumulatedPoints();
                    renderAll();
                    saveToLocalStorage();
                    alert('✅ Datos importados correctamente.');
                } catch (err) {
                    alert('❌ Error al importar: ' + err.message);
                }
            };
            reader.readAsText(this.files[0]);
            this.value = '';
        }
    });

    // ============================================================
    // 17. INICIALIZACIÓN
    // ============================================================

    initializeApp();

    setInterval(() => {
        saveToLocalStorage();
    }, 30000);

    // Exponer estado para debugging
    window.__state = {
        participants,
        versus,
        matchHistory,
        accumulatedPoints,
        currentPhase,
        selectedRound,
        customQualifiedCount,
        tournamentId,
        tournamentName
    };

})();