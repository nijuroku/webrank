import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout';
import { getBestTournamentProfile, getPlayerMatches, getProfileCareerStats, getTournamentPlayer, resolvePlayerIdentity } from '../lib/profile-history';
import { buildDirectoryPlayers, searchProfileDirectory } from '../lib/profile-directory';
import {
    loadFinishedTournamentPlayerNames,
    loadFinishedTournaments,
    loadPlayerAliases,
    loadRegisteredPlayerNames,
    loadSupabaseConfig
} from '../lib/profile-data';

const configEndpoint = '/api/supabase-config';
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
const accountRoutePanel = document.getElementById('accountRoutePanel');
const accountRouteMessage = document.getElementById('accountRouteMessage');
const accountRouteActions = document.getElementById('accountRouteActions');
const accountRouteOwnProfileButton = document.getElementById('accountRouteOwnProfileButton');
const profileDirectory = document.getElementById('profileDirectory');
const profileDirectorySearch = document.getElementById('profileDirectorySearch');
const profileDirectoryLoading = document.getElementById('profileDirectoryLoading');
const profileDirectoryGrid = document.getElementById('profileDirectoryGrid');
const profileDirectoryStatus = document.getElementById('profileDirectoryStatus');
const profileDirectoryCount = document.getElementById('profileDirectoryCount');
const profileBanner = document.getElementById('playerBanner');
const profileDialog = document.getElementById('profileDialog');
const authPanel = document.getElementById('authPanel');
const accountPanel = document.getElementById('accountPanel');
const profileAuthNotice = document.getElementById('profileAuthNotice');
const profileAccountSummary = document.getElementById('profileAccountSummary');
const profileAccountStatus = document.getElementById('profileAccountStatus');
const profileLinkButton = document.getElementById('profileLinkButton');
const profileLinkNotice = document.getElementById('profileLinkNotice');
const profileImageControls = document.getElementById('profileImageControls');
let activeResultFilter = null;
let accountRouteMode = false;
let supabase = null;
let currentUser = null;
let currentProfileKey = null;
let currentProfileName = null;
let currentPublicProfile = null;
let currentProfileRequest = null;
let currentProfileOwner = null;
let directoryPlayers = [];

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

function openProfileDialog(mode = 'register') {
    setAuthMode(mode);
    if (typeof profileDialog.showModal === 'function') profileDialog.showModal();
    else profileDialog.setAttribute('open', '');
}

function showProfileLinkNotice(message, kind = '') {
    if (!profileLinkNotice) return;
    profileLinkNotice.textContent = message;
    profileLinkNotice.className = `profile-link-notice ${kind}`.trim();
    profileLinkNotice.hidden = !message;
}

function goToOwnProfile() {
    if (!currentProfileOwner?.player_name) return false;
    window.location.assign(`/p/${encodeURIComponent(currentProfileOwner.player_name)}`);
    return true;
}

