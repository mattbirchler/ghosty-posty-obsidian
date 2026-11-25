export type PostStatus = 'draft' | 'published' | 'scheduled';

/** Status as Ghost reports it. Email-only posts come back as `sent`. */
export type ServerPostStatus = PostStatus | 'sent';

/** When a note is moved to the archive folder. */
export type ArchiveWhen = 'first-send' | 'published';

/** Ghost post visibility. We support the three simple options (not specific tiers). */
export type PostVisibility = 'public' | 'members' | 'paid';

/** How a publish should be delivered. */
export type DeliveryMode = 'post' | 'post_and_newsletter' | 'newsletter_only';

export interface GhostyPostySettings {
    ghostUrl: string;
    apiKey: string;
    defaultStatus: PostStatus;
    archiveFolder: string;
    /**
     * `first-send`: archive the first time a note is sent to Ghost, drafts included.
     * `published`: archive only once the post is published or scheduled.
     */
    archiveWhen: ArchiveWhen;
}

export const DEFAULT_SETTINGS: GhostyPostySettings = {
    ghostUrl: '',
    apiKey: '',
    defaultStatus: 'draft',
    archiveFolder: '',
    archiveWhen: 'first-send'
};

/** Keys the plugin reads from / writes back to a note's YAML frontmatter. */
export const FRONTMATTER_KEYS = {
    id: 'ghost_id',
    url: 'ghost_url',
    updatedAt: 'ghost_updated_at'
} as const;

/**
 * Reference to a post that already exists on Ghost, read from frontmatter.
 * When present, publishing updates the existing post instead of creating a new one.
 */
export interface GhostPostRef {
    id: string;
    /** The updated_at value we last saw (from our last publish or sync). */
    updatedAt?: string;
    /** Public (or, for drafts, preview) address of the post. */
    url?: string;
}

/**
 * What a note's frontmatter says about the post. Optional fields are
 * `undefined` when the note doesn't set them, so an update can fall back to
 * the value currently on Ghost instead of a default.
 */
export interface PostMetadata {
    title: string;
    slug?: string;
    tags?: string[];
    /** Status for a new post: frontmatter, or the default from settings. */
    status: PostStatus;
    publishedAt?: string;
    visibility?: PostVisibility;
    excerpt?: string;
    featured?: boolean;
    /** Existing Ghost post to update, if this note has been published before. */
    existing?: GhostPostRef;
}

export interface GhostTag {
    name: string;
}

export interface GhostPost {
    title: string;
    html: string;
    /** Omitted when updating an email-only post, whose status can't change. */
    status?: PostStatus;
    tags?: GhostTag[];
    slug?: string;
    published_at?: string;
    feature_image?: string;
    feature_image_alt?: string;
    featured?: boolean;
    custom_excerpt?: string | null;
    visibility?: PostVisibility;
    email_only?: boolean;
    /** Required by Ghost on update for collision detection. */
    updated_at?: string;
}

/** What Ghost needs to show an uploaded video as a video card. */
export interface VideoInfo {
    url: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    /** Length in seconds. */
    duration?: number;
}

export interface GhostMediaUploadResponse {
    media: Array<{
        url: string;
        thumbnail_url?: string | null;
        ref: string | null;
    }>;
}

/** A local image or video referenced in a note. */
export interface ImageReference {
    originalSyntax: string;
    path: string;
    alt: string;
    isEmbed: boolean;
    isFirstLine: boolean;
}

export interface GhostImageUploadResponse {
    images: Array<{
        url: string;
        ref: string;
    }>;
}

export interface GhostPostPayload {
    posts: GhostPost[];
}

export interface GhostSiteResponse {
    site: {
        title: string;
        url: string;
    };
}

/** Shape returned by Ghost for a post (create/update/read). */
export interface GhostPostResult {
    id: string;
    title: string;
    slug: string;
    url: string;
    status: ServerPostStatus;
    updated_at: string;
    featured?: boolean;
    custom_excerpt?: string | null;
    /** Present when requested with ?formats=html on a read. */
    html?: string;
    tags?: Array<{ name: string }>;
    feature_image?: string | null;
    visibility?: PostVisibility;
    published_at?: string | null;
}

export interface GhostPostResponse {
    posts: GhostPostResult[];
}

export interface GhostNewsletter {
    id: string;
    name: string;
    slug: string;
    status: string;
    /** Present when requested with include=count.active_members. */
    count?: { active_members?: number };
}

export interface GhostTagsResponse {
    tags: Array<{ name: string }>;
}

export interface GhostNewslettersResponse {
    newsletters: GhostNewsletter[];
}

export interface GhostErrorResponse {
    errors: Array<{
        message: string;
        type: string;
        context?: string | null;
    }>;
}
