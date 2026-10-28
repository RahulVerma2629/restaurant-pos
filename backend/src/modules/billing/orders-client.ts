// Talks to the Orders module (Python, port 8000). Billing reads the order from there instead of trusting prices
// sent by the browser, and tells Orders when the order is billed, paid and closed.
// Orders uses snake_case and numeric ids; this file converts them to the camelCase shapes Billing uses.

export interface OrderLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
}

export interface OrderSummary {
  id: number;
  branchId: number;
  orderType: string;
  status: string;
  paymentStatus: string;
  mergedIntoOrderId: number | null;
  lines: OrderLine[];
}

export class OrdersApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RawItem {
  menu_item_id: number;
  name: string;
  qty: number;
  status: string;
  line_total: number;
}

interface RawOrder {
  id: number;
  branch_id: number;
  order_type: string;
  status: string;
  payment_status: string;
  merged_into_order_id: number | null;
  items: RawItem[];
}

export interface OrdersClient {
  readonly enabled: boolean;
  getOrder(token: string, orderId: string): Promise<OrderSummary>;
  setStatus(token: string, orderId: string, status: string, reason?: string): Promise<void>;
  setPaymentStatus(token: string, orderId: string, paymentStatus: string): Promise<void>;
}

export function createOrdersClient(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): OrdersClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function call(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(`${root}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new OrdersApiError(503, "ORDERS_UNAVAILABLE", "Cannot reach the Orders module");
    }

    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new OrdersApiError(
        response.status,
        err?.code ?? "ORDERS_API_ERROR",
        err?.message ?? `Orders module answered ${response.status}`,
      );
    }
    return json;
  }

  return {
    enabled: root.length > 0,

    async getOrder(token, orderId) {
      const raw = (await call(token, "GET", `/orders/${encodeURIComponent(orderId)}`)) as RawOrder;
      const lines: OrderLine[] = raw.items
        .filter((item) => item.status !== "cancelled")
        .map((item) => ({
          menuItemId: String(item.menu_item_id),
          name: item.name,
          quantity: item.qty,
          // line_total already includes modifiers, so the unit price is the exact share of one piece
          unitPricePaise: Math.round(item.line_total / item.qty),
        }));
      return {
        id: raw.id,
        branchId: raw.branch_id,
        orderType: raw.order_type,
        status: raw.status,
        paymentStatus: raw.payment_status,
        mergedIntoOrderId: raw.merged_into_order_id,
        lines,
      };
    },

    async setStatus(token, orderId, status, reason) {
      await call(token, "POST", `/orders/${encodeURIComponent(orderId)}/status`, {
        status,
        ...(reason ? { reason } : {}),
      });
    },

    async setPaymentStatus(token, orderId, paymentStatus) {
      await call(token, "PATCH", `/orders/${encodeURIComponent(orderId)}/payment-status`, {
        payment_status: paymentStatus,
      });
    },
  };
}

// A client that does nothing, used when ORDERS_API_URL is not set (Billing running on its own).
export const disabledOrdersClient: OrdersClient = {
  enabled: false,
  async getOrder() {
    throw new OrdersApiError(503, "ORDERS_NOT_CONFIGURED", "ORDERS_API_URL is not set");
  },
  async setStatus() {},
  async setPaymentStatus() {},
};
