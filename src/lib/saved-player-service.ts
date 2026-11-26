import {
    createSavedPlayerDirectory,
    resolveSavedPlayerName,
    searchSavedPlayerDirectory,
    type PlayerAliasRow,
    type SavedPlayerDirectory,
    type SavedPlayerRow
} from './player-directory';

export type SupabaseRowRequest = (path: string, options?: RequestInit) => Promise<unknown>;

export async function fetchAllSupabaseRows(
    request: SupabaseRowRequest,
    path: string,
    pageSize = 500
): Promise<unknown[]> {
    if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('El tamaño de página debe ser un entero positivo.');
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += pageSize) {
        const page = await request(path, { headers: { Range: `${offset}-${offset + pageSize - 1}` } });
        if (!Array.isArray(page)) break;
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows;
}

function toPlayerRows(rows: unknown[]): SavedPlayerRow[] {
    return rows.flatMap(row => {
        if (!row || typeof row !== 'object') return [];
        const value = row as { id?: unknown; name?: unknown };
        if (typeof value.name !== 'string' || !value.name.trim()) return [];
        const id = typeof value.id === 'string' || typeof value.id === 'number' ? value.id : undefined;
        return [{ id, name: value.name }];
    });
}

function toAliasRows(rows: unknown[]): PlayerAliasRow[] {
    return rows.flatMap(row => {
        if (!row || typeof row !== 'object') return [];
        const value = row as Record<string, unknown>;
        return [{
            alias_key: typeof value.alias_key === 'string' ? value.alias_key : null,
            alias_name: typeof value.alias_name === 'string' ? value.alias_name : null,
            canonical_name: typeof value.canonical_name === 'string' ? value.canonical_name : null
        }];
    });
}

export class SavedPlayerService {
    private directory: SavedPlayerDirectory | null = null;
    private cacheExpiresAt = 0;
    private pending: Promise<SavedPlayerDirectory> | null = null;
    private generation = 0;

    constructor(
        private readonly request: SupabaseRowRequest,
        private readonly cacheDurationMs = 60_000,
        private readonly now: () => number = Date.now
    ) {}

    async getDirectory(): Promise<SavedPlayerDirectory> {
        if (this.directory && this.now() < this.cacheExpiresAt) return this.directory;
        if (this.pending) return this.pending;

        const generation = this.generation;
        const load = Promise.all([
            fetchAllSupabaseRows(this.request, '/rest/v1/players?select=id,name&order=name.asc'),
            fetchAllSupabaseRows(this.request, '/rest/v1/player_aliases?select=alias_key,alias_name,canonical_name&order=alias_key.asc')
        ]).then(([players, aliases]) => {
            const directory = createSavedPlayerDirectory(toPlayerRows(players), toAliasRows(aliases));
            if (generation === this.generation) {
                this.directory = directory;
                this.cacheExpiresAt = this.now() + this.cacheDurationMs;
            }
            return directory;
        }).finally(() => {
            if (this.pending === load) this.pending = null;
        });

        this.pending = load;
        return load;
    }

    async search(query: string, limit = 12) {
        return searchSavedPlayerDirectory(await this.getDirectory(), query, limit);
    }

    async resolveName(input: string): Promise<string> {
        return resolveSavedPlayerName(await this.getDirectory(), input);
    }

    async resolveNameOrOriginal(input: string, onError?: (error: unknown) => void): Promise<string> {
        const typedName = String(input ?? '').trim();
        if (!typedName) return typedName;
        try {
            return await this.resolveName(typedName);
        } catch (error) {
            onError?.(error);
            return typedName;
        }
    }

    invalidate(): void {
        this.generation++;
        this.directory = null;
        this.cacheExpiresAt = 0;
        this.pending = null;
    }
}