async function refreshAccountContext() {
    if (!supabase || !profileDialog) return;
    if (!currentUser) {
        authPanel.hidden = false;
        accountPanel.hidden = true;
        profileLinkButton.hidden = !currentProfileKey;
        profileImageControls.hidden = true;
        document.getElementById('goToOwnProfileButton').hidden = true;
        accountRouteActions.hidden = false;
        accountRouteOwnProfileButton.hidden = true;
        if (accountRouteMode) accountRouteMessage.textContent = 'Crea una cuenta o inicia sesión para vincular tu perfil de jugador.';
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
    profileLinkButton.hidden = true;
    profileImageControls.hidden = true;
    const hasOwnProfile = Boolean(currentProfileOwner?.player_name);
    document.getElementById('goToOwnProfileButton').hidden = !hasOwnProfile;
    accountRouteActions.hidden = Boolean(currentUser);
    accountRouteOwnProfileButton.hidden = !hasOwnProfile;

    if (currentProfileOwner) {
        const ownsThisProfile = currentProfileOwner.player_key === currentProfileKey;
        profileAccountStatus.textContent = ownsThisProfile
            ? `Este perfil de ${currentProfileOwner.player_name} está vinculado a tu cuenta. Puedes actualizar la foto y el banner.`
            : `Tu cuenta ya está vinculada al perfil de ${currentProfileOwner.player_name}. Solo puedes tener un perfil vinculado.`;
        if (accountRouteMode) accountRouteMessage.textContent = `Tu perfil está vinculado a ${currentProfileOwner.player_name}.`;
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
        if (accountRouteMode) accountRouteMessage.textContent = `${stateText} Abre el perfil del jugador para consultar su estado.`;
        return;
    }

    if (!currentProfileKey) {
        profileAccountStatus.textContent = 'Abre el perfil del jugador que quieres vincular a tu cuenta.';
        if (accountRouteMode) accountRouteMessage.textContent = 'Abre el perfil del jugador que quieres vincular a tu cuenta. La solicitud se inicia desde el botón de la esquina superior derecha de ese perfil.';
        return;
    }
    if (currentPublicProfile) {
        profileAccountStatus.textContent = 'Este perfil ya está vinculado a una cuenta.';
        if (accountRouteMode) accountRouteMessage.textContent = 'Este perfil ya está vinculado a una cuenta. Si es tuyo, inicia sesión con la cuenta que lo reclamó.';
        return;
    }

    profileAccountStatus.textContent = `Puedes solicitar vincular el perfil de ${currentProfileName} a tu cuenta. Solo se permite una solicitud.`;
    profileLinkButton.hidden = false;
    profileLinkButton.setAttribute('aria-label', `Solicitar vinculación del perfil de ${currentProfileName}`);
    profileLinkButton.title = `Solicitar vinculación del perfil de ${currentProfileName}`;
    if (accountRouteMode) accountRouteMessage.textContent = `Abre el perfil de ${currentProfileName} y solicita la vinculación desde el botón de la esquina superior derecha.`;
}

document.getElementById('profileAccountButton')?.addEventListener('click', async () => {
    if (currentUser && currentProfileOwner && goToOwnProfile()) return;
    if (currentUser) await refreshAccountContext();
    openProfileDialog(currentUser ? 'login' : 'register');
});
document.getElementById('closeProfileDialog')?.addEventListener('click', () => profileDialog.close());
profileDialog?.addEventListener('click', event => {
    if (event.target === profileDialog) profileDialog.close();
});
document.getElementById('registerTab')?.addEventListener('click', () => setAuthMode('register'));
document.getElementById('loginTab')?.addEventListener('click', () => setAuthMode('login'));
document.getElementById('accountRouteRegisterButton')?.addEventListener('click', () => openProfileDialog('register'));
document.getElementById('accountRouteLoginButton')?.addEventListener('click', () => openProfileDialog('login'));
document.getElementById('accountRouteOwnProfileButton')?.addEventListener('click', goToOwnProfile);
document.getElementById('goToOwnProfileButton')?.addEventListener('click', goToOwnProfile);

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

profileLinkButton?.addEventListener('click', async () => {
    if (!currentUser) {
        openProfileDialog('register');
        return;
    }
    if (!supabase || !currentProfileKey || !currentProfileName) return;
    if (currentProfileOwner || currentProfileRequest || currentPublicProfile) {
        showProfileLinkNotice(profileAccountStatus.textContent || 'Este perfil no está disponible para solicitar.', 'error');
        return;
    }
    profileLinkButton.disabled = true;
    try {
        const { error } = await supabase.from('player_profile_requests').insert({
            user_id: currentUser.id,
            email: currentUser.email,
            player_key: currentProfileKey,
            player_name: currentProfileName
        });
        if (error) throw error;
        await refreshAccountContext();
        showProfileLinkNotice('Solicitud enviada. El administrador revisará la vinculación.', 'success');
    } catch (error) {
        showProfileLinkNotice(error.message || 'No se pudo enviar la solicitud.', 'error');
    } finally { profileLinkButton.disabled = false; }
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

function renderDirectoryResults() {
    if (!profileDirectoryGrid) return;
    const query = profileDirectorySearch?.value || '';
    const filteredPlayers = searchProfileDirectory(directoryPlayers, query);
    profileDirectoryGrid.replaceChildren();
    filteredPlayers.forEach(player => {
        const card = makeElement('a', 'profile-directory-card');
        card.href = `/p/${encodeURIComponent(player.canonicalName)}`;
        card.setAttribute('aria-label', `Ver perfil de ${player.canonicalName}`);
        const avatar = makeElement('span', 'profile-directory-avatar', Array.from(player.canonicalName)[0]?.toLocaleUpperCase() || '?');
        avatar.setAttribute('aria-hidden', 'true');
        const copy = makeElement('span', 'profile-directory-copy');
        copy.append(makeElement('strong', '', player.canonicalName), makeElement('small', '', 'Ver perfil de jugador'));
        const arrow = makeElement('span', 'profile-directory-arrow', '›');
        arrow.setAttribute('aria-hidden', 'true');
        card.append(avatar, copy, arrow);
        profileDirectoryGrid.appendChild(card);
    });
    profileDirectoryGrid.hidden = false;
    profileDirectoryCount.textContent = `${filteredPlayers.length} ${filteredPlayers.length === 1 ? 'perfil' : 'perfiles'}`;
    profileDirectoryStatus.textContent = filteredPlayers.length
        ? ''
        : query ? 'No encontramos perfiles con ese nombre o alias.' : 'Todavía no hay perfiles registrados.';
}

async function loadProfileDirectory(config) {
    const [playerRows, aliases, tournamentPlayerNames] = await Promise.all([
        loadRegisteredPlayerNames(config, undefined, true),
        loadPlayerAliases(config),
        loadFinishedTournamentPlayerNames(config)
    ]);
    directoryPlayers = buildDirectoryPlayers(
        [...playerRows, ...tournamentPlayerNames],
        aliases
    );
    profileDirectoryLoading.hidden = true;
    renderDirectoryResults();
}

function showProfileDirectoryError() {
    profileDirectoryLoading.hidden = true;
    profileDirectoryGrid.hidden = true;
    profileDirectoryCount.textContent = '';
    profileDirectoryStatus.textContent = 'No pudimos cargar los perfiles. Actualiza la página para volver a intentarlo.';
}

function renderPlayerAliases(aliasNames) {
    playerAliasList.replaceChildren();
    if (!aliasNames.length) {
        playerAliasList.appendChild(makeElement('span', 'profile-alias-empty', 'No hay alias asociados.'));
        return;
    }
    aliasNames.forEach(alias => playerAliasList.appendChild(makeElement('span', 'profile-alias-chip', alias)));
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

    const { standing, position } = playerInfo;
    const playerMatches = getPlayerMatches(
        Array.isArray(tournament.matches) ? tournament.matches : [],
        playerInfo.playerIds,
        nameKeys
    );
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
    const best = getBestTournamentProfile(profiles);
    if (!best) {
        bestTournamentCard.replaceChildren(
            makeElement('span', 'best-tournament-icon', '🏆'),
            makeElement('div', 'best-tournament-copy', 'Todavía no hay torneos finalizados.')
        );
        return;
    }
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
    const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
    accountRouteMode = new URLSearchParams(window.location.search).get('account') === '1' || normalizedPath === '/p';
    if (!targetName && !accountRouteMode) {
        showError('No se especificó el nombre del jugador.');
        return;
    }

    if (targetName) playerNameHeading.textContent = requestedName;
    try {
        const config = await loadSupabaseConfig(configEndpoint);
        supabase = createClient(config.url, config.anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
            global: { fetch: (input, init) => fetchWithTimeout(input, init, 15_000) }
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
        if (accountRouteMode) {
            accountRoutePanel.hidden = false;
            profileDirectory.hidden = false;
            loadingState.hidden = true;
            profileCard.hidden = true;
            resultFilterPanel.hidden = true;
            tournamentList.hidden = true;
            await Promise.all([
                loadProfileDirectory(config).catch(error => {
                    console.error('No se pudo cargar el directorio de perfiles:', error);
                    showProfileDirectoryError();
                }),
                refreshAccountContext().catch(error => setAuthNotice(error.message || 'No se pudo cargar tu cuenta.', 'error'))
            ]);
            return;
        }
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

        const summary = getProfileCareerStats(profiles);
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

let directorySearchTimer = 0;
profileDirectorySearch?.addEventListener('input', () => {
    window.clearTimeout(directorySearchTimer);
    directorySearchTimer = window.setTimeout(renderDirectoryResults, 140);
});

initializeProfile();
