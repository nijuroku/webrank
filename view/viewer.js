import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const shareId = new URLSearchParams(window.location.search).get('id');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const tournamentView = document.getElementById('tournamentView');
const connectionStatus = document.getElementById('connectionStatus');
const liveDot = document.getElementById('liveDot');
const updatedAt = document.getElementById('updatedAt');
const roundNavigation = document.getElementById('roundNavigation');
const matchesList = document.getElementById('matchesList');
const standingsBody = document.getElementById('standingsBody');
let supabase = null;
let snapshot = null;
let selectedRoundKey = null;
const THEME_STORAGE_KEY = 'beybladex_theme';

function applyTheme(theme) {
    const isLight = theme === 'light';
    document.documentElement.classList.toggle('light-theme', isLight);
    document.body.classList.toggle('light-theme', isLight);

    const themeToggle = document.getElementById('themeToggleBtn');
    const modeLabel = themeToggle?.querySelector('.theme-mode-label');
    if (modeLabel) modeLabel.textContent = isLight ? 'Claro' : 'Oscuro';
    if (themeToggle) {
        themeToggle.setAttribute('aria-pressed', String(isLight));
        themeToggle.setAttribute('aria-label', isLight ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro');
        themeToggle.title = isLight ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro';
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = isLight ? '#eaf5ed' : '#101a2a';
}

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark'; } catch { /* Tema oscuro predeterminado. */ }
applyTheme(savedTheme);

document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const nextTheme = document.documentElement.classList.contains('light-theme') ? 'dark' : 'light';
    try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch { /* El cambio se mantiene en esta pestaña. */ }
    applyTheme(nextTheme);
});

window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY) applyTheme(event.newValue || 'dark');
});

function setConnectionStatus(message, state = '') {
    connectionStatus.textContent = message;
    liveDot.className = `live-dot ${state}`;
}

function showError(message) {
    loadingState.hidden = true;
    tournamentView.hidden = true;
    errorState.textContent = message;
    errorState.hidden = false;
}

function makeChip(text) {
    const chip = document.createElement('span');
    chip.className = 'meta-chip';
    chip.textContent = text;
    return chip;
}

function getPlayerStats(player, groupMatches, byes) {
    const playerId = String(player.id || '');
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let played = 0;
    groupMatches.forEach(match => {
        const isA = String(match.playerAId || '') === playerId || match.playerA === player.name;
        const isB = String(match.playerBId || '') === playerId || match.playerB === player.name;
        if (!isA && !isB) return;
        const completed = match.drawResult || Number(match.scoreA) !== 0 || Number(match.scoreB) !== 0;
        if (!completed) return;
        played++;
        const scoreFor = Number(isA ? match.scoreA : match.scoreB) || 0;
        const scoreAgainst = Number(isA ? match.scoreB : match.scoreA) || 0;
        if (match.drawResult || scoreFor === scoreAgainst) draws++;
        else if (scoreFor > scoreAgainst) wins++;
        else losses++;
    });
    wins += byes.filter(id => String(id) === playerId).length;
    return { wins, losses, draws, played };
}

function renderStandings(data) {
    const standings = Array.isArray(data.standings) ? data.standings : [];
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const groupMatches = matches.filter(match => Number(match.round) > 0);
    const byes = Array.isArray(data.swiss_byes) ? data.swiss_byes : [];
    document.getElementById('playerCount').textContent = `${standings.length} jugadores`;
    standingsBody.replaceChildren();

    if (!standings.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'Aún no hay participantes en la tabla.';
        row.appendChild(cell);
        standingsBody.appendChild(row);
        return;
    }

    standings.forEach((player, index) => {
        const stats = getPlayerStats(player, groupMatches, byes);
        const row = document.createElement('tr');
        const values = [index + 1, player.name, player.points ?? 0,
            `${Number(player.pointDifference) > 0 ? '+' : ''}${Number(player.pointDifference) || 0}`,
            `${stats.wins}-${stats.losses}-${stats.draws}`];
        values.forEach((value, column) => {
            const cell = document.createElement('td');
            cell.textContent = String(value);
            if (column === 2) cell.className = 'score-points';
            row.appendChild(cell);
        });
        standingsBody.appendChild(row);
    });
}

function renderMatch(match) {
    const card = document.createElement('article');
    const scoreA = Number(match.scoreA) || 0;
    const scoreB = Number(match.scoreB) || 0;
    const completed = match.drawResult || scoreA !== 0 || scoreB !== 0;
    card.className = `match-card ${completed ? 'played' : 'pending'}`;

    const playerA = document.createElement('div');
    playerA.className = 'player-name';
    playerA.textContent = match.playerA || '—';
    const center = document.createElement('div');
    center.className = 'match-center';
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = completed ? `${scoreA} – ${scoreB}` : 'VS';
    const status = document.createElement('span');
    status.className = 'match-status';
    status.textContent = match.drawResult ? 'Empate' : (completed ? 'Finalizado' : 'Por jugar');
    center.append(score, status);
    const playerB = document.createElement('div');
    playerB.className = 'player-name right';
    playerB.textContent = match.playerB || '—';
    card.append(playerA, center, playerB);
    return card;
}

