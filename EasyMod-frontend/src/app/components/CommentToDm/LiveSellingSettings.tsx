/**
 * LiveSellingSettings.tsx
 *
 * Per-shop live-selling capture panel. When enabled, purchase-intent comments
 * on the shop's live ("nibo", "size M", "2 ta") are captured into the existing
 * comment-to-DM flow and the DM confirms the order — no change to send limits,
 * opt-out, or the 24h window (Meta-policy SAFE).
 */

import { useState, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Radio, X } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/app/components/ui/switch';
import { Input } from '@/app/components/ui/input';
import {
  getLiveSelling,
  updateLiveSelling,
  type LiveSellingSettings as Settings,
} from '@/api/domains/comment-to-dm';

export default function LiveSellingSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState('');

  useEffect(() => {
    let active = true;
    getLiveSelling()
      .then((s) => active && setSettings(s))
      .catch(() => active && setSettings({ enabled: false, intent_keywords: [] }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: Settings, previous: Settings) => {
    setSettings(next);
    setSaving(true);
    try {
      const saved = await updateLiveSelling(next);
      setSettings(saved);
      toast.success(t('commentToDm.liveSelling.saved', 'Live-selling settings saved'));
    } catch {
      setSettings(previous); // revert
      toast.error(t('commentToDm.liveSelling.saveFailed', 'Could not save live-selling settings'));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = () => {
    if (!settings || saving) return;
    persist({ ...settings, enabled: !settings.enabled }, settings);
  };

  const addKeyword = () => {
    if (!settings || saving) return;
    const kw = keywordDraft.trim();
    if (!kw || settings.intent_keywords.includes(kw)) {
      setKeywordDraft('');
      return;
    }
    persist({ ...settings, intent_keywords: [...settings.intent_keywords, kw] }, settings);
    setKeywordDraft('');
  };

  const removeKeyword = (kw: string) => {
    if (!settings || saving) return;
    persist(
      { ...settings, intent_keywords: settings.intent_keywords.filter((k) => k !== kw) },
      settings
    );
  };

  const onKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="rounded-lg border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">
                {t('commentToDm.liveSelling.title', 'Live-selling order capture')}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(
                  'commentToDm.liveSelling.subtitle',
                  'Turn purchase-intent comments on your live ("nibo", "size M", "2 ta") into DM orders automatically.'
                )}
              </p>
            </div>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={toggleEnabled}
            disabled={saving}
            aria-label="Toggle live-selling capture"
            className="data-[state=checked]:bg-rose-600"
          />
        </div>
      </div>

      {/* Custom intent keywords */}
      <div className="rounded-lg border p-5 space-y-3">
        <div>
          <p className="font-semibold">
            {t('commentToDm.liveSelling.keywordsTitle', 'Extra buy-signal words')}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t(
              'commentToDm.liveSelling.keywordsHelp',
              'Common Bangla/Banglish buy words are built in. Add your own shop-specific words below.'
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={onKeywordKeyDown}
            placeholder={t('commentToDm.liveSelling.keywordPlaceholder', 'e.g. confirm, booking')}
            disabled={saving || !settings.enabled}
            className="max-w-xs"
          />
          <button
            type="button"
            onClick={addKeyword}
            disabled={saving || !settings.enabled || !keywordDraft.trim()}
            className="rounded-lg bg-rose-600 px-4 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
          >
            {t('commentToDm.liveSelling.add', 'Add')}
          </button>
        </div>

        {settings.intent_keywords.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {settings.intent_keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-700"
              >
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  disabled={saving}
                  className="text-rose-400 hover:text-rose-700"
                  aria-label={`Remove ${kw}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t(
          'commentToDm.liveSelling.policyNote',
          'Only comments on your own page are captured, within the same safe DM limits as comment-to-DM.'
        )}
      </p>
    </div>
  );
}
