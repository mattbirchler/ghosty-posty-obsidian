import { App, TFile, setTooltip } from 'obsidian';
import { GhostAPI } from './ghost-api';
import { formatBytes } from './publish-logic';
import { ImageReference } from './types';

export type ImageState =
    | 'ready'      // in the vault, will be uploaded
    | 'cached'     // unchanged since a previous upload, already on Ghost
    | 'missing'    // not found in the vault
    | 'waiting'    // queued behind other uploads
    | 'uploading'
    | 'uploaded'
    | 'failed'
    | 'skipped';   // the user chose to publish without it

interface ImageItem {
    ref: ImageReference;
    featured: boolean;
    file: TFile | null;
    /** Ghost URL, once known (from the cache or a finished upload). */
    url?: string;
    state: ImageState;
    error?: string;
    stateEl?: HTMLElement;
    metaEl?: HTMLElement;
}

/** Lets the list reuse earlier uploads and record new ones. */
export interface ImageMemory {
    lookup(file: TFile): string | undefined;
    remember(file: TFile, url: string): void;
}

const STATE_LABELS: Record<ImageState, string> = {
    ready: 'Ready',
    cached: 'On Ghost',
    missing: 'File not found',
    waiting: 'Waiting',
    uploading: 'Uploading',
    uploaded: 'Uploaded',
    failed: 'Failed',
    skipped: 'Left out'
};

/** How many uploads run at once. */
const UPLOAD_CONCURRENCY = 3;

/**
 * The list of images in the publish modal. It checks every image when the
 * modal opens (so a missing file shows up before publishing, not halfway
 * through), shows each one with a thumbnail and size, and tracks its state
 * through the upload.
 */
export class ImageList {
    private items: ImageItem[] = [];
    private summaryEl: HTMLElement | null = null;

    constructor(
        private app: App,
        private sourceFile: TFile,
        private memory: ImageMemory,
        featuredImage: ImageReference | null,
        contentImages: ImageReference[]
    ) {
        const refs = [
            ...(featuredImage ? [{ ref: featuredImage, featured: true }] : []),
            ...contentImages.map((ref) => ({ ref, featured: false }))
        ];

        // The same file can appear more than once in a note; upload it once.
        const seen = new Set<string>();
        for (const { ref, featured } of refs) {
            if (seen.has(ref.path)) {
                continue;
            }
            seen.add(ref.path);

            const file = this.resolve(ref.path);
            const url = file ? this.memory.lookup(file) : undefined;
            this.items.push({
                ref,
                featured,
                file,
                url,
                state: !file ? 'missing' : url ? 'cached' : 'ready'
            });
        }
    }

    get count(): number {
        return this.items.length;
    }

    /** Images that stop a publish: not in the vault, or failed to upload. */
    get problems(): Array<{ name: string; state: ImageState; error?: string }> {
        return this.items
            .filter((item) => item.state === 'missing' || item.state === 'failed')
            .map((item) => ({ name: this.displayName(item), state: item.state, error: item.error }));
    }

    get hasMissing(): boolean {
        return this.items.some((item) => item.state === 'missing');
    }

    get hasFailed(): boolean {
        return this.items.some((item) => item.state === 'failed');
    }

    /** How many images still need uploading. */
    get pendingCount(): number {
        return this.items.filter((item) => item.state === 'ready' || item.state === 'failed').length;
    }

