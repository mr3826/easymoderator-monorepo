import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Edit2, ExternalLink, Lightbulb, Loader2, MessageCircle, PenLine, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/api";
import {
  dismissGapSuggestion,
  listGapSuggestions,
  publishGapSuggestion,
  reviewGapSuggestion,
} from "@/api/domains/knowledge";
import type { FAQ } from "@/api/types/knowledge";
import { GAP_SUGGESTION_SETTINGS_PATHS } from "@/api/types/knowledge";
import type { GapDismissReason, KnowledgeGapSuggestion } from "@/api/types/knowledge";
import { getErrorMessage } from "@shared/lib/http/errors";

const GAP_DISMISS_REASONS: GapDismissReason[] = [
  "NOT_USEFUL",
  "ALREADY_ANSWERED",
  "CONFIG_ONLY",
  "OUTDATED",
  "OTHER",
];

/** Action-side 409 (GAP_STATE_CONFLICT): the row moved on elsewhere — re-fetch, never claim success. */
function isGapStateConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; code?: string; response?: { status?: number; data?: { error?: { code?: string } } } };
  const code = e?.code ?? e?.response?.data?.error?.code;
  const status = e?.statusCode ?? e?.response?.status;
  return code === "GAP_STATE_CONFLICT" || status === 409;
}

const createDraftFaq = (): FAQ => ({
  id: `draft-${Date.now()}`,
  question: "",
  answer: "",
  category: "General",
  confidence: 1,
  source: "manual",
  active: true,
  usageCount: 0,
  createdAt: "",
  updatedAt: "",
});

