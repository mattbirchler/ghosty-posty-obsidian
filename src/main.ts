import { Plugin, Notice, TFile, Menu, Editor, MarkdownView, htmlToMarkdown } from 'obsidian';
import {
    GhostyPostySettings,
    DEFAULT_SETTINGS,
    PostMetadata,
    PostStatus,
    PostVisibility,
    GhostNewsletter,
    GhostPostRef,
    GhostPostResult,
    FRONTMATTER_KEYS
} from './types';
import { GhostyPostySettingTab } from './settings';
import { PublishModal, PublishResult } from './publish-modal';
import { SyncModal } from './sync-modal';
import { GhostAPI } from './ghost-api';
import { ImageMemory } from './image-list';
import { convertMarkdownToHtml, stripFrontmatter } from './markdown-converter';
import { editorUrl, hashContent, shouldArchive, successMessage } from './publish-logic';

/**
 * Things the plugin remembers between sessions that aren't settings. Stored
 * under `cache` in the plugin's data file and safe to delete.
 */
interface PluginCache {
    /** The Ghost site this cache belongs to; it is cleared if the URL changes. */
    site: string;
    /** Vault image path -> where it lives on Ghost, valid while the file is unchanged. */
    images: Record<string, { mtime: number; size: number; url: string }>;
    /** Ghost post id -> fingerprint of the note body when it was last sent or synced. */
    pushed: Record<string, string>;
    newsletters: GhostNewsletter[];
    tags: string[];
}

function emptyCache(site: string): PluginCache {
    return { site, images: {}, pushed: {}, newsletters: [], tags: [] };
}

export default class GhostyPostyPlugin extends Plugin {
    settings: GhostyPostySettings;
    private cache: PluginCache = emptyCache('');

    /** Remembers which images are already on Ghost so updates skip them. */
    readonly imageMemory: ImageMemory = {
        lookup: (file) => {
            const entry = this.cache.images[file.path];
            return entry && entry.mtime === file.stat.mtime && entry.size === file.stat.size ? entry.url : undefined;
        },
        remember: (file, url) => {
            this.cache.images[file.path] = { mtime: file.stat.mtime, size: file.stat.size, url };
        }
    };

