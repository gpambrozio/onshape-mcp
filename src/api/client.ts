/** HTTP client for the Onshape REST API.
 *
 * Derived from onshape-cli (MIT, see NOTICE), with the credentials replaced by a
 * pluggable AuthProvider so the same client serves API keys and OAuth tokens,
 * and with the Authorization header withheld from redirects that leave the
 * Onshape domain (Onshape hands out presigned S3 URLs that need no auth). */

import { setTimeout as sleep } from "node:timers/promises";

import type { AuthProvider } from "../auth/provider.js";

const READ_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_READ_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_REDIRECTS = 5;

/** Onshape has no default timeout of its own; without this a throttled
 *  connection hangs the tool call forever. Override with ONSHAPE_TIMEOUT_MS. */
const REQUEST_TIMEOUT_MS = Number(process.env.ONSHAPE_TIMEOUT_MS) || 120_000;

const JSON_ACCEPT = "application/json;charset=UTF-8; qs=0.09";

export type QueryParams = Record<string, string | number | boolean | undefined>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export interface BinaryResponse {
  buffer: Buffer;
  contentType: string;
  status: number;
}

export class OnshapeClient {
  constructor(private readonly auth: AuthProvider) {}

  get baseUrl(): string {
    return this.auth.baseUrl;
  }

  async get(path: string, params?: QueryParams): Promise<unknown> {
    return this.requestJson(this.url(path, params));
  }

  async post(path: string, data?: unknown): Promise<unknown> {
    const response = await this.fetchWithAuth(
      this.url(path),
      { Accept: JSON_ACCEPT, "Content-Type": JSON_ACCEPT },
      "POST",
      data === undefined ? undefined : JSON.stringify(data),
    );
    if (!response.ok) throw new HttpError(response.status, await responseDetail(response));
    return responseJsonOrStatus(response, "ok");
  }

  async delete(path: string): Promise<unknown> {
    const response = await this.fetchWithAuth(this.url(path), { Accept: JSON_ACCEPT }, "DELETE");
    if (!response.ok) throw new HttpError(response.status, await responseDetail(response));
    return responseJsonOrStatus(response, "deleted");
  }

  /** Raw bytes — an STL, a STEP file, a thumbnail PNG. */
  async getBinary(path: string, params?: QueryParams, accept = "*/*"): Promise<BinaryResponse> {
    return this.binary(this.url(path, params), accept);
  }

  /** Raw bytes from an already-resolved absolute URL (thumbnail hrefs). */
  async getBinaryUrl(href: string, accept = "*/*"): Promise<BinaryResponse> {
    return this.binary(new URL(href), accept);
  }

  private url(path: string, params?: QueryParams): URL {
    const url = new URL(path, this.auth.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async binary(url: URL, accept: string): Promise<BinaryResponse> {
    const response = await this.fetchWithAuth(url, { Accept: accept });
    if (!response.ok) throw new HttpError(response.status, await responseDetail(response));
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "",
      status: response.status,
    };
  }

  /** Reads are retried: Onshape throttles bursts with 429 and regenerates
   *  geometry behind 5xx while a document is busy. */
  private async requestJson(url: URL): Promise<unknown> {
    for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
      const response = await this.fetchWithAuth(url, { Accept: JSON_ACCEPT });
      if (response.ok) return response.json();
      if (!READ_RETRY_STATUSES.has(response.status) || attempt === MAX_READ_ATTEMPTS) {
        throw new HttpError(response.status, await responseDetail(response));
      }
      await sleep(retryDelayMs(response, attempt));
    }
    throw new Error("unreachable read retry state");
  }

  private async fetchWithAuth(
    url: URL,
    headers: Record<string, string>,
    method = "GET",
    body?: string,
  ): Promise<Response> {
    const response = await this.followRedirects(url, headers, method, body);
    if (response.status !== 401) return response;
    // An OAuth access token can expire mid-session; refresh once and retry.
    if (!(await this.auth.recover())) return response;
    return this.followRedirects(url, headers, method, body);
  }

  private async followRedirects(
    url: URL,
    headers: Record<string, string>,
    method: string,
    body?: string,
  ): Promise<Response> {
    const authorization = await this.auth.header();
    const origin = new URL(this.auth.baseUrl);
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const requestHeaders: Record<string, string> = { ...headers };
      // Onshape redirects between its own regional stacks (auth must survive the
      // hop) and out to presigned S3 URLs (auth must not leak off-domain).
      if (sameSite(current, origin)) requestHeaders.Authorization = authorization;

      const response = await fetch(current, {
        method,
        body,
        headers: requestHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current);
    }
    throw new Error(`Too many redirects (${MAX_REDIRECTS}) starting at ${url.href}`);
  }
}

/** Same host, or a subdomain of the API host's registrable domain. */
function sameSite(target: URL, origin: URL): boolean {
  if (target.hostname === origin.hostname) return true;
  const parts = origin.hostname.split(".");
  const domain = parts.length > 2 ? parts.slice(-2).join(".") : origin.hostname;
  return target.hostname === domain || target.hostname.endsWith(`.${domain}`);
}

async function responseDetail(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 1000);
  }
}

async function responseJsonOrStatus(response: Response, key: string): Promise<unknown> {
  const text = await response.text();
  if (!text) return { [key]: true, status: response.status };
  try {
    return JSON.parse(text);
  } catch {
    return { [key]: true, status: response.status, text: text.slice(0, 500) };
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_DELAY_MS);
  }
  return Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}
