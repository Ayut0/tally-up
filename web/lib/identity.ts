function storageKey(groupId: string): string {
  return `tallyup:member:${groupId}`;
}

/** The member picked for `groupId` in this browser, or null if none was picked yet (docs/architecture.md §2). */
export function getIdentity(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey(groupId));
}

/** Remembers `memberId` as "who I am" in `groupId`, in this browser only. */
export function setIdentity(groupId: string, memberId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(groupId), memberId);
}
