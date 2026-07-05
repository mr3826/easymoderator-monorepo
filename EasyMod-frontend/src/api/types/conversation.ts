/**
 * Conversation and Messaging types
 */

export type MessageSender = 'customer' | 'agent' | 'ai';
export type MessageType = 'text' | 'image' | 'file' | 'location';

export type MessageSourceKind = 'rag' | 'faq' | 'product';

export interface MessageSourceReference {
  kind: MessageSourceKind;
  id?: string | null;
  title?: string | null;
  score?: number | null;
}

/**
 * Why an AI reply was held instead of delivered to the customer.
 *  - 'low_confidence': auto-mode reply below the shop's confidence threshold;
 *    the conversation was handed off to a human.
 *  - 'draft_mode': suggest-only / DRAFT / policy-withheld reply.
 */
export type HeldReason = 'low_confidence' | 'draft_mode';

export interface MessageMetadata {
  message_type?: MessageType;
  image_url?: string;
  file_url?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  delivery_status?: 'pending' | 'sent' | 'failed';
  delivery_error?: string;
  /** true = delivered to the customer; false = HELD as a reviewable suggestion. */
  delivered?: boolean;
  held_reason?: HeldReason;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  sender: MessageSender;
  message_type: MessageType;
  metadata?: MessageMetadata;
  ai_suggestion?: string;
  ai_confidence?: number;
  source_references?: MessageSourceReference[] | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMetaChannel {
  id: string;
  displayName: string | null;
  platform: 'facebook' | null;
  purposeLabel: string | null;
}

export interface Conversation {
  id: string;
  customer_id: string;
  customer?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  channel: 'telegram' | 'messenger' | 'facebook' | 'web';
  meta_channel_id?: string | null;
  metaChannel?: ConversationMetaChannel | null;
  title?: string;
  status: 'active' | 'closed' | 'archived';
  hitl?: boolean;
  lastMessage?: string;
  unreadCount?: number;
  created_at: string;
  updated_at: string;
  messages?: Message[];
  assignee_id?: string;
  assignee?: { id: string; name: string; email?: string };
  resolved_at?: string;
  resolution_note?: string;
}

export interface ResponseTemplate {
  id: string;
  name: string;
  content: string;
  body?: string;
  variables?: string[];
  category?: string;
  is_active?: boolean;
}

export interface VoiceTranscriptionRequest {
  messageId: string;
  audioBase64: string;
  language?: 'auto' | 'bengali' | 'english' | 'banglish';
}

export interface VoiceTranscriptionResponse {
  messageId: string;
  transcript: string;
  text?: string;
  language: string;
}
