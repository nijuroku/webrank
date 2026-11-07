const CONFIG_ENDPOINT = '/api/supabase-config';
const SESSION_KEY = 'lamafia_admin_session';
const loginPanel = document.getElementById('loginPanel');
const adminPanel = document.getElementById('adminPanel');
const loginForm = document.getElementById('loginForm');
const notice = document.getElementById('notice');
const logoutButton = document.getElementById('logoutButton');
const aliasForm = document.getElementById('aliasForm');
const aliasInput = document.getElementById('aliasName');
const canonicalSelect = document.getElementById('canonicalName');
const aliasList = document.getElementById('aliasList');
const profileRequestsList = document.getElementById('profileRequestsList');
const tournamentList = document.getElementById('tournamentList');
const activeTournamentList = document.getElementById('activeTournamentList');
const tournamentSubmissionList = document.getElementById('tournamentSubmissionList');
const activityLog = document.getElementById('activityLog');
const refreshButton = document.getElementById('refreshButton');

let config = null;
let session = null;
let tournamentRows = [];

function showNotice(message, kind = '') {
    notice.textContent = message;
    notice.className = `notice ${kind}`.trim();
    notice.hidden = !message;
}

function saveSession(value) {
    session = value;
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
}

function readSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
}

async function loadConfig() {
    const response = await fetch(CONFIG_ENDPOINT, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.url || !data.anonKey) throw new Error(data.error || 'No está configurada la conexión a Supabase.');
    return { url: data.url.replace(/\/$/, ''), anonKey: data.anonKey };
}

async function authRequest(path, body, token) {
    const response = await fetch(`${config.url}/auth/v1/${path}`, {
        method: 'POST',
        headers: {
            apikey: config.anonKey,
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body || {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || result.error || 'Falló la autenticación.');
    return result;
}

async function refreshSession() {
    if (!session?.refresh_token) throw new Error('La sesión expiró. Inicia sesión de nuevo.');
    const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    saveSession({ ...refreshed, expires_at: Date.now() + (Number(refreshed.expires_in) - 30) * 1000 });
    const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.anonKey, Authorization: `Bearer ${session.access_token}` }
    });
    const user = response.ok ? await response.json() : null;
    if (user?.app_metadata?.role !== 'admin') {
        saveSession(null);
        throw new Error('La cuenta ya no tiene permisos de administrador.');
    }
}

async function ensureFreshSession() {
    if (!session?.access_token) throw new Error('Inicia sesión para continuar.');
    if (Number(session.expires_at) <= Date.now()) await refreshSession();
}

async function currentUser() {
    await ensureFreshSession();
    const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.anonKey, Authorization: `Bearer ${session.access_token}` }
    });
    if (!response.ok) throw new Error('La sesión expiró. Inicia sesión de nuevo.');
    return response.json();
}

async function requireAdmin() {
    const user = await currentUser();
    if (user.app_metadata?.role !== 'admin') {
        saveSession(null);
        throw new Error('Esta cuenta no tiene permisos de administrador.');
    }
}

async function dataRequest(path, options = {}) {
    await ensureFreshSession();
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: config.anonKey,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const body = await response.text();
    if (!response.ok) {
        let detail = body;
        try { detail = JSON.parse(body).message || JSON.parse(body).details || body; } catch { /* response is not JSON */ }
        throw new Error(`Supabase ${response.status}: ${detail || response.statusText}`);
    }
    return body ? JSON.parse(body) : null;
}

function normalizeName(value) {
    return String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
}

function capitalizeName(value) {
    const chars = Array.from(String(value || '').trim());
    return chars.length ? chars[0].toLocaleUpperCase() + chars.slice(1).join('') : '';
}

function appendEmpty(container, message) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = message;
    container.replaceChildren(empty);
}

function renderAliases(rows) {
    aliasList.replaceChildren();
    if (!rows.length) return appendEmpty(aliasList, 'Todavía no hay alias vinculados.');
    rows.forEach(alias => {
        const row = document.createElement('div');
        row.className = 'list-row';
        const copy = document.createElement('div');
        copy.className = 'row-copy';
        const title = document.createElement('div');
        title.className = 'row-title';
        title.textContent = alias.alias_name;
        const meta = document.createElement('div');
        meta.className = 'row-meta';
        meta.textContent = `Perfil de ${alias.canonical_name}`;
        copy.append(title, meta);
        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const promote = document.createElement('button');
        promote.type = 'button';
        promote.className = 'button secondary';
        promote.textContent = 'Hacer principal';
        promote.addEventListener('click', () => promoteAlias(alias));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button danger';
        remove.textContent = 'Desvincular';
        remove.addEventListener('click', () => removeAlias(alias));
        actions.append(promote, remove);
        row.append(copy, actions);
        aliasList.appendChild(row);
    });
}

