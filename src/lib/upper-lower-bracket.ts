export type BracketSide = 'upper' | 'lower';
export type BracketPlayerId = string | number;

export interface BracketPlayer {
    id?: BracketPlayerId | null;
    name: string;
}

export interface BracketMatch {
    id: string | number;
    playerA: string;
    playerB: string;
    playerAId?: BracketPlayerId | null;
    playerBId?: BracketPlayerId | null;
    scoreA: number;
    scoreB: number;
    round: number;
    bracket: BracketSide;
    bracketFinal?: boolean;
    stage?: 'final' | 'pre-final';
}

export interface BracketRound {
    matches: BracketMatch[];
    byes: BracketPlayer[];
    nextId: number;
}

export interface BracketRoundResult {
    winners: BracketPlayer[];
    losers: BracketPlayer[];
}

/** Empareja una fase; si el grupo es impar, un jugador avanza con bye. */
export function createBracketRound(
    players: readonly BracketPlayer[],
    bracket: BracketSide,
    round: number,
    firstId: number,
    random: () => number = Math.random
): BracketRound {
    const shuffled = [...players];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    const isFinal = shuffled.length === 2;
    const byes = shuffled.length % 2 ? [shuffled.pop()!] : [];
    const matches: BracketMatch[] = [];
    for (let index = 0; index + 1 < shuffled.length; index += 2) {
        const playerA = shuffled[index];
        const playerB = shuffled[index + 1];
        matches.push({
            id: firstId + matches.length,
            playerA: playerA.name,
            playerB: playerB.name,
            playerAId: playerA.id,
            playerBId: playerB.id,
            scoreA: 0,
            scoreB: 0,
            round,
            bracket,
            ...(isFinal ? { bracketFinal: true } : {})
        });
    }
    return { matches, byes, nextId: firstId + matches.length };
}

/** Resuelve una fase completa y rechaza marcadores sin ganador. */
export function resolveBracketRound(matches: readonly BracketMatch[]): BracketRoundResult {
    const winners: BracketPlayer[] = [];
    const losers: BracketPlayer[] = [];
    for (const match of matches) {
        if (match.scoreA === match.scoreB) {
            throw new Error(`El enfrentamiento ${match.playerA} vs ${match.playerB} no tiene un ganador.`);
        }
        const playerA = { id: match.playerAId, name: match.playerA };
        const playerB = { id: match.playerBId, name: match.playerB };
        if (match.scoreA > match.scoreB) {
            winners.push(playerA);
            losers.push(playerB);
        } else {
            winners.push(playerB);
            losers.push(playerA);
        }
    }
    return { winners, losers };
}

/** Final A decide 1.º/2.º; la final B decide 3.º/4.º. */
export function getCrossBracketFinals(
    upperWinner: BracketPlayer,
    upperRunnerUp: BracketPlayer,
    lowerWinner: BracketPlayer,
    lowerRunnerUp: BracketPlayer,
    firstId: number
): { championship: BracketMatch; placement: BracketMatch } {
    return {
        championship: {
            id: firstId, playerA: upperWinner.name, playerB: lowerWinner.name,
            playerAId: upperWinner.id, playerBId: lowerWinner.id,
            scoreA: 0, scoreB: 0, round: 0, bracket: 'upper', stage: 'final'
        },
        placement: {
            id: firstId + 1, playerA: upperRunnerUp.name, playerB: lowerRunnerUp.name,
            playerAId: upperRunnerUp.id, playerBId: lowerRunnerUp.id,
            scoreA: 0, scoreB: 0, round: 0, bracket: 'lower', stage: 'pre-final'
        }
    };
}
