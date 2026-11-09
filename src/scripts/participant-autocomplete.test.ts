import { describe, expect, it } from 'vitest';
import { filterParticipantSuggestions } from './participant-autocomplete';

describe('participant autocomplete results', () => {
    it('removes duplicate and already selected names, then ranks prefix matches first', () => {
        expect(filterParticipantSuggestions([
            { name: 'Gabriel Boric' },
            { name: 'Gabo' },
            { name: 'Adam' },
            { name: 'gabo' }
        ], 'ga', ['Adam'])).toEqual([
            { name: 'Gabo' },
            { name: 'Gabriel Boric' }
        ]);
    });

    it('keeps case insensitive matches and orders matching aliases alphabetically', () => {
        expect(filterParticipantSuggestions([
            { name: 'Gabo' }, { name: 'Gabriel' }
        ], 'GAB', [])).toEqual([{ name: 'Gabo' }, { name: 'Gabriel' }]);
    });
});
