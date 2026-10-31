import type { Order } from "@/api/types/order";

/** Courier booking is available only after a merchant confirms an order. */
export function canBookCourierForOrder(
  order: Pick<Order, "status" | "delivery_tracking_code" | "delivery_consignment_id">,
) {
  return (
    (order.status === "confirmed" || order.status === "processing")
    && !order.delivery_tracking_code
    && !order.delivery_consignment_id
  );
}
