import { publicApiPost } from "@/shared/lib/http/public-client";

export type FunnelEvent =
  | "landing_view"
  | "signup_started"
  | "signup_completed"
  | "facebook_connect_started"
  | "facebook_connect_succeeded"
  | "shop_profile_completed"
  | "first_product_added"
  | "assistant_test_passed"
  | "first_inbound_message"
  | "first_ai_reply_sent"
  | "first_order_captured"
  | "first_rto_flag"
  | "trial_day_7_active";

const SESSION_KEY = "easymod:funnel_session";

function getSessionId() {
  try {
    let value = sessionStorage.getItem(SESSION_KEY);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, value);
    }
    return value;
  } catch {
    return "session-unavailable";
  }
}

export function trackFunnelEvent(
  event: FunnelEvent,
  metadata: Record<string, string | number | boolean | null | undefined> = {},
  options: { onceKey?: string } = {},
) {
  try {
    if (options.onceKey) {
      const key = `easymod:funnel_once:${options.onceKey}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    }
  } catch {
    // Tracking must never interrupt the user flow.
  }

  publicApiPost("/api/analytics/funnel", {
    event,
    metadata,
    sessionId: getSessionId(),
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
  }).catch(() => {});
}