function collectCanonicalNames(players, tournaments, aliases) {
    const names = new Map();
    const add = name => {
        const key = normalizeName(name);
        if (key && !names.has(key)) names.set(key, capitalizeName(name));
    };
    (Array.isArray(players) ? players : []).forEach(player => add(player.name));
    (Array.isArray(tournaments) ? tournaments : []).forEach(tournament => {
        [...(tournament.participants || []), ...(tournament.standings || [])].forEach(player => add(player.name));
    });
    (Array.isArray(aliases) ? aliases : []).forEach(alias => add(alias.canonical_name));
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function renderCanonicalOptions(names) {
    const selected = canonicalSelect.value;
    canonicalSelect.replaceChildren(new Option('Selecciona un jugador', ''));
    names.forEach(name => canonicalSelect.add(new Option(name, name)));
    if (names.includes(selected)) canonicalSelect.value = selected;
}

function renderTournaments(rows) {
    tournamentList.replaceChildren();
    if (!rows.length) return appendEmpty(tournamentList, 'No hay torneos guardados.');
    rows.forEach(tournament => {
        const row = document.createElement('div');
        row.className = 'list-row';
        const copy = document.createElement('div');
        copy.className = 'row-copy';
        const title = document.createElement('div');
        title.className = 'row-title';
        title.textContent = tournament.name || 'Torneo sin nombre';
        const meta = document.createElement('div');
        meta.className = 'row-meta';
        const count = Array.isArray(tournament.participants) ? tournament.participants.length : 0;
        const date = tournament.finished_at ? new Date(tournament.finished_at).toLocaleDateString('es-CL') : 'Sin fecha';
        meta.textContent = `${date} · ${count} participantes${tournament.created_by ? ` · creado por ${tournament.created_by}` : ''}`;
        copy.append(title, meta);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button danger';
        remove.textContent = 'Eliminar';
        remove.addEventListener('click', () => removeTournament(tournament));
        row.append(copy, remove);
        tournamentList.appendChild(row);
    });
}

function renderProfileRequests(rows) {
    profileRequestsList.replaceChildren();
    if (!rows.length) return appendEmpty(profileRequestsList, 'No hay solicitudes pendientes.');
    rows.forEach(request => {
        const row = document.createElement('div');
        row.className = 'list-row';
        const copy = document.createElement('div');
        copy.className = 'row-copy';
        const title = document.createElement('div');
        title.className = 'row-title';
        title.textContent = `${request.player_name} · ${request.status === 'pending' ? 'Pendiente' : request.status === 'approved' ? 'Aprobada' : 'Rechazada'}`;
        const meta = document.createElement('div');
        meta.className = 'row-meta';
        const date = request.created_at ? new Date(request.created_at).toLocaleString('es-CL') : 'Sin fecha';
        meta.textContent = `${request.email} · ${date}`;
        copy.append(title, meta);
        row.appendChild(copy);

        if (request.status === 'pending') {
            const actions = document.createElement('div');
            actions.className = 'row-actions';
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'button primary';
            approve.textContent = 'Aprobar';
            approve.addEventListener('click', () => reviewProfileRequest(request, true));
            const reject = document.createElement('button');
            reject.type = 'button';
            reject.className = 'button danger';
            reject.textContent = 'Rechazar';
            reject.addEventListener('click', () => reviewProfileRequest(request, false));
            actions.append(approve, reject);
            row.appendChild(actions);
        }
        profileRequestsList.appendChild(row);
    });
}

function renderActiveTournaments(rows) {
    activeTournamentList.replaceChildren();
    if (!rows.length) return appendEmpty(activeTournamentList, 'No hay torneos activos compartidos.');
    rows.forEach(tournament => {
        const row = document.createElement('div');
        row.className = 'list-row';
        const copy = document.createElement('div');
        copy.className = 'row-copy';
        const title = document.createElement('div');
        title.className = 'row-title';
        title.textContent = tournament.tournament_name || 'Torneo sin nombre';
        const meta = document.createElement('div');
        meta.className = 'row-meta';
        const participantCount = Array.isArray(tournament.participants) ? tournament.participants.length : 0;
        const expiry = tournament.expires_at ? new Date(tournament.expires_at).toLocaleString('es-CL') : 'Sin vencimiento';
        meta.textContent = `${tournament.phase_label || 'Torneo en curso'} · Ronda ${tournament.current_round || 0} · ${participantCount} participantes · vence ${expiry}`;
        copy.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const shareUrl = new URL('/view/', window.location.origin);
        shareUrl.searchParams.set('id', tournament.id);
        const openLink = document.createElement('a');
        openLink.className = 'button secondary';
        openLink.href = shareUrl.href;
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Ver enlace';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'button danger';
        close.textContent = 'Cerrar torneo';
        close.addEventListener('click', () => closeActiveTournament(tournament));
        actions.append(openLink, close);
        row.append(copy, actions);
        activeTournamentList.appendChild(row);
    });
}

function renderTournamentSubmissions(rows) {
    tournamentSubmissionList.replaceChildren();
    if (!rows.length) return appendEmpty(tournamentSubmissionList, 'No hay torneos en espera de aprobación.');
    rows.forEach(submission => {
        const row = document.createElement('div');
        row.className = 'list-row';
        const copy = document.createElement('div');
        copy.className = 'row-copy';
        const title = document.createElement('div');
        title.className = 'row-title';
        title.textContent = submission.tournament_name || 'Torneo sin nombre';
        const meta = document.createElement('div');
        meta.className = 'row-meta';
        const payload = submission.payload || {};
        const participantCount = Array.isArray(payload.participants) ? payload.participants.length : 0;
        const type = submission.submission_type === 'shared_live' ? 'Enlace en vivo' : 'Tabla final';
        const date = submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('es-CL') : 'Sin fecha';
        meta.textContent = `${type} · ${submission.submitter_name || 'Anónimo'} · ${participantCount} participantes · ${date}`;
        copy.append(title, meta);
        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'button primary';
        approve.textContent = 'Aprobar';
        approve.addEventListener('click', () => reviewTournamentSubmission(submission, true));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'button danger';
        reject.textContent = 'Rechazar';
        reject.addEventListener('click', () => reviewTournamentSubmission(submission, false));
        actions.append(approve, reject);
        row.append(copy, actions);
        tournamentSubmissionList.appendChild(row);
    });
}

function renderActivityLog(rows) {
    activityLog.replaceChildren();
    if (!rows.length) {
        activityLog.textContent = 'Sin actividad registrada.';
        return;
    }
    const descriptions = {
        created: 'creó un torneo',
        approval_requested: 'envió un torneo a revisión',
        approved: 'aprobó un torneo',
        rejected: 'rechazó un torneo',
        published: 'publicó un torneo',
        closed: 'cerró un torneo',
        deleted: 'eliminó una tabla final',
        round_updated: 'actualizó una ronda',
        updated: 'actualizó el torneo'
    };
    rows.forEach(entry => {
        const line = document.createElement('div');
        line.className = 'log-line';
        const time = document.createElement('time');
        time.dateTime = entry.created_at || '';
        time.textContent = entry.created_at ? new Date(entry.created_at).toLocaleString('es-CL') : '';
        const action = document.createElement('span');
        const details = entry.event_type === 'updated' && entry.details
            ? ` (ronda ${entry.details.round || 0} · ${entry.details.participants || 0} participantes · ${entry.details.matches || 0} enfrentamientos)`
            : '';
        action.textContent = `${entry.actor_name || 'Anónimo'} ${descriptions[entry.event_type] || entry.event_type} “${entry.tournament_name || 'Torneo sin nombre'}”${details}.`;
        line.append(time, action);
        activityLog.appendChild(line);
    });
    activityLog.scrollTop = 0;
}

function setAdminListsLoading(loading) {
    const lists = [aliasList, tournamentList, activeTournamentList, tournamentSubmissionList, profileRequestsList];
    if (!loading) {
        lists.forEach(list => list.setAttribute('aria-busy', 'false'));
        activityLog.setAttribute('aria-busy', 'false');
        return;
    }
    lists.forEach(list => {
        list.setAttribute('aria-busy', 'true');
        list.innerHTML = Array.from({ length: 3 }, () => `
            <div class="admin-loading-row" aria-hidden="true">
                <div class="admin-loading-copy"><span class="loading-skeleton skeleton-line medium"></span><span class="loading-skeleton skeleton-line long"></span></div>
                <span class="loading-skeleton admin-loading-action"></span>
            </div>`).join('');
    });
    activityLog.setAttribute('aria-busy', 'true');
    activityLog.innerHTML = Array.from({ length: 5 }, () => '<span class="loading-skeleton admin-loading-log-line" aria-hidden="true"></span>').join('');
}

async function loadAdminData() {
    showNotice('Cargando…');
    setAdminListsLoading(true);
    const params = new URLSearchParams({ select: 'id,name,finished_at,participants,standings,created_by,created_by_user_id', order: 'finished_at.desc', limit: '1000' });
    const activeParams = new URLSearchParams({
        select: 'id,tournament_name,phase_label,current_round,participants,expires_at,updated_at',
        tournament_finished: 'eq.false',
        expires_at: `gt.${new Date().toISOString()}`,
        order: 'updated_at.desc',
        limit: '1000'
    });
    try {
        const [aliases, tournaments, players, profileRequests, activeTournaments, submissions, logs] = await Promise.all([
            dataRequest('player_aliases?select=alias_key,alias_name,canonical_key,canonical_name&order=canonical_name.asc,alias_name.asc'),
            dataRequest(`finished_tournaments?${params}`),
            dataRequest('players?select=name&order=name.asc&limit=1000'),
            dataRequest('player_profile_requests?select=user_id,email,player_key,player_name,status,created_at&order=created_at.desc&limit=1000'),
            dataRequest(`shared_tournaments?${activeParams}`),
            dataRequest('tournament_submissions?select=id,tournament_id,tournament_name,submission_type,payload,share_id,submitter_name,submitted_at&status=eq.pending&order=submitted_at.asc&limit=500'),
            dataRequest('admin_activity_log?select=id,event_type,tournament_id,tournament_name,actor_name,details,created_at&order=created_at.desc&limit=200')
        ]);
        tournamentRows = Array.isArray(tournaments) ? tournaments : [];
        renderAliases(Array.isArray(aliases) ? aliases : []);
        renderCanonicalOptions(collectCanonicalNames(players, tournamentRows, aliases));
        renderProfileRequests(Array.isArray(profileRequests) ? profileRequests : []);
        renderTournaments(tournamentRows);
        renderActiveTournaments(Array.isArray(activeTournaments) ? activeTournaments : []);
        renderTournamentSubmissions(Array.isArray(submissions) ? submissions : []);
        renderActivityLog(Array.isArray(logs) ? logs : []);
        setAdminListsLoading(false);
        showNotice('Datos actualizados.', 'success');
        setTimeout(() => { if (notice.textContent === 'Datos actualizados.') notice.hidden = true; }, 2200);
    } catch (error) {
        [aliasList, tournamentList, activeTournamentList, tournamentSubmissionList, profileRequestsList].forEach(list => {
            list.setAttribute('aria-busy', 'false');
            list.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No se pudieron cargar estos datos. Intenta actualizar.' }));
        });
        activityLog.setAttribute('aria-busy', 'false');
        activityLog.textContent = 'No se pudo cargar el registro de actividad.';
        throw error;
    }
}

async function reviewTournamentSubmission(submission, approve) {
    const action = approve ? 'aprobar y publicar' : 'rechazar';
    if (!confirm(`¿${action} “${submission.tournament_name}” (${submission.submission_type === 'shared_live' ? 'enlace en vivo' : 'tabla final'})?`)) return;
    try {
        await dataRequest('rpc/admin_review_tournament_submission', {
            method: 'POST', body: JSON.stringify({ p_submission_id: submission.id, p_approve: approve })
        });
        showNotice(`Torneo ${approve ? 'aprobado y publicado' : 'rechazado'}.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(`No se pudo ${action} el torneo: ${error.message}`, 'error'); }
}

async function closeActiveTournament(tournament) {
    const name = tournament.tournament_name || 'Torneo sin nombre';
    if (!confirm(`¿Cerrar “${name}”? El enlace público dejará de funcionar y el torneo no podrá volver a publicarse.`)) return;
    try {
        await dataRequest('rpc/admin_close_shared_tournament', {
            method: 'POST',
            body: JSON.stringify({ p_share_id: tournament.id })
        });
        showNotice(`Torneo “${name}” cerrado.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(`No se pudo cerrar el torneo: ${error.message}`, 'error'); }
}

async function reviewProfileRequest(request, approve) {
    const action = approve ? 'aprobar' : 'rechazar';
    const message = approve
        ? `¿Aprobar la vinculación de ${request.player_name} con ${request.email}? El usuario no podrá solicitar otro perfil.`
        : `¿Rechazar la solicitud de ${request.email} para el perfil de ${request.player_name}? No podrá volver a solicitar otro perfil.`;
    if (!confirm(message)) return;
    try {
        await dataRequest('rpc/admin_review_player_profile_request', {
            method: 'POST',
            body: JSON.stringify({ p_user_id: request.user_id, p_approve: approve })
        });
        showNotice(`Solicitud ${approve ? 'aprobada' : 'rechazada'}.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(`No se pudo ${action} la solicitud: ${error.message}`, 'error'); }
}

async function removeAlias(alias) {
    if (!confirm(`¿Desvincular “${alias.alias_name}” del perfil de ${alias.canonical_name}?`)) return;
    try {
        await dataRequest(`player_aliases?alias_key=eq.${encodeURIComponent(alias.alias_key)}`, { method: 'DELETE' });
        showNotice(`Alias “${alias.alias_name}” desvinculado.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(error.message, 'error'); }
}

async function promoteAlias(alias) {
    if (!confirm(`¿Usar “${alias.alias_name}” como nombre principal? “${alias.canonical_name}” pasará a ser alias y el historial se conservará unido.`)) return;
    try {
        await dataRequest('rpc/admin_promote_player_alias', {
            method: 'POST', body: JSON.stringify({ p_alias_key: alias.alias_key })
        });
        showNotice(`“${alias.alias_name}” ahora es el nombre principal.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(error.message, 'error'); }
}

async function removeTournament(tournament) {
    const name = tournament.name || 'Torneo sin nombre';
    if (!confirm(`¿Eliminar permanentemente “${name}” y toda su tabla e historial guardados?`)) return;
    try {
        await dataRequest('rpc/admin_delete_finished_tournament', {
            method: 'POST', body: JSON.stringify({ p_tournament_id: tournament.id })
        });
        showNotice(`Torneo “${name}” eliminado.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(error.message, 'error'); }
}

loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = loginForm.querySelector('[type="submit"]');
    submit.disabled = true;
    showNotice('Iniciando sesión…');
    try {
        const auth = await authRequest('token?grant_type=password', {
            email: document.getElementById('loginEmail').value.trim(),
            password: document.getElementById('loginPassword').value
        });
        saveSession({ ...auth, expires_at: Date.now() + (Number(auth.expires_in) - 30) * 1000 });
        await requireAdmin();
        loginPanel.hidden = true;
        adminPanel.hidden = false;
        logoutButton.hidden = false;
        await loadAdminData();
    } catch (error) {
        saveSession(null);
        loginPanel.hidden = false;
        adminPanel.hidden = true;
        logoutButton.hidden = true;
        showNotice(error.message, 'error');
    } finally { submit.disabled = false; }
});

aliasForm.addEventListener('submit', async event => {
    event.preventDefault();
    const aliasName = capitalizeName(aliasInput.value);
    const canonicalName = canonicalSelect.value;
    const aliasKey = normalizeName(aliasName);
    const canonicalKey = normalizeName(canonicalName);
    if (!aliasKey || !canonicalKey) return showNotice('Completa ambos nombres.', 'error');
    if (aliasKey === canonicalKey) return showNotice('El alias debe ser distinto del nombre principal.', 'error');
    try {
        await dataRequest('player_aliases?on_conflict=alias_key', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ alias_key: aliasKey, alias_name: aliasName, canonical_key: canonicalKey, canonical_name: canonicalName })
        });
        aliasInput.value = '';
        showNotice(`“${aliasName}” ahora está vinculado a ${canonicalName}.`, 'success');
        await loadAdminData();
    } catch (error) { showNotice(error.message, 'error'); }
});

refreshButton.addEventListener('click', () => loadAdminData().catch(error => showNotice(error.message, 'error')));

logoutButton.addEventListener('click', async () => {
    try {
        if (session?.access_token) await authRequest('logout', {}, session.access_token);
    } catch { /* clear the local session even if the network request fails */ }
    saveSession(null);
    loginForm.reset();
    adminPanel.hidden = true;
    loginPanel.hidden = false;
    logoutButton.hidden = true;
    showNotice('Sesión cerrada.');
});

async function initialize() {
    try {
        config = await loadConfig();
        saveSession(readSession());
        if (!session) return;
        await requireAdmin();
        loginPanel.hidden = true;
        adminPanel.hidden = false;
        logoutButton.hidden = false;
        await loadAdminData();
    } catch (error) {
        saveSession(null);
        loginPanel.hidden = false;
        adminPanel.hidden = true;
        showNotice(error.message, 'error');
    }
}

initialize();
