"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/textField";
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
      <Text variant="section-heading">Members</Text>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
          >
            <Text variant="body">{member.name}</Text>
            <Button variant="ghost" onClick={() => remove.requestRemove(member.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <Modal {...remove.modalProps} aria-label="Confirm remove member">
        {confirmingMember && (
          <div className="flex flex-col gap-4">
            <Text variant="body">
              Remove <strong>{confirmingMember.name}</strong> from this group?
            </Text>
            {remove.error && <Text variant="error">{remove.error}</Text>}
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={remove.cancelRemove} disabled={removingConfirmed}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => remove.confirmRemove(confirmingMember.id)}
                disabled={removingConfirmed}
                aria-label={`Remove ${confirmingMember.name}`}
              >
                {removingConfirmed ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <form onSubmit={addForm.submit} className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label="Add a member"
            value={addForm.name}
            onChange={(e) => addForm.setName(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="solid"
          disabled={addForm.submitting || addForm.name.trim() === ""}
        >
          {addForm.submitting ? "Adding…" : "Add"}
        </Button>
      </form>
      {addForm.error && <Text variant="error">{addForm.error}</Text>}
    </section>
  );
}
