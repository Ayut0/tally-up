"use client";

import { useEffect, useState } from "react";
import { ApiError, getGroup } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];

/** Fetch-once hook: loads `groupId`'s members for the add-expense form. */
export function useGroup(groupId: string) {
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGroup(groupId)
      .then((g) => {
        if (!cancelled) setGroup(g);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load group.");
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return { group, error };
}
