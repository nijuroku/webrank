import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const configEndpoint = '/api/supabase-config';
const tournamentsEndpoint = '/rest/v1/finished_tournaments';
const aliasesEndpoint = '/rest/v1/player_aliases';
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const profileCard = document.getElementById('profileCard');
const playerNameHeading = document.getElementById('playerNameLabel');
const playerNameToggle = document.getElementById('playerNameToggle');
const playerAliasList = document.getElementById('playerAliasList');
const playerAvatar = document.getElementById('playerAvatar');
const playerSummary = document.getElementById('playerSummary');
const bestTournamentCard = document.getElementById('bestTournament');
const resultFilterPanel = document.getElementById('resultFilterPanel');
const resultFilterTitle = document.getElementById('resultFilterTitle');
const resultFilterList = document.getElementById('resultFilterList');
const tournamentList = document.getElementById('tournamentList');
const profileBanner = document.getElementById('playerBanner');
const profileDialog = document.getElementById('profileDialog');
const authPanel = document.getElementById('authPanel');
const accountPanel = document.getElementById('accountPanel');
const profileAuthNotice = document.getElementById('profileAuthNotice');
const profileAccountSummary = document.getElementById('profileAccountSummary');
const profileAccountStatus = document.getElementById('profileAccountStatus');
const requestProfileButton = document.getElementById('requestProfileButton');
const profileImageControls = document.getElementById('profileImageControls');
let activeResultFilter = null;
let supabase = null;
let currentUser = null;
let currentProfileKey = null;
let currentProfileName = null;
let currentPublicProfile = null;
let currentProfileRequest = null;
let currentProfileOwner = null;

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

function applyPlayerProfileAssets(profile) {
    if (profile?.avatar_url) {
        playerAvatar.src = profile.avatar_url;
        playerAvatar.alt = `Imagen de perfil de ${profile.player_name || currentProfileName}`;
    } else {
        setPlayerAvatar(profile?.player_name || currentProfileName || 'Jugador');
    }
    if (profile?.banner_url) {
        profileBanner.src = profile.banner_url;
        profileBanner.hidden = false;
    } else {
        profileBanner.removeAttribute('src');
        profileBanner.hidden = true;
    }
}

async function getSupabaseConfig() {
    const response = await fetch(configEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar la conexión a la base de datos.');
    const config = await response.json();
    if (!config.url || !config.anonKey) throw new Error('La base de datos todavía no está configurada.');
    return { url: config.url.replace(/\/$/, ''), anonKey: config.anonKey };
}

function applyTheme(theme) {
    const isLight = theme === 'light';
    document.documentElement.classList.toggle('light-theme', isLight);
    document.body.classList.toggle('light-theme', isLight);
    const button = document.getElementById('themeToggleBtn');
    const label = button?.querySelector('.theme-mode-label');
    if (label) label.textContent = isLight ? 'Claro' : 'Oscuro';
    if (button) {
        button.setAttribute('aria-pressed', String(isLight));
        button.setAttribute('aria-label', isLight ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro');
        button.title = isLight ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isLight ? '#eaf5ed' : '#101a2a';
}

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem('beybladex_theme') || 'dark'; } catch { /* Tema oscuro predeterminado. */ }
applyTheme(savedTheme);

document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const nextTheme = document.documentElement.classList.contains('light-theme') ? 'dark' : 'light';
    try { localStorage.setItem('beybladex_theme', nextTheme); } catch { /* Se aplica en esta pestaña. */ }
    applyTheme(nextTheme);
});
window.addEventListener('storage', event => {
    if (event.key === 'beybladex_theme') applyTheme(event.newValue || 'dark');
});

function setAuthNotice(message, kind = '') {
    profileAuthNotice.textContent = message;
    profileAuthNotice.className = `profile-auth-notice ${kind}`.trim();
    profileAuthNotice.hidden = !message;
}

function setAuthMode(mode) {
    const register = mode === 'register';
    document.getElementById('registerForm').hidden = !register;
    document.getElementById('signInForm').hidden = register;
    document.getElementById('registerTab').classList.toggle('active', register);
    document.getElementById('loginTab').classList.toggle('active', !register);
    document.getElementById('registerTab').setAttribute('aria-selected', String(register));
    document.getElementById('loginTab').setAttribute('aria-selected', String(!register));
    setAuthNotice('');
}

