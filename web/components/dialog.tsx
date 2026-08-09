"use client";

import { forwardRef } from "react";

/**
 * Pure UI: a styled native `<dialog>` element and nothing else. It doesn't
 * decide when it's open, how it gets dismissed, or what happens when it
 * closes — all of that belongs to whoever holds the `ref` (`showModal()`/
 * `close()`) and wires up `<dialog>`'s own event props (`onClose`,
 * `onCancel`, `onClick`, `closedby`, ...) as needed. This component just
 * renders whatever it's given.
 */
export const Dialog = forwardRef<HTMLDialogElement, React.ComponentPropsWithoutRef<"dialog">>(
  function Dialog({ className, children, ...rest }, ref) {
    return (
      <dialog
        ref={ref}
        className={
          className ??
          "rounded-xl border border-black/[.08] bg-white p-6 text-zinc-950 backdrop:bg-black/50 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50"
        }
        {...rest}
      >
        {children}
      </dialog>
    );
  },
);
