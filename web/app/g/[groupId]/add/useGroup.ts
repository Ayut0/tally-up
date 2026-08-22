"use client";

import { useQuery } from "@tanstack/react-query";
import { groupQueryOptions } from "@/lib/queries";

/**
 * Loads `groupId`'s members for the add-expense form. Shares
 * `groupQueryOptions` with `useGroupData`, so navigating here from the group
 * home shows the already-cached group instantly instead of a fresh loading
 * flash.
 */
export function useGroup(groupId: string) {
  const { data: group, error } = useQuery(groupQueryOptions(groupId));

  return { group, error: error?.message ?? null };
}
