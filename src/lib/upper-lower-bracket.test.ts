import { describe, expect, it } from 'vitest';
import { createBracketRound, getCrossBracketFinals, resolveBracketRound, type BracketMatch, type BracketPlayer } from './upper-lower-bracket';

const players: BracketPlayer[] = [
    { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' },
    { id: 'd', name: 'Delta' }, { id: 'e', name: 'Epsilon' }
];

describe('upper/lower elimination helpers', () => {
    it('creates a bye for odd-sized phases and marks the two-player final', () => {
        const oddRound = createBracketRound(players, 'upper', 1, 10, () => 0);
        expect(oddRound.matches).toHaveLength(2);
        expect(oddRound.byes).toHaveLength(1);
        expect(oddRound.matches.every(match => match.bracket === 'upper' && !match.bracketFinal)).toBe(true);

        const final = createBracketRound(players.slice(0, 2), 'lower', 3, 20, () => 0);
        expect(final.matches[0].bracketFinal).toBe(true);

        const oneMatchAndBye = createBracketRound(players.slice(0, 3), 'upper', 2, 30, () => 0);
        expect(oneMatchAndBye.matches).toHaveLength(1);
        expect(oneMatchAndBye.byes).toHaveLength(1);
        expect(oneMatchAndBye.matches[0].bracketFinal).toBeUndefined();
    });

    it('resolves winners and drop-down players separately for the next lower phase', () => {
        const round = createBracketRound(players.slice(0, 4), 'upper', 1, 1, () => 0);
        const winnersByName = new Set(['Alpha', 'Gamma']);
        const results = resolveBracketRound(round.matches.map(match => ({
            ...match,
            scoreA: winnersByName.has(match.playerA) ? 3 : 0,
            scoreB: winnersByName.has(match.playerB) ? 3 : 0
        })));

        expect(results.winners.map(player => player.name).sort()).toEqual(['Alpha', 'Gamma']);
        expect(results.losers.map(player => player.name).sort()).toEqual(['Beta', 'Delta']);
    });

    it('rejects a round while any match has no winner', () => {
        const [match] = createBracketRound(players.slice(0, 2), 'upper', 1, 1, () => 0).matches;
        expect(() => resolveBracketRound([match])).toThrow('no tiene un ganador');
    });

    it('pairs upper and lower finalists for the two cross finals', () => {
        const finals = getCrossBracketFinals(players[0], players[1], players[2], players[3], 50);
        expect([finals.championship.playerA, finals.championship.playerB]).toEqual(['Alpha', 'Gamma']);
        expect([finals.placement.playerA, finals.placement.playerB]).toEqual(['Beta', 'Delta']);
        expect(finals.championship.stage).toBe('final');
        expect(finals.placement.stage).toBe('pre-final');
    });

    it('does not silently advance empty or unresolved rounds', () => {
        const empty: BracketMatch[] = [];
        expect(resolveBracketRound(empty)).toEqual({ winners: [], losers: [] });
        expect(() => resolveBracketRound([{ ...createBracketRound(players.slice(0, 2), 'lower', 1, 1).matches[0], scoreA: 1, scoreB: 1 }]))
            .toThrow('no tiene un ganador');
    });
});
