import { describe, expect, it } from 'vitest';
import { getBestTournamentProfile, getPlayerMatches, getProfileCareerStats, getTournamentPlayer, resolvePlayerIdentity, type PlayerAliasRecord, type TournamentMatchRecord, type TournamentProfileSummary } from './profile-history';

const aliases: PlayerAliasRecord[] = [
    { alias_key: 'gabo', alias_name: 'Gabo', canonical_key: 'gabriel boric', canonical_name: 'Gabriel Boric' },
    { alias_key: 'gabriel boric', alias_name: 'Gabriel Boric', canonical_key: 'gabriel boric', canonical_name: 'Gabriel Boric' },
    { alias_key: 'gb', alias_name: 'GB', canonical_key: 'gabriel boric', canonical_name: 'Gabriel Boric' }
];

describe('resolvePlayerIdentity', () => {
    it('resolves an alias to the principal name and all associated aliases', () => {
        const identity = resolvePlayerIdentity('GABO', aliases);
        expect(identity.canonicalName).toBe('Gabriel Boric');
        expect(identity.canonicalKey).toBe('gabriel boric');
        expect(identity.nameKeys).toEqual(new Set(['gabo', 'gabriel boric', 'gb']));
        expect(identity.aliasNames).toEqual(['Gabo', 'GB']);
    });
});

describe('getPlayerMatches', () => {
    it('includes matches by player ID or alias, calculates result and sorts by round', () => {
        const matches: TournamentMatchRecord[] = [
            { playerA: 'Rival', playerB: 'Gabo', scoreA: 0, scoreB: 0, round: 2 },
            { playerAId: 7, playerA: 'Gabriel Boric', playerB: 'Rival', scoreA: 3, scoreB: 1, round: 1 },
            { playerA: 'Rival', playerB: 'Gabriel Boric', drawResult: true, scoreA: 2, scoreB: 2, stage: 'final' },
            { playerA: 'Other', playerB: 'Someone', scoreA: 4, scoreB: 0, round: 3 }
        ];

        const history = getPlayerMatches(matches, new Set(['7']), new Set(['gabo', 'gabriel boric']));
        expect(history.map(match => [match.roundLabel, match.result, match.score])).toEqual([
            ['Ronda 1', 'Victoria', '3–1'],
            ['Ronda 2', 'Pendiente', 'Por jugar'],
            ['Final', 'Empate', '2–2']
        ]);
    });

    it('treats a name match as the player on either side', () => {
        const history = getPlayerMatches([
            { playerA: 'Rival', playerB: 'Gabo', scoreA: 1, scoreB: 3, round: 1 }
        ], new Set(), new Set(['gabo']));
        expect(history[0]).toMatchObject({ opponent: 'Rival', result: 'Victoria', score: '3–1' });
    });
});

describe('getTournamentPlayer', () => {
    it('combines standings for linked names and chooses the best position', () => {
        const info = getTournamentPlayer({
            participants: [{ id: 14, name: 'Gabo' }],
            standings: [
                { id: 2, name: 'Rival', points: 8 },
                { id: 14, name: 'Gabo', points: 3 },
                { id: 22, name: 'Gabriel Boric', points: 4 }
            ]
        }, new Set(['gabo', 'gabriel boric']), 'gabriel boric');

        expect(info?.participant.name).toBe('Gabo');
        expect(info?.standing).toMatchObject({ name: 'Gabriel Boric', points: 7 });
        expect(info?.position).toBe(2);
        expect(info?.playerIds).toEqual(new Set(['14']));
    });

    it('returns null when neither participants nor standings contain the player', () => {
        expect(getTournamentPlayer({ participants: [{ name: 'Other' }] }, new Set(['player']), 'player')).toBeNull();
    });
});

describe('profile tournament summaries', () => {
    const summaries: TournamentProfileSummary[] = [
        { tournamentName: 'Copa Uno', tournamentDate: '2025-03-01', position: 2, points: 10, wins: 3, losses: 1, draws: 0 },
        { tournamentName: 'Copa Dos', tournamentDate: '2025-05-01', position: 1, points: 4, wins: 2, losses: 0, draws: 1 },
        { tournamentName: 'Copa Tres', tournamentDate: '2025-06-01', position: 1, points: 8, wins: 4, losses: 0, draws: 0 }
    ];

    it('selects the best placement, then points, then date as tie breakers', () => {
        expect(getBestTournamentProfile(summaries)?.tournamentName).toBe('Copa Tres');
        expect(getBestTournamentProfile([])).toBeNull();
    });

    it('totals career wins, losses and draws', () => {
        expect(getProfileCareerStats(summaries)).toEqual({ wins: 9, losses: 1, draws: 1 });
    });
});
