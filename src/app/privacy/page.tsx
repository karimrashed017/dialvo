import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site";
import { LegalPage } from "../_legal/legal-page";

export { viewport } from "../_legal/legal-page";

export const metadata: Metadata = pageMetadata({
  title: "Privacy · Dialvo",
  description:
    "How Dialvo, the AI sales team, handles the information you give us and the calls and messages its agents handle for you. A draft while Dialvo is in early access.",
  path: "/privacy",
});

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="19 November 2026">
      <h2>What we collect</h2>
      <p>
        When you email us for early access, we keep your email and whatever you
        tell us about your business. Our site counts page visits without cookies
        and without identifying you.
      </p>
      <h2>Calls and messages</h2>
      <p>
        Once Dialvo makes calls and sends messages for you, it records and
        transcribes calls and keeps the messages, so you can review them. Every
        call says it&apos;s an AI and that it&apos;s recorded. We keep a log of
        opt-outs so nobody who asked to stop is contacted again.
      </p>
      <h2>The live voice demo</h2>
      <p>
        The voice demo on our home page only starts when you press the button
        and allow your microphone. While you talk, your voice and what you say
        are processed by ElevenLabs, which runs the voice agent, and by the AI
        model provider it uses, so the agent can answer. We don&apos;t record
        the call or keep a transcript, and we&apos;ve set ElevenLabs not to save
        the audio and to delete the transcript. To stop one visitor using up the
        demo, we count how many calls came from your address for a day and keep
        that count in a cookie on your device. Please don&apos;t share personal
        or payment details in the demo.
      </p>
      <h2>How we use it</h2>
      <ul>
        <li>To run Dialvo for you and support you.</li>
        <li>To email you about your account and early access.</li>
        <li>To keep Dialvo safe and within calling rules.</li>
      </ul>
      <p>We don&apos;t sell your information.</p>
      <h2>Who we share it with</h2>
      <p>
        Only the services we need to run Dialvo, such as hosting, our database
        and the phone and messaging providers that carry calls and texts. A full
        list will be published here before launch.
      </p>
      <h2>Your choices</h2>
      <p>
        You can ask to see, correct or delete your information at any time by
        emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
