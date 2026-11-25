import { Modal, Setting, TFile } from 'obsidian';
import type GhostyPostyPlugin from './main';
import {
    DeliveryMode,
    GhostNewsletter,
    GhostPost,
    GhostPostPayload,
    GhostPostResult,
    PostMetadata,
    PostStatus,
    ServerPostStatus
} from './types';
import { GhostAPI, PublishOptions } from './ghost-api';
import { ConversionResult, removeImages, replaceImageUrls } from './markdown-converter';
import { ImageList } from './image-list';
import { TagInput } from './tag-input';
import {
    EXCERPT_MAX_LENGTH,
    FEATURE_ALT_MAX_LENGTH,
    FormValues,
    canEmail,
    formatPeople,
    formatWhen,
    initialFormValues,
    publishButtonLabel,
    statusChoices
} from './publish-logic';

/** What the modal hands back after a successful save. */
export interface PublishResult {
    post: GhostPostResult;
    /** Status on Ghost before this save; undefined for a new post. */
    previousStatus?: ServerPostStatus;
    emailed: boolean;
    recipients?: number;
    /** The values the user confirmed, for writing back to frontmatter. */
    values: FormValues;
}

const SERVER_STATUS_BADGES: Record<ServerPostStatus, string> = {
    draft: 'Draft on Ghost',
    published: 'Published on Ghost',
    scheduled: 'Scheduled on Ghost',
    sent: 'Emailed'
};

export class PublishModal extends Modal {
    private readonly api: GhostAPI;
    private readonly isUpdate: boolean;

    /** The post as it is on Ghost right now (update mode only). */
    private serverPost: GhostPostResult | undefined;
    /** The post changed on Ghost since this note last saw it. */
    private conflict = false;

    private values!: FormValues;
    private deliveryMode: DeliveryMode = 'post';
    private newsletters: GhostNewsletter[] = [];
    private selectedNewsletterSlug = '';

    private images!: ImageList;
    private tagInput: TagInput | null = null;

    private busy = false;
    /** The user has already confirmed the email for the current choices. */
    private emailConfirmed = false;
    private uploadFailed = false;

    // UI elements
    private mainEl!: HTMLElement;
    private confirmEl!: HTMLElement;
    private formEl: HTMLElement | null = null;
    private scheduleEl: HTMLElement | null = null;
    private deliveryEl: HTMLElement | null = null;
    private segmentButtons = new Map<PostStatus, HTMLButtonElement>();
    private imageProblemEl: HTMLElement | null = null;
    private progressEl: HTMLElement | null = null;
    private progressBarEl: HTMLElement | null = null;
    private progressTextEl: HTMLElement | null = null;
    private errorEl: HTMLElement | null = null;
    private primaryButton: HTMLButtonElement | null = null;
    private cancelButton: HTMLButtonElement | null = null;

    constructor(
        private plugin: GhostyPostyPlugin,
        private sourceFile: TFile,
        private metadata: PostMetadata,
        private conversionResult: ConversionResult,
        private onSuccess: (result: PublishResult) => void,
        private onSyncRequested: () => void
    ) {
        super(plugin.app);
        this.api = plugin.createApi();
        this.isUpdate = metadata.existing !== undefined;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ghosty-posty-modal');

        this.mainEl = contentEl.createDiv();
        this.confirmEl = contentEl.createDiv({ cls: 'ghosty-posty-confirm' });
        this.confirmEl.hide();

        if (this.isUpdate) {
            void this.loadServerPost();
        } else {
            this.renderForm();
        }
    }

    onClose() {
        this.contentEl.empty();
    }

    // ------------------------------------------------------------------
    // Loading the post from Ghost (update mode)
    // ------------------------------------------------------------------

