import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// Single home for `language` dictionary queries, as src/lib/decks.ts is for decks. Every
// function takes an already-created SSR client, so all reads are RLS-scoped to the
// signed-in user — the table is readable by `authenticated` and by nobody else.
//
// The table exists to keep three roles apart that used to be one string: `code` is the
// contract (the wire value and the `generation_session.language` audit value), `ui_label`
// is what a human reads, `prompt_name` is what the MODEL reads. Which of the two names a
// caller gets is therefore part of each function's contract below, not an incidental
// column list.

type Client = SupabaseClient<Database>;

/**
 * The languages the selector offers, in the order it renders them.
 *
 * `prompt_name` is deliberately NOT projected: it is model-facing, the UI is human-facing,
 * and the island receiving it would be the same role-mixing this table was built to end.
 *
 * `code` is a tie-break, not decoration. `sort_order` carries a UNIQUE constraint, so it is
 * already a total order today — but a sort with one key is one schema edit away from being
 * planner-dependent, and at six rows the planner would return insertion order anyway, so the
 * suite's two sequence assertions would stay GREEN while the selector's order became
 * arbitrary. That is the failure mode test-plan §6.6 records for `study_due_cards`' `f.id asc`.
 */
export function listActiveLanguages(supabase: Client) {
  return supabase.from("language").select("code, ui_label").eq("is_active", true).order("sort_order").order("code");
}

/**
 * Resolves a submitted code to the name the system prompt interpolates.
 *
 * `maybeSingle()` so an unknown code and a deactivated one both resolve as
 * `{ data: null, error: null }` — absence, which test-plan §6.4 names as the below-HTTP
 * form of "404, never 403", and which the endpoint maps to its existing 400 refusal. A
 * query error stays a separate branch and must map to a 500: reporting an outage as
 * "unknown language" would tell the user to fix a request that was fine.
 */
export function getActiveLanguage(supabase: Client, code: string) {
  return supabase.from("language").select("code, prompt_name").eq("code", code).eq("is_active", true).maybeSingle();
}
