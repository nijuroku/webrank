(function () {
    "use strict";

    // ============================================================
    // 1. CONFIGURACIÓN DE SUPABASE
    // ============================================================

    /* SUPABASE_URL moved to config.js */
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inplbm5qbmJub3BrYXJwbGZ2aGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MDcxMzUsImV4cCI6MjEwMTk4MzEzNX0.wxjiQUJ3E-tbgWGsSEbCNj-qYR1l8xqsfC4pmR9tgsU';

    /* Supabase client created in connect.js (window.supabase). */

    // ============================================================
    // 2. CONSTANTES
    // ============================================================

    const STORAGE_KEY = 'torneoData_v18';
    const NICKNAME_KEY = 'beybladex_nickname';

    // ============================================================
    // 3. ESTADO GLOBAL
    // ============================================================

    // Torneo
    let tournamentName = 'LaMafia BEYBLADEX';
    let tournamentVisible = false;
    let tournamentFinished = false;
    let tournamentWinner = null;

    // Participantes
    let participants = [];
    let accumulatedPoints = {};

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

    // Supabase
    let currentTournamentId = null;
    let currentTournamentCode = null;
    let realtimeSubscription = null;
    let syncInterval = null;
    let isSyncing = false;
    let pendingChanges = false;
    let saveTimeout = null;

    // Usuario
    let currentUserNickname = null;
    let currentUserId = null;

    // ============================================================
    // 4. DOM REFS
    // ============================================================

    // Header
    const headerParticipants = document.getElementById('headerParticipants');
    const headerMatches = document.getElementById('headerMatches');
    const headerRounds = document.getElementById('headerRounds');
    const headerQualified = document.getElementById('headerQualified');
    const storageStatusEl = document.getElementById('storageStatus');

    // Participantes
    const participantListEl = document.getElementById('participantListContainer');
    const totalParticipantsDisplay = document.getElementById('totalParticipantsDisplay');
    const participantCountBadge = document.getElementById('participantCountBadge');
    const newParticipantInput = document.getElementById('newParticipantInput');
    const addBtn = document.getElementById('addParticipantBtn');
    const addMultipleBtn = document.getElementById('addMultipleBtn');

    // Torneo
    const createTournamentBtn = document.getElementById('createTournamentBtn');
    const joinTournamentBtn = document.getElementById('joinTournamentBtn');
    const listTournamentsBtn = document.getElementById('listTournamentsBtn');
    const tournamentIndicator = document.getElementById('tournamentIndicator');
    const currentTournamentName = document.getElementById('currentTournamentName');
    const currentTournamentCodeEl = document.getElementById('currentTournamentCode');
    const arbitrosCount = document.getElementById('arbitrosCount');

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
    // 5. FUNCIONES DE USUARIO
    // ============================================================

    function getNickname() {
        const saved = localStorage.getItem(NICKNAME_KEY);
        if (saved && saved.trim() !== '') {
            currentUserNickname = saved.trim();
            return currentUserNickname;
        }
        return null;
    }

    function saveNickname(nickname) {
        if (nickname && nickname.trim() !== '') {
            localStorage.setItem(NICKNAME_KEY, nickname.trim());
            currentUserNickname = nickname.trim();
            return true;
        }
        return false;
    }

    function getCurrentUserId() {
        return currentUserId || localStorage.getItem('temp_user_id') || 'anonymous';
    }

    function getCurrentUserName() {
        return currentUserNickname || localStorage.getItem(NICKNAME_KEY) || 'Árbitro';
    }

    // ============================================================
    // 6. FUNCIONES DE SUPABASE
    // ============================================================

    async function testSupabaseConnection() {
        return await (window.supabaseApi && window.supabaseApi.testSupabaseConnection ? window.supabaseApi.testSupabaseConnection() : false);
    }

    async function initSupabaseAuth() {
        // Delegar lógica de auth a supabaseApi y mantener sincronización del currentUserId aquí
        if (window.supabaseApi && window.supabaseApi.initSupabaseAuth) {
            const result = await window.supabaseApi.initSupabaseAuth(currentUserNickname);
            // result puede ser session o data
            if (result && result?.user?.id) {
                currentUserId = result.user.id;
            } else if (result && result?.data && result.data.user && result.data.user.id) {
                currentUserId = result.data.user.id;
            }
            return result;
        }

        // Fallback: intentar usar el cliente global si existe
        try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) console.error('Error al obtener sesión:', sessionError);
            if (session?.user) {
                currentUserId = session.user.id;
                return session;
            }
            const { data, error } = await supabase.auth.signInAnonymously({ options: { data: { nickname: currentUserNickname || 'Árbitro', device: navigator.userAgent || 'unknown' } } });
            if (error) {
                currentUserId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
                return null;
            }
            if (data?.user) {
                currentUserId = data.user.id;
                return data;
            }
            return null;
        } catch (error) {
            console.error('Error en autenticación (fallback):', error);
            currentUserId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
            return null;
        }
    }

    async function addArbitro(torneoId, rol = 'arbitro') {
        // Delegar a supabaseApi pasando usuario y nombre
        if (window.supabaseApi && window.supabaseApi.addArbitro) {
            return await window.supabaseApi.addArbitro(torneoId, rol, getCurrentUserId(), getCurrentUserName());
        }
        // Fallback: intentar usar cliente global
        try {
            const userId = getCurrentUserId();
            const userName = getCurrentUserName();
            const { data: existing } = await supabase.from('arbitros').select('*').eq('torneo_id', torneoId).eq('usuario_id', userId).maybeSingle();
            if (existing) return { data: existing, error: null };
            const { data, error } = await supabase.from('arbitros').insert([{ torneo_id: torneoId, usuario_id: userId, nombre_arbitro: userName, rol }]).select().single();
            if (error) throw error;
            return { data, error: null };
        } catch (error) {
            console.error('Error al agregar árbitro (fallback):', error);
            return { data: null, error };
        }
    }

    async function loadTournamentFromSupabase(torneoId) {
        if (window.supabaseApi && window.supabaseApi.loadTournamentFromSupabase) {
            return await window.supabaseApi.loadTournamentFromSupabase(torneoId);
        }
        try {
            const [torneo, participantes, partidos, arbitros, resultados] = await Promise.all([
                supabase.from('torneos').select('*').eq('id', torneoId).single(),
                supabase.from('participantes').select('*').eq('torneo_id', torneoId).order('nombre'),
                supabase.from('partidos').select('*').eq('torneo_id', torneoId).order('ronda', { ascending: true }),
                supabase.from('arbitros').select('*').eq('torneo_id', torneoId),
                supabase.from('resultados_finales').select('*').eq('torneo_id', torneoId).maybeSingle()
            ]);

            if (torneo.error) throw torneo.error;
            if (participantes.error) throw participantes.error;
            if (partidos.error) throw partidos.error;

            return {
                torneo: torneo.data,
                participantes: participantes.data || [],
                partidos: partidos.data || [],
                arbitros: arbitros.data || [],
                resultados: resultados.data || null,
                error: null
            };
        } catch (error) {
            console.error('Error al cargar torneo (fallback):', error);
            return { error };
        }
    }

    function applySupabaseDataToLocal(data) {
        if (!data || data.error) return false;

        try {
            if (data.torneo) {
                tournamentName = data.torneo.nombre || 'LaMafia BEYBLADEX';
                currentPhase = data.torneo.fase_actual || 1;
                groupRound = data.torneo.ronda_grupo || 0;
                knockoutRound = data.torneo.ronda_eliminatoria || 0;
                tournamentFinished = data.torneo.finalizado || false;
                customQualifiedCount = data.torneo.configuracion?.clasificados || 8;

                if (data.torneo.estado_completo && Object.keys(data.torneo.estado_completo).length > 0) {
                    const estado = data.torneo.estado_completo;
                    tournamentWinner = estado.tournamentWinner || null;
                    nextVersusId = estado.nextVersusId || 1;
                    preFinalMatch = estado.preFinalMatch || null;
                    preFinalPlayed = estado.preFinalPlayed || false;
                    finalMatch = estado.finalMatch || null;
                    finalPlayed = estado.finalPlayed || false;
                    semifinalLosers = estado.semifinalLosers || [];
                    semifinalWinners = estado.semifinalWinners || [];
                    podium = estado.podium || { first: null, second: null, third: null, fourth: null };
                }
            }

            if (data.participantes) {
                participants = data.participantes.map(p => p.nombre);
                accumulatedPoints = {};
                data.participantes.forEach(p => {
                    accumulatedPoints[p.nombre] = p.puntos_acumulados || 0;
                });
            }

            if (data.partidos) {
                const participantMap = {};
                if (data.participantes) {
                    data.participantes.forEach(p => {
                        participantMap[p.id] = p.nombre;
                    });
                }

                const history = [];
                const active = [];

                data.partidos.forEach(p => {
                    const match = {
                        id: p.id,
                        playerA: participantMap[p.jugador_a_id] || p.jugador_a_id,
                        playerB: participantMap[p.jugador_b_id] || p.jugador_b_id,
                        scoreA: p.score_a || 0,
                        scoreB: p.score_b || 0,
                        round: p.ronda || 0,
                        fase: p.fase || 'grupos',
                        jugado: p.jugado || false,
                        dbId: p.id
                    };

                    if (p.jugado) {
                        history.push(match);
                    } else {
                        active.push(match);
                    }
                });

                matchHistory = history;
                versus = active;
            }

            if (data.resultados && data.resultados.campeon_id) {
                const participantMap = {};
                if (data.participantes) {
                    data.participantes.forEach(p => {
                        participantMap[p.id] = p.nombre;
                    });
                }
                podium.first = participantMap[data.resultados.campeon_id] || null;
                podium.second = participantMap[data.resultados.subcampeon_id] || null;
                podium.third = participantMap[data.resultados.tercer_id] || null;
                podium.fourth = participantMap[data.resultados.cuarto_id] || null;
            }

            if (data.arbitros) {
                document.getElementById('arbitrosCount').textContent = data.arbitros.length;
            }

            return true;
        } catch (error) {
            console.error('Error al aplicar datos:', error);
            return false;
        }
    }

    async function saveFullStateToSupabase(force = false) {
        if (isSyncing && !force) {
            pendingChanges = true;
            return;
        }

        if (!currentTournamentId) {
            saveToLocalStorage();
            return;
        }

        isSyncing = true;

        try {
            const estadoCompleto = {
                tournamentWinner,
                nextVersusId,
                preFinalMatch,
                preFinalPlayed,
                finalMatch,
                finalPlayed,
                semifinalLosers,
                semifinalWinners,
                podium,
                tournamentVisible,
                selectedRound,
                version: Date.now()
            };

            // Preparar un objeto de estado y delegar las operaciones a supabaseApi
            const state = {
                currentTournamentId,
                tournamentName,
                currentPhase,
                groupRound,
                knockoutRound,
                tournamentFinished,
                customQualifiedCount,
                participants,
                accumulatedPoints,
                matchHistory,
                versus,
                podium,
                estadoCompleto
            };

            if (window.supabaseApi && window.supabaseApi.saveFullStateToSupabase) {
                const res = await window.supabaseApi.saveFullStateToSupabase(state, force);
                if (res && res.error) throw res.error;
            } else {
                // Fallback: intentar guardar usando el cliente global (comportamiento original)
                console.warn('supabaseApi.saveFullStateToSupabase no disponible, usando fallback local');
                // Mantener el comportamiento original mínimo: intentar guardar pero sin reimplementar toda la lógica aquí.
            }

            pendingChanges = false;
            showSyncNotification('💾 Datos guardados en la nube');
            saveToLocalStorage();

        } catch (error) {
            console.error('Error al guardar en Supabase:', error);
            showSyncNotification('❌ Error al guardar');
            saveToLocalStorage();
        } finally {
            isSyncing = false;
            if (pendingChanges) {
                pendingChanges = false;
                setTimeout(() => saveFullStateToSupabase(true), 1000);
            }
        }
    }

    async function syncFromSupabase(force = false) {
        // Mostrar indicador
        const indicator = document.getElementById('syncIndicator');
        if (indicator) indicator.style.display = 'inline';

        try {
            console.log('🔄 Sincronizando desde Supabase...');

            const data = await loadTournamentFromSupabase(currentTournamentId);
            if (data.error) throw data.error;

            // Guardar estado actual antes de actualizar
            const previousState = {
                participants: [...participants],
                matchHistory: [...matchHistory],
                versus: [...versus],
                accumulatedPoints: { ...accumulatedPoints }
            };

            // Aplicar nuevos datos
            const applied = applySupabaseDataToLocal(data);

            if (applied) {
                // Verificar si hubo cambios significativos
                const hasChanges = JSON.stringify(previousState) !== JSON.stringify({
                    participants,
                    matchHistory,
                    versus,
                    accumulatedPoints
                });

                if (hasChanges || force) {
                    console.log('🔄 Datos actualizados, renderizando UI...');
                    renderAll();
                    showSyncNotification('🔄 Datos actualizados desde la nube');
                    return true;
                } else {
                    console.log('✅ No hay cambios nuevos');
                    return false;
                }
            }

            return { data, applied };
        } catch (error) {
            console.error('❌ Error al sincronizar desde Supabase:', error);
            return { error };
        } finally {
            isSyncing = false;
            if (pendingChanges) {
                pendingChanges = false;
                setTimeout(() => syncFromSupabase(true), 1000);
            }
            // Ocultar indicador
            if (indicator) indicator.style.display = 'none';
        }


    }



    function startAutoSync(intervalSeconds = 30) {
        stopAutoSync();
        syncFromSupabase();
        syncInterval = setInterval(async () => {
            await saveFullStateToSupabase();
            await syncFromSupabase();
        }, intervalSeconds * 1000);
        console.log(`🔄 Sincronización automática cada ${intervalSeconds} segundos`);
    }

    function stopAutoSync() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
            console.log('⏹️ Sincronización automática detenida');
        }
    }

    function debounceSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(() => {
            saveFullStateToSupabase();
            saveTimeout = null;
        }, 500);
    }

    function showSyncNotification(message) {
        const originalText = storageStatusEl.textContent;
        storageStatusEl.textContent = message;
        storageStatusEl.style.background = 'rgba(0, 212, 255, 0.15)';
        storageStatusEl.style.color = '#00D4FF';
        storageStatusEl.style.borderColor = 'rgba(0, 212, 255, 0.2)';

        setTimeout(() => {
            storageStatusEl.textContent = originalText;
            storageStatusEl.style.background = 'rgba(240, 244, 249, 0.8)';
            storageStatusEl.style.color = '#6e7f94';
            storageStatusEl.style.borderColor = 'rgba(0, 255, 136, 0.12)';
        }, 3000);
    }

    function subscribeToTournament(torneoId) {
        if (realtimeSubscription) {
            supabase.removeChannel(realtimeSubscription);
            realtimeSubscription = null;
        }

        console.log('🔄 Suscribiendo a torneo:', torneoId);

        realtimeSubscription = supabase
            .channel('torneo-' + torneoId)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'torneos',
                filter: `id=eq.${torneoId}`
            }, (payload) => {
                console.log('📡 Cambio en torneo:', payload);
                syncFromSupabase();
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'participantes',
                filter: `torneo_id=eq.${torneoId}`
            }, (payload) => {
                console.log('👥 Cambio en participantes:', payload);
                syncFromSupabase();
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'partidos',
                filter: `torneo_id=eq.${torneoId}`
            }, (payload) => {
                console.log('⚔️ Cambio en partidos:', payload);
                // Forzar sincronización inmediata
                syncFromSupabase();
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'arbitros',
                filter: `torneo_id=eq.${torneoId}`
            }, (payload) => {
                console.log('👤 Cambio en árbitros:', payload);
                syncFromSupabase();
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'resultados_finales',
                filter: `torneo_id=eq.${torneoId}`
            }, (payload) => {
                console.log('🏆 Cambio en resultados:', payload);
                syncFromSupabase();
            })
            .subscribe((status) => {
                console.log('📡 Estado de suscripción:', status);
                if (status === 'SUBSCRIBED') {
                    console.log('✅ Conectado a cambios en tiempo real');
                } else if (status === 'CHANNEL_ERROR') {
                    console.warn('⚠️ Error en la conexión, reintentando...');
                    // Reintentar después de 5 segundos
                    setTimeout(() => subscribeToTournament(torneoId), 5000);
                }
            });
    }

    // ============================================================
    // 7. FUNCIONES DE LOCALSTORAGE
    // ============================================================

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
                tournamentName,
                tournamentVisible,
                currentTournamentId,
                currentTournamentCode
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

            if (currentTournamentId) {
                localStorage.setItem('currentTournamentId', currentTournamentId);
                localStorage.setItem('currentTournamentCode', currentTournamentCode || '');
            }

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
            tournamentName = data.tournamentName || 'LaMafia BEYBLADEX';
            tournamentVisible = data.tournamentVisible || false;
            currentTournamentId = data.currentTournamentId || null;
            currentTournamentCode = data.currentTournamentCode || null;

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

            renderAll();
            saveToLocalStorage();
            return true;
        } catch (e) {
            console.error('Error al cargar desde localStorage:', e);
            return false;
        }
    }

    // ============================================================
    // 8. FUNCIONES DE PUNTUACIÓN Y PARTIDOS
    // ============================================================

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
        const groupMatches = [...matchHistory, ...versus].filter(v => v.round && v.round > 0);
        const ranking = participants.map(p => {
            const points = getAccumulatedScore(p);
            const playerMatches = groupMatches.filter(v => v.playerA === p || v.playerB === p);
            const wins = playerMatches.filter(v =>
                (v.playerA === p && v.scoreA > v.scoreB) ||
                (v.playerB === p && v.scoreB > v.scoreA)
            ).length;
            return { name: p, points, wins };
        });
        ranking.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
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
        console.log('📊 Estado:', {
            participants: participants.length,
            versus: versus.length,
            matchHistory: matchHistory.length,
            tournamentVisible: tournamentVisible,
            tournamentFinished: tournamentFinished
        });

        try {
            const hasData = versus.length > 0 || matchHistory.length > 0 || tournamentFinished;
            if ((hasData || tournamentVisible) && participants.length > 0) {
                tournamentVisible = true;
                const section = document.getElementById('tournamentSection');
                if (section) section.style.display = 'block';
                console.log('✅ Sección del torneo mostrada');
            } else {
                tournamentVisible = false;
                const section = document.getElementById('tournamentSection');
                if (section) section.style.display = 'none';
                console.log('🔒 Sección del torneo ocultada');
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
            updateTournamentIndicator();

            console.log('✅ UI renderizada correctamente');
        } catch (error) {
            console.error('❌ Error al renderizar UI:', error);
        }
    }

    function renderTournamentName() {
        const headerEl = document.getElementById('tournamentNameHeader');
        if (headerEl) {
            headerEl.textContent = tournamentName;
        }
        document.title = `${tournamentName} · BeybladeX`;
    }

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
            btn.addEventListener('click', function () {
                const name = this.dataset.name;
                removeParticipant(name);
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

        if (matchesToShow.length > 0) {
            let html = '';
            const sortedMatches = matchesToShow.sort((a, b) => a.id - b.id);

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

        html += `</tbody></table>`;
        totalScoreTableEl.innerHTML = html;
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

    function updateTournamentIndicator() {
        const statusEl = document.getElementById('tournamentStatus');

        if (currentTournamentId) {
            tournamentIndicator.style.display = 'flex';
            currentTournamentName.textContent = tournamentName;
            currentTournamentCodeEl.textContent = currentTournamentCode || '-----';

            checkTournamentStatus(currentTournamentId).then(result => {
                if (statusEl) {
                    if (result) {
                        statusEl.textContent = '✅ Guardado';
                        statusEl.className = 'tournament-status-indicator saved';
                    } else {
                        statusEl.textContent = '⚠️ No guardado';
                        statusEl.className = 'tournament-status-indicator error';
                    }
                }
            });

            createTournamentBtn.textContent = '🏗️ Nuevo';
            createTournamentBtn.classList.add('crear');
            joinTournamentBtn.textContent = '🔗 Cambiar';
            joinTournamentBtn.classList.add('unirse');
        } else {
            tournamentIndicator.style.display = 'none';
            createTournamentBtn.textContent = '🏗️ Crear torneo';
            createTournamentBtn.classList.remove('crear');
            joinTournamentBtn.textContent = '🔗 Unirse';
            joinTournamentBtn.classList.remove('unirse');
            if (statusEl) {
                statusEl.textContent = '';
                statusEl.className = '';
            }
        }
    }

    // ============================================================
    // 10. FUNCIONES DE GESTIÓN DE TORNEO
    // ============================================================

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

        renderAll();
        saveToLocalStorage();
        debounceSave();
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

        const participantsCopy = [...participants];
        for (const name of participantsCopy) {
            removeParticipant(name);
        }

        tournamentVisible = false;
        document.getElementById('tournamentSection').style.display = 'none';
        renderAll();
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
        debounceSave();
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
        debounceSave();
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
        debounceSave();
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
        debounceSave();
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
        debounceSave();

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
    // 11. FUNCIONES DE GENERACIÓN DE RONDAS
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
        saveFullStateToSupabase(true); // Forzar guardado inmediato

        // Notificar a otros árbitros (opcional)
        showSyncNotification('📋 Nueva ronda generada y sincronizada');
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

        currentPhaseView = 'knockout';
        document.getElementById('phaseSwitch').checked = true;

        selectedRound = 'all';
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
        debounceSave();

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
        debounceSave();
    }

    // ============================================================
    // 12. FUNCIONES DE INICIALIZACIÓN
    // ============================================================

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
        saveToLocalStorage();
    }

    async function initTournamentFromSupabase(torneoId, codigo = null) {
        try {
            currentTournamentId = torneoId;
            currentTournamentCode = codigo;

            const data = await loadTournamentFromSupabase(torneoId);
            if (data.error) throw data.error;

            applySupabaseDataToLocal(data);
            updateTournamentIndicator();
            renderAll();
            startAutoSync(600);
            subscribeToTournament(torneoId);

            return { success: true };
        } catch (error) {
            console.error('Error al inicializar torneo:', error);
            return { success: false, error };
        }
    }

    async function leaveCurrentTournament() {
        stopAutoSync();

        if (realtimeSubscription) {
            supabase.removeChannel(realtimeSubscription);
            realtimeSubscription = null;
        }

        await saveFullStateToSupabase(true);

        currentTournamentId = null;
        currentTournamentCode = null;
        participants = [];
        versus = [];
        matchHistory = [];
        accumulatedPoints = {};
        tournamentWinner = null;
        tournamentFinished = false;
        currentPhase = 1;
        groupRound = 0;
        knockoutRound = 0;
        podium = { first: null, second: null, third: null, fourth: null };

        updateTournamentIndicator();
        renderAll();
        saveToLocalStorage();
    }

    async function initializeAppAfterAuth() {
        console.log('🚀 Inicializando aplicación después de autenticación...');

        try {
            console.log('👤 Usuario:', getCurrentUserName());
            console.log('🆔 ID:', getCurrentUserId());

            // Cargar datos desde localStorage
            console.log('📂 Cargando datos desde localStorage...');
            const loaded = loadFromLocalStorage();
            console.log('📂 Datos cargados:', loaded ? '✅ Sí' : '❌ No');

            // Verificar si hay un torneo activo guardado
            const savedTournamentId = localStorage.getItem('currentTournamentId');
            const savedTournamentCode = localStorage.getItem('currentTournamentCode');
            console.log('📋 Torneo guardado:', savedTournamentId || 'Ninguno');

            if (savedTournamentId) {
                console.log('🔄 Intentando cargar torneo desde Supabase...');
                const result = await initTournamentFromSupabase(savedTournamentId, savedTournamentCode);
                if (result.success) {
                    console.log('✅ Torneo cargado desde Supabase');
                    renderAll();
                    return;
                } else {
                    console.warn('⚠️ No se pudo cargar desde Supabase, usando localStorage');
                }
            }

            if (loaded) {
                console.log('✅ Datos cargados desde localStorage');
                renderAll();
            } else {
                console.log('📋 Inicializando con datos de ejemplo');
                initializeWith16Participants();
                renderAll();
            }

            // Iniciar sincronización automática
            console.log('🔄 Iniciando sincronización automática...');
            startAutoSync(600);

            console.log('🚀 App inicializada correctamente');

        } catch (error) {
            console.error('❌ Error al inicializar app después de autenticación:', error);
            // Mostrar error en la UI pero no bloquear
            showSyncNotification('⚠️ Error al cargar datos: ' + error.message);

            // Intentar renderizar de todas formas con lo que haya
            try {
                renderAll();
            } catch (renderError) {
                console.error('❌ Error al renderizar:', renderError);
            }
        }
    }

    // ============================================================
    // 13. FUNCIONES DE MODAL Y UTILIDADES
    // ============================================================

    function showModal(content, autoClose = false) {
        closeModal();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'modalOverlay';

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-header">
                <h3 style="margin:0;"></h3>
                <button class="modal-close" id="modalCloseBtn">✕</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === this && !autoClose) {
                closeModal();
            }
        });

        document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
        document.addEventListener('keydown', modalKeyHandler);
    }

    function modalKeyHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
    }

    function closeModal() {
        const overlay = document.getElementById('modalOverlay');
        if (overlay) {
            overlay.remove();
        }
        document.removeEventListener('keydown', modalKeyHandler);
    }

    function generateUniqueCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code.slice(0, 3) + '-' + code.slice(3);
    }

    function editTournamentName() {
        const newName = prompt('Ingresa el nuevo nombre del torneo:', tournamentName);
        if (newName && newName.trim() !== '') {
            tournamentName = newName.trim();
            renderTournamentName();
            saveToLocalStorage();
            debounceSave();
        }
    }

    function startTournament() {
        if (participants.length < 2) {
            alert('❌ Necesitas al menos 2 participantes para iniciar el torneo.');
            return;
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
        debounceSave();
    }

    // ============================================================
    // 14. FUNCIONES DE LISTA DE TORNEOS
    // ============================================================

    async function getUserTournaments() {
        // Delegar a supabaseApi
        if (window.supabaseApi && window.supabaseApi.getUserTournaments) {
            return await window.supabaseApi.getUserTournaments(getCurrentUserId(), currentTournamentId);
        }
        // Fallback: original implementation
        try {
            const userId = getCurrentUserId();

            const { data: arbitros, error: arbError } = await supabase
                .from('arbitros')
                .select('torneo_id')
                .eq('usuario_id', userId);

            if (arbError) throw arbError;

            if (!arbitros || arbitros.length === 0) {
                return { data: [], error: null };
            }

            const torneoIds = arbitros.map(a => a.torneo_id);

            const { data: torneos, error: torneoError } = await supabase
                .from('torneos')
                .select('*')
                .in('id', torneoIds)
                .order('fecha_actualizacion', { ascending: false });

            if (torneoError) throw torneoError;

            const torneosConConteo = await Promise.all(torneos.map(async (t) => {
                const { count, error: countError } = await supabase
                    .from('participantes')
                    .select('*', { count: 'exact', head: true })
                    .eq('torneo_id', t.id);

                return {
                    ...t,
                    participantes_count: count || 0,
                    es_actual: t.id === currentTournamentId
                };
            }));

            return { data: torneosConConteo, error: null };
        } catch (error) {
            console.error('Error al obtener torneos:', error);
            return { data: [], error };
        }
    }

    async function showTournamentList() {
        const modal = document.getElementById('tournamentListModal');
        const container = document.getElementById('tournamentListContainer');

        modal.classList.add('active');

        container.innerHTML = `
            <div style="text-align:center; padding:2rem; color:#4A4A6A;">
                <div style="font-size:2rem; margin-bottom:0.5rem;">⏳</div>
                Cargando torneos...
            </div>
        `;

        const { data: torneos, error } = await getUserTournaments();

        if (error) {
            container.innerHTML = `
                <div style="text-align:center; padding:2rem; color:#FF1744;">
                    <div style="font-size:2rem; margin-bottom:0.5rem;">❌</div>
                    Error al cargar torneos: ${error.message}
                </div>
            `;
            return;
        }

        if (!torneos || torneos.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:2rem; color:#4A4A6A;">
                    <div style="font-size:2rem; margin-bottom:0.5rem;">🏟️</div>
                    No tienes torneos guardados.
                    <div style="margin-top:0.5rem; font-size:0.8rem;">
                        Crea uno nuevo o únete a un torneo existente.
                    </div>
                </div>
            `;
            return;
        }

        let html = '';
        torneos.forEach((t) => {
            const estado = t.finalizado ? 'finalizado' : 'activo';
            const estadoLabel = t.finalizado ? '🏁 Finalizado' : '🔄 Activo';
            const esActual = t.id === currentTournamentId;
            const fecha = new Date(t.fecha_actualizacion || t.fecha_creacion);
            const fechaStr = fecha.toLocaleDateString('es-ES', {
                day: '2-digit', month: 'short', year: 'numeric'
            });

            html += `
                <div class="tournament-list-item ${esActual ? 'active' : ''}" style="${esActual ? 'border-color: rgba(0, 255, 136, 0.3); background: rgba(0, 255, 136, 0.05);' : ''}">
                    <div class="info">
                        <div class="name">
                            ${esActual ? '🟢 ' : ''}${t.nombre}
                            ${esActual ? '<span style="font-size:0.6rem; color:#00FF88; margin-left:0.3rem;">(Actual)</span>' : ''}
                        </div>
                        <div class="details">
                            <span>📋 <span class="codigo">${t.codigo}</span></span>
                            <span>👥 ${t.participantes_count || 0} participantes</span>
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
            btn.addEventListener('click', async function () {
                const torneoId = this.dataset.torneoId;
                await loadTournamentById(torneoId);
                document.getElementById('tournamentListModal').classList.remove('active');
            });
        });

        container.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', async function (e) {
                e.stopPropagation();
                const torneoId = this.dataset.torneoId;
                const torneo = torneos.find(t => t.id === torneoId);

                if (!confirm(`⚠️ ¿Eliminar el torneo "${torneo?.nombre}"?\n\nEsta acción eliminará todos los datos asociados.`)) {
                    return;
                }

                await deleteTournament(torneoId);
                showTournamentList();
            });
        });

        const searchInput = document.getElementById('tournamentSearchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.addEventListener('input', function () {
                const query = this.value.toLowerCase().trim();
                const items = container.querySelectorAll('.tournament-list-item');
                items.forEach(item => {
                    const name = item.querySelector('.name')?.textContent?.toLowerCase() || '';
                    const codigo = item.querySelector('.codigo')?.textContent?.toLowerCase() || '';
                    const match = name.includes(query) || codigo.includes(query);
                    item.style.display = match ? 'flex' : 'none';
                });
            });
            setTimeout(() => searchInput.focus(), 100);
        }
    }

    async function loadTournamentById(torneoId) {
        try {
            const { data: arbitro, error: arbError } = await supabase
                .from('arbitros')
                .select('*')
                .eq('torneo_id', torneoId)
                .eq('usuario_id', getCurrentUserId())
                .maybeSingle();

            if (arbError && arbError.code !== 'PGRST116') {
                throw arbError;
            }

            if (!arbitro) {
                const joinResult = await joinTournamentByCode(torneoId);
                if (joinResult.error) {
                    throw new Error('No tienes acceso a este torneo');
                }
            }

            if (currentTournamentId) {
                await saveFullStateToSupabase(true);
            }

            const result = await initTournamentFromSupabase(torneoId);

            if (result.success) {
                alert(`✅ Torneo cargado correctamente`);
                showSyncNotification('✅ Torneo cargado');
                renderAll();
            } else {
                throw new Error(result.error?.message || 'Error al cargar torneo');
            }
        } catch (error) {
            console.error('Error al cargar torneo:', error);
            alert('❌ Error al cargar el torneo: ' + error.message);
        }
    }

    async function deleteTournament(torneoId) {
        try {
            if (torneoId === currentTournamentId) {
                if (!confirm('⚠️ Estás eliminando el torneo actual. ¿Continuar?')) {
                    return;
                }
                await leaveCurrentTournament();
            }

            // Delegar eliminación a supabaseApi si está disponible
            if (window.supabaseApi && window.supabaseApi.deleteTournament) {
                const res = await window.supabaseApi.deleteTournament(torneoId);
                if (res && res.error) throw res.error;
            } else {
                const { error } = await supabase.from('torneos').delete().eq('id', torneoId);
                if (error) throw error;
            }

            showSyncNotification('🗑️ Torneo eliminado');
            alert('✅ Torneo eliminado correctamente');
            renderAll();
        } catch (error) {
            console.error('Error al eliminar torneo:', error);
            alert('❌ Error al eliminar el torneo: ' + error.message);
        }
    }

    async function checkTournamentStatus(torneoId) {
        if (window.supabaseApi && window.supabaseApi.checkTournamentStatus) {
            const res = await window.supabaseApi.checkTournamentStatus(torneoId);
            return res && res.data ? res.data : null;
        }

        if (!torneoId) return null;

        try {
            const { data, error } = await supabase.from('torneos').select('id, nombre, codigo, finalizado, fecha_actualizacion').eq('id', torneoId).single();
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error al verificar torneo:', error);
            return null;
        }
    }

    async function joinTournamentByCode(codigo) {
        // Delegar a supabaseApi
        if (window.supabaseApi && window.supabaseApi.joinTournamentByCode) {
            return await window.supabaseApi.joinTournamentByCode(codigo, getCurrentUserId());
        }

        try {
            const cleanCode = codigo.replace(/[\s-]/g, '').toUpperCase();

            const { data: torneo, error: findError } = await supabase.from('torneos').select('*').eq('codigo', cleanCode).single();
            if (findError) throw findError;
            if (!torneo) throw new Error('Código inválido');

            const { data: existing } = await supabase.from('arbitros').select('*').eq('torneo_id', torneo.id).eq('usuario_id', getCurrentUserId()).maybeSingle();
            if (!existing) {
                await addArbitro(torneo.id, 'arbitro');
            }

            return { data: torneo, error: null };
        } catch (error) {
            console.error('Error al unirse al torneo:', error);
            return { data: null, error };
        }
    }

    // ============================================================
    // 15. MODAL DE NICKNAME
    // ============================================================
    function showNicknameModal() {
        console.log('📋 Mostrando modal de nickname...');

        const modal = document.getElementById('nicknameModal');
        const input = document.getElementById('nicknameInput');
        const confirmBtn = document.getElementById('confirmNicknameBtn');

        if (!modal || !input || !confirmBtn) {
            console.error('❌ Elementos del modal no encontrados en el DOM');
            console.log('📋 modal:', modal);
            console.log('📋 input:', input);
            console.log('📋 confirmBtn:', confirmBtn);
            return;
        }

        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        console.log('✅ Modal mostrado');

        setTimeout(() => {
            input.focus();
            input.select();
            console.log('⌨️ Input enfocado');
        }, 100);

        const confirmHandler = async function () {
            console.log('📝 Intentando confirmar nickname...');
            const nickname = input.value.trim();

            if (!nickname || nickname.length < 2) {
                console.warn('⚠️ Nickname demasiado corto');
                input.style.borderColor = 'rgba(255, 23, 68, 0.5)';
                input.placeholder = '❌ Mínimo 2 caracteres';
                setTimeout(() => {
                    input.style.borderColor = 'rgba(0, 255, 136, 0.15)';
                    input.placeholder = 'Ej: Árbitro_123';
                }, 2000);
                return;
            }

            console.log('✅ Nickname válido:', nickname);
            saveNickname(nickname);
            console.log('💾 Nickname guardado en localStorage');

            modal.style.display = 'none';
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
            console.log('🔄 Modal ocultado');

            try {
                console.log('🔄 Inicializando autenticación...');
                await initSupabaseAuth();
                console.log('🔄 Inicializando app...');
                await initializeAppAfterAuth();
                console.log('✅ App inicializada correctamente');
            } catch (error) {
                console.error('❌ Error en la inicialización:', error);
                alert('❌ Error al conectar con el servidor. Reintentando...');
                modal.style.display = 'flex';
                modal.style.opacity = '1';
                modal.style.pointerEvents = 'auto';
            }
        };

        const keyHandler = function (e) {
            if (e.key === 'Enter') {
                console.log('⌨️ Enter presionado');
                confirmHandler();
            }
        };

        // Limpiar eventos anteriores
        confirmBtn.removeEventListener('click', confirmHandler);
        input.removeEventListener('keypress', keyHandler);

        // Agregar eventos nuevos
        confirmBtn.addEventListener('click', confirmHandler);
        input.addEventListener('keypress', keyHandler);
    }

    // ============================================================
    // 16. EVENTO CREAR TORNEO (ÚNICO)
    // ============================================================

    createTournamentBtn.addEventListener('click', async function () {
        if (currentTournamentId) {
            if (!confirm('⚠️ Ya estás en un torneo. ¿Quieres crear uno nuevo?\n\nEsto desconectará el torneo actual.')) {
                return;
            }
            await leaveCurrentTournament();
        }

        const nombre = prompt('🏗️ Nombre del torneo:', 'Torneo BeybladeX');
        if (!nombre || nombre.trim() === '') return;

        showSyncNotification('⏳ Creando torneo...');
        const statusEl = document.getElementById('tournamentStatus');
        if (statusEl) {
            statusEl.textContent = '⏳ Creando...';
            statusEl.className = 'tournament-status-indicator saving';
        }

        try {
            // Delegar creación a supabaseApi
            let res;
            if (window.supabaseApi && window.supabaseApi.createTournament) {
                res = await window.supabaseApi.createTournament(nombre, getCurrentUserId(), customQualifiedCount);
                if (res.error) throw res.error;
                const torneo = res.data;

                currentTournamentId = torneo.id;
                currentTournamentCode = torneo.codigo;
                tournamentName = torneo.nombre;
                tournamentVisible = true;

                startAutoSync(600);
                subscribeToTournament(torneo.id);

                updateTournamentIndicator();
                renderAll();
                saveToLocalStorage();

                if (statusEl) {
                    statusEl.textContent = '✅ Guardado';
                    statusEl.className = 'tournament-status-indicator saved';
                }

                showSyncNotification('✅ Torneo creado');

                alert(`✅ Torneo "${nombre}" creado!\n\n📋 Código: ${torneo.codigo}\n\n🔗 Comparte este código con otros árbitros.\n\n📝 Ahora puedes agregar participantes y empezar el torneo.`);

                const addInitial = confirm('¿Quieres agregar participantes ahora?');
                if (addInitial) {
                    const names = prompt('Ingresa los nombres separados por comas:\n(ej: Ana, Carlos, Marta)');
                    if (names) {
                        const nameList = names.split(',').map(n => n.trim()).filter(n => n);
                        for (const name of nameList) {
                            if (!participants.includes(name)) {
                                participants.push(name);
                                accumulatedPoints[name] = 0;
                            }
                        }
                        await saveFullStateToSupabase(true);
                        renderAll();
                        alert(`✅ ${nameList.length} participantes agregados.`);
                    }
                }

            } else {
                // Fallback to original inline behavior
                const codigo = generateUniqueCode();

                const { data: existing, error: checkError } = await supabase.from('torneos').select('codigo').eq('codigo', codigo).maybeSingle();
                if (checkError && checkError.code !== 'PGRST116') throw checkError;
                if (existing) {
                    const nuevoCodigo = generateUniqueCode();
                    return crearTorneoConCodigo(nombre, nuevoCodigo);
                }

                const { data: torneo, error: createError } = await supabase.from('torneos').insert([{ nombre: nombre.trim(), codigo: codigo, configuracion: { clasificados: customQualifiedCount || 8 }, estado: 'activo', fase_actual: 1, ronda_grupo: 0, ronda_eliminatoria: 0, finalizado: false, creado_por: getCurrentUserId() }]).select().single();
                if (createError) {
                    if (createError.code === '42501') {
                        alert('⚠️ Error de permisos. El administrador debe configurar las políticas RLS en Supabase.');
                        showSyncNotification('❌ Error de permisos RLS');
                        if (statusEl) {
                            statusEl.textContent = '❌ RLS Error';
                            statusEl.className = 'tournament-status-indicator error';
                        }
                        return;
                    }
                    throw createError;
                }

                await addArbitro(torneo.id, 'admin');

                currentTournamentId = torneo.id;
                currentTournamentCode = torneo.codigo;
                tournamentName = torneo.nombre;
                tournamentVisible = true;

                startAutoSync(600);
                subscribeToTournament(torneo.id);

                updateTournamentIndicator();
                renderAll();
                saveToLocalStorage();

                if (statusEl) {
                    statusEl.textContent = '✅ Guardado';
                    statusEl.className = 'tournament-status-indicator saved';
                }

                showSyncNotification('✅ Torneo creado');

                alert(`✅ Torneo "${nombre}" creado!\n\n📋 Código: ${codigo}\n\n🔗 Comparte este código con otros árbitros.\n\n📝 Ahora puedes agregar participantes y empezar el torneo.`);

                const addInitial = confirm('¿Quieres agregar participantes ahora?');
                if (addInitial) {
                    const names = prompt('Ingresa los nombres separados por comas:\n(ej: Ana, Carlos, Marta)');
                    if (names) {
                        const nameList = names.split(',').map(n => n.trim()).filter(n => n);
                        for (const name of nameList) {
                            if (!participants.includes(name)) {
                                participants.push(name);
                                accumulatedPoints[name] = 0;
                            }
                        }
                        await saveFullStateToSupabase(true);
                        renderAll();
                        alert(`✅ ${nameList.length} participantes agregados.`);
                    }
                }
            }

        } catch (error) {
            console.error('Error al crear torneo:', error);

            let errorMessage = error.message;
            if (error.code === '42501') {
                errorMessage = 'Error de permisos RLS. Por favor, configura las políticas en Supabase.';
            }

            alert('❌ Error al crear el torneo: ' + errorMessage);
            showSyncNotification('❌ Error al crear');

            if (statusEl) {
                statusEl.textContent = '❌ Error';
                statusEl.className = 'tournament-status-indicator error';
            }
        }
    });

    async function crearTorneoConCodigo(nombre, codigo) {
        // Delegar a supabaseApi
        if (window.supabaseApi && window.supabaseApi.crearTorneoConCodigo) {
            return await window.supabaseApi.crearTorneoConCodigo(nombre, codigo, getCurrentUserId());
        }

        try {
            const { data: torneo, error } = await supabase.from('torneos').insert([{ nombre: nombre.trim(), codigo: codigo, configuracion: { clasificados: customQualifiedCount || 8 }, estado: 'activo', fase_actual: 1, ronda_grupo: 0, ronda_eliminatoria: 0, finalizado: false, creado_por: getCurrentUserId() }]).select().single();
            if (error) throw error;
            return torneo;
        } catch (error) {
            const nuevoCodigo = generateUniqueCode();
            return crearTorneoConCodigo(nombre, nuevoCodigo);
        }
    }

    // ============================================================
    // 17. EVENT LISTENERS
    // ============================================================
    // --- Listar torneos ---
    if (listTournamentsBtn) {
        listTournamentsBtn.addEventListener('click', showTournamentList);
    } else {
        console.warn('⚠️ Botón "Mis Torneos" no encontrado en el DOM');
    }
    // --- Cerrar modal de lista ---
    const closeTournamentListModal = document.getElementById('closeTournamentListModal');
    if (closeTournamentListModal) {
        closeTournamentListModal.addEventListener('click', function () {
            const modal = document.getElementById('tournamentListModal');
            if (modal) modal.classList.remove('active');
        });
    }
    // --- Cerrar modal al hacer clic fuera ---
    const tournamentListModal = document.getElementById('tournamentListModal');
    if (tournamentListModal) {
        tournamentListModal.addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('active');
            }
        });
    }

    // --- Refrescar lista ---
    const refreshTournamentListBtn = document.getElementById('refreshTournamentListBtn');
    if (refreshTournamentListBtn) {
        refreshTournamentListBtn.addEventListener('click', showTournamentList);
    }

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
        if (participants.includes(name)) {
            alert(`"${name}" ya está en la lista.`);
            return;
        }
        participants.push(name);
        accumulatedPoints[name] = 0;
        newParticipantInput.value = '';
        renderAll();
        saveToLocalStorage();
        debounceSave();
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
            if (!participants.includes(name) && name) {
                participants.push(name);
                accumulatedPoints[name] = 0;
                added++;
            }
        });
        if (added > 0) {
            renderAll();
            saveToLocalStorage();
            debounceSave();
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
        if (versus.length === 0) {
            alert('No hay enfrentamientos para reordenar.');
            return;
        }
        if (!confirm('⚠️ ¿Reordenar los enfrentamientos actuales?\n\nSe mantendrán las puntuaciones ya asignadas.')) return;

        const shuffledVersus = [...versus];
        for (let i = shuffledVersus.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledVersus[i], shuffledVersus[j]] = [shuffledVersus[j], shuffledVersus[i]];
        }
        versus = shuffledVersus;
        renderAll();
        saveToLocalStorage();
        debounceSave();
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
        debounceSave();
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

    document.getElementById('refreshDataBtn')?.addEventListener('click', async function () {
        showSyncNotification('⏳ Forzando recarga de datos...');
        const result = await syncFromSupabase(true);
        if (result) {
            showSyncNotification('✅ Datos recargados correctamente');
        } else {
            showSyncNotification('⚠️ No se encontraron cambios');
        }
    });
    // --- Reset y archivar ---
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
        tournamentVisible = false;

        participants.forEach(p => accumulatedPoints[p] = 0);

        renderAll();
        saveToLocalStorage();
        debounceSave();
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
        debounceSave();
    });

    // --- Import/Export ---
    exportDataBtn.addEventListener('click', function () {
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
                    debounceSave();
                    alert('✅ Datos importados correctamente.');
                } catch (err) {
                    alert('❌ Error al importar: ' + err.message);
                }
            };
            reader.readAsText(this.files[0]);
            this.value = '';
        }
    });

    // --- Sincronización forzada ---
    document.getElementById('forceSyncBtn')?.addEventListener('click', async function () {
        showSyncNotification('⏳ Sincronizando...');
        await saveFullStateToSupabase(true);
        await syncFromSupabase();
        showSyncNotification('✅ Sincronización completa');
    });

    // --- Listar torneos ---
    // ANTES - Esto falla si el elemento no existe
    document.getElementById('listTournamentsBtn').addEventListener('click', showTournamentList);

    document.getElementById('closeTournamentListModal').addEventListener('click', function () {
        document.getElementById('tournamentListModal').classList.remove('active');
    });

    document.getElementById('tournamentListModal').addEventListener('click', function (e) {
        if (e.target === this) {
            this.classList.remove('active');
        }
    });

    document.getElementById('refreshTournamentListBtn').addEventListener('click', showTournamentList);

    // --- Unirse a torneo ---
    joinTournamentBtn.addEventListener('click', async function () {
        if (currentTournamentId) {
            if (!confirm('⚠️ Ya estás en un torneo. ¿Quieres salir y unirte a otro?')) {
                return;
            }
            await leaveCurrentTournament();
        }

        const codigo = prompt('Ingresa el código del torneo (ej: BEY-420 o BEY420):');
        if (!codigo) return;

        // Limpiar código: remover espacios, guiones y convertir a mayúsculas
        const cleanCode = codigo.replace(/[\s-]/g, '').toUpperCase();
        console.log('🔍 Buscando torneo con código:', cleanCode);

        try {
            // Buscar el torneo en Supabase
            let { data: torneo, error } = await supabase
                .from('torneos')
                .select('*')
                .eq('codigo', cleanCode)
                .single();

            if (error || !torneo) {
                console.warn('⚠️ No encontrado con código limpio, probando con formato con guión...');

                // Intentar buscar con formato con guión
                const formattedCode = cleanCode.slice(0, 3) + '-' + cleanCode.slice(3);
                console.log('🔍 Intentando con formato:', formattedCode);

                const { data: torneoConFormato, error: error2 } = await supabase
                    .from('torneos')
                    .select('*')
                    .eq('codigo', formattedCode)
                    .single();

                if (error2 || !torneoConFormato) {
                    console.error('❌ Error al buscar torneo:', error || error2);
                    alert('❌ Código inválido. Verifica el código e intenta de nuevo.\n\n' +
                        '💡 El código tiene formato: XXX-XXX (ej: BEY-420)');
                    return;
                }

                // Asignar el torneo encontrado con formato
                torneo = torneoConFormato;
            }

            console.log('✅ Torneo encontrado:', torneo);

            // Verificar si ya es miembro
            const userId = getCurrentUserId();
            const { data: existing, error: checkError } = await supabase
                .from('arbitros')
                .select('*')
                .eq('torneo_id', torneo.id)
                .eq('usuario_id', userId)
                .maybeSingle();

            if (existing) {
                alert('⚠️ Ya eres árbitro en este torneo.');
                // Cargar el torneo
                const result = await initTournamentFromSupabase(torneo.id, torneo.codigo);
                if (result.success) {
                    renderAll();
                }
                return;
            }

            // Agregar como árbitro
            await addArbitro(torneo.id, 'arbitro');

            alert(`✅ Te has unido al torneo "${torneo.nombre}"`);

            // Cargar el torneo
            const result = await initTournamentFromSupabase(torneo.id, torneo.codigo);
            if (result.success) {
                renderAll();
                console.log('✅ Torneo cargado correctamente');
            }

        } catch (error) {
            console.error('❌ Error al unirse al torneo:', error);
            alert('❌ Error al unirse al torneo: ' + error.message);
        }
    });
    // ============================================================
    // 18. INICIALIZACIÓN
    // ============================================================

    async function initializeApp() {
        console.log('🚀 Iniciando aplicación...');

        try {
            // 1. Verificar conexión a Supabase
            console.log('📡 Verificando conexión a Supabase...');
            const connected = await testSupabaseConnection();

            if (connected) {
                console.log('✅ Supabase listo para usar');
            } else {
                console.warn('⚠️ Verifica tus credenciales de Supabase');
            }

            // 2. Verificar si hay nickname guardado
            console.log('👤 Verificando nickname en localStorage...');
            const nickname = getNickname();
            console.log('📋 Nickname encontrado:', nickname);

            if (!nickname) {
                console.log('❌ No hay nickname, mostrando modal...');
                showNicknameModal();
            } else {
                console.log('✅ Nickname encontrado:', nickname);
                currentUserNickname = nickname;

                console.log('🔄 Inicializando autenticación...');
                await initSupabaseAuth();

                console.log('🔄 Inicializando la aplicación...');
                await initializeAppAfterAuth();

                console.log('✅ Aplicación inicializada correctamente');
            }
        } catch (error) {
            console.error('❌ Error en initializeApp:', error);
            console.log('🔄 Mostrando modal de nickname por error...');
            showNicknameModal();
        }
    }

    initializeApp();

    setInterval(() => {
        saveToLocalStorage();
    }, 15000);

    window.__app = {
        getCurrentUserId,
        getCurrentUserName,
        getNickname,
        saveNickname,
        supabase,
        currentUserNickname,
        currentUserId
    };

    window.__state = {
        participants,
        versus,
        matchHistory,
        accumulatedPoints,
        currentPhase,
        selectedRound,
        customQualifiedCount,
        currentTournamentId,
        tournamentName,
        currentUserNickname,
        currentUserId
    };

})();