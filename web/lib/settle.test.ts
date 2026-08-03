import { describe, expect, it } from "vitest";
import { zCreateEntryRequest } from "./api-schemas/zod.gen";
import { settlementFor, transferKey } from "./settle";

const ALICE = "018f4c9e-0000-7000-8000-00000000000a";
const BOB = "018f4c9e-0000-7000-8000-00000000000b";
const CAROL = "018f4c9e-0000-7000-8000-00000000000c";
const ENTRY_ID = "018f4c9e-0000-7000-8000-000000000001";

const RECORD = { id: ENTRY_ID, requestedBy: ALICE, occurredOn: "2026-08-03" };

describe("settlementFor", () => {
  it("records the proposed amount exactly, paid by `from` to `to`", () => {
    const entry = settlementFor({ from: ALICE, to: BOB, amount: 4000 }, RECORD);

    expect(entry).toEqual({
      kind: "settlement",
      id: ENTRY_ID,
      requested_by: ALICE,
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
    const entry = settlementFor({ from: ALICE, to: BOB, amount: 3333 }, RECORD);

    expect(entry.total_amount).toBe(3333);
  });

  // #159's property: who paid and who recorded it are different facts, and
  // under #146 the second decides who may undo. Carol recording Bob's payment
  // to Alice must not attribute the entry to Bob.
  it("keeps requested_by independent of the transfer's payer", () => {
    const entry = settlementFor(
      { from: BOB, to: ALICE, amount: 4000 },
      { ...RECORD, requestedBy: CAROL },
    );

    expect(entry.requested_by).toBe(CAROL);
    expect(entry.payer_id).toBe(BOB);
  });

  // The payload is hand-built here but consumed by a generated contract, so
  // assert against that contract rather than a hand-written shape: a change to
  // SettlementEntry in spec/main.tsp then fails here, not in production.
  it("builds a payload the generated CreateEntryRequest schema accepts", () => {
    const entry = settlementFor({ from: ALICE, to: BOB, amount: 4000 }, RECORD);

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
