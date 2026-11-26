import { describe, expect, it } from 'vitest';
import { getNextAppTheme, resolveAppTab, resolveAvailableAppTab } from './app-ui';

describe('main app UI state', () => {
    it('blocks the matches tab until a tournament is visible', () => {
        expect(resolveAppTab('matches', false)).toBeNull();
        expect(resolveAppTab('matches', true)).toBe('matches');
    });

    it('keeps the selected available tab and falls back to participants when needed', () => {
        expect(resolveAvailableAppTab('table', false)).toBe('table');
        expect(resolveAvailableAppTab('matches', false)).toBe('participants');
        expect(resolveAvailableAppTab('matches', true)).toBe('matches');
    });

    it('toggles between light and dark theme', () => {
        expect(getNextAppTheme('dark')).toBe('light');
        expect(getNextAppTheme('light')).toBe('dark');
    });
});
