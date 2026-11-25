import {
    ArchiveWhen,
    DeliveryMode,
    GhostPostResult,
    PostMetadata,
    PostStatus,
    PostVisibility,
    ServerPostStatus
} from './types';

/**
 * Pure decision logic for the publish flow: what the form starts with, what
 * the button says, and what we tell the user afterwards. Kept free of
 * Obsidian imports so it can be unit tested.
 */

/** The values the publish form edits. */
export interface FormValues {
    title: string;
    slug: string;
    tags: string[];
    status: PostStatus;
    /** Local date and time in datetime-local format (YYYY-MM-DDTHH:mm). */
    scheduledAt: string;
    /** `tiers` is kept as-is when the post is limited to specific tiers on Ghost. */
    visibility: PostVisibility | 'tiers';
    excerpt: string;
    featured: boolean;
}

/** Ghost rejects custom excerpts longer than this. */
export const EXCERPT_MAX_LENGTH = 300;

/** Ghost rejects featured image alt text longer than this. */
export const FEATURE_ALT_MAX_LENGTH = 125;

/**
 * Convert a Date to the format required by a datetime-local input.
 */
export function toLocalDatetimeString(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isSimpleVisibility(value: unknown): value is PostVisibility {
    return value === 'public' || value === 'members' || value === 'paid';
}

/**
 * Work out what the form should start with.
 *
 * For a new post, frontmatter and settings decide everything.
 *
 * For an update, the status always comes from Ghost: the note may not record
 * it, or may be stale (a scheduled post that has since gone live), and getting
 * it wrong would unpublish a live post. Other fields use the note's
 * frontmatter when it sets them and fall back to what is on Ghost.
 */
export function initialFormValues(
    metadata: PostMetadata,
    serverPost: GhostPostResult | undefined,
    now: Date
): FormValues {
    let status: PostStatus = metadata.status;
    if (serverPost) {
        status = serverPost.status === 'sent' ? 'published' : serverPost.status;
    }

    // Schedule time: a future date in frontmatter, else Ghost's, else the next full hour.
    let scheduled: Date | undefined;
    if (metadata.publishedAt && new Date(metadata.publishedAt) > now) {
        scheduled = new Date(metadata.publishedAt);
    } else if (serverPost?.status === 'scheduled' && serverPost.published_at) {
        scheduled = new Date(serverPost.published_at);
    }
    if (!scheduled || isNaN(scheduled.getTime())) {
        scheduled = new Date(now);
        scheduled.setHours(scheduled.getHours() + 1, 0, 0, 0);
    }

    let visibility: FormValues['visibility'] = 'public';
    if (metadata.visibility) {
        visibility = metadata.visibility;
    } else if (serverPost?.visibility) {
        visibility = isSimpleVisibility(serverPost.visibility) ? serverPost.visibility : 'tiers';
    }

    return {
        title: metadata.title,
        slug: metadata.slug ?? serverPost?.slug ?? '',
        tags: metadata.tags ?? serverPost?.tags?.map((t) => t.name) ?? [],
        status,
        scheduledAt: toLocalDatetimeString(scheduled),
        visibility,
        excerpt: metadata.excerpt ?? serverPost?.custom_excerpt ?? '',
        featured: metadata.featured ?? serverPost?.featured ?? false
    };
}

export interface StatusChoice {
    value: PostStatus;
    label: string;
}

/**
 * The draft / publish / schedule choices, worded for where the post is now.
 * An email-only post has no status to choose.
 */
export function statusChoices(serverStatus: ServerPostStatus | undefined): StatusChoice[] {
    switch (serverStatus) {
        case 'sent':
            return [];
        case 'published':
            return [
                { value: 'draft', label: 'Unpublish' },
                { value: 'published', label: 'Keep published' }
            ];
        case 'scheduled':
            return [
                { value: 'draft', label: 'Back to draft' },
                { value: 'published', label: 'Publish now' },
                { value: 'scheduled', label: 'Keep scheduled' }
            ];
        default:
            return [
                { value: 'draft', label: 'Save draft' },
                { value: 'published', label: 'Publish now' },
                { value: 'scheduled', label: 'Schedule' }
            ];
    }
}

/**
 * An email can only go out the first time a post is published, so the option
 * is offered for new, draft and scheduled posts that are about to go out.
 */
export function canEmail(serverStatus: ServerPostStatus | undefined, status: PostStatus): boolean {
    const alreadyOut = serverStatus === 'published' || serverStatus === 'sent';
    return !alreadyOut && (status === 'published' || status === 'scheduled');
}

/** "1,204 people", "1 person", or "subscribers" when the count is unknown. */
export function formatPeople(count: number | undefined): string {
    if (count === undefined) {
        return 'subscribers';
    }
    return `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'}`;
}

/** A short local date and time, e.g. "Thu, Nov 26, 9:00 AM". */
export function formatWhen(value: string | undefined | null): string {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

export interface ButtonState {
    serverStatus?: ServerPostStatus;
    status: PostStatus;
    scheduledAt: string;
    delivery: DeliveryMode;
    recipients?: number;
    /** The post changed on Ghost since this note last saw it. */
    conflict: boolean;
}

/**
 * The primary button says exactly what pressing it will do.
 */
export function publishButtonLabel(state: ButtonState): string {
    if (state.conflict) {
        return 'Overwrite Ghost version';
    }
    if (state.serverStatus === 'sent') {
        return 'Update post';
    }
    if (state.serverStatus === 'published') {
        return state.status === 'draft' ? 'Unpublish and save as draft' : 'Update live post';
    }

    const people = formatPeople(state.recipients);

    if (state.status === 'draft') {
        if (state.serverStatus === 'scheduled') {
            return 'Unschedule and save as draft';
        }
        return state.serverStatus === 'draft' ? 'Update draft' : 'Save draft';
    }

    if (state.status === 'scheduled') {
        const when = formatWhen(state.scheduledAt);
        const base = when ? `Schedule for ${when}` : 'Schedule';
        if (state.delivery === 'newsletter_only') {
            return when ? `Schedule email for ${when}` : 'Schedule email';
        }
        return state.delivery === 'post_and_newsletter' ? `${base} and email ${people}` : base;
    }

    if (state.delivery === 'newsletter_only') {
        return `Send email to ${people}`;
    }
    return state.delivery === 'post_and_newsletter' ? `Publish and email ${people}` : 'Publish now';
}

function isOut(status: ServerPostStatus | undefined): boolean {
    return status === 'published' || status === 'scheduled' || status === 'sent';
}

export interface PublishOutcome {
    /** Status Ghost reported after the save. */
    status: ServerPostStatus;
    /** Status on Ghost before the save; undefined for a new post. */
    previousStatus?: ServerPostStatus;
    /** ISO date the post is (or will be) published. */
    publishedAt?: string | null;
    emailed: boolean;
    recipients?: number;
    /** Folder the note was moved to, if it was archived. */
    archivedTo?: string;
}

/**
 * One sentence (or two) describing what just happened.
 */
export function successMessage(outcome: PublishOutcome): string {
    const people = formatPeople(outcome.recipients);
    let message: string;

    switch (outcome.status) {
        case 'sent':
            message = outcome.previousStatus === 'sent' ? 'Post updated.' : `Emailed to ${people}.`;
            break;
        case 'published':
            if (outcome.previousStatus === 'published') {
                message = 'Live post updated.';
            } else {
                message = outcome.emailed ? `Published and emailed to ${people}.` : 'Published.';
            }
            break;
        case 'scheduled': {
            const when = formatWhen(outcome.publishedAt);
            message = when ? `Scheduled for ${when}.` : 'Scheduled.';
            if (outcome.emailed) {
                message += ` It will be emailed to ${people}.`;
            }
            break;
        }
        default:
            if (outcome.previousStatus === 'published') {
                message = 'Unpublished. Saved as a draft on Ghost.';
            } else if (outcome.previousStatus === 'scheduled') {
                message = 'Unscheduled. Saved as a draft on Ghost.';
            } else {
                message = outcome.previousStatus === 'draft' ? 'Draft updated on Ghost.' : 'Draft saved to Ghost.';
            }
    }

    return outcome.archivedTo ? `${message} Note moved to ${outcome.archivedTo}.` : message;
}

/**
 * Should the note be moved to the archive folder after this save?
 */
export function shouldArchive(
    when: ArchiveWhen,
    outcome: { status: ServerPostStatus; previousStatus?: ServerPostStatus }
): boolean {
    if (when === 'published') {
        return isOut(outcome.status) && !isOut(outcome.previousStatus);
    }
    // first-send: the first time the note reaches Ghost, drafts included
    return outcome.previousStatus === undefined;
}

/** Address of a post in the Ghost admin editor. */
export function editorUrl(ghostUrl: string, postId: string): string {
    return `${ghostUrl.replace(/\/+$/, '')}/ghost/#/editor/post/${postId}`;
}

/** "312 KB", "1.4 MB". */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A short, stable fingerprint of a note's body (FNV-1a). Used to tell whether
 * the note has changed since it was last sent to Ghost. Not for security.
 */
export function hashContent(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export type SyncState = 'in-sync' | 'ahead' | 'unknown';

/** Text for the status bar item of a note that is on Ghost. */
export function statusBarText(status: string | undefined, sync: SyncState): string {
    const known = status === 'draft' || status === 'published' || status === 'scheduled' || status === 'sent';
    const base = known ? `Ghost: ${status}` : 'On Ghost';
    if (sync === 'ahead') {
        return `${base}, local edits not pushed`;
    }
    return sync === 'in-sync' ? `${base}, in sync` : base;
}
