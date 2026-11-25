/**
 * Read a video's size and length, and grab a frame to use as its thumbnail,
 * the same things Ghost's own editor works out before uploading a video.
 *
 * Everything here is best effort. If the app can't decode the video (some
 * codecs aren't supported everywhere) the upload still goes ahead, just
 * without a thumbnail or dimensions.
 */
export interface VideoProbe {
    width?: number;
    height?: number;
    /** Length in seconds. */
    duration?: number;
    /** A JPEG frame from near the start of the video. */
    thumbnail?: ArrayBuffer;
}

const PROBE_TIMEOUT_MS = 8000;

function once(target: HTMLVideoElement, event: string): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
        const finish = (ok: boolean) => {
            window.clearTimeout(timer);
            target.removeEventListener(event, onEvent);
            target.removeEventListener('error', onError);
            resolve(ok);
        };
        const onEvent = () => finish(true);
        const onError = () => finish(false);
        target.addEventListener(event, onEvent);
        target.addEventListener('error', onError);
    });
}

export async function probeVideo(data: ArrayBuffer, contentType: string): Promise<VideoProbe> {
    const result: VideoProbe = {};
    // A blob URL is same-origin, so a frame can be read back from a canvas.
    const objectUrl = URL.createObjectURL(new Blob([data], { type: contentType }));
    const video = document.createElement('video');

    try {
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        const loaded = once(video, 'loadedmetadata');
        video.src = objectUrl;
        if (!(await loaded) || !video.videoWidth || !video.videoHeight) {
            return result;
        }

        result.width = video.videoWidth;
        result.height = video.videoHeight;
        if (Number.isFinite(video.duration)) {
            result.duration = video.duration;
        }

        // Step slightly in: the very first frame is often black.
        const seeked = once(video, 'seeked');
        video.currentTime = Math.min(0.5, (result.duration ?? 1) / 2);
        if (!(await seeked)) {
            return result;
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) {
            return result;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        if (blob) {
            result.thumbnail = await blob.arrayBuffer();
        }
        return result;
    } catch {
        return result;
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
    }
}
