import { useEffect, useState, useCallback } from "react";
import { Upload, Bot, CheckCircle, Edit2, Trash2, AlertCircle, FileText, MessageCircle, TrendingUp, Plus, Building2 } from "lucide-react";
import type { BusinessInfo, BrandingRules, FAQ, KnowledgeGap } from "../lib/knowledgeTypes";
import { apiClient } from "@/api";
import { useTranslation } from 'react-i18next';

type Tab = 'overview' | 'businessInfo' | 'faqs' | 'branding' | 'gaps';

export default function Knowledge() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo>({
    shopName: '', address: '', phone: '', openingHours: '',
    deliveryAreas: [], paymentMethods: [],
  });
  const [brandingRules, setBrandingRules] = useState<BrandingRules>({
    tone: 'formal', languagePreference: '', emojiUsage: 'none',
    forbiddenPhrases: [], escalationKeywords: [], greetingStyle: '', closingStyle: '',
  });
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([]);
  const [editingFAQ, setEditingFAQ] = useState<FAQ | null>(null);
  const [showFAQModal, setShowFAQModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Auto-dismiss notice after 4s — Fix #13
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setNotice({ text, type });
  }, []);

  const createTemporaryFaq = (): FAQ => ({
    id: crypto.randomUUID(),
    question: '', answer: '', category: 'General',
    confidence: 0.9, source: 'manual', active: true,
    usageCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  // Initial data load
  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const data = await apiClient.getKnowledgeSummary();
        setFaqs(data.faqs || []);
        if (data.businessInfo?.shopName !== undefined) setBusinessInfo(data.businessInfo);
        if (data.brandingRules?.tone !== undefined) setBrandingRules(data.brandingRules);
      } catch (error: any) {
        setLoadError(error.response?.data?.error?.message || 'Failed to load knowledge data');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Lazy-load gaps when that tab is opened — Fix #4
  useEffect(() => {
    if (activeTab !== 'gaps') return;
    let cancelled = false;
    apiClient.listKnowledgeGaps().then(gaps => {
      if (!cancelled) setKnowledgeGaps(gaps || []);
    }).catch((error: any) => {
      if (!cancelled) showNotice(error.response?.data?.error?.message || 'Failed to load knowledge gaps.', 'error');
    });
    return () => { cancelled = true; };
  }, [activeTab, showNotice]);

  // ── File upload — Fix #14: real progress steps ────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadProgress(10);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let text = '';

      if (extension === 'txt') {
        text = await file.text();
      } else if (extension === 'docx' || extension === 'doc') {
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        text = result.value || '';
        if (result.messages?.length) {
          console.warn('[mammoth] conversion warnings:', result.messages);
        }
      } else {
        throw new Error('Only .txt, .doc, or .docx files are supported.');
      }

      setUploadProgress(50);
      await apiClient.createKnowledgeDocument({
        name: file.name, contentType: file.type, size: file.size, text, source: 'upload'
      });
      setUploadProgress(100);
      showNotice('Document uploaded and queued for indexing.');
    } catch (error: any) {
      showNotice(error.response?.data?.error?.message || error.message || 'Failed to upload document.', 'error');
    } finally {
      setIsUploading(false);
      setShowUploadModal(false);
      setUploadProgress(0);
    }
  };

  // ── FAQ actions ───────────────────────────────────────────────────────────
  const handleToggleFAQ = async (faqId: string) => {
    const faq = faqs.find(f => f.id === faqId);
    if (!faq) return;
    try {
      const updated = await apiClient.updateKnowledgeFaq(faqId, { active: !faq.active });
      setFaqs(faqs.map(f => f.id === faqId ? updated : f));
      showNotice(`FAQ ${updated.active ? 'activated' : 'deactivated'}.`);
    } catch (error: any) {
      showNotice(error.response?.data?.error?.message || 'Failed to update FAQ.', 'error');
    }
  };

  const handleDeleteFAQ = async (faqId: string) => {
    try {
      await apiClient.deleteKnowledgeFaq(faqId);
      setFaqs(faqs.filter(f => f.id !== faqId));
      showNotice('FAQ deleted.');
    } catch (error: any) {
      showNotice(error.response?.data?.error?.message || 'Failed to delete FAQ.', 'error');
    }
  };

  const handleSaveFAQ = async () => {
    if (!editingFAQ) return;
    try {
      const existing = faqs.find(f => f.id === editingFAQ.id);
      if (existing) {
        const updated = await apiClient.updateKnowledgeFaq(editingFAQ.id, {
          question: editingFAQ.question, answer: editingFAQ.answer,
          category: editingFAQ.category, active: editingFAQ.active
        });
        setFaqs(faqs.map(f => f.id === editingFAQ.id ? updated : f));
      } else {
        const created = await apiClient.createKnowledgeFaq({
          question: editingFAQ.question, answer: editingFAQ.answer,
          category: editingFAQ.category, active: editingFAQ.active,
          confidence: editingFAQ.confidence, source: editingFAQ.source, usageCount: 0
        });
        setFaqs([...faqs, created]);
      }
      setShowFAQModal(false);
      setEditingFAQ(null);
      showNotice('FAQ saved.');
    } catch (error: any) {
      showNotice(error.response?.data?.error?.message || 'Failed to save FAQ.', 'error');
    }
  };

  const totalKnowledge = faqs.filter(f => f.active).length +
    (businessInfo.shopName ? 1 : 0) + (brandingRules.tone ? 1 : 0);

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('knowledge.title')}</h1>
          <p className="text-gray-600 mt-1 text-sm md:text-base">{t('knowledge.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowUploadModal(true)}
            disabled={isUploading}
            className={`flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-700'}`}
          >
            <Upload className="w-5 h-5" />
            {isUploading ? t('knowledge.uploading') : t('knowledge.uploadKnowledge')}
          </button>
          <button
            onClick={() => { setEditingFAQ(createTemporaryFaq()); setShowFAQModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            {t('knowledge.addFAQ')}
          </button>
        </div>
      </div>

      {isLoading && <div className="mb-6 text-gray-500">{t('knowledge.loading')}</div>}
      {loadError && <div className="mb-6 text-red-600">{loadError}</div>}

      {/* Notice — Fix #13: auto-dismiss, color-coded */}
      {notice && (
        <div className={`mb-6 rounded-lg px-4 py-3 flex items-center justify-between ${
          notice.type === 'error'
            ? 'bg-red-50 border border-red-200 text-red-800'
            : 'bg-green-50 border border-green-200 text-green-800'
        }`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-4 text-current opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[
          { icon: Bot, color: 'blue', value: totalKnowledge, label: t('knowledge.metrics.activeKnowledge') },
          { icon: MessageCircle, color: 'green', value: faqs.filter(f => f.active).length, label: t('knowledge.metrics.activeFAQs') },
          { icon: TrendingUp, color: 'purple', value: faqs.reduce((s, f) => s + (f.usageCount || 0), 0), label: t('knowledge.metrics.totalAnswersUsed') },
          { icon: AlertCircle, color: 'orange', value: knowledgeGaps.length, label: t('knowledge.metrics.knowledgeGaps') },
        ].map(({ icon: Icon, color, value, label }) => (
          <div key={label} className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-12 h-12 bg-${color}-100 rounded-lg flex items-center justify-center`}>
                <Icon className={`w-6 h-6 text-${color}-600`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-sm text-gray-600">{label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200">
          <div className="flex overflow-x-auto">
            {([
              { id: 'overview',      label: t('knowledge.tabs.overview'),      icon: FileText },
              { id: 'businessInfo',  label: t('knowledge.tabs.businessInfo') || 'Business Info', icon: Building2 },
              { id: 'faqs',          label: t('knowledge.tabs.faqs'),          icon: MessageCircle },
              { id: 'branding',      label: t('knowledge.tabs.branding'),       icon: Bot },
              { id: 'gaps',          label: t('knowledge.tabs.knowledgeGaps'), icon: AlertCircle },
            ] as { id: Tab; label: string; icon: any }[]).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-6 py-4 border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-6 border border-purple-200">
                <div className="flex items-start gap-4">
                  <Bot className="w-12 h-12 text-purple-600 shrink-0" />
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('knowledge.howItWorks')}</h3>
                    <p className="text-gray-700 mb-4">{t('knowledge.howItWorksDesc')}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-white border border-purple-300 text-purple-700 rounded-full text-sm">{t('knowledge.badgePdf')}</span>
                      <span className="px-3 py-1 bg-white border border-purple-300 text-purple-700 rounded-full text-sm">{t('knowledge.badgeConfidence')}</span>
                      <span className="px-3 py-1 bg-white border border-purple-300 text-purple-700 rounded-full text-sm">{t('knowledge.badgeOverride')}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-gray-200 rounded-lg p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">{t('knowledge.mostUsedFAQs')}</h3>
                  <div className="space-y-3">
                    {faqs.filter(f => f.active).sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 5).map((faq) => (
                      <div key={faq.id} className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm text-gray-900">{faq.question}</p>
                          <p className="text-xs text-gray-500">{t('knowledge.timesUsed', { count: faq.usageCount || 0 })}</p>
                        </div>
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                          {Math.round((faq.confidence || 0.9) * 100)}%
                        </span>
                      </div>
                    ))}
                    {faqs.filter(f => f.active).length === 0 && (
                      <p className="text-sm text-gray-400">No active FAQs yet.</p>
                    )}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">{t('knowledge.knowledgeStatus')}</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">{t('knowledge.statusItems.businessInfo')}</span>
                      {businessInfo.shopName
                        ? <CheckCircle className="w-5 h-5 text-green-600" />
                        : <span className="text-xs text-gray-400">Not set</span>}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">{t('knowledge.statusItems.brandingRules')}</span>
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">{t('knowledge.statusItems.activeFAQs')}</span>
                      <span className="text-gray-900 font-semibold">{faqs.filter(f => f.active).length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">{t('knowledge.statusItems.inactiveFAQs')}</span>
                      <span className="text-gray-500">{faqs.filter(f => !f.active).length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Business Info Tab — Fix #7 */}
          {activeTab === 'businessInfo' && (
            <div className="space-y-6 max-w-2xl">
              <h3 className="font-semibold text-gray-900">{t('knowledge.tabs.businessInfo') || 'Business Info'}</h3>

              {([
                { field: 'shopName',     label: 'Shop Name',     placeholder: 'My Boutique' },
                { field: 'address',      label: 'Address',       placeholder: 'Dhaka, Bangladesh' },
                { field: 'phone',        label: 'Phone', placeholder: '+880 1XXX-XXXXXX' },
                { field: 'openingHours', label: 'Opening Hours', placeholder: 'Sat–Thu 10am–9pm' },
              ] as { field: keyof BusinessInfo; label: string; placeholder: string }[]).map(({ field, label, placeholder }) => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                  <input
                    type="text"
                    value={(businessInfo[field] as string) || ''}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, [field]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Delivery Areas</label>
                <input
                  type="text"
                  value={(businessInfo.deliveryAreas || []).join(', ')}
                  onChange={(e) => setBusinessInfo({
                    ...businessInfo,
                    deliveryAreas: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="Dhaka, Chittagong, Sylhet"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated list of areas you deliver to.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Methods</label>
                <input
                  type="text"
                  value={(businessInfo.paymentMethods || []).join(', ')}
                  onChange={(e) => setBusinessInfo({
                    ...businessInfo,
                    paymentMethods: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="Cash on Delivery, bKash"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                onClick={async () => {
                  try {
                    const updated = await apiClient.updateKnowledgeBusinessInfo(businessInfo);
                    if (updated?.businessInfo) setBusinessInfo(updated.businessInfo);
                    showNotice('Business info updated and indexed.');
                  } catch (error: any) {
                    showNotice(error.response?.data?.error?.message || 'Failed to update business info.', 'error');
                  }
                }}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save Business Info
              </button>
            </div>
          )}

          {/* FAQs Tab */}
          {activeTab === 'faqs' && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t('knowledge.manageFAQs')}</h3>
                <span className="text-sm text-gray-600">
                  {t('knowledge.faqCount', { active: faqs.filter(f => f.active).length, total: faqs.length })}
                </span>
              </div>

              <div className="space-y-3">
                {faqs.map((faq) => (
                  <div
                    key={faq.id}
                    className={`border-2 rounded-lg p-4 transition-colors ${
                      faq.active ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900">{faq.question}</h4>
                          <span className={`px-2 py-1 text-xs rounded ${
                            (faq.confidence || 0) >= 0.9 ? 'bg-green-100 text-green-700'
                              : (faq.confidence || 0) >= 0.8 ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {Math.round((faq.confidence || 0.9) * 100)}% confidence
                          </span>
                          <span className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded">{faq.category}</span>
                        </div>
                        <p className="text-sm text-gray-700 mb-2">{faq.answer}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Source: {faq.source}</span>
                          <span>Used {faq.usageCount || 0} times</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleToggleFAQ(faq.id)}
                          className={`px-3 py-1 text-xs rounded ${
                            faq.active ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                          }`}
                        >
                          {faq.active ? t('channels.statusActive') : t('channels.statusInactive')}
                        </button>
                        <button
                          onClick={() => { setEditingFAQ(faq); setShowFAQModal(true); }}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteFAQ(faq.id)}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {faqs.length === 0 && (
                  <div className="py-12 text-center text-gray-400">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No FAQs yet. Add one or upload a document to get started.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Branding Tab */}
          {activeTab === 'branding' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('knowledge.branding.toneOfVoice')}</label>
                <select
                  value={brandingRules.tone}
                  onChange={(e) => setBrandingRules({ ...brandingRules, tone: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="formal">Formal</option>
                  <option value="friendly">Friendly</option>
                  <option value="casual">Casual</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('knowledge.branding.emojiUsage')}</label>
                <select
                  value={brandingRules.emojiUsage}
                  onChange={(e) => setBrandingRules({ ...brandingRules, emojiUsage: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">None</option>
                  <option value="light">Light (1–2 per message)</option>
                  <option value="moderate">Moderate (3–4 per message)</option>
                  <option value="heavy">Heavy (5+ per message)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('knowledge.branding.greetingStyle')}</label>
                <input type="text" value={brandingRules.greetingStyle}
                  onChange={(e) => setBrandingRules({ ...brandingRules, greetingStyle: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Hi! How can I help you?" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('knowledge.branding.closingStyle')}</label>
                <input type="text" value={brandingRules.closingStyle}
                  onChange={(e) => setBrandingRules({ ...brandingRules, closingStyle: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Thank you!" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('knowledge.branding.forbiddenPhrases')}</label>
                <input type="text"
                  value={(brandingRules.forbiddenPhrases ?? []).join(', ')}
                  onChange={(e) => setBrandingRules({ ...brandingRules, forbiddenPhrases: e.target.value.split(',').map(s => s.trim()) })}
                  placeholder="maybe, I think, not sure"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('knowledge.branding.escalationKeywords')}</label>
                <input type="text"
                  value={(brandingRules.escalationKeywords ?? []).join(', ')}
                  onChange={(e) => setBrandingRules({ ...brandingRules, escalationKeywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="human, agent, help, মানুষ"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-500 mt-1">
                  When a customer sends any of these keywords, AI auto-reply is paused and flagged for human review.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">Preview</h4>
                <div className="bg-white rounded-lg p-4 space-y-2">
                  <p className="text-gray-900">{brandingRules.greetingStyle || '(greeting)'}</p>
                  <p className="text-gray-700">We're at {businessInfo.address || '…'}. Hours: {businessInfo.openingHours || '…'}.</p>
                  <p className="text-gray-900">{brandingRules.closingStyle || '(closing)'}</p>
                </div>
              </div>

              <button
                onClick={async () => {
                  try {
                    const updated = await apiClient.updateKnowledgeBrandingRules(brandingRules);
                    if (updated?.brandingRules) setBrandingRules(updated.brandingRules);
                    showNotice('Branding rules updated and indexed.');
                  } catch (error: any) {
                    showNotice(error.response?.data?.error?.message || 'Failed to update branding rules.', 'error');
                  }
                }}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('knowledge.branding.saveChanges')}
              </button>
            </div>
          )}

          {/* Knowledge Gaps Tab — Fix #4: uses real schema */}
          {activeTab === 'gaps' && (
            <div>
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-2">{t('knowledge.gaps.title')}</h3>
                <p className="text-sm text-gray-600">{t('knowledge.gaps.description')}</p>
              </div>

              {knowledgeGaps.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No unanswered questions — your AI is handling everything!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {knowledgeGaps.map((gap) => (
                    <div key={gap.id} className="border-2 border-orange-200 rounded-lg p-4 bg-orange-50">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-gray-900">{gap.question}</h4>
                            <span className="px-2 py-1 bg-orange-200 text-orange-700 text-xs rounded">
                              {gap.frequency}×
                            </span>
                            {gap.platform && (
                              <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded capitalize">
                                {gap.platform}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            First asked: {new Date(gap.firstAsked).toLocaleDateString()} •{' '}
                            Last asked: {new Date(gap.lastAsked).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setEditingFAQ({ ...createTemporaryFaq(), question: gap.question });
                          setShowFAQModal(true);
                        }}
                        className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                      >
                        <CheckCircle className="w-4 h-4" />
                        {t('knowledge.gaps.createFAQ')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal — Fix #14: progress bar works */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowUploadModal(false); }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowUploadModal(false); }}
        >
          <div className="bg-white rounded-xl p-4 md:p-8 max-w-lg w-full">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('knowledge.uploadModal.title')}</h2>
            <p className="text-gray-600 mb-4">{t('knowledge.uploadModal.subtitle')}</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
              <strong>{t('knowledge.uploadModal.privacyNoticeLabel')}</strong> {t('knowledge.uploadModal.privacyNotice')}
            </div>

            {uploadProgress === 0 ? (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">{t('knowledge.uploadModal.dragDrop')}</p>
                <input type="file" onChange={handleFileUpload} accept=".txt,.doc,.docx" className="hidden" id="knowledge-upload" />
                <label htmlFor="knowledge-upload" className="inline-block px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer">
                  {t('knowledge.uploadModal.chooseFile')}
                </label>
                <p className="text-sm text-gray-500 mt-4">{t('knowledge.uploadModal.supportedFormats')}</p>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                    <span>{uploadProgress < 50 ? 'Reading file…' : uploadProgress < 100 ? 'Uploading…' : 'Done!'}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Bot className="w-4 h-4 animate-pulse" />
                  <span>{t('knowledge.uploadModal.analyzing')}</span>
                </div>
              </div>
            )}

            <button
              onClick={() => { setShowUploadModal(false); setUploadProgress(0); }}
              className="mt-6 w-full px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* FAQ Create/Edit Modal */}
      {showFAQModal && editingFAQ && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowFAQModal(false); }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowFAQModal(false); }}
        >
          <div className="bg-white rounded-xl p-4 md:p-8 max-w-2xl w-full">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {faqs.find(f => f.id === editingFAQ.id)
                ? t('knowledge.reviewModal.editFAQ')
                : t('knowledge.reviewModal.addNewFAQ')}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Question</label>
                <input type="text" value={editingFAQ.question}
                  onChange={(e) => setEditingFAQ({ ...editingFAQ, question: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="What is your question?" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Answer</label>
                <textarea value={editingFAQ.answer}
                  onChange={(e) => setEditingFAQ({ ...editingFAQ, answer: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your answer here…" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <input type="text" value={editingFAQ.category}
                  onChange={(e) => setEditingFAQ({ ...editingFAQ, category: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Delivery, Payment, Policy" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowFAQModal(false); setEditingFAQ(null); }}
                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveFAQ}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('knowledge.reviewModal.saveFAQ')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
