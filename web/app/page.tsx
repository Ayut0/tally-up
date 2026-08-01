"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createGroup } from "@/lib/api";
import { setIdentity } from "@/lib/identity";
import { generateUuidV7 } from "@/lib/uuidv7";

const MIN_MEMBERS = 1;
const MAX_MEMBERS = 20;
const INITIAL_MEMBER_ROWS = 5;

type MemberRow = { id: number; name: string };

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
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Start a new tab</h1>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Group name</span>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="e.g. Kyoto trip"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Members</span>
          {memberRows.map((row, index) => (
            <div key={row.id} className="flex gap-2">
              <input
                type="text"
                value={row.name}
                onChange={(e) => updateMemberName(row.id, e.target.value)}
                placeholder={`Member ${index + 1}`}
                aria-label={`Member ${index + 1} name`}
                className="flex-1 rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
              />
              <button
                type="button"
                onClick={() => removeMember(row.id)}
                disabled={memberRows.length <= MIN_MEMBERS}
                className="rounded-lg border border-black/[.08] px-3 text-zinc-500 disabled:opacity-30 dark:border-white/[.145]"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addMember}
            disabled={memberRows.length >= MAX_MEMBERS}
            className="self-start text-sm font-medium text-zinc-700 hover:underline disabled:opacity-30 dark:text-zinc-300"
          >
            + add member
          </button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="bg-foreground text-background rounded-full px-5 py-3 text-base font-medium transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
        >
          {submitting ? "Creating…" : "Create group"}
        </button>
      </form>
    </div>
  );
}
