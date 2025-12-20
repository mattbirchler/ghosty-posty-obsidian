import { App, Modal, Setting, Notice, Vault, TFile, MetadataCache } from 'obsidian';
import { PostMetadata, GhostPostPayload, PostStatus, ImageReference } from './types';
import { GhostAPI } from './ghost-api';
import { ConversionResult, replaceImageUrls } from './markdown-converter';

export class PublishModal extends Modal {
    private metadata: PostMetadata;
    private conversionResult: ConversionResult;
    private ghostUrl: string;
    private apiKey: string;
    private vault: Vault;
    private metadataCache: MetadataCache;
    private sourceFile: TFile;
    private onSuccess: (postUrl: string) => void;

    // Editable form values
    private editableTitle: string;
    private editableStatus: PostStatus;
    private editableTags: string;
    private editableFeatured: boolean = false;
    private editableScheduledDate: string = '';

    // UI elements
    private publishButton: HTMLButtonElement | null = null;
    private statusEl: HTMLElement | null = null;
    private scheduleDateContainer: HTMLElement | null = null;

    constructor(
        app: App,
        vault: Vault,
        metadataCache: MetadataCache,
        sourceFile: TFile,
        metadata: PostMetadata,
        conversionResult: ConversionResult,
        ghostUrl: string,
        apiKey: string,
        onSuccess: (postUrl: string) => void
    ) {
        super(app);
        this.vault = vault;
        this.metadataCache = metadataCache;
        this.sourceFile = sourceFile;
        this.metadata = metadata;
        this.conversionResult = conversionResult;
        this.ghostUrl = ghostUrl;
        this.apiKey = apiKey;
        this.onSuccess = onSuccess;

        // Initialize editable values
        this.editableTitle = metadata.title;
        this.editableStatus = metadata.status;
        this.editableTags = metadata.tags.join(', ');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ghosty-posty-modal');

        contentEl.createEl('h2', { text: 'Publish to Ghost' });

        // Editable fields section
        const formSection = contentEl.createDiv({ cls: 'ghosty-posty-form' });

        // Title input
        new Setting(formSection)
            .setName('Title')
            .addText(text => text
                .setValue(this.editableTitle)
                .onChange(value => {
                    this.editableTitle = value;
                }));

        // Status dropdown
        new Setting(formSection)
            .setName('Status')
            .addDropdown(dropdown => dropdown
                .addOption('draft', 'Draft')
                .addOption('published', 'Published')
                .addOption('scheduled', 'Scheduled')
                .setValue(this.editableStatus)
                .onChange(value => {
                    this.editableStatus = value as PostStatus;
                    this.toggleScheduleDateVisibility();
                }));

        // Schedule date picker (hidden by default)
        this.scheduleDateContainer = formSection.createDiv({ cls: 'ghosty-posty-schedule-picker' });
        new Setting(this.scheduleDateContainer)
            .setName('Schedule for')
            .setDesc('Date and time to publish (your local timezone)')
            .addText(text => {
                text.inputEl.type = 'datetime-local';
                // Set default to tomorrow at 9am
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(9, 0, 0, 0);
                const defaultDate = this.toLocalDatetimeString(tomorrow);
                text.setValue(defaultDate);
                this.editableScheduledDate = defaultDate;
                text.onChange(value => {
                    this.editableScheduledDate = value;
                });
            });
        this.toggleScheduleDateVisibility();

        // Featured toggle
        new Setting(formSection)
            .setName('Featured')
            .setDesc('Mark this post as featured')
            .addToggle(toggle => toggle
                .setValue(this.editableFeatured)
                .onChange(value => {
                    this.editableFeatured = value;
                }));

        // Tags input
        new Setting(formSection)
            .setName('Tags')
            .setDesc('Comma-separated list of tags')
            .addText(text => text
                .setPlaceholder('blog, tech, tutorial')
                .setValue(this.editableTags)
                .onChange(value => {
                    this.editableTags = value;
                }));

        // Image info section
        const totalImages = this.conversionResult.images.length +
            (this.conversionResult.featuredImage ? 1 : 0);

        if (totalImages > 0 || this.conversionResult.featuredImage) {
            const imageSection = contentEl.createDiv({ cls: 'ghosty-posty-images' });
            imageSection.createEl('h3', { text: 'Images' });

            if (this.conversionResult.featuredImage) {
                const featuredDiv = imageSection.createDiv({ cls: 'ghosty-posty-field' });
                featuredDiv.createEl('strong', { text: 'Featured image: ' });
                featuredDiv.createEl('span', { text: this.getFilename(this.conversionResult.featuredImage.path) });
            }

            if (this.conversionResult.images.length > 0) {
                const countDiv = imageSection.createDiv({ cls: 'ghosty-posty-field' });
                countDiv.createEl('strong', { text: 'Content images: ' });
                countDiv.createEl('span', { text: `${this.conversionResult.images.length}` });
            }
        }

        // Scheduled date (if applicable from metadata)
        if (this.metadata.status === 'scheduled' && this.metadata.publishedAt) {
            const scheduleSection = contentEl.createDiv({ cls: 'ghosty-posty-schedule' });
            const dateDiv = scheduleSection.createDiv({ cls: 'ghosty-posty-field' });
            dateDiv.createEl('strong', { text: 'Scheduled for: ' });
            dateDiv.createEl('span', { text: this.formatDate(this.metadata.publishedAt) });
        }

        // Status/progress area
        this.statusEl = contentEl.createDiv({ cls: 'ghosty-posty-status' });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'ghosty-posty-buttons' });

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.close());

        this.publishButton = buttonContainer.createEl('button', {
            text: 'Publish',
            cls: 'mod-cta'
        });
        this.publishButton.addEventListener('click', () => this.publish());
    }

    private getFilename(path: string): string {
        return path.split('/').pop() || path;
    }

    private formatDate(isoDate: string): string {
        try {
            const date = new Date(isoDate);
            return date.toLocaleString();
        } catch {
            return isoDate;
        }
    }

    /**
     * Convert a Date to the format required by datetime-local input (YYYY-MM-DDTHH:mm)
     */
    private toLocalDatetimeString(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    /**
     * Show/hide the schedule date picker based on status
     */
    private toggleScheduleDateVisibility() {
        if (this.scheduleDateContainer) {
            if (this.editableStatus === 'scheduled') {
                this.scheduleDateContainer.style.display = 'block';
            } else {
                this.scheduleDateContainer.style.display = 'none';
            }
        }
    }

    private setStatus(message: string) {
        if (this.statusEl) {
            this.statusEl.textContent = message;
        }
    }

    private setButtonsEnabled(enabled: boolean) {
        const buttons = this.contentEl.querySelectorAll('button');
        buttons.forEach(btn => {
            if (enabled) {
                btn.removeAttribute('disabled');
            } else {
                btn.setAttribute('disabled', 'true');
            }
        });
    }

    /**
     * Resolve an image path to a TFile
     */
    private resolveImagePath(imagePath: string): TFile | null {
        // Try direct path first
        const directFile = this.vault.getAbstractFileByPath(imagePath);
        if (directFile instanceof TFile) {
            return directFile;
        }

        // Try using metadata cache for link resolution (handles relative paths)
        const resolved = this.metadataCache.getFirstLinkpathDest(imagePath, this.sourceFile.path);
        if (resolved instanceof TFile) {
            return resolved;
        }

        // Try relative to source file's folder
        const sourceFolder = this.sourceFile.parent?.path || '';
        const relativePath = sourceFolder ? `${sourceFolder}/${imagePath}` : imagePath;
        const relativeFile = this.vault.getAbstractFileByPath(relativePath);
        if (relativeFile instanceof TFile) {
            return relativeFile;
        }

        return null;
    }

    /**
     * Upload all images and return URL mapping
     */
    private async uploadImages(
        api: GhostAPI,
        images: ImageReference[]
    ): Promise<{ success: true; urlMap: Map<string, string> } | { success: false; error: string }> {
        const urlMap = new Map<string, string>();

        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const filename = this.getFilename(image.path);

            this.setStatus(`Uploading image ${i + 1}/${images.length}: ${filename}...`);

            // Resolve the image file
            const imageFile = this.resolveImagePath(image.path);
            if (!imageFile) {
                return {
                    success: false,
                    error: `Image not found: ${image.path}`
                };
            }

            // Read the image data
            let imageData: ArrayBuffer;
            try {
                imageData = await this.vault.readBinary(imageFile);
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to read image: ${image.path}`
                };
            }

            // Upload to Ghost
            const result = await api.uploadImage(filename, imageData);
            if (!result.success) {
                return {
                    success: false,
                    error: `Failed to upload ${filename}: ${result.error}`
                };
            }

            urlMap.set(image.path, result.url);
        }

        return { success: true, urlMap };
    }

    private async publish() {
        this.setButtonsEnabled(false);
        if (this.publishButton) {
            this.publishButton.textContent = 'Publishing...';
        }

        try {
            const api = new GhostAPI(this.ghostUrl, this.apiKey);

            // Collect all images to upload
            const allImages: ImageReference[] = [
                ...(this.conversionResult.featuredImage ? [this.conversionResult.featuredImage] : []),
                ...this.conversionResult.images
            ];

            let html = this.conversionResult.html;
            let featureImageUrl: string | undefined;

            // Upload images if there are any
            if (allImages.length > 0) {
                const uploadResult = await this.uploadImages(api, allImages);

                if (!uploadResult.success) {
                    new Notice(`Error: ${uploadResult.error}`);
                    this.setStatus(`Error: ${uploadResult.error}`);
                    this.setButtonsEnabled(true);
                    if (this.publishButton) {
                        this.publishButton.textContent = 'Publish';
                    }
                    return;
                }

                // Get featured image URL
                if (this.conversionResult.featuredImage) {
                    featureImageUrl = uploadResult.urlMap.get(this.conversionResult.featuredImage.path);
                }

                // Replace image paths in HTML
                html = replaceImageUrls(html, uploadResult.urlMap);
            }

            this.setStatus('Creating post...');

            // Parse tags from comma-separated string
            const tags = this.editableTags
                .split(',')
                .map(t => t.trim())
                .filter(t => t.length > 0);

            // Determine published_at date
            let publishedAt: string | undefined;
            if (this.editableStatus === 'scheduled' && this.editableScheduledDate) {
                // Convert local datetime to ISO string
                const localDate = new Date(this.editableScheduledDate);
                publishedAt = localDate.toISOString();
            } else if (this.metadata.publishedAt) {
                publishedAt = this.metadata.publishedAt;
            }

            const payload: GhostPostPayload = {
                posts: [{
                    title: this.editableTitle,
                    html: html,
                    status: this.editableStatus,
                    ...(this.metadata.slug && { slug: this.metadata.slug }),
                    ...(tags.length > 0 && {
                        tags: tags.map(name => ({ name }))
                    }),
                    ...(publishedAt && { published_at: publishedAt }),
                    ...(featureImageUrl && { feature_image: featureImageUrl }),
                    ...(this.editableFeatured && { featured: true })
                }]
            };

            const result = await api.createPost(payload);

            if (result.success) {
                new Notice(`Post published successfully!`);
                this.onSuccess(result.post.url);
                this.close();
            } else {
                new Notice(`Failed to publish: ${result.error}`);
                this.setStatus(`Error: ${result.error}`);
                this.setButtonsEnabled(true);
                if (this.publishButton) {
                    this.publishButton.textContent = 'Publish';
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            new Notice(`Error: ${errorMessage}`);
            this.setStatus(`Error: ${errorMessage}`);
            this.setButtonsEnabled(true);
            if (this.publishButton) {
                this.publishButton.textContent = 'Publish';
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
