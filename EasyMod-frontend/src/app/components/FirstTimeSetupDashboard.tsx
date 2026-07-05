import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Facebook,
  MessageCircle,
  Package,
  RefreshCw,
  Sparkles,
  Store,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { SetupStatus, SetupTask, SetupTaskKey } from '@/api/types';

type FirstTimeSetupDashboardProps = {
  setupStatus: SetupStatus;
  onRefresh?: () => void | Promise<unknown>;
  onDismissCompletion?: () => void;
  storageKeyPrefix?: string;
};

const iconByTask: Record<SetupTaskKey, LucideIcon> = {
  connect_channel: Facebook,
  shop_profile: Store,
  first_product: Package,
  ai_settings: MessageCircle,
};

function getTaskTone(task: SetupTask) {
  if (task.status === 'complete') {
    return {
      border: 'border-green-200',
      background: 'bg-green-50',
      icon: 'text-green-700',
      badge: 'bg-green-100 text-green-800',
    };
  }

  return {
    border: 'border-border',
    background: 'bg-card',
    icon: 'text-gray-700',
    badge: 'bg-amber-100 text-amber-800',
  };
}

function stringList(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

export default function FirstTimeSetupDashboard({
  setupStatus,
  onRefresh,
  onDismissCompletion,
  storageKeyPrefix = 'easymod:business-setup',
}: FirstTimeSetupDashboardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const welcomeStartedKey = `${storageKeyPrefix}:started`;
  const [hasStarted, setHasStarted] = useState(() => {
    if (setupStatus.completedCount > 0 || setupStatus.isComplete) return true;
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(welcomeStartedKey) === '1';
  });

  useEffect(() => {
    if (setupStatus.completedCount > 0 || setupStatus.isComplete) {
      setHasStarted(true);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(welcomeStartedKey, '1');
      }
    }
  }, [setupStatus.completedCount, setupStatus.isComplete, welcomeStartedKey]);

  const progressLabel = useMemo(
    () => t('dashboard.setup.progress', {
      completed: setupStatus.completedCount,
      total: setupStatus.totalCount,
    }),
    [setupStatus.completedCount, setupStatus.totalCount, t],
  );

  const readinessLabel = useMemo(() => {
    if (setupStatus.progressPercent >= 100) return t('dashboard.setup.progressReady');
    if (setupStatus.totalCount - setupStatus.completedCount === 1) return t('dashboard.setup.progressOneLeft');
    if (setupStatus.progressPercent >= 75) return t('dashboard.setup.progressAlmostReady');
    return t('dashboard.setup.progressPercent', { percent: setupStatus.progressPercent });
  }, [setupStatus.completedCount, setupStatus.progressPercent, setupStatus.totalCount, t]);

  const handleStartSetup = () => {
    setHasStarted(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(welcomeStartedKey, '1');
    }
  };
  const welcomeBullets = stringList(t('dashboard.setup.welcomeBullets', { returnObjects: true }), [
    'Connect Facebook',
    'Add Products',
    'Configure Replies',
    'Get ready to receive orders',
  ]);
  const completeBullets = stringList(t('dashboard.setup.completeBullets', { returnObjects: true }), [
    'Reply to customers',
    'Recommend products',
    'Capture orders',
    'Reduce manual work',
  ]);

  if (!setupStatus.isComplete && !hasStarted) {
    return (
      <div className="min-h-full bg-background p-4 md:p-6">
        <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-4xl items-center">
          <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-bold text-green-700">
              <Sparkles className="h-4 w-4" />
              {t('dashboard.setup.welcomeEyebrow')}
            </div>
            <h1 className="text-3xl font-black text-foreground md:text-4xl">
              {t('dashboard.setup.welcomeTitle')}
            </h1>
            <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-muted-foreground">
              {t('dashboard.setup.welcomeSubtitle')}
            </p>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {welcomeBullets.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" />
                  <span className="text-sm font-semibold text-gray-700">{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-muted-foreground">
                {t('dashboard.setup.estimatedTime')}
              </p>
              <button
                type="button"
                onClick={handleStartSetup}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-green-700"
              >
                {t('dashboard.setup.startCta')}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (setupStatus.isComplete) {
    return (
      <div className="min-h-full bg-background p-4 md:p-6">
        <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-4xl items-center">
          <div className="w-full rounded-2xl border border-green-200 bg-card p-6 shadow-sm md:p-8">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 text-green-700">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <p className="text-sm font-bold uppercase tracking-normal text-green-700">
              {t('dashboard.setup.completeEyebrow')}
            </p>
            <h1 className="mt-2 text-3xl font-black text-foreground md:text-4xl">
              {t('dashboard.setup.completeTitle')}
            </h1>
            <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-muted-foreground">
              {t('dashboard.setup.completeSubtitle')}
            </p>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {completeBullets.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-green-100 bg-green-50 p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" />
                  <span className="text-sm font-semibold text-green-900">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onDismissCompletion}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-green-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-green-700"
              >
                {t('dashboard.setup.goToDashboard')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDismissCompletion?.();
                  navigate('/app/manage-shop/business-info');
                }}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-gray-50"
              >
                {t('dashboard.setup.reviewReplySettings')}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="mb-1 text-sm font-bold uppercase tracking-normal text-green-700">
            {t('dashboard.setup.eyebrow')}
          </p>
          <h1 className="text-2xl font-black text-foreground md:text-3xl">
            {t('dashboard.setup.title')}
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-muted-foreground md:text-base">
            {t('dashboard.setup.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh?.()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          {t('dashboard.setup.refresh')}
        </button>
      </header>

      <section className="mb-5 rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-bold text-card-foreground">{t('dashboard.setup.progressTitle')}</h2>
            <p className="text-sm font-medium text-muted-foreground">{readinessLabel}</p>
          </div>
          <span className="text-2xl font-black text-green-700">{setupStatus.progressPercent}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-green-600 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, setupStatus.progressPercent))}%` }}
          />
        </div>
        <p className="mt-2 text-xs font-semibold text-muted-foreground">{progressLabel}</p>
      </section>

      <section className="grid gap-3">
        {setupStatus.tasks.map((task) => {
          const Icon = iconByTask[task.key];
          const tone = getTaskTone(task);
          const isComplete = task.status === 'complete';
          const StatusIcon = isComplete ? CheckCircle2 : Circle;

          return (
            <article
              key={task.key}
              className={`rounded-lg border ${tone.border} ${tone.background} p-4`}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
                    <Icon className={`h-5 w-5 ${tone.icon}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-card-foreground">
                        {t(`dashboard.setup.tasks.${task.key}.title`, { defaultValue: task.title })}
                      </h3>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${tone.badge}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {isComplete ? t('dashboard.setup.complete') : t('dashboard.setup.incomplete')}
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-6 text-muted-foreground">
                      {t(`dashboard.setup.tasks.${task.key}.description`, { defaultValue: task.description })}
                    </p>
                    {!isComplete && task.missing.length > 0 && (
                      <p className="mt-2 text-sm font-semibold text-amber-800">
                        {t('dashboard.setup.missingPrefix')}{' '}
                        {task.missing
                          .map((key) => t(`dashboard.setup.missing.${key}`, { defaultValue: key.replace(/_/g, ' ') }))
                          .join(', ')}
                      </p>
                    )}
                    {task.warnings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {task.warnings.map((warning) => (
                          <p key={warning.code} className="flex gap-2 text-sm font-semibold text-amber-800">
                            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>
                              {t(`dashboard.setup.warnings.${warning.code}`, { defaultValue: warning.message })}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate(task.href)}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-bold text-white"
                >
                  {t(`dashboard.setup.tasks.${task.key}.cta`, { defaultValue: task.ctaLabel })}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-base font-black text-amber-950">{t('dashboard.setup.noteTitle')}</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-amber-900">
          {t('dashboard.setup.noteBody')}
        </p>
      </section>
    </div>
  );
}
