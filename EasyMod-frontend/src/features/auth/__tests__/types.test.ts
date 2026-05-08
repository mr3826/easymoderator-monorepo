/**
 * Auth feature unit tests - Example test structure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpClient } from '@shared/lib/http';
import { LoginSchema, RegisterSchema } from '../types';

vi.mock('@shared/lib/http', () => ({
  httpClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('Auth Feature - Types', () => {
  describe('LoginSchema', () => {
    it('validates valid login input', () => {
      const input = { email: 'user@example.com', password: 'password123' };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const input = { email: 'invalid-email', password: 'password123' };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects short password', () => {
      const input = { email: 'user@example.com', password: '123' };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('RegisterSchema', () => {
    it('validates valid registration input', () => {
      const input = {
        email: 'user@example.com',
        password: 'password123',
        confirmPassword: 'password123',
        name: 'John Doe',
      };
      const result = RegisterSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects mismatched passwords', () => {
      const input = {
        email: 'user@example.com',
        password: 'password123',
        confirmPassword: 'different',
        name: 'John Doe',
      };
      const result = RegisterSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
