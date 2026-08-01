"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getGroup } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];

/**
 * Loads `groupId`'s members for the add-expense form. Same query key as
 * `useGroupData`'s group query, so navigating here from the group home
 * shows the already-cached group instantly instead of a fresh loading flash.
 */
export function useGroup(groupId: string) {
  const { data: group, error } = useQuery<GroupRecord, ApiError>({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  return { group, error: error?.message ?? null };
}
