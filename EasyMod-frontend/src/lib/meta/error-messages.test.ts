import { describe, expect, it } from 'vitest';
import { extractMetaApiError, getMetaErrorMessage } from './error-messages';
import { normalizeApiError } from '@/shared/lib/http/errors';

describe('Meta error mapping', () => {
  it('preserves stable string error codes from normalized API errors', () => {
    expect(extractMetaApiError({
      statusCode: 403,
      code: 'META_PAGE_TASKS_REQUIRED',
      message: 'Page tasks are insufficient',
    })).toEqual({
      code: 'META_PAGE_TASKS_REQUIRED',
      message: 'Page tasks are insufficient',
    });
  });

  it('maps the stable Page task rejection to merchant-facing copy', () => {
    expect(getMetaErrorMessage('META_PAGE_TASKS_REQUIRED', null, 'en')).toContain('not eligible');
  });

  it('keeps a top-level backend stable code through API error normalization', () => {
    const normalized = normalizeApiError({
      response: {
        status: 403,
        data: {
          success: false,
          message: 'Page tasks are insufficient',
          code: 'META_PAGE_TASKS_REQUIRED',
        },
      },
    });

    expect(extractMetaApiError(normalized).code).toBe('META_PAGE_TASKS_REQUIRED');
  });
});
