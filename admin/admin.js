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
const tournamentList = document.getElementById('tournamentList');
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
        meta.textContent = `${date} · ${count} participantes`;
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

async function loadAdminData() {
    showNotice('Cargando…');
    const params = new URLSearchParams({ select: 'id,name,finished_at,participants,standings', order: 'finished_at.desc', limit: '1000' });
    const [aliases, tournaments, players] = await Promise.all([
        dataRequest('player_aliases?select=alias_key,alias_name,canonical_key,canonical_name&order=canonical_name.asc,alias_name.asc'),
        dataRequest(`finished_tournaments?${params}`),
        dataRequest('players?select=name&order=name.asc&limit=1000')
    ]);
    tournamentRows = Array.isArray(tournaments) ? tournaments : [];
    renderAliases(Array.isArray(aliases) ? aliases : []);
    renderCanonicalOptions(collectCanonicalNames(players, tournamentRows, aliases));
    renderTournaments(tournamentRows);
    showNotice('Datos actualizados.', 'success');
    setTimeout(() => { if (notice.textContent === 'Datos actualizados.') notice.hidden = true; }, 2200);
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
        const rows = await dataRequest(`finished_tournaments?id=eq.${encodeURIComponent(tournament.id)}&select=id`, {
            method: 'DELETE', headers: { Prefer: 'return=representation' }
        });
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('No se eliminó el torneo. Revisa tus permisos y vuelve a actualizar.');
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
