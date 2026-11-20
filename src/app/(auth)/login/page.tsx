import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { siteViewport } from "../../_site/theme";
import { LoginForm } from "../forms";
import { AuthFrame, authLink, SetupNotice } from "../frame";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};

export default function Login() {
  if (!APP_CONFIGURED) return <SetupNotice />;
  return (
    <AuthFrame
      title="Log in"
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
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
