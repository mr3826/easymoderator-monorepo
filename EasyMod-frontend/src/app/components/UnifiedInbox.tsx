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

const getDeliveryState = (message: Message): string | null => {
  const explicit = message.delivery_state || message.metadata?.delivery_state;
  const providerMessageId = message.provider_message_id || message.metadata?.provider_message_id;
  if (explicit) {
    if ((explicit === "SENT" || explicit === "DELIVERED") && !providerMessageId) return "HELD";
    return explicit;
  }
  if (message.metadata?.delivered === true
    && providerMessageId) {
    return "SENT";
  }
  return null;
};

const isProviderConfirmed = (message: Message): boolean => {
  const state = getDeliveryState(message);
  return (state === "SENT" || state === "DELIVERED")
    && Boolean(
      message.provider_message_id
      || message.metadata?.provider_message_id,
    );
};

const deliveryStateRank: Record<string, number> = {
  DRAFT_READY: 10,
  HELD: 10,
  SEND_PENDING: 20,
  FAILED: 30,
  DISMISSED: 30,
  SENT: 40,
  DELIVERED: 50,
};

const timestampMs = (value?: string | null): number => {
  if (!value) return NaN;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
};

const mergeReadProjection = (
  conversation: Conversation,
  incoming: Pick<Conversation, "unreadCount" | "lastReadMessageId" | "lastReadMessageAt">,
): Conversation => {
  const currentReadAt = timestampMs(conversation.lastReadMessageAt);
  const incomingReadAt = timestampMs(incoming.lastReadMessageAt);
  if (Number.isFinite(currentReadAt)
    && (!Number.isFinite(incomingReadAt) || incomingReadAt < currentReadAt)) {
    return conversation;
  }
  return {
    ...conversation,
    unreadCount: incoming.unreadCount ?? conversation.unreadCount ?? 0,
    lastReadMessageId: incoming.lastReadMessageId ?? conversation.lastReadMessageId ?? null,
    lastReadMessageAt: incoming.lastReadMessageAt || conversation.lastReadMessageAt || null,
  };
};

const mergeConversationLists = (
  serverConversations: Conversation[],
  liveConversations: Conversation[],
  revisions: Record<string, number>,
  requestRevisions: Map<string, number>,
): Conversation[] => {
  const liveById = new Map(liveConversations.map((conversation) => [conversation.id, conversation]));
  const serverIds = new Set(serverConversations.map((conversation) => conversation.id));
  const merged = serverConversations.map((conversation) => {
    const live = liveById.get(conversation.id);
    const wasUpdatedDuringRequest = live
      && (revisions[conversation.id] || 0) > (requestRevisions.get(conversation.id) || 0);
    return wasUpdatedDuringRequest ? { ...conversation, ...live } : conversation;
  });
  const liveOnly = liveConversations.filter((conversation) => (
    !serverIds.has(conversation.id)
      && (revisions[conversation.id] || 0) > (requestRevisions.get(conversation.id) || 0)
  ));
  return [...merged, ...liveOnly];
};

const mergeMessageLifecycle = (current: Message, incoming: Message): Message => {
  const currentState = getDeliveryState(current);
  const incomingState = getDeliveryState(incoming);
  const currentRank = deliveryStateRank[currentState || ""] || 0;
  const incomingRank = deliveryStateRank[incomingState || ""] || 0;
  const keepCurrentLifecycle = isProviderConfirmed(current)
    && (!isProviderConfirmed(incoming) || incomingRank < currentRank)
    || currentState === "DISMISSED" && incomingState !== "SENT" && incomingState !== "DELIVERED"
    || incomingRank < currentRank;

  if (keepCurrentLifecycle) {
    return {
      ...current,
      ...incoming,
      delivery_state: current.delivery_state,
      provider_message_id: current.provider_message_id,
      delivery_source: current.delivery_source,
      metadata: { ...(incoming.metadata || {}), ...(current.metadata || {}) },
    };
  }
  return {
    ...current,
    ...incoming,
    metadata: { ...(current.metadata || {}), ...(incoming.metadata || {}) },
  };
};

const AI_REPLY_MODE_LABEL_KEYS: Record<AiReplyMode, string> = {
  AUTO: "inbox.mode.auto",
  DRAFT: "inbox.mode.draft",
  MANUAL: "inbox.mode.manual",
};

