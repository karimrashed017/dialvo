import type { Metadata } from "next";
import { Phone } from "lucide-react";
import { ComingPage } from "../_ui/coming";

export const metadata: Metadata = { title: "Calls" };

export default function CallsPage() {
  return (
    <ComingPage
      icon={Phone}
      title="Calls"
      lead="Every call your agents and reps make or take, with the recording, the transcript and a short summary."
      points={[
        "AI voice callbacks for leads who asked to be called, within a minute of the form.",
        "A dialer for your reps: who to call, why now, and what to say, with the research on screen.",
        "Recording, transcript and outcome on the lead's timeline, and a review queue for flagged calls.",
        "AI calls go only to people who asked or opted in. Cold calls are made by your reps.",
      ]}
      meanwhile={{
        text: "record who has agreed to be called on each lead's page, so the voice agent has people it may ring.",
        href: "/app/leads",
        action: "Open leads",
      }}
    />
  );
}
