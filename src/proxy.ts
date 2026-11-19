import { NextResponse, type NextRequest } from "next/server";
import { FEATURES, PLAYS } from "@/lib/content/catalog";

// A play or platform address that isn't in the catalog is answered with a
// real 404 here. Without this the dynamic routes would stream their shell
// with a 200 first and only then show "not found".
export function proxy(request: NextRequest) {
  const [, section, slug, ...rest] = request.nextUrl.pathname.split("/");
  const known =
    rest.length === 0 &&
    Object.hasOwn(section === "plays" ? PLAYS : FEATURES, slug);
  if (known) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_not-found", request.url), {
    status: 404,
  });
}

export const config = { matcher: ["/plays/:slug+", "/platform/:slug+"] };
