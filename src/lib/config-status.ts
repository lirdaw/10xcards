import { SUPABASE_URL, SUPABASE_KEY, OPENROUTER_API_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
  /**
   * Whether this warning may only be shown to a signed-in visitor.
   *
   * The banner tells whoever is looking which subsystems are degraded — useful to the
   * operator, ambient disclosure to an anonymous visitor. So it is decided PER ENTRY, and
   * this module applies it, in `visibleConfigStatuses` below; `Layout.astro` supplies only
   * the per-request session flag. The split is not arbitrary: `configured` is computed once
   * at import time from `astro:env/server`, while "is there a session" is a per-request
   * fact — which is also why the filter takes its entry list as a parameter rather than
   * closing over `missingConfigs`.
   *
   * Gating the whole block would invert the Supabase entry's purpose. When Supabase is
   * unconfigured, `createClient` returns `null`, so middleware always sets
   * `locals.user = null` — the warning about that very breakage would hide itself exactly
   * when it is needed. Supabase's entry is therefore never gated, by construction.
   */
  requiresSession: boolean;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
    // Never gated — see the field's doc comment: with Supabase down nobody is ever signed in.
    requiresSession: false,
  },
  {
    name: "OpenRouter",
    configured: Boolean(OPENROUTER_API_KEY),
    message: "OpenRouter nie jest skonfigurowany — generacja fiszek działa w trybie mock (przykładowe karty).",
    docsUrl: "https://openrouter.ai/docs",
    docsLabel: "Zobacz dokumentację OpenRouter",
    // An anonymous visitor cannot generate anything, so they are not told whether generation
    // is live or silently degraded to mock.
    requiresSession: true,
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);

/**
 * Which of `entries` a visitor may see, given whether they are signed in.
 *
 * Filter PER ENTRY, never the whole block: Supabase's warning carries
 * `requiresSession: false` precisely because an unconfigured Supabase means nobody is ever
 * signed in, so a block-level gate would hide the one banner that explains the breakage.
 *
 * `entries` is a parameter rather than `missingConfigs` read from module scope so the
 * decision is testable: that constant is fixed at import time from `astro:env/server`, so
 * under the test runner it can only ever describe the local stack.
 */
export function visibleConfigStatuses(entries: ConfigStatus[], hasSession: boolean): ConfigStatus[] {
  return entries.filter((cfg) => !cfg.requiresSession || hasSession);
}
