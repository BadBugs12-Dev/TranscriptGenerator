const API_BASE = "https://api.gumroad.com/v2";

function accessToken() {
  const value = process.env.GUMROAD_ACCESS_TOKEN;
  if (!value) throw new Error("Missing GUMROAD_ACCESS_TOKEN");
  return value;
}

async function gumroadGet<T>(path: string): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken());

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Gumroad API ${response.status}`);

  const body = (await response.json()) as T & { success?: boolean };
  if (body.success === false) throw new Error("Gumroad API request failed");
  return body;
}

export type GumroadSale = {
  id: string;
  created_at: string;
  product_permalink: string;
  product_name: string;
  email: string;
  price: number;
  currency: string;
  custom_fields?: Record<string, string>;
  subscription_id?: string | null;
  subscription_duration?: string | null;
  recurrence?: string | null;
  refunded?: boolean;
  disputed?: boolean;
  chargedback?: boolean;
  ended?: boolean;
  cancelled?: boolean;
};

export type GumroadSubscriber = {
  id: string;
  status: string;
  recurrence?: string | null;
  free_trial_ends_at?: string | null;
  cancelled_at?: string | null;
  ended_at?: string | null;
};

export async function getSale(id: string) {
  const body = await gumroadGet<{ success: boolean; sale: GumroadSale }>(`/sales/${encodeURIComponent(id)}`);
  return body.sale;
}

export async function getSubscriber(id: string) {
  const body = await gumroadGet<{ success: boolean; subscriber: GumroadSubscriber }>(
    `/subscribers/${encodeURIComponent(id)}`,
  );
  return body.subscriber;
}
