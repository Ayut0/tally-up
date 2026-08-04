"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const VARIANTS = ["asis", "rhf"] as const;
export type Variant = (typeof VARIANTS)[number];

const LABELS: Record<Variant, string> = {
  asis: "As-is — hand-rolled useState",
  rhf: "RHF — react-hook-form",
};

/** PROTOTYPE for #141 — floating switcher between the two split-section variants. Hidden in production builds. */
export function PrototypeVariantSwitcher({ variant }: { variant: Variant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: Variant) {
    const params = new URLSearchParams(searchParams);
    params.set("variant", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const index = VARIANTS.indexOf(variant);
      if (e.key === "ArrowLeft") go(VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length]!);
      if (e.key === "ArrowRight") go(VARIANTS[(index + 1) % VARIANTS.length]!);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, pathname, searchParams]);

  if (process.env.NODE_ENV === "production") return null;

  const index = VARIANTS.indexOf(variant);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-black/[.15] bg-background px-4 py-2 text-sm shadow-lg dark:border-white/[.2]">
      <button
        type="button"
        onClick={() => go(VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length]!)}
        aria-label="Previous variant"
      >
        ←
      </button>
      <span className="font-medium">
        {variant} — {LABELS[variant]}
      </span>
      <button
        type="button"
        onClick={() => go(VARIANTS[(index + 1) % VARIANTS.length]!)}
        aria-label="Next variant"
      >
        →
      </button>
    </div>
  );
}
