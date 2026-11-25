import { App, TFile, setIcon, setTooltip } from 'obsidian';
import { GhostAPI } from './ghost-api';
import { formatBytes } from './publish-logic';
import { GHOST_VIDEO_EXTENSIONS } from './markdown-converter';
import { probeVideo } from './video-probe';
import { ImageReference, VideoInfo } from './types';

export type ImageState =
    | 'ready'      // in the vault, will be uploaded
    | 'cached'     // unchanged since a previous upload, already on Ghost
    | 'missing'    // not found in the vault
    | 'unsupported' // a video format Ghost does not accept
    | 'waiting'    // queued behind other uploads
    | 'uploading'
    | 'uploaded'
    | 'failed'
    | 'skipped';   // the user chose to publish without it

interface ImageItem {
    ref: ImageReference;
    kind: 'image' | 'video';
    featured: boolean;
    file: TFile | null;
    /** Ghost URL, once known (from the cache or a finished upload). */
    url?: string;
    /** Thumbnail, size and length of an uploaded video. */
    video?: Omit<VideoInfo, 'url'>;
    state: ImageState;
    error?: string;
    stateEl?: HTMLElement;
    metaEl?: HTMLElement;
}

/** An earlier upload of a file: where it is on Ghost, plus video details. */
export interface RememberedUpload {
    url: string;
    video?: Omit<VideoInfo, 'url'>;
}

/** Lets the list reuse earlier uploads and record new ones. */
export interface ImageMemory {
    lookup(file: TFile): RememberedUpload | undefined;
    remember(file: TFile, upload: RememberedUpload): void;
}

const STATE_LABELS: Record<ImageState, string> = {
    ready: 'Ready',
    cached: 'On Ghost',
    missing: 'File not found',
    unsupported: 'Not supported',
    waiting: 'Waiting',
    uploading: 'Uploading',
    uploaded: 'Uploaded',
    failed: 'Failed',
    skipped: 'Left out'
};

/** How many uploads run at once. */
const UPLOAD_CONCURRENCY = 3;

