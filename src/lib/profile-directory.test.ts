import { describe, expect, it } from 'vitest';
import { buildDirectoryPlayers, normalizeDirectoryTerm, searchProfileDirectory } from './profile-directory';

describe('profile directory', () => {
    const aliases = [
        { alias_key: 'jose', alias_name: 'José', canonical_key: 'jose miguel', canonical_name: 'José Miguel' },
        { alias_key: 'jm', alias_name: 'JM', canonical_key: 'jose miguel', canonical_name: 'José Miguel' }
    ];

    it('normalizes case, compatibility characters and accents for search', () => {
        expect(normalizeDirectoryTerm('  JOSÉ  ')).toBe('jose');
    });

    it('deduplicates a player by canonical identity and sorts by display name', () => {
        const directory = buildDirectoryPlayers(['JM', 'José Miguel', 'Alba'], aliases);
        expect(directory.map(player => player.canonicalName)).toEqual(['Alba', 'José Miguel']);
    });

    it('finds a canonical profile by alias and retains the principal display name', () => {
        const directory = buildDirectoryPlayers(['JM', 'Ana'], aliases);
        expect(searchProfileDirectory(directory, 'jose')).toHaveLength(1);
        expect(searchProfileDirectory(directory, 'JOSE')[0]?.canonicalName).toBe('José Miguel');
    });

    it('returns the full ordered directory for an empty search', () => {
        const directory = buildDirectoryPlayers(['Zeta', 'Adam'], []);
        expect(searchProfileDirectory(directory, ' ')).toEqual(directory);
    });
});
