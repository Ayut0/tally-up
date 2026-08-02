"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError, addEntry } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { EntryKind } from "@/lib/entry";
import { getIdentity } from "@/lib/identity";
import { SplitMode, buildSplitRule, previewShares } from "@/lib/split";
import { generateUuidV7 } from "@/lib/uuidv7";
import { useGroup } from "./useGroup";

type GroupRecord = components["schemas"]["GroupRecord"];
type SplitRule = components["schemas"]["SplitRule"];

const SPLIT_TABS: { mode: SplitRule["type"]; label: string }[] = [
  { mode: SplitMode.Equal, label: "Equal" },
  { mode: SplitMode.Exact, label: "Exact" },
  { mode: SplitMode.Shares, label: "Shares" },
  { mode: SplitMode.Percent, label: "Percent" },
];

export default function AddExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, error: groupError } = useGroup(groupId);

  if (groupError) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{groupError}</p>;
  }
  if (!group) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  return <AddExpenseForm groupId={groupId} group={group} />;
}

/**
 * Only ever mounts once `group` is loaded, so its defaults (payer,
 * participants) can come straight from lazy useState initializers reading
 * `group` directly — no effect needed to "apply defaults once they arrive".
 */
function AddExpenseForm({ groupId, group }: { groupId: string; group: GroupRecord }) {
  const router = useRouter();

  const [payerId, setPayerId] = useState(() => getIdentity(groupId) ?? group.members[0]?.id ?? "");
  const [participants, setParticipants] = useState<Set<string>>(
    () => new Set(group.members.map((m) => m.id)),
  );

  const [totalInput, setTotalInput] = useState("");
  const [mode, setMode] = useState<SplitRule["type"]>(SplitMode.Equal);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [memo, setMemo] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionRef = useRef<{ id: string; key: string; signature: string } | null>(null);

  const participantsArray = [...participants];
  const total = Number(totalInput);
  const totalValid = totalInput.trim() !== "" && Number.isInteger(total) && total > 0;
  const result = buildSplitRule(mode, participantsArray, {
    total: totalValid ? total : undefined,
    amounts,
    weights,
  });
  const ruleError = result.isValid ? null : result.error;
  const preview =
    result.isValid && totalValid ? previewShares(total, result.rule, participantsArray) : null;
  const canSubmit = payerId !== "" && participantsArray.length > 0 && totalValid && result.isValid;

  function toggleParticipant(memberId: string) {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.isValid || !totalValid || payerId === "" || participantsArray.length === 0) return;
    if (submitting) return;

    // Everything but `id` — the part the server's idempotency gate compares
    // a replay's payload against. Reuse the same {id, key} only when this is
    // a retry of the exact same intent; if the user edited the form after a
    // failed attempt, that's a new intent and needs fresh ids, or the server
    // rejects the same key replayed with a different payload as a 422.
    const payload = {
      payer_id: payerId,
      // Who is submitting this form, not who paid — may differ from
      // payerId, which the user can change. Falls back to payerId if this
      // browser has no remembered identity in the group.
      requested_by: getIdentity(groupId) ?? payerId,
      total_amount: total,
      memo: memo.trim() || undefined,
      occurred_on: occurredOn,
      split_rule: result.rule,
      participants: participantsArray,
    };
    const signature = JSON.stringify(payload);
    if (submissionRef.current?.signature !== signature) {
      submissionRef.current = { id: generateUuidV7(), key: generateUuidV7(), signature };
    }
    const { id, key } = submissionRef.current;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const entry: components["schemas"]["ExpenseEntry"] = {
        kind: EntryKind.Expense,
        id,
        ...payload,
      };
      await addEntry(groupId, entry, key);
      router.push(`/g/${groupId}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Add expense</h1>
        <Link
          href={`/g/${groupId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Paid by</span>
          <select
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          >
            {group.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Total (¥)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={totalInput}
            onChange={(e) => setTotalInput(e.target.value)}
            placeholder="0"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Participants</span>
          <ul className="flex flex-col gap-1">
            {group.members.map((member) => (
              <li key={member.id}>
                <label className="flex items-center gap-2 text-base text-zinc-950 dark:text-zinc-50">
                  <input
                    type="checkbox"
                    checked={participants.has(member.id)}
                    onChange={() => toggleParticipant(member.id)}
                  />
                  {member.name}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Split</span>
          <div className="flex gap-1 rounded-lg border border-black/[.08] p-1 dark:border-white/[.145]">
            {SPLIT_TABS.map((tab) => (
              <button
                key={tab.mode}
                type="button"
                onClick={() => setMode(tab.mode)}
                className={`flex-1 rounded-md px-2 py-1 text-sm font-medium transition-colors ${
                  mode === tab.mode
                    ? "bg-foreground text-background"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === SplitMode.Exact && (
            <ul className="flex flex-col gap-1">
              {participantsArray.map((memberId) => (
                <li key={memberId} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-zinc-950 dark:text-zinc-50">
                    {group.members.find((m) => m.id === memberId)?.name ?? memberId}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={amounts[memberId] ?? ""}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [memberId]: Number(e.target.value) }))
                    }
                    className="w-24 rounded-lg border border-black/[.08] px-3 py-1 text-base dark:border-white/[.145] dark:bg-black"
                  />
                </li>
              ))}
            </ul>
          )}

          {(mode === SplitMode.Shares || mode === SplitMode.Percent) && (
            <ul className="flex flex-col gap-1">
              {participantsArray.map((memberId) => (
                <li key={memberId} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-zinc-950 dark:text-zinc-50">
                    {group.members.find((m) => m.id === memberId)?.name ?? memberId}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={weights[memberId] ?? ""}
                    onChange={(e) =>
                      setWeights((prev) => ({ ...prev, [memberId]: Number(e.target.value) }))
                    }
                    className="w-24 rounded-lg border border-black/[.08] px-3 py-1 text-base dark:border-white/[.145] dark:bg-black"
                  />
                </li>
              ))}
            </ul>
          )}

          {ruleError && <p className="text-sm text-red-600 dark:text-red-400">{ruleError}</p>}

          {preview && (
            <ul className="flex flex-col gap-1 rounded-lg bg-black/[.03] p-2 text-sm dark:bg-white/[.06]">
              {participantsArray.map((memberId) => (
                <li key={memberId} className="flex items-center justify-between">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {group.members.find((m) => m.id === memberId)?.name ?? memberId}
                  </span>
                  <span className="text-zinc-950 dark:text-zinc-50">
                    ¥{(preview[memberId] ?? 0).toLocaleString("ja-JP")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Memo (optional)
          </span>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. dinner"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Date</span>
          <input
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="rounded-full bg-foreground px-5 py-3 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
        >
          {submitting ? "Adding…" : "Add expense"}
        </button>
      </form>
    </div>
  );
}
