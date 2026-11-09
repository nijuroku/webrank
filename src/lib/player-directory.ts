export interface SavedPlayerRow {
    id?: string | number;
    name?: string | null;
}

export interface PlayerAliasRow {
    alias_key?: string | null;
    alias_name?: string | null;
    canonical_name?: string | null;
}

export interface SavedPlayerDirectory {
    players: SavedPlayerRow[];
    aliases: PlayerAliasRow[];
    playersByKey: Map<string, SavedPlayerRow>;
    aliasesByKey: Map<string, PlayerAliasRow>;
}

export function normalizePlayerLookupTerm(value: unknown): string {
    return String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase();
}

export function createSavedPlayerDirectory(
    players: SavedPlayerRow[],
    aliases: PlayerAliasRow[]
): SavedPlayerDirectory {
    const playersByKey = new Map<string, SavedPlayerRow>();
    const aliasesByKey = new Map<string, PlayerAliasRow>();

    for (const player of players) {
        const key = normalizePlayerLookupTerm(player.name);
        if (key) playersByKey.set(key, player);
    }
    for (const alias of aliases) {
        for (const key of [alias.alias_key, alias.alias_name]) {
            const normalizedKey = normalizePlayerLookupTerm(key);
            if (normalizedKey) aliasesByKey.set(normalizedKey, alias);
        }
    }

    return { players, aliases, playersByKey, aliasesByKey };
}

export function searchSavedPlayerDirectory(
    directory: SavedPlayerDirectory,
    query: string,
    limit = 12
): Array<{ name: string }> {
    const normalizedQuery = normalizePlayerLookupTerm(query);
    if (normalizedQuery.length < 2 || limit <= 0) return [];

    const suggestions = new Map<string, { name: string; startsWithQuery: boolean }>();
    const addSuggestion = (rawName: unknown) => {
        const name = String(rawName ?? '').trim();
        const key = normalizePlayerLookupTerm(name);
        if (!name || !key || suggestions.has(key)) return;
        suggestions.set(key, { name, startsWithQuery: key.startsWith(normalizedQuery) });
    };

    for (const player of directory.players) {
        const playerName = String(player.name ?? '').trim();
        const canonical = directory.aliasesByKey.get(normalizePlayerLookupTerm(playerName))?.canonical_name || playerName;
        if (normalizePlayerLookupTerm(playerName).includes(normalizedQuery) || normalizePlayerLookupTerm(canonical).includes(normalizedQuery)) {
            addSuggestion(canonical);
        }
    }

    for (const alias of directory.aliases) {
        const matchesAlias = [alias.alias_name, alias.alias_key]
            .some(term => normalizePlayerLookupTerm(term).includes(normalizedQuery));
        if (matchesAlias) addSuggestion(alias.canonical_name);
    }

    return [...suggestions.values()]
        .sort((a, b) => Number(b.startsWithQuery) - Number(a.startsWithQuery) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .slice(0, limit)
        .map(({ name }) => ({ name }));
}

export function resolveSavedPlayerName(directory: SavedPlayerDirectory, input: string): string {
    const name = String(input ?? '').trim();
    const key = normalizePlayerLookupTerm(name);
    if (!key) return name;
    const alias = directory.aliasesByKey.get(key);
    if (alias?.canonical_name) return alias.canonical_name.trim();
    return String(directory.playersByKey.get(key)?.name || name).trim();
}
