export type PlayerIdentifier = string | number;

export interface PairingPlayer {
    id?: PlayerIdentifier | null;
    name: string;
    points?: number;
}

export interface PairingMatchRecord {
    playerAId?: PlayerIdentifier | null;
    playerBId?: PlayerIdentifier | null;
    playerA?: string | null;
    playerB?: string | null;
    round?: number | string | null;
}

export interface GeneratedPairing {
    playerA: string;
    playerB: string;
    playerAId?: PlayerIdentifier | null;
    playerBId?: PlayerIdentifier | null;
}

export interface SwissPairingsResult {
    pairings: GeneratedPairing[];
    bye: PairingPlayer | null;
}

type RandomSource = () => number;

export function getPairKey(
    playerAId: PlayerIdentifier | null | undefined,
    playerBId: PlayerIdentifier | null | undefined,
    playerAName = '',
    playerBName = ''
): string {
    const a = String(playerAId || playerAName).trim().toLocaleLowerCase();
    const b = String(playerBId || playerBName).trim().toLocaleLowerCase();
    return [a, b].sort().join('|');
}

export function getPreviousGroupPairKeys(matches: readonly PairingMatchRecord[]): Set<string> {
    return new Set(matches
        .filter(match => Number(match.round) > 0)
        .map(match => getPairKey(match.playerAId, match.playerBId, match.playerA || '', match.playerB || '')));
}

export function generatePairings(
    players: readonly PairingPlayer[],
    excludedKeys: ReadonlySet<string> = new Set(),
    getIdByName: (name: string) => PlayerIdentifier | null = () => null,
    random: RandomSource = Math.random
): GeneratedPairing[] {
    const normalized = players.map(player => ({
        id: player.id || getIdByName(player.name),
        name: player.name || ''
    }));

    let best: GeneratedPairing[] = [];
    function search(remaining: typeof normalized, current: GeneratedPairing[]): void {
        if (current.length > best.length) best = [...current];
        if (remaining.length < 2 || current.length + Math.floor(remaining.length / 2) <= best.length) return;

        const first = remaining[0];
        const opponents = remaining.slice(1).sort(() => random() - 0.5);
        for (const opponent of opponents) {
            const key = getPairKey(first.id, opponent.id, first.name, opponent.name);
            if (excludedKeys.has(key)) continue;
            const next = remaining.filter(player => player !== first && player !== opponent);
            search(next, current.concat({
                playerA: first.name,
                playerB: opponent.name,
                playerAId: first.id,
                playerBId: opponent.id
            }));
        }
        search(remaining.slice(1), current);
    }

    search(normalized.sort(() => random() - 0.5), []);
    return best;
}

export function generateSwissPairings(
    ranking: readonly PairingPlayer[],
    previousPairKeys: ReadonlySet<string>,
    previousByeIds: ReadonlySet<string> = new Set(),
    random: RandomSource = Math.random
): SwissPairingsResult {
    const byeIds = new Set(previousByeIds);
    let bye: PairingPlayer | null = null;
    if (ranking.length % 2) {
        bye = [...ranking].reverse().find(player => !byeIds.has(String(player.id))) || ranking[ranking.length - 1] || null;
        if (bye?.id !== undefined && bye.id !== null) byeIds.add(String(bye.id));
    }

    const players = ranking.filter(player => !bye || player.id !== bye.id)
        .map(player => ({ id: player.id, name: player.name, points: Number(player.points) || 0 }));
    let bestPairs: GeneratedPairing[] | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    function search(rest: typeof players, pairs: GeneratedPairing[], gap: number): void {
        if (!rest.length) {
            if (gap < bestGap) {
                bestPairs = [...pairs];
                bestGap = gap;
            }
            return;
        }
        if (gap >= bestGap) return;

        const first = rest[0];
        const opponents = rest.slice(1)
            .filter(player => !previousPairKeys.has(getPairKey(first.id, player.id)))
            .sort((a, b) => Math.abs(first.points - b.points) - Math.abs(first.points - a.points) || random() - 0.5);
        opponents.forEach(opponent => search(
            rest.filter(player => player !== first && player !== opponent),
            pairs.concat([{ playerA: first.name, playerB: opponent.name, playerAId: first.id, playerBId: opponent.id }]),
            gap + Math.abs(first.points - opponent.points)
        ));
    }

    search(players, [], 0);
    return { pairings: bestPairs || [], bye };
}
