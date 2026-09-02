/**
 * UnifiedInbox — Page container + data orchestration.
 * UI split into:
 *   - InboxThreadList (left pane)
 *   - InboxThreadDetail (right pane)
 *   - InboxComposer (inside InboxThreadDetail)
 *
 * This file: state management, SSE wiring, data loading only (~250 lines).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/api";
import {
  DEFAULT_AI_REPLY_MODE,
  normalizeAiReplyMode,
  type AiReplyMode,
  type Conversation,
  type Message,
  type ResponseTemplate,
} from "@/api/types/conversation";
import { useSubscriptionFeatures } from "../lib/useSubscriptionFeatures";
import { useInboxSSE } from "../lib/useInboxSSE";
import { InboxThreadList } from "./inbox/InboxThreadList";
import { InboxThreadDetail } from "./inbox/InboxThreadDetail";

// ─── Constants ────────────────────────────────────────────────────────────────

type TFunc = (key: string, opts?: Record<string, unknown>) => string;
type AiReplyStatus = "processing" | "sent" | "failed";

const AI_REPLY_MODE_LABEL_KEYS: Record<AiReplyMode, string> = {
  AUTO: "inbox.mode.auto",
  DRAFT: "inbox.mode.draft",
  MANUAL: "inbox.mode.manual",
};

const getAiReplyStatus = (messages: Message[], mode: AiReplyMode): AiReplyStatus | null => {
  if (mode !== "AUTO") return null;

  const lastCustomerMessage = [...messages].reverse().find((message) => message.sender === "customer");
  const lastAgentMessage = [...messages].reverse().find((message) => message.sender === "agent");
  const lastAiMessage = [...messages].reverse().find((message) => message.sender === "ai");

  if (!lastAiMessage) {
    if (lastAgentMessage && lastCustomerMessage) {
      const agentAfterCustomer =
        new Date(lastAgentMessage.created_at) > new Date(lastCustomerMessage.created_at);
      if (agentAfterCustomer) return null;
    }
    return "processing";
  }

  const customerAfterAi =
    lastCustomerMessage &&
    new Date(lastCustomerMessage.created_at) > new Date(lastAiMessage.created_at);
  const agentAfterCustomer =
    lastAgentMessage &&
    lastCustomerMessage &&
    new Date(lastAgentMessage.created_at) > new Date(lastCustomerMessage.created_at);

  if (customerAfterAi) return agentAfterCustomer ? null : "processing";

  const deliveryStatus = lastAiMessage.metadata?.delivery_status;
  if (deliveryStatus === "pending") return "processing";
  if (deliveryStatus === "failed") return "failed";
  if (deliveryStatus === "sent" || lastAiMessage.metadata?.delivered === true) return "sent";
  return null;
};

// Quick-reply fallback templates. Labels (`name`) are translatable; `content`
// is intentionally informal Banglish reply text shown to the agent as-is.
const buildFallbackTemplates = (t: TFunc): ResponseTemplate[] => [
  { id: "fallback-1", name: t("inbox.templates.orderConfirmed"), content: "আপনার অর্ডার confirm হয়েছে ✅ Delivery: 2-3 দিন" },
  { id: "fallback-2", name: t("inbox.templates.needAddress"), content: "Stock আছে। Address & mobile নম্বর দিন please 🙏" },
  { id: "fallback-3", name: t("inbox.templates.advancePayment"), content: "Advance ৳[Amount] bKash করুন: 01XXXXXXXXX" },
  { id: "fallback-4", name: t("inbox.templates.courierUpdate"), content: "আপনার পার্সেল courier এ দেওয়া হয়েছে ✈️" },
  { id: "fallback-5", name: t("inbox.templates.thankYou"), content: "ধন্যবাদ আপনার order এর জন্য! 😊" },
  { id: "fallback-6", name: t("inbox.templates.outOfStock"), content: "এই product টা এখন stock এ নেই। 2-3 দিনের মধ্যে available হবে।" },
  { id: "fallback-7", name: t("inbox.templates.deliveryCharge"), content: "Dhaka তে delivery charge ৳60, Dhaka এর বাইরে ৳120।" },
  { id: "fallback-8", name: t("inbox.templates.returnWindow"), content: "Return/exchange এর জন্য 3 দিনের মধ্যে জানাবেন please।" },
  { id: "fallback-9", name: t("inbox.templates.cashOnDelivery"), content: "COD available আছে। Delivery তে টাকা দিতে পারবেন।" },
  { id: "fallback-10", name: t("inbox.templates.dispatchToday"), content: "আপনার product টি ready। আজকেই dispatch করব। 🚚" },
];

const META_CHANNELS = ["facebook", "messenger"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function UnifiedInbox() {
  const { t } = useTranslation();
  const location = useLocation();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "needs_review" | "closed">("all");
  const [togglingHITL, setTogglingHITL] = useState(false);
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null);
  const [messagesPage, setMessagesPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [resolvingConversation, setResolvingConversation] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [sseConnected, setSseConnected] = useState(true);
  const [aiReplyMode, setAiReplyMode] = useState<AiReplyMode>(DEFAULT_AI_REPLY_MODE);
  const [aiReplyStatuses, setAiReplyStatuses] = useState<Record<string, AiReplyStatus>>({});

  const loadMessagesAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { features: planFeatures } = useSubscriptionFeatures();
  const PAGE_SIZE = 30;

  const quickReplyTemplates = templates.length > 0 ? templates : buildFallbackTemplates(t);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      setError(null);
      const result = await apiClient.getConversations({ limit: 50 });
      setAiReplyMode(normalizeAiReplyMode(result.ai_reply_mode));
      setConversations(result.data);
      if (result.data.length > 0 && !selectedConversation) {
        setSelectedConversation(result.data[0]);
      }
    } catch {
      setError(t("inbox.errors.loadConversations"));
      toast.error(t("inbox.errors.loadConversations"));
    } finally {
      setLoadingConversations(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadConversationsRef = useRef(loadConversations);
  useEffect(() => { loadConversationsRef.current = loadConversations; });

  const loadTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      const rows = await apiClient.getResponseTemplates();
      setTemplates(rows.filter((tpl) => tpl.is_active !== false));
    } catch {
      setTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const loadMessages = async (conversationId: string, page: number) => {
    try {
      if (page === 1) setLoadingMessages(true);
      const result = await apiClient.getMessages(conversationId, { page, limit: PAGE_SIZE });
      if (page === 1) {
        setMessages(result.messages);
        const status = getAiReplyStatus(result.messages, aiReplyMode);
        setAiReplyStatuses((prev) => {
          const next = { ...prev };
          if (status) next[conversationId] = status;
          else delete next[conversationId];
          return next;
        });
      } else {
        setMessages((prev) => [...result.messages, ...prev]);
      }
      setHasMoreMessages(result.pagination.page < result.pagination.totalPages);
    } catch {
      toast.error(t("inbox.errors.loadMessages"));
    } finally {
      setLoadingMessages(false);
      setLoadingMoreMessages(false);
    }
  };

  const loadOlderMessages = async () => {
    const conversationId = selectedConversation?.id;
    if (!conversationId || loadingMoreMessages || !hasMoreMessages) return;
    const nextPage = messagesPage + 1;
    setLoadingMoreMessages(true);
    await loadMessages(conversationId, nextPage);
    if (selectedConversation?.id === conversationId) {
      setMessagesPage(nextPage);
    }
  };

  // ─── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    loadConversations();
    loadTemplates();
  }, [loadConversations, loadTemplates]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "needs_review") setFilterTab("needs_review");
  }, [location.search]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessagesAbortRef.current?.abort();
      loadMessagesAbortRef.current = new AbortController();
      setMessagesPage(1);
      setHasMoreMessages(false);
      loadMessages(selectedConversation.id, 1);
      setDismissedSuggestionId(null);
    }
    return () => { loadMessagesAbortRef.current?.abort(); };
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (!loadingMoreMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMoreMessages]);

  // ─── SSE ───────────────────────────────────────────────────────────────────

  useInboxSSE({
    onNewMessage: useCallback(({ conversation_id, message }) => {
      setMessages((prev) => {
        if (selectedConversation?.id !== conversation_id) return prev;
        const alreadyExists = prev.some((m) => m.id === message.id);
        return alreadyExists ? prev : [...prev, message];
      });
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        if (message.sender === "customer" && aiReplyMode === "AUTO") {
          next[conversation_id] = "processing";
        } else if (message.sender === "agent") {
          delete next[conversation_id];
        } else if (message.sender === "ai") {
          const status = getAiReplyStatus([message], aiReplyMode);
          if (status) next[conversation_id] = status;
          else delete next[conversation_id];
        }
        return next;
      });
      setConversations((prev) => {
        const exists = prev.some((conv) => conv.id === conversation_id);
        if (!exists) {
          (async () => {
            try { await loadConversationsRef.current(); } catch { /* ignore */ }
          })();
          return prev;
        }
        return prev.map((conv) =>
          conv.id === conversation_id
            ? {
                ...conv,
                updated_at: message.created_at,
                lastMessage: message.content,
                unreadCount: selectedConversation?.id === conversation_id
                  ? conv.unreadCount ?? 0
                  : (conv.unreadCount ?? 0) + 1,
              }
            : conv
        );
      });
    }, [aiReplyMode, selectedConversation?.id]),

    onHitlChanged: useCallback(({ conversation_id, hitl }) => {
      setConversations((prev) =>
        prev.map((conv) => conv.id === conversation_id ? { ...conv, hitl } : conv)
      );
      setSelectedConversation((prev) =>
        prev?.id === conversation_id ? { ...prev, hitl } : prev
      );
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        if (hitl || aiReplyMode !== "AUTO") delete next[conversation_id];
        else next[conversation_id] = "processing";
        return next;
      });
    }, [aiReplyMode]),

    onMessageDeliveryUpdated: useCallback(({ conversation_id, message_id, metadata }: {
      conversation_id: string;
      message_id: string;
      metadata: Message["metadata"];
    }) => {
      const currentMessage = messages.find((message) => message.id === message_id);
      setMessages((prev) => {
        if (selectedConversation?.id !== conversation_id) return prev;
        return prev.map((message) =>
          message.id === message_id
            ? { ...message, metadata: { ...(message.metadata || {}), ...(metadata || {}) } }
            : message
        );
      });
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        if (currentMessage?.sender === "agent") {
          delete next[conversation_id];
          return next;
        }
        if (currentMessage?.sender !== "ai" || aiReplyMode !== "AUTO") return next;
        const status = getAiReplyStatus(
          [{ ...currentMessage, metadata: { ...(currentMessage.metadata || {}), ...(metadata || {}) } }],
          aiReplyMode
        );
        if (status) next[conversation_id] = status;
        else delete next[conversation_id];
        return next;
      });
    }, [aiReplyMode, messages, selectedConversation?.id]),

    onDeliveryFailed: useCallback(({ conversation_id, reason }: { conversation_id?: string; reason: string }) => {
      const failedConversationId = conversation_id || selectedConversation?.id;
      if (aiReplyMode === "AUTO") {
        setAiReplyStatuses((prev) =>
          failedConversationId ? { ...prev, [failedConversationId]: "failed" } : prev
        );
      }
      toast.warning(t("inbox.deliveryFailed", { reason }), { duration: 6000 });
    }, [aiReplyMode, selectedConversation?.id]),

    onAiReplyModeChanged: useCallback(({ mode }: { mode: AiReplyMode }) => {
      setAiReplyMode(normalizeAiReplyMode(mode));
      setAiReplyStatuses({});
      setDismissedSuggestionId(null);
    }, []),

    onChannelError: useCallback(({ display_name, message: errMsg }: { display_name: string; message: string }) => {
      toast.error(t("inbox.channelIssue", { name: display_name, message: errMsg }), { duration: 12000 });
    }, []), // eslint-disable-line react-hooks/exhaustive-deps

    onSSEOffline: useCallback(() => {
      setSseConnected(false);
    }, []),

    onSSEOnline: useCallback(() => {
      setSseConnected(true);
    }, []),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleToggleHITL = async () => {
    if (!selectedConversation) return;
    try {
      setTogglingHITL(true);
      const newHITL = !selectedConversation.hitl;
      await apiClient.updateConversation(selectedConversation.id, { hitl: newHITL });
      const updated = { ...selectedConversation, hitl: newHITL };
      setSelectedConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        if (newHITL || aiReplyMode !== "AUTO") delete next[selectedConversation.id];
        else next[selectedConversation.id] = "processing";
        return next;
      });
      apiClient.createAuditLog({
        action: newHITL ? "HUMAN_TAKEOVER" : "UPDATE",
        resource_type: "CONVERSATION",
        resource_id: selectedConversation.id,
        old_values: { hitl: !newHITL },
        new_values: { hitl: newHITL },
        metadata: { channel: selectedConversation.channel },
      }).catch(() => {});
      toast.success(
        newHITL
          ? t("inbox.aiPaused")
          : aiReplyMode === "AUTO"
          ? t("inbox.aiReEnabled")
          : t("inbox.mode.manual")
      );
    } catch {
      toast.error(t("inbox.errors.updateMode"));
    } finally {
      setTogglingHITL(false);
    }
  };

  const handleResolveConversation = async () => {
    if (!selectedConversation) return;
    try {
      setResolvingConversation(true);
      await apiClient.updateConversation(selectedConversation.id, {
        status: "closed",
        resolution_note: resolveNote || undefined,
      });
      const updated = { ...selectedConversation, status: "closed" as const };
      setSelectedConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      apiClient.createAuditLog({
        action: "CONVERSATION_RESOLVED",
        resource_type: "CONVERSATION",
        resource_id: selectedConversation.id,
        old_values: { status: selectedConversation.status },
        new_values: { status: "closed", resolution_note: resolveNote },
        metadata: { channel: selectedConversation.channel },
      }).catch(() => {});
      toast.success(t("inbox.conversationResolved"));
      setShowResolveDialog(false);
      setResolveNote("");
    } catch {
      toast.error(t("inbox.errors.resolveFailed"));
    } finally {
      setResolvingConversation(false);
    }
  };

  const handleMessageSent = (message: Message) => {
    setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message]);
    setAiReplyStatuses((prev) => {
      const next = { ...prev };
      const conversationId = message.conversation_id || selectedConversation?.id;
      if (conversationId) delete next[conversationId];
      return next;
    });
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === selectedConversation?.id
          ? { ...conv, updated_at: message.created_at || conv.updated_at, lastMessage: message.content }
          : conv
      )
    );
  };

  const handleMessageSendFailed = () => {
    if (!selectedConversation) return;
    setAiReplyStatuses((prev) => {
      const next = { ...prev };
      delete next[selectedConversation.id];
      return next;
    });
  };

  const handleDismissSuggestion = (messageId: string) => {
    setDismissedSuggestionId(messageId);
    if (!selectedConversation) return;
    setAiReplyStatuses((prev) => {
      const next = { ...prev };
      delete next[selectedConversation.id];
      return next;
    });
  };

  // ─── Derived values ────────────────────────────────────────────────────────

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch =
      !searchQuery ||
      conv.customer?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.title?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterTab === "needs_review") return conv.hitl === true;
    if (filterTab === "closed") return conv.status === "closed";
    return conv.status !== "closed";
  });

  const needsReviewCount = conversations.filter((c) => c.hitl).length;
  const closedCount = conversations.filter((c) => c.status === "closed").length;

  const hoursElapsed = selectedConversation
    ? (Date.now() - new Date(selectedConversation.updated_at).getTime()) / 3600000
    : 0;
  const is24hChannel = selectedConversation
    ? META_CHANNELS.includes(selectedConversation.channel)
    : false;
  const is24hExpired = is24hChannel && hoursElapsed >= 24;
  const is24hWarning = is24hChannel && hoursElapsed >= 23 && !is24hExpired;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 bg-white border-b border-gray-200 flex items-center px-4 md:px-8 py-3 gap-2 flex-wrap">
        <h1 className="text-lg md:text-xl font-semibold text-gray-900 whitespace-nowrap font-bn">
          {t("inbox.title")}
        </h1>
        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm whitespace-nowrap">
          {t("inbox.active", { count: conversations.filter((c) => c.status === "active").length })}
        </span>
        <span
          data-testid="inbox-ai-reply-mode"
          className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm whitespace-nowrap"
        >
          {t("inbox.modeLabel")}: {t(AI_REPLY_MODE_LABEL_KEYS[aiReplyMode])}
        </span>
        {error && (
          <span className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm font-bn">{error}</span>
        )}
      </div>

      {/* Offline banner */}
      {!sseConnected && (
        <div className="shrink-0 bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 flex items-center gap-2 font-bn">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{t("inbox.offlineBanner")}</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <InboxThreadList
          conversations={conversations}
          aiReplyMode={aiReplyMode}
          selectedConversationId={selectedConversation?.id ?? null}
          filteredConversations={filteredConversations}
          loading={loadingConversations}
          searchQuery={searchQuery}
          filterTab={filterTab}
          needsReviewCount={needsReviewCount}
          closedCount={closedCount}
          mobilePanelOpen={mobilePanelOpen}
          onSearchChange={setSearchQuery}
          onFilterChange={setFilterTab}
          onSelectConversation={(conv) => {
            setSelectedConversation(conv);
            setMobilePanelOpen(true);
          }}
        />

        {selectedConversation ? (
          <InboxThreadDetail
            selectedConversation={selectedConversation}
            aiReplyMode={aiReplyMode}
            aiReplyStatus={aiReplyStatuses[selectedConversation.id] ?? null}
            messages={messages}
            loadingMessages={loadingMessages}
            hasMoreMessages={hasMoreMessages}
            loadingMoreMessages={loadingMoreMessages}
            togglingHITL={togglingHITL}
            resolvingConversation={resolvingConversation}
            planFeaturesAdvancedAI={planFeatures.advanced_ai}
            showResolveDialog={showResolveDialog}
            resolveNote={resolveNote}
            dismissedSuggestionId={dismissedSuggestionId}
            templates={templates}
            quickReplyTemplates={quickReplyTemplates}
            loadingTemplates={loadingTemplates}
            messagesEndRef={messagesEndRef}
            is24hExpired={is24hExpired}
            is24hWarning={is24hWarning}
            mobilePanelOpen={mobilePanelOpen}
            onMobileBack={() => setMobilePanelOpen(false)}
            onToggleHITL={handleToggleHITL}
            onResolve={handleResolveConversation}
            onLoadOlderMessages={loadOlderMessages}
            onDismissSuggestion={handleDismissSuggestion}
            onUseAiSuggestion={() => {}}
            onSetEditingMessage={() => {}}
            onSetShowResolveDialog={setShowResolveDialog}
            onSetResolveNote={setResolveNote}
            onMessageSent={handleMessageSent}
            onSendFailed={handleMessageSendFailed}
            onTemplatesChanged={loadTemplates}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 md:flex hidden">
            <p className="font-bn">{t("inbox.selectConversation")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
