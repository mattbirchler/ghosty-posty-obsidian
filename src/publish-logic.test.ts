import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    canEmail,
    editorUrl,
    formatBytes,
    hashContent,
    initialFormValues,
    publishButtonLabel,
    shouldArchive,
    statusBarText,
    statusChoices,
    successMessage,
    toLocalDatetimeString
} from './publish-logic';
import { GhostPostResult, PostMetadata } from './types';

const NOW = new Date(2026, 10, 25, 14, 30);

function serverPost(overrides: Partial<GhostPostResult> = {}): GhostPostResult {
    return {
        id: 'abc',
        title: 'On Ghost',
        slug: 'on-ghost',
        url: 'https://example.com/on-ghost/',
        status: 'published',
        updated_at: '2026-11-20T10:00:00.000Z',
        ...overrides
    };
}

const bareNote: PostMetadata = { title: 'My note', status: 'draft' };

// --- initialFormValues ---------------------------------------------------

test('a new post starts from frontmatter and defaults', () => {
    const values = initialFormValues(bareNote, undefined, NOW);
    assert.equal(values.status, 'draft');
    assert.equal(values.visibility, 'public');
    assert.deepEqual(values.tags, []);
    assert.equal(values.featured, false);
    // Schedule picker defaults to the next full hour
    assert.equal(values.scheduledAt, '2026-11-25T15:00');
});

test('updating a live post never defaults to draft', () => {
    // The note has no status in frontmatter, so metadata.status is the
    // "draft" default from settings. Ghost says published. Ghost wins.
    const values = initialFormValues(bareNote, serverPost({ status: 'published' }), NOW);
    assert.equal(values.status, 'published');
});

test('a scheduled post that has since gone live is treated as published', () => {
    const stale: PostMetadata = { title: 'T', status: 'scheduled' };
    const values = initialFormValues(stale, serverPost({ status: 'published' }), NOW);
    assert.equal(values.status, 'published');
});

test('an update falls back to Ghost for fields the note does not set', () => {
    const values = initialFormValues(bareNote, serverPost({
        tags: [{ name: 'Obsidian' }, { name: 'Writing' }],
        visibility: 'paid',
        custom_excerpt: 'From Ghost',
        featured: true
    }), NOW);
    assert.deepEqual(values.tags, ['Obsidian', 'Writing']);
    assert.equal(values.visibility, 'paid');
    assert.equal(values.excerpt, 'From Ghost');
    assert.equal(values.featured, true);
    assert.equal(values.slug, 'on-ghost');
});

test('frontmatter wins over Ghost for fields the note sets', () => {
    const note: PostMetadata = {
        title: 'T', status: 'draft', tags: [], visibility: 'public', excerpt: '', featured: false, slug: 'mine'
    };
    const values = initialFormValues(note, serverPost({
        tags: [{ name: 'Old' }], visibility: 'paid', custom_excerpt: 'Old', featured: true
    }), NOW);
    assert.deepEqual(values.tags, []);
    assert.equal(values.visibility, 'public');
    assert.equal(values.excerpt, '');
    assert.equal(values.featured, false);
    assert.equal(values.slug, 'mine');
});

test('a future publish_date in frontmatter seeds the schedule picker', () => {
    const when = new Date(2026, 11, 25, 9, 0);
    const note: PostMetadata = { title: 'T', status: 'scheduled', publishedAt: when.toISOString() };
    const values = initialFormValues(note, undefined, NOW);
    assert.equal(values.status, 'scheduled');
    assert.equal(values.scheduledAt, '2026-12-25T09:00');
});

test('a post scheduled on Ghost keeps its scheduled time', () => {
    const when = new Date(2026, 11, 1, 8, 15);
    const values = initialFormValues(bareNote, serverPost({ status: 'scheduled', published_at: when.toISOString() }), NOW);
    assert.equal(values.status, 'scheduled');
    assert.equal(values.scheduledAt, toLocalDatetimeString(when));
});

test('tier-limited visibility on Ghost is preserved, not reset', () => {
    const post = serverPost();
    (post as { visibility?: string }).visibility = 'tiers';
    assert.equal(initialFormValues(bareNote, post, NOW).visibility, 'tiers');
});

// --- statusChoices / canEmail --------------------------------------------

test('a live post cannot be scheduled, only kept or unpublished', () => {
    assert.deepEqual(statusChoices('published').map((c) => c.value), ['draft', 'published']);
    assert.equal(statusChoices(undefined).length, 3);
    assert.equal(statusChoices('sent').length, 0);
});

test('email is only offered for posts going out for the first time', () => {
    assert.equal(canEmail(undefined, 'published'), true);
    assert.equal(canEmail('draft', 'scheduled'), true);
    assert.equal(canEmail(undefined, 'draft'), false);
    assert.equal(canEmail('published', 'published'), false);
    assert.equal(canEmail('sent', 'published'), false);
});

// --- publishButtonLabel --------------------------------------------------

const base = { status: 'draft' as const, scheduledAt: '2026-11-26T09:00', delivery: 'post' as const, conflict: false };