    async onload() {
        await this.loadSettings();

        // Command: publish / update the current note
        this.addCommand({
            id: 'publish-to-ghost',
            name: 'Publish to Ghost',
            editorCallback: (_editor, ctx) => {
                const file = ctx.file;
                if (file) {
                    void this.publishNote(file);
                }
            }
        });

        // Command: pull the latest version of a published note back from Ghost
        this.addCommand({
            id: 'sync-from-ghost',
            name: 'Sync from Ghost',
            editorCallback: (_editor, ctx) => {
                const file = ctx.file;
                if (file) {
                    void this.syncNote(file);
                }
            }
        });

        // Ribbon icon (Lucide "ghost") as a one-click entry point
        this.addRibbonIcon('ghost', 'Publish to Ghost', () => {
            const file = this.getActiveFile();
            if (file) {
                void this.publishNote(file);
            }
        });

        // Right-click in the file explorer
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.addMenuItems(menu, file);
                }
            })
        );

        // Right-click inside the editor
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu: Menu, _editor: Editor, view: MarkdownView) => {
                const file = view.file;
                if (file instanceof TFile && file.extension === 'md') {
                    this.addMenuItems(menu, file);
                }
            })
        );

        // Add settings tab
        this.addSettingTab(new GhostyPostySettingTab(this.app, this));
    }

    onunload() {
        // Cleanup handled by registerEvent / addCommand
    }

    async loadSettings() {
        const data = ((await this.loadData()) ?? {}) as Partial<GhostyPostySettings> & { cache?: Partial<PluginCache> };
        const { cache, ...settings } = data;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
        this.cache = Object.assign(emptyCache(this.settings.ghostUrl), cache);
        this.checkCacheSite();
    }

    async saveSettings() {
        this.checkCacheSite();
        await this.saveData({ ...this.settings, cache: this.cache });
    }

    async saveCache() {
        await this.saveData({ ...this.settings, cache: this.cache });
    }

    /** Uploaded image URLs, tags and newsletters belong to one site only. */
    private checkCacheSite(): void {
        if (this.cache.site !== this.settings.ghostUrl) {
            this.cache = emptyCache(this.settings.ghostUrl);
        }
    }

    createApi(): GhostAPI {
        return new GhostAPI(this.settings.ghostUrl, this.settings.apiKey);
    }

    /** The site's newsletters and tags as last seen, for instant display. */
    get siteCache(): { newsletters: GhostNewsletter[]; tags: string[] } {
        return this.cache;
    }

    async refreshNewsletters(): Promise<GhostNewsletter[]> {
        const result = await this.createApi().getNewsletters();
        if (!result.success) {
            return this.cache.newsletters;
        }
        const newsletters = result.newsletters.map(({ id, name, slug, status, count }) => ({ id, name, slug, status, count }));
        if (JSON.stringify(newsletters) !== JSON.stringify(this.cache.newsletters)) {
            this.cache.newsletters = newsletters;
            void this.saveCache();
        }
        return newsletters;
    }

    async refreshTags(): Promise<string[]> {
        const result = await this.createApi().getTags();
        if (!result.success) {
            return this.cache.tags;
        }
        if (JSON.stringify(result.tags) !== JSON.stringify(this.cache.tags)) {
            // Replace in place: open tag inputs read from this same array object
            this.cache.tags.splice(0, this.cache.tags.length, ...result.tags);
            void this.saveCache();
        }
        return this.cache.tags;
    }

    /**
     * Add the plugin's context-menu items for a given note.
     */
    private addMenuItems(menu: Menu, file: TFile): void {
        const isPublished = this.getExistingRef(file) !== undefined;

        menu.addItem((item) => {
            item
                .setTitle(isPublished ? 'Update on Ghost' : 'Publish to Ghost')
                .setIcon('ghost')
                .onClick(() => {
                    void this.publishNote(file);
                });
        });

        if (isPublished) {
            menu.addItem((item) => {
                item
                    .setTitle('Sync from Ghost')
                    .setIcon('download')
                    .onClick(() => {
                        void this.syncNote(file);
                    });
            });
        }
    }

    /**
     * Get the currently active markdown file, notifying the user if there isn't one.
     */
    private getActiveFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No file is currently open');
            return null;
        }
        if (activeFile.extension !== 'md') {
            new Notice('The current file is not a .md file');
            return null;
        }
        return activeFile;
    }

    /**
     * Read the reference to an already-published Ghost post from a note's frontmatter.
     */
    private getExistingRef(file: TFile): GhostPostRef | undefined {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter: Record<string, unknown> = cache?.frontmatter ?? {};
        const id = frontmatter[FRONTMATTER_KEYS.id];
        if (typeof id !== 'string' || id === '') {
            return undefined;
        }
        const updatedAt = frontmatter[FRONTMATTER_KEYS.updatedAt];
        return {
            id,
            updatedAt: typeof updatedAt === 'string' ? updatedAt : undefined
        };
    }

    /**
     * Extract post metadata from frontmatter
     */
    private getPostMetadata(file: TFile): PostMetadata {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter: Record<string, unknown> = cache?.frontmatter ?? {};

        // Get title from frontmatter or filename
        const title = typeof frontmatter.title === 'string' && frontmatter.title !== ''
            ? frontmatter.title
            : file.basename;

        // Get slug from frontmatter
        const slug = typeof frontmatter.slug === 'string' ? frontmatter.slug : undefined;

        // Tags from frontmatter. Left undefined when the note has no tags
        // property, so an update keeps the tags that are on Ghost.
        let tags: string[] | undefined;
        if (Array.isArray(frontmatter.tags)) {
            tags = frontmatter.tags.map(String);
        } else if (typeof frontmatter.tags === 'string') {
            // Handle comma-separated string
            tags = frontmatter.tags.split(',').map((t) => t.trim()).filter((t) => t !== '');
        }

        // Determine status and scheduled date
        const rawStatus = frontmatter.status;
        let status: PostStatus = rawStatus === 'draft' || rawStatus === 'published' || rawStatus === 'scheduled'
            ? rawStatus
            : this.settings.defaultStatus;
        let publishedAt: string | undefined;

        // Check for scheduled publishing
        const scheduledDate = frontmatter.publish_date ?? frontmatter.date;
        if (typeof scheduledDate === 'string' || typeof scheduledDate === 'number' || scheduledDate instanceof Date) {
            const date = new Date(scheduledDate);
            const now = new Date();

            if (isNaN(date.getTime())) {
                // Not a date we can read: ignore it
            } else if (date > now) {
                // Future date - schedule the post
                status = 'scheduled';
                publishedAt = date.toISOString();
            } else if (status === 'published') {
                // Past date with published status - use that date
                publishedAt = date.toISOString();
            }
        }

        // Visibility (public | members | paid)
        const rawVisibility = frontmatter.visibility;
        const visibility: PostVisibility | undefined =
            rawVisibility === 'members' || rawVisibility === 'paid' || rawVisibility === 'public'
                ? rawVisibility
                : undefined;

        const rawExcerpt = frontmatter.excerpt ?? frontmatter.custom_excerpt;

        return {
            title,
            slug,
            tags,
            status,
            publishedAt,
            visibility,
            excerpt: typeof rawExcerpt === 'string' ? rawExcerpt : undefined,
            featured: typeof frontmatter.featured === 'boolean' ? frontmatter.featured : undefined,
            existing: this.getExistingRef(file)
        };
    }

    /**
     * Publish (or update) a note to Ghost.
     */
    private async publishNote(file: TFile) {
        // Check if settings are configured
        if (!this.settings.ghostUrl || !this.settings.apiKey) {
            new Notice('Please configure your Ghost credentials in settings first');
            return;
        }

        if (file.extension !== 'md') {
            new Notice('The current file is not a .md file');
            return;
        }

        try {
            // Read file content
            const content = await this.app.vault.read(file);

            // Convert markdown to HTML
            const conversionResult = convertMarkdownToHtml(content);

            // Get metadata from frontmatter
            const metadata = this.getPostMetadata(file);

            new PublishModal(
                this,
                file,
                metadata,
                conversionResult,
                (result) => {
                    void this.onPublishSuccess(file, result);
                },
                () => {
                    void this.syncNote(file);
                }
            ).open();
        } catch (error) {
            new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * After a successful publish/update: record the post in frontmatter,
     * archive the note if it's time to, and tell the user what happened.
     */
    private async onPublishSuccess(file: TFile, result: PublishResult): Promise<void> {
        const { post, previousStatus } = result;

        await this.writePostRef(file, result);
        await this.rememberPushed(file, post.id);

        let archivedTo: string | undefined;
        if (shouldArchive('first-send', { status: post.status, previousStatus })) {
            archivedTo = await this.archiveNote(file);
        }

        const message = successMessage({
            status: post.status,
            previousStatus,
            publishedAt: post.published_at,
            emailed: result.emailed,
            recipients: result.recipients,
            archivedTo
        });
        this.showPostNotice(message, post);
    }

    /**
     * A notice that says what happened and offers the obvious next steps.
     */
    private showPostNotice(message: string, post: GhostPostResult): void {
        const fragment = createFragment();
        fragment.createDiv({ text: message });

        const links = fragment.createDiv({ cls: 'ghosty-posty-notice-links' });
        const addLink = (label: string, onClick: () => void) => {
            const link = links.createEl('a', { text: label, href: '#' });
            link.addEventListener('click', (evt) => {
                evt.preventDefault();
                onClick();
            });
        };

        if (post.status === 'published') {
            addLink('Open post', () => window.open(post.url));
            addLink('Copy link', () => {
                void navigator.clipboard.writeText(post.url).then(() => new Notice('Link copied'));
            });
        } else if (post.status === 'draft' || post.status === 'scheduled') {
            // For a post that isn't live, Ghost's URL is its private preview.
            addLink('Open preview', () => window.open(post.url));
        }
        addLink('Edit in Ghost', () => window.open(editorUrl(this.settings.ghostUrl, post.id)));

        new Notice(fragment, 12000);
    }

    /**
     * Record the post in the note's frontmatter: its id/url/updated_at (so
     * future publishes update the same post and sync can detect server-side
     * changes), plus the values confirmed in the publish window, so the next
     * update starts from them instead of reverting to old frontmatter.
     */
    private async writePostRef(file: TFile, result: PublishResult): Promise<void> {
        const { post, values } = result;
        try {
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                fm[FRONTMATTER_KEYS.id] = post.id;
                fm[FRONTMATTER_KEYS.url] = post.url;
                fm[FRONTMATTER_KEYS.updatedAt] = post.updated_at;
                fm.status = post.status;

                // Only add a property the note didn't have when it says
                // something; always refresh one that is already there.
                if ('title' in fm || post.title !== file.basename) {
                    fm.title = post.title;
                }
                if ('tags' in fm || values.tags.length > 0) {
                    fm.tags = values.tags;
                }
                if (post.visibility && ('visibility' in fm || post.visibility !== 'public')) {
                    fm.visibility = post.visibility;
                }
                if ('excerpt' in fm || values.excerpt.trim() !== '') {
                    fm.excerpt = values.excerpt.trim();
                }
                if ('slug' in fm) {
                    fm.slug = post.slug;
                }
                if ('featured' in fm) {
                    fm.featured = values.featured;
                }
            });
        } catch (error) {
            new Notice(`Published, but failed to update frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Fingerprint the note body as it is now, so we can later tell whether it
     * has been edited since it was last sent to (or pulled from) Ghost.
     */
    private async rememberPushed(file: TFile, postId: string): Promise<void> {
        try {
            this.cache.pushed[postId] = this.fingerprint(await this.app.vault.read(file));
            await this.saveCache();
        } catch {
            // Not being able to record this only affects the sync indicator
        }
    }

    private fingerprint(content: string): string {
        return hashContent(stripFrontmatter(content).content.trim());
    }

    /**
     * Pull the latest version of a published note from Ghost back into the vault.
     */
    private async syncNote(file: TFile) {
        if (!this.settings.ghostUrl || !this.settings.apiKey) {
            new Notice('Please configure your Ghost credentials in settings first');
            return;
        }

        const ref = this.getExistingRef(file);
        if (!ref) {
            new Notice('This note has not been published to Ghost yet');
            return;
        }

        const result = await this.createApi().getPost(ref.id, true);
        if (!result.success) {
            new Notice(`Failed to fetch post from Ghost: ${result.error}`);
            return;
        }

        new SyncModal(this.app, result.post, ref.updatedAt, () => {
            void this.applySync(file, result.post);
        }).open();
    }

    /**
     * Overwrite the note body with Ghost's content and refresh tracked frontmatter.
     */
    private async applySync(file: TFile, post: GhostPostResult): Promise<void> {
        try {
            const markdown = post.html ? htmlToMarkdown(post.html) : '';

            // Replace the note body while preserving existing frontmatter.
            await this.app.vault.process(file, (data) => {
                const frontmatterMatch = data.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
                const frontmatter = frontmatterMatch ? frontmatterMatch[0] : '';
                return `${frontmatter}${frontmatter && !frontmatter.endsWith('\n') ? '\n' : ''}${markdown}\n`;
            });

            // Refresh tracked + editable frontmatter from the server copy.
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                fm[FRONTMATTER_KEYS.id] = post.id;
                fm[FRONTMATTER_KEYS.url] = post.url;
                fm[FRONTMATTER_KEYS.updatedAt] = post.updated_at;
                fm.title = post.title;
                fm.status = post.status;
                if (post.visibility) {
                    fm.visibility = post.visibility;
                }
                if (Array.isArray(post.tags)) {
                    fm.tags = post.tags.map((t) => t.name);
                }
            });

            await this.rememberPushed(file, post.id);
            new Notice('Synced from Ghost');
        } catch (error) {
            new Notice(`Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Archive the note by moving it to the configured archive folder.
     * Returns the folder it was moved to, or undefined if it wasn't moved.
     */
    private async archiveNote(file: TFile): Promise<string | undefined> {
        const archiveFolder = this.settings.archiveFolder;

        // Skip if no archive folder is configured, or the note is already there
        if (!archiveFolder || file.parent?.path === archiveFolder) {
            return undefined;
        }

        try {
            // Create the archive folder if it doesn't exist
            const folderExists = this.app.vault.getAbstractFileByPath(archiveFolder);
            if (!folderExists) {
                await this.app.vault.createFolder(archiveFolder);
            }

            // Determine the new path
            let newPath = `${archiveFolder}/${file.name}`;

            // Handle filename collision by adding timestamp
            const existingFile = this.app.vault.getAbstractFileByPath(newPath);
            if (existingFile) {
                const timestamp = Date.now();
                const baseName = file.basename;
                const extension = file.extension;
                newPath = `${archiveFolder}/${baseName}-${timestamp}.${extension}`;
            }

            // Move the file using fileManager to update links automatically
            await this.app.fileManager.renameFile(file, newPath);
            return archiveFolder;
        } catch (error) {
            new Notice(`Failed to archive note: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return undefined;
        }
    }
}