export default function FaqSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyFaqId, setBusyFaqId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingFaq, setEditingFaq] = useState<FAQ | null>(null);
  const [gapSuggestions, setGapSuggestions] = useState<KnowledgeGapSuggestion[] | null>(null);
  const [gapBusyId, setGapBusyId] = useState<string | null>(null);

  const loadFaqs = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      setFaqs(await apiClient.listKnowledgeFaqs());
    } catch (error: any) {
      setLoadError(getErrorMessage(error, t("manageShop.faqs.errors.load")));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadFaqs();
  }, []);

  // P+05: single fetch on mount; FEATURE_DISABLED/409/404 (and any other load
  // failure) leave `gapSuggestions` null, so the section renders nothing.
  const loadGapSuggestions = async () => {
    try {
      const result = await listGapSuggestions();
      setGapSuggestions(result.featureDisabled ? null : result.data);
    } catch {
      setGapSuggestions(null);
    }
  };

  useEffect(() => {
    void loadGapSuggestions();
  }, []);

  const handleGapStartAuthoring = async (suggestion: KnowledgeGapSuggestion) => {
    if (suggestion.status !== "OPEN") return;
    try {
      await reviewGapSuggestion(suggestion.id);
      setGapSuggestions((current) =>
        current?.map((item) => (item.id === suggestion.id ? { ...item, status: "IN_REVIEW" as const } : item)) ?? current
      );
    } catch (error: unknown) {
      if (isGapStateConflict(error)) await loadGapSuggestions();
    }
  };

  const handleGapPublish = async (suggestion: KnowledgeGapSuggestion, question: string, answer: string) => {
    try {
      setGapBusyId(suggestion.id);
      await publishGapSuggestion(suggestion.id, { question: question.trim(), answer: answer.trim() });
      setGapSuggestions((current) => current?.filter((item) => item.id !== suggestion.id) ?? current);
      toast.success(t("faqSettings.gaps.published"));
    } catch (error: unknown) {
      if (isGapStateConflict(error)) {
        toast.error(t("faqSettings.gaps.refreshed"));
        await loadGapSuggestions();
      } else {
        toast.error(getErrorMessage(error, t("faqSettings.gaps.actionFailed")));
      }
    } finally {
      setGapBusyId(null);
    }
  };

  const handleGapDismiss = async (suggestion: KnowledgeGapSuggestion, reason: GapDismissReason) => {
    try {
      setGapBusyId(suggestion.id);
      await dismissGapSuggestion(suggestion.id, reason);
      setGapSuggestions((current) => current?.filter((item) => item.id !== suggestion.id) ?? current);
      toast.success(t("faqSettings.gaps.dismissed"));
    } catch (error: unknown) {
      if (isGapStateConflict(error)) {
        toast.error(t("faqSettings.gaps.refreshed"));
        await loadGapSuggestions();
      } else {
        toast.error(getErrorMessage(error, t("faqSettings.gaps.actionFailed")));
      }
    } finally {
      setGapBusyId(null);
    }
  };

  const openGapSettings = (path: string) => navigate(path);

  const stats = useMemo(() => {
    const active = faqs.filter((faq) => faq.active).length;
    const used = faqs.reduce((sum, faq) => sum + (faq.usageCount || 0), 0);
    return { active, total: faqs.length, used };
  }, [faqs]);

  const isExistingFaq = Boolean(editingFaq && faqs.some((faq) => faq.id === editingFaq.id));
  const canSave = Boolean(editingFaq?.question.trim() && editingFaq?.answer.trim());

  const handleToggleFaq = async (faq: FAQ) => {
    try {
      setBusyFaqId(faq.id);
      const updated = await apiClient.updateKnowledgeFaq(faq.id, { active: !faq.active });
      setFaqs((current) => current.map((item) => (item.id === faq.id ? updated : item)));
      toast.success(updated.active ? t("manageShop.faqs.activated") : t("manageShop.faqs.deactivated"));
    } catch (error: any) {
      toast.error(getErrorMessage(error, t("manageShop.faqs.errors.update")));
    } finally {
      setBusyFaqId(null);
    }
  };

  const handleDeleteFaq = async (faq: FAQ) => {
    if (!window.confirm(t("manageShop.faqs.confirmDelete"))) return;

    try {
      setBusyFaqId(faq.id);
      await apiClient.deleteKnowledgeFaq(faq.id);
      setFaqs((current) => current.filter((item) => item.id !== faq.id));
      toast.success(t("manageShop.faqs.deleted"));
    } catch (error: any) {
      toast.error(getErrorMessage(error, t("manageShop.faqs.errors.delete")));
    } finally {
      setBusyFaqId(null);
    }
  };

  const handleSaveFaq = async () => {
    if (!editingFaq) return;
    if (!canSave) {
      toast.error(t("manageShop.faqs.validationError"));
      return;
    }

    const payload = {
      question: editingFaq.question.trim(),
      answer: editingFaq.answer.trim(),
      category: editingFaq.category.trim() || "General",
      active: editingFaq.active,
      confidence: editingFaq.confidence || 1,
      source: editingFaq.source || "manual",
      usageCount: editingFaq.usageCount || 0,
    };

    try {
      setIsSaving(true);
      if (isExistingFaq) {
        const updated = await apiClient.updateKnowledgeFaq(editingFaq.id, payload);
        setFaqs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await apiClient.createKnowledgeFaq(payload);
        setFaqs((current) => [created, ...current]);
      }
      setEditingFaq(null);
      toast.success(t("manageShop.faqs.saved"));
    } catch (error: any) {
      toast.error(getErrorMessage(error, t("manageShop.faqs.errors.save")));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-green-100 p-3 text-green-700">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 md:text-2xl">{t("manageShop.faqs.title")}</h2>
            <p className="text-sm text-gray-500">{t("manageShop.faqs.subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setEditingFaq(createDraftFaq())}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            {t("manageShop.faqs.addFaq")}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("manageShop.faqs.metrics.active")} value={stats.active} />
        <MetricCard label={t("manageShop.faqs.metrics.total")} value={stats.total} />
        <MetricCard label={t("manageShop.faqs.metrics.used")} value={stats.used} />
      </div>

      {gapSuggestions && gapSuggestions.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-white" data-testid="gap-suggestions">
          <div className="flex items-start gap-3 border-b border-gray-100 p-4">
            <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
              <Lightbulb className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">{t("faqSettings.gaps.title")}</h3>
              <p className="text-sm text-gray-500">{t("faqSettings.gaps.subtitle")}</p>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {gapSuggestions.map((suggestion) => (
              <GapSuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                busy={gapBusyId === suggestion.id}
                onAuthor={() => handleGapStartAuthoring(suggestion)}
                onPublish={(question, answer) => handleGapPublish(suggestion, question, answer)}
                onDismiss={(reason) => handleGapDismiss(suggestion, reason)}
                onOpenSettings={openGapSettings}
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{t("manageShop.faqs.manageTitle")}</h3>
            <p className="text-sm text-gray-500">
              {t("manageShop.faqs.faqCount", { active: stats.active, total: stats.total })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadFaqs()}
            disabled={isLoading}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {t("manageShop.faqs.refresh")}
          </button>
        </div>

        {loadError && (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {loadError}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm font-semibold text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("manageShop.faqs.loading")}
          </div>
        ) : faqs.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <MessageCircle className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <h4 className="text-base font-semibold text-gray-900">{t("manageShop.faqs.emptyTitle")}</h4>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{t("manageShop.faqs.emptyDescription")}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {faqs.map((faq) => {
              const isBusy = busyFaqId === faq.id;
              return (
                <article key={faq.id} className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-gray-900 md:text-base">{faq.question}</h4>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            faq.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {faq.active ? t("manageShop.faqs.status.active") : t("manageShop.faqs.status.inactive")}
                        </span>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          {faq.category || "General"}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-gray-700">{faq.answer}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                        <span>{t("manageShop.faqs.source", { source: faq.source })}</span>
                        <span>{t("manageShop.faqs.usedTimes", { count: faq.usageCount || 0 })}</span>
                        <span>{t("manageShop.faqs.confidence", { percent: Math.round((faq.confidence || 1) * 100) })}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                      <button
                        type="button"
                        onClick={() => void handleToggleFaq(faq)}
                        disabled={isBusy}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : faq.active ? (
                          t("manageShop.faqs.deactivate")
                        ) : (
                          t("manageShop.faqs.activate")
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingFaq(faq)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-700"
                        title={t("manageShop.faqs.edit")}
                        aria-label={t("manageShop.faqs.edit")}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFaq(faq)}
                        disabled={isBusy}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                        title={t("manageShop.faqs.delete")}
                        aria-label={t("manageShop.faqs.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editingFaq && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditingFaq(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditingFaq(null);
          }}
        >
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl md:p-6">
            <h3 className="mb-5 text-xl font-bold text-gray-900">
              {isExistingFaq ? t("manageShop.faqs.modal.editTitle") : t("manageShop.faqs.modal.addTitle")}
            </h3>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  {t("manageShop.faqs.modal.questionLabel")}
                </span>
                <input
                  type="text"
                  value={editingFaq.question}
                  onChange={(event) => setEditingFaq({ ...editingFaq, question: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder={t("manageShop.faqs.modal.questionPlaceholder")}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  {t("manageShop.faqs.modal.answerLabel")}
                </span>
                <textarea
                  value={editingFaq.answer}
                  onChange={(event) => setEditingFaq({ ...editingFaq, answer: event.target.value })}
                  rows={5}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder={t("manageShop.faqs.modal.answerPlaceholder")}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  {t("manageShop.faqs.modal.categoryLabel")}
                </span>
                <input
                  type="text"
                  value={editingFaq.category}
                  onChange={(event) => setEditingFaq({ ...editingFaq, category: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder={t("manageShop.faqs.modal.categoryPlaceholder")}
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setEditingFaq(null)}
                className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveFaq()}
                disabled={isSaving || !canSave}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSaving ? t("manageShop.faqs.saving") : t("manageShop.faqs.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-500">{label}</p>
    </div>
  );
}

interface GapSuggestionCardProps {
  suggestion: KnowledgeGapSuggestion;
  busy: boolean;
  onAuthor: () => void | Promise<void>;
  onPublish: (question: string, answer: string) => void | Promise<void>;
  onDismiss: (reason: GapDismissReason) => void | Promise<void>;
  onOpenSettings: (path: string) => void;
}

/**
 * P+05 compact action card: the question customers keep asking, how often it
 * was asked, and the ONE authoritative next step for its domain — either
 * navigate to the settings page that already answers it, or author the FAQ
 * answer inline. Nothing here is AI-generated; the merchant writes everything.
 */
function GapSuggestionCard({ suggestion, busy, onAuthor, onPublish, onDismiss, onOpenSettings }: GapSuggestionCardProps) {
  const { t } = useTranslation();
  const [authoring, setAuthoring] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [question, setQuestion] = useState(suggestion.display_question);
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState<GapDismissReason>("NOT_USEFUL");

  const settingsPath = GAP_SUGGESTION_SETTINGS_PATHS[suggestion.authoritative_action];
  const canPublish = Boolean(question.trim() && answer.trim());

  return (
    <article data-testid={`gap-suggestion-${suggestion.id}`} className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="basis-full min-w-0 text-sm font-semibold text-gray-900 md:basis-auto md:text-base">
          {suggestion.display_question}
        </h4>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
          {t("faqSettings.gaps.askedTimes", { count: suggestion.evidence_count })}
        </span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {t(`faqSettings.gaps.domain.${suggestion.owner_domain}`)}
        </span>
        {suggestion.status === "IN_REVIEW" && (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
            {t("faqSettings.gaps.status.IN_REVIEW")}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {settingsPath ? (
          <button
            type="button"
            data-testid="gap-open-settings"
            onClick={() => onOpenSettings(settingsPath)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t("faqSettings.gaps.openSettings")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!authoring) void onAuthor();
              setAuthoring((open) => !open);
            }}
            aria-expanded={authoring}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {t("faqSettings.gaps.writeAnswer")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissOpen((open) => !open)}
          aria-expanded={dismissOpen}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {t("faqSettings.gaps.dismiss")}
        </button>
      </div>

      {authoring && !settingsPath && (
        <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block font-medium">{t("faqSettings.gaps.questionLabel")}</span>
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block font-medium">{t("faqSettings.gaps.answerLabel")}</span>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={4}
              placeholder={t("faqSettings.gaps.answerPlaceholder")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <button
            type="button"
            data-testid="gap-publish"
            onClick={() => void onPublish(question, answer)}
            disabled={busy || !canPublish}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60 sm:w-auto"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {t("faqSettings.gaps.publish")}
          </button>
        </div>
      )}

      {dismissOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm text-gray-700">
            <span className="mb-1 block font-medium">{t("faqSettings.gaps.dismissTitle")}</span>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as GapDismissReason)}
              className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
            >
              {GAP_DISMISS_REASONS.map((code) => (
                <option key={code} value={code}>
                  {t(`faqSettings.gaps.dismissReasons.${code}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="gap-dismiss-confirm"
            onClick={() => void onDismiss(reason)}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("faqSettings.gaps.dismissConfirm")}
          </button>
        </div>
      )}
    </article>
  );
}
