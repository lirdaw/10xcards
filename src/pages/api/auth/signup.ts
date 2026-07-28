import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  authErrorMessage,
  AUTH_GENERIC_MESSAGE,
  AUTH_UNAVAILABLE_MESSAGE,
  AUTH_VALIDATION_MESSAGE,
} from "@/lib/auth-errors";
// Same reason as signin.ts.
import { formString, isFormContentType } from "@/lib/forms";

export const POST: APIRoute = async (context) => {
  // Same guard as signin.ts, same two closed-set messages and the same reason for telling the
  // causes apart; malformed-body handling only.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    const message = isFormContentType(context.request) ? AUTH_GENERIC_MESSAGE : AUTH_VALIDATION_MESSAGE;
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
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
