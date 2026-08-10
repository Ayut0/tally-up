"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
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
      <Text variant="heading">Who are you?</Text>
      <ul className="flex flex-col gap-2">
        {group.members.map((member) => (
          <li key={member.id}>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setIdentity(group.id, member.id);
                onPicked(member.id);
              }}
            >
              {member.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
