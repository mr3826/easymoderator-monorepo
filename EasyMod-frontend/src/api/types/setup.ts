export type SetupTaskKey =
  | 'connect_channel'
  | 'shop_profile'
  | 'first_product'
  | 'ai_settings'
  | 'starter_knowledge';

export type SetupTaskStatus = 'complete' | 'incomplete';

export interface SetupTaskWarning {
  code: string;
  message: string;
}

export interface SetupTask {
  key: SetupTaskKey;
  title: string;
  description: string;
  status: SetupTaskStatus;
  required: boolean;
  ctaLabel: string;
  href: string;
  missing: string[];
  warnings: SetupTaskWarning[];
  meta: Record<string, unknown>;
}

export interface SetupStatus {
  isComplete: boolean;
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  tasks: SetupTask[];
  counts: {
    connectedFacebookPages: number;
    webhookVerifiedFacebookPages: number;
    activeProducts: number;
    activeFaqs: number;
    knowledgeDocuments: number;
  };
  generatedAt: string;
}
