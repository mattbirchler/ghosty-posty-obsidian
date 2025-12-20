import { App, Modal, Setting, Notice } from 'obsidian';
import { PostMetadata, GhostPostPayload, PostStatus } from './types';
import { GhostAPI } from './ghost-api';
import { ConversionResult } from './markdown-converter';

export class PublishModal extends Modal {
    private metadata: PostMetadata;
    private html: string;
    private warnings: string[];
    private ghostUrl: string;
    private apiKey: string;
    private onSuccess: (postUrl: string) => void;

    constructor(
        app: App,
        metadata: PostMetadata,
        conversionResult: ConversionResult,
        ghostUrl: string,
        apiKey: string,
        onSuccess: (postUrl: string) => void
    ) {
        super(app);
        this.metadata = metadata;
        this.html = conversionResult.html;
        this.warnings = conversionResult.warnings;
        this.ghostUrl = ghostUrl;
        this.apiKey = apiKey;
        this.onSuccess = onSuccess;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ghosty-posty-modal');

        contentEl.createEl('h2', { text: 'Publish to Ghost' });

        // Metadata preview section
        const previewSection = contentEl.createDiv({ cls: 'ghosty-posty-preview' });
        previewSection.createEl('h3', { text: 'Post Details' });

        // Title
        const titleDiv = previewSection.createDiv({ cls: 'ghosty-posty-field' });
        titleDiv.createEl('strong', { text: 'Title: ' });
        titleDiv.createEl('span', { text: this.metadata.title });

        // Slug (if set)
        if (this.metadata.slug) {
            const slugDiv = previewSection.createDiv({ cls: 'ghosty-posty-field' });
            slugDiv.createEl('strong', { text: 'Slug: ' });
            slugDiv.createEl('span', { text: this.metadata.slug });
        }

        // Tags
        if (this.metadata.tags.length > 0) {
            const tagsDiv = previewSection.createDiv({ cls: 'ghosty-posty-field' });
            tagsDiv.createEl('strong', { text: 'Tags: ' });
            tagsDiv.createEl('span', { text: this.metadata.tags.join(', ') });
        }

        // Status
        const statusDiv = previewSection.createDiv({ cls: 'ghosty-posty-field' });
        statusDiv.createEl('strong', { text: 'Status: ' });
        const statusText = this.getStatusDisplayText();
        statusDiv.createEl('span', { text: statusText });

        // Scheduled date (if applicable)
        if (this.metadata.status === 'scheduled' && this.metadata.publishedAt) {
            const dateDiv = previewSection.createDiv({ cls: 'ghosty-posty-field' });
            dateDiv.createEl('strong', { text: 'Scheduled for: ' });
            dateDiv.createEl('span', { text: this.formatDate(this.metadata.publishedAt) });
        }

        // Warnings section
        if (this.warnings.length > 0) {
            const warningsSection = contentEl.createDiv({ cls: 'ghosty-posty-warnings' });
            warningsSection.createEl('h3', { text: 'Warnings' });
            const warningsList = warningsSection.createEl('ul');
            for (const warning of this.warnings) {
                warningsList.createEl('li', { text: warning });
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'ghosty-posty-buttons' });

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.close());

        const publishButton = buttonContainer.createEl('button', {
            text: 'Publish',
            cls: 'mod-cta'
        });
        publishButton.addEventListener('click', () => this.publish());
    }

    private getStatusDisplayText(): string {
        switch (this.metadata.status) {
            case 'draft':
                return 'Draft (not visible to readers)';
            case 'published':
                return 'Published (visible immediately)';
            case 'scheduled':
                return 'Scheduled';
            default:
                return this.metadata.status;
        }
    }

    private formatDate(isoDate: string): string {
        try {
            const date = new Date(isoDate);
            return date.toLocaleString();
        } catch {
            return isoDate;
        }
    }

    private async publish() {
        const { contentEl } = this;

        // Show loading state
        const buttons = contentEl.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.setAttribute('disabled', 'true');
        });
        const publishBtn = buttons[buttons.length - 1];
        publishBtn.textContent = 'Publishing...';

        try {
            const api = new GhostAPI(this.ghostUrl, this.apiKey);

            const payload: GhostPostPayload = {
                posts: [{
                    title: this.metadata.title,
                    html: this.html,
                    status: this.metadata.status,
                    ...(this.metadata.slug && { slug: this.metadata.slug }),
                    ...(this.metadata.tags.length > 0 && {
                        tags: this.metadata.tags.map(name => ({ name }))
                    }),
                    ...(this.metadata.publishedAt && { published_at: this.metadata.publishedAt })
                }]
            };

            const result = await api.createPost(payload);

            if (result.success) {
                new Notice(`Post published successfully!`);
                this.onSuccess(result.post.url);
                this.close();
            } else {
                new Notice(`Failed to publish: ${result.error}`);
                // Re-enable buttons
                buttons.forEach(btn => {
                    btn.removeAttribute('disabled');
                });
                publishBtn.textContent = 'Publish';
            }
        } catch (error) {
            new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Re-enable buttons
            buttons.forEach(btn => {
                btn.removeAttribute('disabled');
            });
            publishBtn.textContent = 'Publish';
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
