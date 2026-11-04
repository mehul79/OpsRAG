"use client";

import ReactMarkdown from "react-markdown";

/** Renders the streamed answer. `[n]` becomes a citation chip that selects source n. Tokens are never animated. */
export function Answer({ text, sourceCount, onCite }: { text: string; sourceCount: number; onCite: (n: number) => void }) {
  // [1] -> markdown link to #cite-1, rendered below as a chip button
  const withCites = text.replace(/\[(\d+)\]/g, (m, n) => (+n >= 1 && +n <= sourceCount ? `[${n}](#cite-${n})` : m));
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[1.65] [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[12px] [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const n = /^#cite-(\d+)$/.exec(href ?? "")?.[1];
            return n ? (
              <button
                type="button"
                onClick={() => onCite(+n)}
                aria-label={`Show source ${n}`}
                className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-[color-mix(in_oklab,var(--signal)_12%,transparent)] px-1 align-baseline font-mono text-[11px] leading-none text-signal tabular-nums hover:bg-[color-mix(in_oklab,var(--signal)_18%,transparent)]"
              >
                {n}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {children}
              </a>
            );
          },
        }}
      >
        {withCites}
      </ReactMarkdown>
    </div>
  );
}
