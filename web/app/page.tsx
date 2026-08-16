"use client";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/textField";
import { Wordmark } from "@/components/ui/wordmark";
import { useCreateGroupForm } from "./useCreateGroupForm";

// Falls back to "?" for a still-blank row, so a member's avatar never
// shifts the row's layout once a name is typed.
function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export default function Home() {
  const form = useCreateGroupForm();

  return (
    <div className="flex flex-1 justify-center bg-background px-[26px] pt-9 pb-[30px]">
      <form onSubmit={form.handleSubmit} className="flex w-full max-w-[390px] flex-col gap-6">
        <Wordmark size="lg" />

        <Text variant="subhead">
          Split expenses with your group. No accounts, no installs — just a link.
        </Text>

        <TextField
          label="Group name"
          labelVariant="label"
          inputClassName="rounded-field border-[1.5px] border-ink/[.18] bg-surface px-4 py-[14px] text-[17px] font-semibold text-ink"
          value={form.groupName}
          onChange={(e) => form.setGroupName(e.target.value)}
          placeholder="e.g. Kyoto trip"
        />

        <div className="flex flex-col gap-2">
          <Text variant="label">Members — put yourself first</Text>
          <div className="flex flex-col gap-2">
            {form.memberRows.map((row, index) => (
              <div
                key={row.id}
                className="flex items-center gap-[10px] rounded-field border-[1.5px] border-ink/[.18] bg-surface px-[14px] py-3"
              >
                <Avatar memberId={String(row.id)} initial={avatarInitial(row.name)} size={30} />
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => form.updateMemberName(row.id, e.target.value)}
                  placeholder={`Member ${index + 1}`}
                  aria-label={`Member ${index + 1} name`}
                  className="flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-ink/[.4]"
                />
                {index === 0 && <Badge>YOU</Badge>}
                {index !== 0 && form.canRemoveMember && (
                  <button
                    type="button"
                    onClick={() => form.removeMember(row.id)}
                    aria-label={`Remove member ${index + 1}`}
                    className="text-ink/[.4] hover:text-ink/[.6]"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button variant="dashed" fullWidth onClick={form.addMember} disabled={!form.canAddMember}>
            + add member
          </Button>
        </div>

        {form.error && <Text variant="error">{form.error}</Text>}

        <Button
          type="submit"
          variant="solid"
          fullWidth
          disabled={!form.canSubmit || form.submitting}
        >
          {form.submitting ? "Creating…" : "Create group"}
        </Button>
      </form>
    </div>
  );
}
