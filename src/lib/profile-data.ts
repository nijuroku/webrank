import { fetchWithTimeout } from './fetch-with-timeout';
import type { PlayerAliasRecord, TournamentMatchRecord, TournamentPlayerRecord } from './profile-history';

export interface ProfileSupabaseConfig {
    url: string;
    anonKey: string;
}

export interface FinishedTournamentRecord {
    id: string;
    name?: string | null;
    finished_at?: string | null;
    participants?: TournamentPlayerRecord[];
    standings?: TournamentPlayerRecord[];
    matches?: TournamentMatchRecord[];
    tournament_format?: string | null;
    swiss_byes?: Array<string | number>;
    winner?: string | TournamentPlayerRecord | null;
    podium?: Record<string, string | TournamentPlayerRecord> | null;
}

export interface SupabaseFetch {
    (input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number): Promise<Response>;
}

const PAGE_SIZE = 1000;
const TOURNAMENTS_PATH = '/rest/v1/finished_tournaments';

export async function loadSupabaseConfig(
    endpoint = '/api/supabase-config',
    request: SupabaseFetch = fetchWithTimeout
): Promise<ProfileSupabaseConfig> {
    const response = await request(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar la conexión a la base de datos.');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new Error('La base de datos todavía no está configurada.');
    const config = data as { url?: unknown; anonKey?: unknown };
    if (typeof config.url !== 'string' || typeof config.anonKey !== 'string' || !config.url || !config.anonKey) {
        throw new Error('La base de datos todavía no está configurada.');
    }
    return { url: config.url.replace(/\/$/, ''), anonKey: config.anonKey };
}

async function loadPagedRows<T>(
    config: ProfileSupabaseConfig,
    path: string,
    columns: string,
    errorMessage: string,
    request: SupabaseFetch
): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const params = new URLSearchParams({ select: columns, order: 'finished_at.desc' });
        const response = await request(`${config.url}${path}?${params}`, {
            headers: {
                apikey: config.anonKey,
                Authorization: `Bearer ${config.anonKey}`,
                Range: `${offset}-${offset + PAGE_SIZE - 1}`
            }
        });
        if (!response.ok) throw new Error(errorMessage);
        const page: unknown = await response.json();
        if (!Array.isArray(page)) break;
        rows.push(...page as T[]);
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}

export function collectFinishedTournamentPlayerNames(tournaments: readonly Pick<FinishedTournamentRecord, 'participants' | 'standings' | 'winner' | 'podium'>[]): string[] {
    const names: string[] = [];
    const addName = (value: unknown): void => {
        const name = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { name?: unknown }).name : null;
        if (typeof name === 'string' && name.trim()) names.push(name.trim());
    };

    tournaments.forEach(tournament => {
        (Array.isArray(tournament.participants) ? tournament.participants : []).forEach(addName);
        (Array.isArray(tournament.standings) ? tournament.standings : []).forEach(addName);
        addName(tournament.winner);
        if (tournament.podium && typeof tournament.podium === 'object') Object.values(tournament.podium).forEach(addName);
    });
    return names;
}

export async function loadFinishedTournaments(
    config: ProfileSupabaseConfig,
    request: SupabaseFetch = fetchWithTimeout
): Promise<FinishedTournamentRecord[]> {
    return loadPagedRows<FinishedTournamentRecord>(
        config,
        TOURNAMENTS_PATH,
        'id,name,finished_at,participants,standings,matches,tournament_format,swiss_byes,winner,podium',
        'No se pudieron cargar los torneos guardados.',
        request
    );
}

export async function loadRegisteredPlayerNames(
    config: ProfileSupabaseConfig,
    request: SupabaseFetch = fetchWithTimeout,
    throwOnError = false
): Promise<string[]> {
    try {
        const names: string[] = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const params = new URLSearchParams({ select: 'name', order: 'name.asc' });
            const response = await request(`${config.url}/rest/v1/players?${params}`, {
                headers: {
                    apikey: config.anonKey,
                    Authorization: `Bearer ${config.anonKey}`,
                    Range: `${offset}-${offset + PAGE_SIZE - 1}`
                }
            });
            if (!response.ok) throw new Error('No se pudieron cargar los jugadores guardados.');
            const rows: unknown = await response.json();
            if (!Array.isArray(rows)) break;
            names.push(...rows.map(row => (row as { name?: unknown }).name)
                .filter((name): name is string => typeof name === 'string' && Boolean(name)));
            if (rows.length < PAGE_SIZE) break;
        }
        return names;
    } catch (error) {
        if (throwOnError) throw error;
        return [];
    }
}

export async function loadFinishedTournamentPlayerNames(
    config: ProfileSupabaseConfig,
    request: SupabaseFetch = fetchWithTimeout
): Promise<string[]> {
    const tournaments = await loadPagedRows<Pick<FinishedTournamentRecord, 'participants' | 'standings' | 'winner' | 'podium'>>(
        config,
        TOURNAMENTS_PATH,
        'participants,standings,winner,podium',
        'No se pudieron cargar los jugadores de los torneos finalizados.',
        request
    );
    return collectFinishedTournamentPlayerNames(tournaments);
}

export async function loadPlayerAliases(
    config: ProfileSupabaseConfig,
    request: SupabaseFetch = fetchWithTimeout
): Promise<PlayerAliasRecord[]> {
    const rows: PlayerAliasRecord[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const params = new URLSearchParams({ select: 'alias_key,alias_name,canonical_key,canonical_name', order: 'alias_key.asc' });
        const response = await request(`${config.url}/rest/v1/player_aliases?${params}`, {
            headers: {
                apikey: config.anonKey,
                Authorization: `Bearer ${config.anonKey}`,
                Range: `${offset}-${offset + PAGE_SIZE - 1}`
            }
        });
        if (!response.ok) throw new Error('No se pudieron cargar los alias de jugadores.');
        const page: unknown = await response.json();
        if (!Array.isArray(page)) break;
        rows.push(...page as PlayerAliasRecord[]);
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}
