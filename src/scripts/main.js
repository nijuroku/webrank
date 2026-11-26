import { fetchWithTimeout } from '../lib/fetch-with-timeout';
import {
    generatePairings as createPairings,
    generateSwissPairings as createSwissPairings,
    getPreviousGroupPairKeys as collectPreviousGroupPairKeys,
} from '../lib/pairings';
import { calculateAccumulatedPoints, calculateGroupRanking } from '../lib/tournament-scoring';
import { activateAppTab, applyAppTheme, getNextAppTheme, updateAppTabAvailability } from './app-ui';
import { ParticipantAutocomplete } from './participant-autocomplete';
import { SavedPlayerService, fetchAllSupabaseRows } from '../lib/saved-player-service';
import { createBracketRound, getCrossBracketFinals, resolveBracketRound } from '../lib/upper-lower-bracket';

(function () {
    "use strict";

    // ============================================================
    // 1. CONSTANTES
    // ============================================================

    let STORAGE_KEY = 'torneoData_v18';
    let TORNEO_LIST_KEY = 'torneoList_v1';
    const THEME_STORAGE_KEY = 'beybladex_theme';
    const SUPABASE_CONFIG_ENDPOINT = '/api/supabase-config';
    const SUPABASE_TABLES_ENDPOINT = '/rest/v1/finished_tournaments';
    const SHARED_TOURNAMENT_VIEWER_PATH = '/view/';

    function getPlayerProfilePath(playerName) {
        return `/p/${encodeURIComponent(String(playerName || '').trim())}`;
    }

    function playerProfileLinkMarkup(playerName) {
        if (!playerName) return '—';
        return `<a class="score-player-profile" href="${escapeHtml(getPlayerProfilePath(playerName))}">${escapeHtml(playerName)}</a>`;
    }

    function playerTournamentHistoryLinkMarkup(playerName, playerId) {
        if (!playerName) return '—';
        return `<a class="score-player-history" href="#playerHistoryModal" data-player-id="${escapeHtml(playerId)}" title="Ver historial de ${escapeHtml(playerName)} en este torneo">${escapeHtml(playerName)}</a>`;
    }

    // ============================================================
    // 2. ESTADO GLOBAL
    // ============================================================

    let tournamentName = 'LaMafia BEYBLADEX';
    let tournamentVisible = false;
    let tournamentFinished = false;
    let tournamentWinner = null;
    let tournamentId = null; // ID único para el torneo actual
    let tournamentCreatorUserId = null;
    let tournamentCreatorName = null;
    let tournamentCreationLogged = false;
    let finishedTournamentSubmissionId = null;
    let lastLoggedTournamentStateSignature = null;
    let tournamentActivityLogTimer = null;
    let tournamentShareId = null;
    let tournamentShareWriteToken = null;
    let tournamentSharingEnabled = false;
    let sharedTournamentSyncTimer = null;
    let lastSharedTournamentSnapshot = null;
    let tournamentFormat = 'random';
    let swissByes = [];

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

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
    }

    function safeExternalUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.protocol === 'https:' ? url.href : '';
        } catch {
            return '';
        }
    }

    function getParticipantIdByName(name) {
        if (!name) return null;
        const p = participants.find(p => p && p.name === name);
        return p ? p.id : null;
    }

    function capitalizePlayerName(name) {
        const trimmed = String(name || '').trim();
        const characters = Array.from(trimmed);
        if (!characters.length) return '';
        return characters[0].toLocaleUpperCase() + characters.slice(1).join('');
    }

    function participantExistsByName(name) {
        const normalized = (name || '').trim().toLocaleLowerCase();
        return participants.some(p => p && (p.name || '').trim().toLocaleLowerCase() === normalized);
    }

    function ensureParticipantsObjects() {
        if (participants.length === 0) return;
        if (participants[0] && typeof participants[0] === 'string') {
            const names = [...participants];
            participants = names.map(n => ({ id: generateParticipantId(), name: capitalizePlayerName(n) }));
            const newAccum = {};
            participants.forEach((player, index) => {
                const oldName = names[index];
                newAccum[player.id] = (accumulatedPoints && (
                    accumulatedPoints[oldName] || accumulatedPoints[player.name] || accumulatedPoints[player.id]
                )) || 0;
            });
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

        participants.forEach(player => {
            if (player?.name) player.name = capitalizePlayerName(player.name);
        });
        const participantById = new Map(participants.filter(player => player?.id).map(player => [String(player.id), player]));
        const participantByName = new Map(participants.filter(player => player?.name)
            .map(player => [player.name.toLocaleLowerCase(), player]));
        const normalizeMatchNames = match => {
            if (!match) return;
            ['A', 'B'].forEach(side => {
                const nameKey = `player${side}`;
                const idKey = `player${side}Id`;
                const player = participantById.get(String(match[idKey] || '')) ||
                    participantByName.get(String(match[nameKey] || '').trim().toLocaleLowerCase());
                if (player) {
                    match[nameKey] = player.name;
                    match[idKey] = player.id;
                } else if (match[nameKey]) {
                    match[nameKey] = capitalizePlayerName(match[nameKey]);
                }
            });
        };
        versus.forEach(normalizeMatchNames);
        matchHistory.forEach(normalizeMatchNames);
        normalizeMatchNames(preFinalMatch);
        normalizeMatchNames(finalMatch);
        semifinalWinners = semifinalWinners.map(capitalizePlayerName);
        semifinalLosers = semifinalLosers.map(capitalizePlayerName);
        tournamentWinner = capitalizePlayerName(tournamentWinner) || null;
        Object.keys(podium || {}).forEach(place => {
            if (podium[place]) podium[place] = capitalizePlayerName(podium[place]);
        });
    }

    // Partidos
    let versus = [];
    let matchHistory = [];
    let nextVersusId = 1;

    // Fases
    let currentPhase = 1;
    let groupRound = 0;
    let knockoutRound = 0;
    let lowerBracketRound = 0;
    let eliminationMode = 'single';
    let upperByePlayers = [];
    let lowerByePlayers = [];
    let upperWaitingPlayers = [];
    let lowerWaitingPlayers = [];
    let activeEliminationBracket = 'upper';
    let upperFinalists = { winner: null, runnerUp: null };
    let lowerFinalists = { winner: null, runnerUp: null };
    let currentPhaseView = 'groups';
    let selectedRound = 'all';
    let selectedPlayerFilterId = null;
    const routeSegment = window.location.pathname.match(/^\/app\/(participants|vs|table)\/?$/)?.[1];
    const routeTab = routeSegment === 'vs' ? 'matches' : routeSegment;
    const requestedNavigationTab = routeTab || new URLSearchParams(window.location.search).get('tab');
    let activeTab = requestedNavigationTab || 'participants';
    let supabaseConfig = null;
    let supabaseInitialization = null;
    let supabaseAuthClient = null;
    let savedScoreTables = [];
    let activeSavedScoreTable = null;
    let championProfileRequestId = 0;
    const championProfileCache = new Map();

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

    function resetBracketFormat() {
        lowerBracketRound = 0;
        eliminationMode = 'single';
        upperByePlayers = [];
        lowerByePlayers = [];
        upperWaitingPlayers = [];
        lowerWaitingPlayers = [];
        activeEliminationBracket = 'upper';
        upperFinalists = { winner: null, runnerUp: null };
        lowerFinalists = { winner: null, runnerUp: null };
    }

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
    const tabNavigationButtons = document.querySelectorAll('.persistent-navigation [data-tab]');
    const tabPanels = document.querySelectorAll('[data-tab-panel]');

    function activateTab(tabName, scrollToContent = false) {
        const active = activateAppTab(tabName, tournamentVisible, {
            buttons: tabNavigationButtons,
            panels: tabPanels,
            tournamentSection: document.getElementById('tournamentSection')
        }, scrollToContent);
        if (active) activeTab = active;
    }

    function updateTabAvailability() {
        const availableTab = updateAppTabAvailability(activeTab, tournamentVisible, tabNavigationButtons);
        if (availableTab !== activeTab) activateTab(availableTab);
    }

    // Tema
    function applyTheme(theme) {
        applyAppTheme(theme, document.body, themeToggleBtn);
    }

    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'dark');
    themeToggleBtn?.addEventListener('click', function () {
        const nextTheme = getNextAppTheme(document.body.classList.contains('light-theme') ? 'light' : 'dark');
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
    });

    // Participantes
    const participantListEl = document.getElementById('participantListContainer');
    const totalParticipantsDisplay = document.getElementById('totalParticipantsDisplay');
    const participantCountBadge = document.getElementById('participantCountBadge');
    const newParticipantInput = document.getElementById('newParticipantInput');
    const playerSuggestionsEl = document.getElementById('playerSuggestions');
    const addBtn = document.getElementById('addParticipantBtn');
    const participantCard = document.getElementById('participantCard');
    const participantToggleBtn = document.getElementById('participantToggleBtn');
    const classificationContent = document.getElementById('classificationContent');
    const classificationToggleBtn = document.getElementById('classificationToggleBtn');
    const resetTournamentPanel = document.getElementById('resetTournamentPanel');
    const resetTournamentToggleBtn = document.getElementById('resetTournamentToggleBtn');

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
    const playerFilterBar = document.getElementById('playerFilterBar');
    const playerFilterName = document.getElementById('playerFilterName');
    const playerFilterStats = document.getElementById('playerFilterStats');
    const clearPlayerFilterBtn = document.getElementById('clearPlayerFilterBtn');

    // Estadísticas
    const scoreSummaryEl = document.getElementById('scoreSummaryContainer');
    const totalScoreTableEl = document.getElementById('totalScoreTableContainer');
    const totalMatchesDisplay = document.getElementById('totalMatchesDisplay');
    const totalRoundsDisplay = document.getElementById('totalRoundsDisplay');
    const qualifiedCountDisplay = document.getElementById('qualifiedCountDisplay');
    const qualifiedCountInput = document.getElementById('qualifiedCountInput');
    const applyQualifiedBtn = document.getElementById('applyQualifiedBtn');
    const savedScoreTableSelect = document.getElementById('savedScoreTableSelect');
    const refreshSavedScoreTablesBtn = document.getElementById('refreshSavedScoreTablesBtn');

    // Gestión de rondas
    const generateGroupBtn = document.getElementById('generateGroupStageBtn');
    const startKnockoutBtn = document.getElementById('startKnockoutBtn');
    const resetAllBtn = document.getElementById('resetAllBtn');
    const shareTournamentBtn = document.getElementById('shareTournamentBtn');
    const shareTournamentWhatsAppBtn = document.getElementById('shareTournamentWhatsAppBtn');
    const clearVersusBtn = document.getElementById('clearVersusBtn');

    // Import/Export
    const exportDataBtn = document.getElementById('exportDataBtn');
    const importDataBtn = document.getElementById('importDataBtn');
    const fileInput = document.getElementById('fileInput');

    async function initializeSupabase() {
        try {
            const response = await fetchWithTimeout(SUPABASE_CONFIG_ENDPOINT, { cache: 'no-store' });
            if (!response.ok) throw new Error(`Configuración Supabase no disponible (${response.status})`);
            const config = await response.json();
            if (!config.url || !config.anonKey) throw new Error('Faltan variables públicas de Supabase en Vercel.');
            supabaseConfig = { url: config.url.replace(/\/$/, ''), anonKey: config.anonKey };
            revealAdminDashboardLink();
            try {
                const { createClient } = await import('@supabase/supabase-js');
                supabaseAuthClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
                    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
                    global: { fetch: (input, init) => fetchWithTimeout(input, init, 15_000) }
                });
            } catch (authError) { console.warn('No se pudo cargar la sesión del perfil:', authError.message); }
            await loadSavedScoreTables();
        } catch (error) {
            console.warn('Supabase no está configurado:', error.message);
            if (savedScoreTableSelect) {
                savedScoreTableSelect.innerHTML = '<option value="">Supabase aún no está conectado</option>';
                savedScoreTableSelect.disabled = true;
            }
        }
    }

    async function revealAdminDashboardLink() {
        const link = document.getElementById('adminDashboardLink');
        if (!link || !supabaseConfig) return;
        link.hidden = true;
        try {
            const session = JSON.parse(sessionStorage.getItem('lamafia_admin_session') || 'null');
            if (!session?.access_token || !session?.expires_at || session.expires_at <= Date.now()) return;
            const response = await fetchWithTimeout(`${supabaseConfig.url}/auth/v1/user`, {
                headers: {
                    apikey: supabaseConfig.anonKey,
                    Authorization: `Bearer ${session.access_token}`
                }
            });
            if (!response.ok) return;
            const user = await response.json();
            link.hidden = user?.app_metadata?.role !== 'admin';
        } catch (error) {
            link.hidden = true;
        }
    }

    async function supabaseRequest(path, options = {}, accessToken = null) {
        if (!supabaseConfig) throw new Error('Supabase no está conectado. Configura las variables SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.');
        const response = await fetchWithTimeout(`${supabaseConfig.url}${path}`, {
            ...options,
            headers: {
                apikey: supabaseConfig.anonKey,
                Authorization: `Bearer ${accessToken || supabaseConfig.anonKey}`,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`Supabase ${response.status}: ${message || response.statusText}`);
        }
        if (response.status === 204) return null;
        const responseBody = await response.text();
        return responseBody ? JSON.parse(responseBody) : null;
    }

    const savedPlayerService = new SavedPlayerService(supabaseRequest);
    const participantAutocomplete = new ParticipantAutocomplete(newParticipantInput, playerSuggestionsEl, {
        search: {
            async search(query) {
                if (!supabaseConfig && supabaseInitialization) await supabaseInitialization;
                return supabaseConfig ? savedPlayerService.search(query) : [];
            }
        },
        getCurrentParticipantNames: () => participants.map(player => String(player?.name || player || '').trim()),
        onSubmit: () => addBtn?.click(),
        onError: error => console.warn('No se pudieron buscar jugadores guardados:', error instanceof Error ? error.message : error)
    });
    participantAutocomplete.bind();

    async function getTournamentAccessToken() {
        if (supabaseInitialization) await supabaseInitialization;
        if (!supabaseAuthClient || !tournamentCreatorUserId) return null;
        const { data, error } = await supabaseAuthClient.auth.getSession();
        if (error) throw error;
        const session = data.session || null;
        if (!session || session.user.id !== tournamentCreatorUserId) {
            throw new Error(`Inicia sesión con la cuenta creadora (${tournamentCreatorName || 'usuario identificado'}) para publicar este torneo.`);
        }
        return session.access_token;
    }

    async function captureTournamentCreatorAndLog() {
        if (tournamentCreationLogged || !tournamentId) return;
        if (supabaseInitialization) await supabaseInitialization;
        const { data } = supabaseAuthClient ? await supabaseAuthClient.auth.getSession() : { data: { session: null } };
        const session = data.session || null;
        tournamentCreatorUserId = session?.user?.id || null;
        tournamentCreatorName = session?.user?.user_metadata?.nickname || null;
        tournamentCreationLogged = true;
        if (supabaseConfig) {
            try {
                await supabaseRequest('/rest/v1/rpc/log_tournament_created', {
                    method: 'POST',
                    body: JSON.stringify({ p_tournament_id: tournamentId, p_tournament_name: tournamentName })
                }, session?.access_token || null);
            } catch (error) { console.warn('No se pudo registrar la creación del torneo:', error.message); }
        }
        lastLoggedTournamentStateSignature = getTournamentActivityState().signature;
        saveToLocalStorage();
    }

    function getTournamentActivityState() {
        const details = {
            participants: participants.length,
            phase: currentPhase === 2 ? 'eliminatorias' : 'grupos',
            round: currentPhase === 2 ? knockoutRound : groupRound,
            matches: versus.length,
            archivedMatches: matchHistory.length,
            tournamentFinished,
            tournamentVisible
        };
        const signature = JSON.stringify([
            tournamentId, tournamentName, participants, versus, matchHistory, accumulatedPoints,
            currentPhase, groupRound, knockoutRound, lowerBracketRound, eliminationMode,
            upperByePlayers, lowerByePlayers, upperWaitingPlayers, lowerWaitingPlayers, activeEliminationBracket,
            upperFinalists, lowerFinalists, tournamentFinished, preFinalMatch,
            preFinalPlayed, finalMatch, finalPlayed, podium, swissByes, tournamentVisible
        ]);
        return { details, signature };
    }

    function scheduleTournamentActivityLog() {
        if (!tournamentId || !tournamentCreationLogged) return;
        const state = getTournamentActivityState();
        if (state.signature === lastLoggedTournamentStateSignature) return;
        clearTimeout(tournamentActivityLogTimer);
        tournamentActivityLogTimer = setTimeout(async () => {
            const latest = getTournamentActivityState();
            if (latest.signature === lastLoggedTournamentStateSignature) return;
            try {
                if (!supabaseConfig && supabaseInitialization) await supabaseInitialization;
                let accessToken = null;
                if (supabaseAuthClient) {
                    const { data } = await supabaseAuthClient.auth.getSession();
                    accessToken = data.session?.access_token || null;
                }
                await supabaseRequest('/rest/v1/rpc/log_tournament_activity', {
                    method: 'POST',
                    body: JSON.stringify({
                        p_tournament_id: tournamentId,
                        p_tournament_name: tournamentName,
                        p_details: latest.details
                    })
                }, accessToken);
                lastLoggedTournamentStateSignature = latest.signature;
            } catch (error) { console.warn('No se pudo registrar el cambio del torneo:', error.message); }
        }, 650);
    }

    async function loadSavedScoreTables() {
        if (!supabaseConfig || !savedScoreTableSelect) return;
        savedScoreTableSelect.disabled = true;
        savedScoreTableSelect.innerHTML = '<option value="">Cargando tablas…</option>';
        try {
            const rows = await fetchAllSupabaseRows(supabaseRequest, `${SUPABASE_TABLES_ENDPOINT}?select=id,name,finished_at&order=finished_at.desc`);
            savedScoreTables = Array.isArray(rows) ? rows : [];
            const selectedId = activeSavedScoreTable?.id || savedScoreTableSelect.value || '';
            savedScoreTableSelect.innerHTML = '<option value="">Tabla del torneo actual</option>' + savedScoreTables.map(row => {
                const date = row.finished_at ? new Date(row.finished_at).toLocaleDateString() : '';
                return `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}${date ? ` · ${escapeHtml(date)}` : ''}</option>`;
            }).join('');
            savedScoreTableSelect.disabled = false;
            if (selectedId && savedScoreTables.some(row => row.id === selectedId)) {
                savedScoreTableSelect.value = selectedId;
                activeSavedScoreTable = savedScoreTables.find(row => row.id === selectedId);
            } else {
                activeSavedScoreTable = null;
            }
            renderTotalScoreTable();
        } catch (error) {
            console.error('No se pudieron cargar las tablas guardadas:', error);
            savedScoreTableSelect.innerHTML = '<option value="">No se pudieron cargar las tablas</option>';
            savedScoreTableSelect.disabled = false;
        }
    }

    async function loadSavedScoreTableById(id) {
        if (!id) {
            activeSavedScoreTable = null;
            totalScoreTableEl?.setAttribute('aria-busy', 'false');
            renderTotalScoreTable();
            return;
        }
        totalScoreTableEl.setAttribute('aria-busy', 'true');
        totalScoreTableEl.innerHTML = `<div class="score-table-skeleton" role="status" aria-label="Cargando tabla">
            <span class="loading-skeleton skeleton-line medium"></span>
            <div class="score-table-skeleton-head">${Array.from({ length: 6 }, () => '<span class="loading-skeleton skeleton-line short"></span>').join('')}</div>
            ${Array.from({ length: 6 }, () => `<div class="score-table-skeleton-row">${Array.from({ length: 6 }, () => '<span class="loading-skeleton skeleton-line medium"></span>').join('')}</div>`).join('')}
        </div>`;
        try {
            const rows = await supabaseRequest(`${SUPABASE_TABLES_ENDPOINT}?id=eq.${encodeURIComponent(id)}&select=*`);
            if (savedScoreTableSelect?.value !== id) return;
            activeSavedScoreTable = rows[0] || null;
            totalScoreTableEl.setAttribute('aria-busy', 'false');
            renderTotalScoreTable();
        } catch (error) {
            console.error('No se pudo cargar la tabla seleccionada:', error);
            if (savedScoreTableSelect?.value !== id) return;
            totalScoreTableEl.setAttribute('aria-busy', 'false');
            totalScoreTableEl.innerHTML = '<div class="empty-message">No se pudo cargar esta tabla. Intenta actualizar.</div>';
        }
    }

    async function saveFinishedTournamentToSupabase() {
        if (!tournamentFinished || !tournamentId || participants.length === 0) return;
        const normalizeMatch = match => ({
            ...match,
            playerA: capitalizePlayerName(match.playerA),
            playerB: capitalizePlayerName(match.playerB)
        });
        const payload = {
            id: tournamentId,
            name: tournamentName,
            finished_at: new Date().toISOString(),
            participants: participants.map(player => ({ ...player, name: capitalizePlayerName(player.name) })),
            standings: getGroupRanking().map(player => ({ ...player, name: capitalizePlayerName(player.name) })),
            matches: [...matchHistory, ...versus].map(normalizeMatch),
            tournament_format: tournamentFormat,
            swiss_byes: swissByes,
            winner: capitalizePlayerName(tournamentWinner) || null,
            podium: Object.fromEntries(Object.entries(podium || {}).map(([place, player]) => [place, capitalizePlayerName(player) || null]))
        };
        try {
            if (tournamentCreatorUserId) {
                const accessToken = await getTournamentAccessToken();
                await supabaseRequest('/rest/v1/rpc/publish_finished_tournament', {
                    method: 'POST',
                    body: JSON.stringify({ p_tournament: payload, p_creator_user_id: tournamentCreatorUserId })
                }, accessToken);
            } else if (!finishedTournamentSubmissionId) {
                finishedTournamentSubmissionId = await supabaseRequest('/rest/v1/rpc/submit_tournament_for_approval', {
                    method: 'POST',
                    body: JSON.stringify({ p_tournament: payload })
                });
                saveToLocalStorage();
            }
            if (storageStatusEl) {
                storageStatusEl.textContent = tournamentCreatorUserId ? '☁️ Tabla publicada' : '⏳ En revisión';
                storageStatusEl.title = tournamentCreatorUserId
                    ? `La tabla fue publicada por ${tournamentCreatorName || 'un usuario registrado'}.`
                    : 'La tabla se enviará a la base de datos después de la aprobación del administrador.';
            }
            if (tournamentCreatorUserId) {
                await loadSavedScoreTables();
                if (savedScoreTableSelect) savedScoreTableSelect.value = tournamentId;
                await loadSavedScoreTableById(tournamentId);
            }
        } catch (error) {
            console.error('No se pudo guardar la tabla final en Supabase:', error);
            if (storageStatusEl) {
                storageStatusEl.textContent = '⚠️ Tabla sin respaldo';
                storageStatusEl.title = error.message;
            }
        }
    }

    async function savePlayersToSupabase(players) {
        try {
            if (!supabaseConfig && supabaseInitialization) await supabaseInitialization;
            if (!supabaseConfig) return;
            const rows = (Array.isArray(players) ? players : [players])
                .filter(player => player?.id && player?.name)
                .map(player => ({ id: player.id, name: capitalizePlayerName(player.name) }));
            if (!rows.length) return;
            await supabaseRequest('/rest/v1/players?on_conflict=id', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify(rows)
            });
            savedPlayerService.invalidate();
        } catch (error) {
            console.warn('No se pudo guardar el participante en Supabase:', error.message);
        }
    }

    function generateTournamentShareId() {
        if (!window.crypto?.getRandomValues) throw new Error('Este navegador no permite generar un enlace seguro. Abre la app con HTTPS.');
        const bytes = new Uint8Array(24);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function generateTournamentShareWriteToken() {
        if (!window.crypto?.getRandomValues) throw new Error('Este navegador no permite generar un enlace seguro. Abre la app con HTTPS.');
        const bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function buildSharedTournamentSnapshot() {
        const rawMatches = [...new Map([
            ...matchHistory,
            ...versus,
            ...(preFinalMatch ? [{ ...preFinalMatch, stage: 'pre-final' }] : []),
            ...(finalMatch ? [{ ...finalMatch, stage: 'final' }] : [])
        ].map(match => [String(match.id), match])).values()];
        const activeUpperLabel = versus.some(match => match.bracket === 'upper') ? `Upper A · R${knockoutRound}` : '';
        const activeLowerLabel = versus.some(match => match.bracket === 'lower') ? `Lower B · R${lowerBracketRound}` : '';
        const activeBracketLabel = [activeUpperLabel, activeLowerLabel].filter(Boolean).join(' + ') || 'Cuadros A/B';
        const matches = rawMatches.map(match => {
            const round = Number(match.round) || 0;
            if (round > 0) {
                return {
                    ...match,
                    view_key: `group-${round}`,
                    view_label: `Ronda ${round}`,
                    view_order: round
                };
            }

            const stage = match.stage || '';
            if (stage === 'pre-final' || stage === 'final') {
                return {
                    ...match,
                    view_key: eliminationMode === 'upper-lower' ? 'special-cross-finals' : `special-${stage}`,
                    view_label: eliminationMode === 'upper-lower'
                        ? 'Finales A y B'
                        : (stage === 'pre-final' ? 'Pre-final · 3.º y 4.º lugar' : 'Final'),
                    view_order: eliminationMode === 'upper-lower' ? 200 : (stage === 'pre-final' ? 200 : 201)
                };
            }

            const bracketRound = Number(match.bracketRound) ||
                (versus.includes(match) && currentPhase === 2 ? knockoutRound : 1);
            if (match.bracket === 'upper' || match.bracket === 'lower') {
                if (versus.includes(match)) {
                    return {
                        ...match,
                        view_key: 'knockout-current',
                        view_label: activeBracketLabel,
                        view_order: 100 + Math.max(knockoutRound, lowerBracketRound) * 2
                    };
                }
                const bracketName = match.bracket === 'upper' ? 'Upper · A' : 'Lower · B';
                return {
                    ...match,
                    view_key: `knockout-${match.bracket}-${bracketRound}`,
                    view_label: `${bracketName} · Ronda ${bracketRound}`,
                    view_order: 100 + bracketRound * 2 + (match.bracket === 'lower' ? 1 : 0)
                };
            }
            return {
                ...match,
                view_key: `knockout-${bracketRound}`,
                view_label: `Eliminatorias · Ronda ${bracketRound}`,
                view_order: 100 + bracketRound
            };
        });

        let currentRoundKey = currentPhase === 2
            ? (eliminationMode === 'upper-lower' && versus.some(match => match.bracket)
                ? 'knockout-current'
                : versus[0]?.bracket
                ? `knockout-${versus[0].bracket}-${versus[0].bracketRound || knockoutRound}`
                : `knockout-${Math.max(1, knockoutRound)}`)
            : `group-${groupRound}`;
        if (eliminationMode === 'upper-lower' && (preFinalMatch || finalMatch || tournamentFinished)) currentRoundKey = 'special-cross-finals';
        else if (preFinalMatch && !preFinalPlayed) currentRoundKey = 'special-pre-final';
        else if (finalMatch && !finalPlayed) currentRoundKey = 'special-final';
        else if (tournamentFinished && podium?.first) currentRoundKey = 'special-final';

        return {
            id: tournamentShareId,
            tournament_id: tournamentId,
            tournament_name: tournamentName,
            tournament_format: tournamentFormat,
            elimination_mode: eliminationMode,
            current_phase: currentPhase,
            phase_label: currentPhase === 2 ? 'Eliminatorias' : 'Fase de grupos',
            current_round: currentPhase === 2 ? knockoutRound : groupRound,
            current_round_key: currentRoundKey,
            tournament_finished: tournamentFinished,
            winner: capitalizePlayerName(tournamentWinner) || null,
            podium: Object.fromEntries(Object.entries(podium || {}).map(([place, player]) => [place, capitalizePlayerName(player) || null])),
            participants: participants.map(player => ({ ...player, name: capitalizePlayerName(player.name) })),
            matches,
            standings: getGroupRanking().map(player => ({ ...player, name: capitalizePlayerName(player.name) })),
            swiss_byes: swissByes
        };
    }

    async function syncSharedTournamentSnapshot() {
        if (!tournamentSharingEnabled || !tournamentShareId || !tournamentShareWriteToken) return false;
        try {
            if (!supabaseConfig && supabaseInitialization) await supabaseInitialization;
            if (!supabaseConfig) return false;

            const snapshot = buildSharedTournamentSnapshot();
            const signature = JSON.stringify(snapshot);
            if (signature === lastSharedTournamentSnapshot) return true;
            const accessToken = tournamentCreatorUserId ? await getTournamentAccessToken() : null;
            await supabaseRequest('/rest/v1/rpc/publish_shared_tournament', {
                method: 'POST',
                body: JSON.stringify({
                    p_share_id: tournamentShareId,
                    p_write_token: tournamentShareWriteToken,
                    p_snapshot: snapshot
                })
            }, accessToken);
            lastSharedTournamentSnapshot = signature;
            return true;
        } catch (error) {
            console.warn('No se pudo actualizar el torneo compartido:', error.message);
            return false;
        }
    }

    function scheduleSharedTournamentSync() {
        if (!tournamentSharingEnabled || !tournamentShareId || !tournamentShareWriteToken) return;
        clearTimeout(sharedTournamentSyncTimer);
        sharedTournamentSyncTimer = setTimeout(syncSharedTournamentSnapshot, 450);
    }

    async function getOrCreateSharedTournamentUrl() {
        if (participants.length < 2) {
            throw new Error('Agrega al menos 2 participantes antes de compartir el torneo.');
        }
        if (!supabaseConfig && supabaseInitialization) await supabaseInitialization;
        if (!supabaseConfig) {
            throw new Error('Supabase aún no está conectado. No se pudo crear el enlace compartido.');
        }
        if (!tournamentId) tournamentId = generateTournamentId();
        if (!tournamentCreationLogged) await captureTournamentCreatorAndLog();
        if (!tournamentShareId) tournamentShareId = generateTournamentShareId();
        if (!tournamentShareWriteToken) tournamentShareWriteToken = generateTournamentShareWriteToken();
        tournamentSharingEnabled = true;
        lastSharedTournamentSnapshot = null;
        clearTimeout(sharedTournamentSyncTimer);
        saveToLocalStorage();

        if (!await syncSharedTournamentSnapshot()) {
            throw new Error('No se pudo guardar el torneo compartido. Comprueba la conexión e intenta nuevamente.');
        }

        const shareUrl = new URL(SHARED_TOURNAMENT_VIEWER_PATH, window.location.origin);
        shareUrl.searchParams.set('id', tournamentShareId);
        return shareUrl.href;
    }

    async function shareTournament() {
        shareTournamentBtn.disabled = true;
        try {
            const shareUrl = await getOrCreateSharedTournamentUrl();
            try {
                await navigator.clipboard.writeText(shareUrl);
                alert(`🔗 Enlace copiado. Cualquier persona con el enlace podrá ver el torneo en vivo.\n\n${shareUrl}`);
            } catch {
                window.prompt('Copia este enlace para compartir el torneo:', shareUrl);
            }
        } catch (error) {
            alert(error.message || 'No se pudo preparar el enlace compartido.');
        } finally {
            shareTournamentBtn.disabled = false;
        }
    }

    async function shareTournamentViaWhatsApp() {
        shareTournamentWhatsAppBtn.disabled = true;
        try {
            const shareUrl = await getOrCreateSharedTournamentUrl();
            const message = `te invitamos a seguir el torneo ${tournamentName} en ${shareUrl} - LaMafia.site`;

            try {
                await navigator.clipboard.writeText(message);
            } catch {
                // WhatsApp recibe el mensaje precargado aunque el portapapeles no esté disponible.
            }

            window.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
        } catch (error) {
            alert(error.message || 'No se pudo preparar el mensaje de WhatsApp.');
            shareTournamentWhatsAppBtn.disabled = false;
        }
    }

    // ============================================================
    // 4. FUNCIONES DE LOCALSTORAGE
    // ============================================================

    function saveToLocalStorage() {
        try {
            // Guardar torneo actual
            const data = {
                tournamentId,
                tournamentCreatorUserId,
                tournamentCreatorName,
                tournamentCreationLogged,
                finishedTournamentSubmissionId,
                tournamentShareId,
                tournamentShareWriteToken,
                tournamentSharingEnabled,
                tournamentName,
                participants,
                versus,
                matchHistory,
                nextVersusId,
                currentPhase,
                tournamentWinner,
                knockoutRound,
                lowerBracketRound,
                eliminationMode,
                upperByePlayers,
                lowerByePlayers,
                upperWaitingPlayers,
                lowerWaitingPlayers,
                activeEliminationBracket,
                upperFinalists,
                lowerFinalists,
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
                tournamentVisible,
                tournamentFormat,
                swissByes
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

            // Guardar en la lista de torneos
            saveTournamentToList();
            scheduleSharedTournamentSync();
            scheduleTournamentActivityLog();

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

    function migrateLegacyUserbaseStorage() {
        // Conserva en este dispositivo el torneo del antiguo usuario administrador.
        if (!localStorage.getItem(STORAGE_KEY)) {
            const legacyTournament = localStorage.getItem(`${STORAGE_KEY}_twenty6`);
            if (legacyTournament) localStorage.setItem(STORAGE_KEY, legacyTournament);
        }
        if (!localStorage.getItem(TORNEO_LIST_KEY)) {
            const legacyList = localStorage.getItem(`${TORNEO_LIST_KEY}_twenty6`);
            if (legacyList) localStorage.setItem(TORNEO_LIST_KEY, legacyList);
        }
    }

    function loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;

            const data = JSON.parse(stored);
            tournamentId = data.tournamentId || null;
            tournamentCreatorUserId = data.tournamentCreatorUserId || null;
            tournamentCreatorName = data.tournamentCreatorName || null;
            tournamentCreationLogged = Object.prototype.hasOwnProperty.call(data, 'tournamentCreationLogged')
                ? Boolean(data.tournamentCreationLogged)
                : Boolean(data.tournamentId);
            finishedTournamentSubmissionId = data.finishedTournamentSubmissionId || null;
            tournamentShareId = data.tournamentShareId || null;
            tournamentShareWriteToken = data.tournamentShareWriteToken || null;
            tournamentSharingEnabled = Boolean(data.tournamentSharingEnabled && tournamentShareId);
            lastSharedTournamentSnapshot = null;
            tournamentName = data.tournamentName || 'LaMafia BEYBLADEX';
            participants = data.participants || [];
            versus = data.versus || [];
            matchHistory = data.matchHistory || [];
            nextVersusId = data.nextVersusId || 1;
            currentPhase = data.currentPhase || 1;
            tournamentWinner = data.tournamentWinner || null;
            knockoutRound = data.knockoutRound || 0;
            lowerBracketRound = data.lowerBracketRound || 0;
            eliminationMode = data.eliminationMode || 'single';
            upperByePlayers = data.upperByePlayers || [];
            lowerByePlayers = data.lowerByePlayers || [];
            upperWaitingPlayers = data.upperWaitingPlayers || [];
            lowerWaitingPlayers = data.lowerWaitingPlayers || [];
            activeEliminationBracket = data.activeEliminationBracket || 'upper';
            upperFinalists = data.upperFinalists || { winner: null, runnerUp: null };
            lowerFinalists = data.lowerFinalists || { winner: null, runnerUp: null };
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
            tournamentFormat = data.tournamentFormat || 'random';
            swissByes = data.swissByes || [];

            ensureParticipantsObjects();
            participants.forEach(p => {
                if (!(p.id in accumulatedPoints)) accumulatedPoints[p.id] = accumulatedPoints[p.name] || 0;
            });

            recalculateAccumulatedPoints();
            lastLoggedTournamentStateSignature = getTournamentActivityState().signature;
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
            tournamentShareId = data.tournamentShareId || null;
            tournamentShareWriteToken = data.tournamentShareWriteToken || null;
            tournamentSharingEnabled = Boolean(data.tournamentSharingEnabled && tournamentShareId);
            lastSharedTournamentSnapshot = null;
            tournamentName = data.tournamentName || 'LaMafia BEYBLADEX';
            participants = data.participants || [];
            versus = data.versus || [];
            matchHistory = data.matchHistory || [];
            nextVersusId = data.nextVersusId || 1;
            currentPhase = data.currentPhase || 1;
            tournamentWinner = data.tournamentWinner || null;
            knockoutRound = data.knockoutRound || 0;
            lowerBracketRound = data.lowerBracketRound || 0;
            eliminationMode = data.eliminationMode || 'single';
            upperByePlayers = data.upperByePlayers || [];
            lowerByePlayers = data.lowerByePlayers || [];
            upperWaitingPlayers = data.upperWaitingPlayers || [];
            lowerWaitingPlayers = data.lowerWaitingPlayers || [];
            activeEliminationBracket = data.activeEliminationBracket || 'upper';
            upperFinalists = data.upperFinalists || { winner: null, runnerUp: null };
            lowerFinalists = data.lowerFinalists || { winner: null, runnerUp: null };
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
            tournamentFormat = data.tournamentFormat || 'random';
            swissByes = data.swissByes || [];

            ensureParticipantsObjects();
            participants.forEach(p => {
                if (!(p.id in accumulatedPoints)) accumulatedPoints[p.id] = accumulatedPoints[p.name] || 0;
            });

            recalculateAccumulatedPoints();
            lastLoggedTournamentStateSignature = getTournamentActivityState().signature;
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

    function addParticipant(name, { persist = true } = {}) {
        const trimmed = capitalizePlayerName(name);
        if (!trimmed) return null;
        if (participantExistsByName(trimmed)) return null;
        const id = generateParticipantId();
        const obj = { id, name: trimmed };
        participants.push(obj);
        accumulatedPoints[id] = accumulatedPoints[id] || 0;
        if (persist) savePlayersToSupabase([obj]);
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
        newName = capitalizePlayerName(newName);
        p.name = newName;
        savePlayersToSupabase([p]);

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
        accumulatedPoints = calculateAccumulatedPoints({
            participants,
            matchHistory,
            currentMatches: versus,
            format: tournamentFormat,
            swissByes,
            totalRounds: getTotalRounds(),
            getParticipantIdByName
        });
    }

    function getGroupRanking() {
        return calculateGroupRanking({
            participants: participants.map(player => ({
                id: player?.id,
                name: String(player?.name || player || '')
            })),
            matches: [...matchHistory, ...versus],
            accumulatedPoints,
            format: tournamentFormat,
            swissByes,
            getParticipantIdByName
        });
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

    function getPreviousGroupPairKeys(matches = [...matchHistory, ...versus]) {
        return collectPreviousGroupPairKeys(matches);
    }

    function generatePairings(players, excludedKeys = new Set()) {
        return createPairings(players, excludedKeys, getParticipantIdByName);
    }

    function generateSwissPairings() {
        const ranking = getGroupRanking();
        const previous = getPreviousGroupPairKeys();
        return createSwissPairings(ranking, previous, new Set(swissByes));
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
            if (eliminationMode === 'upper-lower' && (preFinalMatch || finalMatch)) return '🏆 Final A · Final B';
            if (eliminationMode === 'upper-lower') {
                const activeRound = activeEliminationBracket === 'upper' ? knockoutRound : lowerBracketRound;
                return `Eliminatoria ${activeEliminationBracket === 'upper' ? 'A · Upper' : 'B · Lower'} · R${activeRound}`;
            }
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
                    ...(currentPhase === 2 ? { bracketRound: v.bracketRound || knockoutRound } : {}),
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
                if (section) section.style.display = activeTab === 'participants' ? 'none' : 'block';
            } else {
                tournamentVisible = false;
                const section = document.getElementById('tournamentSection');
                if (section) section.style.display = activeTab === 'table' ? 'block' : 'none';
            }
            updateTabAvailability();

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
            html += `<span class="participant-tag"><a class="participant-profile-link" href="${escapeHtml(getPlayerProfilePath(p.name))}" title="Ver perfil de ${escapeHtml(p.name)}">${escapeHtml(p.name)}</a> (${pts} pts) <button class="edit-name-btn" data-id="${escapeHtml(p.id)}" title="Editar nombre">✎</button> <button class="remove-btn" data-id="${escapeHtml(p.id)}" title="Eliminar">✕</button></span>`;
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
                <div class="podium-title">🏆 ${escapeHtml(tournamentName)} 🏆</div>
                <div class="podium-grid">
                    <div class="podium-place place-2">
                        <div class="medal">🥈</div>
                        <div class="place-name">${playerProfileLinkMarkup(podium.second)}</div>
                        <div class="place-points">Subcampeón</div>
                        <div class="podium-base silver"></div>
                    </div>
                    <div class="podium-place place-1">
                        <div class="medal">🥇</div>
                        <div class="place-name">${playerProfileLinkMarkup(podium.first)}</div>
                        <div class="place-points">🏆 Campeón</div>
                        <div class="podium-base gold"></div>
                    </div>
                    <div class="podium-place place-3">
                        <div class="medal">🥉</div>
                        <div class="place-name">${playerProfileLinkMarkup(podium.third)}</div>
                        <div class="place-points">3er Lugar</div>
                        <div class="podium-base bronze"></div>
                    </div>
                    <div class="podium-place place-4">
                        <div class="medal">4️⃣</div>
                        <div class="place-name">${playerProfileLinkMarkup(podium.fourth)}</div>
                        <div class="place-points">4to Lugar</div>
                        <div class="podium-base fourth"></div>
                    </div>
                </div>
                <div class="podium-footer">
                    <span class="tourney-name">🏆 ${escapeHtml(tournamentName)}</span>
                    ${podium.third ? `<span style="color:#00FF88;"> · 🥉 3er Lugar: ${playerProfileLinkMarkup(podium.third)}</span>` : ''}
                    ${podium.fourth ? `<span style="color:#4A4A6A;"> · 4️⃣ 4to Lugar: ${playerProfileLinkMarkup(podium.fourth)}</span>` : ''}
                </div>
            </div>
        `;
    }

    function normalizePlayerProfileKey(playerName) {
        return String(playerName || '').trim().normalize('NFKC').toLocaleLowerCase();
    }

    function safeProfileImageUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.protocol === 'https:' ? url.href : null;
        } catch {
            return null;
        }
    }

    function renderChampionProfileCard(playerName) {
        const name = String(playerName || '').trim();
        const initial = Array.from(name)[0]?.toLocaleUpperCase() || '?';
        return `<a class="champion-profile-card" data-champion-name="${escapeHtml(name)}" href="${escapeHtml(getPlayerProfilePath(name))}" aria-label="Ver perfil de ${escapeHtml(name)}, campeón del torneo">
            <div class="champion-profile-banner" aria-hidden="true"></div>
            <div class="champion-profile-identity">
                <span class="champion-profile-avatar"><span class="champion-profile-initial">${escapeHtml(initial)}</span><img class="champion-profile-photo" loading="lazy" decoding="async" alt="Foto de perfil de ${escapeHtml(name)}"></span>
                <span class="champion-profile-copy"><span class="champion-profile-eyebrow">🏆 Campeón del torneo</span><strong>${escapeHtml(name)}</strong><span class="champion-profile-tournament">${escapeHtml(tournamentName)}</span></span>
                <span class="champion-profile-medal" aria-hidden="true">🥇</span>
            </div>
        </a>`;
    }

    async function loadChampionProfileAssets(playerName, requestId) {
        try {
            if (supabaseInitialization) await supabaseInitialization;
            if (!supabaseConfig || requestId !== championProfileRequestId) return;

            const requestedKey = normalizePlayerProfileKey(playerName);
            if (!championProfileCache.has(requestedKey)) {
                championProfileCache.set(requestedKey, (async () => {
                    const aliasParams = new URLSearchParams({ select: 'canonical_key', alias_key: `eq.${requestedKey}`, limit: '1' });
                    const aliases = await supabaseRequest(`/rest/v1/player_aliases?${aliasParams.toString()}`);
                    const playerKey = aliases?.[0]?.canonical_key || requestedKey;
                    const profileParams = new URLSearchParams({ select: 'player_name,avatar_url,banner_url', player_key: `eq.${playerKey}`, limit: '1' });
                    const profiles = await supabaseRequest(`/rest/v1/player_profiles?${profileParams.toString()}`);
                    return Array.isArray(profiles) ? profiles[0] || null : null;
                })());
            }
            const profile = await championProfileCache.get(requestedKey);
            if (requestId !== championProfileRequestId) return;

            const card = [...versusListEl.querySelectorAll('.champion-profile-card')]
                .find(item => normalizePlayerProfileKey(item.dataset.championName) === requestedKey);
            if (!card || !profile) return;

            const bannerUrl = safeProfileImageUrl(profile.banner_url);
            const avatarUrl = safeProfileImageUrl(profile.avatar_url);
            const banner = card.querySelector('.champion-profile-banner');
            const photo = card.querySelector('.champion-profile-photo');
            const fallback = card.querySelector('.champion-profile-initial');
            if (bannerUrl && banner) banner.style.backgroundImage = `linear-gradient(90deg, rgba(9, 18, 31, 0.34), rgba(9, 18, 31, 0.04)), url(${JSON.stringify(bannerUrl)})`;
            if (avatarUrl && photo) {
                photo.addEventListener('load', () => {
                    photo.classList.add('loaded');
                    fallback?.classList.add('hidden');
                }, { once: true });
                photo.addEventListener('error', () => photo.remove(), { once: true });
                photo.src = avatarUrl;
            }
        } catch (error) {
            console.warn('No se pudo cargar el perfil del campeón:', error.message);
        }
    }

    function renderSwissFinalStandings() {
        const ranking = getGroupRanking();
        const matches = [...matchHistory, ...versus].filter(match => match.round > 0);
        const rows = ranking.map((player, index) => {
            const played = matches.filter(match => (match.playerAId || getParticipantIdByName(match.playerA)) === player.id || (match.playerBId || getParticipantIdByName(match.playerB)) === player.id);
            const wins = played.filter(match => player.id === (match.playerAId || getParticipantIdByName(match.playerA)) ? match.scoreA > match.scoreB : match.scoreB > match.scoreA).length;
            const draws = played.filter(match => match.drawResult || (match.scoreA === match.scoreB && (match.scoreA !== 0 || match.scoreB !== 0))).length;
            const losses = played.filter(match => match.scoreA !== match.scoreB && (player.id === (match.playerAId || getParticipantIdByName(match.playerA)) ? match.scoreA < match.scoreB : match.scoreB < match.scoreA)).length;
            const byes = swissByes.filter(id => String(id) === String(player.id)).length;
            return `<tr><td>${index + 1}</td><td class="name-cell">${playerTournamentHistoryLinkMarkup(player.name, player.id)}</td><td>${wins + byes} - ${losses} - ${draws}</td><td class="points-cell">${player.points.toFixed(1)}</td><td>${player.buchholz.toFixed(1)}</td><td>${player.pointDifference > 0 ? '+' : ''}${player.pointDifference}</td></tr>`;
        }).join('');
        return `<div class="podium-container swiss-final-standings">
            <div class="podium-title">🏆 ${escapeHtml(tournamentName)} · Clasificación final</div>
            <div class="table-scroll"><table class="total-score-table"><thead><tr><th>Rango</th><th>Participante</th><th>Partido G-P-E</th><th>1. Puntuación</th><th>2. Buchholz</th><th>3. Dif. de ptos.</th></tr></thead><tbody>${rows}</tbody></table></div>
            <div class="podium-footer">Formato suizo · ${groupRound} rondas · ${participants.length} participantes · desempate Buchholz</div>
        </div>`;
    }

    function renderVersus() {
        const roundTitle = getRoundTitle();
        const titleEl = document.querySelector('.phase-indicator h2');
        if (titleEl) {
            titleEl.textContent = roundTitle;
        }

        if (selectedPlayerFilterId && !getParticipantById(selectedPlayerFilterId)) {
            selectedPlayerFilterId = null;
        }
        if (!selectedPlayerFilterId && playerFilterBar) playerFilterBar.hidden = true;

        if (tournamentFinished && tournamentWinner && !selectedPlayerFilterId) {
            const championName = tournamentFormat === 'swiss'
                ? getGroupRanking()[0]?.name || tournamentWinner
                : podium.first || tournamentWinner;
            const profileRequestId = ++championProfileRequestId;
            versusListEl.innerHTML = renderChampionProfileCard(championName)
                + (tournamentFormat === 'swiss' ? renderSwissFinalStandings() : renderPodium());
            loadChampionProfileAssets(championName, profileRequestId);
            winnerMessageEl.innerHTML = '';
            thirdPlaceMessageEl.innerHTML = '';

            phaseDisplayEl.textContent = `🏆 Torneo Finalizado`;
            phaseDisplayEl.style.background = 'rgba(0, 255, 136, 0.2)';
            phaseDisplayEl.style.color = '#00FF88';
            roundDisplayEl.textContent = tournamentFormat === 'swiss' ? `1.º lugar: ${tournamentWinner}` : `Campeón: ${tournamentWinner}`;

            updateStats();
            return;
        }

        let matchesToShow;
        if (selectedPlayerFilterId) {
            matchesToShow = [...matchHistory, ...versus];
            if (preFinalMatch && !matchesToShow.includes(preFinalMatch)) matchesToShow.push(preFinalMatch);
            if (finalMatch && !matchesToShow.includes(finalMatch)) matchesToShow.push(finalMatch);
            matchesToShow = matchesToShow.filter(match => {
                const aId = match.playerAId || getParticipantIdByName(match.playerA);
                const bId = match.playerBId || getParticipantIdByName(match.playerB);
                return String(aId) === String(selectedPlayerFilterId) || String(bId) === String(selectedPlayerFilterId);
            });
        } else {
            matchesToShow = [...versus];
            if (eliminationMode === 'upper-lower') {
                if (preFinalMatch) matchesToShow.push(preFinalMatch);
                if (finalMatch) matchesToShow.push(finalMatch);
            } else {
                if (preFinalMatch && !preFinalPlayed) matchesToShow.push(preFinalMatch);
                if (finalMatch && !finalPlayed) matchesToShow.push(finalMatch);
            }
            if (selectedRound !== 'all') matchesToShow = matchesToShow.filter(v => v.round === selectedRound);
        }

        const filteredPlayer = selectedPlayerFilterId ? getParticipantById(selectedPlayerFilterId) : null;
        if (playerFilterBar) {
            playerFilterBar.hidden = !filteredPlayer;
            if (filteredPlayer) {
                const wins = matchesToShow.filter(match =>
                    (String(match.playerAId || getParticipantIdByName(match.playerA)) === String(selectedPlayerFilterId) && match.scoreA > match.scoreB) ||
                    (String(match.playerBId || getParticipantIdByName(match.playerB)) === String(selectedPlayerFilterId) && match.scoreB > match.scoreA)
                ).length;
                playerFilterName.textContent = filteredPlayer.name;
                playerFilterStats.textContent = `${getAccumulatedScore(filteredPlayer.id)} pts · ${matchesToShow.length} partidos · ${wins} victorias`;
            }
        }

        if (matchesToShow.length > 0) {
            let html = '';
            const sortedMatches = matchesToShow;

            sortedMatches.forEach((v, index) => {
                const isPlayed = (v.scoreA !== 0 || v.scoreB !== 0 || v.drawResult);
                const statusClass = isPlayed ? 'played' : 'unplayed';
                const isPreFinal = v === preFinalMatch;
                const isFinal = v === finalMatch;
                const isArchived = matchHistory.includes(v);
                const lockedSwissHistory = tournamentFormat === 'swiss' && isArchived;
                const playerAId = v.playerAId || getParticipantIdByName(v.playerA);
                const playerBId = v.playerBId || getParticipantIdByName(v.playerB);

                let extraClass = '';
                let badgeText = 'VS';
                let badgeColor = '#FFB800';
                let controlButtons = '';

                if (isPreFinal) {
                    extraClass = 'prefinal-match';
                    badgeText = eliminationMode === 'upper-lower' ? '🏆 Final B · 3.º/4.º' : '🥉 3er/4to Lugar';
                    badgeColor = '#7C3AED';
                    controlButtons = preFinalPlayed ? '<div class="match-controls"><span class="archived-match-label">✅ Final B jugada</span></div>' : `
                        <div class="match-controls">
                            <button class="btn-sm play-btn" data-action="play-pre-final">✅ Marcar como jugado</button>
                            <button class="btn-sm auto-btn" data-action="auto-pre-final">⚡ Finalizar automático</button>
                        </div>
                    `;
                } else if (isFinal) {
                    extraClass = 'final-match';
                    badgeText = eliminationMode === 'upper-lower' ? '🏆 Final A · 1.º/2.º' : '🏆 FINAL';
                    badgeColor = '#FFD700';
                    const disabled = eliminationMode !== 'upper-lower' && !preFinalPlayed ? 'disabled' : '';
                    const disabledStyle = disabled ? 'opacity:0.5; cursor:not-allowed;' : '';
                    controlButtons = finalPlayed ? '<div class="match-controls"><span class="archived-match-label">✅ Final A jugada</span></div>' : `
                        <div class="match-controls">
                            <button class="btn-sm play-btn" data-action="play-final" ${disabled} style="${disabledStyle}">✅ Marcar como jugado</button>
                            <button class="btn-sm auto-btn" data-action="auto-final" ${disabled} style="${disabledStyle}">⚡ Finalizar automático</button>
                        </div>
                        ${disabled ? '<span style="font-size:0.6rem; color:#4A4A6A; margin-left:0.5rem;">⏳ Esperando PRE-FINAL...</span>' : ''}
                    `;
                }

                if (eliminationMode === 'upper-lower' && v.bracket && !isPreFinal && !isFinal) {
                    badgeText = v.bracket === 'upper' ? `A · Upper R${v.bracketRound || 1}` : `B · Lower R${v.bracketRound || 1}`;
                    badgeColor = v.bracket === 'upper' ? '#69b8ff' : '#c18aff';
                }

                if (tournamentFormat === 'swiss' && v.round > 0 && !isArchived && !isPlayed) {
                    controlButtons += `<div class="match-controls"><button class="btn-sm play-btn" data-action="mark-swiss-draw" data-vsid="${Number(v.id)}">🤝 Registrar empate</button></div>`;
                }

                html += `
                    <div class="versus-item ${extraClass} ${statusClass} ${isArchived ? 'archived-match' : ''}" data-vsindex="${index}">
                        ${isArchived ? `<div class="archived-match-label">📅 ${v.bracket === 'upper' ? 'Upper A' : v.bracket === 'lower' ? 'Lower B' : (v.round ? `Ronda ${Number(v.round)}` : 'Eliminatorias')}${v.bracketRound ? ` · R${Number(v.bracketRound)}` : ''}${lockedSwissHistory ? ' · historial bloqueado' : ' · editable'}</div>` : ''}
                        ${isPreFinal ? `<div class="prefinal-badge">${eliminationMode === 'upper-lower' ? '🏆 FINAL B · 3.º/4.º' : '🥉 PRE-FINAL'}</div>` : ''}
                        ${isFinal ? `<div class="final-badge">${eliminationMode === 'upper-lower' ? '🏆 FINAL A · 1.º/2.º' : '🏆 FINAL'}</div>` : ''}
                        <div class="match-content">
                            <div class="match-players">
                                <div class="player-score-block">
                                    <div class="score-control">
                                        ${lockedSwissHistory ? '' : `<button class="dec-score" ${isArchived ? 'data-archived="true"' : ''} data-player="${escapeHtml(v.playerA)}" data-vsid="${Number(v.id)}" data-dir="-1">−</button>`}
                                        <div class="score-display">${Number(v.scoreA) || 0}</div>
                                        ${lockedSwissHistory ? '' : `<button class="inc-score" ${isArchived ? 'data-archived="true"' : ''} data-player="${escapeHtml(v.playerA)}" data-vsid="${Number(v.id)}" data-dir="1">+</button>`}
                                    </div>
                                    <button class="player-name player-filter-trigger" data-player-filter-id="${escapeHtml(playerAId)}" type="button" title="Ver partidos de ${escapeHtml(v.playerA)}">${escapeHtml(v.playerA)}</button>
                                </div>

                                <span class="vs-badge" style="color:${badgeColor};">${badgeText}</span>

                                <div class="player-score-block">
                                    <div class="score-control">
                                        ${lockedSwissHistory ? '' : `<button class="dec-score" ${isArchived ? 'data-archived="true"' : ''} data-player="${escapeHtml(v.playerB)}" data-vsid="${Number(v.id)}" data-dir="-1">−</button>`}
                                        <div class="score-display">${Number(v.scoreB) || 0}</div>
                                        ${lockedSwissHistory ? '' : `<button class="inc-score" ${isArchived ? 'data-archived="true"' : ''} data-player="${escapeHtml(v.playerB)}" data-vsid="${Number(v.id)}" data-dir="1">+</button>`}
                                    </div>
                                    <button class="player-name player-filter-trigger" data-player-filter-id="${escapeHtml(playerBId)}" type="button" title="Ver partidos de ${escapeHtml(v.playerB)}">${escapeHtml(v.playerB)}</button>
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
                    if (preFinalPlayed || eliminationMode === 'upper-lower') markFinalPlayed();
                });
            });
            document.querySelectorAll('[data-action="auto-final"]').forEach(btn => {
                btn.addEventListener('click', function () {
                    if (preFinalPlayed || eliminationMode === 'upper-lower') autoFinishFinal();
                });
            });
            document.querySelectorAll('[data-action="mark-swiss-draw"]').forEach(btn => {
                btn.addEventListener('click', () => markSwissDraw(btn.dataset.vsid));
            });

        } else if (!selectedPlayerFilterId && matchHistory.length > 0 && selectedRound !== 'all') {
            const filteredMatches = matchHistory.filter(v => v.round === selectedRound);
            if (filteredMatches.length > 0) {
                let html = '';
                filteredMatches.forEach((v) => {
                    const roundLabel = v.round ? `R${v.round}` : 'KO';
                    html += `
                    <div class="versus-item archived-match" style="opacity:0.9;">
                        <div style="font-size:.7rem;color:#00D4FF;margin-bottom:.35rem;">📅 Ronda anterior${tournamentFormat === 'swiss' ? ' · historial bloqueado' : ' · editable'}</div>
                        <div class="match-content">
                            <div class="match-players">
                            <div class="player-score-block">
                                <div class="score-control">
                                    ${tournamentFormat === 'swiss' ? '' : `<button class="dec-score" data-archived="true" data-player="${escapeHtml(v.playerA)}" data-vsid="${Number(v.id)}" data-dir="-1">−</button>`}
                                    <div class="score-display">${Number(v.scoreA) || 0}</div>
                                    ${tournamentFormat === 'swiss' ? '' : `<button class="inc-score" data-archived="true" data-player="${escapeHtml(v.playerA)}" data-vsid="${Number(v.id)}" data-dir="1">+</button>`}
                                </div>
                                <button class="player-name player-filter-trigger" data-player-filter-id="${escapeHtml(v.playerAId || getParticipantIdByName(v.playerA))}" type="button" title="Ver partidos de ${escapeHtml(v.playerA)}">${escapeHtml(v.playerA)}</button>
                            </div>
                            <span class="vs-badge" style="color:#4A4A6A;">✅ VS <span class="round-tag">${roundLabel}</span></span>
                            <div class="player-score-block">
                                <div class="score-control">
                                    ${tournamentFormat === 'swiss' ? '' : `<button class="dec-score" data-archived="true" data-player="${escapeHtml(v.playerB)}" data-vsid="${Number(v.id)}" data-dir="-1">−</button>`}
                                    <div class="score-display">${Number(v.scoreB) || 0}</div>
                                    ${tournamentFormat === 'swiss' ? '' : `<button class="inc-score" data-archived="true" data-player="${escapeHtml(v.playerB)}" data-vsid="${Number(v.id)}" data-dir="1">+</button>`}
                                </div>
                                <button class="player-name player-filter-trigger" data-player-filter-id="${escapeHtml(v.playerBId || getParticipantIdByName(v.playerB))}" type="button" title="Ver partidos de ${escapeHtml(v.playerB)}">${escapeHtml(v.playerB)}</button>
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
            versusListEl.innerHTML = selectedPlayerFilterId
                ? `<div class="empty-message">Este jugador todavía no tiene enfrentamientos registrados.</div>`
                : `<div class="empty-message">Sin enfrentamientos activos. Genera una ronda de grupos o inicia eliminatorias.</div>`;
        }

        thirdPlaceMessageEl.innerHTML = '';

        if (currentPhase === 1) {
            phaseDisplayEl.textContent = tournamentFormat === 'swiss' ? 'Rondas Suizas' : 'Fase 1 · Grupos';
            phaseDisplayEl.style.background = 'rgba(234, 241, 250, 0.9)';
            phaseDisplayEl.style.color = '#000704';
            roundDisplayEl.textContent = `Ronda ${groupRound}`;
        } else if (currentPhase === 2 && !tournamentFinished) {
            if (eliminationMode === 'upper-lower' && (preFinalMatch || finalMatch)) {
                phaseDisplayEl.textContent = '🏆 Finales cruzadas';
                phaseDisplayEl.style.background = 'rgba(124, 58, 237, 0.15)';
                phaseDisplayEl.style.color = '#c18aff';
                roundDisplayEl.textContent = `Final A ${finalPlayed ? '✅' : '⏳'} · Final B ${preFinalPlayed ? '✅' : '⏳'}`;
            } else if (preFinalMatch && !preFinalPlayed) {
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
        html += `<div style="font-size:0.75rem; color:#4A4A6A; margin-bottom:0.3rem;">📊 ${tournamentFormat === 'swiss' && tournamentFinished ? 'Standing final suizo' : 'Puntos de Fase de Grupos'}</div>`;
        ranking.forEach((item, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
            const pts = item.points;
            const cls = pts > 0 ? 'positive' : pts < 0 ? 'negative' : '';
            const isQualified = idx < qualifiedCount && currentPhase === 1 && !tournamentFinished;
            const qualifiedBadge = isQualified ? '<span class="qualified-badge">✅ Clasificado</span>' : '';
            html += `<div class="stat-badge ${cls}"><strong>${medal} ${escapeHtml(item.name)}</strong>  ${Number(pts) || 0} pts ${qualifiedBadge}</div>`;
        });
        html += `</div>`;

        const totalPoints = ranking.reduce((acc, p) => acc + p.points, 0);
        html += `<div style="margin-top: 0.5rem; font-size:0.8rem; color:#4A4A6A;">Suma total de puntos: ${totalPoints}</div>`;
        html += `<div style="font-size:0.8rem; color:#4A4A6A;">Partidos totales: ${matchHistory.length + versus.length}</div>`;
        html += `<div style="font-size:0.8rem; color:#4A4A6A;">Clasificados: ${qualifiedCount} de ${participants.length}</div>`;
        scoreSummaryEl.innerHTML = html;
    }

    function renderTotalScoreTable() {
        if (activeSavedScoreTable) {
            renderSavedScoreTable(activeSavedScoreTable);
            return;
        }
        const scoreTitle = document.getElementById('scoreTournamentName');
        if (scoreTitle) scoreTitle.textContent = tournamentName;
        if (participants.length === 0) {
            totalScoreTableEl.innerHTML = `<div class="empty-message">Sin participantes.</div>`;
            return;
        }

        const ranking = getGroupRanking();
        const groupMatches = [...matchHistory, ...versus].filter(v => v.round && v.round > 0);

        let html = `
            <div style="font-size:0.75rem; color:#4A4A6A; margin-bottom:0.5rem;">📊 ${tournamentFormat === 'swiss' ? (tournamentFinished ? 'Standing final suizo' : 'Standing suizo · victoria +1.0 / empate +0.5') : 'Estadísticas de Fase de Grupos'}</div>
            <table class="total-score-table">
                <thead>
                    <tr>
                        <th>${tournamentFormat === 'swiss' ? 'Rango' : 'Pos.'}</th>
                        <th>Participante</th>
                        ${tournamentFormat === 'swiss'
                            ? '<th>Partido G-P-E</th><th>1. Puntuación</th><th>2. Buchholz</th><th>3. Dif. de ptos.</th>'
                            : '<th>Puntos</th><th>Dif. Pts</th><th>Partidos</th><th>Victorias</th><th>Derrotas</th><th>Rondas</th>'}
                    </tr>
                </thead>
                <tbody>
        `;

        ranking.forEach((item, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
            const cls = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';

            const playerMatches = groupMatches.filter(v => v.playerA === item.name || v.playerB === item.name);
            const completedPlayerMatches = playerMatches.filter(v => v.drawResult || v.jugado || v.scoreA !== 0 || v.scoreB !== 0);
            const wins = completedPlayerMatches.filter(v =>
                (v.playerA === item.name && v.scoreA > v.scoreB) ||
                (v.playerB === item.name && v.scoreB > v.scoreA)
            ).length;
            const losses = completedPlayerMatches.filter(v =>
                (v.playerA === item.name && v.scoreA < v.scoreB) ||
                (v.playerB === item.name && v.scoreB < v.scoreA)
            ).length;
            const draws = completedPlayerMatches.filter(v => v.drawResult || v.scoreA === v.scoreB).length;
            const byes = tournamentFormat === 'swiss' ? swissByes.filter(id => String(id) === String(item.id)).length : 0;

            const roundsPlayed = new Set();
            completedPlayerMatches.forEach(v => {
                if (v.round && v.round > 0) roundsPlayed.add(v.round);
            });

            const pts = item.points;
            const ptsClass = pts > 0 ? 'positive' : pts < 0 ? 'negative' : '';

            html += `
                <tr class="${cls}">
                    <td><span class="medal-icon">${medal}</span></td>
                    <td class="name-cell">${playerTournamentHistoryLinkMarkup(item.name, item.id)}</td>
                    ${tournamentFormat === 'swiss'
                        ? `<td class="matches-cell">${wins + byes} - ${losses} - ${draws}</td><td class="points-cell ${ptsClass}">${item.points.toFixed(1)}</td><td class="matches-cell">${item.buchholz.toFixed(1)}</td><td class="matches-cell" style="color:#0099FF;">${item.pointDifference > 0 ? '+' : ''}${item.pointDifference}</td>`
                        : `<td class="points-cell ${ptsClass}">${item.points}</td><td class="matches-cell" style="color:#0099FF;">${item.pointDifference > 0 ? '+' : ''}${item.pointDifference}</td><td class="matches-cell">${completedPlayerMatches.length}</td><td class="matches-cell" style="color:#00FF88;">${wins}</td><td class="matches-cell" style="color:#FF1744;">${losses}</td><td class="matches-cell">${roundsPlayed.size}</td>`}
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

    function renderSavedScoreTable(savedTable) {
        const scoreTitle = document.getElementById('scoreTournamentName');
        if (scoreTitle) scoreTitle.textContent = savedTable.name || 'Tabla final';
        const ranking = Array.isArray(savedTable.standings) ? savedTable.standings : [];
        const matches = Array.isArray(savedTable.matches) ? savedTable.matches : [];
        const groupMatches = matches.filter(match => Number(match.round) > 0);
        const format = savedTable.tournament_format || 'random';
        if (ranking.length === 0) {
            totalScoreTableEl.innerHTML = '<div class="empty-message">Esta tabla guardada no contiene una clasificación.</div>';
            return;
        }
        const header = format === 'swiss'
            ? '<th>Rango</th><th>Participante</th><th>Partido G-P-E</th><th>1. Puntuación</th><th>2. Buchholz</th><th>3. Dif. de ptos.</th>'
            : '<th>Pos.</th><th>Participante</th><th>Puntos</th><th>Dif. Pts</th><th>Partidos</th><th>Victorias</th><th>Derrotas</th><th>Rondas</th>';
        const rows = ranking.map((player, index) => {
            const playerId = String(player.id || '');
            const playerMatches = groupMatches.filter(match =>
                String(match.playerAId || '') === playerId || String(match.playerBId || '') === playerId ||
                match.playerA === player.name || match.playerB === player.name
            );
            const completed = playerMatches.filter(match => match.drawResult || match.jugado || match.scoreA !== 0 || match.scoreB !== 0);
            const wins = completed.filter(match =>
                (String(match.playerAId || '') === playerId || match.playerA === player.name) ? match.scoreA > match.scoreB : match.scoreB > match.scoreA
            ).length;
            const losses = completed.filter(match =>
                (String(match.playerAId || '') === playerId || match.playerA === player.name) ? match.scoreA < match.scoreB : match.scoreB < match.scoreA
            ).length;
            const draws = completed.filter(match => match.drawResult || match.scoreA === match.scoreB).length;
            const rounds = new Set(completed.map(match => match.round).filter(round => round > 0)).size;
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : String(index + 1);
            const rowClass = index < 3 ? `rank-${index + 1}` : '';
            const points = Number(player.points) || 0;
            const diff = Number(player.pointDifference) || 0;
            const scoreCells = format === 'swiss'
                ? `<td>${wins + (savedTable.swiss_byes || []).filter(id => String(id) === playerId).length} - ${losses} - ${draws}</td><td class="points-cell">${points.toFixed(1)}</td><td>${(Number(player.buchholz) || 0).toFixed(1)}</td><td>${diff > 0 ? '+' : ''}${diff}</td>`
                : `<td class="points-cell">${points}</td><td>${diff > 0 ? '+' : ''}${diff}</td><td>${completed.length}</td><td>${wins}</td><td>${losses}</td><td>${rounds}</td>`;
            return `<tr class="${rowClass}"><td>${medal}</td><td class="name-cell"><a class="score-player-profile" href="${escapeHtml(getPlayerProfilePath(player.name))}">${escapeHtml(player.name)}</a></td>${scoreCells}</tr>`;
        }).join('');
        totalScoreTableEl.innerHTML = `<div style="font-size:0.75rem;color:#4A4A6A;margin-bottom:0.5rem;">📊 Tabla final · ${savedTable.finished_at ? new Date(savedTable.finished_at).toLocaleString() : 'fecha no disponible'}</div><div class="table-scroll"><table class="total-score-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function showPlayerHistory(playerId, currentTournamentOnly = false) {
        const savedParticipants = currentTournamentOnly ? participants : activeSavedScoreTable?.participants || participants;
        const player = savedParticipants.find(item => String(item.id) === String(playerId)) || getParticipantById(playerId);
        if (!player) return;
        const playerKey = String(player.id || playerId);
        const historyMatches = currentTournamentOnly
            ? [...new Set([...matchHistory, ...versus, preFinalMatch, finalMatch].filter(Boolean))]
            : activeSavedScoreTable?.matches || [...matchHistory, ...versus];
        const findIdByName = name => savedParticipants.find(item => item.name === name)?.id || getParticipantIdByName(name);
        const matches = historyMatches
            .filter(match => {
                const aId = String(match.playerAId || findIdByName(match.playerA) || '');
                const bId = String(match.playerBId || findIdByName(match.playerB) || '');
                return aId === playerKey || bId === playerKey || match.playerA === player.name || match.playerB === player.name;
            })
            .sort((a, b) => (a.round || Number.MAX_SAFE_INTEGER) - (b.round || Number.MAX_SAFE_INTEGER));

        const historyRows = matches.map(match => {
            const isA = match.playerA === player.name || String(match.playerAId || findIdByName(match.playerA)) === playerKey;
            const opponent = isA ? match.playerB : match.playerA;
            const scoreFor = isA ? match.scoreA : match.scoreB;
            const scoreAgainst = isA ? match.scoreB : match.scoreA;
            const played = match.drawResult || match.jugado || scoreFor !== 0 || scoreAgainst !== 0;
            const result = !played ? 'Pendiente' : match.drawResult || scoreFor === scoreAgainst ? 'Empate' : scoreFor > scoreAgainst ? 'Victoria' : 'Derrota';
            const resultClass = result === 'Victoria' ? 'history-result-win' : result === 'Derrota' ? 'history-result-loss' : result === 'Empate' ? 'history-result-draw' : '';
            const roundLabel = match.label || (match.bracket && match.bracketRound
                ? `${match.bracket === 'upper' ? 'Upper A' : 'Lower B'} · R${match.bracketRound}`
                : match.round > 0 ? `Ronda ${match.round}` : 'Eliminatorias');
            return `<tr><td>${escapeHtml(roundLabel)}</td><td>${escapeHtml(opponent || '—')}</td><td>${played ? `${Number(scoreFor) || 0}–${Number(scoreAgainst) || 0}` : '—'}</td><td class="${resultClass}">${result}</td></tr>`;
        });

        if ((currentTournamentOnly ? tournamentFormat : activeSavedScoreTable?.tournament_format || tournamentFormat) === 'swiss') {
            let byeNumber = 0;
            (currentTournamentOnly ? swissByes : activeSavedScoreTable?.swiss_byes || swissByes).forEach((id, index) => {
                if (String(id) === playerKey) {
                    byeNumber++;
                    historyRows.push(`<tr><td>Ronda ${index + 1}</td><td>Bye (descanso)</td><td>—</td><td class="history-result-win">Victoria · 1 pt</td></tr>`);
                }
            });
        }

        const content = document.getElementById('playerHistoryContent');
        document.getElementById('playerHistoryTitle').textContent = currentTournamentOnly
            ? `📜 Historial del torneo · ${player.name}`
            : `📜 Historial · ${player.name}`;
        content.innerHTML = historyRows.length
            ? `<div class="player-history-content"><table class="total-score-table"><thead><tr><th>Ronda</th><th>Rival</th><th>Marcador</th><th>Resultado</th></tr></thead><tbody>${historyRows.join('')}</tbody></table></div>`
            : '<div class="empty-message">Este participante todavía no tiene enfrentamientos registrados.</div>';
        document.getElementById('playerHistoryModal').classList.add('active');
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
                ...(tournamentFormat === 'swiss' ? {
                    'Partido G-P-E': `${wins + swissByes.filter(id => String(id) === String(item.id)).length} - ${losses} - ${playerMatches.filter(v => v.drawResult || (v.scoreA === v.scoreB && (v.scoreA !== 0 || v.scoreB !== 0))).length}`,
                    '2. Buchholz': item.buchholz,
                    '3. Diferencia de puntos': item.pointDifference
                } : {
                    'Diferencia de puntos': item.pointDifference,
                    Partidos: playerMatches.length,
                    Victorias: wins,
                    Derrotas: losses,
                    Rondas: rounds.size
                }),
                ...(tournamentFormat === 'swiss' ? {
                    Empates: playerMatches.filter(v => v.drawResult || (v.scoreA === v.scoreB && (v.scoreA !== 0 || v.scoreB !== 0))).length,
                    Buchholz: item.buchholz
                } : {})
            };
        });
    }

    let xlsxLibraryPromise = null;

    function loadXlsxLibrary() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (!xlsxLibraryPromise) {
            xlsxLibraryPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
                script.async = true;
                const timeoutId = window.setTimeout(() => {
                    script.remove();
                    xlsxLibraryPromise = null;
                    reject(new Error('La descarga de XLSX excedió el tiempo de espera.'));
                }, 12_000);
                script.onload = () => {
                    window.clearTimeout(timeoutId);
                    if (window.XLSX) resolve(window.XLSX);
                    else {
                        xlsxLibraryPromise = null;
                        reject(new Error('No se pudo iniciar XLSX.'));
                    }
                };
                script.onerror = () => {
                    window.clearTimeout(timeoutId);
                    xlsxLibraryPromise = null;
                    reject(new Error('No se pudo cargar XLSX.'));
                };
                document.head.appendChild(script);
            });
        }
        return xlsxLibraryPromise;
    }

    async function exportScoreTableXlsx() {
        let XLSX;
        try {
            XLSX = await loadXlsxLibrary();
        } catch {
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
        const finishSwissBtn = document.getElementById('finishSwissTournamentBtn');
        const isSwiss = tournamentFormat === 'swiss';
        const plannedSwissRounds = participants.length >= 2 ? Math.ceil(Math.log2(participants.length)) : 0;
        const swissPending = versus.some(match => !match.drawResult && match.scoreA === 0 && match.scoreB === 0);
        const swissRoundsComplete = groupRound >= plannedSwissRounds;

        document.querySelector('.phase-switch-container').style.display = isSwiss ? 'none' : '';
        if (isSwiss) currentPhaseView = 'groups';
        if (finishSwissBtn) {
            finishSwissBtn.hidden = !isSwiss;
            finishSwissBtn.disabled = tournamentFinished || groupRound < plannedSwissRounds || swissPending;
            finishSwissBtn.title = swissPending ? 'Registra el resultado de todos los partidos de la ronda actual.' : `Finaliza al completar ${plannedSwissRounds} rondas.`;
        }
        const qualificationOption = document.querySelector('.tournament-qualified-option');
        if (qualificationOption) qualificationOption.style.display = isSwiss ? 'none' : '';
        const newRoundBtn = document.getElementById('nextGroupRoundBtn');
        if (isSwiss && (tournamentFinished || swissRoundsComplete)) {
            generateGroupBtn.disabled = true;
            if (newRoundBtn) newRoundBtn.disabled = true;
        } else if (isSwiss) {
            generateGroupBtn.disabled = false;
            if (newRoundBtn) newRoundBtn.disabled = false;
        }
        if (isSwiss) {
            knockoutPanel.style.display = 'none';
            groupPanel.style.display = '';
        } else {
            knockoutPanel.style.display = '';
            groupPanel.style.display = '';
        }

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
        const groupBadge = document.querySelector('#groupPhasePanel .phase-badge');
        if (groupBadge) groupBadge.textContent = isSwiss ? 'Rondas Suizas' : 'Fase de Grupos';

        if (currentPhase === 2 && !tournamentFinished) {
            if (eliminationMode === 'upper-lower') {
                const activeCount = new Set(versus.flatMap(match => [match.playerA, match.playerB])).size
                    + (activeEliminationBracket === 'upper' ? upperByePlayers.length : lowerByePlayers.length);
                const activeRound = activeEliminationBracket === 'upper' ? knockoutRound : lowerBracketRound;
                document.getElementById('knockoutRoundInfo').textContent = `Eliminatoria ${activeEliminationBracket === 'upper' ? 'A · Upper' : 'B · Lower'} · R${activeRound} (${activeCount} jugadores)`;
            } else {
                const activePlayers = new Set();
                versus.forEach(v => {
                    activePlayers.add(v.playerA);
                    activePlayers.add(v.playerB);
                });
                const count = activePlayers.size;
                const roundName = getKnockoutRoundName(count);
                document.getElementById('knockoutRoundInfo').textContent = roundName;
            }
        } else if (tournamentFinished) {
            document.getElementById('knockoutRoundInfo').textContent = '🏆 Torneo Finalizado';
        } else {
            document.getElementById('knockoutRoundInfo').textContent = '⚔️ Esperando inicio';
        }

        if (preFinalMatch || finalMatch) {
            knockoutSpecial.style.display = 'block';

            let statusText = '';
            if (eliminationMode === 'upper-lower') {
                statusText = `A: ${upperFinalists.winner?.name || '—'} · B: ${lowerFinalists.winner?.name || '—'}${preFinalPlayed ? ' · Final B ✅' : ''}${finalPlayed ? ' · Final A ✅' : ''}`;
            } else if (preFinalMatch && !preFinalPlayed) {
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

            if (eliminationMode === 'upper-lower') {
                playPreFinal.style.display = preFinalMatch && !preFinalPlayed ? 'block' : 'none';
                autoPreFinal.style.display = preFinalMatch && !preFinalPlayed ? 'block' : 'none';
                playFinal.style.display = finalMatch && !finalPlayed ? 'block' : 'none';
                autoFinal.style.display = finalMatch && !finalPlayed ? 'block' : 'none';
            } else if (preFinalMatch && !preFinalPlayed) {
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
            if (eliminationMode === 'upper-lower' && (preFinalMatch || finalMatch)) {
                nextBtn.style.display = 'none';
            }
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

        if (isSwiss) {
            startBtn.textContent = tournamentFinished ? '🏆 Torneo finalizado' : '🏁 Finalizar torneo';
            startBtn.disabled = true;
            startBtn.style.opacity = '0.5';
            startBtn.style.display = 'none';
            nextBtn.style.display = 'none';
        } else if (currentPhase === 1 && versus.length === 0 && matchHistory.length === 0) {
            startBtn.style.display = '';
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

        const mobileRoundInfo = document.getElementById('mobileRoundInfo');
        const mobileNextBtn = document.getElementById('mobileNextRoundBtn');
        const mobileKnockoutBtn = document.getElementById('mobileKnockoutBtn');
        if (mobileRoundInfo) {
            mobileRoundInfo.textContent = currentPhase === 2
                ? (eliminationMode === 'upper-lower' && !preFinalMatch && !finalMatch
                    ? `Eliminatoria ${activeEliminationBracket === 'upper' ? 'A' : 'B'} · R${activeEliminationBracket === 'upper' ? knockoutRound : lowerBracketRound}`
                    : getRoundTitle())
                : `Ronda ${groupRound}`;
        }
        if (mobileNextBtn) {
            mobileNextBtn.textContent = currentPhase === 2 ? '➡️ Siguiente eliminatoria' : '➡️ Siguiente ronda';
            mobileNextBtn.disabled = tournamentFinished || (eliminationMode === 'upper-lower' && Boolean(preFinalMatch || finalMatch));
        }
        if (mobileKnockoutBtn) {
            if (isSwiss) {
                mobileKnockoutBtn.textContent = tournamentFinished ? '🏆 Finalizado' : '🏁 Finalizar torneo';
                mobileKnockoutBtn.disabled = finishSwissBtn?.disabled ?? true;
            } else {
                mobileKnockoutBtn.disabled = currentPhase === 2 || tournamentFinished || (versus.length === 0 && matchHistory.length === 0);
                mobileKnockoutBtn.textContent = tournamentFinished ? '🏆 Finalizado' : (currentPhase === 2 ? '⏳ Eliminatorias' : '🏁 Eliminatorias');
            }
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
        vs.drawResult = false;

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

    function markSwissDraw(matchId) {
        const match = versus.find(v => String(v.id) === String(matchId));
        if (!match || tournamentFormat !== 'swiss') return;
        match.scoreA = 0;
        match.scoreB = 0;
        match.drawResult = true;
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function updateArchivedScore(matchId, player, dir) {
        if (tournamentFormat === 'swiss') {
            alert('Los resultados de rondas suizas anteriores están bloqueados para conservar la validez de los emparejamientos.');
            return;
        }
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

        if (tournamentFormat === 'swiss' && groupRound >= Math.ceil(Math.log2(participants.length))) {
            alert(`El torneo suizo ya completó sus ${groupRound} rondas previstas para ${participants.length} participantes.`);
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
            resetBracketFormat();
            preFinalMatch = null;
            preFinalPlayed = false;
            finalMatch = null;
            finalPlayed = false;
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
                if (tournamentFormat === 'swiss' && versus.some(match => match.scoreA === 0 && match.scoreB === 0)) {
                    alert('Completa todos los partidos de esta ronda antes de generar la siguiente. Un empate 0-0 debe registrarse con algún punto para distinguirlo de un partido pendiente.');
                    return;
                }
                if (!confirm('Hay enfrentamientos actuales. ¿Archivarlos y generar una nueva ronda?')) {
                    return;
                }
                archiveAndClearVersus();
            }
        }

        const swissResult = tournamentFormat === 'swiss' ? generateSwissPairings() : null;
        const pairings = swissResult ? swissResult.pairings : generatePairings(participants, getPreviousGroupPairKeys());

        if (pairings.length === 0) {
            alert('Todos los participantes ya se han enfrentado entre sí. No quedan cruces nuevos disponibles.');
            return;
        }

        groupRound++;
        if (swissResult?.bye) swissByes.push(String(swissResult.bye.id));

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
            alert(swissResult?.bye
                ? `⚠️ ${swissResult.bye.name} recibe bye (descanso con 3 puntos).`
                : `⚠️ ${restantes} participante(s) descansan esta ronda (número impar de jugadores).`);
        }

        selectedRound = groupRound;
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function buildUpperLowerRound(players, bracket, round) {
        const result = createBracketRound(players, bracket, round, nextVersusId);
        nextVersusId = result.nextId;
        if (bracket === 'upper') upperByePlayers = result.byes;
        else lowerByePlayers = result.byes;
        return result.matches.map(match => ({
            ...match,
            round: 0,
            bracketRound: round,
            bracket: match.bracket
        }));
    }

    function scheduleCrossBracketFinals(finals) {
        finalMatch = { ...finals.championship, bracket: 'upper', label: 'Final A · 1.º/2.º lugar' };
        preFinalMatch = { ...finals.placement, bracket: 'lower', label: 'Final B · 3.º/4.º lugar' };
        preFinalPlayed = false;
        finalPlayed = false;
        versus = [];
        currentPhaseView = 'knockout';
        selectedRound = 'all';
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function advanceUpperLowerBrackets() {
        const roundMatches = versus.filter(match => match.bracket === activeEliminationBracket);
        if (!roundMatches.length) {
            alert('No se encontraron los enfrentamientos de la fase activa.');
            return;
        }
        const result = resolveBracketRound(roundMatches);
        const wasFinal = roundMatches.some(match => match.bracketFinal);
        archiveAndClearVersus();

        const asActiveMatches = round => round.matches.map(match => ({
            ...match,
            round: 0,
            bracketRound: match.round
        }));
        const scheduleLowerPhase = (players, allowFinal) => {
            if (players.length < 2) return [];
            lowerBracketRound += 1;
            const round = createBracketRound(players, 'lower', lowerBracketRound, nextVersusId);
            nextVersusId = round.nextId;
            lowerByePlayers = round.byes;
            if (!allowFinal) round.matches.forEach(match => { delete match.bracketFinal; });
            return asActiveMatches(round);
        };
        const scheduleUpperPhase = () => {
            if (upperFinalists.winner) return [];
            if (upperWaitingPlayers.length < 2) return [];
            knockoutRound += 1;
            const round = createBracketRound(upperWaitingPlayers, 'upper', knockoutRound, nextVersusId);
            nextVersusId = round.nextId;
            upperByePlayers = round.byes;
            upperWaitingPlayers = [];
            return asActiveMatches(round);
        };

        if (activeEliminationBracket === 'upper') {
            if (wasFinal) {
                upperFinalists = {
                    winner: result.winners[0] || null,
                    runnerUp: result.losers[0] || null
                };
                // La segunda oportunidad termina cuando quedan fijados los finalistas A.
                activeEliminationBracket = 'lower';
                versus = scheduleLowerPhase(lowerWaitingPlayers, true);
            } else {
                upperWaitingPlayers = [...upperByePlayers, ...result.winners];
                lowerWaitingPlayers = [...lowerWaitingPlayers, ...result.losers];
                upperByePlayers = [];
                activeEliminationBracket = 'lower';
                if (lowerWaitingPlayers.length >= 2) {
                    versus = scheduleLowerPhase(lowerWaitingPlayers, false);
                    lowerWaitingPlayers = [];
                } else {
                    versus = [];
                }
                if (!versus.length) {
                    activeEliminationBracket = 'upper';
                    versus = scheduleUpperPhase();
                }
            }
        } else {
            lowerWaitingPlayers = [...lowerByePlayers, ...result.winners];
            lowerByePlayers = [];
            if (wasFinal) {
                lowerFinalists = {
                    winner: result.winners[0] || null,
                    runnerUp: result.losers[0] || null
                };
                scheduleCrossBracketFinals(getCrossBracketFinals(
                    upperFinalists.winner,
                    upperFinalists.runnerUp,
                    lowerFinalists.winner,
                    lowerFinalists.runnerUp,
                    nextVersusId
                ));
                nextVersusId += 2;
                return;
            }

            if (upperFinalists.winner) {
                activeEliminationBracket = 'lower';
                versus = scheduleLowerPhase(lowerWaitingPlayers, true);
                lowerWaitingPlayers = [];
            } else {
                activeEliminationBracket = 'upper';
                versus = scheduleUpperPhase();
            }
        }

        if (!versus.length) {
            alert('No se pudieron generar más enfrentamientos para los cuadros. Revisa la cantidad de clasificados.');
            return;
        }
        selectedRound = 'all';
        recalculateAccumulatedPoints();
        renderAll();
        saveToLocalStorage();
    }

    function startKnockout(mode = 'single') {
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
        const nonQualified = ranking.slice(qualifiedCount).map(p => ({ id: p.id, name: p.name }));

        if (qualified.length < 2) {
            alert('No hay suficientes participantes con puntos para eliminatorias.');
            return;
        }

        if (mode === 'upper-lower' && participants.length < 4) {
            alert('El formato upper/lower requiere al menos 4 participantes para crear ambos cuadros y jugar las finales cruzadas.');
            return;
        }
        if (mode === 'upper-lower' && nonQualified.length < 2) {
            alert('El formato upper/lower requiere al menos 2 jugadores no clasificados para competir por los puestos 3.º y 4.º.');
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
        resetBracketFormat();
        eliminationMode = mode === 'upper-lower' ? 'upper-lower' : 'single';
        knockoutRound = 1;
        preFinalMatch = null;
        preFinalPlayed = false;
        finalMatch = null;
        finalPlayed = false;
        semifinalLosers = [];
        semifinalWinners = [];
        podium = { first: null, second: null, third: null, fourth: null };

        if (eliminationMode === 'upper-lower') {
            activeEliminationBracket = 'upper';
            lowerWaitingPlayers = nonQualified;
            versus = buildUpperLowerRound(qualified, 'upper', knockoutRound);
        } else {
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
                        round: 0,
                        bracketRound: knockoutRound
                    });
                }
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

        alert(`✅ Eliminatorias ${eliminationMode === 'upper-lower' ? 'upper/lower' : 'clásicas'} iniciadas con ${versus.length} enfrentamientos.\n\n📊 ${qualified.length} clasificados · ${nonQualified.length} no clasificados.${eliminationMode === 'upper-lower' ? '\n\nPrimero se jugará la fase A; después se organizará la fase B con los jugadores que bajen del cuadro.' : ''}`);
    }

    function finishSwissTournament() {
        if (tournamentFormat !== 'swiss' || tournamentFinished) return;
        const plannedRounds = Math.ceil(Math.log2(participants.length));
        if (participants.length < 2 || groupRound < plannedRounds) {
            alert(`Completa las ${plannedRounds} rondas suizas previstas antes de finalizar.`);
            return;
        }
        const pending = versus.filter(match => !match.drawResult && match.scoreA === 0 && match.scoreB === 0);
        if (pending.length) {
            alert(`Quedan ${pending.length} partido(s) sin resultado. Registra el marcador o marca el empate para poder finalizar.`);
            return;
        }
        if (!confirm('¿Finalizar el torneo suizo y publicar la clasificación final?')) return;
        archiveAndClearVersus();
        recalculateAccumulatedPoints();
        const ranking = getGroupRanking();
        tournamentFinished = true;
        tournamentWinner = ranking[0]?.name || null;
        currentPhase = 1;
        currentPhaseView = 'groups';
        selectedRound = 'all';
        renderAll();
        saveToLocalStorage();
        saveFinishedTournamentToSupabase();
    }

    function nextKnockoutRound() {
        if (currentPhase !== 2) {
            alert('No estás en fase de eliminatorias.');
            return;
        }

        if (eliminationMode !== 'upper-lower' && preFinalMatch && !preFinalPlayed) {
            alert('⚠️ Primero debes jugar la PRE-FINAL (3er y 4to lugar).');
            return;
        }
        if (eliminationMode !== 'upper-lower' && finalMatch && !finalPlayed) {
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

        if (eliminationMode === 'upper-lower') {
            advanceUpperLowerBrackets();
            return;
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
                    id: nextVersusId++,
                    stage: 'pre-final'
                };
                preFinalPlayed = false;

                finalMatch = {
                    playerA: semifinalWinners[0],
                    playerB: semifinalWinners[1],
                    scoreA: 0,
                    scoreB: 0,
                    id: nextVersusId++,
                    stage: 'final'
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
                    round: 0,
                    bracketRound: knockoutRound + 1
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
            stage: 'pre-final',
            archivedAt: Date.now()
        };
        if (!matchHistory.some(match => String(match.id) === String(preFinalCopy.id))) matchHistory.push(preFinalCopy);
        if (eliminationMode !== 'upper-lower') preFinalMatch = null;

        renderAll();
        saveToLocalStorage();
        if (eliminationMode === 'upper-lower') {
            finishUpperLowerTournamentIfReady();
            alert(`✅ Final B finalizada.\n🥉 ${podium.third} · 3.º lugar\n4️⃣ ${podium.fourth} · 4.º lugar`);
            return;
        }
        alert(`✅ PRE-FINAL finalizada!\n🥉 ${podium.third} es el 3er Lugar.\n4️⃣ ${podium.fourth} es el 4to Lugar.\n\n🏆 ¡Ahora la FINAL!`);
    }

    function finishUpperLowerTournamentIfReady() {
        if (eliminationMode !== 'upper-lower' || !preFinalPlayed || !finalPlayed || tournamentFinished) return;
        tournamentWinner = podium.first;
        tournamentFinished = true;
        renderAll();
        saveToLocalStorage();
        saveFinishedTournamentToSupabase();
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
        tournamentFinished = eliminationMode !== 'upper-lower';

        const finalCopy = {
            ...finalMatch,
            id: finalMatch.id,
            round: 0,
            stage: 'final',
            archivedAt: Date.now()
        };
        if (!matchHistory.some(match => String(match.id) === String(finalCopy.id))) matchHistory.push(finalCopy);
        if (eliminationMode !== 'upper-lower') finalMatch = null;

        renderAll();
        saveToLocalStorage();
        if (eliminationMode === 'upper-lower') finishUpperLowerTournamentIfReady();
        else saveFinishedTournamentToSupabase();

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

    async function startTournament(selectedFormat = null) {
        if (participants.length < 2) {
            alert('❌ Necesitas al menos 2 participantes para iniciar el torneo.');
            return;
        }

        if (!tournamentVisible && getTotalRounds() === 0 && !selectedFormat) {
            document.getElementById('tournamentFormatModal')?.classList.add('active');
            return;
        }
        if (selectedFormat) tournamentFormat = selectedFormat;

        if (!tournamentId) {
            tournamentId = generateTournamentId();
        }
        await captureTournamentCreatorAndLog();

        tournamentVisible = true;
        document.getElementById('tournamentSection').style.display = 'block';
        setParticipantsCollapsed(true);
        activateTab('matches', true);

        renderAll();
        saveToLocalStorage();
        window.location.assign('/app/vs/');
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

        finishedTournamentSubmissionId = null;
        versus = [];
        matchHistory = [];
        accumulatedPoints = {};
        nextVersusId = 1;
        currentPhase = 1;
        tournamentWinner = null;
        tournamentFinished = false;
        knockoutRound = 0;
        resetBracketFormat();
        groupRound = 0;
        swissByes = [];
        selectedRound = 'all';
        selectedPlayerFilterId = null;
        preFinalMatch = null;
        preFinalPlayed = false;
        finalMatch = null;
        finalPlayed = false;
        semifinalLosers = [];
        semifinalWinners = [];
        podium = { first: null, second: null, third: null, fourth: null };
        tournamentVisible = false;

        participants.forEach(p => accumulatedPoints[p.id] = 0);
        setParticipantsCollapsed(false);
        activateTab('participants');
        if (resetTournamentPanel && resetTournamentToggleBtn) {
            resetTournamentPanel.hidden = true;
            resetTournamentToggleBtn.setAttribute('aria-expanded', 'false');
            resetTournamentToggleBtn.textContent = '⚙️ Opciones del torneo';
        }

        renderAll();
        saveToLocalStorage();
        alert('✅ Torneo reiniciado. Los participantes se mantienen.');
        window.location.assign('/app/participants/');
    }
    // ============================================================
    // 14. FUNCIONES DE LISTA DE TORNEOS
    // ============================================================

    // NUEVA: Función para obtener Gists desde la API de Vercel
    async function fetchGistsFromAPI() {
        try {
            const loadingIndicator = document.getElementById('gistLoadingIndicator');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'block';
                loadingIndicator.innerHTML = '<div class="gist-loading-skeleton" aria-label="Cargando Gists">' + Array.from({ length: 3 }, () => '<span class="loading-skeleton skeleton-card"></span>').join('') + '</div>';
            }

            console.log('📡 Solicitando Gists al servidor...');

            // Llamar a nuestra API de Vercel
            const response = await fetchWithTimeout('/api/gists');

            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📋 Datos recibidos:', data);

            if (loadingIndicator) loadingIndicator.style.display = 'none';

            if (!data.success) {
                throw new Error(data.error || 'Error desconocido');
            }

            return data.gists || [];

        } catch (error) {
            console.error('❌ Error al obtener Gists:', error);
            const loadingIndicator = document.getElementById('gistLoadingIndicator');
            if (loadingIndicator) loadingIndicator.style.display = 'none';

            // Mostrar mensaje de error amigable
            const container = document.getElementById('tournamentListContainer');
            if (container) {
                container.innerHTML = `
                <div style="text-align:center; padding:1rem; color:#FF1744;">
                    <div style="font-size:2rem; margin-bottom:0.5rem;">⚠️</div>
                    <p>No se pudieron cargar los Gists: ${escapeHtml(error.message)}</p>
                    <p style="font-size:0.8rem; color:#4A4A6A; margin-top:0.5rem;">
                        💡 Verifica que tu usuario de GitHub tenga Gists públicos con archivos .json
                    </p>
                </div>
            `;
            }
            return [];
        }
    }

    // Función modificada: showTournamentList con soporte para Gists
    async function showTournamentList() {
        const modal = document.getElementById('tournamentListModal');
        const container = document.getElementById('tournamentListContainer');
        const loadingIndicator = document.getElementById('gistLoadingIndicator');

        modal.classList.add('active');

        // Mostrar indicador de carga
        if (loadingIndicator) {
            loadingIndicator.style.display = 'block';
            loadingIndicator.innerHTML = '<div class="gist-loading-skeleton" aria-label="Cargando Gists">' + Array.from({ length: 3 }, () => '<span class="loading-skeleton skeleton-card"></span>').join('') + '</div>';
        }
        container.innerHTML = `<div class="gist-loading-skeleton" role="status" aria-label="Cargando torneos">${Array.from({ length: 3 }, () => '<span class="loading-skeleton skeleton-card"></span>').join('')}</div>`;

        // 1. Obtener torneos locales
        const localList = getTournamentList();

        // 2. Obtener Gists públicos
        let gistList = [];
        try {
            gistList = await fetchGistsFromAPI();
        } catch (error) {
            console.warn('Error al cargar Gists:', error);
        }

        if (loadingIndicator) loadingIndicator.style.display = 'none';

        // 3. Construir la vista
        let html = '';

        // Sección: Torneos locales
        if (localList.length > 0) {
            html += `
            <div style="margin-bottom: 1rem;">
                <div style="font-size:0.8rem; color:#00FF88; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.5rem;">
                    <span>📁</span> Torneos guardados localmente
                    <span style="font-size:0.65rem; color:#4A4A6A;">(${localList.length})</span>
                </div>
        `;

            const sorted = localList.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            sorted.forEach((t) => {
                const estado = t.finalizado ? 'finalizado' : 'activo';
                const estadoLabel = t.finalizado ? '🏁 Finalizado' : '🔄 Activo';
                const esActual = t.id === tournamentId;
                const fecha = new Date(t.fecha);
                const fechaStr = fecha.toLocaleDateString('es-ES', {
                    day: '2-digit', month: 'short', year: 'numeric'
                });
                const safeTournamentId = escapeHtml(t.id);

                html += `
                <div class="tournament-list-item ${esActual ? 'active' : ''}" style="${esActual ? 'border-color: rgba(0, 255, 136, 0.3); background: rgba(0, 255, 136, 0.05);' : ''}">
                    <div class="info">
                        <div class="name">
                            ${esActual ? '🟢 ' : ''}${escapeHtml(t.name)}
                            ${esActual ? '<span style="font-size:0.6rem; color:#00FF88; margin-left:0.3rem;">(Actual)</span>' : ''}
                        </div>
                        <div class="details">
                            <span>👥 ${t.participantes || 0} participantes</span>
                            <span>📅 ${fechaStr}</span>
                            <span class="status ${estado}">${estadoLabel}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.3rem;">
                        ${!esActual ? `<button class="btn-cargar" data-torneo-id="${safeTournamentId}">📂 Cargar</button>` : ''}
                        <button class="btn-eliminar" data-torneo-id="${safeTournamentId}">🗑️</button>
                    </div>
                </div>
            `;
            });

            html += `</div>`;
        }

        // Sección: Gists públicos
        if (gistList.length > 0) {
            html += `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size:0.8rem; color:#00D4FF; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.5rem;">
                    <span>☁️</span> Torneos en GitHub Gist
                    <span style="font-size:0.65rem; color:#4A4A6A;">(${gistList.length})</span>
                </div>
        `;

            gistList.forEach((gist) => {
                const fecha = new Date(gist.updated);
                const fechaStr = fecha.toLocaleDateString('es-ES', {
                    day: '2-digit', month: 'short', year: 'numeric'
                });
                const gistPageUrl = safeExternalUrl(gist.url);
                const gistRawUrl = safeExternalUrl(gist.rawUrl);
                if (!gistPageUrl || !gistRawUrl || !gistRawUrl.startsWith('https://gist.githubusercontent.com/')) return;

                html += `
                <div class="tournament-list-item" style="border-color: rgba(0, 212, 255, 0.1);">
                    <div class="info">
                        <div class="name" style="color: #00D4FF;">
                            📄 ${escapeHtml(gist.name)}
                        </div>
                        <div class="details">
                            <span>📅 ${fechaStr}</span>
                            <span>🔗 <a href="${escapeHtml(gistPageUrl)}" target="_blank" rel="noopener noreferrer" style="color:#4A4A6A; text-decoration:underline;">Ver en GitHub</a></span>
                            ${gist.isPublic ? '<span style="color:#00FF88;">🔓 Público</span>' : ''}
                        </div>
                    </div>
                    <button class="btn-cargar" data-gist-url="${escapeHtml(gistRawUrl)}" style="border-color: rgba(0, 212, 255, 0.2); color: #00D4FF;">
                        📂 Cargar
                    </button>
                </div>
            `;
            });

            html += `</div>`;
        }

        // Si no hay nada
        if (localList.length === 0 && gistList.length === 0) {
            html = `
            <div style="text-align:center; padding:2rem; color:#4A4A6A;">
                <div style="font-size:2rem; margin-bottom:0.5rem;">🏟️</div>
                No tienes torneos guardados.
                <div style="margin-top:0.5rem; font-size:0.8rem;">
                    Crea uno nuevo desde el botón "Crear torneo" o
                    <button class="btn btn-sm btn-outline" id="refreshGistsFromEmptyBtn"
                        style="border-color: rgba(0, 212, 255, 0.2); color: #00D4FF;">
                        ☁️ cargar desde GitHub
                    </button>
                </div>
            </div>
        `;
        }

        container.innerHTML = html;

        // === EVENT LISTENERS ===

        // Cargar torneo local
        container.querySelectorAll('.btn-cargar[data-torneo-id]').forEach(btn => {
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

        // Cargar desde Gist
        container.querySelectorAll('.btn-cargar[data-gist-url]').forEach(btn => {
            btn.addEventListener('click', async function () {
                const url = this.dataset.gistUrl;
                if (url) {
                    document.getElementById('urlInput').value = url;
                    await loadTournamentFromUrl();
                    document.getElementById('tournamentListModal').classList.remove('active');
                }
            });
        });

        // Eliminar torneo local
        container.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const torneoId = this.dataset.torneoId;
                const torneo = localList.find(t => t.id === torneoId);

                if (!confirm(`⚠️ ¿Eliminar el torneo "${torneo?.name}"?\n\nEsta acción eliminará todos los datos asociados.`)) {
                    return;
                }

                if (torneoId === tournamentId) {
                    if (!confirm('⚠️ Estás eliminando el torneo actual. ¿Continuar?')) {
                        return;
                    }
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

        // Botón para recargar Gists desde el mensaje vacío
        document.getElementById('refreshGistsFromEmptyBtn')?.addEventListener('click', function () {
            showTournamentList();
        });

        // Búsqueda
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

    // NUEVO: Event listener para recargar Gists manualmente
    document.getElementById('refreshGistsBtn')?.addEventListener('click', function () {
        showTournamentList();
    });

    // ============================================================
    // 15. FUNCIONES DE INICIALIZACIÓN
    // ============================================================

    function initializeApp() {
        console.log('🚀 Iniciando aplicación...');

        try {
            const loaded = loadFromLocalStorage();

            if (loaded) {
                console.log('✅ Datos cargados desde localStorage');
                renderAll();
                saveToLocalStorage();
            } else {
                console.log('📋 Iniciando torneo vacío');
                renderAll();
            }

            if ((routeTab || requestedNavigationTab) === 'matches' && !tournamentVisible) {
                window.location.replace('/app/participants/');
                return;
            }

            if (tournamentVisible) setParticipantsCollapsed(true);
            if (['participants', 'matches', 'table'].includes(requestedNavigationTab)) {
                activateTab(requestedNavigationTab);
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
    createTournamentBtn.addEventListener('click', async function () {
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
        activeSavedScoreTable = null;
        if (savedScoreTableSelect) savedScoreTableSelect.value = '';
        tournamentId = generateTournamentId();
        tournamentCreatorUserId = null;
        tournamentCreatorName = null;
        tournamentCreationLogged = false;
        finishedTournamentSubmissionId = null;
        tournamentShareId = null;
        tournamentShareWriteToken = null;
        tournamentSharingEnabled = false;
        lastSharedTournamentSnapshot = null;
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
        resetBracketFormat();
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

        await captureTournamentCreatorAndLog();

        document.getElementById('tournamentSection').style.display = 'none';
        renderAll();
        saveToLocalStorage();

        alert(`✅ Torneo "${nombre}" creado!\n\n📝 Ahora puedes agregar participantes y empezar el torneo.`);

        const addInitial = confirm('¿Quieres agregar participantes ahora?');
        if (addInitial) {
            const names = prompt('Ingresa los nombres separados por comas:\n(ej: Ana, Carlos, Marta)');
            if (names) {
                const nameList = names.split(',').map(n => n.trim()).filter(n => n);
                const addedPlayers = [];
                for (const name of nameList) {
                    if (!participantExistsByName(name)) {
                        const added = addParticipant(name, { persist: false });
                        if (added) addedPlayers.push(added);
                    }
                }
                savePlayersToSupabase(addedPlayers);
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
    savedScoreTableSelect?.addEventListener('change', function () {
        loadSavedScoreTableById(this.value);
    });
    refreshSavedScoreTablesBtn?.addEventListener('click', loadSavedScoreTables);

    addBtn.addEventListener('click', async function () {
        const typedNames = newParticipantInput.value.split(',').map(name => name.trim()).filter(Boolean);
        if (typedNames.length === 0) {
            alert('Escribe un nombre.');
            return;
        }
        if (!supabaseConfig && supabaseInitialization) await supabaseInitialization;
        const savedNames = await Promise.all(typedNames.map(name => supabaseConfig
            ? savedPlayerService.resolveNameOrOriginal(name, error => console.warn('No se pudo normalizar el nombre con Supabase:', error))
            : Promise.resolve(name.trim())
        ));
        const seenNames = new Set();
        let addedCount = 0;
        const addedPlayers = [];
        savedNames.forEach(name => {
            const normalized = name.trim().toLocaleLowerCase();
            if (!normalized || seenNames.has(normalized) || participantExistsByName(name)) return;
            seenNames.add(normalized);
            const added = addParticipant(name, { persist: false });
            if (added) {
                addedCount++;
                addedPlayers.push(added);
            }
        });
        savePlayersToSupabase(addedPlayers);

        newParticipantInput.value = '';
        participantAutocomplete.hide();
        renderAll();
        saveToLocalStorage();
        if (addedCount === 0) {
            alert(typedNames.length === 1
                ? `"${savedNames[0]}" ya está en la lista.`
                : 'Todos esos nombres ya están en la lista.');
        } else if (addedCount < typedNames.length) {
            alert(`✅ Se agregaron ${addedCount} participantes. Se omitieron ${typedNames.length - addedCount} repetidos.`);
        }
    });

    document.getElementById('clearAllParticipantsBtn')?.addEventListener('click', function (e) {
        e.preventDefault();
        clearAllParticipants();
    });

    // No pasar el MouseEvent como selectedFormat: el modal solo se abre sin formato explícito.
    document.getElementById('startTournamentBtn')?.addEventListener('click', () => startTournament());
    totalScoreTableEl?.addEventListener('click', event => {
        const trigger = event.target.closest('.score-player-history');
        if (trigger) {
            event.preventDefault();
            showPlayerHistory(trigger.dataset.playerId, !activeSavedScoreTable);
        }
    });
    const playerHistoryModal = document.getElementById('playerHistoryModal');
    document.getElementById('closePlayerHistoryModal')?.addEventListener('click', () => playerHistoryModal?.classList.remove('active'));
    playerHistoryModal?.addEventListener('click', event => {
        if (event.target === playerHistoryModal) playerHistoryModal.classList.remove('active');
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') playerHistoryModal?.classList.remove('active');
    });
    const tournamentFormatModal = document.getElementById('tournamentFormatModal');
    document.getElementById('closeTournamentFormatModal')?.addEventListener('click', () => tournamentFormatModal?.classList.remove('active'));
    tournamentFormatModal?.addEventListener('click', event => {
        if (event.target === tournamentFormatModal) tournamentFormatModal.classList.remove('active');
    });
    document.getElementById('startRandomTournamentBtn')?.addEventListener('click', () => {
        tournamentFormatModal?.classList.remove('active');
        startTournament('random');
    });
    document.getElementById('startSwissTournamentBtn')?.addEventListener('click', () => {
        tournamentFormatModal?.classList.remove('active');
        startTournament('swiss');
    });

    function setParticipantsCollapsed(collapsed) {
        if (!participantCard || !participantToggleBtn) return;
        participantCard.classList.toggle('participants-collapsed', collapsed);
        participantToggleBtn.setAttribute('aria-expanded', String(!collapsed));
        participantToggleBtn.textContent = collapsed ? '▼ Mostrar participantes' : '▲ Ocultar participantes';
    }

    participantToggleBtn?.addEventListener('click', function () {
        setParticipantsCollapsed(!participantCard.classList.contains('participants-collapsed'));
    });

    versusListEl?.addEventListener('click', function (event) {
        const historyTrigger = event.target.closest('.score-player-history');
        if (historyTrigger) {
            event.preventDefault();
            showPlayerHistory(historyTrigger.dataset.playerId, true);
            return;
        }
        const trigger = event.target.closest('.player-filter-trigger');
        if (!trigger) return;
        selectedPlayerFilterId = trigger.dataset.playerFilterId;
        selectedRound = 'all';
        renderRoundSelector();
        renderVersus();
    });

    clearPlayerFilterBtn?.addEventListener('click', function () {
        selectedPlayerFilterId = null;
        renderVersus();
    });

    classificationToggleBtn?.addEventListener('click', function () {
        const shouldExpand = classificationContent.hidden;
        classificationContent.hidden = !shouldExpand;
        classificationToggleBtn.setAttribute('aria-expanded', String(shouldExpand));
        classificationToggleBtn.textContent = shouldExpand ? '▲ Ocultar clasificación' : '▼ Mostrar clasificación';
    });

    resetTournamentToggleBtn?.addEventListener('click', function () {
        const shouldExpand = resetTournamentPanel.hidden;
        resetTournamentPanel.hidden = !shouldExpand;
        resetTournamentToggleBtn.setAttribute('aria-expanded', String(shouldExpand));
        resetTournamentToggleBtn.textContent = shouldExpand ? '▲ Ocultar opciones' : '⚙️ Opciones del torneo';
    });

    document.getElementById('editTournamentNameBtn')?.addEventListener('click', editTournamentName);
    shareTournamentBtn?.addEventListener('click', shareTournament);
    shareTournamentWhatsAppBtn?.addEventListener('click', shareTournamentViaWhatsApp);

    // --- Gestión de rondas ---
    generateGroupBtn.addEventListener('click', generateGroupRound);

    document.getElementById('nextGroupRoundBtn').addEventListener('click', function () {
        generateGroupRound();
    });

    document.getElementById('mobileNextRoundBtn')?.addEventListener('click', function () {
        if (currentPhase === 2) nextKnockoutRound();
        else generateGroupRound();
    });

    document.getElementById('mobileKnockoutBtn')?.addEventListener('click', () => {
        if (tournamentFormat === 'swiss') finishSwissTournament();
        else requestKnockoutStart();
    });
    document.getElementById('finishSwissTournamentBtn')?.addEventListener('click', finishSwissTournament);

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
        const matchesToKeep = [...matchHistory, ...versus.filter(match => !pendingMatches.includes(match))];
        const pairings = generatePairings(players, getPreviousGroupPairKeys(matchesToKeep));
        if (pairings.length !== pendingMatches.length) {
            alert('No existe otra combinación completa sin repetir enfrentamientos anteriores.');
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
    function requestKnockoutStart() {
        if (tournamentFormat === 'swiss') {
            finishSwissTournament();
            return;
        }
        if (participants.length < 2) {
            alert('❌ Necesitas al menos 2 participantes.');
            return;
        }

        if (currentPhase === 1 && versus.length > 0) {
            const allPlayed = versus.every(v => v.scoreA !== 0 || v.scoreB !== 0 || v.drawResult);
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

        const upperLowerButton = document.getElementById('startUpperLowerKnockoutBtn');
        if (upperLowerButton) {
            upperLowerButton.disabled = participants.length < 4;
            upperLowerButton.title = participants.length < 4 ? 'Se necesitan al menos 4 participantes.' : '';
        }
        document.getElementById('knockoutFormatModal')?.classList.add('active');
    }

    startKnockoutBtn.addEventListener('click', requestKnockoutStart);
    const knockoutFormatModal = document.getElementById('knockoutFormatModal');
    document.getElementById('closeKnockoutFormatModal')?.addEventListener('click', () => knockoutFormatModal?.classList.remove('active'));
    knockoutFormatModal?.addEventListener('click', event => {
        if (event.target === knockoutFormatModal) knockoutFormatModal.classList.remove('active');
    });
    document.getElementById('startSingleKnockoutBtn')?.addEventListener('click', () => {
        knockoutFormatModal?.classList.remove('active');
        startKnockout('single');
    });
    document.getElementById('startUpperLowerKnockoutBtn')?.addEventListener('click', () => {
        knockoutFormatModal?.classList.remove('active');
        startKnockout('upper-lower');
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

        if (eliminationMode !== 'upper-lower' && preFinalMatch && !preFinalPlayed) {
            alert('⚠️ Primero debes jugar la PRE-FINAL (3er y 4to lugar).\nUsa los botones en el panel de eliminatorias.');
            return;
        }
        if (eliminationMode !== 'upper-lower' && finalMatch && !finalPlayed) {
            alert('⚠️ Primero debes jugar la FINAL.\nUsa los botones en el panel de eliminatorias.');
            return;
        }

        if (versus.length === 0) {
            alert('No hay enfrentamientos en esta ronda.');
            return;
        }

        const allPlayed = versus.every(v => v.scoreA !== 0 || v.scoreB !== 0 || v.drawResult);
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
            lowerBracketRound,
            eliminationMode,
            upperByePlayers,
            lowerByePlayers,
            upperWaitingPlayers,
            lowerWaitingPlayers,
            activeEliminationBracket,
            upperFinalists,
            lowerFinalists,
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
            tournamentVisible,
            tournamentFormat,
            swissByes
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

    fileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.participants) {
                        alert('Archivo inválido. Faltan datos requeridos.');
                        return;
                    }
                    tournamentId = data.tournamentId || generateTournamentId();
                    tournamentCreatorUserId = null;
                    tournamentCreatorName = null;
                    tournamentCreationLogged = false;
                    finishedTournamentSubmissionId = null;
                    tournamentShareId = null;
                    tournamentShareWriteToken = null;
                    tournamentSharingEnabled = false;
                    lastSharedTournamentSnapshot = null;
                    tournamentName = data.tournamentName || 'Torneo Importado';
                    participants = data.participants || [];
                    versus = data.versus || [];
                    matchHistory = data.matchHistory || [];
                    nextVersusId = data.nextVersusId || 1;
                    currentPhase = data.currentPhase || 1;
                    tournamentWinner = data.tournamentWinner || null;
                    knockoutRound = data.knockoutRound || 0;
                    lowerBracketRound = data.lowerBracketRound || 0;
                    eliminationMode = data.eliminationMode || 'single';
                    upperByePlayers = data.upperByePlayers || [];
                    lowerByePlayers = data.lowerByePlayers || [];
                    upperWaitingPlayers = data.upperWaitingPlayers || [];
                    lowerWaitingPlayers = data.lowerWaitingPlayers || [];
                    activeEliminationBracket = data.activeEliminationBracket || 'upper';
                    upperFinalists = data.upperFinalists || { winner: null, runnerUp: null };
                    lowerFinalists = data.lowerFinalists || { winner: null, runnerUp: null };
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
                    await captureTournamentCreatorAndLog();
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
    // MODAL DE CARGAR DESDE URL
    // ============================================================
    // ============================================================
    // FUNCIÓN DE NOTIFICACIÓN (REEMPLAZO PARA showSyncNotification)
    // ============================================================
    // ============================================================
    // FUNCIÓN DE IMPORTACIÓN DE TORNEO DESDE JSON
    // ============================================================

    async function importTournamentJSON(jsonData) {
        try {
            if (!jsonData || typeof jsonData !== 'object') {
                throw new Error('Formato JSON inválido');
            }

            if (!jsonData.participants || !Array.isArray(jsonData.participants)) {
                throw new Error('JSON debe contener array de participants');
            }

            console.log('📥 Importando torneo:', jsonData.tournamentName || 'Sin nombre');

            // Guardar el torneo actual antes de importar
            if (tournamentId) {
                saveToLocalStorage();
            }

            // Cargar datos del JSON
            tournamentId = jsonData.tournamentId || generateTournamentId();
            tournamentCreatorUserId = null;
            tournamentCreatorName = null;
            tournamentCreationLogged = false;
            finishedTournamentSubmissionId = null;
            tournamentShareId = null;
            tournamentShareWriteToken = null;
            tournamentSharingEnabled = false;
            lastSharedTournamentSnapshot = null;
            tournamentName = jsonData.tournamentName || 'Torneo Importado';
            participants = jsonData.participants || [];
            accumulatedPoints = jsonData.accumulatedPoints || {};
            matchHistory = jsonData.matchHistory || [];
            versus = jsonData.versus || [];
            currentPhase = jsonData.currentPhase || 1;
            groupRound = jsonData.groupRound || 0;
            knockoutRound = jsonData.knockoutRound || 0;
            lowerBracketRound = jsonData.lowerBracketRound || 0;
            eliminationMode = jsonData.eliminationMode || 'single';
            upperByePlayers = jsonData.upperByePlayers || [];
            lowerByePlayers = jsonData.lowerByePlayers || [];
            upperWaitingPlayers = jsonData.upperWaitingPlayers || [];
            lowerWaitingPlayers = jsonData.lowerWaitingPlayers || [];
            activeEliminationBracket = jsonData.activeEliminationBracket || 'upper';
            upperFinalists = jsonData.upperFinalists || { winner: null, runnerUp: null };
            lowerFinalists = jsonData.lowerFinalists || { winner: null, runnerUp: null };
            tournamentFinished = jsonData.tournamentFinished || false;
            tournamentFormat = jsonData.tournamentFormat || 'random';
            swissByes = jsonData.swissByes || [];
            customQualifiedCount = jsonData.customQualifiedCount || 8;
            tournamentWinner = jsonData.tournamentWinner || null;
            nextVersusId = jsonData.nextVersusId || 1;
            preFinalMatch = jsonData.preFinalMatch || null;
            preFinalPlayed = jsonData.preFinalPlayed || false;
            finalMatch = jsonData.finalMatch || null;
            finalPlayed = jsonData.finalPlayed || false;
            semifinalLosers = jsonData.semifinalLosers || [];
            semifinalWinners = jsonData.semifinalWinners || [];
            podium = jsonData.podium || { first: null, second: null, third: null, fourth: null };
            tournamentVisible = jsonData.tournamentVisible !== false;
            selectedRound = jsonData.selectedRound || 'all';

            // Asegurar que los participantes tengan IDs
            ensureParticipantsObjects();
            savePlayersToSupabase(participants);

            // Asegurar que cada participante tenga puntos
            participants.forEach(p => {
                if (p && p.id && !(p.id in accumulatedPoints)) {
                    accumulatedPoints[p.id] = accumulatedPoints[p.name] || 0;
                }
            });

            if (qualifiedCountInput) {
                qualifiedCountInput.value = customQualifiedCount;
            }

            recalculateAccumulatedPoints();

            await captureTournamentCreatorAndLog();

            // Mostrar la sección del torneo
            tournamentVisible = true;
            const section = document.getElementById('tournamentSection');
            if (section) section.style.display = 'block';

            renderAll();
            saveToLocalStorage();
            if (tournamentFinished) saveFinishedTournamentToSupabase();

            console.log('✅ Torneo importado correctamente:', tournamentName);
            return true;

        } catch (error) {
            console.error('❌ Error al importar torneo:', error);
            showSyncNotification('❌ Error al importar: ' + error.message);
            throw error;
        }
    }


    function showSyncNotification(message) {
        const storageStatusEl = document.getElementById('storageStatus');
        if (!storageStatusEl) {
            console.log('📢 Notificación:', message);
            return;
        }

        // Guardar el texto original
        const originalText = storageStatusEl.textContent;
        const originalBg = storageStatusEl.style.background;
        const originalColor = storageStatusEl.style.color;

        // Mostrar el mensaje
        storageStatusEl.textContent = message;
        storageStatusEl.style.background = 'rgba(0, 212, 255, 0.15)';
        storageStatusEl.style.color = '#00D4FF';
        storageStatusEl.style.borderColor = 'rgba(0, 212, 255, 0.2)';

        // Restaurar después de 3 segundos
        clearTimeout(storageStatusEl._timeout);
        storageStatusEl._timeout = setTimeout(() => {
            storageStatusEl.textContent = originalText || '💾 Guardado';
            storageStatusEl.style.background = originalBg || 'rgba(240, 244, 249, 0.8)';
            storageStatusEl.style.color = originalColor || '#6e7f94';
            storageStatusEl.style.borderColor = 'rgba(0, 255, 136, 0.12)';
        }, 3000);
    }

    // Mostrar modal de carga desde URL
    function showLoadUrlModal() {
        const modal = document.getElementById('loadUrlModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            // Enfocar el input automáticamente
            setTimeout(() => {
                const input = document.getElementById('urlInput');
                if (input) input.focus();
            }, 100);
        }
    }

    // Cerrar modal
    function closeLoadUrlModal() {
        const modal = document.getElementById('loadUrlModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            // Limpiar el input
            const input = document.getElementById('urlInput');
            if (input) input.value = '';
        }
    }

    // ============================================================
    // CARGAR TORNEO DESDE URL (VERSIÓN CORREGIDA)
    // ============================================================

    async function loadTournamentFromUrl() {
        const input = document.getElementById('urlInput');
        const url = input.value.trim();

        if (!url) {
            alert('Por favor, ingresa una URL válida');
            return;
        }

        let parsedUrl;
        try {
            if (url.length > 2048) throw new Error();
            parsedUrl = new URL(url);
        } catch {
            alert('Ingresa una URL HTTPS válida.');
            return;
        }
        if (parsedUrl.protocol !== 'https:') {
            alert('Por seguridad, solo se pueden cargar torneos desde direcciones HTTPS.');
            return;
        }

        const loadBtn = document.getElementById('loadFromUrlBtn');
        const originalText = loadBtn.textContent;
        loadBtn.textContent = '⏳ Cargando...';
        loadBtn.disabled = true;

        try {
            showSyncNotification('⏳ Cargando torneo desde URL...');

            console.log('📡 Intentando cargar desde:', url);

            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            console.log('📡 Status:', response.status);

            if (!response.ok) {
                throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
            }

            const jsonData = await response.json();
            console.log('✅ Datos recibidos:', jsonData);
            console.log('✅ Participantes:', jsonData.participants?.length);

            // Validar que sea un torneo válido
            if (!jsonData.participants || !Array.isArray(jsonData.participants)) {
                throw new Error('El archivo no es un torneo válido (falta "participants")');
            }

            // Importar los datos
            await importTournamentJSON(jsonData);

            showSyncNotification('✅ Torneo cargado desde URL');
            alert('✅ Torneo cargado correctamente desde la URL\n\n' +
                `📊 Participantes: ${jsonData.participants.length}\n` +
                `⚔️ Partidos: ${(jsonData.matchHistory?.length || 0) + (jsonData.versus?.length || 0)}`);

            // Cerrar el modal
            closeLoadUrlModal();

        } catch (error) {
            console.error('❌ Error al cargar desde URL:', error);
            showSyncNotification('❌ Error al cargar: ' + error.message);

            let errorMsg = '❌ Error al cargar desde URL:\n\n';
            errorMsg += error.message + '\n\n';

            if (error.message.includes('CORS') || error.message.includes('cross-origin')) {
                errorMsg += '🔒 Error de CORS. Verifica que la URL permita acceso desde tu dominio.\n\n';
                errorMsg += '💡 Prueba la URL en el navegador para confirmar que es accesible.';
            } else if (error.message.includes('404')) {
                errorMsg += '🔍 Archivo no encontrado (404). Verifica que la URL sea correcta.';
            } else if (error.message.includes('JSON')) {
                errorMsg += '📄 El archivo no es un JSON válido. Verifica el contenido.';
            } else {
                errorMsg += '💡 Asegúrate de que la URL sea pública y accesible.';
            }

            alert(errorMsg);
        } finally {
            loadBtn.textContent = originalText;
            loadBtn.disabled = false;
        }
    }

    // ============================================================
    // EVENT LISTENERS PARA EL MODAL
    // ============================================================

    // Botón para abrir el modal de carga desde URL
    document.getElementById('loadUrlBtn')?.addEventListener('click', showLoadUrlModal);


    // Botón para cerrar el modal
    document.getElementById('closeLoadUrlModal')?.addEventListener('click', closeLoadUrlModal);

    // Cerrar al hacer clic fuera del modal
    document.getElementById('loadUrlModal')?.addEventListener('click', function (e) {
        if (e.target === this) {
            closeLoadUrlModal();
        }
    });

    // Botón de carga
    document.getElementById('loadFromUrlBtn')?.addEventListener('click', loadTournamentFromUrl);

    // Cargar con Enter en el input
    document.getElementById('urlInput')?.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            loadTournamentFromUrl();
        }
    });

    // Cerrar con Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeLoadUrlModal();
        }
    });

    // ============================================================
    // 17. INICIALIZACIÓN
    // ============================================================

    migrateLegacyUserbaseStorage();
    initializeApp();
    supabaseInitialization = initializeSupabase();

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
