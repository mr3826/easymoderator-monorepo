import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ConversationMessage } from '@/api/mobile/schemas';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useConversation, useConversationMessages } from '@/hooks/useInbox';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

export function ConversationScreen({ id }: { id: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  const conversationQuery = useConversation(id ?? '');
  const messagesQuery = useConversationMessages(id ?? '');

  if (!id) return <ConversationState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  if (conversationQuery.isPending || messagesQuery.isPending) return <ConversationLoading />;
  if (conversationQuery.error?.kind === 'notFound' || messagesQuery.error?.kind === 'notFound') {
    return <ConversationState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  }
  if (conversationQuery.isError || messagesQuery.isError) {
    const error = conversationQuery.error || messagesQuery.error;
    return (
      <ConversationState
        title={t('mobile.inbox.detail.error.title')}
        message={error ? t(apiErrorMessageKey(error.kind)) : t('mobile.inbox.detail.error.message')}
        actionLabel={t('common.retry')}
        onAction={() => {
          void conversationQuery.refetch();
          void messagesQuery.refetch();
        }}
      />
    );
  }

  const conversation = conversationQuery.data;
  const messages = messagesQuery.data?.messages ?? [];
  const customerName = conversation?.customer?.name || conversation?.title || t('mobile.inbox.unknownCustomer');

  return (
    <View style={styles.container} testID="mobile-conversation-detail">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="mobile-conversation-back" style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.customerName} numberOfLines={1}>{customerName}</Text>
          <Text style={styles.headerMeta}>{conversation?.channel} · {conversation?.status}</Text>
        </View>
      </View>
      {conversation?.needs_merchant_reply ? (
        <View style={styles.needsNotice} accessibilityRole="alert">
          <Text style={styles.needsNoticeText}>{t('mobile.inbox.detail.needsReply')}</Text>
        </View>
      ) : null}
      <FlatList
        testID="mobile-conversation-messages"
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        ListEmptyComponent={<ConversationState title={t('mobile.inbox.detail.empty.title')} message={t('mobile.inbox.detail.empty.message')} />}
        renderItem={({ item }) => <MessageBubble message={item} />}
      />
      <View style={styles.readOnlyNotice}>
        <Text style={styles.readOnlyText}>{t('mobile.inbox.detail.readOnly')}</Text>
      </View>
    </View>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const senderIsCustomer = message.sender === 'customer';
  return (
    <View style={[styles.messageRow, senderIsCustomer ? styles.customerRow : styles.merchantRow]}>
      <View style={[styles.bubble, senderIsCustomer ? styles.customerBubble : styles.merchantBubble]}>
        <Text style={[styles.messageText, !senderIsCustomer && styles.merchantMessageText]}>
          {message.content || message.ai_suggestion || ' '}
        </Text>
        <Text style={[styles.timestamp, !senderIsCustomer && styles.merchantTimestamp]}>
          {new Date(message.created_at).toLocaleString()}
        </Text>
      </View>
    </View>
  );
}

function ConversationLoading() {
  return <View style={styles.center} testID="mobile-conversation-loading"><ActivityIndicator size="large" color={brandColors.primary} /></View>;
}

function ConversationState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.center} testID="mobile-conversation-state">
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {actionLabel && onAction ? <Pressable onPress={onAction} style={styles.retry}><Text style={styles.retryText}>{actionLabel}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brandColors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.two, paddingVertical: spacing.two, borderBottomWidth: 1, borderBottomColor: neutral.border, backgroundColor: neutral.surface },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 36, color: brandColors.primaryDark, lineHeight: 38 },
  headerCopy: { flex: 1, gap: spacing.half },
  customerName: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 17 },
  headerMeta: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textTransform: 'capitalize' },
  needsNotice: { margin: spacing.two, padding: spacing.two, borderRadius: radius.default, backgroundColor: 'rgba(0, 166, 81, 0.12)' },
  needsNoticeText: { color: brandColors.primaryDark, fontFamily: fontFamily.medium, fontSize: 13 },
  messages: { padding: spacing.three, gap: spacing.two, flexGrow: 1 },
  messageRow: { flexDirection: 'row', marginBottom: spacing.two },
  customerRow: { justifyContent: 'flex-start' },
  merchantRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', padding: spacing.two, borderRadius: radius.default, gap: spacing.one },
  customerBubble: { backgroundColor: neutral.surface, borderWidth: 1, borderColor: neutral.border },
  merchantBubble: { backgroundColor: brandColors.primary },
  messageText: { color: brandColors.text, fontFamily: fontFamily.regular, fontSize: 15 },
  merchantMessageText: { color: '#FFFFFF' },
  timestamp: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 10 },
  merchantTimestamp: { color: 'rgba(255,255,255,0.75)' },
  readOnlyNotice: { borderTopWidth: 1, borderTopColor: neutral.border, padding: spacing.two, backgroundColor: neutral.surface },
  readOnlyText: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.four, gap: spacing.two, backgroundColor: brandColors.background },
  stateTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18, textAlign: 'center' },
  stateMessage: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14, textAlign: 'center' },
  retry: { backgroundColor: brandColors.primary, borderRadius: radius.default, paddingHorizontal: spacing.four, paddingVertical: spacing.two },
  retryText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold },
});
