import { describe, expect, it } from 'vitest';
import { getPlayerStats } from './tournament-stats';

describe('getPlayerStats', () => {
    it('counts wins, losses, and draws by player id', () => {
        const stats = getPlayerStats(
            { id: 7, name: 'Alicia' },
            [
                { playerAId: 7, playerBId: 8, scoreA: 3, scoreB: 1 },
                { playerAId: 9, playerBId: 7, scoreA: 2, scoreB: 0 },
                { playerAId: 7, playerBId: 10, scoreA: 1, scoreB: 1 },
            ],
            []
        );

        expect(stats).toEqual({ wins: 1, losses: 1, draws: 1, played: 3 });
    });

    it('ignores unfinished zero-score matches', () => {
        const stats = getPlayerStats(
            { id: 'a', name: 'Alicia' },
            [{ playerAId: 'a', playerBId: 'b', scoreA: 0, scoreB: 0 }],
            []
        );

        expect(stats).toEqual({ wins: 0, losses: 0, draws: 0, played: 0 });
    });

    it('counts explicit zero-score draws as played matches', () => {
        const stats = getPlayerStats(
            { id: 'a', name: 'Alicia' },
            [{ playerAId: 'a', playerBId: 'b', scoreA: 0, scoreB: 0, drawResult: true }],
            []
        );

        expect(stats).toEqual({ wins: 0, losses: 0, draws: 1, played: 1 });
    });

    it('counts byes as wins without counting them as played matches', () => {
        const stats = getPlayerStats({ id: 4, name: 'Alicia' }, [], ['4', 4]);

        expect(stats).toEqual({ wins: 2, losses: 0, draws: 0, played: 0 });
    });

    it('falls back to names when match player ids are missing', () => {
        const stats = getPlayerStats(
            { id: 4, name: 'Alicia' },
            [{ playerA: 'Alicia', playerB: 'Bruno', scoreA: 1, scoreB: 2 }],
            []
        );

        expect(stats).toEqual({ wins: 0, losses: 1, draws: 0, played: 1 });
    });
});
