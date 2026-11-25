import { Marked } from 'marked';
import { markedEmoji } from 'marked-emoji';
import { gemoji } from 'gemoji';
import { ImageReference, VideoInfo } from './types';

/**
 * Escape a string for safe use inside a double-quoted HTML attribute
 */
function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Build the Markdown-to-HTML converter, configured to match Ghost's needs:
 * GFM (tables, task lists, strikethrough, fenced code blocks), emoji
 * shortcodes, and links that open in a new window.
 */
function createConverter(): Marked {
    // Map :shortcode: names to emoji characters (GitHub's emoji set)
    const emojis: Record<string, string> = {};
    for (const entry of gemoji) {
        for (const name of entry.names) {
            emojis[name] = entry.emoji;
        }
    }

    const converter = new Marked();
    converter.use(markedEmoji({ emojis, renderer: (token) => token.emoji }));
    converter.use({
        gfm: true,
        breaks: false,
        renderer: {
            link({ href, title, tokens }): string {
                const text = this.parser.parseInline(tokens);
                const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : '';
                return `<a href="${escapeHtmlAttribute(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
            }
        }
    });
    return converter;
}

const markdownConverter = createConverter();

/**
 * Remove YAML frontmatter from markdown content
 * Returns the content without frontmatter and the frontmatter end position
 */
export function stripFrontmatter(markdown: string): { content: string; frontmatterEndIndex: number } {
    const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    const match = markdown.match(frontmatterRegex);
    if (match) {
        return {
            content: markdown.slice(match[0].length),
            frontmatterEndIndex: match[0].length
        };
    }
    return { content: markdown, frontmatterEndIndex: 0 };
}

/**
 * Check if a path is a local file (not an external URL)
 */
function isLocalPath(path: string): boolean {
    return !path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('data:');
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

/** Video files Obsidian can embed. Ghost accepts only some of them. */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'];

/** Video formats Ghost accepts for upload. */
export const GHOST_VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv'];

function extensionOf(path: string): string {
    return path.split('.').pop()?.toLowerCase() || '';
}

function isImagePath(path: string): boolean {
    return IMAGE_EXTENSIONS.includes(extensionOf(path));
}

export function isVideoPath(path: string): boolean {
    return VIDEO_EXTENSIONS.includes(extensionOf(path));
}

function videoPlaceholder(path: string): string {
    return `<!--ghosty-video:${encodeURIComponent(path)}-->`;
}

/**
 * Pull local videos out of the markdown, in either ![[clip.mp4]] or
 * ![](clip.mp4) form. Each is replaced by a placeholder on its own line,
 * which becomes a Ghost video card once the file has been uploaded.
 */
function extractVideos(markdown: string, videos: ImageReference[]): string {
    const place = (original: string, path: string, alt: string | undefined, isEmbed: boolean): string => {
        videos.push({ originalSyntax: original, path, alt: cleanAltText(alt), isEmbed, isFirstLine: false });
        return `\n\n${videoPlaceholder(path)}\n\n`;
    };

    return markdown
        .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match: string, path: string, alt: string | undefined) =>
            isVideoPath(path) ? place(match, path.trim(), alt, true) : match)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match: string, alt: string, path: string) =>
            isLocalPath(path) && isVideoPath(path) ? place(match, path, alt, false) : match);
}

/**
 * Remove Obsidian comments (%%like this%%, inline or spanning lines) so notes
 * to self never reach the published post. Code blocks and inline code are
 * left untouched, since `%%` is real syntax in some languages.
 */
export function stripComments(markdown: string): string {
    let out = '';
    let i = 0;
    const n = markdown.length;

    while (i < n) {
        const atLineStart = i === 0 || markdown[i - 1] === '\n';

        // Fenced code block: copy through to its closing fence.
        if (atLineStart) {
            const fence = /^ {0,3}(`{3,}|~{3,})/.exec(markdown.slice(i, i + 16));
            if (fence) {
                const closeRe = new RegExp(`\\n {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*(?=\\n|$)`, 'g');
                closeRe.lastIndex = i + fence[0].length;
                const close = closeRe.exec(markdown);
                const end = close ? close.index + close[0].length : n;
                out += markdown.slice(i, end);
                i = end;
                continue;
            }
        }

        // Inline code: copy through to the matching run of backticks.
        if (markdown[i] === '`') {
            let j = i;
            while (markdown[j] === '`') {
                j++;
            }
            const ticks = markdown.slice(i, j);
            const close = markdown.indexOf(ticks, j);
            const paragraphEnd = markdown.indexOf('\n\n', j);
            if (close !== -1 && (paragraphEnd === -1 || close < paragraphEnd)) {
                out += markdown.slice(i, close + ticks.length);
                i = close + ticks.length;
            } else {
                out += ticks;
                i = j;
            }
            continue;
        }

        // Comment: skip to the closing %%. An unclosed %% is left as written.
        if (markdown[i] === '%' && markdown[i + 1] === '%') {
            const close = markdown.indexOf('%%', i + 2);
            if (close !== -1) {
                i = close + 2;
                continue;
            }
        }

        out += markdown[i];
        i++;
    }

    return out;
}

/**
 * Clean the text after the pipe in an image. Obsidian uses it for both alt
 * text and resize hints (![[shot.png|400]] or |400x300), and a bare size is
 * not something a screen reader should announce.
 */
function cleanAltText(raw: string | undefined): string {
    if (!raw) {
        return '';
    }
    return raw
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part !== '' && !/^\d+(x\d+)?$/.test(part))
        .join(' ');
}

