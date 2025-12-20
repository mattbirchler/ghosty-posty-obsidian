import Showdown from 'showdown';

/**
 * Remove YAML frontmatter from markdown content
 */
function stripFrontmatter(markdown: string): string {
    // Match frontmatter at the start of the document
    const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    return markdown.replace(frontmatterRegex, '');
}

/**
 * Convert Obsidian-specific wiki links to plain text
 * [[Page Name]] -> Page Name
 * [[Page Name|Display Text]] -> Display Text
 */
function convertWikiLinks(markdown: string): string {
    // Match [[link]] or [[link|display]]
    return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, link, display) => {
        return display || link;
    });
}

/**
 * Convert Obsidian embeds to placeholders
 * ![[filename]] -> [Embedded: filename]
 */
function convertEmbeds(markdown: string): string {
    return markdown.replace(/!\[\[([^\]]+)\]\]/g, (_, filename) => {
        return `[Embedded content: ${filename}]`;
    });
}

/**
 * Check for local images and return warnings
 */
function findLocalImages(markdown: string): string[] {
    const warnings: string[] = [];

    // Find markdown images that look local (not starting with http/https)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;

    while ((match = imageRegex.exec(markdown)) !== null) {
        const src = match[2];
        if (!src.startsWith('http://') && !src.startsWith('https://')) {
            warnings.push(`Local image will not be uploaded: ${src}`);
        }
    }

    return warnings;
}

export interface ConversionResult {
    html: string;
    warnings: string[];
}

/**
 * Convert Obsidian markdown to HTML for Ghost
 */
export function convertMarkdownToHtml(markdown: string): ConversionResult {
    const warnings: string[] = [];

    // Check for local images before processing
    const imageWarnings = findLocalImages(markdown);
    warnings.push(...imageWarnings);

    // Process markdown
    let processed = stripFrontmatter(markdown);
    processed = convertWikiLinks(processed);
    processed = convertEmbeds(processed);

    // Add embed warnings
    if (processed.includes('[Embedded content:')) {
        warnings.push('Embedded content (e.g., ![[file]]) has been converted to placeholder text');
    }

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

    return { html, warnings };
}
