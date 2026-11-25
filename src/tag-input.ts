import { AbstractInputSuggest, App } from 'obsidian';

/**
 * Suggests tags that already exist on the Ghost site, so a post reuses
 * "macOS" instead of quietly creating "Mac OS".
 */
class TagSuggest extends AbstractInputSuggest<string> {
    constructor(
        app: App,
        inputEl: HTMLInputElement,
        private candidates: () => string[],
        private onPick: (tag: string) => void
    ) {
        super(app, inputEl);
        this.limit = 8;
    }

    protected getSuggestions(query: string): string[] {
        const q = query.trim().toLowerCase();
        // Ghost's internal tags (#like-this) only show up when asked for
        const matches = this.candidates().filter((tag) =>
            tag.toLowerCase().includes(q) && (q.startsWith('#') || !tag.startsWith('#')));
        // Tags that start with what was typed come first
        return matches.sort((a, b) => {
            const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
            const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
            return aStarts - bStarts || a.localeCompare(b);
        });
    }

    renderSuggestion(tag: string, el: HTMLElement): void {
        el.setText(tag);
    }

    selectSuggestion(tag: string): void {
        this.onPick(tag);
        this.close();
    }
}

/**
 * A tag field that shows each tag as a removable chip, with autocomplete
 * from the site's existing tags.
 */
export class TagInput {
    private tags: string[];
    private wrapEl: HTMLElement;
    private inputEl: HTMLInputElement;

    constructor(
        app: App,
        parentEl: HTMLElement,
        initial: string[],
        private existingTags: () => string[],
        inputId: string
    ) {
        this.tags = [];
        this.wrapEl = parentEl.createDiv({ cls: 'ghosty-posty-tags' });
        this.inputEl = this.wrapEl.createEl('input', {
            type: 'text',
            cls: 'ghosty-posty-tags-input',
            attr: { id: inputId, placeholder: 'Add tag', autocomplete: 'off' }
        });

        // Clicking anywhere in the box focuses the text input
        this.wrapEl.addEventListener('click', (evt) => {
            if (evt.target === this.wrapEl) {
                this.inputEl.focus();
            }
        });

        this.inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === ',') {
                evt.preventDefault();
                this.commitTyped();
            } else if (evt.key === 'Enter') {
                evt.preventDefault();
                // Let the suggestion list handle Enter first. If it picked a
                // tag the input is empty by now and this does nothing.
                window.setTimeout(() => this.commitTyped(), 0);
            } else if (evt.key === 'Backspace' && this.inputEl.value === '' && this.tags.length > 0) {
                this.remove(this.tags[this.tags.length - 1]);
            }
        });

        // Pasting "a, b, c" adds three tags
        this.inputEl.addEventListener('input', () => {
            if (this.inputEl.value.includes(',')) {
                this.commitTyped();
            }
        });

        new TagSuggest(
            app,
            this.inputEl,
            () => {
                const chosen = new Set(this.tags.map((t) => t.toLowerCase()));
                return this.existingTags().filter((t) => !chosen.has(t.toLowerCase()));
            },
            (tag) => {
                this.inputEl.value = '';
                this.add(tag);
                this.inputEl.focus();
            }
        );

        for (const tag of initial) {
            this.add(tag);
        }
    }

    /**
     * The chosen tags, including anything typed but not yet turned into a
     * chip (so pressing Publish straight after typing a tag still counts it).
     */
    getTags(): string[] {
        this.commitTyped();
        return [...this.tags];
    }

    private commitTyped(): void {
        const typed = this.inputEl.value;
        this.inputEl.value = '';
        for (const part of typed.split(',')) {
            this.add(part);
        }
    }

    private add(raw: string): void {
        const typed = raw.trim();
        if (typed === '') {
            return;
        }
        if (this.tags.some((t) => t.toLowerCase() === typed.toLowerCase())) {
            return;
        }
        // Prefer the spelling already used on the site
        const existing = this.existingTags().find((t) => t.toLowerCase() === typed.toLowerCase());
        this.tags.push(existing ?? typed);
        this.renderChips();
    }

    private remove(tag: string): void {
        this.tags = this.tags.filter((t) => t !== tag);
        this.renderChips();
    }

    private renderChips(): void {
        this.wrapEl.querySelectorAll('.ghosty-posty-tag').forEach((el) => el.remove());
        for (const tag of this.tags) {
            const chip = createSpan({ cls: 'ghosty-posty-tag', text: tag });
            const removeButton = chip.createEl('button', {
                cls: 'ghosty-posty-tag-remove',
                text: '×',
                attr: { type: 'button', 'aria-label': `Remove tag ${tag}` }
            });
            removeButton.addEventListener('click', () => {
                this.remove(tag);
                this.inputEl.focus();
            });
            this.wrapEl.insertBefore(chip, this.inputEl);
        }
    }
}
