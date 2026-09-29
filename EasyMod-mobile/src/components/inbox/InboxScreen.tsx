import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Conversation } from '@/api/mobile/schemas';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useAuth } from '@/auth/AuthProvider';
import { useInboxConversations } from '@/hooks/useInbox';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

type InboxFilter = 'all' | 'needs' | 'unread';

export function InboxScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const isOnline = useNetworkStatus();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const query = useInboxConversations(filter === 'all' ? undefined : 'active');
  const conversations = useMemo(
    () => query.data?.pages.flatMap((page) => page.conversations) ?? [],
    [query.data?.pages],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => {
      const matchesFilter = filter === 'all'
        || (filter === 'needs' && conversation.needs_merchant_reply === true)
        || (filter === 'unread' && conversation.unreadCount > 0);
      if (!matchesFilter) return false;
      if (!normalizedSearch) return true;
      const customerName = conversation.customer?.name ?? '';
      return [conversation.title, conversation.lastMessage, customerName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(normalizedSearch));
    }),
    [conversations, filter, normalizedSearch],
  );

  if (!user?.shopId) {
    return <InboxState title={t('mobile.home.noShop.title')} message={t('mobile.home.noShop.message')} />;
  }

  if (!isOnline && conversations.length === 0) {
    return <InboxState title={t('mobile.inbox.offline.title')} message={t('mobile.inbox.offline.message')} />;
  }

  if (query.isPending && conversations.length === 0) return <InboxLoading />;

  if (query.isError && conversations.length === 0) {
    return (
      <InboxState
        title={t('mobile.inbox.error.title')}
        message={t(apiErrorMessageKey(query.error.kind))}
        actionLabel={t('common.retry')}
        onAction={() => void query.refetch()}
        testID="mobile-inbox-error"
      />
    );
  }

  return (
    <FlatList
      testID="mobile-inbox-list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={visibleConversations}
      keyExtractor={(item) => item.id}
      refreshControl={(
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          colors={[brandColors.primary]}
          tintColor={brandColors.primary}
        />
      )}
      ListHeaderComponent={(
        <View>
          {!isOnline ? <Text style={styles.offlineNotice}>{t('mobile.inbox.offline.cached')}</Text> : null}
          <Text style={styles.title}>{t('mobile.inbox.title')}</Text>
          <TextInput
            testID="mobile-inbox-search"
            value={search}
            onChangeText={setSearch}
            placeholder={t('mobile.inbox.searchPlaceholder')}
            placeholderTextColor={neutral.muted}
            accessibilityLabel={t('mobile.inbox.searchPlaceholder')}
            style={styles.search}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <View style={styles.filters} accessibilityRole="tablist">
            {(['all', 'needs', 'unread'] as const).map((option) => (
              <Pressable
                key={option}
                testID={`mobile-inbox-filter-${option}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: filter === option }}
                onPress={() => setFilter(option)}
                style={[styles.filter, filter === option && styles.filterActive]}
              >
                <Text style={[styles.filterText, filter === option && styles.filterTextActive]}>
                  {t(`mobile.inbox.filters.${option}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          {query.isError ? <Text style={styles.staleNotice}>{t('mobile.inbox.refreshFailed')}</Text> : null}
        </View>
      )}
      ListEmptyComponent={(
        <InboxState
          title={t('mobile.inbox.empty.title')}
          message={search ? t('mobile.inbox.empty.searchMessage') : t('mobile.inbox.empty.message')}
          testID="mobile-inbox-empty"
        />
      )}
      renderItem={({ item }) => (
        <ConversationRow
          conversation={item}
          onPress={() => router.push({ pathname: '/conversation-detail/[id]', params: { id: item.id } })}
        />
      )}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={brandColors.primary} /> : null}
    />
  );
}

function ConversationRow({ conversation, onPress }: { conversation: Conversation; onPress: () => void }) {
  const { t } = useTranslation();
  const customerName = conversation.customer?.name || conversation.title || t('mobile.inbox.unknownCustomer');
  const statusLabel = conversation.needs_merchant_reply
    ? t('mobile.inbox.needsReply')
    : conversation.hitl
      ? t('mobile.inbox.humanActive')
      : conversation.status;

  return (
    <Pressable
      testID={`mobile-conversation-${conversation.id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowHeader}>
        <Text style={styles.customerName} numberOfLines={1}>{customerName}</Text>
        {conversation.unreadCount > 0 ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{conversation.unreadCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.preview} numberOfLines={2}>{conversation.lastMessage || t('mobile.inbox.noMessages')}</Text>
      <View style={styles.rowFooter}>
        <Text style={styles.channel}>{conversation.channel}</Text>
        <Text style={[styles.status, conversation.needs_merchant_reply && styles.needsReply]}>{statusLabel}</Text>
      </View>
    </Pressable>
  );
}

function InboxLoading() {
  return <View style={styles.center} testID="mobile-inbox-loading"><ActivityIndicator size="large" color={brandColors.primary} /></View>;
}

function InboxState({
  title,
  message,
  actionLabel,
  onAction,
  testID = 'mobile-inbox-state',
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: brandColors.background },
  content: { padding: spacing.three, paddingBottom: spacing.six, flexGrow: 1 },
  title: { fontFamily: fontFamily.bold, fontSize: 24, color: brandColors.text, marginBottom: spacing.two },
  search: { borderWidth: 1, borderColor: neutral.border, borderRadius: radius.default, backgroundColor: neutral.surface, color: brandColors.text, fontFamily: fontFamily.regular, fontSize: 15, paddingHorizontal: spacing.three, paddingVertical: spacing.two },
  filters: { flexDirection: 'row', gap: spacing.one, marginVertical: spacing.three },
  filter: { borderRadius: radius.default, borderWidth: 1, borderColor: neutral.border, paddingHorizontal: spacing.three, paddingVertical: spacing.one },
  filterActive: { backgroundColor: brandColors.primary, borderColor: brandColors.primary },
  filterText: { color: neutral.muted, fontFamily: fontFamily.medium, fontSize: 13 },
  filterTextActive: { color: '#FFFFFF' },
  offlineNotice: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 13, marginBottom: spacing.two },
  staleNotice: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 13, marginBottom: spacing.two },
  row: { backgroundColor: neutral.surface, borderRadius: radius.default, padding: spacing.three, marginBottom: spacing.two, borderWidth: 1, borderColor: neutral.border, gap: spacing.one },
  rowPressed: { opacity: 0.75 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  customerName: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: 16, color: brandColors.text },
  unreadBadge: { minWidth: 24, minHeight: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: brandColors.primary },
  unreadText: { color: '#FFFFFF', fontFamily: fontFamily.bold, fontSize: 12 },
  preview: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14 },
  rowFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.two },
  channel: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textTransform: 'capitalize' },
  status: { color: neutral.muted, fontFamily: fontFamily.medium, fontSize: 12 },
  needsReply: { color: brandColors.primaryDark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.four, gap: spacing.two, backgroundColor: brandColors.background },
  stateTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18, textAlign: 'center' },
  stateMessage: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14, textAlign: 'center' },
  retry: { backgroundColor: brandColors.primary, borderRadius: radius.default, paddingHorizontal: spacing.four, paddingVertical: spacing.two },
  retryText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold },
});
