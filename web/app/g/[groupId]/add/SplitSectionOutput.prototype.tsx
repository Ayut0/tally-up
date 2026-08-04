import type { SplitSectionResult } from "./split-section-shared.prototype";

/** PROTOTYPE for #141 — identical result display for both variants. */
export function SplitSectionOutput({ result }: { result: SplitSectionResult }) {
  return (
    <>
      {result.ruleError && (
        <p className="text-sm text-red-600 dark:text-red-400">{result.ruleError}</p>
      )}
      {result.previewRows && (
        <ul className="flex flex-col gap-1 rounded-lg bg-black/[.03] p-2 text-sm dark:bg-white/[.06]">
          {result.previewRows.map((row) => (
            <li key={row.id} className="flex items-center justify-between">
              <span className="text-zinc-700 dark:text-zinc-300">{row.name}</span>
              <span className="text-zinc-950 dark:text-zinc-50">{row.formattedShare}</span>
            </li>
          ))}
        </ul>
      )}
      <pre className="overflow-x-auto rounded-lg bg-black/[.03] p-2 text-xs text-zinc-500 dark:bg-white/[.06]">
        {JSON.stringify(result.rule, null, 2)}
      </pre>
    </>
  );
}
