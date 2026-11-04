const configEndpoint = '/api/supabase-config';
const tournamentsEndpoint = '/rest/v1/finished_tournaments';
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const profileCard = document.getElementById('profileCard');
const playerNameHeading = document.getElementById('playerName');
const playerAvatar = document.getElementById('playerAvatar');
const playerSummary = document.getElementById('playerSummary');
const bestTournamentCard = document.getElementById('bestTournament');
const resultFilterPanel = document.getElementById('resultFilterPanel');
const resultFilterTitle = document.getElementById('resultFilterTitle');
const resultFilterList = document.getElementById('resultFilterList');
const tournamentList = document.getElementById('tournamentList');
let activeResultFilter = null;

function normalizeName(value) {
    return String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
}

function resolvePlayerName() {
    const fromQuery = new URLSearchParams(window.location.search).get('player');
    if (fromQuery) return fromQuery.trim();
    const segment = window.location.pathname.split('/').filter(Boolean).pop() || '';
    try {
        return decodeURIComponent(segment).trim();
    } catch {
        return segment.trim();
    }
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function showError(message) {
    loadingState.hidden = true;
    profileCard.hidden = true;
    resultFilterPanel.hidden = true;
    tournamentList.hidden = true;
    errorState.textContent = message;
    errorState.hidden = false;
}

function setPlayerAvatar(name) {
    const initial = (Array.from(String(name || '').trim())[0]?.toLocaleUpperCase() || '?')
        .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d6c7f3"/><stop offset="1" stop-color="#9fc9d8"/></linearGradient></defs><circle cx="80" cy="80" r="80" fill="url(#g)"/><circle cx="80" cy="80" r="64" fill="#ffffff" fill-opacity=".18"/><text x="80" y="101" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="67" font-weight="800" fill="#25354b">${initial}</text></svg>`;
    playerAvatar.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    playerAvatar.alt = `Imagen de perfil de ${name}`;
}

async function getSupabaseConfig() {
    const response = await fetch(configEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar la conexión a la base de datos.');
    const config = await response.json();
    if (!config.url || !config.anonKey) throw new Error('La base de datos todavía no está configurada.');
    return { url: config.url.replace(/\/$/, ''), anonKey: config.anonKey };
}

async function loadFinishedTournaments(config) {
    const allRows = [];
    const columns = 'id,name,finished_at,participants,standings,matches,tournament_format,swiss_byes,winner,podium';
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        const params = new URLSearchParams({ select: columns, order: 'finished_at.desc' });
        const response = await fetch(`${config.url}${tournamentsEndpoint}?${params}`, {
            headers: {
                apikey: config.anonKey,
                Authorization: `Bearer ${config.anonKey}`,
                Range: `${offset}-${offset + pageSize - 1}`
            }
        });
        if (!response.ok) throw new Error('No se pudieron cargar los torneos guardados.');
        const rows = await response.json();
        allRows.push(...(Array.isArray(rows) ? rows : []));
        if (!Array.isArray(rows) || rows.length < pageSize) break;
    }
    return allRows;
}

function getTournamentPlayer(tournament, targetName) {
    const participants = Array.isArray(tournament.participants) ? tournament.participants : [];
    const standings = Array.isArray(tournament.standings) ? tournament.standings : [];
    const participant = participants.find(player => normalizeName(player.name) === targetName) ||
        standings.find(player => normalizeName(player.name) === targetName);
    if (!participant) return null;
    const standing = standings.find(player =>
        (participant.id && String(player.id) === String(participant.id)) || normalizeName(player.name) === targetName
    ) || null;
    return { participant, standing, standings };
}

function getPlayerMatches(tournament, participant, targetName) {
    const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
    const playerId = String(participant.id || '');
    return matches
        .filter(match => {
            const isA = (playerId && String(match.playerAId || '') === playerId) || normalizeName(match.playerA) === targetName;
            const isB = (playerId && String(match.playerBId || '') === playerId) || normalizeName(match.playerB) === targetName;
            return isA || isB;
        })
        .map(match => {
            const isA = ((playerId && String(match.playerAId || '') === playerId) || normalizeName(match.playerA) === targetName);
            const opponent = isA ? match.playerB : match.playerA;
            const scoreFor = Number(isA ? match.scoreA : match.scoreB) || 0;
            const scoreAgainst = Number(isA ? match.scoreB : match.scoreA) || 0;
            const played = Boolean(match.drawResult || match.jugado || scoreFor !== 0 || scoreAgainst !== 0);
            const isDraw = Boolean(match.drawResult || (played && scoreFor === scoreAgainst));
            const result = !played ? 'Pendiente' : isDraw ? 'Empate' : scoreFor > scoreAgainst ? 'Victoria' : 'Derrota';
            const roundLabel = match.view_label || (match.stage === 'final' ? 'Final' : match.stage === 'pre-final'
                ? 'Pre-final' : Number(match.round) > 0 ? `Ronda ${match.round}`
                    : Number(match.bracketRound) > 0 ? `Eliminatorias · Ronda ${match.bracketRound}` : 'Eliminatorias');
            return {
                order: Number(match.view_order) || Number(match.round) || Number(match.bracketRound) || 0,
                roundLabel,
                opponent: opponent || '—',
                score: played ? `${scoreFor}–${scoreAgainst}` : 'Por jugar',
                result
            };
        })
        .sort((a, b) => a.order - b.order);
}

function renderMatch(match) {
    const row = makeElement('div', 'profile-match');
    row.append(
        makeElement('span', 'profile-match-round', match.roundLabel),
        makeElement('strong', 'profile-match-opponent', `vs ${match.opponent}`),
        makeElement('span', 'profile-match-score', match.score)
    );
    const result = makeElement('span', `profile-match-result ${match.result === 'Victoria' ? 'win' : match.result === 'Derrota' ? 'loss' : match.result === 'Empate' ? 'draw' : ''}`, match.result);
    row.appendChild(result);
    return row;
}

function renderTournament(tournament, targetName, canonicalName) {
    const playerInfo = getTournamentPlayer(tournament, targetName);
    if (!playerInfo) return null;

    const { participant, standing, standings } = playerInfo;
    const playerMatches = getPlayerMatches(tournament, participant, targetName);
    const position = standing ? standings.indexOf(standing) + 1 : 0;
    const wins = playerMatches.filter(match => match.result === 'Victoria').length;
    const draws = playerMatches.filter(match => match.result === 'Empate').length;
    const losses = playerMatches.filter(match => match.result === 'Derrota').length;
    const points = Number(standing?.points) || 0;

    const details = makeElement('details', 'tournament-entry');
    const summary = document.createElement('summary');
    const main = makeElement('span', 'tournament-summary-main');
    main.appendChild(makeElement('strong', '', tournament.name || 'Torneo sin nombre'));
    const meta = makeElement('span', 'tournament-summary-meta');
    if (tournament.finished_at) meta.appendChild(makeElement('span', '', new Date(tournament.finished_at).toLocaleDateString('es-CL')));
    if (position) meta.appendChild(makeElement('span', '', `Puesto ${position}`));
    if (standing && standing.points !== undefined) meta.appendChild(makeElement('span', '', `${points} pts`));
    meta.appendChild(makeElement('span', '', `${wins}-${losses}-${draws}`));
    main.appendChild(meta);
    summary.append(main, makeElement('span', 'tournament-summary-chevron', '⌄'));
    details.appendChild(summary);

    const matchList = makeElement('div', 'tournament-match-list');
    if (playerMatches.length) playerMatches.forEach(match => matchList.appendChild(renderMatch(match)));
    else matchList.appendChild(makeElement('p', 'profile-empty-matches', 'Este torneo no tiene enfrentamientos guardados para el jugador.'));

    details.appendChild(matchList);
    const tournamentMatches = playerMatches.map(match => ({
        ...match,
        tournamentName: tournament.name || 'Torneo sin nombre',
        tournamentDate: tournament.finished_at || ''
    }));
    return {
        details,
        canonicalName: participant.name || canonicalName,
        matches: tournamentMatches,
        wins,
        losses,
        draws,
        position,
        points,
        tournamentName: tournament.name || 'Torneo sin nombre',
        tournamentDate: tournament.finished_at || ''
    };
}

function renderStatButton(label, count, result, className) {
    const button = makeElement('button', `profile-stat ${className}`, '');
    button.type = 'button';
    button.dataset.resultFilter = result;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'resultFilterPanel');
    button.append(
        makeElement('span', 'profile-stat-label', label),
        makeElement('strong', 'profile-stat-value', String(count))
    );
    return button;
}

