export interface ProfileDirectoryAlias {
    alias_key?: string | null;
    alias_name?: string | null;
    canonical_key?: string | null;
    canonical_name?: string | null;
}

export interface ProfileDirectoryPlayer {
    canonicalKey: string;
    canonicalName: string;
    searchTerms: Set<string>;
}

export function normalizeDirectoryTerm(value: unknown): string {
    return String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function buildDirectoryPlayers(playerNames: readonly unknown[], aliases: readonly ProfileDirectoryAlias[]): ProfileDirectoryPlayer[] {
    const byCanonicalKey = new Map<string, ProfileDirectoryPlayer>();
    const getEntry = (canonicalKey: string, canonicalName: string): ProfileDirectoryPlayer => {
        let entry = byCanonicalKey.get(canonicalKey);
        if (!entry) {
            entry = { canonicalKey, canonicalName: canonicalName.trim(), searchTerms: new Set() };
            byCanonicalKey.set(canonicalKey, entry);
        } else if (canonicalName && canonicalName.length > entry.canonicalName.length) {
            entry.canonicalName = canonicalName.trim();
        }
        entry.searchTerms.add(entry.canonicalName);
        entry.searchTerms.add(entry.canonicalKey);
        return entry;
    };

    const aliasByNameKey = new Map<string, ProfileDirectoryAlias>();
    aliases.forEach(alias => {
        const aliasKey = normalizeDirectoryTerm(alias.alias_key);
        const aliasName = normalizeDirectoryTerm(alias.alias_name);
        if (aliasKey) aliasByNameKey.set(aliasKey, alias);
        if (aliasName) aliasByNameKey.set(aliasName, alias);

        const canonicalKey = normalizeDirectoryTerm(alias.canonical_key || alias.canonical_name);
        const canonicalName = String(alias.canonical_name || '').trim();
        if (!canonicalKey || !canonicalName) return;
        const entry = getEntry(canonicalKey, canonicalName);
        if (alias.alias_name?.trim()) entry.searchTerms.add(alias.alias_name.trim());
        if (alias.alias_key?.trim()) entry.searchTerms.add(alias.alias_key.trim());
    });

    playerNames.forEach(rawName => {
        const name = String(rawName ?? '').trim();
        if (!name) return;
        const nameKey = normalizeDirectoryTerm(name);
        const alias = aliasByNameKey.get(nameKey);
        const canonicalName = String(alias?.canonical_name || name).trim();
        const canonicalKey = normalizeDirectoryTerm(alias?.canonical_key || canonicalName);
        if (!canonicalKey) return;
        const entry = getEntry(canonicalKey, canonicalName);
        entry.searchTerms.add(name);
        if (alias?.alias_name?.trim()) entry.searchTerms.add(alias.alias_name.trim());
        if (alias?.alias_key?.trim()) entry.searchTerms.add(alias.alias_key.trim());
    });

    return [...byCanonicalKey.values()].sort((a, b) =>
        a.canonicalName.localeCompare(b.canonicalName, 'es', { sensitivity: 'base', numeric: true })
    );
}

export function searchProfileDirectory(
    players: readonly ProfileDirectoryPlayer[],
    query: string
): ProfileDirectoryPlayer[] {
    const normalizedQuery = normalizeDirectoryTerm(query);
    if (!normalizedQuery) return [...players];
    return players.filter(player => [...player.searchTerms].some(term => normalizeDirectoryTerm(term).includes(normalizedQuery)));
}
