import { describe, expect, it } from "vitest";
import { zCreateEntryRequest } from "./api-schemas/zod.gen";
import { settlementFor, transferKey } from "./settle";

const ALICE = "018f4c9e-0000-7000-8000-00000000000a";
const BOB = "018f4c9e-0000-7000-8000-00000000000b";
const ENTRY_ID = "018f4c9e-0000-7000-8000-000000000001";

describe("settlementFor", () => {
  it("records the proposed amount exactly, paid by `from` to `to`", () => {
    const entry = settlementFor({ from: ALICE, to: BOB, amount: 4000 }, ENTRY_ID, "2026-08-03");

    expect(entry).toEqual({
      kind: "settlement",
      id: ENTRY_ID,
      payer_id: ALICE,
      counterparty: BOB,
      total_amount: 4000,
      occurred_on: "2026-08-03",
    });
  });

  // Guards issue #147 from the other direction: no caller can round, cap, or
  // otherwise reinterpret the amount, because there is no path from a transfer
  // to a settlement that doesn't go through here.
  it("passes an odd amount through untouched", () => {
    const entry = settlementFor({ from: ALICE, to: BOB, amount: 3333 }, ENTRY_ID, "2026-08-03");

    expect(entry.total_amount).toBe(3333);
  });

  // The payload is hand-built here but consumed by a generated contract, so
  // assert against that contract rather than a hand-written shape: a change to
  // SettlementEntry in spec/main.tsp then fails here, not in production.
  it("builds a payload the generated CreateEntryRequest schema accepts", () => {
    const entry = settlementFor({ from: ALICE, to: BOB, amount: 4000 }, ENTRY_ID, "2026-08-03");

    expect(zCreateEntryRequest.safeParse(entry)).toMatchObject({ success: true });
  });
});

describe("transferKey", () => {
  it("is stable for the same transfer across two polls", () => {
    expect(transferKey({ from: ALICE, to: BOB, amount: 4000 })).toBe(
      transferKey({ from: ALICE, to: BOB, amount: 4000 }),
    );
  });

  // The plan is recomputed on every poll, so A -> B ¥4000 can come back as
  // A -> B ¥1500. That is a different proposal and must not inherit the first
  // one's retry intent (id + idempotency key), or confirming it would replay
  // the earlier settlement instead of recording this one.
  it("separates two transfers between the same pair that differ only in amount", () => {
    expect(transferKey({ from: ALICE, to: BOB, amount: 4000 })).not.toBe(
      transferKey({ from: ALICE, to: BOB, amount: 1500 }),
    );
  });

  it("separates the two directions of a transfer", () => {
    expect(transferKey({ from: ALICE, to: BOB, amount: 4000 })).not.toBe(
      transferKey({ from: BOB, to: ALICE, amount: 4000 }),
    );
  });
});
