/**
 * A destructive (or otherwise risky) action gated by two taps instead of a
 * native `confirm()` dialog: the first tap reveals confirm/cancel, the
 * second actually acts. Not scoped to any one feature — any row- or
 * button-level "are you sure?" UI can reuse it; the caller owns all state
 * (`confirming`/`pending`) and wiring (`onRequest`/`onConfirm`/`onCancel`).
 */
export function TwoTapConfirm({
  confirming,
  pending,
  actionLabel,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  onRequest,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  pending: boolean;
  actionLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onRequest}
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        {actionLabel}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="text-sm font-medium text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
      >
        {pending ? pendingLabel : confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="text-sm text-zinc-500 hover:underline disabled:opacity-40 dark:text-zinc-400"
      >
        {cancelLabel}
      </button>
    </span>
  );
}
