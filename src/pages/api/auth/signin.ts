import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  authErrorMessage,
  AUTH_GENERIC_MESSAGE,
  AUTH_UNAVAILABLE_MESSAGE,
  AUTH_VALIDATION_MESSAGE,
} from "@/lib/auth-errors";
// A form part can be a File. Cast to `string` it would be posted verbatim to GoTrue, which
// answers something unrecognised — so the user reads the catch-all instead of a real reason.
import { formString, isFormContentType } from "@/lib/forms";

export const POST: APIRoute = async (context) => {
  // A body that is not a form makes formData() reject; unguarded that is an uncontrolled
  // framework 500. Both messages are already members of the AUTH_MESSAGES closed set, so no
  // new copy enters it. This is malformed-BODY handling only — no presence, format or
  // length rule is added here; auth input validation is C10X-36's.
  //
  // The two causes are told apart because they mean opposite things to the reader: a body
  // that was never a form is the caller's to fix, while a form-typed body that arrived
  // broken (abort, truncation, transport reset) is not — telling someone to "correct the
  // form" when their upload was cut off sends them to look for a mistake they did not make.
  // See isFormContentType for why the header decides this and not the exception.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    const message = isFormContentType(context.request) ? AUTH_GENERIC_MESSAGE : AUTH_VALIDATION_MESSAGE;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }
  const email = formString(form.get("email"));
  const password = formString(form.get("password"));

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
