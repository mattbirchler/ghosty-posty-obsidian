import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, FRONTMATTER_KEYS } from './types';

// These frontmatter keys form a stability contract: they are written into
// users' notes on publish and read back to decide create-vs-update and to
// sync. Renaming one silently breaks every already-published note, so pin them.
test('frontmatter keys are stable', () => {
    assert.equal(FRONTMATTER_KEYS.id, 'ghost_id');
    assert.equal(FRONTMATTER_KEYS.url, 'ghost_url');
    assert.equal(FRONTMATTER_KEYS.updatedAt, 'ghost_updated_at');
});

test('default settings exclude the API key so it cannot be persisted', () => {
    assert.equal(DEFAULT_SETTINGS.ghostUrl, '');
    assert.equal('apiKey' in DEFAULT_SETTINGS, false);
    assert.equal(DEFAULT_SETTINGS.archiveFolder, '');
    // Draft-by-default protects users from accidentally publishing live.
    assert.equal(DEFAULT_SETTINGS.defaultStatus, 'draft');
});
