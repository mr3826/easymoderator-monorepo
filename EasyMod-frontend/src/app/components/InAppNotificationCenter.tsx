import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getInAppNotifications, markInAppNotificationRead } from "@/api/domains/notification";
import type { OwnerNotification } from "@/api/types/notification";

function notificationTitle(notification: OwnerNotification) {
  return notification.customer_data?.title || notification.type.replace(/_/g, " ");
}

function notificationTime(notification: OwnerNotification) {
  const value = notification.created_at || notification.createdAt;
  if (!value) return "";
  return new Date(value).toLocaleString();
}

export default function InAppNotificationCenter() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);

  const unreadCount = useMemo(
    () => notifications.filter(notification => notification.status === "pending").length,
    [notifications]
  );

  const load = async () => {
    setLoading(true);
    try {
      setNotifications(await getInAppNotifications(10));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };

  const markRead = async (id: string) => {
    await markInAppNotificationRead(id);
    setNotifications(current => current.map(item => item.id === id ? { ...item, status: "completed" } : item));
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={toggle}
        className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">Notifications</div>
                <div className="text-xs text-gray-500">{unreadCount} unread</div>
              </div>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 && !loading ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">No notifications</div>
              ) : (
                notifications.map((notification) => {
                  const deepLink = notification.customer_data?.deepLink;
                  return (
                    <div key={notification.id} className="border-b border-gray-100 px-4 py-3 last:border-b-0">
                      <div className="flex items-start gap-3">
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.status === "pending" ? "bg-blue-600" : "bg-gray-300"}`} />
                        <div className="min-w-0 flex-1">
                          {deepLink ? (
                            <a href={String(deepLink)} className="block truncate text-sm font-semibold text-gray-900 hover:text-blue-600">
                              {notificationTitle(notification)}
                            </a>
                          ) : (
                            <div className="truncate text-sm font-semibold text-gray-900">{notificationTitle(notification)}</div>
                          )}
                          <p className="mt-1 line-clamp-2 text-xs text-gray-500">{notification.customer_message}</p>
                          <div className="mt-2 text-[11px] text-gray-400">{notificationTime(notification)}</div>
                        </div>
                        {notification.status === "pending" && (
                          <button
                            type="button"
                            aria-label="Mark notification read"
                            onClick={() => markRead(notification.id)}
                            className="rounded-md p-1 text-gray-400 hover:bg-gray-50 hover:text-emerald-600"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