    /** Local path -> Ghost URL for every image that is on Ghost. */
    get urlMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (const item of this.items) {
            if (item.url) {
                map.set(item.ref.path, item.url);
            }
        }
        return map;
    }

    /** Local paths of images the user chose to leave out. */
    get skippedPaths(): string[] {
        return this.items.filter((item) => item.state === 'skipped').map((item) => item.ref.path);
    }

    /** The featured image's Ghost URL and alt text, if it has been uploaded. */
    get featured(): { url: string; alt: string } | null {
        const item = this.items.find((i) => i.featured);
        return item?.url ? { url: item.url, alt: item.ref.alt } : null;
    }

    render(containerEl: HTMLElement): void {
        containerEl.empty();
        if (this.items.length === 0) {
            return;
        }

        this.summaryEl = containerEl.createDiv({ cls: 'ghosty-posty-images-summary' });

        const listEl = containerEl.createDiv({ cls: 'ghosty-posty-image-list' });
        for (const item of this.items) {
            const row = listEl.createDiv({ cls: 'ghosty-posty-image' });

            if (item.file) {
                const thumb = row.createEl('img', { cls: 'ghosty-posty-image-thumb' });
                thumb.src = this.app.vault.getResourcePath(item.file);
                thumb.alt = '';
            } else {
                row.createDiv({ cls: 'ghosty-posty-image-thumb is-missing' });
            }

            const text = row.createDiv({ cls: 'ghosty-posty-image-text' });
            text.createDiv({ cls: 'ghosty-posty-image-name', text: this.displayName(item) });
            item.metaEl = text.createDiv({ cls: 'ghosty-posty-image-meta' });

            item.stateEl = row.createDiv({ cls: 'ghosty-posty-image-state' });
            this.paint(item);
        }

        this.paintSummary();
    }

    /**
     * Stop treating missing or failed images as blockers: the post will be
     * published without them.
     */
    skipProblems(): void {
        for (const item of this.items) {
            if (item.state === 'missing' || item.state === 'failed') {
                this.setState(item, 'skipped');
            }
        }
        this.paintSummary();
    }

    /**
     * Upload every image that isn't on Ghost yet, a few at a time. One failure
     * doesn't stop the rest, and finished uploads are remembered, so a retry
     * only re-sends what failed. Resolves to true when nothing failed.
     */
    async uploadAll(api: GhostAPI, onProgress: (done: number, total: number) => void): Promise<boolean> {
        const queue = this.items.filter((item) => item.state === 'ready' || item.state === 'failed');
        const total = queue.length;
        let done = 0;

        for (const item of queue) {
            this.setState(item, 'waiting');
        }
        onProgress(done, total);

        const worker = async () => {
            for (let item = queue.shift(); item; item = queue.shift()) {
                await this.uploadOne(api, item);
                done++;
                onProgress(done, total);
            }
        };
        await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker));

        this.paintSummary();
        return !this.hasFailed;
    }

    private async uploadOne(api: GhostAPI, item: ImageItem): Promise<void> {
        const file = item.file;
        if (!file) {
            this.setState(item, 'missing');
            return;
        }
        this.setState(item, 'uploading');

        let data: ArrayBuffer;
        try {
            data = await this.app.vault.readBinary(file);
        } catch {
            this.setState(item, 'failed', 'Could not read the file');
            return;
        }

        const result = await api.uploadImage(file.name, data);
        if (!result.success) {
            this.setState(item, 'failed', result.error);
            return;
        }

        item.url = result.url;
        this.memory.remember(file, result.url);
        this.setState(item, 'uploaded');
    }

    private setState(item: ImageItem, state: ImageState, error?: string): void {
        item.state = state;
        item.error = error;
        this.paint(item);
    }

    private paint(item: ImageItem): void {
        if (item.stateEl) {
            item.stateEl.setText(STATE_LABELS[item.state]);
            item.stateEl.className = `ghosty-posty-image-state is-${item.state}`;
            setTooltip(item.stateEl, item.error ?? '');
        }
        if (item.metaEl) {
            const parts: string[] = [];
            if (item.featured) {
                parts.push('Featured image');
            }
            if (item.error) {
                parts.push(item.error);
            } else if (item.file) {
                parts.push(formatBytes(item.file.stat.size));
            } else {
                parts.push(item.ref.path);
            }
            item.metaEl.setText(parts.join(' · '));
            item.metaEl.toggleClass('is-error', item.error !== undefined || item.state === 'missing');
        }
    }

    private paintSummary(): void {
        if (!this.summaryEl) {
            return;
        }
        const total = this.items.length;
        const onGhost = this.items.filter((i) => i.url !== undefined).length;
        const missing = this.items.filter((i) => i.state === 'missing').length;
        const skipped = this.items.filter((i) => i.state === 'skipped').length;
        const toUpload = this.items
            .filter((i) => i.file && i.url === undefined && i.state !== 'skipped')
            .reduce((sum, i) => sum + (i.file?.stat.size ?? 0), 0);

        const parts = [`${total} ${total === 1 ? 'image' : 'images'}`];
        if (onGhost > 0) {
            parts.push(`${onGhost} already on Ghost`);
        }
        if (toUpload > 0) {
            parts.push(`${formatBytes(toUpload)} to upload`);
        }
        if (missing > 0) {
            parts.push(`${missing} missing`);
        }
        if (skipped > 0) {
            parts.push(`${skipped} left out`);
        }
        this.summaryEl.setText(parts.join(' · '));
    }

    private displayName(item: ImageItem): string {
        return item.file?.name ?? item.ref.path.split('/').pop() ?? item.ref.path;
    }

    /**
     * Resolve an image path, as written in the note, to a file in the vault.
     */
    private resolve(imagePath: string): TFile | null {
        const candidates = [imagePath];
        try {
            // Standard markdown links are often URL-encoded (my%20photo.png)
            const decoded = decodeURIComponent(imagePath);
            if (decoded !== imagePath) {
                candidates.push(decoded);
            }
        } catch {
            // Not valid URL encoding: use the path as written
        }

        for (const path of candidates) {
            const direct = this.app.vault.getAbstractFileByPath(path);
            if (direct instanceof TFile) {
                return direct;
            }

            // Link resolution handles bare file names and relative paths
            const linked = this.app.metadataCache.getFirstLinkpathDest(path, this.sourceFile.path);
            if (linked instanceof TFile) {
                return linked;
            }

            const folder = this.sourceFile.parent?.path || '';
            const relative = this.app.vault.getAbstractFileByPath(folder ? `${folder}/${path}` : path);
            if (relative instanceof TFile) {
                return relative;
            }
        }

        return null;
    }
}
