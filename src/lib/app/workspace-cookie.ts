import "server-only";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "./context";

/** Remembers the workspace to open. A preference only: membership is checked on every read. */
export async function rememberWorkspace(id: string) {
  (await cookies()).set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
