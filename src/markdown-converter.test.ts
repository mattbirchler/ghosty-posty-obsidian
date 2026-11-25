import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertMarkdownToHtml, replaceImageUrls, removeImages, renderVideos, stripComments } from './markdown-converter';

test('converts basic markdown to HTML', () => {
    const { html } = convertMarkdownToHtml('# Hello\n\nSome **bold** text.');
    assert.match(html, /<h1[^>]*>Hello<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
});

test('strips YAML frontmatter from the rendered body', () => {
    const md = '---\ntitle: My Post\ntags: [a, b]\n---\n\nActual content.';
    const { html } = convertMarkdownToHtml(md);
    assert.ok(!html.includes('title:'), 'frontmatter keys should not appear in output');
    assert.ok(!html.includes('My Post'), 'frontmatter values should not appear in output');
    assert.match(html, /Actual content\./);
});

test('always returns a warnings array', () => {
    const { warnings } = convertMarkdownToHtml('plain text');
    assert.ok(Array.isArray(warnings));
});

test('collects local standard-markdown images', () => {
    const md = 'Intro paragraph.\n\n![a cat](images/cat.png)';
    const { images } = convertMarkdownToHtml(md);
    assert.equal(images.length, 1);
    assert.equal(images[0].path, 'images/cat.png');
    assert.equal(images[0].alt, 'a cat');
    assert.equal(images[0].isEmbed, false);
});

test('ignores external (http/https) images', () => {
    const md = 'Intro.\n\n![remote](https://example.com/pic.png)';
    const { images, featuredImage } = convertMarkdownToHtml(md);
    assert.equal(images.length, 0);
    assert.equal(featuredImage, null);
});

test('collects Obsidian embed images and renders them as <img>', () => {
    const md = 'Intro.\n\n![[diagram.png]]';
    const { images, html } = convertMarkdownToHtml(md);
    assert.equal(images.length, 1);
    assert.equal(images[0].path, 'diagram.png');
    assert.equal(images[0].isEmbed, true);
    assert.match(html, /<img[^>]+src="diagram\.png"/);
});

test('honours alt text in Obsidian embeds', () => {
    const md = 'Intro.\n\n![[diagram.png|architecture]]';
    const { images } = convertMarkdownToHtml(md);
    assert.equal(images[0].alt, 'architecture');
});

test('does not treat non-image embeds as images', () => {
    const md = 'Intro.\n\n![[Some Note.md]]\n\n![[data.csv]]';
    const { images } = convertMarkdownToHtml(md);
    assert.equal(images.length, 0);
});

test('promotes a first-line image to the featured image and removes it from the body', () => {
    const md = '![[hero.png]]\n\n# Title\n\nBody text with ![[inline.png]].';
    const { featuredImage, images, html } = convertMarkdownToHtml(md);
    assert.ok(featuredImage, 'expected a featured image');
    assert.equal(featuredImage?.path, 'hero.png');
    // Featured image is excluded from the content image list...
    assert.equal(images.length, 1);
    assert.equal(images[0].path, 'inline.png');
    // ...and removed from the rendered HTML body.
    assert.ok(!html.includes('hero.png'), 'featured image should not appear in the body');
    assert.match(html, /<img[^>]+src="inline\.png"/);
});

test('detects a first-line featured image even after frontmatter', () => {
    const md = '---\ntitle: Post\n---\n\n![[hero.png]]\n\nBody.';
    const { featuredImage } = convertMarkdownToHtml(md);
    assert.equal(featuredImage?.path, 'hero.png');
});

test('URL-encodes embed paths that contain spaces', () => {
    const md = 'Intro.\n\n![[my photo.png]]';
    const { html } = convertMarkdownToHtml(md);
    assert.match(html, /src="my%20photo\.png"/);
});

test('flattens wiki links to plain text', () => {
    const { html } = convertMarkdownToHtml('See [[Some Page]] for details.');
    assert.match(html, /See Some Page for details\./);
    assert.ok(!html.includes('[['), 'wiki bracket syntax should be gone');
});

test('uses the display text of aliased wiki links', () => {
    const { html } = convertMarkdownToHtml('Read [[Target Note|the guide]].');
    assert.match(html, /Read the guide\./);
    assert.ok(!html.includes('Target Note'));
});

test('opens real markdown links in a new tab', () => {
    const { html } = convertMarkdownToHtml('[click](https://example.com)');
    assert.match(html, /href="https:\/\/example\.com"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
});

test('converts emoji shortcodes to emoji', () => {
    const { html } = convertMarkdownToHtml('Nice work :tada:');
    assert.ok(!html.includes(':tada:'), 'shortcode should be replaced');
});

test('renders GFM tables', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |';
    const { html } = convertMarkdownToHtml(md);
    assert.match(html, /<table>/);
    assert.match(html, /<td>1<\/td>/);
});

// --- replaceImageUrls ---------------------------------------------------

test('replaceImageUrls swaps local src paths for Ghost URLs', () => {
    const html = '<img src="images/cat.png" alt="">';
    const map = new Map([['images/cat.png', 'https://cdn.ghost.io/cat.png']]);
    const result = replaceImageUrls(html, map);
    assert.match(result, /src="https:\/\/cdn\.ghost\.io\/cat\.png"/);
    assert.ok(!result.includes('images/cat.png'));
});

test('replaceImageUrls matches URL-encoded path variants', () => {
    const html = '<img src="my%20photo.png" alt="">';
    const map = new Map([['my photo.png', 'https://cdn.ghost.io/p.png']]);
    const result = replaceImageUrls(html, map);
    assert.match(result, /src="https:\/\/cdn\.ghost\.io\/p\.png"/);
});

test('replaceImageUrls leaves unrelated URLs untouched', () => {
    const html = '<img src="https://other.com/x.png" alt="">';
    const map = new Map([['images/cat.png', 'https://cdn.ghost.io/cat.png']]);
    const result = replaceImageUrls(html, map);
    assert.equal(result, html);
});

// --- Obsidian comments ---------------------------------------------------

test('strips inline and multi-line Obsidian comments', () => {
    const md = 'Public %%private aside%% text.\n\n%%\nTODO: rewrite this\n%%\n\nMore public text.';
    const { html } = convertMarkdownToHtml(md);
    assert.ok(!html.includes('private aside'));
    assert.ok(!html.includes('TODO'));
    assert.ok(!html.includes('%%'));
    assert.match(html, /Public\s+text\./);
    assert.match(html, /More public text\./);
});

test('strips comments that contain inline code', () => {
    assert.equal(stripComments('a %%see `foo` here%% b'), 'a  b');
});

test('leaves %% inside code blocks and inline code alone', () => {
    const md = 'Use `%%` to open and `%%` to close.\n\n```mermaid\n%% a diagram comment\ngraph TD\n%% another\n```\n';
    assert.equal(stripComments(md), md);
});

test('leaves an unclosed %% as written', () => {
    assert.equal(stripComments('100%% sure'), '100%% sure');
});

test('does not upload images that only appear inside a comment', () => {
    const { images } = convertMarkdownToHtml('Intro.\n\n%%![[draft-idea.png]]%%');
    assert.equal(images.length, 0);
});

// --- Image sizes and alt text --------------------------------------------

test('does not turn an embed resize hint into alt text', () => {
    const { images, html } = convertMarkdownToHtml('Intro.\n\n![[shot.png|400]]\n\n![[wide.png|640x480]]');
    assert.equal(images[0].alt, '');
    assert.equal(images[1].alt, '');
    assert.match(html, /<img src="shot\.png" alt="">/);
});

test('keeps real alt text when a resize hint follows it', () => {
    const { images, html } = convertMarkdownToHtml('Intro.\n\n![[shot.png|Settings panel|400]]\n\n![A chart|300](chart.png)');
    assert.equal(images[0].alt, 'A chart');
    assert.equal(images[1].alt, 'Settings panel');
    assert.match(html, /alt="Settings panel"/);
    assert.match(html, /alt="A chart"/);
    assert.ok(!html.includes('400') && !html.includes('300'));
});

test('keeps the alt text of a featured image', () => {
    const { featuredImage } = convertMarkdownToHtml('![[hero.png|My desk at dusk]]\n\nBody.');
    assert.equal(featuredImage?.alt, 'My desk at dusk');
});

// --- Non-image embeds ----------------------------------------------------

test('drops non-image embeds and warns about them', () => {
    const { html, warnings } = convertMarkdownToHtml('Intro.\n\n![[Other note]]\n\n![[talk.mp3]]\n\nOutro.');
    assert.ok(!html.includes('<img'), 'no broken image should be rendered');
    assert.ok(!html.includes('Other note'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Other note, talk\.mp3/);
});

test('has no warnings for a note with only image embeds', () => {
    const { warnings } = convertMarkdownToHtml('Intro.\n\n![[a.png]]');
    assert.equal(warnings.length, 0);
});

// --- removeImages --------------------------------------------------------

test('removeImages drops the image and its empty paragraph', () => {
    const { html } = convertMarkdownToHtml('Before.\n\n![[my photo.png]]\n\nAfter ![[keep.png]].');
    const result = removeImages(html, ['my photo.png']);
    assert.ok(!result.includes('my%20photo.png'));
    assert.ok(!/<p>\s*<\/p>/.test(result));
    assert.match(result, /keep\.png/);
    assert.match(result, /Before\./);
});

// --- Videos --------------------------------------------------------------

test('collects local videos separately from images', () => {
    const md = 'Intro.\n\n![[demo clip.mp4]]\n\n![a walkthrough](media/tour.webm)\n\n![[shot.png]]';
    const { videos, images, featuredImage, warnings, html } = convertMarkdownToHtml(md);
    assert.deepEqual(videos.map((v) => v.path), ['demo clip.mp4', 'media/tour.webm']);
    assert.deepEqual(images.map((i) => i.path), ['shot.png']);
    assert.equal(featuredImage, null);
    assert.equal(warnings.length, 0);
    assert.ok(!html.includes('<img src="demo'), 'a video must not be rendered as an image');
    assert.ok(!html.includes('tour.webm"'), 'a video must not be rendered as an image');
});

test('a first-line video is not treated as the featured image', () => {
    const { featuredImage, videos } = convertMarkdownToHtml('![[intro.mp4]]\n\nBody.');
    assert.equal(featuredImage, null);
    assert.equal(videos.length, 1);
});

test('leaves remote videos alone', () => {
    const { videos } = convertMarkdownToHtml('Intro.\n\n![](https://example.com/clip.mp4)');
    assert.equal(videos.length, 0);
});

test('renderVideos turns a placeholder into a Ghost video card', () => {
    const { html } = convertMarkdownToHtml('Before.\n\n![[demo clip.mp4]]\n\nAfter.');
    const result = renderVideos(html, (path) => path === 'demo clip.mp4'
        ? { url: 'https://cdn.example/v.mp4', thumbnailUrl: 'https://cdn.example/v_thumb.jpg', width: 1920, height: 1080, duration: 75.4 }
        : undefined);
    // The pieces Ghost's importer reads: figure class, video in its container, size, duration, thumbnail
    assert.match(result, /<figure class="kg-card kg-video-card kg-width-regular" data-kg-thumbnail="https:\/\/cdn\.example\/v_thumb\.jpg">/);
    assert.match(result, /<div class="kg-video-container"><video src="https:\/\/cdn\.example\/v\.mp4" width="1920" height="1080"/);
    assert.match(result, /<div class="kg-video-duration">1:15<\/div>/);
    assert.ok(!result.includes('ghosty-video'));
    assert.match(result, /Before\./);
    assert.match(result, /After\./);
});

test('renderVideos copes with a video that could not be measured', () => {
    const { html } = convertMarkdownToHtml('![[clip.mp4]]\n\nText.');
    const result = renderVideos(html, () => ({ url: 'https://cdn.example/v.mp4' }));
    assert.match(result, /<video src="https:\/\/cdn\.example\/v\.mp4" playsinline/);
    assert.ok(!result.includes('kg-video-duration'));
    assert.ok(!result.includes('data-kg-thumbnail'));
});

test('renderVideos drops a video that was left out', () => {
    const { html } = convertMarkdownToHtml('Before.\n\n![[clip.mov]]\n\nAfter.');
    const result = renderVideos(html, () => undefined);
    assert.ok(!result.includes('ghosty-video'));
    assert.ok(!result.includes('<figure'));
});
