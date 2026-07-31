import { afterEach, describe, expect, it } from "vitest";
import { getIdentity, setIdentity } from "./identity";

describe("identity", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns null for a group with no stored identity", () => {
    expect(getIdentity("group-1")).toBeNull();
  });

  it("round-trips an identity for a group", () => {
    setIdentity("group-1", "member-1");
    expect(getIdentity("group-1")).toBe("member-1");
  });

  it("stores identities independently per group", () => {
    setIdentity("group-1", "member-1");
    setIdentity("group-2", "member-2");

    expect(getIdentity("group-1")).toBe("member-1");
    expect(getIdentity("group-2")).toBe("member-2");
  });
});
