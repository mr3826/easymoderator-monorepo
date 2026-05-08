// Knowledge types for AI training
export interface BusinessInfo {
  shopName: string;
  address: string;
  location?: string;
  phone: string;
  openingHours: string;
  deliveryAreas: string[];
  paymentMethods: string[];
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
