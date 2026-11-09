import { describe, expect, it } from 'vitest';
import {
    createSavedPlayerDirectory,
    resolveSavedPlayerName,
    searchSavedPlayerDirectory,
} from './player-directory';

const directory = createSavedPlayerDirectory(
    [{ id: '1', name: 'Gabriel Boric' }, { id: '2', name: 'Feitan' }, { id: '3', name: 'Adam' }],
    [{ alias_key: 'gabo', alias_name: 'Gabo', canonical_name: 'Gabriel Boric' }]
);

describe('saved player directory', () => {
    it('searches without case sensitivity and returns the canonical player name for aliases', () => {
        expect(searchSavedPlayerDirectory(directory, 'GABO')).toEqual([{ name: 'Gabriel Boric' }]);
        expect(searchSavedPlayerDirectory(directory, 'gabriel')).toContainEqual({ name: 'Gabriel Boric' });
    });

    it('resolves exact player names and aliases to the stored display name', () => {
        expect(resolveSavedPlayerName(directory, 'gAbO')).toBe('Gabriel Boric');
        expect(resolveSavedPlayerName(directory, 'fEitan')).toBe('Feitan');
    });

    it('keeps unknown names intact and trims whitespace', () => {
        expect(resolveSavedPlayerName(directory, '  Jugador Nuevo  ')).toBe('Jugador Nuevo');
    });

    it('deduplicates canonical names and respects the result limit', () => {
        const manyPlayers = createSavedPlayerDirectory(
            [{ name: 'Alba' }, { name: 'Alan' }, { name: 'Alicia' }],
            [{ alias_key: 'ali', alias_name: 'Ali', canonical_name: 'Alicia' }]
        );
        expect(searchSavedPlayerDirectory(manyPlayers, 'al', 2)).toHaveLength(2);
        expect(searchSavedPlayerDirectory(manyPlayers, 'ali')).toEqual([{ name: 'Alicia' }]);
    });
});
