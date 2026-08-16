import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateUuidV7, mintIntent } from "./uuidv7";

describe("generateUuidV7", () => {
  it("produces a well-formed UUID with version 7 and variant bits set", () => {
    const id = generateUuidV7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("never repeats across 1000 calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUuidV7()));
    expect(ids.size).toBe(1000);
  });

  describe("time ordering", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("sorts ids in mint order across distinct timestamps", () => {
      vi.setSystemTime(1_000_000_000_000);
      const earlier = generateUuidV7();
      vi.setSystemTime(1_000_000_000_001);
      const later = generateUuidV7();
      expect(earlier < later).toBe(true);
    });
  });
});

describe("mintIntent", () => {
  it("returns a distinct id and idempotency key, both well-formed UUIDv7s", () => {
    const { id, key } = mintIntent();
    const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(id).toMatch(v7);
    expect(key).toMatch(v7);
    expect(id).not.toBe(key);
  });
});