const getAiReplyStatus = (
  messages: Message[],
  mode: AiReplyMode,
  conversation?: Conversation | null,
): AiReplyStatus | null => {
  if (mode !== "AUTO") return null;
  if (conversation?.status === "closed" || conversation?.hitl === true) return null;

  const lastCustomerMessage = [...messages].reverse().find((message) => message.sender === "customer");
  if (!lastCustomerMessage) return null;
  const hasAuthoritativeProcessingState = typeof conversation?.ai_is_replying === "boolean";
  const lastAgentMessage = [...messages].reverse().find((message) => message.sender === "agent");
  const lastAiMessage = [...messages].reverse().find((message) => message.sender === "ai");

  if (!lastAiMessage) {
    if (hasAuthoritativeProcessingState) return conversation.ai_is_replying ? "processing" : null;
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

  if (customerAfterAi) {
    if (agentAfterCustomer) return null;
    return hasAuthoritativeProcessingState
      ? conversation.ai_is_replying ? "processing" : null
      : "processing";
  }

  const deliveryState = getDeliveryState(lastAiMessage);
  const deliveryStatus = lastAiMessage.metadata?.delivery_status;
  if (deliveryState === "FAILED" || deliveryStatus === "failed") return "failed";
  if (isProviderConfirmed(lastAiMessage)) return "sent";
  if (hasAuthoritativeProcessingState && conversation.ai_is_replying === false) return null;
  if (deliveryState === "GENERATING" || deliveryState === "SEND_PENDING" || deliveryStatus === "pending") return "processing";
  if (hasAuthoritativeProcessingState && conversation.ai_is_replying) return "processing";
  return null;
};

const needsMerchantReply = (conversation: Conversation): boolean => (
  conversation.needs_merchant_reply
    ?? (conversation.hitl === true || conversation.hasAiSuggestion === true)
);

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
  const sseEverConnectedRef = useRef(false);
  const [aiReplyMode, setAiReplyMode] = useState<AiReplyMode>(DEFAULT_AI_REPLY_MODE);
  const [aiReplyStatuses, setAiReplyStatuses] = useState<Record<string, AiReplyStatus>>({});
  const aiReplyModeRef = useRef<AiReplyMode>(DEFAULT_AI_REPLY_MODE);
  const aiReplyModeRevisionRef = useRef(0);
  const selectedConversationRef = useRef<Conversation | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const conversationProjectionRevisionRef = useRef<Record<string, number>>({});
  const liveMessageIdsRef = useRef<Set<string>>(new Set());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const readWatermarkRef = useRef<Record<string, string>>({});
  const readRequestRef = useRef<Record<string, number>>({});
  const latestInboundAtRef = useRef<Record<string, number>>({});
  const messageRequestRef = useRef(0);

  const loadMessagesAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { features: planFeatures } = useSubscriptionFeatures();
  const PAGE_SIZE = 30;

  const quickReplyTemplates = templates.length > 0 ? templates : buildFallbackTemplates(t);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    const modeRevision = aiReplyModeRevisionRef.current;
    const requestRevisions = new Map(Object.entries(conversationProjectionRevisionRef.current));
    try {
      setLoadingConversations(true);
      setError(null);
      const result = await apiClient.getConversations({ limit: 50 });
      const normalizedMode = normalizeAiReplyMode(result.ai_reply_mode);
      if (modeRevision === aiReplyModeRevisionRef.current) {
        aiReplyModeRef.current = normalizedMode;
        setAiReplyMode(normalizedMode);
      }
      const mergedConversations = mergeConversationLists(
        result.data,
        conversationsRef.current,
        conversationProjectionRevisionRef.current,
        requestRevisions,
      );
      setConversations(mergedConversations);
      setAiReplyStatuses((previous) => {
        const next = { ...previous };
        mergedConversations.forEach((conversation) => {
          if (conversation.ai_is_replying === true && conversation.status !== "closed") {
            next[conversation.id] = "processing";
          } else {
            delete next[conversation.id];
          }
        });
        return next;
      });
      setSelectedConversation((previous) => {
        if (!mergedConversations.length) return null;
        if (!previous) return mergedConversations[0];
        return mergedConversations.find((conversation) => conversation.id === previous.id) || previous;
      });
    } catch {
      setError(t("inbox.errors.loadConversations"));
      toast.error(t("inbox.errors.loadConversations"));
    } finally {
      setLoadingConversations(false);
    }
  }, [t]);

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

  const loadMessages = async (conversationId: string, page: number, signal?: AbortSignal) => {
    const requestId = ++messageRequestRef.current;
    try {
      if (page === 1) setLoadingMessages(true);
      const result = await apiClient.getMessages(conversationId, { page, limit: PAGE_SIZE, signal });
      if (signal?.aborted
        || requestId !== messageRequestRef.current
        || (selectedConversationRef.current && selectedConversationRef.current.id !== conversationId)) return;
      const projectedMessages = [...result.messages, ...(result.suggestions || [])]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      projectedMessages.forEach((message) => seenMessageIdsRef.current.add(message.id));
      const latestInbound = [...projectedMessages].reverse().find((message) => message.sender === "customer");
      const latestInboundAt = timestampMs(latestInbound?.created_at);
      if (Number.isFinite(latestInboundAt)) {
        latestInboundAtRef.current[conversationId] = Math.max(
          latestInboundAtRef.current[conversationId] || 0,
          latestInboundAt,
        );
      }
      if (page === 1) {
        setMessages((previous) => {
          const projectedIds = new Set(projectedMessages.map((message) => message.id));
          projectedIds.forEach((id) => liveMessageIdsRef.current.delete(id));
          const mergedProjectedMessages = projectedMessages.map((message) => {
            const previousMessage = previous.find((item) => item.id === message.id);
            return previousMessage ? mergeMessageLifecycle(previousMessage, message) : message;
          });
          const preservedLiveMessages = previous.filter((message) => (
            liveMessageIdsRef.current.has(message.id) && !projectedIds.has(message.id)
          ));
          return [...mergedProjectedMessages, ...preservedLiveMessages]
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        });
        const status = getAiReplyStatus(
          projectedMessages,
          aiReplyModeRef.current,
          selectedConversationRef.current,
        );
        setAiReplyStatuses((prev) => {
          const next = { ...prev };
          if (status) next[conversationId] = status;
          else delete next[conversationId];
          return next;
        });
      } else {
        setMessages((prev) => [...projectedMessages, ...prev.filter((message) => !projectedMessages.some((item) => item.id === message.id))]);
      }
      setHasMoreMessages(result.pagination.page < result.pagination.totalPages);
    } catch (error) {
      if ((error as { name?: string })?.name === "CanceledError" || (error as { name?: string })?.name === "AbortError") return;
      toast.error(t("inbox.errors.loadMessages"));
    } finally {
      if (requestId === messageRequestRef.current) {
        setLoadingMessages(false);
        setLoadingMoreMessages(false);
      }
    }
  };

  const loadMessagesRef = useRef(loadMessages);
  useEffect(() => { loadMessagesRef.current = loadMessages; });

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
      const controller = new AbortController();
      loadMessagesAbortRef.current = controller;
      setMessagesPage(1);
      setHasMoreMessages(false);
      void loadMessages(selectedConversation.id, 1, controller.signal);
      setDismissedSuggestionId(null);
      return () => {
        controller.abort();
        if (loadMessagesAbortRef.current === controller) loadMessagesAbortRef.current = null;
      };
    }
    return undefined;
  }, [selectedConversation?.id]);

  useEffect(() => {
    const conversationId = selectedConversation?.id;
    if (!conversationId || !messages.length || typeof apiClient.markConversationRead !== "function") return;

    const markVisibleInboundRead = () => {
      if (document.visibilityState !== "visible") return;
      if (typeof window !== "undefined" && window.innerWidth < 768 && !mobilePanelOpen) return;
      const latestInbound = [...messages].reverse().find((message) => message.sender === "customer");
      if (!latestInbound || readWatermarkRef.current[conversationId] === latestInbound.id) return;
      readWatermarkRef.current[conversationId] = latestInbound.id;
      const requestId = (readRequestRef.current[conversationId] || 0) + 1;
      readRequestRef.current[conversationId] = requestId;
      Promise.resolve(apiClient.markConversationRead(conversationId, latestInbound.id))
        .then((updated) => {
          if (readRequestRef.current[conversationId] !== requestId) return;
          const responseReadAt = timestampMs(updated.lastReadMessageAt);
          const latestInboundAt = latestInboundAtRef.current[conversationId];
          if (Number.isFinite(responseReadAt)
            && Number.isFinite(latestInboundAt)
            && latestInboundAt > responseReadAt) return;
          setConversations((previous) => previous.map((conversation) => (
            conversation.id === conversationId ? mergeReadProjection(conversation, updated) : conversation
          )));
          setSelectedConversation((previous) => previous?.id === conversationId
            ? mergeReadProjection(previous, updated)
            : previous);
        })
        .catch(() => {
          delete readWatermarkRef.current[conversationId];
        });
    };

    markVisibleInboundRead();
    document.addEventListener("visibilitychange", markVisibleInboundRead);
    return () => document.removeEventListener("visibilitychange", markVisibleInboundRead);
  }, [selectedConversation?.id, messages, mobilePanelOpen]);

  useEffect(() => {
    if (!loadingMoreMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMoreMessages]);

  // ─── SSE ───────────────────────────────────────────────────────────────────

  useInboxSSE({
    onNewMessage: useCallback(({ conversation_id, message, unread_count }) => {
      if (!message?.id || seenMessageIdsRef.current.has(message.id)) return;
      conversationProjectionRevisionRef.current[conversation_id] =
        (conversationProjectionRevisionRef.current[conversation_id] || 0) + 1;
      liveMessageIdsRef.current.add(message.id);
      const selectedId = selectedConversationRef.current?.id;
      const isSelected = selectedId === conversation_id;
      if (isSelected) seenMessageIdsRef.current.add(message.id);
      const isCustomerMessage = message.sender === "customer";
      const inboundAt = timestampMs(message.created_at);
      if (isCustomerMessage && Number.isFinite(inboundAt)) {
        latestInboundAtRef.current[conversation_id] = Math.max(
          latestInboundAtRef.current[conversation_id] || 0,
          inboundAt,
        );
      }
      const knownConversation = conversationsRef.current.find((conversation) => conversation.id === conversation_id);
      const selectedForEvent = selectedConversationRef.current?.id === conversation_id
        ? selectedConversationRef.current
        : knownConversation;
      const hitlActive = selectedForEvent?.hitl === true;
      const needsMerchantReplyForInbound = hitlActive || aiReplyMode !== "AUTO";
      const providerConfirmed = message.sender === "customer" || isProviderConfirmed(message);
      const inboundWorkflow = isCustomerMessage
        ? {
            status: "active" as const,
            needs_merchant_reply: needsMerchantReplyForInbound,
            needs_merchant_reply_reason: needsMerchantReplyForInbound
              ? (hitlActive ? "HITL_REQUIRED" : "CUSTOMER_UNANSWERED")
              : null,
            ai_is_replying: aiReplyMode === "AUTO" && !hitlActive,
          }
        : {};
      setMessages((prev) => {
        if (!isSelected) return prev;
        const existing = prev.some((item) => item.id === message.id);
        const next = existing
          ? prev.map((item) => item.id === message.id ? mergeMessageLifecycle(item, message) : item)
          : [...prev, message];
        return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        if (isCustomerMessage && aiReplyMode === "AUTO" && !hitlActive) {
          next[conversation_id] = "processing";
        } else if (message.sender === "agent") {
          delete next[conversation_id];
        } else if (message.sender === "ai") {
          const status = getDeliveryState(message) === "FAILED" || message.metadata?.delivery_status === "failed"
            ? "failed"
            : getAiReplyStatus([message], aiReplyMode, selectedForEvent);
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
        const next = prev.map((conv) =>
          conv.id === conversation_id
            ? {
                ...conv,
                ...inboundWorkflow,
                ...(providerConfirmed ? { updated_at: message.created_at } : {}),
                ...(message.is_transcript_message === false || !providerConfirmed ? {} : { lastMessage: message.content }),
                ...(message.sender === "ai" && message.is_transcript_message === false
                  ? {
                      hasAiSuggestion: true,
                      suggestionCount: Math.max(1, conv.suggestionCount || 0),
                      needs_merchant_reply: true,
                      needs_merchant_reply_reason: "HITL_REQUIRED",
                      ai_is_replying: false,
                    }
                  : {}),
                unreadCount: (() => {
                  const currentUnread = conv.unreadCount ?? 0;
                  if (!isCustomerMessage) return currentUnread;
                  const eventAt = timestampMs(message.created_at);
                  const readAt = timestampMs(conv.lastReadMessageAt);
                  if (Number.isFinite(eventAt) && Number.isFinite(readAt) && eventAt <= readAt) {
                    return currentUnread;
                  }
                  const reportedUnread = typeof unread_count === "number" ? unread_count : null;
                  if (reportedUnread !== null) return Math.max(currentUnread, reportedUnread);
                  return isSelected ? currentUnread : currentUnread + 1;
                })(),
              }
            : conv
        );
        return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      });
      setSelectedConversation((previous) => previous?.id === conversation_id
        ? { ...previous, ...inboundWorkflow }
        : previous);
    }, [aiReplyMode]),

    onHitlChanged: useCallback(({ conversation_id, hitl, status, needs_merchant_reply: needsReply, needs_merchant_reply_reason: needsReason, ai_is_replying: aiIsReplying }: {
      conversation_id: string;
      hitl: boolean;
      status?: Conversation["status"];
      needs_merchant_reply?: boolean;
      needs_merchant_reply_reason?: string | null;
      ai_is_replying?: boolean;
    }) => {
      conversationProjectionRevisionRef.current[conversation_id] =
        (conversationProjectionRevisionRef.current[conversation_id] || 0) + 1;
      const workflow = {
        hitl,
        ...(status ? { status } : {}),
        ...(needsReply !== undefined ? { needs_merchant_reply: needsReply } : {}),
        ...(needsReason !== undefined ? { needs_merchant_reply_reason: needsReason } : {}),
        ...(aiIsReplying !== undefined ? { ai_is_replying: aiIsReplying } : {}),
      };
      setConversations((prev) =>
        prev.map((conv) => conv.id === conversation_id ? { ...conv, ...workflow } : conv)
      );
      setSelectedConversation((prev) =>
        prev?.id === conversation_id ? { ...prev, ...workflow } : prev
      );
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        delete next[conversation_id];
        return next;
      });
    }, []),

    onAiPaused: useCallback(({ conversation_id, reason }: { conversation_id: string; reason?: string }) => {
      conversationProjectionRevisionRef.current[conversation_id] =
        (conversationProjectionRevisionRef.current[conversation_id] || 0) + 1;
      const workflow = {
        needs_merchant_reply: true,
        needs_merchant_reply_reason: "AI_PAUSED",
        ai_is_replying: false,
      };
      setConversations((prev) => prev.map((conversation) => conversation.id === conversation_id
        ? { ...conversation, ...workflow }
        : conversation));
      setSelectedConversation((conversation) => conversation?.id === conversation_id
        ? { ...conversation, ...workflow }
        : conversation);
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        delete next[conversation_id];
        return next;
      });
      if (reason) {
        toast.warning(t("inbox.aiPaused", { reason }), { duration: 6000 });
      }
    }, []),

    onMessageDeliveryUpdated: useCallback(({ conversation_id, message_id, metadata, delivery_state, provider_message_id, delivery_source, content, created_at }: {
      conversation_id: string;
      message_id: string;
      metadata: Message["metadata"];
      delivery_state?: Message["delivery_state"];
      provider_message_id?: string | null;
      delivery_source?: string | null;
      content?: string | null;
      created_at?: string | null;
    }) => {
      conversationProjectionRevisionRef.current[conversation_id] =
        (conversationProjectionRevisionRef.current[conversation_id] || 0) + 1;
      const currentMessage = messages.find((message) => message.id === message_id);
      if (currentMessage
        && getDeliveryState(currentMessage) === "DISMISSED"
        && delivery_state !== "DISMISSED") return;
      const workflowConversation = conversationsRef.current.find((conversation) => conversation.id === conversation_id)
        || (selectedConversationRef.current?.id === conversation_id ? selectedConversationRef.current : null);
      if (delivery_state === "DISMISSED" && selectedConversationRef.current?.id === conversation_id) {
        // A dismissal changes the server projection for every duplicate
        // sibling. Invalidate any older page-one response before reloading it.
        messageRequestRef.current += 1;
        void loadMessagesRef.current(conversation_id, 1);
      }
      if (!currentMessage && selectedConversationRef.current?.id === conversation_id) {
        void loadMessagesRef.current(conversation_id, 1);
      }
      const incomingMessage = {
        id: message_id,
        sender: currentMessage?.sender || "ai",
        content: content ?? currentMessage?.content,
        created_at: created_at || currentMessage?.created_at || new Date().toISOString(),
        ...(delivery_state !== undefined ? { delivery_state } : {}),
        ...(provider_message_id !== undefined ? { provider_message_id } : {}),
        ...(delivery_source !== undefined ? { delivery_source } : {}),
        metadata: metadata || {},
      } as Message;
      const mergedMessage = currentMessage
        ? mergeMessageLifecycle(currentMessage, incomingMessage)
        : null;
      setMessages((prev) => {
        if (selectedConversationRef.current?.id !== conversation_id) return prev;
        return prev.map((message) => message.id === message_id
          ? mergeMessageLifecycle(message, incomingMessage)
          : message);
      });
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        if (mergedMessage?.sender === "agent") {
          delete next[conversation_id];
          return next;
        }
        if (mergedMessage?.sender !== "ai" || aiReplyMode !== "AUTO") return next;
        const status = getDeliveryState(mergedMessage) === "FAILED" || mergedMessage.metadata?.delivery_status === "failed"
          ? "failed"
          : getAiReplyStatus([mergedMessage], aiReplyMode, workflowConversation);
        if (status) next[conversation_id] = status;
        else delete next[conversation_id];
        return next;
      });
      if ((delivery_state === "SENT" || delivery_state === "FAILED") && (currentMessage?.content || content)) {
        const confirmed = mergedMessage ? isProviderConfirmed(mergedMessage) : Boolean(provider_message_id);
        const delivered = delivery_state === "SENT" && confirmed;
        const isSystemEscalation = (mergedMessage?.delivery_source
          || delivery_source
          || mergedMessage?.metadata?.delivery_source) === "HITL_ESCALATION";
        const deliveredAnswer = delivered && !isSystemEscalation;
        setConversations((prev) => prev.map((conversation) => conversation.id === conversation_id
          ? {
              ...conversation,
              lastMessage: currentMessage?.content || content || conversation.lastMessage,
              ...(created_at ? { updated_at: created_at } : {}),
              ...(deliveredAnswer
                ? { needs_merchant_reply: false, needs_merchant_reply_reason: null, ai_is_replying: false }
                : isSystemEscalation
                  ? { needs_merchant_reply: true, needs_merchant_reply_reason: "HITL_REQUIRED", ai_is_replying: false }
                  : { needs_merchant_reply: true, needs_merchant_reply_reason: "PROVIDER_SEND_FAILED", ai_is_replying: false }),
              ...(deliveredAnswer
                ? {
                    suggestionCount: Math.max(0, (conversation.suggestionCount || 1) - 1),
                    hasAiSuggestion: false,
                  }
                : {}),
            }
          : conversation));
        if (deliveredAnswer) {
          setSelectedConversation((conversation) => conversation?.id === conversation_id
            ? {
                ...conversation,
                needs_merchant_reply: false,
                needs_merchant_reply_reason: null,
                ai_is_replying: false,
                suggestionCount: Math.max(0, (conversation.suggestionCount || 1) - 1),
                hasAiSuggestion: false,
              }
            : conversation);
        } else if (isSystemEscalation) {
          setSelectedConversation((conversation) => conversation?.id === conversation_id
            ? {
                ...conversation,
                needs_merchant_reply: true,
                needs_merchant_reply_reason: "HITL_REQUIRED",
                ai_is_replying: false,
              }
            : conversation);
        } else if (delivery_state === "FAILED") {
          setSelectedConversation((conversation) => conversation?.id === conversation_id
            ? {
                ...conversation,
                needs_merchant_reply: true,
                needs_merchant_reply_reason: "PROVIDER_SEND_FAILED",
                ai_is_replying: false,
              }
            : conversation);
        }
      }
    }, [aiReplyMode, messages]),

    onDeliveryFailed: useCallback(({ conversation_id, message_id, reason }: { conversation_id?: string; message_id?: string; reason: string }) => {
      const failedConversationId = conversation_id || selectedConversation?.id;
      const failedMessage = message_id ? messages.find((message) => message.id === message_id) : null;
      if (aiReplyMode === "AUTO" && failedMessage?.sender === "ai") {
        setAiReplyStatuses((prev) =>
          failedConversationId ? { ...prev, [failedConversationId]: "failed" } : prev
        );
      }
      if (failedConversationId) {
        setConversations((prev) => prev.map((conversation) => conversation.id === failedConversationId
          ? {
              ...conversation,
              needs_merchant_reply: true,
              needs_merchant_reply_reason: "PROVIDER_SEND_FAILED",
              ai_is_replying: false,
            }
          : conversation));
        setSelectedConversation((conversation) => conversation?.id === failedConversationId
          ? {
              ...conversation,
              needs_merchant_reply: true,
              needs_merchant_reply_reason: "PROVIDER_SEND_FAILED",
              ai_is_replying: false,
            }
          : conversation);
      }
      toast.warning(t("inbox.deliveryFailed", { reason }), { duration: 6000 });
    }, [aiReplyMode, messages, selectedConversation?.id]),

    onAiReplyModeChanged: useCallback(({ mode }: { mode: AiReplyMode }) => {
      const normalizedMode = normalizeAiReplyMode(mode);
      aiReplyModeRevisionRef.current += 1;
      aiReplyModeRef.current = normalizedMode;
      setAiReplyMode(normalizedMode);
      setAiReplyStatuses({});
      setDismissedSuggestionId(null);
      const selectedId = selectedConversationRef.current?.id;
      if (selectedId) void loadMessagesRef.current(selectedId, 1);
    }, []),

    onChannelError: useCallback(({ display_name, message: errMsg }: { display_name: string; message: string }) => {
      toast.error(t("inbox.channelIssue", { name: display_name, message: errMsg }), { duration: 12000 });
    }, []), // eslint-disable-line react-hooks/exhaustive-deps

    onSSEOffline: useCallback(() => {
      setSseConnected(false);
    }, []),

    onSSEOnline: useCallback(() => {
      setSseConnected(true);
      if (sseEverConnectedRef.current) {
        void loadConversationsRef.current();
        const selectedId = selectedConversationRef.current?.id;
        if (selectedId) void loadMessagesRef.current(selectedId, 1);
      }
      sseEverConnectedRef.current = true;
    }, []),
    onConversationRead: useCallback(({ conversation_id, unread_count, last_read_message_id, last_read_message_at }: {
      conversation_id: string;
      unread_count: number;
      last_read_message_id?: string | null;
      last_read_message_at?: string | null;
    }) => {
      setConversations((prev) => prev.map((conversation) => {
        if (conversation.id !== conversation_id) return conversation;
        return mergeReadProjection(conversation, {
          unreadCount: unread_count,
          lastReadMessageId: last_read_message_id,
          lastReadMessageAt: last_read_message_at,
        });
      }));
      setSelectedConversation((prev) => {
        if (!prev || prev.id !== conversation_id) return prev;
        return mergeReadProjection(prev, {
          unreadCount: unread_count,
          lastReadMessageId: last_read_message_id,
          lastReadMessageAt: last_read_message_at,
        });
      });
    }, []),
    onCustomerUpdated: useCallback(({ customer_id, name, meta_channel_id }: { customer_id: string; name?: string; meta_channel_id?: string | null }) => {
      if (!name) return;
      setConversations((prev) => prev.map((conversation) => (
        conversation.customer_id === customer_id
        && (!meta_channel_id || conversation.meta_channel_id === meta_channel_id)
          ? { ...conversation, customer: conversation.customer ? { ...conversation.customer, name } : { id: customer_id, name } }
          : conversation
      )));
      setSelectedConversation((prev) => {
        if (!prev || prev.customer_id !== customer_id || !prev.customer || !name
          || (meta_channel_id && prev.meta_channel_id !== meta_channel_id)) return prev;
        return { ...prev, customer: { ...prev.customer, name } };
      });
    }, []),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleToggleHITL = async () => {
    if (!selectedConversation) return;
    try {
      setTogglingHITL(true);
      const newHITL = !selectedConversation.hitl;
      const response = await apiClient.updateConversation(selectedConversation.id, { hitl: newHITL });
      const updated = {
        ...selectedConversation,
        ...response,
        hitl: newHITL,
        ai_is_replying: newHITL ? false : response.ai_is_replying,
      };
      setSelectedConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        delete next[selectedConversation.id];
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
      const response = await apiClient.updateConversation(selectedConversation.id, {
        status: "closed",
        resolution_note: resolveNote || undefined,
      });
      const updated = {
        ...selectedConversation,
        ...response,
        status: "closed" as const,
        hitl: false,
        needs_merchant_reply: false,
        needs_merchant_reply_reason: null,
        ai_is_replying: false,
      };
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
    seenMessageIdsRef.current.add(message.id);
    setMessages((prev) => {
      const exists = prev.some((item) => item.id === message.id);
      const next = exists
        ? prev.map((item) => item.id === message.id ? { ...item, ...message, metadata: { ...(item.metadata || {}), ...(message.metadata || {}) } } : item)
        : [...prev, message];
      return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });
    setAiReplyStatuses((prev) => {
      const next = { ...prev };
      const conversationId = message.conversation_id || selectedConversation?.id;
      if (conversationId) delete next[conversationId];
      return next;
    });
    const messageState = getDeliveryState(message);
    const agentProviderPending = message.sender === "agent"
      && (messageState === "SEND_PENDING" || message.metadata?.delivery_status === "pending");
    const confirmedAgentReply = message.sender === "agent"
      && !agentProviderPending
      && (isProviderConfirmed(message) || (!messageState && message.metadata?.delivery_status !== "failed"));
    const confirmed = message.sender === "customer"
      || isProviderConfirmed(message)
      || confirmedAgentReply;
    const clearsSuggestionProjection = confirmedAgentReply
      || (message.sender === "ai" && isProviderConfirmed(message));
    if (confirmed) {
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === selectedConversation?.id
            ? {
                ...conv,
                updated_at: message.created_at || conv.updated_at,
                lastMessage: message.content,
                ...(confirmedAgentReply || (message.sender === "ai" && isProviderConfirmed(message))
                  ? { needs_merchant_reply: false, needs_merchant_reply_reason: null, ai_is_replying: false }
                  : {}),
                ...(clearsSuggestionProjection ? { hasAiSuggestion: false, suggestionCount: 0 } : {}),
              }
            : conv
        )
      );
    } else if (clearsSuggestionProjection) {
      setConversations((prev) => prev.map((conv) => (
        conv.id === selectedConversation?.id
          ? { ...conv, hasAiSuggestion: false, suggestionCount: 0 }
          : conv
      )));
    }
    if (clearsSuggestionProjection && selectedConversation) {
      setSelectedConversation({
        ...selectedConversation,
        ...(confirmedAgentReply || (message.sender === "ai" && isProviderConfirmed(message))
          ? { needs_merchant_reply: false, needs_merchant_reply_reason: null, ai_is_replying: false }
          : {}),
        hasAiSuggestion: false,
        suggestionCount: 0,
      });
    }
  };

  const handleMessageSendFailed = () => {
    if (!selectedConversation) return;
    setAiReplyStatuses((prev) => {
      const next = { ...prev };
      delete next[selectedConversation.id];
      return next;
    });
  };

  const handleDismissSuggestion = async (messageId: string) => {
    if (!selectedConversation) return;
    try {
      messageRequestRef.current += 1;
      loadMessagesAbortRef.current?.abort();
      const dismissed = await apiClient.dismissAiDraft(selectedConversation.id, messageId);
      setMessages((prev) => prev.map((message) => message.id === messageId ? dismissed : message));
      setConversations((prev) => prev.map((conversation) => {
        if (conversation.id !== selectedConversation.id) return conversation;
        const remaining = Math.max(0, (conversation.suggestionCount || 1) - 1);
        return {
          ...conversation,
          suggestionCount: remaining,
          hasAiSuggestion: remaining > 0,
          needs_merchant_reply: true,
          needs_merchant_reply_reason: "CUSTOMER_UNANSWERED",
          ai_is_replying: false,
        };
      }));
      setSelectedConversation((conversation) => conversation?.id === selectedConversation.id
        ? {
            ...conversation,
            needs_merchant_reply: true,
            needs_merchant_reply_reason: "CUSTOMER_UNANSWERED",
            ai_is_replying: false,
          }
        : conversation);
      setDismissedSuggestionId(messageId);
      setAiReplyStatuses((prev) => {
        const next = { ...prev };
        delete next[selectedConversation.id];
        return next;
      });
      await Promise.allSettled([
        loadMessagesRef.current(selectedConversation.id, 1),
        loadConversationsRef.current(),
      ]);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || t("inbox.errors.dismissSuggestion"));
    }
  };

  // ─── Derived values ────────────────────────────────────────────────────────

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch =
      !searchQuery ||
      conv.customer?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.title?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterTab === "needs_review") return needsMerchantReply(conv);
    if (filterTab === "closed") return conv.status === "closed";
    return conv.status !== "closed";
  });

  const needsReviewCount = conversations.filter(needsMerchantReply).length;
  const closedCount = conversations.filter((c) => c.status === "closed").length;
  const unreadTotal = conversations.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0);

  const latestInboundAt = messages.length
    ? [...messages].reverse().find((message) => message.sender === "customer")?.created_at
    : undefined;
  const hoursElapsed = selectedConversation
    ? (Date.now() - new Date(latestInboundAt || selectedConversation.updated_at).getTime()) / 3600000
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
        {unreadTotal > 0 && (
          <span data-testid="inbox-unread-total" className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm whitespace-nowrap">
            {t("inbox.unread", { count: unreadTotal })}
          </span>
        )}
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
            const sameConversation = selectedConversationRef.current?.id === conv.id;
            setSelectedConversation(conv);
            if (!sameConversation) {
              setMessages([]);
              setLoadingMessages(true);
            }
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
