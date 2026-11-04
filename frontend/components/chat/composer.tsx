"use client";

import { useState } from "react";
import { ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Enter sends, Shift+Enter adds a newline. The backend is single-turn, so earlier turns are not sent as context. */
export function Composer({ onSend }: { onSend: (q: string) => void }) {
  const [text, setText] = useState("");
  const q = text.trim();

  function send() {
    if (!q) return;
    onSend(q);
    setText("");
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send(); }}
      className="mx-auto flex w-full max-w-[720px] items-end gap-2 px-4 pt-2 pb-4"
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        maxLength={2000}
        rows={1}
        placeholder="Ask a new question…"
        aria-label="Question"
        className="max-h-[200px] min-h-9 resize-none bg-card text-[13px] [field-sizing:content]"
      />
      <Button type="submit" size="icon" disabled={!q} aria-label="Send question">
        <ArrowUpIcon />
      </Button>
    </form>
  );
}
