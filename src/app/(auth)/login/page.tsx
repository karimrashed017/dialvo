import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { googleLoginEnabled } from "@/lib/auth/providers";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { siteViewport } from "../../_site/theme";
import { LoginForm } from "../forms";
import { AuthFrame, authLink, SetupNotice } from "../frame";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};

export default async function Login() {
  if (!APP_CONFIGURED) return <SetupNotice />;
  const google = await googleLoginEnabled();
  return (
    <AuthFrame
      title="Welcome back"
      intro="Log in to see what your agents have been doing."
      footer={
        <>
          New to Dialvo?{" "}
          <Link href="/signup" className={authLink}>
            Create an account
          </Link>
        </>
      }
    >
      {/* The form reads ?next= and ?error= from the address. */}
      <Suspense>
        <LoginForm google={google} />
      </Suspense>
    </AuthFrame>
  );
}