/**
 * The list of images and videos in the publish modal. It checks every image when the
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
        contentImages: ImageReference[],
        videos: ImageReference[]
    ) {
        const refs = [
            ...(featuredImage ? [{ ref: featuredImage, featured: true, kind: 'image' as const }] : []),
            ...contentImages.map((ref) => ({ ref, featured: false, kind: 'image' as const })),
            ...videos.map((ref) => ({ ref, featured: false, kind: 'video' as const }))
        ];

        // The same file can appear more than once in a note; upload it once.
        const seen = new Set<string>();
        for (const { ref, featured, kind } of refs) {
            if (seen.has(ref.path)) {
                continue;
            }
            seen.add(ref.path);

            const file = this.resolve(ref.path);
            const remembered = file ? this.memory.lookup(file) : undefined;
            const unsupported = kind === 'video' && file !== null &&
                !GHOST_VIDEO_EXTENSIONS.includes(file.extension.toLowerCase());

            let state: ImageState = 'ready';
            if (!file) {
                state = 'missing';
            } else if (unsupported) {
                state = 'unsupported';
            } else if (remembered) {
                state = 'cached';
            }

            this.items.push({
                ref,
                kind,
                featured,
                file,
                url: unsupported ? undefined : remembered?.url,
                video: unsupported ? undefined : remembered?.video,
                state
            });
        }
    }

    get count(): number {
        return this.items.length;
    }

    /**
     * Files that stop a publish: not in the vault, a video format Ghost
     * doesn't accept, or a failed upload.
     */
    get problems(): Array<{ name: string; state: ImageState; error?: string }> {
        return this.items
            .filter((item) => item.state === 'missing' || item.state === 'unsupported' || item.state === 'failed')
            .map((item) => ({ name: this.displayName(item), state: item.state, error: item.error }));
    }

    /** Problems that a retry can't fix: the user has to decide what to do. */
    get hasBlockers(): boolean {
        return this.items.some((item) => item.state === 'missing' || item.state === 'unsupported');
    }

    get hasVideo(): boolean {
        return this.items.some((item) => item.kind === 'video');
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
            if (item.url && item.kind === 'image') {
                map.set(item.ref.path, item.url);
            }
        }
        return map;
    }

    /** Local paths of images the user chose to leave out. */
    get skippedPaths(): string[] {
        return this.items
            .filter((item) => item.state === 'skipped' && item.kind === 'image')
            .map((item) => item.ref.path);
    }

    /** The uploaded video for a local path, or undefined if it was left out. */
    videoFor(path: string): VideoInfo | undefined {
        const item = this.items.find((i) => i.kind === 'video' && i.ref.path === path);
        return item?.url ? { url: item.url, ...item.video } : undefined;
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

            if (item.kind === 'video') {
                setIcon(row.createDiv({ cls: 'ghosty-posty-image-thumb is-video' }), 'film');
            } else if (item.file) {
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
            if (item.state === 'missing' || item.state === 'unsupported' || item.state === 'failed') {
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

        if (item.kind === 'video') {
            // Work out the size and grab a thumbnail frame, as Ghost's editor does
            const probe = await probeVideo(data, `video/${file.extension.toLowerCase() === 'ogv' ? 'ogg' : file.extension.toLowerCase()}`);
            const result = await api.uploadVideo(file.name, data, probe.thumbnail);
            if (!result.success) {
                this.setState(item, 'failed', result.error);
                return;
            }
            item.url = result.url;
            item.video = {
                thumbnailUrl: result.thumbnailUrl,
                width: probe.width,
                height: probe.height,
                duration: probe.duration
            };
        } else {
            const result = await api.uploadImage(file.name, data);
            if (!result.success) {
                this.setState(item, 'failed', result.error);
                return;
            }
            item.url = result.url;
        }

        this.memory.remember(file, { url: item.url, video: item.video });
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
            if (item.kind === 'video') {
                parts.push('Video');
            }
            if (item.error) {
                parts.push(item.error);
            } else if (item.state === 'unsupported') {
                parts.push('Ghost accepts MP4, WebM and OGV video');
            } else if (item.file) {
                parts.push(formatBytes(item.file.stat.size));
            } else {
                parts.push(item.ref.path);
            }
            item.metaEl.setText(parts.join(' · '));
            item.metaEl.toggleClass(
                'is-error',
                item.error !== undefined || item.state === 'missing' || item.state === 'unsupported'
            );
        }
    }

    private paintSummary(): void {
        if (!this.summaryEl) {
            return;
        }
        const videos = this.items.filter((i) => i.kind === 'video').length;
        const images = this.items.length - videos;
        const onGhost = this.items.filter((i) => i.url !== undefined).length;
        const missing = this.items.filter((i) => i.state === 'missing').length;
        const skipped = this.items.filter((i) => i.state === 'skipped').length;
        const toUpload = this.items
            .filter((i) => i.file && i.url === undefined && i.state !== 'skipped' && i.state !== 'unsupported')
            .reduce((sum, i) => sum + (i.file?.stat.size ?? 0), 0);

        const counts: string[] = [];
        if (images > 0) {
            counts.push(`${images} ${images === 1 ? 'image' : 'images'}`);
        }
        if (videos > 0) {
            counts.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`);
        }
        const parts = [counts.join(', ')];
        if (onGhost > 0) {
            parts.push(`${onGhost} already on Ghost`);
        }
        if (toUpload > 0) {
            parts.push(`${formatBytes(toUpload)} to upload`);
        }
        if (missing > 0) {
            parts.push(`${missing} missing`);
        }
        const unsupported = this.items.filter((i) => i.state === 'unsupported').length;
        if (unsupported > 0) {
            parts.push(`${unsupported} not supported`);
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
