(function () {
    "use strict";

    // --- Estado ---
    let tournamentVisible = false;
    let tournamentName = 'LaMafia BEYBLADEX';
    let participants = [];
    let versus = [];
    let matchHistory = [];
    let nextVersusId = 1;
    let currentPhase = 1;
    let tournamentWinner = null;
    let knockoutRound = 0;
    let groupRound = 0;
    let accumulatedPoints = {};
    let selectedRound = 'all';
    let customQualifiedCount = 8;
    let tournamentFinished = false;
    let semifinalLosers = [];
    let semifinalWinners = [];
    let preFinalMatch = null;      // Partido por el 3er y 4to lugar
    let preFinalPlayed = false;
    let finalMatch = null;
    let finalPlayed = false;

    // --- PODIO (resultados de eliminatorias) ---
    let podium = {
        first: null,   // Campeón
        second: null,  // Subcampeón (perdedor de la final)
        third: null,   // 3er lugar (ganador de la pre-final)
        fourth: null   // 4to lugar (perdedor de la pre-final)
    };

    // --- Clave para localStorage ---
    const STORAGE_KEY = 'torneoData_v18';

    // --- DOM refs ---
    const participantListEl = document.getElementById('participantListContainer');
    const versusListEl = document.getElementById('versusListContainer');
    const scoreSummaryEl = document.getElementById('scoreSummaryContainer');
    const totalScoreTableEl = document.getElementById('totalScoreTableContainer');
    const winnerMessageEl = document.getElementById('winnerMessage');
    const thirdPlaceMessageEl = document.getElementById('thirdPlaceMessage');
    const phaseDisplayEl = document.getElementById('phaseDisplay');
    const roundDisplayEl = document.getElementById('roundDisplay');
    const qualifiedCountDisplay = document.getElementById('qualifiedCountDisplay');
    const storageStatusEl = document.getElementById('storageStatus');
    const totalMatchesDisplay = document.getElementById('totalMatchesDisplay');
    const totalRoundsDisplay = document.getElementById('totalRoundsDisplay');
    const totalParticipantsDisplay = document.getElementById('totalParticipantsDisplay');
    const roundSelectorContainer = document.getElementById('roundSelectorContainer');
    const qualifiedCountInput = document.getElementById('qualifiedCountInput');
    const applyQualifiedBtn = document.getElementById('applyQualifiedBtn');
    const newParticipantInput = document.getElementById('newParticipantInput');
    const addBtn = document.getElementById('addParticipantBtn');
    const addMultipleBtn = document.getElementById('addMultipleBtn');
    const generateGroupBtn = document.getElementById('generateGroupStageBtn');
    const startKnockoutBtn = document.getElementById('startKnockoutBtn');
    const resetAllBtn = document.getElementById('resetAllBtn');
    const clearVersusBtn = document.getElementById('clearVersusBtn');
    const exportDataBtn = document.getElementById('exportDataBtn');
    const importDataBtn = document.getElementById('importDataBtn');
    const fileInput = document.getElementById('fileInput');

    // --- Header stats ---
    const headerParticipants = document.getElementById('headerParticipants');
    const headerMatches = document.getElementById('headerMatches');
    const headerRounds = document.getElementById('headerRounds');
    const headerQualified = document.getElementById('headerQualified');

    // --- Funciones de localStorage ---
    function saveToLocalStorage() {
        try {
            const data = {
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
                tournamentName,  // <-- AÑADIR ESTA LÍNEA
                tournamentVisible  // <-- AÑADIR
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
            tournamentName = data.tournamentName || 'LaMafia BEYBLADEX';  // <-- AÑADIR ESTA LÍNEA
            tournamentVisible = data.tournamentVisible || false;

            participants.forEach(p => {
                if (!(p in accumulatedPoints)) accumulatedPoints[p] = 0;
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
            return true;
        } catch (e) {
            console.error('Error al cargar desde localStorage:', e);
            storageStatusEl.textContent = '⚠️ No se pudieron cargar';
            storageStatusEl.style.background = 'rgba(253, 240, 213, 0.9)';
            storageStatusEl.style.color = '#8a6d2b';
            return false;
        }
    }
    // --- Ocultar torneo ---
    function hideTournament() {
        const hasData = versus.length > 0 || matchHistory.length > 0 || tournamentFinished;
        if (!hasData) {
            tournamentVisible = false;
            document.getElementById('tournamentSection').style.display = 'none';
        }
    }

    // --- Iniciar torneo ---
    function startTournament() {
        if (participants.length < 2) {
            alert('❌ Necesitas al menos 2 participantes para iniciar el torneo.');
            return;
        }

        tournamentVisible = true;
        document.getElementById('tournamentSection').style.display = 'block';

        // Scroll suave hacia la sección del torneo
        setTimeout(() => {
            const section = document.getElementById('tournamentSection');
            if (section) {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);

        renderAll();
        saveToLocalStorage();
    }

    // --- Render: nombre del torneo ---
    function renderTournamentName() {
        const headerEl = document.getElementById('tournamentNameHeader');
        if (headerEl) {
            headerEl.textContent = tournamentName;
        }
        // Actualizar título de la página
        document.title = `${tournamentName} · BeybladeX`;
    }
    // --- Editar nombre del torneo ---
    function editTournamentName() {
        const newName = prompt('Ingresa el nuevo nombre del torneo:', tournamentName);
        if (newName && newName.trim() !== '') {
            tournamentName = newName.trim();
            renderTournamentName();
            saveToLocalStorage();
        }
    }

    // --- Funciones de puntuación (SOLO GRUPOS) ---
    function getAccumulatedScore(playerName) {
        return accumulatedPoints[playerName] || 0;
    }

    function recalculateAccumulatedPoints() {
        participants.forEach(p => accumulatedPoints[p] = 0);

        for (let v of matchHistory) {
            if (v.round && v.round > 0) {
                const diffA = v.scoreA - v.scoreB;
                const diffB = v.scoreB - v.scoreA;
                accumulatedPoints[v.playerA] = (accumulatedPoints[v.playerA] || 0) + diffA;
                accumulatedPoints[v.playerB] = (accumulatedPoints[v.playerB] || 0) + diffB;
            }
        }

        for (let v of versus) {
            if (v.round && v.round > 0) {
                const existsInHistory = matchHistory.some(h =>
                    h.id === v.id &&
                    h.playerA === v.playerA &&
                    h.playerB === v.playerB
                );
                if (!existsInHistory) {
                    const diffA = v.scoreA - v.scoreB;
                    const diffB = v.scoreB - v.scoreA;
                    accumulatedPoints[v.playerA] = (accumulatedPoints[v.playerA] || 0) + diffA;
                    accumulatedPoints[v.playerB] = (accumulatedPoints[v.playerB] || 0) + diffB;
                }
            }
        }
    }

    function getGroupRanking() {
        const ranking = participants.map(p => ({
            name: p,
            points: getAccumulatedScore(p)
        }));
        ranking.sort((a, b) => b.points - a.points);
        return ranking;
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

    function getVersusByRound(round) {
        const allMatches = [...matchHistory, ...versus];
        if (round === 'all') return allMatches;
        return allMatches.filter(v => v.round === round);
    }

    function generatePairings(players) {
        const shuffled = [...players];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const pairings = [];
        const numPairs = Math.floor(shuffled.length / 2);

        for (let i = 0; i < numPairs; i++) {
            pairings.push({
                playerA: shuffled[i * 2],
                playerB: shuffled[i * 2 + 1]
            });
        }

        return pairings;
    }

    // --- Obtener nombre de la ronda eliminatoria ---
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

    // --- Render: participantes ---
    function renderParticipants() {
        if (participants.length === 0) {
            participantListEl.innerHTML = `<span class="empty-message">Aún no hay participantes</span>`;
            return;
        }
        let html = '';
        const sorted = [...participants].sort();
        sorted.forEach(p => {
            const pts = getAccumulatedScore(p);
            html += `<span class="participant-tag">${p} (${pts} pts) <button class="remove-btn" data-name="${p}">✕</button></span>`;
        });
        participantListEl.innerHTML = html;

        document.querySelectorAll('.participant-tag .remove-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                const name = this.dataset.name;
                removeParticipant(name);
            });
        });

        updateStats();
    }

    // --- Render: selector de rondas ---
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

    // --- Render: podio ---
    // --- Render: podio ---
    function renderPodium() {
        return `
            <div class="podium-container">
                <div class="podium-title" class="podium-title">🏆 ${tournamentName} 🏆</div>
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
                    <span class="tourney-name" >🏆 ${tournamentName}</span>
                    ${podium.third ? `<span style="color:#00FF88;"> · 🥉 3er Lugar: ${podium.third}</span>` : ''}
                    ${podium.fourth ? `<span style="color:#4A4A6A;"> · 4️⃣ 4to Lugar: ${podium.fourth}</span>` : ''}
                </div>
            </div>
        `;
    }


    // --- Render: versus ---
    function renderVersus() {
        const roundTitle = getRoundTitle();
        const titleEl = document.querySelector('.phase-indicator h2');
        if (titleEl) {
            titleEl.textContent = roundTitle;
        }

        if (tournamentFinished && tournamentWinner) {
            const podiumHTML = renderPodium();
            versusListEl.innerHTML = podiumHTML;
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

        if (matchesToShow.length > 0) {
            let html = '';
            const sortedMatches = matchesToShow.sort((a, b) => a.id - b.id);

            sortedMatches.forEach((v, index) => {
                const isPlayed = (v.scoreA !== 0 || v.scoreB !== 0);
                const statusClass = isPlayed ? 'played' : 'unplayed';
                const isPreFinal = v === preFinalMatch;
                const isFinal = v === finalMatch;
                const roundLabel = v.round ? `R${v.round}` : 'KO';

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
                    <div class="score-display">${v.scoreA}</div>
                    <span class="player-name">${v.playerA}</span>
                </div>
                <div class="score-control">
                    <button class="dec-score" data-player="${v.playerA}" data-vsid="${v.id}" data-dir="-1">−</button>
                    <button class="inc-score" data-player="${v.playerA}" data-vsid="${v.id}" data-dir="1">+</button>
                </div>
                <span class="vs-badge" style="color:${badgeColor};">
                    ${badgeText}
                    
                </span>
                <div class="score-control">
                    <button class="dec-score" data-player="${v.playerB}" data-vsid="${v.id}" data-dir="-1">−</button>
                    <button class="inc-score" data-player="${v.playerB}" data-vsid="${v.id}" data-dir="1">+</button>
                </div>
                <div class="player-score-block">
                    <div class="score-display">${v.scoreB}</div>
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
                btn.addEventListener('click', function (e) {
                    const vsId = this.dataset.vsid;
                    const player = this.dataset.player;
                    const dir = parseInt(this.dataset.dir, 10);
                    const vsIdNum = parseInt(vsId, 10);

                    if (preFinalMatch && preFinalMatch.id === vsIdNum) {
                        updatePreFinalScore(player, dir);
                    } else if (finalMatch && finalMatch.id === vsIdNum) {
                        updateFinalScore(player, dir);
                    } else {
                        updateScore(vsIdNum, player, dir);
                    }
                });
            });

            document.querySelectorAll('[data-action="play-pre-final"]').forEach(btn => {
                btn.addEventListener('click', function () {
                    markPreFinalPlayed();
                });
            });
            document.querySelectorAll('[data-action="auto-pre-final"]').forEach(btn => {
                btn.addEventListener('click', function () {
                    autoFinishPreFinal();
                });
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
                        <div class="versus-item archived-match" style="opacity:0.6;">
                            <div class="player-score-block">
                                <div class="score-display">${v.scoreA}</div>
                                <span class="player-name">${v.playerA}</span>
                            </div>
                            <span class="vs-badge" style="color:#4A4A6A;">✅ VS <span class="round-tag">${roundLabel}</span></span>
                            <div class="player-score-block">
                                <div class="score-display">${v.scoreB}</div>
                                <span class="player-name">${v.playerB}</span>
                            </div>
                        </div>
                    `;
                });
                versusListEl.innerHTML = html;
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
    // --- Render: resumen de puntos (SOLO GRUPOS) ---
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

    // --- Render: tabla de puntuación total (SOLO GRUPOS) ---
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
                    <td class="matches-cell">${playerMatches.length}</td>
                    <td class="matches-cell" style="color:#00FF88;">${wins}</td>
                    <td class="matches-cell" style="color:#FF1744;">${losses}</td>
                    <td class="matches-cell">${roundsPlayed.size}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        totalScoreTableEl.innerHTML = html;
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

    // --- Acciones ---
    function removeParticipant(name) {
        const inMatches = matchHistory.some(v => v.playerA === name || v.playerB === name);
        const inVersus = versus.some(v => v.playerA === name || v.playerB === name);

        if (inMatches || inVersus) {
            alert(`No se puede eliminar a "${name}" porque tiene partidos registrados.`);
            return;
        }

        participants = participants.filter(p => p !== name);
        delete accumulatedPoints[name];
        if (tournamentWinner === name) tournamentWinner = null;

        // Renderizar todo para actualizar la lista
        renderAll();
        saveToLocalStorage();
    }

    // --- Borrar todos los participantes ---
    function clearAllParticipants() {
        // Verificar si hay partidos registrados
        const hasMatches = matchHistory.some(v => v.playerA || v.playerB);
        const hasVersus = versus.some(v => v.playerA || v.playerB);

        if (hasMatches || hasVersus) {
            alert('❌ No se pueden borrar los participantes porque tienen partidos registrados.\n\nPrimero debes reiniciar el torneo o archivar las rondas.');
            return;
        }

        if (participants.length === 0) {
            alert('No hay participantes para borrar.');
            return;
        }

        if (!confirm(`⚠️ ¿Estás seguro de borrar TODOS los ${participants.length} participantes?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        // Borrar participantes
        participants = [];
        accumulatedPoints = {};
        tournamentWinner = null;
        thirdPlaceWinner = null;
        podium = { first: null, second: null, third: null, fourth: null };

        // Limpiar el contenedor de participantes
        participantListEl.innerHTML = '<span class="empty-message">Aún no hay participantes</span>';

        // Actualizar stats
        updateStats();

        // Guardar en localStorage
        saveToLocalStorage();

        alert('✅ Todos los participantes han sido eliminados.');
    }

    function updateScore(vsId, player, direction) {
        const vs = versus.find(v => v.id === vsId);
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

    function removeVersusById(vsId) {
        versus = versus.filter(v => v.id !== vsId);
        recalculateAccumulatedPoints();
        if (versus.length === 0 && matchHistory.length === 0) tournamentWinner = null;
        renderAll();
        saveToLocalStorage();
    }

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
        const qualified = ranking.slice(0, qualifiedCount).map(p => p.name);

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
                    playerA: shuffled[i],
                    playerB: shuffled[i + 1],
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

        selectedRound = 'all';
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function nextKnockoutRound() {
        if (currentPhase !== 2) {
            alert('No estás en fase de eliminatorias.');
            return;
        }

        // Si hay PRE-FINAL o FINAL pendiente, no avanzar
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

        // Guardar resultados de SEMIFINALES (cuando hay 2 partidos = 4 jugadores)
        if (versus.length === 2) {
            semifinalLosers = losers;
            semifinalWinners = winners;

            // Archivar semifinales
            archiveAndClearVersus();

            // CREAR AMBOS ENFRENTAMIENTOS: PRE-FINAL y FINAL
            if (semifinalLosers.length === 2 && semifinalWinners.length === 2) {
                // PRE-FINAL (3er y 4to lugar)
                preFinalMatch = {
                    playerA: semifinalLosers[0],
                    playerB: semifinalLosers[1],
                    scoreA: 0,
                    scoreB: 0,
                    id: nextVersusId++
                };
                preFinalPlayed = false;

                // FINAL
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

        // Si es una ronda normal (no semifinales), avanzar
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

    // --- Exportar / Importar datos ---
    function exportData() {
        const data = {
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
            podium
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `torneo_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importData(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.participants) {
                    alert('Archivo inválido. Faltan datos requeridos.');
                    return;
                }
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
                participants.forEach(p => {
                    if (!(p in accumulatedPoints)) accumulatedPoints[p] = 0;
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
        reader.readAsText(file);
    }

    function addMultipleParticipants() {
        const names = prompt('Ingresa los nombres separados por comas (ej: Juan, María, Pedro, Ana):');
        if (!names) return;
        const nameList = names.split(',').map(n => n.trim()).filter(n => n);
        let added = 0;
        nameList.forEach(name => {
            if (!participants.includes(name) && name) {
                participants.push(name);
                accumulatedPoints[name] = 0;
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
    }

    function applyQualifiedCount() {
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
    }

    function renderAll() {
        // Mostrar/ocultar sección del torneo
        const hasData = versus.length > 0 || matchHistory.length > 0 || tournamentFinished;
        if (hasData || tournamentVisible) {
            tournamentVisible = true;
            document.getElementById('tournamentSection').style.display = 'block';
        } else {
            document.getElementById('tournamentSection').style.display = 'none';
        }

        renderTournamentName();
        renderParticipants();  // <-- ESTA LÍNEA ACTUALIZA LA LISTA
        renderRoundSelector();
        renderVersus();
        renderScores();
        renderTotalScoreTable();
        updateStats();
    }

    // --- eventos ---
    // --- Eventos de participantes ---
    addBtn.addEventListener('click', function () {
        const name = newParticipantInput.value.trim();
        if (!name) {
            alert('Escribe un nombre.');
            return;
        }
        if (participants.includes(name)) {
            alert(`"${name}" ya está en la lista.`);
            return;
        }
        participants.push(name);
        accumulatedPoints[name] = 0;
        newParticipantInput.value = '';
        renderAll();
        saveToLocalStorage();
    });

    addMultipleBtn.addEventListener('click', addMultipleParticipants);

    newParticipantInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addBtn.click();
    });

    // --- Evento: Borrar todos los participantes ---
    document.getElementById('clearAllParticipantsBtn')?.addEventListener('click', function (e) {
        e.preventDefault();
        clearAllParticipants();
    });
    // --- Evento: Iniciar torneo ---
    document.getElementById('startTournamentBtn')?.addEventListener('click', startTournament);

    // --- Evento: Editar nombre del torneo ---
    document.getElementById('editTournamentNameBtn')?.addEventListener('click', editTournamentName);

    addMultipleBtn.addEventListener('click', addMultipleParticipants);

    newParticipantInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addBtn.click();
    });

    generateGroupBtn.addEventListener('click', generateGroupRound);

    applyQualifiedBtn.addEventListener('click', applyQualifiedCount);

    qualifiedCountInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyQualifiedCount();
    });

    startKnockoutBtn.addEventListener('click', function () {
        if (currentPhase === 2) {
            nextKnockoutRound();
        } else {
            startKnockout();
        }
    });

    resetAllBtn.addEventListener('click', function () {
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
        tournamentVisible = false;  // <-- AÑADIR

        participants.forEach(p => accumulatedPoints[p] = 0);

        renderAll();
        saveToLocalStorage();
        alert('✅ Torneo reiniciado. Los participantes se mantienen.');
    });

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

    exportDataBtn.addEventListener('click', exportData);

    importDataBtn.addEventListener('click', function () {
        fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
        if (this.files && this.files[0]) {
            importData(this.files[0]);
            this.value = '';
        }
    });

    // --- Inicializar con 16 participantes y Ronda 1 ---
    function initializeWith16Participants() {
        const nombres = [
            'Alejandro', 'Beatriz', 'Carlos', 'Daniela',
            'Eduardo', 'Fernanda', 'Gabriel', 'Helena',
            'Ignacio', 'Julieta', 'Kevin', 'Laura',
            'Manuel', 'Natalia', 'Óscar', 'Paula'
        ];

        participants = nombres;
        participants.forEach(p => accumulatedPoints[p] = 0);

        groupRound = 1;
        const pairings = generatePairings(participants);

        const newVersus = pairings.map(p => ({
            playerA: p.playerA,
            playerB: p.playerB,
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
            const v = versus.find(v => (v.playerA === e.a && v.playerB === e.b) || (v.playerA === e.b && v.playerB === e.a));
            if (v) {
                if (v.playerA === e.a) { v.scoreA = e.sa; v.scoreB = e.sb; }
                else { v.scoreA = e.sb; v.scoreB = e.sa; }
            }
        });

        customQualifiedCount = 8;
        qualifiedCountInput.value = 8;
        selectedRound = 1;
        recalculateAccumulatedPoints();
        saveToLocalStorage();
    }

    // --- Inicialización ---
    const loaded = loadFromLocalStorage();

    if (!loaded) {
        initializeWith16Participants();
    }

    renderAll();

    setInterval(() => {
        saveToLocalStorage();
    }, 15000);

    window.__state = { participants, versus, matchHistory, accumulatedPoints, currentPhase, selectedRound, customQualifiedCount };

})();
