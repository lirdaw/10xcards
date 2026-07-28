import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { authErrorMessage, AUTH_UNAVAILABLE_MESSAGE, AUTH_VALIDATION_MESSAGE } from "@/lib/auth-errors";

// Same reason as signin.ts.
const formString = (value: FormDataEntryValue | null): string => (typeof value === "string" ? value : "");

export const POST: APIRoute = async (context) => {
  // Same guard as signin.ts, same closed-set message; malformed-body handling only.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(AUTH_VALIDATION_MESSAGE)}`);
  }
  const email = formString(form.get("email"));
  const password = formString(form.get("password"));

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(AUTH_UNAVAILABLE_MESSAGE)}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // Never `error.message` — same reason as signin.ts.
    return context.redirect(`/auth/signup?error=${encodeURIComponent(authErrorMessage(error))}`);
  }

  return context.redirect("/auth/confirm-email");
};
