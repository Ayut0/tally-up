"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { components } from "@/lib/api-types";
import { setIdentity } from "@/lib/identity";

export type Group = components["schemas"]["GroupRecord"];

/**
 * The invite-link "join" flow: pick your name from the group's member list.
 * Tapping a member sets this browser's identity for `group.id` and hands
 * the picked member id to the caller, which decides what to do next.
 * Styled to design-handoff.md §2 (panel #1b).
 */
export function JoinPicker({
  group,
  onPicked,
}: {
  group: Group;
  onPicked: (memberId: string) => void;
}) {
  return (
    <div className="flex flex-1 justify-center bg-background px-[26px] pt-11 pb-9">
      <div className="flex w-full max-w-[390px] flex-col gap-2">
        <Text variant="label" className="font-mono text-[12px] tracking-[.1em] text-accent">
          You&apos;re invited
        </Text>
        <Text
          variant="heading"
          className="mb-[6px] text-[30px] font-extrabold tracking-[-.02em] text-ink"
        >
          {group.name}
        </Text>
        <Text variant="subhead" className="mb-5 text-[16px] font-semibold text-ink/[.65]">
          Who are you? Pick your name once — this phone will remember.
        </Text>
        <ul className="flex flex-col gap-3">
          {group.members.map((member) => (
            <li key={member.id}>
              <Button
                variant="row"
                fullWidth
                onClick={() => {
                  setIdentity(group.id, member.id);
                  onPicked(member.id);
                }}
              >
                <Avatar
                  memberId={member.id}
                  initial={member.name.trim().charAt(0).toUpperCase()}
                  size={38}
                />
                <Text variant="body" className="flex-1 text-left text-[18px] font-bold text-ink">
                  {member.name}
                </Text>
                <Text variant="body" className="font-mono text-[18px] text-ink/[.35]">
                  ›
                </Text>
              </Button>
            </li>
          ))}
        </ul>
        <Text
          variant="muted"
          className="mt-[18px] text-center text-[12.5px] font-medium text-ink/[.45]"
        >
          Not on the list? Ask whoever made the group to add you.
        </Text>
      </div>
    </div>
  );
}
