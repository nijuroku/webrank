export interface PlayerAliasRecord {
    alias_key: string;
    alias_name: string;
    canonical_key: string;
    canonical_name: string;
}

export interface PlayerIdentity {
    canonicalKey: string;
    canonicalName: string;
    nameKeys: Set<string>;
    aliasNames: string[];
}

export interface TournamentMatchRecord {
    playerAId?: string | number | null;
    playerBId?: string | number | null;
    playerA?: string | null;
    playerB?: string | null;
    scoreA?: number | string | null;
    scoreB?: number | string | null;
    drawResult?: boolean | null;
    jugado?: boolean | null;
    view_label?: string | null;
    view_order?: number | string | null;
    stage?: string | null;
    label?: string | null;
    bracket?: 'upper' | 'lower' | null;
    round?: number | string | null;
    bracketRound?: number | string | null;
}

export type MatchResult = 'Pendiente' | 'Victoria' | 'Derrota' | 'Empate';

export interface PlayerMatchHistoryItem {
    order: number;
    roundLabel: string;
    opponent: string;
    score: string;
    result: MatchResult;
}

export interface TournamentPlayerRecord {
    id?: string | number | null;
    name: string;
    points?: number | string;
    [key: string]: unknown;
}

export interface TournamentPlayerInfo {
    participant: TournamentPlayerRecord;
    standing: TournamentPlayerRecord | null;
    standings: TournamentPlayerRecord[];
    playerIds: Set<string>;
    position: number;
}

export interface TournamentPlayerRows {
    participants?: TournamentPlayerRecord[] | null;
    standings?: TournamentPlayerRecord[] | null;
}

export interface TournamentProfileSummary {
    wins: number;
    losses: number;
    draws: number;
    position: number;
    points: number;
    tournamentName: string;
    tournamentDate: string;
}

export interface ProfileCareerStats {
    wins: number;
    losses: number;
    draws: number;
}

export function getProfileCareerStats(profiles: readonly TournamentProfileSummary[]): ProfileCareerStats {
    return profiles.reduce((total, profile) => ({
        wins: total.wins + profile.wins,
        losses: total.losses + profile.losses,
        draws: total.draws + profile.draws
    }), { wins: 0, losses: 0, draws: 0 });
}

export function getBestTournamentProfile(profiles: readonly TournamentProfileSummary[]): TournamentProfileSummary | null {
    if (!profiles.length) return null;
    return [...profiles].sort((a, b) => {
        const aRank = a.position || Number.MAX_SAFE_INTEGER;
        const bRank = b.position || Number.MAX_SAFE_INTEGER;
        return aRank - bRank || b.points - a.points || Date.parse(b.tournamentDate || '') - Date.parse(a.tournamentDate || '');
    })[0] || null;
}

function normalizeName(value: unknown): string {
    return String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
}

export function getTournamentPlayer(
    tournament: TournamentPlayerRows,
    nameKeys: ReadonlySet<string>,
    canonicalKey: string
): TournamentPlayerInfo | null {
    const participants = Array.isArray(tournament.participants) ? tournament.participants : [];
    const standings = Array.isArray(tournament.standings) ? tournament.standings : [];
    const matchedParticipants = participants.filter(player => nameKeys.has(normalizeName(player.name)));
    const matchedStandings = standings.filter(player => nameKeys.has(normalizeName(player.name)));
    const participant = matchedParticipants[0] || matchedStandings[0];
    if (!participant) return null;

    const participantIds = new Set(matchedParticipants.map(player => String(player.id || '')).filter(Boolean));
    const preferredStanding = matchedStandings.find(player => normalizeName(player.name) === canonicalKey) || matchedStandings[0] || null;
    const standing = preferredStanding ? {
        ...preferredStanding,
        points: matchedStandings.reduce((total, row) => total + (Number(row.points) || 0), 0)
    } : null;
    const standingIndexes = matchedStandings.map(row => standings.indexOf(row)).filter(index => index >= 0);
    const position = standingIndexes.length ? Math.min(...standingIndexes) + 1 : 0;
    const playerIds = new Set([...participantIds, ...(participant.id ? [String(participant.id)] : [])]);
    return { participant, standing, standings, playerIds, position };
}

export function resolvePlayerIdentity(requestedName: string, aliases: readonly PlayerAliasRecord[]): PlayerIdentity {
    const requestedKey = normalizeName(requestedName);
    const alias = aliases.find(row => normalizeName(row.alias_key) === requestedKey || normalizeName(row.alias_name) === requestedKey);
    const canonicalKey = alias ? normalizeName(alias.canonical_key) : requestedKey;
    const canonicalName = alias?.canonical_name || requestedName;
    const nameKeys = new Set([requestedKey, canonicalKey]);
    aliases.forEach(row => {
        if (normalizeName(row.canonical_key) === canonicalKey) nameKeys.add(normalizeName(row.alias_key));
    });
    const aliasNames = aliases
        .filter(row => normalizeName(row.canonical_key) === canonicalKey)
        .filter(row => normalizeName(row.alias_key) !== canonicalKey)
        .sort((a, b) => String(a.alias_name || '').localeCompare(String(b.alias_name || ''), 'es', { sensitivity: 'base' }))
        .map(row => row.alias_name);
    return { canonicalKey, canonicalName, nameKeys, aliasNames: [...new Set(aliasNames)] };
}

export function getPlayerMatches(
    tournamentMatches: readonly TournamentMatchRecord[],
    playerIds: ReadonlySet<string>,
    nameKeys: ReadonlySet<string>
): PlayerMatchHistoryItem[] {
    const isPlayer = (id: string | number | null | undefined, name: string | null | undefined): boolean =>
        Boolean((id && playerIds.has(String(id))) || nameKeys.has(normalizeName(name)));

    return tournamentMatches
        .filter(match => isPlayer(match.playerAId, match.playerA) || isPlayer(match.playerBId, match.playerB))
        .map(match => {
            const isA = isPlayer(match.playerAId, match.playerA);
            const opponent = isA ? match.playerB : match.playerA;
            const scoreFor = Number(isA ? match.scoreA : match.scoreB) || 0;
            const scoreAgainst = Number(isA ? match.scoreB : match.scoreA) || 0;
            const played = Boolean(match.drawResult || match.jugado || scoreFor !== 0 || scoreAgainst !== 0);
            const isDraw = Boolean(match.drawResult || (played && scoreFor === scoreAgainst));
            const result: MatchResult = !played ? 'Pendiente' : isDraw ? 'Empate' : scoreFor > scoreAgainst ? 'Victoria' : 'Derrota';
            const roundLabel = match.view_label || match.label || (match.stage === 'final' ? 'Final' : match.stage === 'pre-final'
                ? 'Pre-final' : match.bracket && Number(match.bracketRound) > 0
                    ? `${match.bracket === 'upper' ? 'Upper A' : 'Lower B'} · Ronda ${match.bracketRound}`
                    : Number(match.round) > 0 ? `Ronda ${match.round}`
                    : Number(match.bracketRound) > 0 ? `Eliminatorias · Ronda ${match.bracketRound}` : 'Eliminatorias');

            const order = Number(match.view_order) || Number(match.round)
                || (Number(match.bracketRound) > 0 ? 1_000 + Number(match.bracketRound) : 0)
                || (match.stage === 'pre-final' ? 1_000_000 : match.stage === 'final' ? 1_000_001 : 0);

            return {
                order,
                roundLabel,
                opponent: opponent || '—',
                score: played ? `${scoreFor}–${scoreAgainst}` : 'Por jugar',
                result
            };
        })
        .sort((a, b) => a.order - b.order);
}
