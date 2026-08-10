"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/textField";
import { Wordmark } from "@/components/ui/wordmark";
import { ApiError, createGroup } from "@/lib/api";
import { setIdentity } from "@/lib/identity";
import { generateUuidV7 } from "@/lib/uuidv7";

const MIN_MEMBERS = 1;
const MAX_MEMBERS = 20;
const INITIAL_MEMBER_ROWS = 5;

type MemberRow = { id: number; name: string };

// Falls back to "?" for a still-blank row, so a member's avatar never
// shifts the row's layout once a name is typed.
function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export default function Home() {
  const router = useRouter();
  const [groupName, setGroupName] = useState("");
  // A stable id per row (not the array index) keeps React's reconciliation
  // — and thus input focus — tied to the row itself when a middle row is removed.
  const [memberRows, setMemberRows] = useState<MemberRow[]>(() =>
    Array.from({ length: INITIAL_MEMBER_ROWS }, (_, i) => ({ id: i, name: "" })),
  );
  const nextRowId = useRef(INITIAL_MEMBER_ROWS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateMemberName(id: number, name: string) {
    setMemberRows((rows) => rows.map((row) => (row.id === id ? { ...row, name } : row)));
  }

  function addMember() {
    setMemberRows((rows) =>
      rows.length < MAX_MEMBERS ? [...rows, { id: nextRowId.current++, name: "" }] : rows,
    );
  }

  function removeMember(id: number) {
    setMemberRows((rows) =>
      rows.length > MIN_MEMBERS ? rows.filter((row) => row.id !== id) : rows,
    );
  }

  // Blank rows are silently dropped at submit time (see handleSubmit), so
  // submit only needs a group name and at least one real member name.
  const canSubmit =
    groupName.trim().length > 0 && memberRows.some((row) => row.name.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const groupId = generateUuidV7();
      const idempotencyKey = generateUuidV7();
      const names = memberRows.map((row) => row.name.trim()).filter((n) => n.length > 0);
      const group = await createGroup(groupId, groupName.trim(), names, idempotencyKey);
      // The server builds GroupRecord.members directly from member_names, in
      // order, so members[0] is always the creator (the first name typed).
      setIdentity(group.id, group.members[0]!.id);
      router.push(`/g/${group.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 justify-center bg-background px-[26px] pt-9 pb-[30px]">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[390px] flex-col gap-6">
        <Wordmark size="lg" />

        <Text variant="subhead">
          Split expenses with your group. No accounts, no installs — just a link.
        </Text>

        <TextField
          label="Group name"
          labelVariant="label"
          inputClassName="rounded-field border-[1.5px] border-ink/[.18] bg-surface px-4 py-[14px] text-[17px] font-semibold text-ink"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="e.g. Kyoto trip"
        />

        <div className="flex flex-col gap-2">
          <Text variant="label">Members — put yourself first</Text>
          <div className="flex flex-col gap-2">
            {memberRows.map((row, index) => (
              <div
                key={row.id}
                className="flex items-center gap-[10px] rounded-field border-[1.5px] border-ink/[.18] bg-surface px-[14px] py-3"
              >
                <Avatar memberId={String(index)} initial={avatarInitial(row.name)} size={30} />
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateMemberName(row.id, e.target.value)}
                  placeholder={`Member ${index + 1}`}
                  aria-label={`Member ${index + 1} name`}
                  className="flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-ink/[.4]"
                />
                {index === 0 && <Badge>YOU</Badge>}
                {index !== 0 && memberRows.length > MIN_MEMBERS && (
                  <button
                    type="button"
                    onClick={() => removeMember(row.id)}
                    aria-label={`Remove member ${index + 1}`}
                    className="text-ink/[.4] hover:text-ink/[.6]"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addMember}
            disabled={memberRows.length >= MAX_MEMBERS}
            className="flex items-center justify-center gap-2 rounded-field border-[1.5px] border-dashed border-ink/[.3] bg-transparent p-[13px] text-[14px] font-bold text-ink/[.6] disabled:opacity-30"
          >
            + add member
          </button>
        </div>

        {error && <Text variant="error">{error}</Text>}

        <Button type="submit" variant="solid" fullWidth disabled={!canSubmit || submitting}>
          {submitting ? "Creating…" : "Create group"}
        </Button>
      </form>
    </div>
  );
}
