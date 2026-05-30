/**
 * Referral API Domain
 *
 * Invite-a-shop acquisition loop. Each shop shares its unique code; both the
 * inviter and the new shop earn bonus conversations on signup.
 * Backend: EasyMod-backend/src/modules/referral
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { AxiosResponse } from 'axios';

export interface ReferralRewards {
  REFERRER_REWARD: number;
  REFERRED_REWARD: number;
}

export interface ReferralStats {
  /** This shop's shareable referral code (its unique_code). */
  code: string | null;
  total_referrals: number;
  conversations_earned: number;
  rewards: ReferralRewards;
}

export interface ReferralCodeLookup {
  valid: boolean;
  shop_name: string | null;
}

/** Get the authenticated shop's referral code + lifetime stats. */
export async function getMyReferral(): Promise<ReferralStats> {
  const response: AxiosResponse<ApiResponse<ReferralStats>> = await httpClient.get(
    '/api/referral/me'
  );
  return response.data.data;
}

/** Validate an invite code (signup screen "invited by" hint). Unauthenticated. */
export async function validateCode(code: string): Promise<ReferralCodeLookup> {
  const response: AxiosResponse<ApiResponse<ReferralCodeLookup>> = await httpClient.get(
    `/api/referral/validate?code=${encodeURIComponent(code)}`
  );
  return response.data.data;
}