function renderAccountButton() {
    const button = document.getElementById('profileAccountButton');
    if (!button) return;
    button.textContent = currentUser ? 'Mi perfil' : 'Perfil';
    button.setAttribute('aria-label', currentUser ? 'Abrir mi cuenta de perfil' : 'Crear perfil o iniciar sesión');
}

async function refreshAccountContext() {
    if (!supabase || !profileDialog) return;
    if (!currentUser) {
        authPanel.hidden = false;
        accountPanel.hidden = true;
        requestProfileButton.hidden = true;
        profileImageControls.hidden = true;
        return;
    }

    authPanel.hidden = true;
    accountPanel.hidden = false;
    setAuthNotice('');
    const [accountResult, requestResult, ownerResult] = await Promise.all([
        supabase.from('player_accounts').select('nickname').eq('user_id', currentUser.id).maybeSingle(),
        supabase.from('player_profile_requests').select('user_id,email,player_key,player_name,status').eq('user_id', currentUser.id).maybeSingle(),
        supabase.from('player_profile_owners').select('user_id,player_key,player_name').eq('user_id', currentUser.id).maybeSingle()
    ]);
    const error = accountResult.error || requestResult.error || ownerResult.error;
    if (error) {
        setAuthNotice('No se pudo cargar el estado de tu perfil. Intenta nuevamente.', 'error');
        return;
    }

    const nickname = accountResult.data?.nickname || currentUser.user_metadata?.nickname || 'Jugador';
    profileAccountSummary.textContent = `${nickname} · ${currentUser.email || ''}`;
    currentProfileRequest = requestResult.data || null;
    currentProfileOwner = ownerResult.data || null;
    requestProfileButton.hidden = true;
    profileImageControls.hidden = true;

    if (currentProfileOwner) {
        const ownsThisProfile = currentProfileOwner.player_key === currentProfileKey;
        profileAccountStatus.textContent = ownsThisProfile
            ? `Este perfil de ${currentProfileOwner.player_name} está vinculado a tu cuenta. Puedes actualizar la foto y el banner.`
            : `Tu cuenta ya está vinculada al perfil de ${currentProfileOwner.player_name}. Solo puedes tener un perfil vinculado.`;
        profileImageControls.hidden = !ownsThisProfile;
        if (ownsThisProfile) {
            document.getElementById('avatarUrlInput').value = currentPublicProfile?.avatar_url || '';
            document.getElementById('bannerUrlInput').value = currentPublicProfile?.banner_url || '';
        }
        return;
    }

    if (currentProfileRequest) {
        const requestedSameProfile = currentProfileRequest.player_key === currentProfileKey;
        const requestedName = currentProfileRequest.player_name;
        const stateText = currentProfileRequest.status === 'pending'
            ? `Solicitud pendiente para ${requestedName}. El administrador debe confirmarla.`
            : currentProfileRequest.status === 'approved'
                ? `La solicitud para ${requestedName} fue aprobada.`
                : `La solicitud para ${requestedName} fue rechazada. Contacta al administrador para resolverlo.`;
        profileAccountStatus.textContent = requestedSameProfile
            ? stateText
            : `${stateText} Solo puedes solicitar un perfil; los alias adicionales se gestionan con el administrador.`;
        return;
    }

    if (!currentProfileKey) {
        profileAccountStatus.textContent = 'Abre el perfil del jugador que quieres vincular a tu cuenta.';
        return;
    }
    if (currentPublicProfile) {
        profileAccountStatus.textContent = 'Este perfil ya está vinculado a una cuenta.';
        return;
    }

    profileAccountStatus.textContent = `Puedes solicitar vincular el perfil de ${currentProfileName} a tu cuenta. Solo se permite una solicitud.`;
    requestProfileButton.textContent = `Solicitar perfil de ${currentProfileName}`;
    requestProfileButton.hidden = false;
}

