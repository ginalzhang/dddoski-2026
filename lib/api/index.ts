import { createHttpApi } from '@/lib/api/http';
import { mockApi } from '@/lib/api/mock';
import type { RetentionApi } from '@/lib/api/types';

// Set NEXT_PUBLIC_API_URL to talk to the real backend.
// Leave it unset to use the in-memory mock.
const baseUrl = process.env.NEXT_PUBLIC_API_URL;

export const api: RetentionApi = baseUrl ? createHttpApi(baseUrl) : mockApi;
export const isMockApi = !baseUrl;

export * from '@/lib/api/types';