/**
 * Extract all local images from markdown content (frontmatter and comments
 * already removed). Handles both ![alt](path) and ![[path]] syntax.
 */
function extractAllImages(content: string): ImageReference[] {
    const images: ImageReference[] = [];

    // Find the first non-empty line to determine featured image
    const lines = content.split(/\r?\n/);
    let firstContentLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== '') {
            firstContentLineIndex = i;
            break;
        }
    }

    const isOnFirstLine = (index: number): boolean => {
        const lineNumber = content.substring(0, index).split(/\r?\n/).length - 1;
        return lineNumber === firstContentLineIndex;
    };

    // Match standard markdown images: ![alt](path)
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = markdownImageRegex.exec(content)) !== null) {
        const path = match[2];
        if (isLocalPath(path) && !isVideoPath(path)) {
            images.push({
                originalSyntax: match[0],
                path: path,
                alt: cleanAltText(match[1]),
                isEmbed: false,
                isFirstLine: isOnFirstLine(match.index)
            });
        }
    }

    // Match Obsidian embed images: ![[path]] or ![[path|alt]] or ![[path|400]]
    const embedImageRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    while ((match = embedImageRegex.exec(content)) !== null) {
        const path = match[1];
        if (isImagePath(path)) {
            images.push({
                originalSyntax: match[0],
                path: path,
                alt: cleanAltText(match[2]),
                isEmbed: true,
                isFirstLine: isOnFirstLine(match.index)
            });
        }
    }

    return images;
}

/**
 * Convert Obsidian-specific wiki links to plain text
 * [[Page Name]] -> Page Name
 * [[Page Name|Display Text]] -> Display Text
 */
function convertWikiLinks(markdown: string): string {
    return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, link: string, display: string | undefined) => {
        return display || link;
    });
}

/**
 * Convert Obsidian image embeds to standard markdown syntax
 * ![[image.png]] -> ![](image.png)
 * ![[image.png|alt text]] -> ![alt text](image.png)
 * ![[image.png|400]] -> ![](image.png)
 * Paths with spaces are URL-encoded so markdown parsers handle them correctly.
 * Embeds that are not images (other notes, PDFs, video) can't be published, so
 * they are removed and reported through `skipped`.
 */
function convertEmbeds(markdown: string, skipped: string[]): string {
    return markdown.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, path: string, alt: string | undefined) => {
        if (!isImagePath(path)) {
            skipped.push(path.trim());
            return '';
        }
        // URL-encode the path to handle spaces and special characters
        const encodedPath = encodeURI(path);
        return `![${cleanAltText(alt)}](${encodedPath})`;
    });
}

/**
 * Strip resize hints from standard markdown images: ![alt|400](path) -> ![alt](path)
 */
function cleanMarkdownImageAlts(markdown: string): string {
    return markdown.replace(/!\[([^\]]*\|[^\]]*)\]\(/g, (_match: string, alt: string) => `![${cleanAltText(alt)}](`);
}

export interface ConversionResult {
    html: string;
    warnings: string[];
    images: ImageReference[];
    featuredImage: ImageReference | null;
    /** Local videos, to be uploaded and shown as Ghost video cards. */
    videos: ImageReference[];
}

/**
 * Convert Obsidian markdown to HTML for Ghost
 */
