"use client";

import type { components } from "@/lib/api-types";
import { useAddMember, useRemoveMember } from "./useMemberActions";

type Member = components["schemas"]["Member"];

export function MemberList({ groupId, members }: { groupId: string; members: Member[] }) {
  const addForm = useAddMember(groupId);
  const remove = useRemoveMember(groupId);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Members</h2>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-col gap-1 rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
          >
            <div className="flex items-center justify-between">
              <span className="text-base text-zinc-950 dark:text-zinc-50">{member.name}</span>
              {remove.confirmingId === member.id ? (
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => remove.confirmRemove(member.id)}
                    disabled={remove.isRemoving(member.id)}
                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
                  >
                    {remove.isRemoving(member.id) ? "Removing…" : "Confirm remove?"}
                  </button>
                  <button
                    type="button"
                    onClick={remove.cancelRemove}
                    disabled={remove.isRemoving(member.id)}
                    className="text-sm text-zinc-500 hover:underline disabled:opacity-40 dark:text-zinc-400"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => remove.requestRemove(member.id)}
                  className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
                >
                  Remove
                </button>
              )}
            </div>
            {remove.confirmingId === member.id && remove.error && (
              <p className="text-sm text-red-600 dark:text-red-400">{remove.error}</p>
            )}
          </li>
        ))}
      </ul>

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
