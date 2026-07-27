import type { components } from "./api-types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
  const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
  return body.error;
}

export async function postIdempotent<T>(path: string, body: unknown, key: string): Promise<T> {
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
      return (await res.json()) as T;
    }

    if (res.status === 409) {
      if (inFlightAttempt >= MAX_IN_FLIGHT_RETRIES) {
        throw new ApiError(res.status, await readErrorMessage(res));
      }
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

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res));
  }
  return (await res.json()) as T;
}

export function getGroup(groupId: string): Promise<components["schemas"]["GroupRecord"]> {
  return getJSON(`/groups/${groupId}`);
}

export function getBalance(groupId: string): Promise<components["schemas"]["BalanceSnapshot"]> {
  return getJSON(`/groups/${groupId}/balance`);
}

export function listEntries(
  groupId: string,
  afterSeq?: number,
): Promise<components["schemas"]["EntryList"]> {
  const query = afterSeq === undefined ? "" : `?after_seq=${afterSeq}`;
  return getJSON(`/groups/${groupId}/entries${query}`);
}

export function createGroup(
  id: string,
  name: string,
  memberNames: string[],
  key: string,
): Promise<components["schemas"]["GroupRecord"]> {
  const body: components["schemas"]["CreateGroupRequest"] = { id, name, member_names: memberNames };
  return postIdempotent("/groups", body, key);
}

export function addEntry(
  groupId: string,
  entry: components["schemas"]["CreateEntryRequest"],
  key: string,
): Promise<components["schemas"]["EntryAck"]> {
  return postIdempotent(`/groups/${groupId}/entries`, entry, key);
}