export function convertMarkdownToHtml(markdown: string): ConversionResult {
    const warnings: string[] = [];

    // Drop frontmatter and private comments before anything else looks at the note
    let processed = stripComments(stripFrontmatter(markdown).content);

    // Swap local videos for placeholders before images are looked for
    const videos: ImageReference[] = [];
    processed = extractVideos(processed, videos);

    // Extract all images first
    const allImages = extractAllImages(processed);

    // Find featured image (first-line image)
    const featuredImage = allImages.find(img => img.isFirstLine) || null;

    // Get content images (excluding featured)
    const contentImages = featuredImage
        ? allImages.filter(img => !img.isFirstLine)
        : allImages;

    // Remove the featured image from content if it exists
    if (featuredImage) {
        // Remove the featured image line
        const lines = processed.split(/\r?\n/);
        const filteredLines = lines.filter((line, index) => {
            // Find the first non-empty line
            let firstNonEmptyIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() !== '') {
                    firstNonEmptyIndex = i;
                    break;
                }
            }
            // Remove if this is the first non-empty line and contains the featured image
            return !(index === firstNonEmptyIndex && line.includes(featuredImage.originalSyntax));
        });
        processed = filteredLines.join('\n');
    }

    // Convert Obsidian image embeds to standard markdown; drop other embeds
    const skippedEmbeds: string[] = [];
    processed = convertEmbeds(processed, skippedEmbeds);
    processed = cleanMarkdownImageAlts(processed);
    if (skippedEmbeds.length > 0) {
        const names = skippedEmbeds.join(', ');
        warnings.push(
            skippedEmbeds.length === 1
                ? `An embed that is not an image or video was left out: ${names}`
                : `${skippedEmbeds.length} embeds that are not images or videos were left out: ${names}`
        );
    }

    // Convert wiki links to plain text
    processed = convertWikiLinks(processed);

    // Convert to HTML using marked
    const html = markdownConverter.parse(processed, { async: false });

    return {
        html,
        warnings,
        images: contentImages,
        featuredImage,
        videos
    };
}

/**
 * Replace local image paths in HTML with uploaded Ghost URLs
 */
export function replaceImageUrls(html: string, urlMap: Map<string, string>): string {
    let result = html;

    for (const [localPath, ghostUrl] of urlMap) {
        // Try both the original path and URL-encoded version
        const pathVariants = [localPath, encodeURI(localPath)];

        for (const pathVariant of pathVariants) {
            // Escape special regex characters in the path
            const escapedPath = pathVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Replace in src attributes
            const regex = new RegExp(`src=["']${escapedPath}["']`, 'g');
            result = result.replace(regex, `src="${ghostUrl}"`);
        }
    }

    return result;
}

/**
 * Remove <img> tags for the given local paths from the HTML (used when the
 * user chooses to publish without an image that could not be uploaded).
 */
export function removeImages(html: string, paths: string[]): string {
    let result = html;

    for (const localPath of paths) {
        for (const pathVariant of [localPath, encodeURI(localPath)]) {
            const escapedPath = pathVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`<img[^>]*src=["']${escapedPath}["'][^>]*>`, 'g');
            result = result.replace(regex, '');
        }
    }

    // Drop paragraphs left empty by the removal
    return result.replace(/<p>\s*<\/p>\n?/g, '');
}

function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Build the markup Ghost recognises as a video card when it imports HTML.
 * This mirrors what Ghost's own editor produces: the importer reads the
 * source, size, duration and thumbnail from exactly these elements.
 */
function videoCardHtml(video: VideoInfo): string {
    const attr = escapeHtmlAttribute;
    const thumbnail = video.thumbnailUrl ? ` data-kg-thumbnail="${attr(video.thumbnailUrl)}"` : '';
    const size = video.width && video.height ? ` width="${video.width}" height="${video.height}"` : '';
    const duration = video.duration !== undefined
        ? `<div class="kg-video-duration">${formatDuration(video.duration)}</div>`
        : '';
    return `<figure class="kg-card kg-video-card kg-width-regular"${thumbnail}>` +
        `<div class="kg-video-container"><video src="${attr(video.url)}"${size} playsinline preload="metadata"></video></div>` +
        `${duration}</figure>`;
}

/**
 * Replace each video placeholder with a Ghost video card. `lookup` returns
 * the uploaded video for a local path, or undefined to leave the video out.
 */
export function renderVideos(html: string, lookup: (path: string) => VideoInfo | undefined): string {
    return html.replace(/<!--ghosty-video:([^>]*?)-->\n?/g, (_match: string, encoded: string) => {
        let path = encoded;
        try {
            path = decodeURIComponent(encoded);
        } catch {
            // Keep the raw value; it simply won't match an upload
        }
        const video = lookup(path);
        return video ? `${videoCardHtml(video)}\n` : '';
    });
}