document.getElementById('profileAccountButton')?.addEventListener('click', async () => {
    setAuthMode('register');
    if (currentUser) await refreshAccountContext();
    if (typeof profileDialog.showModal === 'function') profileDialog.showModal();
    else profileDialog.setAttribute('open', '');
});
document.getElementById('closeProfileDialog')?.addEventListener('click', () => profileDialog.close());
profileDialog?.addEventListener('click', event => {
    if (event.target === profileDialog) profileDialog.close();
});
document.getElementById('registerTab')?.addEventListener('click', () => setAuthMode('register'));
document.getElementById('loginTab')?.addEventListener('click', () => setAuthMode('login'));

document.getElementById('registerForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) return setAuthNotice('La conexión con Supabase aún no está lista.', 'error');
    const nickname = document.getElementById('registerNickname').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { nickname } }
        });
        if (error) throw error;
        currentUser = data.session?.user || null;
        renderAccountButton();
        if (data.session) {
            await refreshAccountContext();
            setAuthNotice('Cuenta creada. Ya puedes solicitar el perfil de un jugador.', 'success');
        } else {
            setAuthMode('login');
            setAuthNotice('Cuenta creada. Revisa tu correo para confirmar la cuenta y luego inicia sesión.', 'success');
        }
    } catch (error) {
        setAuthNotice(error.message || 'No se pudo crear la cuenta.', 'error');
    } finally { submit.disabled = false; }
});

document.getElementById('signInForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) return setAuthNotice('La conexión con Supabase aún no está lista.', 'error');
    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        currentUser = data.user;
        renderAccountButton();
        await refreshAccountContext();
        setAuthNotice('Sesión iniciada.', 'success');
    } catch (error) {
        setAuthNotice(error.message || 'No se pudo iniciar sesión.', 'error');
    } finally { submit.disabled = false; }
});

requestProfileButton?.addEventListener('click', async () => {
    if (!supabase || !currentUser || !currentProfileKey || !currentProfileName) return;
    requestProfileButton.disabled = true;
    try {
        const { error } = await supabase.from('player_profile_requests').insert({
            user_id: currentUser.id,
            email: currentUser.email,
            player_key: currentProfileKey,
            player_name: currentProfileName
        });
        if (error) throw error;
        await refreshAccountContext();
        setAuthNotice('Solicitud enviada. El administrador revisará la vinculación.', 'success');
    } catch (error) {
        setAuthNotice(error.message || 'No se pudo enviar la solicitud.', 'error');
    } finally { requestProfileButton.disabled = false; }
});

async function saveProfileImage(kind) {
    const input = document.getElementById(kind === 'avatar' ? 'avatarUrlInput' : 'bannerUrlInput');
    const button = document.getElementById(kind === 'avatar' ? 'saveAvatarButton' : 'saveBannerButton');
    const rawUrl = input?.value.trim() || '';
    let imageUrl = null;
    if (rawUrl) {
        try {
            const parsedUrl = new URL(rawUrl);
            if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
                throw new Error('El enlace debe ser una URL pública segura que empiece con https://.');
            }
            imageUrl = parsedUrl.href;
        } catch (error) {
            return setAuthNotice(error.message || 'Ingresa un enlace de imagen válido.', 'error');
        }
    }
    if (!currentUser || !currentProfileOwner || currentProfileOwner.player_key !== currentProfileKey || !currentProfileKey) {
        return setAuthNotice('Esta cuenta no es propietaria de este perfil.', 'error');
    }

    button.disabled = true;
    try {
        const column = kind === 'avatar' ? 'avatar_url' : 'banner_url';
        const { data, error } = await supabase.from('player_profiles')
            .update({ [column]: imageUrl })
            .eq('player_key', currentProfileKey)
            .select('player_key,player_name,nickname,avatar_url,banner_url')
            .single();
        if (error) throw error;
        currentPublicProfile = data;
        applyPlayerProfileAssets(data);
        setAuthNotice(imageUrl
            ? (kind === 'avatar' ? 'Enlace de la foto actualizado.' : 'Enlace del banner actualizado.')
            : (kind === 'avatar' ? 'Foto de perfil eliminada.' : 'Banner eliminado.'), 'success');
    } catch (error) {
        setAuthNotice(error.message || 'No se pudo guardar la imagen.', 'error');
    } finally { button.disabled = false; }
}

