import { App, Modal } from 'obsidian';
import { GhostPostResult } from './types';

/**
 * Confirmation dialog for pulling a post's latest content from Ghost back into
 * the local note. Because this overwrites the note body, we make the
 * consequences explicit before doing it.
 */
export class SyncModal extends Modal {
    private post: GhostPostResult;
    private lastSeenUpdatedAt?: string;
    private onConfirm: () => void;

    constructor(app: App, post: GhostPostResult, lastSeenUpdatedAt: string | undefined, onConfirm: () => void) {
        super(app);
        this.post = post;
        this.lastSeenUpdatedAt = lastSeenUpdatedAt;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ghosty-posty-modal');

        contentEl.createEl('h2', { text: 'Sync from Ghost' });

        const info = contentEl.createDiv({ cls: 'ghosty-posty-details' });

        const titleField = info.createDiv({ cls: 'ghosty-posty-field' });
        titleField.createEl('strong', { text: 'Post: ' });
        titleField.createEl('span', { text: this.post.title });

        const statusField = info.createDiv({ cls: 'ghosty-posty-field' });
        statusField.createEl('strong', { text: 'Status: ' });
        statusField.createEl('span', { text: this.post.status });

        const updatedField = info.createDiv({ cls: 'ghosty-posty-field' });
        updatedField.createEl('strong', { text: 'Last edited on Ghost: ' });
        updatedField.createEl('span', { text: this.formatDate(this.post.updated_at) });

        const changedOnServer = this.lastSeenUpdatedAt !== undefined && this.lastSeenUpdatedAt !== this.post.updated_at;

        const warning = contentEl.createDiv({ cls: 'ghosty-posty-callout is-warning' });
        warning.createDiv({ text: 'Before you sync' });
        const list = warning.createEl('ul');
        list.createEl('li', {
            text: 'This replaces the note’s content with the version currently on Ghost. Any unsaved local edits to the body will be lost.'
        });
        list.createEl('li', {
            text: 'Tracked frontmatter (title, status, tags, visibility) will be refreshed from Ghost.'
        });
        if (changedOnServer) {
            list.createEl('li', {
                text: 'The post has changed on Ghost since you last published or synced it.'
            });
        }

        const buttonContainer = contentEl.createDiv({ cls: 'ghosty-posty-buttons' });

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.close());

        const confirmButton = buttonContainer.createEl('button', {
            text: 'Sync from Ghost',
            cls: 'mod-cta'
        });
        confirmButton.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
    }

    private formatDate(isoDate: string): string {
        try {
            return new Date(isoDate).toLocaleString();
        } catch {
            return isoDate;
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
