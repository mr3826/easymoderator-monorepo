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
import { AlertTriangle, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/api";
import type { Conversation, Message, ResponseTemplate } from "@/api/types/conversation";
import type { ShopAgent } from "@/api/types/dashboard";
import { useSubscriptionFeatures } from "../lib/useSubscriptionFeatures";
import { useInboxSSE } from "../lib/useInboxSSE";
import { InboxThreadList } from "./inbox/InboxThreadList";
import { InboxThreadDetail } from "./inbox/InboxThreadDetail";

// ─── SSE Connection Chip ──────────────────────────────────────────────────────

function SSEStatusChip({ connected, reconnecting }: { connected: boolean; reconnecting: boolean }) {
  if (connected && !reconnecting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-none" />
        live
      </span>
    );
  }
  if (reconnecting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        reconnecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-destructive">
      <WifiOff className="w-3 h-3" />
      offline
    </span>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_TEMPLATES: ResponseTemplate[] = [
  { id: "fallback-1", name: "Order Confirmed", content: "আপনার অর্ডার confirm হয়েছে ✅ Delivery: 2-3 দিন" },
  { id: "fallback-2", name: "Need Address", content: "Stock আছে। Address & mobile নম্বর দিন please 🙏" },
  { id: "fallback-3", name: "Advance Payment", content: "Advance ৳[Amount] bKash করুন: 01XXXXXXXXX" },
  { id: "fallback-4", name: "Courier Update", content: "আপনার পার্সেল courier এ দেওয়া হয়েছে ✈️" },
  { id: "fallback-5", name: "Thank You", content: "ধন্যবাদ আপনার order এর জন্য! 😊" },
  { id: "fallback-6", name: "Out of Stock", content: "এই product টা এখন stock এ নেই। 2-3 দিনের মধ্যে available হবে।" },
  { id: "fallback-7", name: "Delivery Charge", content: "Dhaka তে delivery charge ৳60, Dhaka এর বাইরে ৳120।" },
  { id: "fallback-8", name: "Return Window", content: "Return/exchange এর জন্য 3 দিনের মধ্যে জানাবেন please।" },
  { id: "fallback-9", name: "Cash on Delivery", content: "COD available আছে। Delivery তে টাকা দিতে পারবেন।" },
  { id: "fallback-10", name: "Dispatch Today", content: "আপনার product টি ready। আজকেই dispatch করব। 🚚" },
];

const META_CHANNELS = ["facebook", "messenger", "instagram"];

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
  const [agents, setAgents] = useState<ShopAgent[]>([]);
  const [assigningAgent, setAssigningAgent] = useState(false);
  const [sseConnected, setSseConnected] = useState(true);
  const [sseReconnecting, setSseReconnecting] = useState(false);

  const loadMessagesAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { features: planFeatures } = useSubscriptionFeatures();
  const PAGE_SIZE = 30;

  const quickReplyTemplates = templates.length > 0 ? templates : FALLBACK_TEMPLATES;

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      setError(null);
      const result = await apiClient.getConversations({ limit: 50 });
      setConversations(result.conversations);
      if (result.conversations.length > 0 && !selectedConversation) {
        setSelectedConversation(result.conversations[0]);
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

  const loadMessages = async (conversationId: string, page: number) => {
    try {
      if (page === 1) setLoadingMessages(true);
      const result = await apiClient.getMessages(conversationId, { page, limit: PAGE_SIZE });
      if (page === 1) {
        setMessages(result.messages);
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
    apiClient.getResponseTemplates().then((rows) => {
      setTemplates(rows.filter((tpl) => tpl.is_active !== false));
    }).catch(() => setTemplates([]));
    apiClient.getShopAgents().then(setAgents).catch(() => {});
  }, []);

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
    }, [selectedConversation?.id]),

    onHitlChanged: useCallback(({ conversation_id, hitl }) => {
      setConversations((prev) =>
        prev.map((conv) => conv.id === conversation_id ? { ...conv, hitl } : conv)
      );
      setSelectedConversation((prev) =>
        prev?.id === conversation_id ? { ...prev, hitl } : prev
      );
    }, []),

    onDeliveryFailed: useCallback(({ reason }) => {
      toast.warning(`Reply not delivered: ${reason}`, { duration: 6000 });
    }, []),

    onChannelError: useCallback(({ display_name, message: errMsg }) => {
      toast.error(`Channel issue — ${display_name}: ${errMsg}`, { duration: 12000 });
    }, []),

    onSSEOffline: useCallback(() => {
      setSseConnected(false);
      setSseReconnecting(true);
    }, []),

    onSSEOnline: useCallback(() => {
      setSseConnected(true);
      setSseReconnecting(false);
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
      apiClient.createAuditLog({
        action: newHITL ? "HUMAN_TAKEOVER" : "UPDATE",
        resource_type: "CONVERSATION",
        resource_id: selectedConversation.id,
        old_values: { hitl: !newHITL },
        new_values: { hitl: newHITL },
        metadata: { channel: selectedConversation.channel },
      }).catch(() => {});
      toast.success(newHITL ? t("inbox.aiPaused") : t("inbox.aiReEnabled"));
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

  const handleAssignConversation = async (agentId: string) => {
    if (!selectedConversation) return;
    try {
      setAssigningAgent(true);
      await apiClient.updateConversation(selectedConversation.id, { assignee_id: agentId });
      const assignee = agents.find((a) => a.id === agentId);
      const updated = {
        ...selectedConversation,
        assignee_id: agentId,
        assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : undefined,
      };
      setSelectedConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(t("inbox.assignedTo", { name: assignee?.name || agentId }));
    } catch {
      toast.error(t("inbox.errors.assignFailed"));
    } finally {
      setAssigningAgent(false);
    }
  };

  const handleMessageSent = (message: Message) => {
    setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message]);
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === selectedConversation?.id
          ? { ...conv, updated_at: message.created_at || conv.updated_at, lastMessage: message.content }
          : conv
      )
    );
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
        {/* SSE connection chip */}
        <SSEStatusChip connected={sseConnected} reconnecting={sseReconnecting} />
        {error && (
          <span className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm font-bn">{error}</span>
        )}
      </div>

      {/* Offline banner */}
      {!sseConnected && (
        <div className="shrink-0 bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 flex items-center gap-2 font-bn">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Real-time updates disconnected. Reconnecting automatically...</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <InboxThreadList
          conversations={conversations}
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
            messages={messages}
            loadingMessages={loadingMessages}
            hasMoreMessages={hasMoreMessages}
            loadingMoreMessages={loadingMoreMessages}
            togglingHITL={togglingHITL}
            resolvingConversation={resolvingConversation}
            assigningAgent={assigningAgent}
            agents={agents}
            planFeaturesAdvancedAI={planFeatures.advanced_ai}
            showResolveDialog={showResolveDialog}
            resolveNote={resolveNote}
            dismissedSuggestionId={dismissedSuggestionId}
            quickReplyTemplates={quickReplyTemplates}
            loadingTemplates={loadingTemplates}
            messagesEndRef={messagesEndRef}
            is24hExpired={is24hExpired}
            is24hWarning={is24hWarning}
            mobilePanelOpen={mobilePanelOpen}
            onMobileBack={() => setMobilePanelOpen(false)}
            onToggleHITL={handleToggleHITL}
            onResolve={handleResolveConversation}
            onAssign={handleAssignConversation}
            onLoadOlderMessages={loadOlderMessages}
            onDismissSuggestion={setDismissedSuggestionId}
            onUseAiSuggestion={() => {}}
            onSetEditingMessage={() => {}}
            onSetShowResolveDialog={setShowResolveDialog}
            onSetResolveNote={setResolveNote}
            onMessageSent={handleMessageSent}
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
