import { Plugin, Notice, TFile, Menu, Editor, MarkdownView, htmlToMarkdown } from 'obsidian';
import {
    GhostyPostySettings,
    DEFAULT_SETTINGS,
    PostMetadata,
    PostStatus,
    PostVisibility,
    GhostPostRef,
    GhostPostResult,
    FRONTMATTER_KEYS
} from './types';
import { GhostyPostySettingTab } from './settings';
import { PublishModal } from './publish-modal';
import { SyncModal } from './sync-modal';
import { GhostAPI } from './ghost-api';
import { convertMarkdownToHtml } from './markdown-converter';

const API_KEY_SECRET_ID = 'ghosty-posty-admin-api-key';

export default class GhostyPostyPlugin extends Plugin {
    settings: GhostyPostySettings;
    private apiKey = '';

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
        const data = (await this.loadData()) as (Partial<GhostyPostySettings> & { apiKey?: string }) | null;
        if (data) delete data.apiKey;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        this.apiKey = this.app.secretStorage.getSecret(API_KEY_SECRET_ID) ?? '';
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getApiKey(): string {
        return this.apiKey;
    }

    setApiKey(apiKey: string): void {
        this.app.secretStorage.setSecret(API_KEY_SECRET_ID, apiKey);
        this.apiKey = apiKey;
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

        // Get tags from frontmatter
        let tags: string[] = [];
        if (Array.isArray(frontmatter.tags)) {
            tags = frontmatter.tags.map(String);
        } else if (typeof frontmatter.tags === 'string') {
            // Handle comma-separated string
            tags = frontmatter.tags.split(',').map((t) => t.trim());
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

            if (date > now) {
                // Future date - schedule the post
                status = 'scheduled';
                publishedAt = date.toISOString();
            } else if (status === 'published') {
                // Past date with published status - use that date
                publishedAt = date.toISOString();
            }
        }

        // Visibility (public | members | paid); defaults to public
        const rawVisibility = frontmatter.visibility;
        const visibility: PostVisibility =
            rawVisibility === 'members' || rawVisibility === 'paid' || rawVisibility === 'public'
                ? rawVisibility
                : 'public';

        return {
            title,
            slug,
            tags,
            status,
            publishedAt,
            visibility,
            existing: this.getExistingRef(file)
        };
    }

    /**
     * Publish (or update) a note to Ghost.
     */
    private async publishNote(file: TFile) {
        // Check if settings are configured
        const apiKey = this.getApiKey();
        if (!this.settings.ghostUrl || !apiKey) {
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

            // Show the confirmation modal
            new PublishModal(
                this.app,
                this.app.vault,
                this.app.metadataCache,
                file,
                metadata,
                conversionResult,
                this.settings.ghostUrl,
                apiKey,
                (post, wasCreate) => {
                    void this.onPublishSuccess(file, post, wasCreate);
                }
            ).open();
        } catch (error) {
            new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * After a successful publish/update: record the post reference in frontmatter,
     * and archive the note (only on first publish).
     */
    private async onPublishSuccess(file: TFile, post: GhostPostResult, wasCreate: boolean): Promise<void> {
        await this.writePostRef(file, post);
        if (wasCreate) {
            await this.archiveNote(file);
        }
    }

    /**
     * Store the Ghost post id/url/updated_at in the note's frontmatter so future
     * publishes update the same post and sync can detect server-side changes.
     */
    private async writePostRef(file: TFile, post: GhostPostResult): Promise<void> {
        try {
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                fm[FRONTMATTER_KEYS.id] = post.id;
                fm[FRONTMATTER_KEYS.url] = post.url;
                fm[FRONTMATTER_KEYS.updatedAt] = post.updated_at;
            });
        } catch (error) {
            new Notice(`Published, but failed to update frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Pull the latest version of a published note from Ghost back into the vault.
     */
    private async syncNote(file: TFile) {
        const apiKey = this.getApiKey();
        if (!this.settings.ghostUrl || !apiKey) {
            new Notice('Please configure your Ghost credentials in settings first');
            return;
        }

        const ref = this.getExistingRef(file);
        if (!ref) {
            new Notice('This note has not been published to Ghost yet');
            return;
        }

        const api = new GhostAPI(this.settings.ghostUrl, apiKey);
        const result = await api.getPost(ref.id);
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

            new Notice('Synced from Ghost');
        } catch (error) {
            new Notice(`Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Archive the note by moving it to the configured archive folder
     */
    private async archiveNote(file: TFile): Promise<void> {
        const archiveFolder = this.settings.archiveFolder;

        // Skip if no archive folder is configured
        if (!archiveFolder) {
            return;
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
            new Notice(`Note archived to ${archiveFolder}`);
        } catch (error) {
            new Notice(`Failed to archive note: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
