export type MessagePlatform = 'facebook' | 'instagram';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderRole = 'customer' | 'ai' | 'agent' | 'system';

export interface NormalizedAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'location' | 'template';
  url?: string;
  mimeType?: string;
  filename?: string;
  payload?: Record<string, unknown>;
}

export interface NormalizedMessage {
  id: string;
  externalId: string | null;
  conversationId: string;
  shopId: string;
  channelId: string;
  platform: MessagePlatform;

  direction: MessageDirection;
  senderRole: MessageSenderRole;
  customerId: string;
  customerExternalId: string;
  pageOrAccountId: string;

  text: string | null;
  attachments: NormalizedAttachment[];
  language?: 'bn' | 'en' | 'banglish' | null;

  inReplyToExternalId?: string | null;
  threadContext?: {
    isCommentToDm?: boolean;
    commentId?: string;
    postId?: string;
    privateReplyEligible?: boolean;
  };

  ai?: {
    intent?: string;
    confidence?: number;
    suggestedReply?: string;
    cacheHit?: boolean;
  };
  policy?: {
    decisionId?: string;
    allowed: boolean;
    reason?: string;
    messageTag?: string;
    withinWindow: boolean;
  };

  delivery?: {
    status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
    providerMessageId?: string;
    error?: string;
    sentAt?: string;
    deliveredAt?: string;
    readAt?: string;
  };

  isEcho?: boolean;

  occurredAt: string;
  receivedAt: string;
  createdAt: string;
}
