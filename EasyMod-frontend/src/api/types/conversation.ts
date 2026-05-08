/**
 * Conversation and Messaging types
 */

export type MessageSender = 'customer' | 'agent' | 'ai';
export type MessageType = 'text' | 'image' | 'file' | 'location';

export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  sender: MessageSender;
  message_type: MessageType;
  metadata?: unknown;
  ai_suggestion?: string;
  ai_confidence?: number;
  created_at: string;
  updated_at: string;
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
