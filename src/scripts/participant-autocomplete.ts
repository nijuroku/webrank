export interface PlayerSuggestion {
    name: string;
}

export interface PlayerSuggestionSearch {
    search(query: string): Promise<PlayerSuggestion[]>;
}

export interface ParticipantAutocompleteOptions {
    search: PlayerSuggestionSearch;
    getCurrentParticipantNames: () => string[];
    onSubmit: () => void;
    onError?: (error: unknown) => void;
}

export function filterParticipantSuggestions(
    rows: readonly PlayerSuggestion[],
    query: string,
    currentParticipantNames: readonly string[]
): PlayerSuggestion[] {
    const seen = new Set<string>();
    const currentNames = new Set(currentParticipantNames.map(name => name.trim().toLocaleLowerCase()));
    const queryKey = query.toLocaleLowerCase();

    return rows
        .filter(row => row?.name)
        .filter(row => {
            const key = row.name.trim().toLocaleLowerCase();
            if (!key || seen.has(key) || currentNames.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => {
            const aStartsWithQuery = a.name.toLocaleLowerCase().startsWith(queryKey);
            const bStartsWithQuery = b.name.toLocaleLowerCase().startsWith(queryKey);
            return Number(bStartsWithQuery) - Number(aStartsWithQuery)
                || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
}

export class ParticipantAutocomplete {
    private requestId = 0;
    private activeIndex = -1;
    private searchTimer: number | undefined;
    private blurTimer: number | undefined;
    private bound = false;

    constructor(
        private readonly input: HTMLInputElement | null,
        private readonly list: HTMLElement | null,
        private readonly options: ParticipantAutocompleteOptions,
        private readonly debounceMs = 220,
        private readonly blurDelayMs = 140
    ) {}

    bind(): void {
        if (this.bound || !this.input) return;
        this.bound = true;
        this.input.addEventListener('input', this.handleInput);
        this.input.addEventListener('keydown', this.handleKeydown);
        this.input.addEventListener('blur', this.handleBlur);
        this.list?.addEventListener('pointerdown', this.handlePointerDown);
        this.list?.addEventListener('click', this.handleClick);
    }

    hide = (): void => {
        this.cancelPendingSearch();
        if (this.list) {
            this.list.hidden = true;
            this.list.replaceChildren();
        }
        this.input?.setAttribute('aria-expanded', 'false');
        this.input?.removeAttribute('aria-activedescendant');
        this.activeIndex = -1;
    };

    private cancelPendingSearch(): void {
        this.requestId++;
        if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
        this.searchTimer = undefined;
    }

    private handleInput = (): void => {
        if (!this.input) return;
        this.cancelPendingSearch();
        const query = this.input.value.slice(this.input.value.lastIndexOf(',') + 1).trim();
        const requestId = this.requestId;
        if (query.length < 2) {
            this.hide();
            return;
        }
        this.searchTimer = window.setTimeout(() => void this.search(query, requestId), this.debounceMs);
    };

    private async search(query: string, requestId: number): Promise<void> {
        try {
            const rows = await this.options.search.search(query);
            if (requestId !== this.requestId) return;
            this.render(rows, query);
        } catch (error) {
            this.options.onError?.(error);
            if (requestId === this.requestId) this.hide();
        }
    }

    private render(rows: readonly PlayerSuggestion[], query: string): void {
        if (!this.list || !this.input) return;
        const suggestions = filterParticipantSuggestions(rows, query, this.options.getCurrentParticipantNames());
        this.list.replaceChildren();
        this.activeIndex = -1;
        if (!suggestions.length) {
            this.hide();
            return;
        }

        suggestions.forEach((player, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.id = `player-suggestion-${index}`;
            option.className = 'player-suggestion-option';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.dataset.playerName = player.name;
            option.textContent = player.name;
            this.list?.appendChild(option);
        });
        this.list.hidden = false;
        this.input.setAttribute('aria-expanded', 'true');
    }

    private handleKeydown = (event: KeyboardEvent): void => {
        const options = [...(this.list?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])];
        if (event.key === 'ArrowDown' && options.length) {
            event.preventDefault();
            this.setActive(this.activeIndex + 1, options);
        } else if (event.key === 'ArrowUp' && options.length) {
            event.preventDefault();
            this.setActive(this.activeIndex < 0 ? options.length - 1 : this.activeIndex - 1, options);
        } else if (event.key === 'Enter') {
            const selectedName = options[this.activeIndex]?.dataset.playerName;
            if (selectedName) {
                event.preventDefault();
                this.select(selectedName);
            } else {
                this.options.onSubmit();
            }
        } else if (event.key === 'Escape') {
            this.hide();
        }
    };

    private setActive(index: number, options: HTMLButtonElement[]): void {
        if (!options.length) return;
        this.activeIndex = (index + options.length) % options.length;
        options.forEach((option, optionIndex) => {
            const isActive = optionIndex === this.activeIndex;
            option.setAttribute('aria-selected', String(isActive));
            option.classList.toggle('active', isActive);
        });
        const activeOption = options[this.activeIndex];
        this.input?.setAttribute('aria-activedescendant', activeOption.id);
        activeOption.scrollIntoView({ block: 'nearest' });
    }

    private select(name: string | undefined): void {
        if (!name || !this.input) return;
        const value = this.input.value;
        const lastComma = value.lastIndexOf(',');
        const prefix = lastComma >= 0 ? `${value.slice(0, lastComma + 1).trimEnd()} ` : '';
        this.input.value = `${prefix}${name}`;
        this.input.focus();
        this.hide();
    }

    private handlePointerDown = (event: PointerEvent): void => {
        if (event.target instanceof Element && event.target.closest('[role="option"]')) event.preventDefault();
    };

    private handleClick = (event: MouseEvent): void => {
        if (!(event.target instanceof Element)) return;
        const option = event.target.closest<HTMLButtonElement>('[role="option"]');
        if (option) this.select(option.dataset.playerName);
    };

    private handleBlur = (): void => {
        if (this.blurTimer !== undefined) window.clearTimeout(this.blurTimer);
        this.blurTimer = window.setTimeout(this.hide, this.blurDelayMs);
    };
}
