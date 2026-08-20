export type GrowthRole =
  | 'FOUNDER'
  | 'GROWTH_MANAGER'
  | 'BUSINESS_EXECUTIVE'
  | 'MARKETER'
  | 'CUSTOMER_SUCCESS'
  | 'READ_ONLY_ANALYST';

export interface GrowthSession {
  internalUserId: string;
  displayName: string;
  role: GrowthRole;
  permissions: string[];
}

export interface SigninPayload {
  email: string;
  password: string;
}

export interface SigninResult {
  requires2fa?: boolean;
  tempToken?: string;
}

export const PROSPECT_STATUSES = [
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'disqualified',
  'unreachable',
  'converted',
  'merged',
] as const;

export type ProspectStatus = typeof PROSPECT_STATUSES[number];

export const PROSPECT_ALLOWED_TRANSITIONS: Record<ProspectStatus, readonly ProspectStatus[]> = {
  new: ['contacted', 'disqualified', 'unreachable'],
  contacted: ['qualifying', 'disqualified', 'unreachable'],
  qualifying: ['qualified', 'disqualified', 'unreachable'],
  qualified: ['converted', 'disqualified', 'unreachable'],
  disqualified: ['qualifying'],
  unreachable: ['contacted'],
  converted: [],
  merged: [],
};

export const PROSPECT_SOURCES = [
  'self_signup',
  'partner_form',
  'manual_entry',
  'referral_mention',
  'inbound_message',
  'event',
  'other',
] as const;

export type ProspectSource = typeof PROSPECT_SOURCES[number];

export type ProspectMetadata = Record<string, unknown>;

export interface ProspectListItem {
  id: string;
  businessName: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  pageUrl: string | null;
  niche: string | null;
  notes: string | null;
  source: ProspectSource;
  sourceDetail: string | null;
  sourceReference: string | null;
  sourceRecordedAt: string | null;
  status: ProspectStatus;
  statusChangedAt: string | null;
  disqualifiedReason: string | null;
  ownerUserId: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  linkedShopId: string | null;
  linkedUserId: string | null;
  linkedAt: string | null;
  mergedIntoId: string | null;
  mergedAt: string | null;
  createdBy: string | null;
  metadata: ProspectMetadata | null;
  createdAt: string;
  updatedAt: string;
  eligibleForNextPhase: boolean;
  redacted?: true;
}

export interface ProspectTimelineEvent {
  id: string;
  eventType: string;
  actorUserId: string | null;
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  changedFields: string[];
  metadata: ProspectMetadata | null;
  createdAt: string;
}

