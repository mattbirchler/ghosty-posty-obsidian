export type PostStatus = 'draft' | 'published' | 'scheduled';

/** Ghost post visibility. We support the three simple options (not specific tiers). */
export type PostVisibility = 'public' | 'members' | 'paid';

/** How a publish should be delivered. */
export type DeliveryMode = 'post' | 'post_and_newsletter' | 'newsletter_only';

export interface GhostyPostySettings {
    ghostUrl: string;
    defaultStatus: PostStatus;
    archiveFolder: string;
}

export const DEFAULT_SETTINGS: GhostyPostySettings = {
    ghostUrl: '',
    defaultStatus: 'draft',
    archiveFolder: ''
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
}

export interface PostMetadata {
    title: string;
    slug?: string;
    tags: string[];
    status: PostStatus;
    publishedAt?: string;
    visibility: PostVisibility;
    /** Existing Ghost post to update, if this note has been published before. */
    existing?: GhostPostRef;
}

export interface GhostTag {
    name: string;
}

export interface GhostPost {
    title: string;
    html: string;
    status: PostStatus;
    tags?: GhostTag[];
    slug?: string;
    published_at?: string;
    feature_image?: string;
    featured?: boolean;
    visibility?: PostVisibility;
    email_only?: boolean;
    /** Required by Ghost on update for collision detection. */
    updated_at?: string;
}

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
    status: PostStatus;
    updated_at: string;
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
}

export interface GhostNewslettersResponse {
    newsletters: GhostNewsletter[];
}

export interface GhostErrorResponse {
    errors: Array<{
        message: string;
        type: string;
    }>;
}
