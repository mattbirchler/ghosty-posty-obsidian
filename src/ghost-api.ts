import { requestUrl, RequestUrlResponse } from 'obsidian';
import { describeGhostError } from './ghost-errors';
import { GhostPostPayload, GhostPostResponse, GhostPostResult, GhostSiteResponse, GhostImageUploadResponse, GhostNewslettersResponse, GhostNewsletter, GhostTagsResponse } from './types';

/** Options controlling how a create/update is delivered. */
export interface PublishOptions {
    /** When set, the post is also sent to this newsletter (by slug). */
    newsletterSlug?: string;
}

/** A successful result carrying the affected post, or a failure with a message. */
export type PostResult =
    | { success: true; post: GhostPostResult }
    | { success: false; error: string; status?: number };

/**
 * Read a response body as JSON without throwing when it isn't JSON
 * (for example an HTML error page from a proxy).
 */
function safeJson(response: RequestUrlResponse): unknown {
    try {
        return response.json as unknown;
    } catch {
        return undefined;
    }
}

/**
 * Convert a hex string to Uint8Array
 */
function hexToBytes(hex: string) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Base64url encode (URL-safe base64 without padding)
 */
function base64UrlEncode(data: Uint8Array | string): string {
    let base64: string;
    if (typeof data === 'string') {
        base64 = btoa(data);
    } else {
        // Convert Uint8Array to string then base64
        let binary = '';
        for (let i = 0; i < data.length; i++) {
            binary += String.fromCharCode(data[i]);
        }
        base64 = btoa(binary);
    }
    // Convert to base64url
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a Ghost Admin API JWT token using Web Crypto API
 * This is mobile-compatible (no Node.js crypto dependency)
 */
async function generateGhostToken(apiKey: string): Promise<string> {
    // Split the API key into ID and secret
    const [id, secret] = apiKey.split(':');

    if (!id || !secret) {
        throw new Error('Invalid API key format. Expected format: id:secret');
    }

    // Create JWT header
    const header = {
        alg: 'HS256',
        typ: 'JWT',
        kid: id
    };

    // Create JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iat: now,
        exp: now + 300, // 5 minutes expiration
        aud: '/admin/'
    };

    // Encode header and payload
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // Convert hex secret to bytes
    const secretBytes = hexToBytes(secret);

    // Import the key for HMAC-SHA256
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        secretBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    // Sign the input
    const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        new TextEncoder().encode(signatureInput)
    );

    // Encode signature
    const signature = base64UrlEncode(new Uint8Array(signatureBuffer));

    return `${signatureInput}.${signature}`;
}

export class GhostAPI {
    private ghostUrl: string;
    private apiKey: string;

    constructor(ghostUrl: string, apiKey: string) {
        // Normalize URL - remove trailing slash
        this.ghostUrl = ghostUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
    }

    /**
     * Get the authorization header with JWT token
     */
    private async getAuthHeader(): Promise<string> {
        const token = await generateGhostToken(this.apiKey);
        return `Ghost ${token}`;
    }