document.getElementById('saveAvatarButton')?.addEventListener('click', () => saveProfileImage('avatar'));
document.getElementById('saveBannerButton')?.addEventListener('click', () => saveProfileImage('banner'));
document.getElementById('signOutButton')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) return setAuthNotice(error.message, 'error');
    currentUser = null;
    currentProfileOwner = null;
    currentProfileRequest = null;
    renderAccountButton();
    await refreshAccountContext();
    setAuthMode('register');
    setAuthNotice('Sesión cerrada.', 'success');
});

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

async function loadRegisteredPlayerNames(config) {
    const params = new URLSearchParams({ select: 'name', order: 'name.asc', limit: '1000' });
    try {
        const response = await fetch(`${config.url}/rest/v1/players?${params}`, {
            headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` }
        });
        if (!response.ok) return [];
        const rows = await response.json();
        return Array.isArray(rows) ? rows.map(row => row.name).filter(Boolean) : [];
    } catch {
        return [];
    }
}

async function loadPlayerAliases(config) {
    const params = new URLSearchParams({
        select: 'alias_key,alias_name,canonical_key,canonical_name',
        order: 'alias_key.asc'
    });
    const response = await fetch(`${config.url}${aliasesEndpoint}?${params}`, {
        headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` }
    });
    if (!response.ok) throw new Error('No se pudieron cargar los alias de jugadores.');
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
}

function resolvePlayerIdentity(requestedName, aliases) {
    const requestedKey = normalizeName(requestedName);
    const alias = aliases.find(row => normalizeName(row.alias_key) === requestedKey || normalizeName(row.alias_name) === requestedKey);
    const canonicalKey = alias ? normalizeName(alias.canonical_key) : requestedKey;
    const canonicalName = alias?.canonical_name || requestedName;
    const nameKeys = new Set([requestedKey, canonicalKey]);
    aliases.forEach(row => {
        if (normalizeName(row.canonical_key) === canonicalKey) nameKeys.add(normalizeName(row.alias_key));
    });
    const aliasNames = aliases
        .filter(row => normalizeName(row.canonical_key) === canonicalKey)
        .filter(row => normalizeName(row.alias_key) !== canonicalKey)
        .sort((a, b) => String(a.alias_name || '').localeCompare(String(b.alias_name || ''), 'es', { sensitivity: 'base' }))
        .map(row => row.alias_name);
    return { canonicalKey, canonicalName, nameKeys, aliasNames: [...new Set(aliasNames)] };
}

function renderPlayerAliases(aliasNames) {
    playerAliasList.replaceChildren();
    if (!aliasNames.length) {
        playerAliasList.appendChild(makeElement('span', 'profile-alias-empty', 'No hay alias asociados.'));
        return;
    }
    aliasNames.forEach(alias => playerAliasList.appendChild(makeElement('span', 'profile-alias-chip', alias)));
}

function getTournamentPlayer(tournament, nameKeys, canonicalKey) {
    const participants = Array.isArray(tournament.participants) ? tournament.participants : [];
    const standings = Array.isArray(tournament.standings) ? tournament.standings : [];
    const matchedParticipants = participants.filter(player => nameKeys.has(normalizeName(player.name)));
    const matchedStandings = standings.filter(player => nameKeys.has(normalizeName(player.name)));
    const participant = matchedParticipants[0] || matchedStandings[0];
    if (!participant) return null;
    const participantIds = new Set(matchedParticipants.map(player => String(player.id || '')).filter(Boolean));
    const standingRows = matchedStandings;
    const preferredStanding = standingRows.find(player => normalizeName(player.name) === canonicalKey) || standingRows[0] || null;
    const standing = preferredStanding ? {
        ...preferredStanding,
        points: standingRows.reduce((total, row) => total + (Number(row.points) || 0), 0)
    } : null;
    const position = standingRows.length
        ? Math.min(...standingRows.map(row => standings.indexOf(row)).filter(index => index >= 0)) + 1
        : 0;
    const playerIds = new Set([...participantIds, ...(participant.id ? [String(participant.id)] : [])]);
    return { participant, standing, standings, playerIds, position };
}

