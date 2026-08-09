"use client";

import { useEffect, useRef } from "react";

/**
 * A generic modal dialog wrapping the native `<dialog>` element — open/close
 * state is driven entirely by `open`/`onClose`; callers render whatever
 * content they want as children, with no assumption about confirm/cancel or
 * any other interaction shape.
 *
 * `showModal()`/`close()` give native top-layer stacking and focus trapping
 * for free. `closedby="any"` adds light-dismiss (backdrop click, `Esc`)
 * where supported (Chrome/Edge/Firefox); Safari doesn't support `closedby`
 * yet, so the click listener below is its fallback for backdrop-click
 * dismiss — `Esc` already works natively for any modal `<dialog>`
 * regardless of `closedby` support.
 *
 * `dismissible` (default `true`) gates all of that: while `false`,
 * `closedby="none"` blocks backdrop-click at the browser level in
 * supporting browsers (and the Safari click fallback below is a no-op),
 * and the `cancel`-blocking effect below stops `Esc` everywhere —
 * `<dialog>` fires a cancelable `cancel` event on `Esc` regardless of
 * `closedby` support, so `preventDefault()`ing it is the one mechanism
 * that covers every browser uniformly (harmless where `closedby="none"`
 * already suppresses it). Together these leave only the caller's own
 * `dialog.close()` — driven by `open` — as a way to close it. A caller
 * mid-async-action (e.g. a pending mutation whose result still needs
 * somewhere to render) sets this to `false` so a stray `Esc`/backdrop
 * click can't close the dialog out from under it: the native close would
 * desync from `open` (which the caller may deliberately not be changing
 * yet), leaving content orphaned in a dialog nothing can reopen.
 */
export function Dialog({
  open,
  onClose,
  children,
  ariaLabel,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !dismissible || "closedBy" in HTMLDialogElement.prototype) return;

    function closeOnBackdropClick(event: MouseEvent) {
      // Clicking dialog content also targets the <dialog> itself once the
      // event bubbles past it, so this only fires on genuine backdrop
      // clicks if we additionally check the click landed outside the
      // dialog's own content box.
      if (event.target !== dialog) return;
      const rect = dialog!.getBoundingClientRect();
      const insideContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!insideContent) dialog!.close();
    }

    dialog.addEventListener("click", closeOnBackdropClick);
    return () => dialog.removeEventListener("click", closeOnBackdropClick);
  }, [dismissible]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dismissible) return;

    function blockCancel(event: Event) {
      event.preventDefault();
    }

    dialog.addEventListener("cancel", blockCancel);
    return () => dialog.removeEventListener("cancel", blockCancel);
  }, [dismissible]);

  return (
    <dialog
      ref={ref}
      closedby={dismissible ? "any" : "none"}
      aria-label={ariaLabel}
      onClose={onClose}
      className="rounded-xl border border-black/[.08] bg-white p-6 text-zinc-950 backdrop:bg-black/50 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50"
    >
      {children}
    </dialog>
  );
}
