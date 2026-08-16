import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createGroup } from "@/lib/api";
import { setIdentity } from "@/lib/identity";
import { mintIntent } from "@/lib/uuidv7";

const MIN_MEMBERS = 1;
const MAX_MEMBERS = 20;
const INITIAL_MEMBER_ROWS = 5;

export type MemberRow = { id: number; name: string };

export function useCreateGroupForm() {
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
  const submissionRef = useRef<{ id: string; key: string; signature: string } | null>(null);

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
  const canAddMember = memberRows.length < MAX_MEMBERS;
  const canRemoveMember = memberRows.length > MIN_MEMBERS;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const name = groupName.trim();
      const names = memberRows.map((row) => row.name.trim()).filter((n) => n.length > 0);
      // What the server's idempotency gate compares a replay's payload
      // against. Reuse the same {id, key} only when this is a retry of the
      // exact same intent; if the user edited the form after a failed
      // attempt, that's a new intent and needs fresh ids, or the server
      // rejects the same key replayed with a different payload as a 422.
      const signature = JSON.stringify({ name, memberNames: names });
      if (submissionRef.current?.signature !== signature) {
        submissionRef.current = { ...mintIntent(), signature };
      }
      const { id, key } = submissionRef.current;

      const group = await createGroup(id, name, names, key);
      // The server builds GroupRecord.members directly from member_names, in
      // order, so members[0] is always the creator (the first name typed).
      setIdentity(group.id, group.members[0]!.id);
      router.push(`/g/${group.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return {
    groupName,
    setGroupName,
    memberRows,
    updateMemberName,
    addMember,
    removeMember,
    canSubmit,
    canAddMember,
    canRemoveMember,
    submitting,
    error,
    handleSubmit,
  };
}
