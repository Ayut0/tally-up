"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useCopyInviteLink } from "./useCopyInviteLink";

/**
 * design-handoff.md Screen 03's invite banner — "this is the entire invite
 * mechanism, must be a tappable affordance, not just static text." The
 * empty-state variant (`#1h`) swaps the copy for outstanding-invites
 * framing; there's no backend signal for who has actually opened the link
 * (joining is a local, per-device choice, never reported to the server),
 * so it stays a generic nudge rather than a fabricated count.
 */
export function InviteBanner({ variant }: { variant: "default" | "empty" }) {
  const { copied, copy } = useCopyInviteLink();

  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-highlight px-4 py-[13px]">
      <Text variant="body" className="flex-1 text-[13px] font-semibold text-highlight-text">
        {variant === "empty" ? (
          "Friends haven't joined yet."
        ) : (
          <>
            Invite friends — this page&apos;s link <strong className="font-extrabold">is</strong>{" "}
            the invite.
          </>
        )}
      </Text>
      <Button variant="dark" onClick={copy}>
        {copied ? "Copied!" : "Copy link"}
      </Button>
    </div>
  );
}
