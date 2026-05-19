import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import {
  listEvents,
  type CommentToDmEvent,
  type CommentToDmState,
} from '@/api/domains/comment-to-dm';

// State → badge colour mapping
const STATE_VARIANT: Record<CommentToDmState, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  COMMENT_RECEIVED:    'outline',
  MATCHED:             'secondary',
  BLOCKED:             'destructive',
  PUBLIC_REPLY_QUEUED: 'secondary',
  PUBLIC_REPLIED:      'secondary',
  DM_INVITE_SENT:      'default',
  CUSTOMER_OPENED_DM:  'default',
  AUTOMATION_UNLOCKED: 'default',
  EXPIRED:             'outline',
  FAILED:              'destructive',
};

function StateBadge({ state }: { state: CommentToDmState }) {
  const { t } = useTranslation();
  const label = t(`commentToDm.states.${state}`, state.replace(/_/g, ' '));
  return (
    <Badge variant={STATE_VARIANT[state] ?? 'outline'} className="whitespace-nowrap text-xs">
      {label}
    </Badge>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CommentToDmEventLog() {
  const { t } = useTranslation();

  const [events, setEvents] = useState<CommentToDmEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CommentToDmState | ''>('');

  const load = useCallback(
    async (replace = true) => {
      replace ? setLoading(true) : setLoadingMore(true);
      setError(null);

      try {
        const result = await listEvents({
          status: statusFilter as CommentToDmState | undefined,
          limit:  50,
          cursor: replace ? undefined : cursor ?? undefined,
        });

        setEvents((prev) => replace ? result.data : [...prev, ...result.data]);
        setHasMore(result.pagination.hasMore);
        setCursor(result.pagination.nextCursor);
      } catch (err: any) {
        setError(err.message || t('commentToDm.eventLog.loadError', 'Failed to load events'));
      } finally {
        replace ? setLoading(false) : setLoadingMore(false);
      }
    },
    [statusFilter, cursor, t]
  );

  useEffect(() => {
    void load(true);
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const ALL_STATES: (CommentToDmState | '')[] = [
    '', 'MATCHED', 'DM_INVITE_SENT', 'CUSTOMER_OPENED_DM',
    'AUTOMATION_UNLOCKED', 'EXPIRED', 'FAILED', 'BLOCKED',
  ];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {ALL_STATES.map((s) => (
            <Button
              key={s || 'all'}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              onClick={() => {
                setStatusFilter(s);
                setCursor(null);
              }}
            >
              {s
                ? t(`commentToDm.states.${s}`, s.replace(/_/g, ' '))
                : t('commentToDm.eventLog.allStates', 'All')}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setCursor(null); void load(true); }}
          disabled={loading}
          aria-label={t('common.refresh', 'Refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
          {t('commentToDm.eventLog.empty', 'No comment events yet')}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('commentToDm.eventLog.columns.state', 'State')}</TableHead>
                <TableHead>{t('commentToDm.eventLog.columns.platform', 'Platform')}</TableHead>
                <TableHead>{t('commentToDm.eventLog.columns.commenter', 'Commenter')}</TableHead>
                <TableHead>{t('commentToDm.eventLog.columns.text', 'Comment')}</TableHead>
                <TableHead>{t('commentToDm.eventLog.columns.keyword', 'Keyword')}</TableHead>
                <TableHead>{t('commentToDm.eventLog.columns.customer', 'Customer')}</TableHead>
                <TableHead>{t('commentToDm.eventLog.columns.conversation', 'Conversation')}</TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('commentToDm.eventLog.columns.lastTransition', 'Last transition')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((evt) => (
                <TableRow key={evt.id}>
                  <TableCell><StateBadge state={evt.state} /></TableCell>
                  <TableCell className="capitalize">{evt.platform}</TableCell>
                  <TableCell className="max-w-[140px] truncate" title={evt.commenterExternalId}>
                    {evt.commenterName || evt.commenterExternalId}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={evt.commentText ?? ''}>
                    {evt.commentText || '-'}
                  </TableCell>
                  <TableCell>
                    {evt.matchedKeyword ? (
                      <Badge variant="secondary" className="text-xs">
                        {evt.matchedKeyword}
                      </Badge>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs font-mono">
                    {evt.customerId || '-'}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs font-mono">
                    {evt.conversationId || '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(evt.lastTransitionAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => void load(false)}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ChevronDown className="mr-2 h-4 w-4" />
            )}
            {t('common.loadMore', 'Load more')}
          </Button>
        </div>
      )}
    </div>
  );
}