    /**
     * Make an API request to Ghost
     */
    private async request(
        method: 'GET' | 'POST' | 'PUT' | 'DELETE',
        endpoint: string,
        body?: object
    ): Promise<RequestUrlResponse> {
        const token = await this.getAuthHeader();
        const url = `${this.ghostUrl}/ghost/api/admin${endpoint}`;

        const options: Parameters<typeof requestUrl>[0] = {
            url,
            method,
            // Don't throw on 4xx/5xx: we want to read Ghost's own error message.
            throw: false,
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        return requestUrl(options);
    }

    /**
     * Test the connection to Ghost
     * Returns the site info if successful
     */
    async testConnection(): Promise<{ success: true; siteName: string } | { success: false; error: string }> {
        try {
            const response = await this.request('GET', '/site/');

            if (response.status >= 200 && response.status < 300) {
                const data = safeJson(response) as GhostSiteResponse | undefined;
                return {
                    success: true,
                    siteName: data?.site?.title || 'Unknown Site'
                };
            } else {
                return {
                    success: false,
                    error: describeGhostError(response.status, safeJson(response))
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Build the query string for a create/update, wiring up the source format
     * and (optionally) a newsletter send.
     */
    private buildPostQuery(options?: PublishOptions): string {
        const params = new URLSearchParams();
        // Use source=html to let Ghost convert our HTML to its internal format
        params.set('source', 'html');
        if (options?.newsletterSlug) {
            params.set('newsletter', options.newsletterSlug);
        }
        return `?${params.toString()}`;
    }

    /**
     * Create a new post on Ghost
     */
    async createPost(payload: GhostPostPayload, options?: PublishOptions): Promise<PostResult> {
        try {
            const response = await this.request('POST', `/posts/${this.buildPostQuery(options)}`, payload);
            return this.parsePostResponse(response);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Update an existing post on Ghost. The payload's post MUST include the
     * current `updated_at` (from getPost) so Ghost can detect collisions.
     */
    async updatePost(id: string, payload: GhostPostPayload, options?: PublishOptions): Promise<PostResult> {
        try {
            const response = await this.request('PUT', `/posts/${id}/${this.buildPostQuery(options)}`, payload);
            return this.parsePostResponse(response);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Fetch a single post by id. Pass `withHtml` to include the rendered
     * content (needed for sync, not for the publish modal).
     */
    async getPost(id: string, withHtml = false): Promise<PostResult> {
        try {
            const query = withHtml ? '?formats=html&include=tags' : '?include=tags';
            const response = await this.request('GET', `/posts/${id}/${query}`);
            return this.parsePostResponse(response);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * List the site's active newsletters (for the delivery picker).
     * Returns an empty list on failure so callers can degrade gracefully.
     */
    async getNewsletters(): Promise<GhostNewsletter[]> {
        try {
            // count.active_members gives the subscriber count shown before sending.
            // If a Ghost version doesn't return it, the count is simply omitted.
            const response = await this.request(
                'GET',
                '/newsletters/?filter=status:active&limit=all&include=count.active_members'
            );
            if (response.status >= 200 && response.status < 300) {
                const data = safeJson(response) as GhostNewslettersResponse | undefined;
                return data?.newsletters ?? [];
            }
            return [];
        } catch {
            return [];
        }
    }

    /**
     * List the names of every tag on the site (for tag autocomplete).
     * Returns an empty list on failure so the tag field still works as free text.
     */
    async getTags(): Promise<string[]> {
        try {
            const response = await this.request('GET', '/tags/?limit=all&fields=name&order=name%20asc');
            if (response.status >= 200 && response.status < 300) {
                const data = safeJson(response) as GhostTagsResponse | undefined;
                return (data?.tags ?? []).map((t) => t.name).filter((n) => typeof n === 'string' && n !== '');
            }
            return [];
        } catch {
            return [];
        }
    }

    /**
     * Parse a Ghost posts response into a PostResult.
     */
    private parsePostResponse(response: RequestUrlResponse): PostResult {
        if (response.status >= 200 && response.status < 300) {
            const data = safeJson(response) as GhostPostResponse | undefined;
            const post = data?.posts?.[0];
            if (!post) {
                return { success: false, error: 'Ghost returned no post data' };
            }
            return { success: true, post };
        }
        return {
            success: false,
            error: describeGhostError(response.status, safeJson(response)),
            status: response.status
        };
    }

    /**
     * Upload an image to Ghost
     */
    async uploadImage(filename: string, imageData: ArrayBuffer): Promise<{ success: true; url: string } | { success: false; error: string }> {
        try {
            const token = await this.getAuthHeader();
            const url = `${this.ghostUrl}/ghost/api/admin/images/upload/`;

            // Determine content type from filename
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const mimeTypes: Record<string, string> = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'bmp': 'image/bmp'
            };
            const contentType = mimeTypes[ext] || 'application/octet-stream';

            // Create multipart form data manually
            const boundary = '----GhostyPostyBoundary' + Math.random().toString(36).substring(2);

            // Build the multipart body
            const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;

            // Convert header and footer to Uint8Array
            const headerBytes = new TextEncoder().encode(header);
            const footerBytes = new TextEncoder().encode(footer);
            const imageBytes = new Uint8Array(imageData);

            // Combine all parts
            const body = new Uint8Array(headerBytes.length + imageBytes.length + footerBytes.length);
            body.set(headerBytes, 0);
            body.set(imageBytes, headerBytes.length);
            body.set(footerBytes, headerBytes.length + imageBytes.length);

            const response = await requestUrl({
                url,
                method: 'POST',
                throw: false,
                headers: {
                    'Authorization': token,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                },
                body: body.buffer
            });

            if (response.status >= 200 && response.status < 300) {
                const data = safeJson(response) as GhostImageUploadResponse | undefined;
                if (data?.images && data.images.length > 0) {
                    return {
                        success: true,
                        url: data.images[0].url
                    };
                } else {
                    return {
                        success: false,
                        error: 'No image URL returned from Ghost'
                    };
                }
            } else {
                return {
                    success: false,
                    error: describeGhostError(response.status, safeJson(response))
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