function renderMatches(data) {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const groups = new Map();
    matches.forEach(match => {
        const key = match.view_key || (Number(match.round) > 0 ? `group-${match.round}` : 'knockout-1');
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: match.view_label || (Number(match.round) > 0 ? `Ronda ${match.round}` : 'Eliminatorias'),
                order: Number(match.view_order) || Number(match.round) || 1,
                matches: []
            });
        }
        groups.get(key).matches.push(match);
    });
    const rounds = [...groups.values()].sort((a, b) => a.order - b.order);
    document.getElementById('roundCount').textContent = `${rounds.length} rondas`;
    roundNavigation.replaceChildren();

    if (rounds.length > 1) {
        const allButton = document.createElement('button');
        allButton.type = 'button';
        allButton.className = `round-button ${selectedRoundKey === 'all' ? 'active' : ''}`;
        allButton.textContent = 'Todas';
        allButton.addEventListener('click', () => {
            selectedRoundKey = 'all';
            renderMatches(data);
        });
        roundNavigation.appendChild(allButton);
    }

    if (!selectedRoundKey || (selectedRoundKey !== 'all' && !groups.has(selectedRoundKey))) {
        selectedRoundKey = groups.has(data.current_round_key) ? data.current_round_key : rounds.at(-1)?.key || null;
    }

    rounds.forEach(round => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `round-button ${selectedRoundKey === round.key ? 'active' : ''}`;
        button.textContent = round.label;
        button.addEventListener('click', () => {
            selectedRoundKey = round.key;
            renderMatches(data);
        });
        roundNavigation.appendChild(button);
    });

    matchesList.replaceChildren();
    const visibleMatches = selectedRoundKey === 'all'
        ? matches
        : (groups.get(selectedRoundKey)?.matches || []);
    if (!visibleMatches.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Aún no hay enfrentamientos para mostrar.';
        matchesList.appendChild(empty);
        return;
    }
    visibleMatches.forEach(match => matchesList.appendChild(renderMatch(match)));
}

function renderSnapshot(data) {
    if (!data || data.id !== shareId) return;
    const incoming = Date.parse(data.updated_at || '') || 0;
    const current = Date.parse(snapshot?.updated_at || '') || 0;
    if (incoming && current && incoming < current) return;
    const previousRoundKey = snapshot?.current_round_key;
    if (!selectedRoundKey || (selectedRoundKey !== 'all' && selectedRoundKey === previousRoundKey)) {
        selectedRoundKey = data.current_round_key || null;
    }
    snapshot = data;

    document.title = `${data.tournament_name || 'Torneo'} · LaMafia BEYBLADEX`;
    document.getElementById('tournamentName').textContent = data.tournament_name || 'Torneo BeybladeX';
    document.getElementById('phaseLabel').textContent = data.tournament_finished
        ? (data.winner ? `🏆 Torneo finalizado · Campeón: ${data.winner}` : '🏆 Torneo finalizado')
        : `${data.phase_label || 'Torneo en vivo'} · ${data.current_round > 0 ? `Ronda ${data.current_round}` : 'Esperando ronda'}`;
    const meta = document.getElementById('tournamentMeta');
    meta.replaceChildren(
        makeChip(data.tournament_format === 'swiss' ? 'Formato suizo' : 'Formato aleatorio'),
        makeChip(`${(data.participants || []).length} participantes`),
        makeChip(data.tournament_finished ? 'Finalizado' : 'En curso')
    );
    updatedAt.textContent = data.updated_at
        ? `Actualizado ${new Date(data.updated_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
        : '';

    loadingState.hidden = true;
    errorState.hidden = true;
    tournamentView.hidden = false;
    renderMatches(data);
    renderStandings(data);
}

async function startViewer() {
    if (!shareId) {
        showError('El enlace no incluye el identificador del torneo. Pide al organizador que vuelva a compartirlo.');
        return;
    }
    try {
        const configResponse = await fetch('/api/supabase-config', { cache: 'no-store' });
        if (!configResponse.ok) throw new Error('No se pudo conectar con la configuración de Supabase.');
        const config = await configResponse.json();
        supabase = createClient(config.url, config.anonKey);

        supabase.channel(`shared-tournament-${shareId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'shared_tournaments',
                filter: `id=eq.${shareId}`
            }, payload => {
                if (payload.new) renderSnapshot(payload.new);
            })
            .subscribe(status => {
                if (status === 'SUBSCRIBED') setConnectionStatus('En vivo · conectado', 'connected');
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    setConnectionStatus('Reconectando al torneo…', 'disconnected');
                }
            });

        const { data, error } = await supabase.from('shared_tournaments').select('*').eq('id', shareId).maybeSingle();
        if (error) throw error;
        if (!data) {
            showError('No encontramos este torneo compartido. Puede que el enlace sea incorrecto o haya vencido tras siete días sin actualizaciones.');
            return;
        }
        renderSnapshot(data);
    } catch (error) {
        console.error('No se pudo cargar el torneo compartido:', error);
        showError('No se pudo cargar el torneo. Revisa la conexión e intenta abrir el enlace nuevamente.');
        setConnectionStatus('Sin conexión', 'disconnected');
    }
}

startViewer();