function getPlayerMatches(tournament, playerInfo, nameKeys) {
    const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
    const { playerIds } = playerInfo;
    const isPlayer = (id, name) => (id && playerIds.has(String(id))) || nameKeys.has(normalizeName(name));
    return matches
        .filter(match => {
            const isA = isPlayer(match.playerAId, match.playerA);
            const isB = isPlayer(match.playerBId, match.playerB);
            return isA || isB;
        })
        .map(match => {
            const isA = isPlayer(match.playerAId, match.playerA);
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

function renderTournament(tournament, nameKeys, canonicalKey, canonicalName) {
    const playerInfo = getTournamentPlayer(tournament, nameKeys, canonicalKey);
    if (!playerInfo) return null;

    const { participant, standing, position } = playerInfo;
    const playerMatches = getPlayerMatches(tournament, playerInfo, nameKeys);
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
        canonicalName,
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
    if (!profiles.length) {
        bestTournamentCard.replaceChildren(
            makeElement('span', 'best-tournament-icon', '🏆'),
            makeElement('div', 'best-tournament-copy', 'Todavía no hay torneos finalizados.')
        );
        return;
    }
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
        supabase = createClient(config.url, config.anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        const { data: sessionData } = await supabase.auth.getSession();
        currentUser = sessionData.session?.user || null;
        renderAccountButton();
        supabase.auth.onAuthStateChange((_event, session) => {
            currentUser = session?.user || null;
            window.setTimeout(() => {
                renderAccountButton();
                refreshAccountContext().catch(error => setAuthNotice(error.message || 'No se pudo cargar tu cuenta.', 'error'));
            }, 0);
        });
        const [tournaments, aliases, registeredPlayers] = await Promise.all([
            loadFinishedTournaments(config),
            loadPlayerAliases(config),
            loadRegisteredPlayerNames(config)
        ]);
        const identity = resolvePlayerIdentity(requestedName, aliases);
        currentProfileKey = identity.canonicalKey;
        currentProfileName = identity.canonicalName;
        const { data: publicProfile, error: publicProfileError } = await supabase.from('player_profiles')
            .select('player_key,player_name,nickname,avatar_url,banner_url')
            .eq('player_key', currentProfileKey)
            .maybeSingle();
        if (publicProfileError) console.warn('No se pudo cargar la imagen del perfil:', publicProfileError);
        currentPublicProfile = publicProfile || null;
        const profiles = tournaments.map(tournament => renderTournament(tournament, identity.nameKeys, identity.canonicalKey, identity.canonicalName)).filter(Boolean);
        const canonicalName = identity.canonicalName;
        playerNameHeading.textContent = canonicalName;
        renderPlayerAliases(identity.aliasNames);
        applyPlayerProfileAssets(currentPublicProfile);
        await refreshAccountContext();
        loadingState.hidden = true;

        const knownPlayer = profiles.length > 0 || Boolean(currentPublicProfile)
            || registeredPlayers.some(name => normalizeName(name) === identity.canonicalKey);
        if (!knownPlayer) {
            showError(`No encontramos torneos finalizados para ${requestedName}.`);
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
        const tournamentContent = profiles.length
            ? profiles.map(profile => profile.details)
            : [makeElement('p', 'profile-empty-matches', 'Todavía no hay torneos finalizados guardados para este jugador.')];
        tournamentList.replaceChildren(makeElement('h2', 'profile-section-title', 'Torneos'), ...tournamentContent);
        tournamentList.hidden = false;
        playerSummary.addEventListener('click', event => {
            const button = event.target.closest('[data-result-filter]');
            if (button) showResultMatches(button.dataset.resultFilter, profiles);
        });
    } catch (error) {
        showError(error.message || 'No se pudo cargar el perfil. Intenta nuevamente.');
    }
}

playerNameToggle.addEventListener('click', () => {
    const expanded = playerNameToggle.getAttribute('aria-expanded') === 'true';
    playerNameToggle.setAttribute('aria-expanded', String(!expanded));
    playerAliasList.hidden = expanded;
});

document.getElementById('closeResultFilter')?.addEventListener('click', () => {
    activeResultFilter = null;
    resultFilterPanel.hidden = true;
    playerSummary.querySelectorAll('[data-result-filter]').forEach(button => button.setAttribute('aria-expanded', 'false'));
});

document.getElementById('backButton')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
});

initializeProfile();
