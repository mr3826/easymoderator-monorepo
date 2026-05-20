/**
 * InboxThreadDetail — Right pane: message thread, AI suggestion, composer.
 * Extracted from UnifiedInbox.tsx (D2 split).
 */
import { memo } from "react";
import {
  Bot, User, CheckCircle2, Edit3, Loader2, UserCheck, Tag, AlertTriangle,
  Clock, ArrowLeft, Lock, FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiClient } from "@/api";
import type { Conversation, Message, ResponseTemplate } from "@/api/types/conversation";
import type { ShopAgent } from "@/api/types/dashboard";
import { InboxComposer } from "./InboxComposer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidMediaUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ─── MessageItem ──────────────────────────────────────────────────────────────

const MessageItem = memo(function MessageItem({
  message,
  customerName,
  t,
}: {
  message: Message;
  customerName: string;
  t: (key: string) => string;
}) {
  const ts = new Date(message.created_at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${message.sender === "customer" ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-lg rounded-2xl p-4 shadow-sm ${
          message.sender === "customer"
            ? "bg-white border border-gray-100"
            : message.sender === "ai"
            ? "bg-purple-100 border border-purple-200"
            : "bg-blue-600 text-white"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {message.sender === "customer" ? (
            <User className="w-4 h-4 text-gray-600" />
          ) : message.sender === "ai" ? (
            <Bot className="w-4 h-4 text-purple-600" />
          ) : null}
          <span className="text-sm font-semibold">
            {message.sender === "customer"
              ? customerName
              : message.sender === "ai"
              ? "AI Assistant"
              : "You"}
          </span>
        </div>
        {message.message_type === "image" ? (
          <div>
            {isValidMediaUrl(message.metadata?.image_url) ? (
              <img
                src={message.metadata.image_url}
                alt="Attachment"
                className="max-w-xs rounded-xl border border-black/5"
              />
            ) : (
              <span className="text-sm italic text-gray-500">[Image]</span>
            )}
          </div>
        ) : message.message_type === "file" ? (
          <div className="space-y-2">
            <div
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${
                message.sender === "agent" ? "bg-blue-500/60" : "bg-gray-100"
              }`}
            >
              <FileText
                className={`w-4 h-4 ${message.sender === "agent" ? "text-white" : "text-gray-600"}`}
              />
              <span
                className={`text-sm ${message.sender === "agent" ? "text-white" : "text-gray-700"}`}
              >
                {message.metadata?.file_name || message.content || "Attachment"}
              </span>
            </div>
            {isValidMediaUrl(message.metadata?.file_url) && (
              <a
                href={message.metadata.file_url}
                download={message.metadata?.file_name || "attachment"}
                className={`inline-block text-xs underline ${
                  message.sender === "agent" ? "text-blue-100" : "text-blue-700"
                }`}
              >
                Download file
              </a>
            )}
          </div>
        ) : (
          <p className={message.sender === "agent" ? "text-white" : "text-gray-800"}>
            {message.content}
          </p>
        )}
        <p
          className={`mt-2 text-[11px] ${
            message.sender === "agent" ? "text-blue-100" : "text-gray-400"
          }`}
        >
          {ts}
        </p>
      </div>
    </div>
  );
});

// ─── InboxThreadDetail ────────────────────────────────────────────────────────

interface InboxThreadDetailProps {
  selectedConversation: Conversation;
  messages: Message[];
  loadingMessages: boolean;
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;
  togglingHITL: boolean;
  resolvingConversation: boolean;
  assigningAgent: boolean;
  agents: ShopAgent[];
  planFeaturesAdvancedAI: boolean;
  showResolveDialog: boolean;
  resolveNote: string;
  dismissedSuggestionId: string | null;
  quickReplyTemplates: ResponseTemplate[];
  loadingTemplates: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  is24hExpired: boolean;
  is24hWarning: boolean;
  mobilePanelOpen: boolean;
  onMobileBack: () => void;
  onToggleHITL: () => void;
  onResolve: () => void;
  onAssign: (agentId: string) => void;
  onLoadOlderMessages: () => void;
  onDismissSuggestion: (msgId: string) => void;
  onUseAiSuggestion: (edit: boolean) => void;
  onSetEditingMessage: (text: string) => void;
  onSetShowResolveDialog: (show: boolean) => void;
  onSetResolveNote: (note: string) => void;
  onMessageSent: (message: Message) => void;
}

export function InboxThreadDetail({
  selectedConversation,
  messages,
  loadingMessages,
  hasMoreMessages,
  loadingMoreMessages,
  togglingHITL,
  resolvingConversation,
  assigningAgent,
  agents,
  planFeaturesAdvancedAI,
  showResolveDialog,
  resolveNote,
  dismissedSuggestionId,
  quickReplyTemplates,
  loadingTemplates,
  messagesEndRef,
  is24hExpired,
  is24hWarning,
  mobilePanelOpen,
  onMobileBack,
  onToggleHITL,
  onResolve,
  onAssign,
  onLoadOlderMessages,
  onDismissSuggestion,
  onSetShowResolveDialog,
  onSetResolveNote,
  onMessageSent,
}: InboxThreadDetailProps) {
  const { t } = useTranslation();

  // AI suggestion logic
  const lastAiMsg = [...messages].reverse().find((m) => m.sender === "ai") ?? null;
  const aiSuggestion = lastAiMsg?.ai_suggestion || lastAiMsg?.content || "";
  const aiConfidence = lastAiMsg?.ai_confidence ?? 0;
  const lastCustomerMsg = [...messages].reverse().find((m) => m.sender === "customer") ?? null;
  const lastAgentMsg = [...messages].reverse().find((m) => m.sender === "agent") ?? null;
  const customerSentAfterAgent =
    lastCustomerMsg &&
    (!lastAgentMsg ||
      new Date(lastCustomerMsg.created_at) > new Date(lastAgentMsg.created_at));
  const hasAiSuggestion =
    !!aiSuggestion &&
    lastAiMsg?.id !== dismissedSuggestionId &&
    !!customerSentAfterAgent &&
    !selectedConversation?.hitl;
  const isLowConfidence = hasAiSuggestion && aiConfidence < 0.65;

  const confidenceTier = (() => {
    const pct = Math.round((aiConfidence ?? 0) * 100);
    if (pct >= 85) return { label: "High Confidence", color: "bg-green-100 text-green-800 border border-green-200" };
    if (pct >= 60) return { label: "Review Carefully", color: "bg-amber-100 text-amber-800 border border-amber-200" };
    return { label: "Low — AI Unsure", color: "bg-red-100 text-red-800 border border-red-200" };
  })();

  const handleUseAiSuggestion = async (edit: boolean) => {
    if (!aiSuggestion) return;
    if (edit) {
      // Surface to parent — the composer is self-contained; use toast to communicate
      toast.info("Copy the suggestion and paste into the message box.");
    } else {
      // Guard: 24h window expired with no tag selected means we cannot send outbound
      if (is24hExpired) {
        toast.error(t("inbox.errors.selectTag"));
        return;
      }
      // Send directly
      try {
        const message = await apiClient.createMessage(selectedConversation.id, {
          content: aiSuggestion,
          sender: "agent",
          message_type: "text",
        });
        onMessageSent(message);
        toast.success(t("inbox.aiSuggestion"));
      } catch (err: unknown) {
        toast.error((err as { message?: string })?.message || "Failed to send AI suggestion");
      }
    }
  };

  return (
    <div
      className={`flex-1 flex flex-col bg-gray-50 ${mobilePanelOpen ? "flex" : "hidden"} md:flex`}
    >
      {/* Conversation Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 shrink-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              className="md:hidden p-1 -ml-1 text-gray-500 hover:text-gray-700"
              onClick={onMobileBack}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {selectedConversation.customer?.name || "Unknown"}
              </h2>
              <div className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
                <span>via {selectedConversation.channel}</span>
                <span>•</span>
                <span>Last active {formatDate(selectedConversation.updated_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                selectedConversation.status === "active"
                  ? "bg-blue-100 text-blue-700"
                  : selectedConversation.status === "closed"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {selectedConversation.status}
            </span>
            {agents.length > 0 && (
              <select
                value={selectedConversation.assignee_id || ""}
                onChange={(e) => e.target.value && onAssign(e.target.value)}
                disabled={assigningAgent}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-32"
                title={t("inbox.assign")}
              >
                <option value="">{t("inbox.assign")}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            )}
            {selectedConversation.status !== "closed" && (
              <button
                onClick={() => onSetShowResolveDialog(true)}
                disabled={resolvingConversation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                title={t("inbox.resolve")}
              >
                {resolvingConversation ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {t("inbox.resolve")}
              </button>
            )}
            {planFeaturesAdvancedAI ? (
              <button
                onClick={onToggleHITL}
                disabled={togglingHITL}
                title={selectedConversation.hitl ? t("inbox.humanTooltip") : t("inbox.aiTooltip")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedConversation.hitl
                    ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    : "bg-purple-100 text-purple-700 hover:bg-purple-200"
                }`}
              >
                {togglingHITL ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : selectedConversation.hitl ? (
                  <UserCheck className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
                {selectedConversation.hitl ? t("inbox.agentHandling") : t("inbox.aiActive")}
              </button>
            ) : (
              <a
                href="/subscription"
                title="Upgrade to unlock AI features"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <Lock className="w-4 h-4" />
                {t("inbox.upgradeForAI")}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Banners */}
      {selectedConversation.hitl && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center gap-2 text-sm text-amber-800 font-bn">
          <UserCheck className="w-4 h-4 flex-shrink-0" />
          <span>{t("inbox.agentBanner")}</span>
        </div>
      )}
      {is24hWarning && (
        <div className="bg-orange-50 border-b border-orange-200 px-6 py-2 flex items-center gap-2 text-sm text-orange-800 font-bn">
          <Clock className="w-4 h-4 flex-shrink-0" />
          <span>{t("inbox.windowClosingSoon")}</span>
        </div>
      )}
      {is24hExpired && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 flex items-center gap-2 text-sm text-destructive font-bn">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{t("inbox.windowExpired")}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 pb-24 md:pb-6">
        {loadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p className="font-bn">{t("inbox.noMessages")}</p>
          </div>
        ) : (
          <>
            {hasMoreMessages && (
              <div className="flex justify-center">
                <button
                  onClick={onLoadOlderMessages}
                  disabled={loadingMoreMessages}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-full hover:bg-gray-50 disabled:opacity-60"
                >
                  {loadingMoreMessages ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    "↑"
                  )}
                  {t("inbox.loadOlder")}
                </button>
              </div>
            )}
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                customerName={selectedConversation.customer?.name || "Unknown"}
                t={t}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* AI Suggestion Panel */}
      {planFeaturesAdvancedAI && hasAiSuggestion && (
        <div
          className={`mx-4 rounded-t-lg border px-4 py-3 ${
            (() => {
              const pct = Math.round((aiConfidence ?? 0) * 100);
              if (pct >= 85) return "bg-green-50 border-green-200";
              if (pct >= 60) return "bg-amber-50 border-amber-300";
              return "bg-red-50 border-red-300";
            })()
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold text-purple-900">{t("inbox.aiSuggestion")}</span>
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${confidenceTier.color}`}>
              {confidenceTier.label}
            </span>
          </div>
          <p className="text-sm text-gray-800 mb-2 italic">"{aiSuggestion}"</p>
          {isLowConfidence && (
            <p className="text-xs text-amber-700 mb-2 flex items-center gap-1 font-bn">
              <AlertTriangle className="w-3 h-3" /> {t("inbox.lowConfidence")}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => handleUseAiSuggestion(false)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 sm:py-1.5 px-2 sm:px-3 bg-purple-600 text-white text-xs sm:text-sm font-medium rounded-lg hover:bg-purple-700 min-h-10"
            >
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              {t("inbox.useThis")}
            </button>
            <button
              onClick={() => handleUseAiSuggestion(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 sm:py-1.5 px-2 sm:px-3 bg-white border border-purple-300 text-purple-700 text-xs sm:text-sm font-medium rounded-lg hover:bg-purple-50 min-h-10"
            >
              <Edit3 className="w-3 h-3 flex-shrink-0" />
              {t("inbox.editAndUse")}
            </button>
            <button
              onClick={() => lastAiMsg && onDismissSuggestion(lastAiMsg.id)}
              className="flex-1 py-2 sm:py-1.5 px-2 sm:px-3 bg-white border border-gray-300 text-gray-600 text-xs sm:text-sm font-medium rounded-lg hover:bg-gray-50 min-h-10"
            >
              {t("inbox.ignore")}
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <InboxComposer
        selectedConversation={selectedConversation}
        is24hExpired={is24hExpired}
        is24hWarning={is24hWarning}
        quickReplyTemplates={quickReplyTemplates}
        loadingTemplates={loadingTemplates}
        planFeaturesAdvancedAI={planFeaturesAdvancedAI}
        onMessageSent={onMessageSent}
      />

      {/* Resolve Dialog */}
      {showResolveDialog && (
        <div
          className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === "Escape") { onSetShowResolveDialog(false); onSetResolveNote(""); } }}
          onClick={(e) => { if (e.target === e.currentTarget) { onSetShowResolveDialog(false); onSetResolveNote(""); } }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
              <h2 className="text-lg font-semibold text-gray-900 font-bn">
                {t("inbox.resolveDialogTitle")}
              </h2>
            </div>
            <p className="text-sm text-gray-600 font-bn">{t("inbox.resolveDialogDescription")}</p>
            <textarea
              value={resolveNote}
              onChange={(e) => onSetResolveNote(e.target.value)}
              placeholder={t("inbox.resolveNotePlaceholder")}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { onSetShowResolveDialog(false); onSetResolveNote(""); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-bn"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={onResolve}
                disabled={resolvingConversation}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60 font-bn"
              >
                {resolvingConversation && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("inbox.resolveConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
