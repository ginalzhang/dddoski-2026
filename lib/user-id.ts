const KEY = 'retention:user-id';

let cached: string | null = null;

/** Anonymous, per-browser user id. Sent to the backend as `X-User-Id`. */
export function getUserId(): string {
    if (cached) return cached;
    try {
        cached = localStorage.getItem(KEY);
        if (!cached) {
            cached = crypto.randomUUID();
            localStorage.setItem(KEY, cached);
        }
    } catch {
        cached ??= crypto.randomUUID();
    }
    return cached;
}
