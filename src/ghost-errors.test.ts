import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeGhostError } from './ghost-errors';

test('uses the message and context Ghost sends', () => {
    const body = { errors: [{ message: 'Validation error, cannot save post.', type: 'ValidationError', context: 'Title cannot be longer than 255 characters.' }] };
    assert.equal(
        describeGhostError(422, body),
        'Validation error, cannot save post. Title cannot be longer than 255 characters.'
    );
});

test('uses the message alone when there is no context', () => {
    const body = { errors: [{ message: 'Resource not found', type: 'NotFoundError', context: null }] };
    assert.equal(describeGhostError(404, body), 'Resource not found');
});

test('explains auth failures when the body is not a Ghost error', () => {
    assert.match(describeGhostError(401, undefined), /API key/);
});

test('falls back to the HTTP status', () => {
    assert.equal(describeGhostError(502, '<html>Bad gateway</html>'), 'Ghost returned HTTP 502');
});
