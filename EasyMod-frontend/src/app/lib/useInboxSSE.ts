import { useEffect, useRef } from 'react';
import { authService } from './auth';
import config from './config';
import { normalizeApiBaseUrl } from '@/api';
import type { Message } from '@/api/types/conversation';

interface SSECallbacks {
    onNewMessage: (data: { conversation_id: string; message: Message }) => void;
    onHitlChanged: (data: { conversation_id: string; hitl: boolean }) => void;
    onDeliveryFailed?: (data: { conversation_id: string; reason: string }) => void;
    onChannelError?: (data: { type: string; page_id: string; display_name: string; message: string }) => void;
    onSSEOffline?: () => void;
    onSSEOnline?: () => void;
}

/**
 * Opens a Server-Sent Events connection to /conversation/events for the
 * current shop. Calls the provided callbacks whenever the backend emits
 * a new_message or hitl_changed event.
 *
 * Reconnects automatically with exponential back-off (1s → 30s cap) on error.
 * Cookies are sent automatically by EventSource (withCredentials: true).
 */
export function useInboxSSE({ onNewMessage, onHitlChanged, onDeliveryFailed, onChannelError, onSSEOffline, onSSEOnline }: SSECallbacks): void {
    // Keep callbacks in a ref so reconnects always use the latest closures
    const callbacksRef = useRef<SSECallbacks>({ onNewMessage, onHitlChanged, onDeliveryFailed, onChannelError, onSSEOffline, onSSEOnline });
    callbacksRef.current = { onNewMessage, onHitlChanged, onDeliveryFailed, onChannelError, onSSEOffline, onSSEOnline };

    const shopId = authService.getCurrentShopId();

    useEffect(() => {
        if (!shopId) return;

        let es: EventSource | null = null;
        let retryTimeout: ReturnType<typeof setTimeout> | null = null;
        let retryDelay = 1000;
        let destroyed = false;

        function connect() {
            if (destroyed) return;

            const apiOrigin = config.apiBaseUrl.startsWith('http') ? normalizeApiBaseUrl(config.apiBaseUrl) : '';
            const url = `${apiOrigin}/api/conversation/events?shop_id=${encodeURIComponent(shopId)}`;
            es = new EventSource(url, { withCredentials: true });

            es.addEventListener('new_message', (e: MessageEvent) => {
                try {
                    callbacksRef.current.onNewMessage(JSON.parse(e.data));
                } catch (e) {
                    console.error('[useInboxSSE] Failed to parse SSE event data:', e);
                }
            });

            es.addEventListener('hitl_changed', (e: MessageEvent) => {
                try {
                    callbacksRef.current.onHitlChanged(JSON.parse(e.data));
                } catch (e) {
                    console.error('[useInboxSSE] Failed to parse SSE event data:', e);
                }
            });

            es.addEventListener('delivery_failed', (e: MessageEvent) => {
                try {
                    callbacksRef.current.onDeliveryFailed?.(JSON.parse(e.data));
                } catch (e) {
                    console.error('[useInboxSSE] Failed to parse SSE event data:', e);
                }
            });

            es.addEventListener('channel_error', (e: MessageEvent) => {
                try {
                    callbacksRef.current.onChannelError?.(JSON.parse(e.data));
                } catch (e) {
                    console.error('[useInboxSSE] Failed to parse SSE event data:', e);
                }
            });

            es.onopen = () => {
                retryDelay = 1000; // reset back-off on successful connect
                callbacksRef.current.onSSEOnline?.();
            };

            es.onerror = () => {
                console.error('[useInboxSSE] SSE connection error — will retry in', retryDelay, 'ms');
                callbacksRef.current.onSSEOffline?.();
                es?.close();
                es = null;
                if (destroyed) return;
                retryTimeout = setTimeout(() => {
                    retryDelay = Math.min(retryDelay * 2, 30000);
                    connect();
                }, retryDelay);
            };
        }

        connect();

        return () => {
            destroyed = true;
            if (retryTimeout) clearTimeout(retryTimeout);
            es?.close();
        };
    }, [shopId]); // re-run when shop changes so the SSE channel targets the right shop
}
