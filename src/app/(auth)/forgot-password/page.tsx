import type { Metadata } from "next";
import Link from "next/link";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { siteViewport } from "../../_site/theme";
import { ForgotPasswordForm } from "../forms";
import { AuthFrame, authLink, SetupNotice } from "../frame";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPassword() {
  if (!APP_CONFIGURED) return <SetupNotice />;
  return (
    <AuthFrame
      title="Reset your password"
      intro="Enter your email and we'll send a link to choose a new one."
      footer={
        <Link href="/login" className={authLink}>
          Back to log in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
