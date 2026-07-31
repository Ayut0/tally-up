"use client";

import type { components } from "@/lib/api-types";
import { setIdentity } from "@/lib/identity";

export type Group = components["schemas"]["GroupRecord"];

/**
 * The invite-link "join" flow: pick your name from the group's member list.
 * Tapping a member sets this browser's identity for `group.id` and hands
 * the picked member id to the caller, which decides what to do next.
 */
export function JoinPicker({
  group,
  onPicked,
}: {
  group: Group;
  onPicked: (memberId: string) => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Who are you?</h1>
      <ul className="flex flex-col gap-2">
        {group.members.map((member) => (
          <li key={member.id}>
            <button
              type="button"
              onClick={() => {
                setIdentity(group.id, member.id);
                onPicked(member.id);
              }}
              className="w-full rounded-lg border border-black/[.08] px-4 py-3 text-left text-base font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.06]"
            >
              {member.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
