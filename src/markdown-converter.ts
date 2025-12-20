import Showdown from 'showdown';
import { ImageReference } from './types';

/**
 * Remove YAML frontmatter from markdown content
 * Returns the content without frontmatter and the frontmatter end position
 */
function stripFrontmatter(markdown: string): { content: string; frontmatterEndIndex: number } {
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

/**
 * Extract all images from markdown content
 * Handles both ![alt](path) and ![[path]] syntax
 */
function extractAllImages(markdown: string): ImageReference[] {
    const images: ImageReference[] = [];

    // Strip frontmatter first
    const { content } = stripFrontmatter(markdown);

    // Find the first non-empty line to determine featured image
    const lines = content.split(/\r?\n/);
    let firstContentLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== '') {
            firstContentLineIndex = i;
            break;
        }
    }

    // Match standard markdown images: ![alt](path)
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = markdownImageRegex.exec(content)) !== null) {
        const path = match[2];
        if (isLocalPath(path)) {
            // Determine if this is on the first content line
            const beforeMatch = content.substring(0, match.index);
            const lineNumber = beforeMatch.split(/\r?\n/).length - 1;
            const isFirstLine = lineNumber === firstContentLineIndex;

            images.push({
                originalSyntax: match[0],
                path: path,
                alt: match[1],
                isEmbed: false,
                isFirstLine
            });
        }
    }

    // Match Obsidian embed images: ![[path]] or ![[path|alt]]
    const embedImageRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    while ((match = embedImageRegex.exec(content)) !== null) {
        const path = match[1];
        // Check if it looks like an image file
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

        if (imageExtensions.includes(ext)) {
            // Determine if this is on the first content line
            const beforeMatch = content.substring(0, match.index);
            const lineNumber = beforeMatch.split(/\r?\n/).length - 1;
            const isFirstLine = lineNumber === firstContentLineIndex;

            images.push({
                originalSyntax: match[0],
                path: path,
                alt: match[2] || '',
                isEmbed: true,
                isFirstLine
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
    return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, link, display) => {
        return display || link;
    });
}

/**
 * Convert Obsidian image embeds to standard markdown syntax
 * ![[image.png]] -> ![](image.png)
 * ![[image.png|alt text]] -> ![alt text](image.png)
 */
function convertImageEmbeds(markdown: string): string {
    return markdown.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, path, alt) => {
        return `![${alt || ''}](${path})`;
    });
}

export interface ConversionResult {
    html: string;
    warnings: string[];
    images: ImageReference[];
    featuredImage: ImageReference | null;
}

/**
 * Convert Obsidian markdown to HTML for Ghost
 */
export function convertMarkdownToHtml(markdown: string): ConversionResult {
    const warnings: string[] = [];

    // Extract all images first
    const allImages = extractAllImages(markdown);

    // Find featured image (first-line image)
    const featuredImage = allImages.find(img => img.isFirstLine) || null;

    // Get content images (excluding featured)
    const contentImages = featuredImage
        ? allImages.filter(img => !img.isFirstLine)
        : allImages;

    // Process markdown
    let { content: processed } = stripFrontmatter(markdown);

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

    // Convert Obsidian embeds to standard markdown (for images)
    processed = convertImageEmbeds(processed);

    // Convert wiki links to plain text
    processed = convertWikiLinks(processed);

    // Convert to HTML using Showdown
    const converter = new Showdown.Converter({
        tables: true,
        tasklists: true,
        strikethrough: true,
        ghCodeBlocks: true,
        emoji: true,
        simpleLineBreaks: false,
        openLinksInNewWindow: true,
        headerLevelStart: 1
    });

    const html = converter.makeHtml(processed);

    return {
        html,
        warnings,
        images: contentImages,
        featuredImage
    };
}

/**
 * Replace local image paths in HTML with uploaded Ghost URLs
 */
export function replaceImageUrls(html: string, urlMap: Map<string, string>): string {
    let result = html;

    for (const [localPath, ghostUrl] of urlMap) {
        // Escape special regex characters in the path
        const escapedPath = localPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Replace in src attributes
        const regex = new RegExp(`src=["']${escapedPath}["']`, 'g');
        result = result.replace(regex, `src="${ghostUrl}"`);
    }

    return result;
}
