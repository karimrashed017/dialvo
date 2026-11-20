import type { Metadata } from "next";
import { ListTree } from "lucide-react";
import { ComingPage } from "../_ui/coming";

export const metadata: Metadata = { title: "Sequences" };

export default function SequencesPage() {
  return (
    <ComingPage
      icon={ListTree}
      title="Sequences"
      lead="Multi-step outreach across email, social and rep-led calls, where each touch knows what the last one said."
      points={[
        "A builder for steps, timing and channels, with branches on opens, clicks and replies.",
        "One researched message per person, written from your knowledge base, with a preview before anything sends.",
        "Send limits and send windows per inbox; unsubscribes honoured at once.",
        "Replies sorted and answered, with the sensitive ones handed to you.",
      ]}
      meanwhile={{
        text: "import the leads you'll want to reach, and write your outbound agent's instructions.",
        href: "/app/leads/import",
        action: "Import leads",
      }}
    />
  );
}
