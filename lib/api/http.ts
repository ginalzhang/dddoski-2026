import { ApiError, type ApiErrorCode, type RetentionApi } from '@/lib/api/types';
import { getUserId } from '@/lib/user-id';

// Real backend client. Every request carries `X-User-Id` (an anonymous id
// stored in localStorage) so the backend can tie attempts to a user.

export function createHttpApi(baseUrl: string): RetentionApi {
    const root = baseUrl.replace(/\/+$/, '');

    async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
        let res: Response;
        try {
            res = await fetch(`${root}${path}`, {
                method: init.method ?? 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Id': getUserId(),
                },
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
            });
        } catch {
            throw new ApiError('NETWORK', "Couldn't reach the server", undefined);
        }

        if (!res.ok) {
            const data = (await res.json().catch(() => null)) as {
                code?: ApiErrorCode;
                message?: string;
            } | null;
            throw new ApiError(data?.code ?? (res.status === 404 ? 'NOT_FOUND' : 'UNKNOWN'), data?.message ?? res.statusText, res.status);
        }

        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
    }

    const v = (id: string) => `/shorts/${encodeURIComponent(id)}`;

    return {
        getFeed: ({ cursor, limit = 4, genre } = {}) => {
            const qs = new URLSearchParams({ limit: String(limit) });
            if (cursor) qs.set('cursor', cursor);
            if (genre) qs.set('genre', genre);
            return request(`/shorts?${qs}`);
        },
        getGenres: () => request(`/genres`),
        getQuiz: (id) => request(`${v(id)}/quiz`),
        submitQuizAttempt: (id, body) => request(`${v(id)}/quiz/attempts`, { method: 'POST', body }),
        recordWatch: (id, body) => request(`${v(id)}/watches`, { method: 'POST', body }),
        setLike: (id, liked) => request(`${v(id)}/like`, { method: 'PUT', body: { liked } }),
        getComments: (id) => request(`${v(id)}/comments`),
        postComment: (id, text) => request(`${v(id)}/comments`, { method: 'POST', body: { text } }),
        getStats: () => request(`/me/stats`),
    };
}