export interface Prospect extends ProspectListItem {
  timeline: ProspectTimelineEvent[];
  timelinePagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ProspectLinkageSuggestion {
  userId: string | null;
  shopId: string;
  shopName: string;
  matchedFields: string[];
}

export interface ProspectListResponse {
  items: ProspectListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProspectListFilters {
  status?: ProspectStatus | '';
  source?: ProspectSource | '';
  ownerUserId?: string;
  q?: string;
  linked?: boolean | '' | 'true' | 'false';
  page?: number;
  pageSize?: number;
}

export interface ProspectFormPayload {
  businessName: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  pageUrl?: string | null;
  niche?: string | null;
  notes?: string | null;
  source: ProspectSource;
  sourceDetail?: string | null;
}

export type ProspectUpdatePayload = Partial<ProspectFormPayload>;

export interface ProspectDuplicateCheckPayload {
  contactPhone?: string;
  contactEmail?: string;
  pageUrl?: string;
  excludeId?: string;
}

export interface ProspectDuplicateMatch {
  prospectId: string;
  businessName: string;
  status: ProspectStatus;
  matchedFields: string[];
}

export interface ProspectDuplicateCheckResponse {
  matches: ProspectDuplicateMatch[];
}

export interface ProspectAssignmentPayload {
  ownerUserId: string | null;
  reason: string;
}

export interface ProspectStatusPayload {
  status: ProspectStatus;
  reason?: string;
}

export interface ProspectLinkPayload {
  shopId?: string | null;
  userId?: string | null;
  reason: string;
}

export interface ProspectMergePayload {
  targetProspectId: string;
  reason: string;
}

export interface ProspectMergeResult {
  mergedProspect: ProspectListItem;
  targetProspect: ProspectListItem;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
const REQUEST_TIMEOUT_MS = 10000;
let csrfToken: string | null = null;
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/signup',
  '/api/auth/signin',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/2fa/verify',
]);

async function initCsrfToken(): Promise<void> {
  if (csrfToken) return;
  const response = await fetch(`${apiBaseUrl}/api/csrf`, {
    credentials: 'include',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.csrfToken !== 'string') {
    throw new ApiError('Unable to initialize secure session.', response.status || 503);
  }
  csrfToken = payload.csrfToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const needsCsrf = isMutation && !CSRF_EXEMPT_PATHS.has(path);
  if (needsCsrf) await initCsrfToken();

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken && needsCsrf ? { 'X-CSRF-Token': csrfToken } : {}),
        ...options.headers,
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const details = payload?.details
        ?? payload?.error?.details
        ?? (typeof payload?.conflictingProspectId === 'string'
          ? { conflictingProspectId: payload.conflictingProspectId }
          : undefined)
        ?? (typeof payload?.error?.conflictingProspectId === 'string'
          ? { conflictingProspectId: payload.error.conflictingProspectId }
          : undefined);
      throw new ApiError(
        payload?.message || payload?.error?.message || 'Request failed',
        response.status,
        payload?.code || payload?.error?.code,
        details,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request timed out. Please try again.', 408, 'REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function addQueryValue(params: URLSearchParams, key: string, value: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

function boundedPageSize(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function conflictingProspectId(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const value = (details as { conflictingProspectId?: unknown }).conflictingProspectId;
  return typeof value === 'string' ? value : undefined;
}

export function getConflictingProspectId(error: unknown): string | undefined {
  return error instanceof ApiError ? conflictingProspectId(error.details) : undefined;
}

export const growthApi = {
  async getSession(): Promise<GrowthSession> {
    const payload = await request<{ success: true; data: GrowthSession }>('/api/internal/growth-os/session');
    return payload.data;
  },

  async signin(credentials: SigninPayload): Promise<SigninResult> {
    const payload = await request<{ data: SigninResult }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (!payload?.data?.requires2fa) {
      csrfToken = null;
      await initCsrfToken().catch(() => undefined);
    }
    return payload.data;
  },

  async verifyTwoFactor(tempToken: string, token: string): Promise<void> {
    await request('/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ tempToken, token }),
    });
    csrfToken = null;
    await initCsrfToken().catch(() => undefined);
  },

  async refresh(): Promise<void> {
    await request('/api/auth/refresh', { method: 'POST' });
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' });
  },

  async getProspects(filters: ProspectListFilters = {}): Promise<ProspectListResponse> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    addQueryValue(params, 'ownerUserId', filters.ownerUserId);
    addQueryValue(params, 'q', filters.q);
    if (filters.linked !== undefined && filters.linked !== '') params.set('linked', String(filters.linked));
    if (filters.page) params.set('page', String(Math.max(1, Math.floor(filters.page))));
    const pageSize = boundedPageSize(filters.pageSize);
    if (pageSize) params.set('pageSize', String(pageSize));
    const query = params.toString();
    const payload = await request<{ success: true; data: ProspectListResponse }>(
      `/api/internal/growth-os/prospects${query ? `?${query}` : ''}`,
    );
    return payload.data;
  },

  async getProspect(id: string, pagination: { timelinePage?: number; timelinePageSize?: number } = {}): Promise<Prospect> {
    const params = new URLSearchParams();
    if (pagination.timelinePage) params.set('timelinePage', String(Math.max(1, Math.floor(pagination.timelinePage))));
    if (pagination.timelinePageSize) {
      params.set('timelinePageSize', String(boundedPageSize(pagination.timelinePageSize)));
    }
    const query = params.toString();
    const payload = await request<{ success: true; data: Prospect }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}${query ? `?${query}` : ''}`,
    );
    return payload.data;
  },

  async createProspect(data: ProspectFormPayload): Promise<ProspectListItem> {
    const payload = await request<{ success: true; data: ProspectListItem }>(
      '/api/internal/growth-os/prospects',
      { method: 'POST', body: JSON.stringify(data) },
    );
    return payload.data;
  },

  async updateProspect(id: string, data: ProspectUpdatePayload): Promise<ProspectListItem> {
    const payload = await request<{ success: true; data: ProspectListItem }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
    return payload.data;
  },

  async checkProspectDuplicates(
    data: ProspectDuplicateCheckPayload,
  ): Promise<ProspectDuplicateCheckResponse> {
    const params = new URLSearchParams();
    addQueryValue(params, 'contactPhone', data.contactPhone);
    addQueryValue(params, 'contactEmail', data.contactEmail);
    addQueryValue(params, 'pageUrl', data.pageUrl);
    addQueryValue(params, 'excludeId', data.excludeId);
    const query = params.toString();
    const payload = await request<{ success: true; data: ProspectDuplicateCheckResponse }>(
      `/api/internal/growth-os/prospects/duplicate-check${query ? `?${query}` : ''}`,
    );
    return payload.data;
  },

  async assignProspect(id: string, data: ProspectAssignmentPayload): Promise<ProspectListItem> {
    const payload = await request<{ success: true; data: ProspectListItem }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}/assign`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return payload.data;
  },

  async transitionProspectStatus(id: string, data: ProspectStatusPayload): Promise<ProspectListItem> {
    const payload = await request<{ success: true; data: ProspectListItem }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}/status`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return payload.data;
  },

  async linkProspect(id: string, data: ProspectLinkPayload): Promise<ProspectListItem> {
    const payload = await request<{ success: true; data: ProspectListItem }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}/link`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return payload.data;
  },

  async getProspectLinkageSuggestions(id: string): Promise<ProspectLinkageSuggestion[]> {
    const payload = await request<{ success: true; data: ProspectLinkageSuggestion[] }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}/linkage-suggestions`,
    );
    return payload.data;
  },

  async mergeProspect(id: string, data: ProspectMergePayload): Promise<ProspectMergeResult> {
    const payload = await request<{ success: true; data: ProspectMergeResult }>(
      `/api/internal/growth-os/prospects/${encodeURIComponent(id)}/merge`,
      { method: 'POST', body: JSON.stringify(data) },
    );
    return payload.data;
  },
};
