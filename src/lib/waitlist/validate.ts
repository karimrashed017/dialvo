// What a waitlist sign-up may contain. Kept apart from the route so it can be
// unit-tested.

export type Signup = {
  name: string;
  email: string;
  company: string;
  website: string;
  sells: string;
  leads: string;
  plan: string;
  play: string;
};

const LIMITS: Record<keyof Signup, number> = {
  name: 100,
  email: 200,
  company: 150,
  website: 200,
  sells: 500,
  leads: 40,
  plan: 20,
  play: 80,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The cleaned sign-up, or the field that is wrong. */
export function parseSignup(
  input: unknown,
): { ok: true; signup: Signup } | { ok: false; field: keyof Signup } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const signup = {} as Signup;
  for (const key of Object.keys(LIMITS) as (keyof Signup)[]) {
    const value = typeof raw[key] === "string" ? raw[key].trim() : "";
    if (value.length > LIMITS[key]) return { ok: false, field: key };
    signup[key] = value;
  }
  if (!signup.name) return { ok: false, field: "name" };
  signup.email = signup.email.toLowerCase();
  if (!EMAIL.test(signup.email)) return { ok: false, field: "email" };
  return { ok: true, signup };
}
