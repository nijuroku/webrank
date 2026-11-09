export type PlayerId = string | number;

export interface PlayerStatsInput {
    id?: PlayerId;
    name: string;
}

export interface MatchStatsInput {
    playerAId?: PlayerId;
    playerBId?: PlayerId;
    playerA?: string;
    playerB?: string;
    scoreA?: number | string;
    scoreB?: number | string;
    drawResult?: boolean;
}

export interface PlayerMatchStats {
    wins: number;
    losses: number;
    draws: number;
    played: number;
}

export function getPlayerStats(
    player: PlayerStatsInput,
    groupMatches: readonly MatchStatsInput[],
    byes: readonly PlayerId[]
): PlayerMatchStats {
    const playerId = String(player.id || '');
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let played = 0;

    for (const match of groupMatches) {
        const isA = String(match.playerAId || '') === playerId || match.playerA === player.name;
        const isB = String(match.playerBId || '') === playerId || match.playerB === player.name;
        if (!isA && !isB) continue;

        const completed = Boolean(match.drawResult) || Number(match.scoreA) !== 0 || Number(match.scoreB) !== 0;
        if (!completed) continue;

        played++;
        const scoreFor = Number(isA ? match.scoreA : match.scoreB) || 0;
        const scoreAgainst = Number(isA ? match.scoreB : match.scoreA) || 0;
        if (match.drawResult || scoreFor === scoreAgainst) draws++;
        else if (scoreFor > scoreAgainst) wins++;
        else losses++;
    }

    wins += byes.filter(id => String(id) === playerId).length;
    return { wins, losses, draws, played };
}
