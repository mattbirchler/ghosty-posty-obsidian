export type PostStatus = 'draft' | 'published' | 'scheduled';

export interface GhostyPostySettings {
    ghostUrl: string;
    apiKey: string;
    defaultStatus: PostStatus;
    archiveFolder: string;
}

export const DEFAULT_SETTINGS: GhostyPostySettings = {
    ghostUrl: '',
    apiKey: '',
    defaultStatus: 'draft',
    archiveFolder: ''
};

export interface PostMetadata {
    title: string;
    slug?: string;
    tags: string[];
    status: PostStatus;
    publishedAt?: string;
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

export interface GhostPostResponse {
    posts: Array<{
        id: string;
        title: string;
        slug: string;
        url: string;
        status: PostStatus;
    }>;
}

export interface GhostErrorResponse {
    errors: Array<{
        message: string;
        type: string;
    }>;
}
