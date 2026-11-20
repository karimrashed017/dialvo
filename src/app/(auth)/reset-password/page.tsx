import type { Metadata } from "next";
import Link from "next/link";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { siteViewport } from "../../_site/theme";
import { NewPasswordForm } from "../forms";
import { AuthFrame, authLink, SetupNotice } from "../frame";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

// Reached from the link in the reset email, which signs the person in first
// (/auth/confirm). The action checks for that session; without one it says
// the link has expired.
export default function ResetPassword() {
  if (!APP_CONFIGURED) return <SetupNotice />;
  return (
    <AuthFrame
      title="Choose a new password"
      footer={
        <Link href="/login" className={authLink}>
          Back to log in
        </Link>
      }
    >
      <NewPasswordForm />
    </AuthFrame>
  );
}
