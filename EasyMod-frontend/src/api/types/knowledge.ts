/**
 * Knowledge Base types
 */

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
  confidence: number;
  source: 'manual' | 'ai' | 'import';
  active: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeGap {
  id: number;
  question: string;
  platform: string;
  language: string;
  created_at: string;
}

export interface BusinessInfo {
  name?: string;
  description?: string;
  contact_email?: string;
  contact_phone?: string;
  website?: string;
  address?: string;
  hours?: string;
  [key: string]: string | undefined;
}

export interface BrandingRules {
  tone?: 'professional' | 'friendly' | 'casual';
  language_style?: string;
  greeting_template?: string;
  signature_template?: string;
  restricted_phrases?: string[];
  required_disclaimers?: string[];
}

export interface KnowledgeSummary {
  faqs: FAQ[];
  business_info: BusinessInfo;
  branding_rules: BrandingRules;
  documents: unknown[];
  gaps: KnowledgeGap[];
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
  url?: string;
  text?: string;
  tags?: string[];
  source?: string;
  created_at?: string;
}
