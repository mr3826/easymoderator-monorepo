// Knowledge types for AI training
export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
  tiktok?: string;
  youtube?: string;
  website?: string;
}

export interface BusinessInfo {
  shopName: string;
  address: string;
  location?: string;
  phone: string;
  openingHours: string;
  // Collected on the Delivery Settings / Payment Settings pages (defaults:
  // delivery = whole Bangladesh, payment = Cash on Delivery). Kept optional for
  // back-compat with stored data; no longer edited in Business Info.
  deliveryAreas?: string[];
  paymentMethods?: string[];
  // Surfaced in the AI order-confirmation closing message.
  socialLinks?: SocialLinks;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
  confidence: number;
  source: string;
  active: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandingRules {
  tone: 'formal' | 'friendly' | 'casual';
  languagePreference: string;
  emojiUsage: 'none' | 'light' | 'moderate' | 'heavy';
  forbiddenPhrases: string[];
  escalationKeywords: string[];
  greetingStyle: string;
  closingStyle: string;
}

export interface KnowledgeExtraction {
  id: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
  status: 'processing' | 'review' | 'approved' | 'rejected';
  extractedData: {
    businessInfo?: Partial<BusinessInfo>;
    faqs?: FAQ[];
    branding?: Partial<BrandingRules>;
  };
  confidence: number;
  errors?: string[];
}

export interface KnowledgeGap {
  id: string;
  question: string;
  frequency: number;
  platform: string;
  language: string;
  firstAsked: string;
  lastAsked: string;
}