    /**
     * Fetch the post before showing the form, so the form starts from what is
     * actually on Ghost (most importantly its status) and a conflict with web
     * edits is visible before anything is sent.
     */
    private async loadServerPost(): Promise<void> {
        const existing = this.metadata.existing;
        if (!existing) {
            return;
        }

        this.mainEl.empty();
        this.renderHeader('Update on Ghost');
        this.mainEl.createDiv({ cls: 'ghosty-posty-loading', text: 'Checking the post on Ghost...' });

        const result = await this.api.getPost(existing.id);
        if (!this.mainEl.isConnected) {
            return; // modal was closed while loading
        }

        if (!result.success) {
            this.renderLoadError(result.error, result.status === 404);
            return;
        }

        this.serverPost = result.post;
        this.conflict = existing.updatedAt !== undefined && existing.updatedAt !== result.post.updated_at;
        this.renderForm();
    }

    private renderLoadError(error: string, notFound: boolean): void {
        this.mainEl.empty();
        this.renderHeader('Update on Ghost');

        const callout = this.mainEl.createDiv({ cls: 'ghosty-posty-callout is-error' });
        if (notFound) {
            callout.createDiv({ text: 'This post no longer exists on Ghost.' });
            callout.createDiv({
                cls: 'ghosty-posty-callout-detail',
                text: 'To publish this note as a new post, remove ghost_id from its properties and try again.'
            });
        } else {
            callout.createDiv({ text: 'Could not load this post from Ghost.' });
            callout.createDiv({ cls: 'ghosty-posty-callout-detail', text: error });
        }

        const footer = this.mainEl.createDiv({ cls: 'ghosty-posty-buttons' });
        footer.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());
        if (!notFound) {
            const retry = footer.createEl('button', { text: 'Try again', cls: 'mod-cta' });
            retry.addEventListener('click', () => {
                void this.loadServerPost();
            });
        }
    }

    // ------------------------------------------------------------------
    // The form
    // ------------------------------------------------------------------

    private renderHeader(title: string): void {
        const header = this.mainEl.createDiv({ cls: 'ghosty-posty-header' });
        header.createEl('h2', { text: title });

        const badges = header.createDiv({ cls: 'ghosty-posty-badges' });
        if (this.serverPost) {
            badges.createSpan({
                cls: `ghosty-posty-badge is-${this.serverPost.status}`,
                text: SERVER_STATUS_BADGES[this.serverPost.status] ?? 'On Ghost'
            });
        } else if (!this.isUpdate) {
            badges.createSpan({ cls: 'ghosty-posty-badge', text: 'New post' });
        }
        if (this.conflict) {
            badges.createSpan({ cls: 'ghosty-posty-badge is-warning', text: 'Changed on Ghost' });
        }
    }

    private renderForm(): void {
        this.values = initialFormValues(this.metadata, this.serverPost, new Date());
        this.images = new ImageList(
            this.app,
            this.sourceFile,
            this.plugin.imageMemory,
            this.conversionResult.featuredImage,
            this.conversionResult.images
        );

        this.mainEl.empty();
        this.renderHeader(this.isUpdate ? 'Update on Ghost' : 'Publish to Ghost');

        if (this.conflict && this.serverPost) {
            this.renderConflict(this.serverPost);
        }

        if (this.conversionResult.warnings.length > 0) {
            const warnings = this.mainEl.createDiv({ cls: 'ghosty-posty-callout is-warning' });
            for (const warning of this.conversionResult.warnings) {
                warnings.createDiv({ text: warning });
            }
        }

        const form = this.mainEl.createDiv({ cls: 'ghosty-posty-form' });
        this.formEl = form;

        // Title
        const titleInput = this.field(form, 'Title', 'ghosty-posty-title').createEl('input', {
            type: 'text',
            attr: { id: 'ghosty-posty-title' }
        });
        titleInput.value = this.values.title;
        titleInput.addEventListener('input', () => {
            this.values.title = titleInput.value;
        });

        // Excerpt
        const excerptField = this.field(form, 'Excerpt', 'ghosty-posty-excerpt');
        const excerptInput = excerptField.createEl('textarea', {
            attr: {
                id: 'ghosty-posty-excerpt',
                rows: '2',
                placeholder: 'Shown on your home page, in email previews and when shared'
            }
        });
        excerptInput.value = this.values.excerpt;
        const excerptCount = excerptField.createDiv({ cls: 'ghosty-posty-count' });
        const paintExcerptCount = () => {
            const length = this.values.excerpt.trim().length;
            excerptCount.setText(length > 0 ? `${length} / ${EXCERPT_MAX_LENGTH}` : '');
            excerptCount.toggleClass('is-error', length > EXCERPT_MAX_LENGTH);
        };
        excerptInput.addEventListener('input', () => {
            this.values.excerpt = excerptInput.value;
            paintExcerptCount();
        });
        paintExcerptCount();

        // Tags
        this.tagInput = new TagInput(
            this.app,
            this.field(form, 'Tags', 'ghosty-posty-tags-input'),
            this.values.tags,
            () => this.plugin.siteCache.tags,
            'ghosty-posty-tags-input'
        );

        // Draft / publish / schedule
        const choices = statusChoices(this.serverPost?.status);
        this.segmentButtons.clear();
        if (choices.length > 0) {
            const segment = form.createDiv({
                cls: 'ghosty-posty-segment',
                attr: { role: 'group', 'aria-label': 'What to do with this post' }
            });
            for (const choice of choices) {
                const button = segment.createEl('button', { text: choice.label, attr: { type: 'button' } });
                button.addEventListener('click', () => this.setStatus(choice.value));
                this.segmentButtons.set(choice.value, button);
            }
        }

        // Schedule date (only shown when scheduling)
        this.scheduleEl = form.createDiv({ cls: 'ghosty-posty-schedule-picker' });
        new Setting(this.scheduleEl)
            .setName('Publish on')
            .setDesc('Your local time')
            .addText((text) => {
                text.inputEl.type = 'datetime-local';
                text.setValue(this.values.scheduledAt);
                text.onChange((value) => {
                    this.values.scheduledAt = value;
                    this.refreshPrimary();
                });
            });

        // Visibility
        new Setting(form)
            .setName('Who can read it')
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('public', 'Everyone')
                    .addOption('members', 'Members only')
                    .addOption('paid', 'Paid members only');
                if (this.values.visibility === 'tiers') {
                    dropdown.addOption('tiers', 'Specific tiers (set on Ghost)');
                }
                dropdown
                    .setValue(this.values.visibility)
                    .onChange((value) => {
                        this.values.visibility = value as FormValues['visibility'];
                    });
            });

        // Email delivery. Starts from the cached newsletter list so the row
        // doesn't pop in late, then refreshes in the background.
        this.deliveryEl = form.createDiv({ cls: 'ghosty-posty-delivery' });
        this.setNewsletters(this.plugin.siteCache.newsletters);
        void this.plugin.refreshNewsletters().then((fresh) => {
            if (this.mainEl.isConnected && !this.busy && JSON.stringify(fresh) !== JSON.stringify(this.newsletters)) {
                this.setNewsletters(fresh);
            }
        });
        void this.plugin.refreshTags();

        // Rarely used options
        const more = form.createEl('details', { cls: 'ghosty-posty-more' });
        more.createEl('summary', { text: 'More: URL slug, featured post' });
        new Setting(more)
            .setName('URL slug')
            .setDesc(this.isUpdate ? 'Changing this changes the address of the post' : 'Leave empty to let Ghost create one from the title')
            .addText((text) => text
                .setValue(this.values.slug)
                .onChange((value) => {
                    this.values.slug = value.trim();
                }));
        new Setting(more)
            .setName('Featured')
            .setDesc('Highlight this post on your site')
            .addToggle((toggle) => toggle
                .setValue(this.values.featured)
                .onChange((value) => {
                    this.values.featured = value;
                }));

        // Images
        if (this.images.count > 0) {
            const imagesEl = this.mainEl.createDiv({ cls: 'ghosty-posty-images' });
            this.images.render(imagesEl);
        }
        this.imageProblemEl = this.mainEl.createDiv();

        // Progress and errors
        this.progressEl = this.mainEl.createDiv({ cls: 'ghosty-posty-progress' });
        this.progressTextEl = this.progressEl.createDiv({ cls: 'ghosty-posty-progress-text' });
        this.progressBarEl = this.progressEl
            .createDiv({ cls: 'ghosty-posty-progress-track' })
            .createDiv({ cls: 'ghosty-posty-progress-bar' });
        this.progressEl.hide();

        this.errorEl = this.mainEl.createDiv({ cls: 'ghosty-posty-callout is-error', attr: { role: 'alert' } });
        this.errorEl.hide();

        // Buttons
        const footer = this.mainEl.createDiv({ cls: 'ghosty-posty-buttons' });
        this.cancelButton = footer.createEl('button', { text: 'Cancel' });
        this.cancelButton.addEventListener('click', () => this.close());
        this.primaryButton = footer.createEl('button', { cls: 'mod-cta' });
        this.primaryButton.addEventListener('click', () => this.onPrimary());

        this.setStatus(this.values.status);
        this.renderImageProblems();
    }

    /** A labelled, full-width field. */
    private field(parent: HTMLElement, label: string, inputId: string): HTMLElement {
        const el = parent.createDiv({ cls: 'ghosty-posty-input' });
        el.createEl('label', { text: label, attr: { for: inputId } });
        return el;
    }

    private renderConflict(serverPost: GhostPostResult): void {
        const callout = this.mainEl.createDiv({ cls: 'ghosty-posty-callout is-error' });
        const when = formatWhen(serverPost.updated_at);
        callout.createDiv({
            text: `This post was edited on Ghost${when ? ` on ${when}` : ''}, after you last published or synced this note.`
        });
        callout.createDiv({
            cls: 'ghosty-posty-callout-detail',
            text: 'Updating from this note replaces those edits.'
        });
        const syncButton = callout.createEl('button', { text: 'Sync from Ghost first' });
        syncButton.addEventListener('click', () => {
            this.close();
            this.onSyncRequested();
        });
    }

    private setStatus(status: PostStatus): void {
        this.values.status = status;
        this.emailConfirmed = false;
        for (const [value, button] of this.segmentButtons) {
            button.toggleClass('is-active', value === status);
            button.setAttribute('aria-pressed', String(value === status));
        }
        this.scheduleEl?.toggleClass('is-hidden', status !== 'scheduled');
        this.refreshDelivery();
        this.refreshPrimary();
    }

    // ------------------------------------------------------------------
    // Email delivery
    // ------------------------------------------------------------------

    private get selectedNewsletter(): GhostNewsletter | undefined {
        return this.newsletters.find((n) => n.slug === this.selectedNewsletterSlug);
    }

    /** Subscriber count of the chosen newsletter, when Ghost reports it. */
    private get recipients(): number | undefined {
        return this.selectedNewsletter?.count?.active_members;
    }

    private get willEmail(): boolean {
        return this.deliveryMode !== 'post' &&
            this.selectedNewsletter !== undefined &&
            canEmail(this.serverPost?.status, this.values.status);
    }

    private setNewsletters(newsletters: GhostNewsletter[]): void {
        this.newsletters = newsletters;
        if (!this.selectedNewsletter) {
            this.selectedNewsletterSlug = newsletters[0]?.slug ?? '';
        }
        this.renderDelivery();
    }

    private renderDelivery(): void {
        const el = this.deliveryEl;
        if (!el) {
            return;
        }
        el.empty();
        if (this.newsletters.length === 0) {
            this.deliveryMode = 'post';
            this.refreshDelivery();
            return;
        }

        const emailSetting = new Setting(el)
            .setName('Email')
            .addDropdown((dropdown) => dropdown
                .addOption('post', 'Do not email')
                .addOption('post_and_newsletter', 'Publish and email')
                .addOption('newsletter_only', 'Email only')
                .setValue(this.deliveryMode)
                .onChange((value) => {
                    this.deliveryMode = value as DeliveryMode;
                    this.emailConfirmed = false;
                    this.refreshPrimary();
                }));

        const describe = () => {
            const newsletter = this.selectedNewsletter;
            if (!newsletter) {
                return;
            }
            const count = newsletter.count?.active_members;
            emailSetting.setDesc(
                count === undefined
                    ? newsletter.name
                    : `${newsletter.name} · ${count.toLocaleString()} ${count === 1 ? 'subscriber' : 'subscribers'}`
            );
        };
        describe();

        if (this.newsletters.length > 1) {
            new Setting(el)
                .setName('Newsletter')
                .addDropdown((dropdown) => {
                    for (const newsletter of this.newsletters) {
                        dropdown.addOption(newsletter.slug, newsletter.name);
                    }
                    dropdown.setValue(this.selectedNewsletterSlug);
                    dropdown.onChange((value) => {
                        this.selectedNewsletterSlug = value;
                        this.emailConfirmed = false;
                        describe();
                        this.refreshPrimary();
                    });
                });
        }

        this.refreshDelivery();
        this.refreshPrimary();
    }

    /** Email is only on offer when the post is about to go out for the first time. */
    private refreshDelivery(): void {
        const available = this.newsletters.length > 0 && canEmail(this.serverPost?.status, this.values.status);
        this.deliveryEl?.toggleClass('is-hidden', !available);
    }

    // ------------------------------------------------------------------
    // Buttons, progress and errors
    // ------------------------------------------------------------------

    private refreshPrimary(): void {
        const button = this.primaryButton;
        if (!button) {
            return;
        }

        if (this.busy) {
            button.setText(this.isUpdate ? 'Updating...' : 'Publishing...');
        } else if (this.uploadFailed && this.images.hasFailed) {
            button.setText('Retry upload');
        } else {
            button.setText(publishButtonLabel({
                serverStatus: this.serverPost?.status,
                status: this.values.status,
                scheduledAt: this.values.scheduledAt,
                delivery: this.willEmail ? this.deliveryMode : 'post',
                recipients: this.recipients,
                conflict: this.conflict
            }));
        }

        // Overwriting web edits is destructive, so the button looks the part
        button.toggleClass('mod-warning', this.conflict && !this.busy);
        button.toggleClass('mod-cta', !this.conflict || this.busy);
        button.disabled = this.busy || this.images.hasMissing;
    }

    /**
     * Explain any image that blocks publishing (not in the vault, or failed
     * to upload) and offer to publish without it.
     */
    private renderImageProblems(): void {
        const el = this.imageProblemEl;
        if (!el) {
            return;
        }
        el.empty();

        const problems = this.images.problems;
        if (problems.length > 0) {
            const callout = el.createDiv({ cls: 'ghosty-posty-callout is-error' });
            const names = problems.map((p) => p.name).join(', ');
            const missing = problems.every((p) => p.state === 'missing');
            const one = problems.length === 1;

            if (missing) {
                callout.createDiv({ text: `${names} ${one ? 'is' : 'are'} not in your vault.` });
                callout.createDiv({
                    cls: 'ghosty-posty-callout-detail',
                    text: `Fix the ${one ? 'path' : 'paths'} in the note and reopen this window, or publish without ${one ? 'it' : 'them'}.`
                });
            } else {
                callout.createDiv({ text: `${names} could not be uploaded.` });
                callout.createDiv({
                    cls: 'ghosty-posty-callout-detail',
                    text: `${problems.find((p) => p.error)?.error ?? ''} The images that finished are kept, so a retry only sends what failed.`.trim()
                });
            }

            const skipButton = callout.createEl('button', { text: `Publish without ${one ? 'it' : 'them'}` });
            skipButton.addEventListener('click', () => {
                this.images.skipProblems();
                this.uploadFailed = false;
                this.renderImageProblems();
            });
        }

        this.refreshPrimary();
    }

    private setBusy(busy: boolean): void {
        this.busy = busy;
        if (this.formEl) {
            this.formEl.toggleClass('is-busy', busy);
            this.formEl.inert = busy;
        }
        if (this.imageProblemEl) {
            this.imageProblemEl.inert = busy;
        }
        if (this.cancelButton) {
            this.cancelButton.disabled = busy;
        }
        if (!busy) {
            this.progressEl?.hide();
        }
        this.refreshPrimary();
    }

    private setProgress(text: string, fraction: number): void {
        this.progressEl?.show();
        this.progressTextEl?.setText(text);
        if (this.progressBarEl) {
            this.progressBarEl.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
        }
    }

    private showError(message: string): void {
        if (this.errorEl) {
            this.errorEl.setText(message);
            this.errorEl.show();
        }
    }

    private clearError(): void {
        this.errorEl?.hide();
    }

    // ------------------------------------------------------------------
    // Publishing
    // ------------------------------------------------------------------

    private onPrimary(): void {
        this.clearError();
        this.values.tags = this.tagInput?.getTags() ?? this.values.tags;

        if (this.values.title.trim() === '') {
            this.showError('Add a title before publishing.');
            return;
        }
        if (this.values.excerpt.trim().length > EXCERPT_MAX_LENGTH) {
            this.showError(`The excerpt is too long. Ghost allows up to ${EXCERPT_MAX_LENGTH} characters.`);
            return;
        }
        if (this.values.status === 'scheduled') {
            const when = new Date(this.values.scheduledAt);
            if (isNaN(when.getTime())) {
                this.showError('Choose a date and time to schedule this post.');
                return;
            }
            if (when <= new Date()) {
                this.showError('The scheduled time has already passed. Choose a time in the future, or publish now.');
                return;
            }
        }

        // An email can't be recalled, so it always gets a second look.
        if (this.willEmail && !this.emailConfirmed) {
            this.showConfirm();
            return;
        }

        void this.publish();
    }

    /**
     * Swap the form for a confirmation that spells out who gets the email.
     */
    private showConfirm(): void {
        const newsletter = this.selectedNewsletter;
        if (!newsletter) {
            return;
        }
        const people = formatPeople(this.recipients);
        const emailOnly = this.deliveryMode === 'newsletter_only';
        const scheduled = this.values.status === 'scheduled';
        const when = scheduled ? formatWhen(this.values.scheduledAt) : '';
        const title = this.values.title.trim();

        const el = this.confirmEl;
        el.empty();
        el.createEl('h2', {
            text: this.recipients === undefined ? 'Send this by email?' : `Send this to ${people}?`
        });

        let summary: string;
        if (emailOnly) {
            summary = scheduled
                ? `"${title}" will be emailed to subscribers of ${newsletter.name} on ${when}. It will not appear on your site.`
                : `"${title}" will be emailed to subscribers of ${newsletter.name} now. It will not appear on your site.`;
        } else {
            summary = scheduled
                ? `"${title}" will be published on your site and emailed to subscribers of ${newsletter.name} on ${when}.`
                : `"${title}" will be published on your site and emailed to subscribers of ${newsletter.name} now.`;
        }
        el.createEl('p', { text: summary });

        const callout = el.createDiv({ cls: 'ghosty-posty-callout is-warning' });
        callout.createDiv({
            text: scheduled
                ? 'Once the email goes out it cannot be unsent. Until then you can unschedule the post.'
                : 'Emails cannot be unsent.'
        });
        if (!emailOnly) {
            callout.createDiv({
                cls: 'ghosty-posty-callout-detail',
                text: 'You can still edit the version on your site afterwards.'
            });
        }

        const footer = el.createDiv({ cls: 'ghosty-posty-buttons' });
        const back = footer.createEl('button', { text: 'Go back' });
        back.addEventListener('click', () => this.hideConfirm());

        let confirmLabel = emailOnly ? 'Send email' : 'Send and publish';
        if (scheduled) {
            confirmLabel = 'Schedule it';
        }
        const confirm = footer.createEl('button', { text: confirmLabel, cls: 'mod-cta' });
        confirm.addEventListener('click', () => {
            this.emailConfirmed = true;
            this.hideConfirm();
            void this.publish();
        });

        this.mainEl.hide();
        el.show();
        back.focus();
    }

    private hideConfirm(): void {
        this.confirmEl.hide();
        this.mainEl.show();
    }

    private async publish(): Promise<void> {
        this.clearError();
        this.setBusy(true);

        try {
            // 1. Images
            if (this.images.pendingCount > 0) {
                const ok = await this.images.uploadAll(this.api, (done, total) => {
                    this.setProgress(`Uploading images: ${done} of ${total} done`, total > 0 ? done / total : 1);
                });
                void this.plugin.saveCache();
                if (!ok) {
                    this.uploadFailed = true;
                    this.setBusy(false);
                    this.renderImageProblems();
                    return;
                }
            }
            this.uploadFailed = false;

            // 2. The post itself
            this.setProgress(this.isUpdate ? 'Sending changes to Ghost...' : 'Sending the post to Ghost...', 1);

            const willEmail = this.willEmail;
            const recipients = this.recipients;
            const payload = this.buildPayload(willEmail);
            const options: PublishOptions = {};
            if (willEmail) {
                options.newsletterSlug = this.selectedNewsletterSlug;
            }

            const existing = this.metadata.existing;
            const result = existing
                ? await this.api.updatePost(existing.id, payload, options)
                : await this.api.createPost(payload, options);

            if (!result.success) {
                this.setBusy(false);
                this.showError(result.error);
                return;
            }

            this.onSuccess({
                post: result.post,
                previousStatus: this.serverPost?.status,
                emailed: willEmail,
                recipients: willEmail ? recipients : undefined,
                values: { ...this.values }
            });
            this.close();
        } catch (error) {
            this.setBusy(false);
            this.showError(error instanceof Error ? error.message : 'Something went wrong while publishing.');
        }
    }

    private buildPayload(willEmail: boolean): GhostPostPayload {
        const { values } = this;

        let html = replaceImageUrls(this.conversionResult.html, this.images.urlMap);
        html = removeImages(html, this.images.skippedPaths);

        // An email-only post has no status to change, so leave it out.
        const sendStatus = this.serverPost?.status !== 'sent';

        // Publish date: the picker when scheduling. Otherwise a past date from
        // frontmatter can backdate a post, but only one that isn't live yet.
        let publishedAt: string | undefined;
        if (sendStatus && values.status === 'scheduled') {
            publishedAt = new Date(values.scheduledAt).toISOString();
        } else if (values.status === 'published' && this.serverPost?.status !== 'published' && this.metadata.publishedAt) {
            if (new Date(this.metadata.publishedAt) <= new Date()) {
                publishedAt = this.metadata.publishedAt;
            }
        }

        const featuredImage = this.images.featured;
        const excerpt = values.excerpt.trim();

        const post: GhostPost = {
            title: values.title.trim(),
            html,
            // Always sent, so the last tag can be removed and a post un-featured.
            tags: values.tags.map((name) => ({ name })),
            featured: values.featured,
            custom_excerpt: excerpt === '' ? null : excerpt,
            ...(sendStatus && { status: values.status }),
            ...(values.visibility !== 'tiers' && { visibility: values.visibility }),
            ...(values.slug && { slug: values.slug }),
            ...(publishedAt && { published_at: publishedAt }),
            ...(featuredImage && { feature_image: featuredImage.url }),
            ...(featuredImage && featuredImage.alt && {
                feature_image_alt: featuredImage.alt.slice(0, FEATURE_ALT_MAX_LENGTH)
            }),
            ...(willEmail && this.deliveryMode === 'newsletter_only' && { email_only: true }),
            // Ghost needs the current updated_at on an update to detect collisions.
            ...(this.serverPost && { updated_at: this.serverPost.updated_at })
        };

        return { posts: [post] };
    }
}
