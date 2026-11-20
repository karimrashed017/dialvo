import type { Metadata } from "next";
import Link from "next/link";
import { googleLoginEnabled } from "@/lib/auth/providers";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { siteViewport } from "../../_site/theme";
import { SignupForm } from "../forms";
import { AuthFrame, authLink, SetupNotice } from "../frame";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default async function Signup() {
  if (!APP_CONFIGURED) return <SetupNotice />;
  const google = await googleLoginEnabled();
  return (
    <AuthFrame
      title="Create your account"
      intro="Set up your workspace in a couple of minutes."
      points={[
        "Free until an agent books your first meeting",
        "No card needed to start",
        "Agents stay off until you switch them on",
      ]}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className={authLink}>
            Log in
          </Link>
        </>
      }
    >
      <SignupForm google={google} />
    </AuthFrame>
  );
}
