"use client";

import { Modal as HeroModal } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * Curated wrapper over HeroUI's compound Modal (Root/Backdrop/Container/
 * Dialog/Body): this app only ever needs a single-surface confirm/form
 * dialog, so the 5-part composition collapses into one component. `isOpen`/
 * `onOpenChange` come straight from HeroUI's `Modal.Root` (built on
 * react-aria-components' `DialogTrigger`), replacing the native `<dialog>`
 * element's imperative `showModal()`/`close()` ref API this superseded.
 */
export function Modal({
  isOpen,
  onOpenChange,
  isDismissable,
  isKeyboardDismissDisabled,
  "aria-label": ariaLabel,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
  "aria-label": string;
  children: ReactNode;
}) {
  return (
    <HeroModal.Root isOpen={isOpen} onOpenChange={onOpenChange}>
      <HeroModal.Backdrop
        isDismissable={isDismissable}
        isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      >
        <HeroModal.Container>
          <HeroModal.Dialog aria-label={ariaLabel}>
            <HeroModal.Body>{children}</HeroModal.Body>
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Backdrop>
    </HeroModal.Root>
  );
}
