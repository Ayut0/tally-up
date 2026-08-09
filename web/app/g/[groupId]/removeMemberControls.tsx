/**
 * The "Remove" -> "Confirm remove?"/"Cancel" two-tap control for one row.
 * Pure props in, no knowledge of `useRemoveMember` or which list it's in —
 * any row-based confirm-before-destructive-action UI can reuse it.
 */
export function RemoveMemberControls({
  confirming,
  removing,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}: {
  confirming: boolean;
  removing: boolean;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onRequestRemove}
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        Remove
      </button>
    );
  }

  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        onClick={onConfirmRemove}
        disabled={removing}
        className="text-sm font-medium text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
      >
        {removing ? "Removing…" : "Confirm remove?"}
      </button>
      <button
        type="button"
        onClick={onCancelRemove}
        disabled={removing}
        className="text-sm text-zinc-500 hover:underline disabled:opacity-40 dark:text-zinc-400"
      >
        Cancel
      </button>
    </span>
  );
}
