import { GhostErrorResponse } from './types';

/**
 * Turn a failed Ghost response into the most useful message available.
 * Ghost puts the summary in `message` and the specific cause in `context`.
 */
export function describeGhostError(status: number, body: unknown): string {
    const first = (body as GhostErrorResponse | undefined)?.errors?.[0];
    if (first?.message) {
        const context = typeof first.context === 'string' ? first.context.trim() : '';
        return context && context !== first.message ? `${first.message} ${context}` : first.message;
    }
    if (status === 401 || status === 403) {
        return 'Ghost rejected the API key. Check the admin API key in settings.';
    }
    if (status === 404) {
        return 'Ghost could not find that (HTTP 404). Check the Ghost URL in settings.';
    }
    return `Ghost returned HTTP ${status}`;
}
