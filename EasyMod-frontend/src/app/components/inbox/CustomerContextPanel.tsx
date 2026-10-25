/**
 * CustomerContextPanel — MW-V1 Phase 3 (docs 03/04).
 * Desktop persistent column / mobile sheet answering: who is this customer,
 * what happened, what's open right now. READ-ONLY here; ownership controls
 * live in the thread actions beside it. Every association is the verified
 * shop-scoped customer id from the conversation row — never a name.
 * Gated insights (relationship, RTO, opportunities) require the
 * customer_intelligence flag AND issue ZERO gated requests while it is off.
 * Stale per-conversation loads are aborted; failures degrade to honest
 * unavailable lines without touching the message workflow.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, StickyNote, Tags, X } from "lucide-react";
import { getPilotStatus, getCustomer360 } from "@/api/domains/customer-intelligence";
import { getOrders } from "@/api/domains/order";
import { listCustomerNotes, listCustomerTags } from "@/api/domains/customer-crm";
import type { Customer360Detail, CustomerState } from "@/api/types/customer-intelligence";
import type { CustomerNote, CustomerTag } from "@/api/types/crm";
import type { Conversation } from "@/api/types/conversation";
import type { Order } from "@/api/types/order";
import { formatMoney, formatRelative, initialOf, stateStyles } from "../customers/customerDisplay";
import { Badge } from "@/app/components/ui/badge";

const STATE_LABEL_KEYS: Record<CustomerState, string> = {
  NEW: "customer360.states.NEW",
  INTERESTED: "customer360.states.INTERESTED",
  BUYER: "customer360.states.BUYER",
  REPEAT_BUYER: "customer360.states.REPEAT_BUYER",
  AT_RISK: "customer360.states.AT_RISK",
  INACTIVE: "customer360.states.INACTIVE",
};

const RTO_LABEL_KEYS: Record<string, string> = {
  clear: "inbox.context.rto.clear",
  verify: "inbox.context.rto.verify",
  block: "inbox.context.rto.block",
};

type Section<T> = { status: "idle" | "loading" | "ready" | "error"; data: T | null };

interface Props {
  conversation: Conversation;
  onClose?: () => void;
}

export default function CustomerContextPanel({ conversation, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const customerId = conversation.customer_id ?? conversation.customer?.id ?? null;

  const [ciEnabled, setCiEnabled] = useState<boolean | null>(null);
  const [relationship, setRelationship] = useState<Section<Customer360Detail>>({ status: "idle", data: null });
  const [orders, setOrders] = useState<Section<Order[]>>({ status: "idle", data: null });
  const [notes, setNotes] = useState<Section<CustomerNote[]>>({ status: "idle", data: null });
  const [tags, setTags] = useState<Section<CustomerTag[]>>({ status: "idle", data: null });

  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const stale = () => requestId !== requestIdRef.current;

    // No-cache discipline: switching conversations resets before loading.
    setRelationship({ status: "idle", data: null });
    setOrders({ status: "idle", data: null });
    setNotes({ status: "idle", data: null });
    setTags({ status: "idle", data: null });

    void (async () => {
      let enabled = ciEnabled;
      if (enabled === null) {
        try {
          const status = await getPilotStatus();
          enabled = status.customer_intelligence;
        } catch { enabled = false; }
        if (stale() || controller.signal.aborted) return;
        setCiEnabled(enabled);
      }
      if (!customerId) return; // honest: unlinked conversation

      // Operations (always authorized for the shop; id-scoped)
      setOrders({ status: "loading", data: null });
      void getOrders({ customer_id: customerId, limit: 3 })
        .then((rows) => { if (!stale() && !controller.signal.aborted) setOrders({ status: "ready", data: rows ?? [] }); })
        .catch(() => { if (!stale()) setOrders({ status: "error", data: null }); });

      // CRM reads
      setNotes({ status: "loading", data: null });
      void listCustomerNotes(customerId, { limit: 3 })
        .then((page) => { if (!stale() && !controller.signal.aborted) setNotes({ status: "ready", data: page.data }); })
        .catch(() => { if (!stale()) setNotes({ status: "error", data: null }); });
      setTags({ status: "loading", data: null });
      void listCustomerTags(customerId)
        .then((page) => { if (!stale() && !controller.signal.aborted) setTags({ status: "ready", data: page.data }); })
        .catch(() => { if (!stale()) setTags({ status: "error", data: null }); });

      // Gated insights: NOT fetched while the platform flag is off.
      if (enabled) {
        setRelationship({ status: "loading", data: null });
        void getCustomer360(customerId)
          .then((detail) => { if (!stale() && !controller.signal.aborted) setRelationship({ status: "ready", data: detail }); })
          .catch(() => { if (!stale()) setRelationship({ status: "error", data: null }); });
      }
    })();

    return () => { controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, conversation.id]);

  const name = conversation.customer?.name || conversation.title || t("customer360.unknownName");

  return (
    <aside
      data-testid="customer-context-panel"
      aria-label={t("inbox.context.title")}
      className="w-full xl:w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 font-bn">{t("inbox.context.title")}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            data-testid="context-close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Identity — always basic-authorized */}
      <section aria-label={t("inbox.context.identity")}>
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700" aria-hidden="true">
            {initialOf(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900 font-bn">{name}</p>
            <p className="text-xs text-gray-500 font-bn">
              {conversation.channel}
              {conversation.metaChannel?.displayName ? ` · ${conversation.metaChannel.displayName}` : ""}
              {conversation.updated_at ? ` · ${formatRelative(conversation.updated_at, i18n.language)}` : ""}
            </p>
          </div>
        </div>
        {!customerId && (
          <p className="mt-2 text-xs text-gray-500 font-bn" data-testid="context-no-link">
            {t("inbox.context.noLink")}
          </p>
        )}
      </section>

      {customerId && ciEnabled && (
        <PanelSection label={t("inbox.context.relationship")} section={relationship} empty={null}>
          {(d) => (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge className={`${stateStyles[d.state]} text-[11px] font-bn`}>{t(STATE_LABEL_KEYS[d.state])}</Badge>
                {d.rto_signal?.available && (
                  <Badge variant="outline" className="text-[11px] font-bn">
                    {t(RTO_LABEL_KEYS[String(d.rto_signal.tier)] || "inbox.context.rto.clear")}
                  </Badge>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-1 text-xs text-gray-600">
                <dt className="font-bn">{t("inbox.context.deliveredOrders")}</dt>
                <dd className="text-right tabular-nums">{d.summary.delivered_orders ?? d.summary.total_orders ?? 0}</dd>
                <dt className="font-bn">{t("inbox.context.deliveredValue")}</dt>
                <dd className="text-right tabular-nums">{formatMoney(d.summary.delivered_value ?? 0, i18n.language)}</dd>
              </dl>
            </div>
          )}
        </PanelSection>
      )}

      {customerId && (
        <PanelSection label={t("inbox.context.operations")} section={orders} empty={t("inbox.context.noOrders")}>
          {(rows) => (
            <ul className="space-y-1.5">
              {rows.map((o) => (
                <li key={o.id} className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => navigate(`/orders?orderId=${encodeURIComponent(o.id)}`)}
                    className="min-w-0 flex-1 truncate text-left font-medium text-gray-900 hover:underline font-bn"
                    data-testid="context-order-row"
                  >
                    {o.orderNumber} <span className="text-gray-500 font-bn">· {o.status}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("inbox.context.openOrder")} ${o.orderNumber}`}
                    onClick={() => navigate(`/orders?orderId=${encodeURIComponent(o.id)}`)}
                    className="inline-flex items-center text-blue-700 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">{t("inbox.context.openOrder")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      )}

      {customerId && (
        <PanelSection label={t("inbox.context.notes")} section={notes} empty={t("inbox.context.notesEmpty")}>
          {(rows) => (
            <ul className="space-y-1.5">
              {rows.map((n) => (
                <li key={n.id} className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700 border border-gray-200">
                  <p className="whitespace-pre-line font-bn">{n.body}</p>
                  <p className="mt-1 text-[10px] text-gray-400 font-bn">
                    <StickyNote className="mr-1 inline h-3 w-3" aria-hidden="true" />
                    {n.author_name} · {n.created_at ? formatRelative(n.created_at, i18n.language) : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      )}

      {customerId && (
        <PanelSection label={t("inbox.context.tags")} section={tags} empty={t("inbox.context.tagsEmpty")}>
          {(rows) => (
            <div className="flex flex-wrap gap-1.5">
              {rows.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="text-[11px] font-bn">
                  <Tags className="mr-1 h-3 w-3" aria-hidden="true" />{tag.name}
                </Badge>
              ))}
            </div>
          )}
        </PanelSection>
      )}
    </aside>
  );
}

function PanelSection<T>({
  label, section, empty, children,
}: {
  label: string;
  section: Section<T>;
  empty: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={label} className="border-t border-gray-100 pt-3 first:border-0 first:pt-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 font-bn">{label}</h3>
      {section.status === "loading" && (
        <p className="text-xs text-gray-400 font-bn">{t("inbox.context.loading")}</p>
      )}
      {section.status === "error" && (
        <p className="text-xs text-gray-500 font-bn" data-testid="context-section-error">
          {t("inbox.context.unavailable")}
        </p>
      )}
      {section.status === "ready" && section.data && (
        Array.isArray(section.data)
          ? (section.data.length === 0 ? <p className="text-xs text-gray-400 font-bn">{empty}</p> : children(section.data))
          : children(section.data)
      )}
    </section>
  );
}
