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

export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  sender: MessageSender;
  message_type: MessageType;
  metadata?: unknown;
  ai_suggestion?: string;
  ai_confidence?: number;
  source_references?: MessageSourceReference[] | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMetaChannel {
  id: string;
  displayName: string | null;
  platform: 'facebook' | 'instagram' | null;
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
  channel: 'telegram' | 'messenger' | 'facebook' | 'instagram' | 'web';
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
  language: string;
}
