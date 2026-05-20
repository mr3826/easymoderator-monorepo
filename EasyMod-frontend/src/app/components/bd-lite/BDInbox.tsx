/**
 * BDInbox — Simplified mobile-first inbox for BD f-commerce sellers.
 *
 * Reuses useInboxSSE, getConversations, and getConversation from the
 * existing data layer. Does NOT re-implement any business logic.
 *
 * Layout: two-pane on md+, single-pane swipe on mobile.
 * HITL threads pinned at top with red left-bar + "উত্তর প্রয়োজন" pill.
 * AI-handled threads shown muted with last-replied timestamp.
 * Bengali default, English toggle via existing i18n.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import React from 'react';
import { ArrowLeft, MessageCircle, RefreshCw, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { conversation as conversationApi } from '@/api/domains';
import type { Conversation, Message } from '@/api/types/conversation';
import { useInboxSSE } from '../../lib/useInboxSSE';
import { Badge } from '../ui/badge';
import { cn } from '../ui/utils';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function relativeTime(dateStr: string, lang: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (lang === 'bn') {
    if (diff < 60) return 'এইমাত্র';
    if (diff < 3600) return `${Math.floor(diff / 60)}মি আগে`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}ঘ আগে`;
    return `${Math.floor(diff / 86400)}দি আগে`;
  }
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ──────────────────────────────────────────────
// Thread list item
// ──────────────────────────────────────────────

interface ThreadCardProps {
  conv: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  lang: string;
  t: (key: string) => string;
}

const ThreadCard = React.memo(function ThreadCard({ conv, isSelected, onSelect, lang, t }: ThreadCardProps) {
  const isHitl = conv.hitl === true;
  const customerName = conv.customer?.name ?? conv.title ?? t('inbox.unknownCustomer') ?? 'Customer';
  const lastAt = conv.updated_at ?? conv.created_at;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-100 transition-colors relative',
        isHitl ? 'border-l-[3px] border-l-red-500' : 'border-l-[3px] border-l-transparent',
        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50',
        !isHitl && 'opacity-75'
      )}
    >
      {/* Avatar initial */}
      <div className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0',
        isHitl ? 'bg-red-500' : 'bg-gray-400'
      )}>
        {customerName.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('font-semibold truncate text-sm', isHitl ? 'text-gray-900' : 'text-gray-500')}>
            {customerName}
          </span>
          <span className="text-[10px] text-gray-400 shrink-0">{relativeTime(lastAt, lang)}</span>
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          {isHitl ? (
            <Badge className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200 font-bn">
              {lang === 'bn' ? 'উত্তর প্রয়োজন' : 'Needs reply'}
            </Badge>
          ) : (
            <span className="text-[11px] text-gray-400 truncate">
              {lang === 'bn' ? 'AI উত্তর দিয়েছে' : 'AI replied'} · {relativeTime(lastAt, lang)}
            </span>
          )}
        </div>

        {conv.lastMessage && (
          <p className="text-xs text-gray-500 truncate mt-0.5 max-w-[220px]">{conv.lastMessage}</p>
        )}
      </div>

      {conv.unreadCount && conv.unreadCount > 0 ? (
        <span className="absolute top-3 right-3 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
          {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
        </span>
      ) : null}
    </button>
  );
});

// ──────────────────────────────────────────────
// Main BDInbox
// ──────────────────────────────────────────────

