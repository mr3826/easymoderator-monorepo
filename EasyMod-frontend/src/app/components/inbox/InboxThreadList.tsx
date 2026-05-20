/**
 * InboxThreadList — Left pane: conversation list with search + filter tabs.
 * Extracted from UnifiedInbox.tsx (D2 split).
 */
import { motion } from "motion/react";
import { Search, UserCheck, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import type { Conversation } from "@/api/types/conversation";
import { Badge } from "@/app/components/ui/badge";
import { useTranslation } from "react-i18next";
import { fadeUp, staggerChildren } from "@/lib/motion";

interface InboxThreadListProps {
  conversations: Conversation[];
  selectedConversationId: string | null;
  filteredConversations: Conversation[];
  loading: boolean;
  searchQuery: string;
  filterTab: "all" | "needs_review" | "closed";
  needsReviewCount: number;
  closedCount: number;
  mobilePanelOpen: boolean;
  onSearchChange: (q: string) => void;
  onFilterChange: (tab: "all" | "needs_review" | "closed") => void;
  onSelectConversation: (conv: Conversation) => void;
}

const getChannelIcon = (channel: string): string => {
  const icons: Record<string, string> = {
    facebook: "👥",
    telegram: "✈️",
    messenger: "📱",
    instagram: "📷",
    web: "🌐",
  };
  return icons[channel] || "💬";
};

const formatDate = (dateString: string): string => {
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
};

export function InboxThreadList({
  filteredConversations,
  selectedConversationId,
  loading,
  searchQuery,
  filterTab,
  needsReviewCount,
  closedCount,
  mobilePanelOpen,
  onSearchChange,
  onFilterChange,
  onSelectConversation,
}: InboxThreadListProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`bg-white border-r border-gray-200 overflow-y-auto flex flex-col w-full md:w-80 ${
        mobilePanelOpen ? "hidden" : "flex"
      } md:flex`}
    >
      <div className="p-4 border-b border-gray-200 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("inbox.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "needs_review", "closed"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onFilterChange(tab)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
                filterTab === tab
                  ? tab === "needs_review"
                    ? "bg-amber-100 text-amber-700"
                    : tab === "closed"
                    ? "bg-gray-200 text-gray-700"
                    : "bg-blue-100 text-blue-700"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {tab === "all" && t("inbox.tabAll")}
              {tab === "needs_review" && (
                <>
                  {t("inbox.tabNeedsReview")}
                  {needsReviewCount > 0 && (
                    <span className="bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                      {needsReviewCount}
                    </span>
                  )}
                </>
              )}
              {tab === "closed" && (
                <>
                  {t("inbox.tabClosed")}
                  {closedCount > 0 && (
                    <span className="bg-gray-400 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                      {closedCount}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : filteredConversations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 p-6">
          <MessageCircle className="w-10 h-10 text-gray-300" />
          <p className="text-sm text-center font-bn">
            {searchQuery ? t("inbox.noResults") : t("inbox.noConversations")}
          </p>
        </div>
      ) : (
        <motion.div
          className="divide-y divide-gray-100 flex-1 overflow-y-auto pb-20 md:pb-0"
          variants={staggerChildren}
          initial="hidden"
          animate="visible"
        >
          {filteredConversations.map((conversation) => {
            const isHITL = conversation.hitl === true;
            const isAIHandled = !isHITL && conversation.status === "active";
            const lastAIReply = isAIHandled ? formatDate(conversation.updated_at) : null;

            return (
              <motion.div
                key={conversation.id}
                variants={fadeUp}
                onClick={() => onSelectConversation(conversation)}
                className={[
                  "p-4 cursor-pointer hover:bg-gray-50 transition-colors relative",
                  selectedConversationId === conversation.id ? "bg-blue-50" : "",
                  isHITL ? "border-l-4 border-destructive" : "",
                ].join(" ")}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white flex-shrink-0 text-sm font-semibold">
                      {conversation.customer?.name?.charAt(0) || "C"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <h3
                          className={`font-semibold truncate text-sm ${
                            conversation.status === "closed"
                              ? "text-gray-400"
                              : "text-gray-900"
                          }`}
                        >
                          {conversation.customer?.name || "Unknown"}
                        </h3>
                        {isHITL && (
                          <UserCheck
                            className="w-3 h-3 text-amber-500 flex-shrink-0"
                            title={t("inbox.humanTooltip")}
                          />
                        )}
                        {conversation.status === "closed" && (
                          <CheckCircle2
                            className="w-3 h-3 text-green-500 flex-shrink-0"
                            title={t("inbox.resolved")}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <span>{getChannelIcon(conversation.channel)}</span>
                        <span>{conversation.channel}</span>
                      </div>
                    </div>
                  </div>
                  {/* HITL badge */}
                  {isHITL && (
                    <Badge variant="destructive" className="text-xs shrink-0 font-bn">
                      উত্তর প্রয়োজন
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600 truncate">
                  {conversation.title || "No title"}
                </p>
                {/* AI-handled: muted + relative timestamp */}
                {isAIHandled && lastAIReply ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    AI replied {lastAIReply}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">
                    {formatDate(conversation.updated_at)}
                  </p>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
