"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, getGroup } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { JoinPicker } from "./join";

type Group = components["schemas"]["GroupRecord"];

/**
 * Scaffolding for #89: renders the join picker unconditionally so it (and
 * `web/lib/identity.ts`) can be hand-verified end to end. #90 replaces this
 * with the real group home page, which only shows the picker when this
 * browser has no identity set for the group yet.
 */
export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedMemberName, setPickedMemberName] = useState<string | null>(null);

  useEffect(() => {
    getGroup(groupId)
      .then(setGroup)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load group."));
  }, [groupId]);

  if (error) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!group) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  if (pickedMemberName) {
    return (
      <p className="p-6 text-base text-zinc-950 dark:text-zinc-50">
        Signed in as {pickedMemberName}. Reload the page to confirm it stuck.
      </p>
    );
  }

  return (
    <JoinPicker
      group={group}
      onPicked={(memberId) => {
        const member = group.members.find((m) => m.id === memberId);
        setPickedMemberName(member?.name ?? memberId);
      }}
    />
  );
}
