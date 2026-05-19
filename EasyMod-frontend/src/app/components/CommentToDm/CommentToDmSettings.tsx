import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, X, Plus, Save } from 'lucide-react';
import { Switch } from '@/app/components/ui/switch';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Label } from '@/app/components/ui/label';
import {
  getSettings,
  updateSettings,
  type CommentToDmSettings,
} from '@/api/domains/comment-to-dm';

interface Props {
  channelId: string;
}

export default function CommentToDmSettings({ channelId }: Props) {
  const { t } = useTranslation();

  const [settings, setSettings] = useState<CommentToDmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [postFilter, setPostFilter] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [postIdInput, setPostIdInput] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getSettings(channelId)
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setEnabled(s.commentToDmEnabled);
        setKeywords(s.commentToDmKeywords);
        setPostFilter(s.commentToDmPostFilter);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || t('commentToDm.settings.loadError', 'Failed to load settings'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [channelId, t]);

  function addKeyword() {
    const trimmed = keywordInput.trim().toLowerCase();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) {
      toast.warning(t('commentToDm.settings.keywordExists', 'Keyword already added'));
      return;
    }
    setKeywords((prev) => [...prev, trimmed]);
    setKeywordInput('');
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function addPostId() {
    const trimmed = postIdInput.trim();
    if (!trimmed) return;
    if (postFilter.includes(trimmed)) {
      toast.warning(t('commentToDm.settings.postIdExists', 'Post ID already added'));
      return;
    }
    setPostFilter((prev) => [...prev, trimmed]);
    setPostIdInput('');
  }

  function removePostId(pid: string) {
    setPostFilter((prev) => prev.filter((p) => p !== pid));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateSettings(channelId, {
        comment_to_dm_enabled:     enabled,
        comment_to_dm_keywords:    keywords,
        comment_to_dm_post_filter: postFilter,
      });
      setSettings(updated);
      toast.success(t('commentToDm.settings.saved', 'Settings saved'));
    } catch (err: any) {
      toast.error(err.message || t('commentToDm.settings.saveError', 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="font-medium">
            {t('commentToDm.settings.enableLabel', 'Comment-to-DM automation')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              'commentToDm.settings.enableDescription',
              'Automatically send a DM invite when customers comment with matching keywords'
            )}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {/* Keywords */}
      <div className="space-y-2">
        <Label>
          {t('commentToDm.settings.keywordsLabel', 'Trigger keywords')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t(
            'commentToDm.settings.keywordsDescription',
            'Comments containing any of these keywords will trigger the DM flow. Leave empty to match all comments.'
          )}
        </p>
        <div className="flex gap-2">
          <Input
            placeholder={t('commentToDm.settings.keywordPlaceholder', 'e.g. price, dam, buy')}
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
          />
          <Button type="button" variant="outline" size="icon" onClick={addKeyword}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {keywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="gap-1">
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  className="ml-1 rounded-full hover:text-destructive"
                  aria-label={t('commentToDm.settings.removeKeyword', 'Remove keyword') + ` ${kw}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Post filter */}
      <div className="space-y-2">
        <Label>
          {t('commentToDm.settings.postFilterLabel', 'Restrict to specific posts')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t(
            'commentToDm.settings.postFilterDescription',
            'Enter Facebook/Instagram post IDs to limit the flow to those posts only. Leave empty for all posts.'
          )}
        </p>
        <div className="flex gap-2">
          <Input
            placeholder={t('commentToDm.settings.postIdPlaceholder', 'Paste Post ID')}
            value={postIdInput}
            onChange={(e) => setPostIdInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPostId()}
          />
          <Button type="button" variant="outline" size="icon" onClick={addPostId}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {postFilter.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {postFilter.map((pid) => (
              <Badge key={pid} variant="outline" className="gap-1 font-mono text-xs">
                {pid}
                <button
                  type="button"
                  onClick={() => removePostId(pid)}
                  className="ml-1 rounded-full hover:text-destructive"
                  aria-label={t('commentToDm.settings.removePostId', 'Remove post ID') + ` ${pid}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('common.saving', 'Saving...')}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {t('common.saveChanges', 'Save changes')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
