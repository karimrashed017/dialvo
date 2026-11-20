import type { Metadata } from "next";
import Link from "next/link";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { siteViewport } from "../../_site/theme";
import { SignupForm } from "../forms";
import { AuthFrame, authLink, SetupNotice } from "../frame";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default function Signup() {
  if (!APP_CONFIGURED) return <SetupNotice />;
  return (
    <AuthFrame
      title="Create your account"
      intro="Set up your workspace in a couple of minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className={authLink}>
            Log in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthFrame>
  );
}
