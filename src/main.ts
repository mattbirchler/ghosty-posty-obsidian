import { Plugin, Notice, TFile } from 'obsidian';
import { GhostyPostySettings, DEFAULT_SETTINGS, PostMetadata, PostStatus } from './types';
import { GhostyPostySettingTab } from './settings';
import { PublishModal } from './publish-modal';
import { convertMarkdownToHtml } from './markdown-converter';

export default class GhostyPostyPlugin extends Plugin {
    settings: GhostyPostySettings;

    async onload() {
        await this.loadSettings();

        // Register the publish command
        this.addCommand({
            id: 'publish-to-ghost',
            name: 'Publish to ghost',
            callback: () => this.publishCurrentNote()
        });

        // Add settings tab
        this.addSettingTab(new GhostyPostySettingTab(this.app, this));
    }

    onunload() {
        // Cleanup if needed
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Get the currently active markdown file
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
     * Extract post metadata from frontmatter
     */
    private getPostMetadata(file: TFile): PostMetadata {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;

        // Get title from frontmatter or filename
        const title = frontmatter?.title || file.basename;

        // Get slug from frontmatter
        const slug = frontmatter?.slug;

        // Get tags from frontmatter
        let tags: string[] = [];
        if (frontmatter?.tags) {
            if (Array.isArray(frontmatter.tags)) {
                tags = frontmatter.tags.map(String);
            } else if (typeof frontmatter.tags === 'string') {
                // Handle comma-separated string
                tags = frontmatter.tags.split(',').map((t: string) => t.trim());
            }
        }

        // Determine status and scheduled date
        let status: PostStatus = frontmatter?.status || this.settings.defaultStatus;
        let publishedAt: string | undefined;

        // Check for scheduled publishing
        const scheduledDate = frontmatter?.publish_date || frontmatter?.date;
        if (scheduledDate) {
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

        return {
            title,
            slug,
            tags,
            status,
            publishedAt
        };
    }

    /**
     * Main publish workflow
     */
    private async publishCurrentNote() {
        // Check if settings are configured
        if (!this.settings.ghostUrl || !this.settings.apiKey) {
            new Notice('Please configure your ghost credentials in settings first');
            return;
        }

        // Get the active file
        const file = this.getActiveFile();
        if (!file) {
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
                this.settings.apiKey,
                () => {
                    // Success callback - archive the note if configured
                    this.archiveNote(file);
                }
            ).open();
        } catch (error) {
            new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
