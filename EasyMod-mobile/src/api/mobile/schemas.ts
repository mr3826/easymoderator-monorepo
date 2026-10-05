import { z } from 'zod';

/** Wire contracts for the flag-gated mobile Home endpoints (ADR M-008). */
export const attentionEntityTypeSchema = z.enum(['order', 'conversation', 'product']);
export type AttentionEntityType = z.infer<typeof attentionEntityTypeSchema>;

export const attentionSignalTypeSchema = z.enum([
  'COURIER_FAILED',
  'COURIER_INDETERMINATE',
  'COURIER_SETUP_REQUIRED',
  'INBOX_NEEDS_REPLY',
  'DRAFT_ORDER',
  'RTO_VERIFY',
  'LOW_STOCK',
]);
export type AttentionSignalType = z.infer<typeof attentionSignalTypeSchema>;

export const attentionItemSchema = z.object({
  id: z.string(),
  tier: z.number().int().min(1).max(5),
  urgency_score: z.number(),
  signal_type: attentionSignalTypeSchema,
  reason_code: z.string().min(1).optional(),
  reason: z.string(),
  entity: z.object({
    type: attentionEntityTypeSchema,
    id: z.string(),
  }),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const attentionResponseSchema = z.object({
  items: z.array(attentionItemSchema),
  truncated_count: z.number().int().min(0),
  conversation_scan_truncated: z.boolean(),
  generated_at: z.string(),
});
export type AttentionResponse = z.infer<typeof attentionResponseSchema>;

export const pendingActionsSchema = z.object({
  draft_orders: z.number().int().min(0),
  needs_reply: z.number().int().min(0),
  courier_problems: z.number().int().min(0),
  rto_verify: z.number().int().min(0),
  low_stock: z.number().int().min(0),
});
export type PendingActions = z.infer<typeof pendingActionsSchema>;

export const todayResponseSchema = z.object({
  date: z.string(),
  order_count: z.number().int().min(0),
  revenue: z.number(),
  expected_order_value: z.number().optional(),
  revenue_basis: z.literal('expected_order_value').optional(),
  delivered_count: z.number().int().min(0),
  pending_actions: pendingActionsSchema,
  timezone_used: z.enum(['Asia/Dhaka', 'UTC']),
  timezone_note: z.string().nullable(),
  conversation_scan_truncated: z.boolean(),
  generated_at: z.string(),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

const inboxCustomerSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    channel_user_id: z.string().nullable().optional(),
  })
  .passthrough();

export const conversationSchema = z
  .object({
    id: z.string(),
    customer_id: z.string().nullable().optional(),
    customer: inboxCustomerSchema.nullable().optional(),
    channel: z.string(),
    meta_channel_id: z.string().nullable().optional(),
    metaChannel: z
      .object({
        id: z.string(),
        displayName: z.string().nullable().optional(),
        platform: z.string().nullable().optional(),
        purposeLabel: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    title: z.string().nullable().optional(),
    status: z.string(),
    hitl: z.boolean(),
    lastMessage: z.string().nullable().optional(),
    unreadCount: z.number().int().min(0),
    lastReadMessageId: z.string().nullable().optional(),
    lastReadMessageAt: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    suggestionCount: z.number().int().min(0).optional(),
    hasAiSuggestion: z.boolean().optional(),
    needs_merchant_reply: z.boolean().optional(),
    needs_merchant_reply_reason: z.string().nullable().optional(),
    ai_is_replying: z.boolean().optional(),
  })
  .passthrough();
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSchema),
  ai_reply_mode: z.string().optional(),
  pagination: z.object({
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  }),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const messageSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string(),
    content: z.string().nullable().optional(),
    sender: z.string(),
    message_type: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    ai_suggestion: z.string().nullable().optional(),
    ai_confidence: z.number().nullable().optional(),
    delivery_state: z.string().nullable().optional(),
    provider_message_id: z.string().nullable().optional(),
    delivery_source: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
    is_transcript_message: z.boolean().optional(),
    reply_to: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough();
export type ConversationMessage = z.infer<typeof messageSchema>;

export const conversationMessagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  suggestions: z.array(messageSchema),
  pagination: z.object({
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  }),
});
export type ConversationMessagesResponse = z.infer<typeof conversationMessagesResponseSchema>;

export const orderSummarySchema = z
  .object({
    id: z.string(),
    order_number: z.string().nullable().optional(),
    order_status: z.string().nullable().optional(),
    payment_status: z.string().nullable().optional(),
    fulfillment_status: z.string().nullable().optional(),
    total: z.union([z.number(), z.string()]).nullable().optional(),
    currency: z.string().nullable().optional(),
    customer_id: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
    customer_phone: z.string().nullable().optional(),
    customer: z.record(z.string(), z.unknown()).nullable().optional(),
    order_items: z.array(z.record(z.string(), z.unknown())).optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderListResponseSchema = z.object({
  orders: z.array(orderSummarySchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    hasNextPage: z.boolean(),
  }),
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const orderDetailSchema = orderSummarySchema.passthrough();
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const customerStatsSchema = z.object({
  total_orders: z.number().int().nonnegative(),
  delivered_count: z.number().int().nonnegative(),
  rto_count: z.number().int().nonnegative(),
  cancelled_count: z.number().int().nonnegative(),
  return_rate: z.number().nonnegative(),
});
export type CustomerStats = z.infer<typeof customerStatsSchema>;

export const customerQuickViewSchema = z.object({
  customer: z.record(z.string(), z.unknown()),
  orders: z.array(orderSummarySchema),
  stats: customerStatsSchema.optional(),
});
export type CustomerQuickView = z.infer<typeof customerQuickViewSchema>;

export const replyResponseSchema = z.object({
  message: messageSchema,
});
export type ReplyResponse = z.infer<typeof replyResponseSchema>;

export const aiModeResponseSchema = z.object({
  success: z.boolean(),
  ai_mode: z.string(),
  conversation_id: z.string(),
});
export type AiModeResponse = z.infer<typeof aiModeResponseSchema>;

export const customerRiskSummarySchema = z.object({
  delivered_count: z.number().int().nonnegative(),
  rto_count: z.number().int().nonnegative(),
  cancelled_count: z.number().int().nonnegative(),
  total_orders: z.number().int().nonnegative(),
  has_duplicate_recent_order: z.boolean(),
  recent_order_id: z.string().nullable().optional(),
  risk_level: z.enum(['low', 'medium', 'high']),
});
export type CustomerRiskSummary = z.infer<typeof customerRiskSummarySchema>;

export const customerRiskResponseSchema = z.object({
  risk: customerRiskSummarySchema,
});
export type CustomerRiskResponse = z.infer<typeof customerRiskResponseSchema>;

export const orderActionResponseSchema = z.object({
  success: z.boolean(),
  order: orderSummarySchema.passthrough(),
  idempotencyReplay: z.boolean().optional(),
});
export type OrderActionResponse = z.infer<typeof orderActionResponseSchema>;

export const courierBookingResponseSchema = z.object({
  success: z.boolean().optional(),
  tracking_id: z.string().nullable().optional(),
  consignment_id: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  booked_at: z.string().optional(),
  status: z.string().optional(),
  idempotencyReplay: z.boolean().optional(),
});
export type CourierBookingResponse = z.infer<typeof courierBookingResponseSchema>;

export const problemParcelSchema = z.object({
  order_id: z.string(),
  order_number: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  total_amount: z.number().nonnegative(),
  cod_amount: z.number().nonnegative(),
  delivery_provider: z.string().nullable().optional(),
  consignment_id: z.string().nullable().optional(),
  tracking_code: z.string().nullable().optional(),
  delivery_status: z.string().nullable().optional(),
  order_status: z.string().nullable().optional(),
  delivery_address: z.string().nullable().optional(),
  problem_reason: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});
export type ProblemParcel = z.infer<typeof problemParcelSchema>;

export const problemParcelsResponseSchema = z.object({
  parcels: z.array(problemParcelSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    hasNextPage: z.boolean(),
  }),
});
export type ProblemParcelsResponse = z.infer<typeof problemParcelsResponseSchema>;

export const trackingHistoryItemSchema = z.object({
  status: z.string(),
  timestamp: z.string().optional(),
  location: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export type TrackingHistoryItem = z.infer<typeof trackingHistoryItemSchema>;

export const deliveryTrackingResponseSchema = z.object({
  order_id: z.string(),
  order_number: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  consignment_id: z.string().nullable().optional(),
  current_status: z.string().nullable().optional(),
  estimated_delivery: z.string().nullable().optional(),
  actual_delivery: z.string().nullable().optional(),
  location_info: z.record(z.string(), z.unknown()).nullable().optional(),
  delivery_agent_info: z.record(z.string(), z.unknown()).nullable().optional(),
  status_history: z.array(trackingHistoryItemSchema).optional(),
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  delivery_address: z.string().nullable().optional(),
  total_amount: z.number().nonnegative().optional(),
  cod_amount: z.number().nonnegative().optional(),
  cod_derived_note: z.string().optional(),
});
export type DeliveryTrackingResponse = z.infer<typeof deliveryTrackingResponseSchema>;

export const mobileProductSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    name_bn: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    price: z.number().nonnegative(),
    compare_at_price: z.number().nullable().optional(),
    quantity: z.number().int(),
    low_stock_threshold: z.number().int().optional(),
    track_quantity: z.boolean().optional(),
    in_stock: z.boolean(),
    stock_status: z.enum(['in_stock', 'low_stock', 'out_of_stock']),
    image_url: z.string().nullable().optional(),
    images: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();
export type MobileProduct = z.infer<typeof mobileProductSchema>;

export const productListResponseSchema = z.object({
  products: z.array(mobileProductSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total_items: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const productQuickUpdateResponseSchema = mobileProductSchema;
export type ProductQuickUpdateResponse = z.infer<typeof productQuickUpdateResponseSchema>;

export const photoDraftResponseSchema = mobileProductSchema;
export type PhotoDraftResponse = z.infer<typeof photoDraftResponseSchema>;
