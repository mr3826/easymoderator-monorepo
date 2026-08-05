import { buildApiUrl } from "@/app/lib/config";

type PublicApiError = {
  message?: string;
  error?: { message?: string };
};

export async function publicApiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...options,
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & PublicApiError;
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || "Request failed");
  }
  return payload;
}

export function publicApiPost<T>(path: string, body: unknown): Promise<T> {
  return publicApiRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
}