function renderResultMatch(match) {
    const card = makeElement('article', 'profile-result-match');
    card.append(
        makeElement('span', 'profile-result-tournament', `${match.tournamentName}${match.tournamentDate ? ` · ${new Date(match.tournamentDate).toLocaleDateString('es-CL')}` : ''}`),
        makeElement('strong', 'profile-result-round', match.roundLabel),
        makeElement('span', 'profile-result-score', match.score),
        makeElement('span', 'profile-result-opponent', `vs ${match.opponent}`)
    );
    return card;
}

function showResultMatches(result, profiles) {
    if (activeResultFilter === result) {
        activeResultFilter = null;
        resultFilterPanel.hidden = true;
        playerSummary.querySelectorAll('[data-result-filter]').forEach(button => button.setAttribute('aria-expanded', 'false'));
        return;
    }

    activeResultFilter = result;
    const labels = { Victoria: 'Victorias', Derrota: 'Derrotas', Empate: 'Empates' };
    const matches = profiles.flatMap(profile => profile.matches).filter(match => match.result === result);
    resultFilterTitle.textContent = `${labels[result]} · ${matches.length}`;
    resultFilterList.replaceChildren(...matches.map(renderResultMatch));
    if (!matches.length) resultFilterList.appendChild(makeElement('p', 'profile-empty-matches', `Todavía no hay ${labels[result].toLocaleLowerCase()} registradas.`));
    resultFilterPanel.hidden = false;
    playerSummary.querySelectorAll('[data-result-filter]').forEach(button => {
        button.setAttribute('aria-expanded', String(button.dataset.resultFilter === result));
    });
    resultFilterPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderBestTournament(profiles) {
    const ranked = profiles.slice().sort((a, b) => {
        const aRank = a.position || Number.MAX_SAFE_INTEGER;
        const bRank = b.position || Number.MAX_SAFE_INTEGER;
        return aRank - bRank || b.points - a.points || Date.parse(b.tournamentDate || '') - Date.parse(a.tournamentDate || '');
    });
    const best = ranked[0];
    bestTournamentCard.replaceChildren();
    const icon = makeElement('span', 'best-tournament-icon', '🏆');
    icon.setAttribute('aria-hidden', 'true');
    const copy = makeElement('div', 'best-tournament-copy');
    copy.appendChild(makeElement('span', 'best-tournament-label', 'Mejor torneo'));
    copy.appendChild(makeElement('strong', 'best-tournament-name', best.tournamentName));
    const placement = best.position ? `Puesto ${best.position}` : 'Participación registrada';
    const points = `${best.points} pts`;
    const date = best.tournamentDate ? ` · ${new Date(best.tournamentDate).toLocaleDateString('es-CL')}` : '';
    copy.appendChild(makeElement('span', 'best-tournament-meta', `${placement} · ${points}${date}`));
    bestTournamentCard.append(icon, copy);
}

async function initializeProfile() {
    const requestedName = resolvePlayerName();
    const targetName = normalizeName(requestedName);
    if (!targetName) {
        showError('No se especificó el nombre del jugador.');
        return;
    }

    playerNameHeading.textContent = requestedName;
    try {
        const config = await getSupabaseConfig();
        const tournaments = await loadFinishedTournaments(config);
        const profiles = tournaments.map(tournament => renderTournament(tournament, targetName, requestedName)).filter(Boolean);
        const canonicalName = profiles[0]?.canonicalName || requestedName;
        playerNameHeading.textContent = canonicalName;
        setPlayerAvatar(canonicalName);
        loadingState.hidden = true;

        if (!profiles.length) {
            showError(`No encontramos torneos finalizados para ${requestedName}.`);
            playerNameHeading.textContent = requestedName;
            return;
        }

        const summary = profiles.reduce((total, profile) => ({
            wins: total.wins + profile.wins,
            losses: total.losses + profile.losses,
            draws: total.draws + profile.draws
        }), { wins: 0, losses: 0, draws: 0 });
        playerSummary.replaceChildren(
            renderStatButton('Victorias', summary.wins, 'Victoria', 'wins'),
            renderStatButton('Derrotas', summary.losses, 'Derrota', 'losses'),
            renderStatButton('Empates', summary.draws, 'Empate', 'draws')
        );
        renderBestTournament(profiles);
        profileCard.hidden = false;
        tournamentList.replaceChildren(makeElement('h2', 'profile-section-title', 'Torneos'), ...profiles.map(profile => profile.details));
        tournamentList.hidden = false;
        playerSummary.addEventListener('click', event => {
            const button = event.target.closest('[data-result-filter]');
            if (button) showResultMatches(button.dataset.resultFilter, profiles);
        });
    } catch (error) {
        showError(error.message || 'No se pudo cargar el perfil. Intenta nuevamente.');
    }
}

document.getElementById('closeResultFilter')?.addEventListener('click', () => {
    activeResultFilter = null;
    resultFilterPanel.hidden = true;
    playerSummary.querySelectorAll('[data-result-filter]').forEach(button => button.setAttribute('aria-expanded', 'false'));
});

initializeProfile();
