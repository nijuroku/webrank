import { describe, expect, it } from 'vitest';
import { SavedPlayerService, fetchAllSupabaseRows, type SupabaseRowRequest } from './saved-player-service';

describe('Supabase paginated row loader', () => {
    it('collects each page and stops after the first partial page', async () => {
        const ranges: string[] = [];
        const request: SupabaseRowRequest = async (_path, options) => {
            ranges.push(new Headers(options?.headers).get('Range') || '');
            return ranges.length === 1 ? Array.from({ length: 2 }, (_, id) => ({ id })) : [{ id: 2 }];
        };
        await expect(fetchAllSupabaseRows(request, '/rows', 2)).resolves.toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
        expect(ranges).toEqual(['0-1', '2-3']);
    });

    it('rejects an invalid page size', async () => {
        await expect(fetchAllSupabaseRows(async () => [], '/rows', 0)).rejects.toThrow('entero positivo');
    });
});

describe('SavedPlayerService', () => {
    it('shares concurrent loads, caches results and resolves aliases', async () => {
        let requestCount = 0;
        let currentTime = 100;
        const request: SupabaseRowRequest = async path => {
            requestCount++;
            await Promise.resolve();
            return path.includes('/players?')
                ? [{ id: '1', name: 'Gabriel Boric' }, { id: '2', name: 'Feitan' }]
                : [{ alias_key: 'gabo', alias_name: 'Gabo', canonical_name: 'Gabriel Boric' }];
        };
        const service = new SavedPlayerService(request, 1000, () => currentTime);

        const [first, second] = await Promise.all([service.getDirectory(), service.getDirectory()]);
        expect(first).toBe(second);
        expect(requestCount).toBe(2);
        expect(await service.search('GABO')).toEqual([{ name: 'Gabriel Boric' }]);
        expect(await service.resolveName('gAbO')).toBe('Gabriel Boric');
        expect(requestCount).toBe(2);

        currentTime += 1001;
        await service.getDirectory();
        expect(requestCount).toBe(4);
    });

    it('invalidates its cached directory after a player is added', async () => {
        let playerName = 'Feitan';
        let requests = 0;
        const service = new SavedPlayerService(async path => {
            requests++;
            return path.includes('/players?') ? [{ name: playerName }] : [];
        });

        expect((await service.search('Fei'))[0]?.name).toBe('Feitan');
        playerName = 'Feita';
        service.invalidate();
        expect((await service.search('Fei'))[0]?.name).toBe('Feita');
        expect(requests).toBe(4);
    });

    it('does not let an old in-flight request repopulate the cache after invalidation', async () => {
        let releaseOldRequest: (() => void) | undefined;
        let playerName = 'Old Player';
        let oldPlayerRequest = true;
        const service = new SavedPlayerService(async path => {
            if (!path.includes('/players?')) return [];
            if (oldPlayerRequest) {
                await new Promise<void>(resolve => { releaseOldRequest = resolve; });
                return [{ name: 'Old Player' }];
            }
            return [{ name: playerName }];
        });

        const staleLoad = service.getDirectory();
        await Promise.resolve();
        service.invalidate();
        oldPlayerRequest = false;
        playerName = 'New Player';
        expect(await service.resolveName('New Player')).toBe('New Player');
        releaseOldRequest?.();
        await staleLoad;
        expect(await service.search('New')).toEqual([{ name: 'New Player' }]);
    });

    it('falls back to the entered name when name resolution cannot load the directory', async () => {
        let receivedError: unknown;
        const service = new SavedPlayerService(async () => { throw new Error('offline'); });
        await expect(service.resolveNameOrOriginal('  New Player  ', error => { receivedError = error; })).resolves.toBe('New Player');
        expect(receivedError).toBeInstanceOf(Error);
    });
});
