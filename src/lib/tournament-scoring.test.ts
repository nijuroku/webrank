import { describe, expect, it } from 'vitest';
import { calculateAccumulatedPoints, calculateGroupRanking, type ScoringParticipant } from './tournament-scoring';

const players: ScoringParticipant[] = [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }
];
const idByName = (name?: string | null) => players.find(player => player.name === name)?.id || null;

describe('tournament scoring', () => {
    it('applies the standard and Swiss win/draw values and limits bye points to played rounds', () => {
        const matchHistory = [
            { id: 1, playerAId: 'a', playerBId: 'b', playerA: 'A', playerB: 'B', scoreA: 0, scoreB: 0, drawResult: true, round: 1 }
        ];
        const currentMatches = [
            { ...matchHistory[0] },
            { id: 2, playerAId: 'a', playerBId: 'c', playerA: 'A', playerB: 'C', scoreA: 2, scoreB: 0, round: 2 }
        ];

        expect(calculateAccumulatedPoints({
            participants: players, matchHistory, currentMatches, format: 'swiss', swissByes: ['c', 'c'], totalRounds: 1, getParticipantIdByName: idByName
        })).toEqual({ a: 1.5, b: 0.5, c: 1 });

        expect(calculateAccumulatedPoints({
            participants: players, matchHistory, currentMatches, format: 'random', swissByes: [], totalRounds: 2, getParticipantIdByName: idByName
        })).toEqual({ a: 3, b: 0, c: 0 });
    });

    it('ranks Swiss ties by Buchholz, then wins and point difference', () => {
        const ranking = calculateGroupRanking({
            participants: [
                { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }
            ],
            matches: [
                { playerAId: 'a', playerBId: 'c', playerA: 'A', playerB: 'C', scoreA: 3, scoreB: 0, round: 1 },
                { playerAId: 'b', playerBId: 'd', playerA: 'B', playerB: 'D', scoreA: 3, scoreB: 0, round: 1 }
            ],
            accumulatedPoints: { a: 5, b: 5, c: 4, d: 1 },
            format: 'swiss',
            swissByes: [],
            getParticipantIdByName: name => ({ A: 'a', B: 'b', C: 'c', D: 'd' }[name || ''] || null)
        });

        expect(ranking.slice(0, 2).map(player => player.id)).toEqual(['a', 'b']);
        expect(ranking[0]?.buchholz).toBeGreaterThan(ranking[1]?.buchholz || 0);
    });

    it('adds a Swiss bye as a win without adding match points', () => {
        const ranking = calculateGroupRanking({
            participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
            matches: [],
            accumulatedPoints: { a: 1, b: 1 },
            format: 'swiss',
            swissByes: ['b'],
            getParticipantIdByName: () => null
        });
        expect(ranking.map(player => [player.id, player.wins])).toEqual([['b', 1], ['a', 0]]);
    });
});
