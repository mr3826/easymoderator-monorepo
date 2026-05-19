/**
 * CommentToDm — combined page.
 *
 * Tabs:
 *   1. Event Log — shows all comment-to-DM events for this shop
 *   2. Settings  — per-channel toggle + keyword + post filter configuration
 *
 * The Settings tab requires a channelId param. If the shop has multiple Meta
 * channels, a simple dropdown lets the user pick which channel to configure.
 * If no meta channels are connected, a prompt is shown.
 *
 * Routing: embedded as a child route or standalone page.
 * The caller (routes.ts) can mount it at /app/channels/comment-to-dm.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { listMetaChannels, type MetaChannel } from '@/api/domains/meta-channels';
import CommentToDmSettings from './CommentToDmSettings';
import CommentToDmEventLog from './CommentToDmEventLog';

export default function CommentToDmPage() {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoadingChannels(true);

    listMetaChannels()
      .then((data) => {
        if (cancelled) return;
        const connected = data.filter((c) => c.status === 'CONNECTED');
        setChannels(connected);
        if (connected.length > 0) {
          setSelectedChannelId(connected[0].id);
        }
      })
      .catch(() => {
        // Non-fatal — event log still works without a channel selection
      })
      .finally(() => {
        if (!cancelled) setLoadingChannels(false);
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {t('commentToDm.pageTitle', 'Comment-to-DM')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'commentToDm.pageDescription',
            'Automatically convert Facebook and Instagram comments into private DM conversations.'
          )}
        </p>
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">
            {t('commentToDm.tabs.events', 'Event log')}
          </TabsTrigger>
          <TabsTrigger value="settings">
            {t('commentToDm.tabs.settings', 'Settings')}
          </TabsTrigger>
        </TabsList>

        {/* Event Log tab */}
        <TabsContent value="events" className="mt-4">
          <CommentToDmEventLog />
        </TabsContent>

        {/* Settings tab */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          {loadingChannels ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : channels.length === 0 ? (
            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
              {t(
                'commentToDm.settings.noChannels',
                'No connected Facebook or Instagram channels found. Connect a channel in Settings > Channels first.'
              )}
            </div>
          ) : (
            <>
              {channels.length > 1 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {t('commentToDm.settings.selectChannel', 'Channel:')}
                  </span>
                  <Select
                    value={selectedChannelId}
                    onValueChange={setSelectedChannelId}
                  >
                    <SelectTrigger className="w-[260px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>
                          {ch.displayName} ({ch.platform})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedChannelId && (
                <CommentToDmSettings key={selectedChannelId} channelId={selectedChannelId} />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
