import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { ComingPage } from "../_ui/coming";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <ComingPage
      icon={BarChart3}
      title="Analytics"
      lead="One place to see what your agents did and what it led to: replies, qualified leads, meetings and sales."
      points={[
        "Conversations, replies and meetings over time, by channel, agent and play.",
        "Speed to first reply, and how many leads were answered within a minute.",
        "Conversion through the pipeline, from new lead to won.",
        "Email and call deliverability: placement, bounces, spam flags.",
      ]}
      meanwhile={{
        text: "the Today page counts today's conversations, qualified leads and meetings, and shows your pipeline, from real rows.",
        href: "/app",
        action: "Open Today",
      }}
    />
  );
}