test('the button names the action', () => {
    assert.equal(publishButtonLabel(base), 'Save draft');
    assert.equal(publishButtonLabel({ ...base, serverStatus: 'draft' }), 'Update draft');
    assert.equal(publishButtonLabel({ ...base, status: 'published' }), 'Publish now');
    assert.equal(publishButtonLabel({ ...base, status: 'published', serverStatus: 'published' }), 'Update live post');
    assert.equal(publishButtonLabel({ ...base, serverStatus: 'published' }), 'Unpublish and save as draft');
    assert.equal(publishButtonLabel({ ...base, serverStatus: 'scheduled' }), 'Unschedule and save as draft');
    assert.equal(publishButtonLabel({ ...base, status: 'published', serverStatus: 'sent' }), 'Update post');
});

test('the button says when an email will go out, and to how many', () => {
    assert.equal(
        publishButtonLabel({ ...base, status: 'published', delivery: 'post_and_newsletter', recipients: 12 }),
        'Publish and email 12 people'
    );
    assert.equal(
        publishButtonLabel({ ...base, status: 'published', delivery: 'newsletter_only', recipients: 1 }),
        'Send email to 1 person'
    );
    assert.equal(
        publishButtonLabel({ ...base, status: 'published', delivery: 'post_and_newsletter' }),
        'Publish and email subscribers'
    );
});

test('the schedule button includes the date', () => {
    const label = publishButtonLabel({ ...base, status: 'scheduled' });
    assert.match(label, /^Schedule for .*26/);
    assert.match(publishButtonLabel({ ...base, status: 'scheduled', delivery: 'post_and_newsletter', recipients: 5 }), /and email 5 people$/);
});

test('a conflict overrides every other label', () => {
    assert.equal(publishButtonLabel({ ...base, status: 'published', conflict: true }), 'Overwrite Ghost version');
});

// --- successMessage ------------------------------------------------------

test('success messages describe what actually happened', () => {
    assert.equal(successMessage({ status: 'draft', emailed: false }), 'Draft saved to Ghost.');
    assert.equal(successMessage({ status: 'draft', previousStatus: 'draft', emailed: false }), 'Draft updated on Ghost.');
    assert.equal(successMessage({ status: 'draft', previousStatus: 'published', emailed: false }), 'Unpublished. Saved as a draft on Ghost.');
    assert.equal(successMessage({ status: 'published', emailed: false }), 'Published.');
    assert.equal(successMessage({ status: 'published', previousStatus: 'published', emailed: false }), 'Live post updated.');
    assert.equal(successMessage({ status: 'published', emailed: true, recipients: 40 }), 'Published and emailed to 40 people.');
    assert.equal(successMessage({ status: 'sent', emailed: true, recipients: 40 }), 'Emailed to 40 people.');
    assert.match(successMessage({ status: 'scheduled', publishedAt: '2026-12-01T09:00:00.000Z', emailed: false }), /^Scheduled for .+\.$/);
});

test('success message mentions the archive move', () => {
    assert.equal(
        successMessage({ status: 'published', emailed: false, archivedTo: 'Published' }),
        'Published. Note moved to Published.'
    );
});

// --- shouldArchive -------------------------------------------------------

test('first-send archives on the first save only, drafts included', () => {
    assert.equal(shouldArchive('first-send', { status: 'draft' }), true);
    assert.equal(shouldArchive('first-send', { status: 'published', previousStatus: 'draft' }), false);
});

test('published archives when the post first goes out', () => {
    assert.equal(shouldArchive('published', { status: 'draft' }), false);
    assert.equal(shouldArchive('published', { status: 'published' }), true);
    assert.equal(shouldArchive('published', { status: 'scheduled', previousStatus: 'draft' }), true);
    assert.equal(shouldArchive('published', { status: 'published', previousStatus: 'published' }), false);
    assert.equal(shouldArchive('published', { status: 'published', previousStatus: 'scheduled' }), false);
});

// --- small helpers -------------------------------------------------------

test('editorUrl points at the Ghost admin editor', () => {
    assert.equal(editorUrl('https://example.com/', 'abc123'), 'https://example.com/ghost/#/editor/post/abc123');
});

test('formatBytes picks a readable unit', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(312 * 1024), '312 KB');
    assert.equal(formatBytes(1.4 * 1024 * 1024), '1.4 MB');
});

test('hashContent is stable and sensitive to edits', () => {
    assert.equal(hashContent('hello'), hashContent('hello'));
    assert.notEqual(hashContent('hello'), hashContent('hello!'));
    assert.match(hashContent(''), /^[0-9a-f]{8}$/);
});

test('status bar text reflects status and sync state', () => {
    assert.equal(statusBarText('published', 'in-sync'), 'Ghost: published, in sync');
    assert.equal(statusBarText('draft', 'ahead'), 'Ghost: draft, local edits not pushed');
    assert.equal(statusBarText(undefined, 'unknown'), 'On Ghost');
});