export default function BDInbox() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sseStatus, setSseStatus] = useState<'live' | 'reconnecting' | 'offline'>('live');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Data fetch ──────────────────────────────
  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await conversationApi.getConversations({ limit: 50, sort: 'updated_at' });
      const list = result.data ?? (result as unknown as Conversation[]);
      // HITL threads pinned at top
      const sorted = [...list].sort((a, b) => {
        if (a.hitl && !b.hitl) return -1;
        if (!a.hitl && b.hitl) return 1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
      setConversations(sorted);
    } catch {
      setError(lang === 'bn' ? 'কথোপকথন লোড করতে ব্যর্থ' : t('inbox.errors.loadConversations'));
    } finally {
      setLoading(false);
    }
  }, [t, lang]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const fetchMessages = useCallback(async (convId: string) => {
    try {
      setLoadingMessages(true);
      const conv = await conversationApi.getConversation(convId);
      setMessages(conv.messages ?? []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    fetchMessages(id);
  }, [fetchMessages]);

  // ── SSE live updates ────────────────────────
  useInboxSSE({
    onNewMessage: ({ conversation_id, message }) => {
      setConversations(prev =>
        prev.map(c =>
          c.id === conversation_id
            ? { ...c, lastMessage: message.content, updated_at: message.created_at }
            : c
        )
      );
      if (conversation_id === selectedId) {
        setMessages(prev => [...prev, message]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    },
    onHitlChanged: ({ conversation_id, hitl }) => {
      setConversations(prev =>
        prev.map(c => c.id === conversation_id ? { ...c, hitl } : c)
      );
    },
    onSSEOnline: () => setSseStatus('live'),
    onSSEOffline: () => setSseStatus('offline'),
  });

  // ── Language toggle ─────────────────────────
  const toggleLang = () => i18n.changeLanguage(lang === 'bn' ? 'en' : 'bn');

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;

  // ── Thread list pane ────────────────────────
  const threadListPane = (
    <div className={cn('flex flex-col h-full', mobileDetailOpen && selectedId ? 'hidden md:flex' : 'flex')}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
        <h1 className="font-bold text-base text-gray-900 font-bn">
          {lang === 'bn' ? 'ইনবক্স' : t('inbox.title')}
        </h1>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-[10px] px-2 py-0.5 rounded-full font-medium',
            sseStatus === 'live' ? 'bg-green-100 text-green-700' :
            sseStatus === 'reconnecting' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-500'
          )}>
            {sseStatus === 'live' ? (lang === 'bn' ? 'লাইভ' : 'Live') :
             sseStatus === 'reconnecting' ? (lang === 'bn' ? 'পুনরায় সংযুক্ত হচ্ছে' : 'Reconnecting') :
             (lang === 'bn' ? 'অফলাইন' : 'Offline')}
          </span>
          <button type="button" onClick={toggleLang} title="Switch language"
            className="text-gray-400 hover:text-blue-600 transition-colors">
            <Globe className="w-4 h-4" />
          </button>
          <button type="button" onClick={fetchConversations} title="Refresh"
            className="text-gray-400 hover:text-blue-600 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm font-bn">
            {lang === 'bn' ? 'লোড হচ্ছে...' : t('common.loading')}
          </div>
        )}
        {!loading && error && (
          <div className="p-4 text-center text-sm text-red-500 font-bn">{error}</div>
        )}
        {!loading && !error && conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <MessageCircle className="w-10 h-10" />
            <p className="text-sm font-bn">{lang === 'bn' ? 'কোনো কথোপকথন নেই' : t('inbox.noConversations')}</p>
          </div>
        )}
        {conversations.map(conv => (
          <ThreadCard
            key={conv.id}
            conv={conv}
            isSelected={conv.id === selectedId}
            onSelect={() => selectConversation(conv.id)}
            lang={lang}
            t={t}
          />
        ))}
      </div>
    </div>
  );

  // ── Detail pane ─────────────────────────────
  const detailPane = (
    <div className={cn(
      'flex flex-col h-full bg-gray-50',
      !mobileDetailOpen || !selectedId ? 'hidden md:flex' : 'flex'
    )}>
      {selectedConv ? (
        <>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
            <button type="button" onClick={() => setMobileDetailOpen(false)}
              className="md:hidden text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="font-semibold text-sm text-gray-900 truncate">
              {selectedConv.customer?.name ?? selectedConv.title ?? 'Customer'}
            </div>
            {selectedConv.hitl && (
              <Badge className="text-[10px] bg-red-50 text-red-600 border-red-200 ml-auto font-bn shrink-0">
                {lang === 'bn' ? 'উত্তর প্রয়োজন' : 'Needs reply'}
              </Badge>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loadingMessages && (
              <div className="text-center text-sm text-gray-400 py-8 font-bn">
                {lang === 'bn' ? 'বার্তা লোড হচ্ছে...' : 'Loading messages...'}
              </div>
            )}
            {!loadingMessages && messages.map(msg => (
              <div key={msg.id} className={cn('flex', msg.sender === 'customer' ? 'justify-start' : 'justify-end')}>
                <div className={cn(
                  'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                  msg.sender === 'customer' ? 'bg-white border border-gray-100 text-gray-800' :
                  msg.sender === 'ai' ? 'bg-purple-100 text-purple-900 border border-purple-200' :
                  'bg-blue-600 text-white'
                )}>
                  {msg.content}
                  <p className={cn('text-[10px] mt-1', msg.sender === 'agent' ? 'text-blue-100' : 'text-gray-400')}>
                    {new Date(msg.created_at).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </>
      ) : (
        <div className="hidden md:flex flex-col items-center justify-center h-full text-gray-400 gap-3">
          <MessageCircle className="w-12 h-12" />
          <p className="text-sm font-bn">{lang === 'bn' ? 'একটি কথোপকথন বেছে নিন' : t('inbox.selectConversation')}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem-4rem)] overflow-hidden">
      <div className="w-full md:w-[60%] border-r border-gray-100 flex flex-col overflow-hidden">
        {threadListPane}
      </div>
      <div className="hidden md:flex md:w-[40%] flex-col overflow-hidden">
        {detailPane}
      </div>
      {/* Mobile full-screen detail overlay */}
      {mobileDetailOpen && selectedId && (
        <div className="absolute inset-0 z-20 bg-white flex flex-col md:hidden">
          {detailPane}
        </div>
      )}
    </div>
  );
}
