import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Circle,
  Facebook,
  Package,
  RefreshCw,
  Store,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { SetupStatus, SetupTask, SetupTaskKey } from '@/api/types';

type FirstTimeSetupDashboardProps = {
  setupStatus: SetupStatus;
  onRefresh?: () => void | Promise<unknown>;
};

const iconByTask: Record<SetupTaskKey, LucideIcon> = {
  connect_channel: Facebook,
  shop_profile: Store,
  first_product: Package,
  ai_settings: Bot,
  starter_knowledge: BookOpen,
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

export default function FirstTimeSetupDashboard({ setupStatus, onRefresh }: FirstTimeSetupDashboardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const progressLabel = useMemo(
    () => t('dashboard.setup.progress', {
      completed: setupStatus.completedCount,
      total: setupStatus.totalCount,
    }),
    [setupStatus.completedCount, setupStatus.totalCount, t],
  );

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
            <p className="text-sm font-medium text-muted-foreground">{progressLabel}</p>
          </div>
          <span className="text-2xl font-black text-green-700">{setupStatus.progressPercent}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-green-600 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, setupStatus.progressPercent))}%` }}
          />
        </div>
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
