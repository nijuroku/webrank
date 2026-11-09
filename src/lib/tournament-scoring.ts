export type TournamentPlayerId = string | number;
export type TournamentFormat = 'swiss' | 'random' | string;

export interface ScoringParticipant {
    id?: TournamentPlayerId | null;
    name: string;
}

export interface ScoringMatch {
    id?: string | number | null;
    playerAId?: TournamentPlayerId | null;
    playerBId?: TournamentPlayerId | null;
    playerA?: string | null;
    playerB?: string | null;
    scoreA?: number;
    scoreB?: number;
    drawResult?: boolean;
    round?: number;
}

export interface RankedParticipant {
    id: TournamentPlayerId | null;
    name: string;
    points: number;
    wins: number;
    pointDifference: number;
    buchholz: number;
}

export interface RecalculateScoresInput {
    participants: readonly ScoringParticipant[];
    matchHistory: readonly ScoringMatch[];
    currentMatches: readonly ScoringMatch[];
    format: TournamentFormat;
    swissByes: readonly TournamentPlayerId[];
    totalRounds: number;
    getParticipantIdByName: (name: string | null | undefined) => TournamentPlayerId | null;
}

export interface GroupRankingInput {
    participants: readonly ScoringParticipant[];
    matches: readonly ScoringMatch[];
    accumulatedPoints: Readonly<Record<string, number>>;
    format: TournamentFormat;
    swissByes: readonly TournamentPlayerId[];
    getParticipantIdByName: (name: string | null | undefined) => TournamentPlayerId | null;
}

function participantId(id: TournamentPlayerId | null | undefined, name: string | null | undefined, resolveName: GroupRankingInput['getParticipantIdByName']): TournamentPlayerId | null {
    return id || resolveName(name);
}

function addPoints(points: Record<string, number>, id: TournamentPlayerId | null, amount: number): void {
    if (id !== null && id !== undefined && id !== '') {
        const key = String(id);
        points[key] = (points[key] || 0) + amount;
    }
}

function isSameArchivedMatch(archived: ScoringMatch, current: ScoringMatch): boolean {
    return archived.id === current.id
        && (archived.playerAId === current.playerAId || archived.playerA === current.playerA)
        && (archived.playerBId === current.playerBId || archived.playerB === current.playerB);
}

function scoreCompletedMatch(
    points: Record<string, number>,
    match: ScoringMatch,
    format: TournamentFormat,
    resolveName: GroupRankingInput['getParticipantIdByName']
): void {
    if (Number(match.round) <= 0) return;
    const playerAId = participantId(match.playerAId, match.playerA, resolveName);
    const playerBId = participantId(match.playerBId, match.playerB, resolveName);
    const scoreA = Number(match.scoreA) || 0;
    const scoreB = Number(match.scoreB) || 0;
    const pointsPerWin = format === 'swiss' ? 1 : 3;
    const pointsPerDraw = format === 'swiss' ? 0.5 : 0;

    if (scoreA > scoreB) addPoints(points, playerAId, pointsPerWin);
    else if (scoreB > scoreA) addPoints(points, playerBId, pointsPerWin);
    else if (pointsPerDraw && playerAId && playerBId && (scoreA !== 0 || scoreB !== 0 || match.drawResult)) {
        addPoints(points, playerAId, pointsPerDraw);
        addPoints(points, playerBId, pointsPerDraw);
    }
}

export function calculateAccumulatedPoints(input: RecalculateScoresInput): Record<string, number> {
    const points: Record<string, number> = {};
    input.participants.forEach(player => {
        if (player.id) points[String(player.id)] = 0;
    });

    input.matchHistory.forEach(match => scoreCompletedMatch(points, match, input.format, input.getParticipantIdByName));
    input.currentMatches.forEach(match => {
        if (!input.matchHistory.some(archived => isSameArchivedMatch(archived, match))) {
            scoreCompletedMatch(points, match, input.format, input.getParticipantIdByName);
        }
    });

    if (input.format === 'swiss') {
        input.swissByes.slice(0, input.totalRounds).forEach(id => addPoints(points, id, 1));
    }
    return points;
}

export function calculateGroupRanking(input: GroupRankingInput): RankedParticipant[] {
    const groupMatches = input.matches.filter(match => Number(match.round) > 0);
    const getPoints = (id: TournamentPlayerId | null): number => id === null ? 0 : input.accumulatedPoints[String(id)] || 0;

    const ranking = input.participants.map(player => {
        const playerId = player.id || input.getParticipantIdByName(player.name);
        const playerMatches = groupMatches.filter(match => {
            const idA = participantId(match.playerAId, match.playerA, input.getParticipantIdByName);
            const idB = participantId(match.playerBId, match.playerB, input.getParticipantIdByName);
            return idA === playerId || idB === playerId || match.playerA === player.name || match.playerB === player.name;
        });

        const wins = playerMatches.filter(match => {
            const idA = participantId(match.playerAId, match.playerA, input.getParticipantIdByName);
            const idB = participantId(match.playerBId, match.playerB, input.getParticipantIdByName);
            if (idA === playerId) return Number(match.scoreA) > Number(match.scoreB);
            if (idB === playerId) return Number(match.scoreB) > Number(match.scoreA);
            if (match.playerA === player.name) return Number(match.scoreA) > Number(match.scoreB);
            if (match.playerB === player.name) return Number(match.scoreB) > Number(match.scoreA);
            return false;
        }).length;

        let pointsFor = 0;
        let pointsAgainst = 0;
        playerMatches.forEach(match => {
            if ((match.playerAId && match.playerAId === playerId) || match.playerA === player.name) {
                pointsFor += Number(match.scoreA) || 0;
                pointsAgainst += Number(match.scoreB) || 0;
            } else {
                pointsFor += Number(match.scoreB) || 0;
                pointsAgainst += Number(match.scoreA) || 0;
            }
        });

        const opponents = playerMatches.map(match => {
            const idA = participantId(match.playerAId, match.playerA, input.getParticipantIdByName);
            const idB = participantId(match.playerBId, match.playerB, input.getParticipantIdByName);
            return idA === playerId ? idB : idA;
        }).filter((id): id is TournamentPlayerId => Boolean(id));
        const buchholz = opponents.reduce<number>((sum, id) => sum + getPoints(id), 0);
        const byeWins = input.format === 'swiss'
            ? input.swissByes.filter(id => String(id) === String(playerId)).length
            : 0;

        return {
            id: playerId,
            name: player.name,
            points: getPoints(playerId),
            wins: wins + byeWins,
            pointDifference: pointsFor - pointsAgainst,
            buchholz
        };
    });

    return ranking.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (input.format === 'swiss' && b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
        return 0;
    });
}
