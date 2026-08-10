import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { Wordmark } from "@/components/ui/wordmark";

const SWATCHES = [
  { label: "Background (canvas)", className: "bg-background" },
  { label: "Surface (cards/inputs)", className: "bg-surface border border-ink/[.12]" },
  { label: "Ink", className: "bg-ink" },
  { label: "Accent", className: "bg-accent" },
  { label: "Accent, pressed", className: "bg-accent-pressed" },
  { label: "Highlight", className: "bg-highlight" },
  { label: "Positive", className: "bg-positive" },
  { label: "Negative", className: "bg-negative" },
];

const MEMBERS = [
  { id: "018f4c9e-0000-7000-8000-000000000001", initial: "Y" },
  { id: "018f4c9e-0000-7000-8000-000000000002", initial: "A" },
  { id: "018f4c9e-0000-7000-8000-000000000003", initial: "K" },
  { id: "018f4c9e-0000-7000-8000-000000000004", initial: "M" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Text variant="label">{title}</Text>
      {children}
    </section>
  );
}

/**
 * Dev-only demo of every design-handoff.md token and shared primitive
 * (issue #50's AC), rendered at the mockups' 390px mobile baseline —
 * compare side-by-side against docs/design/tally-up-mockups.html.
 */
export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="flex justify-center bg-background px-6 py-10">
      <div className="flex w-[390px] flex-col gap-8">
        <Wordmark size="lg" />

        <Section title="Colors">
          <div className="grid grid-cols-2 gap-3">
            {SWATCHES.map((swatch) => (
              <div key={swatch.label} className="flex flex-col gap-1">
                <div className={`h-12 rounded-lg ${swatch.className}`} />
                <Text variant="muted">{swatch.label}</Text>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <div className="flex flex-col gap-2">
            <p className="text-[26px] font-extrabold tracking-[-.02em]">Karla 800</p>
            <p className="text-lg font-bold">Karla 700</p>
            <p className="text-base font-semibold">Karla 600</p>
            <p className="text-base font-medium">Karla 500</p>
            <p className="text-base font-normal">Karla 400</p>
            <p className="font-mono text-lg font-bold tabular-nums">¥8,000 · Jul 16</p>
          </div>
        </Section>

        <Section title="Wordmark">
          <div className="flex items-center gap-6">
            <Wordmark size="lg" />
            <Wordmark size="sm" />
          </div>
        </Section>

        <Section title="Primary button">
          <Button variant="solid">Create group</Button>
        </Section>

        <Section title="Card">
          <Card>
            <div className="p-4">
              <Text variant="body">Onsen tickets</Text>
            </div>
          </Card>
        </Section>

        <Section title="Avatars">
          <div className="flex gap-3">
            {MEMBERS.map((member) => (
              <Avatar key={member.id} memberId={member.id} initial={member.initial} />
            ))}
          </div>
        </Section>

        <Section title="Pill badge">
          <Badge>YOU</Badge>
        </Section>
      </div>
    </div>
  );
}
