import { describe, expect, it } from 'vitest';
import { collectFinishedTournamentPlayerNames, loadRegisteredPlayerNames, type ProfileSupabaseConfig, type SupabaseFetch } from './profile-data';

const config: ProfileSupabaseConfig = { url: 'https://example.supabase.co', anonKey: 'public-key' };

describe('profile data loading', () => {
    it('collects player names from participants, standings, winner and podium', () => {
        expect(collectFinishedTournamentPlayerNames([{
            participants: [{ name: 'Feitan' }],
            standings: [{ name: 'Adam' }],
            winner: 'Feitan',
            podium: { second: { name: 'Adam' }, third: 'Cjota' }
        }])).toEqual(['Feitan', 'Adam', 'Feitan', 'Adam', 'Cjota']);
    });

    it('loads all registered players in pages of 1000', async () => {
        let page = 0;
        const request: SupabaseFetch = async (_input, init) => {
            page++;
            const range = new Headers(init?.headers).get('Range');
            if (page === 1) {
                expect(range).toBe('0-999');
                return new Response(JSON.stringify(Array.from({ length: 1000 }, (_, index) => ({ name: `Player ${index}` }))));
            }
            expect(range).toBe('1000-1999');
            return new Response(JSON.stringify([{ name: 'Player 1000' }]), { status: 200 });
        };

        const names = await loadRegisteredPlayerNames(config, request);
        expect(names).toHaveLength(1001);
        expect(names.at(-1)).toBe('Player 1000');
        expect(page).toBe(2);
    });

    it('preserves optional lookups while allowing the directory to fail visibly', async () => {
        const request: SupabaseFetch = async () => new Response('unavailable', { status: 503 });
        await expect(loadRegisteredPlayerNames(config, request)).resolves.toEqual([]);
        await expect(loadRegisteredPlayerNames(config, request, true)).rejects.toThrow('No se pudieron cargar los jugadores guardados.');
    });
});
