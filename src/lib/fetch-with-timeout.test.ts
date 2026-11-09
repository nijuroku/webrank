import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './fetch-with-timeout';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
    it('returns the response when the request completes in time', async () => {
        const response = new Response('ok', { status: 200 });
        const fetchMock = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchWithTimeout('/api/example', {}, 100)).resolves.toBe(response);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('aborts a request and reports a timeout after the deadline', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn((_input, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }));
        vi.stubGlobal('fetch', fetchMock);

        const request = fetchWithTimeout('/api/slow', {}, 25);
        const rejected = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
        await vi.advanceTimersByTimeAsync(25);
        await rejected;
    });

    it('preserves a caller-triggered abort as an abort instead of a timeout', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn((_input, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }));
        vi.stubGlobal('fetch', fetchMock);

        const request = fetchWithTimeout('/api/cancel', { signal: controller.signal }, 500);
        controller.abort();
        await expect(request).rejects.toMatchObject({ name: 'Error', message: 'aborted' });
    });
});
