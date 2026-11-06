export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function csrf() {
  return (
    document.cookie
      .split("; ")
      .find((v) => v.startsWith("pf_csrf="))
      ?.split("=")[1] ?? ""
  );
}
let refreshing: Promise<Response> | null = null;
export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const send = () =>
    fetch(`/api/v1${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf(),
        ...options.headers,
      },
    });
  let response = await send();
  if (
    response.status === 401 &&
    retry &&
    !path.startsWith("/auth/login") &&
    !path.startsWith("/auth/register")
  ) {
    refreshing ??= fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrf() },
    }).finally(() => {
      refreshing = null;
    });
    if ((await refreshing).ok) response = await send();
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    const body = data as { error?: string | { message?: string | string[] } };
    const error =
      typeof body.error === "string" ? body.error : body.error?.message;
    throw new ApiError(
      Array.isArray(error) ? error.join(", ") : (error ?? "Request failed"),
      response.status,
    );
  }
  return data as T;
}
export const post = <T>(path: string, data: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
