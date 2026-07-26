import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { authErrorMessage, AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth-errors";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(AUTH_UNAVAILABLE_MESSAGE)}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Never `error.message`: it lands in the URL, i.e. in browser history and the access
    // log, and upstream copy interpolates the submitted address (see @/lib/auth-errors).
    return context.redirect(`/auth/signin?error=${encodeURIComponent(authErrorMessage(error))}`);
  }

  return context.redirect("/decks");
};
