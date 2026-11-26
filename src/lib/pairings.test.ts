import { describe, expect, it } from 'vitest';
import { generatePairings, generateSwissPairings, getPairKey, getPreviousGroupPairKeys, type GeneratedPairing, type PairingPlayer } from './pairings';

function assertUniquePairs(pairings: readonly GeneratedPairing[]): void {
    const keys = pairings.map(pair => getPairKey(pair.playerAId, pair.playerBId, pair.playerA, pair.playerB));
    expect(new Set(keys).size).toBe(keys.length);
}

describe('tournament pairings', () => {
    it('creates the same key regardless of side order', () => {
        expect(getPairKey('A', 'B')).toBe(getPairKey('B', 'A'));
        expect(getPairKey(undefined, undefined, 'Alpha', 'Beta')).toBe(getPairKey(undefined, undefined, 'beta', 'alpha'));
    });

    it('records only previous group matches', () => {
        const keys = getPreviousGroupPairKeys([
            { playerAId: 'a', playerBId: 'b', round: 1 },
            { playerAId: 'a', playerBId: 'c', round: 0 },
            { playerAId: 'b', playerBId: 'c' }
        ]);
        expect(keys).toEqual(new Set(['a|b']));
    });

    it('maximizes new matches without repeating either orientation', () => {
        const players: PairingPlayer[] = [
            { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }
        ];
        const pairings = generatePairings(players, new Set(['a|b', 'c|d']), undefined, () => 0.5);
        expect(pairings).toHaveLength(2);
        expect(pairings.map(pair => getPairKey(pair.playerAId, pair.playerBId))).not.toContain('a|b');
        expect(pairings.map(pair => getPairKey(pair.playerAId, pair.playerBId))).not.toContain('c|d');
        assertUniquePairs(pairings);
    });

    it('gives a bye to the lowest-ranked player who has not received one', () => {
        const ranking: PairingPlayer[] = [
            { id: 'top', name: 'Top', points: 8 },
            { id: 'middle', name: 'Middle', points: 4 },
            { id: 'bottom', name: 'Bottom', points: 1 }
        ];
        const result = generateSwissPairings(ranking, new Set(), new Set(['bottom']), () => 0.5);
        expect(result.bye?.id).toBe('middle');
        expect(result.pairings).toHaveLength(1);
    });

    it('avoids rematches in Swiss pairings', () => {
        const ranking: PairingPlayer[] = [
            { id: 'a', name: 'A', points: 10 }, { id: 'b', name: 'B', points: 8 },
            { id: 'c', name: 'C', points: 4 }, { id: 'd', name: 'D', points: 1 }
        ];
        const previous = new Set(['a|b', 'c|d']);
        const result = generateSwissPairings(ranking, previous, new Set(), () => 0.5);
        expect(result.pairings).toHaveLength(2);
        expect(result.pairings.every(pair => !previous.has(getPairKey(pair.playerAId, pair.playerBId)))).toBe(true);
        assertUniquePairs(result.pairings);
    });
});
