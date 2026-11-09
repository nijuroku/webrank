export type AppTab = 'participants' | 'matches' | 'table';
export type AppTheme = 'light' | 'dark';

export interface AppNavigationElements {
    buttons: NodeListOf<HTMLElement>;
    panels: NodeListOf<HTMLElement>;
    tournamentSection: HTMLElement | null;
}

export function resolveAppTab(tabName: AppTab, tournamentVisible: boolean): AppTab | null {
    if (tabName !== 'participants' && tabName !== 'table' && !tournamentVisible) return null;
    return tabName;
}

export function resolveAvailableAppTab(activeTab: AppTab, tournamentVisible: boolean): AppTab {
    if (!tournamentVisible && activeTab !== 'participants' && activeTab !== 'table') return 'participants';
    return activeTab;
}

export function activateAppTab(
    tabName: AppTab,
    tournamentVisible: boolean,
    elements: AppNavigationElements,
    scrollToContent = false
): AppTab | null {
    const nextTab = resolveAppTab(tabName, tournamentVisible);
    if (!nextTab) return null;

    elements.buttons.forEach(button => {
        const isActive = button.dataset.tab === nextTab;
        button.classList.toggle('active', isActive);
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    elements.panels.forEach(panel => {
        const isActive = panel.dataset.tabPanel === nextTab;
        panel.hidden = !isActive;
        panel.classList.toggle('active', isActive);
    });
    if (elements.tournamentSection) {
        elements.tournamentSection.style.display = nextTab === 'participants'
            || (nextTab !== 'table' && !tournamentVisible) ? 'none' : 'block';
    }
    if (scrollToContent) window.scrollTo({ top: 0, behavior: 'smooth' });
    return nextTab;
}

export function updateAppTabAvailability(
    activeTab: AppTab,
    tournamentVisible: boolean,
    buttons: NodeListOf<HTMLElement>
): AppTab {
    buttons.forEach(button => {
        const unavailable = button.dataset.tab !== 'participants' && button.dataset.tab !== 'table' && !tournamentVisible;
        button.setAttribute('aria-disabled', String(unavailable));
        button.tabIndex = unavailable ? -1 : 0;
    });
    return resolveAvailableAppTab(activeTab, tournamentVisible);
}

export function applyAppTheme(theme: AppTheme | string, body: HTMLElement, toggleButton: HTMLElement | null): void {
    const isLight = theme === 'light';
    body.classList.toggle('light-theme', isLight);
    if (!toggleButton) return;
    const modeLabel = toggleButton.querySelector<HTMLElement>('.theme-mode-label');
    if (modeLabel) modeLabel.textContent = isLight ? 'Claro' : 'Oscuro';
    toggleButton.setAttribute('aria-pressed', String(isLight));
    toggleButton.setAttribute('aria-label', isLight ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro');
    toggleButton.title = isLight ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro';
}

export function getNextAppTheme(currentTheme: AppTheme | string): AppTheme {
    return currentTheme === 'light' ? 'dark' : 'light';
}
