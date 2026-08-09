"use client";

import { Dialog } from "@/components/dialog";
import type { components } from "@/lib/api-types";
import { useAddMember, useRemoveMember } from "./useMemberActions";

type Member = components["schemas"]["Member"];

export function MemberList({ groupId, members }: { groupId: string; members: Member[] }) {
  const addForm = useAddMember(groupId);
  const remove = useRemoveMember(groupId);
  const confirmingMember = members.find((m) => m.id === remove.confirmingId) ?? null;
  const removingConfirmed = confirmingMember !== null && remove.isRemoving(confirmingMember.id);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Members</h2>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
          >
            <span className="text-base text-zinc-950 dark:text-zinc-50">{member.name}</span>
            <button
              type="button"
              onClick={() => remove.requestRemove(member.id)}
              className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={confirmingMember !== null}
        onClose={remove.cancelRemove}
        ariaLabel="Confirm remove member"
        dismissible={!removingConfirmed}
      >
        {confirmingMember && (
          <div className="flex flex-col gap-4">
            <p className="text-base text-zinc-950 dark:text-zinc-50">
              Remove <strong>{confirmingMember.name}</strong> from this group?
            </p>
            {remove.error && (
              <p className="text-sm text-red-600 dark:text-red-400">{remove.error}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={remove.cancelRemove}
                disabled={removingConfirmed}
                className="text-sm text-zinc-500 hover:underline disabled:opacity-40 dark:text-zinc-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => remove.confirmRemove(confirmingMember.id)}
                disabled={removingConfirmed}
                aria-label={`Remove ${confirmingMember.name}`}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {removingConfirmed ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      <form onSubmit={addForm.submit} className="flex gap-2">
        <input
          type="text"
          value={addForm.name}
          onChange={(e) => addForm.setName(e.target.value)}
          placeholder="Add a member"
          className="flex-1 rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
        />
        <button
          type="submit"
          disabled={addForm.submitting || addForm.name.trim() === ""}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
        >
          {addForm.submitting ? "Adding…" : "Add"}
        </button>
      </form>
      {addForm.error && <p className="text-sm text-red-600 dark:text-red-400">{addForm.error}</p>}
    </section>
  );
}
