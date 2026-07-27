import type { z } from "zod";
import type { components } from "./api-types";
import {
  balanceSnapshotSchema,
  entryAckSchema,
  entryListSchema,
  errorBodySchema,
  groupRecordSchema,
} from "./api-schemas";

/** Thrown for any non-2xx response, or once postIdempotent's retries are exhausted (status 0). */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Prefixes `path` with `NEXT_PUBLIC_API_URL`, defaulting to the Go server's dev address. */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  return `${base}${path}`;
}

const RETRY_BACKOFF_MS = [300, 900, 2700];
const IN_FLIGHT_RETRY_MS = 500;
const MAX_IN_FLIGHT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorMessage(res: Response): Promise<string> {
  const raw = await res.json().catch(() => ({ error: res.statusText }));
  const parsed = errorBodySchema.safeParse(raw);
  return parsed.success ? parsed.data.error : res.statusText;
}

/** Parses `res`'s body against `schema`, wrapping a validation failure in `ApiError` too — every failure mode this file exposes is one type. */
async function parseBody<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError(res.status, `response failed contract validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * POSTs with an `Idempotency-Key` header, per the client contract in
 * docs/architecture.md §4: a network error or 5xx retries up to 3 times on
 * the SAME key (300/900/2700ms backoff); a 409 (another request with this
 * key is in flight) retries up to 3 times at a fixed 500ms; any other 4xx
 * throws immediately, since a replayed key with a different payload is a
 * client bug, not a flake. The response body is validated against `schema`
 * at runtime rather than merely asserted, since `Response.json()` gives no
 * static guarantee it matches T.
 */
export async function postIdempotent<T>(
  path: string,
  body: unknown,
  key: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let attempt = 0;
  let inFlightAttempt = 0;

  for (;;) {
    let res: Response;
    try {
      res = await fetch(apiUrl(path), {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt >= RETRY_BACKOFF_MS.length) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ApiError(0, message);
      }
      await sleep(RETRY_BACKOFF_MS[attempt]!);
      attempt++;
      continue;
    }

    if (res.status === 200 || res.status === 201) {
      return parseBody(res, schema);
    }

    if (res.status === 409 && inFlightAttempt >= MAX_IN_FLIGHT_RETRIES) {
      throw new ApiError(res.status, await readErrorMessage(res));
    }
    if (res.status === 409) {
      await sleep(IN_FLIGHT_RETRY_MS);
      inFlightAttempt++;
      continue;
    }

    if (res.status >= 500 && attempt < RETRY_BACKOFF_MS.length) {
      await sleep(RETRY_BACKOFF_MS[attempt]!);
      attempt++;
      continue;
    }

    throw new ApiError(res.status, await readErrorMessage(res));
  }
}

async function getJSON<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res));
  }
  return parseBody(res, schema);
}

/** Fetches a group and its members. */
export function getGroup(groupId: string): Promise<components["schemas"]["GroupRecord"]> {
  return getJSON(`/groups/${groupId}`, groupRecordSchema);
}

/** Fetches every member's current balance, plus the ledger seq those balances reflect. */
export function getBalance(groupId: string): Promise<components["schemas"]["BalanceSnapshot"]> {
  return getJSON(`/groups/${groupId}/balance`, balanceSnapshotSchema);
}

/** Pages the ledger in seq order; pass the highest seq seen as `afterSeq` to poll for new entries. */
export function listEntries(
  groupId: string,
  afterSeq?: number,
): Promise<components["schemas"]["EntryList"]> {
  const query = typeof afterSeq === "number" ? `?after_seq=${afterSeq}` : "";
  return getJSON(`/groups/${groupId}/entries${query}`, entryListSchema);
}

/** Creates a group and its initial members in one idempotent call. */
export function createGroup(
  id: string,
  name: string,
  memberNames: string[],
  key: string,
): Promise<components["schemas"]["GroupRecord"]> {
  const body: components["schemas"]["CreateGroupRequest"] = { id, name, member_names: memberNames };
  return postIdempotent("/groups", body, key, groupRecordSchema);
}

/** Records an expense or settlement entry idempotently. */
export function addEntry(
  groupId: string,
  entry: components["schemas"]["CreateEntryRequest"],
  key: string,
): Promise<components["schemas"]["EntryAck"]> {
  return postIdempotent(`/groups/${groupId}/entries`, entry, key, entryAckSchema);
}
