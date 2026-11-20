import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, PageHead } from "../_ui/kit";
import { BeingBuilt } from "../plays/ui";

export const metadata: Metadata = { title: "Calls" };

// Voice isn't built: no phone provider is connected. This page says what it
// will do, and shows no call logs, because there are none.

export default function CallsPage() {
  return (
    <>
      <PageHead
        title="Calls"
        note="Calls aren't running yet. Nothing on this page is made up: when calls work, real ones will show here."
      />
      <div className="space-y-3">
        <BeingBuilt
          title="AI phone agent"
          what="An agent that answers your calls and calls back new leads who asked to be called, from your Knowledge, with a recording and a summary on the lead. It hands the call to a person whenever someone asks for one."
          needs={[
            "A phone provider for numbers and calls (a paid service the founder chooses)",
            "A number for your business",
          ]}
        />
        <BeingBuilt
          title="Consented outbound calling and the dialer"
          what="Calls only to people who agreed to be called (consent is already recorded on each lead), inside the hours you set, and a dialer for your team to call from a list with notes saved on the lead."
          needs={[
            "The same phone provider",
            "Caller ID and number health checks for each number",
          ]}
          more={
            <Link
              href="/#voice-demo"
              className={cn(btn.secondary, btn.small, "w-fit")}
            >
              Hear the voice demo on the website
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          }
        />
      </div>
    </>
  );
}
