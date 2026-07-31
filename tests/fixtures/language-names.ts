// The MODEL-facing language names, in ONE place, shared by the two halves of a claim
// that would otherwise have no seam between them.
//
// The eval (`npm run eval`) proves the BEHAVIOUR — that a model-legible English name in
// the system prompt yields target-language cards. The ordinary suite proves the WIRING —
// that the `language` table holds those names and the endpoint resolves them. The eval
// cannot read the database by design (vitest.eval.config.ts: "this run path never touches
// the local stack"), so the two run against different sources. Left alone, a typo in the
// seed (`"Germen"`) would pass BOTH: the eval would use its own literal and the DB test
// would compare the row against whatever the DB test happened to expect. This file is the
// pin. Do not inline these strings on either side.
//
// Direction of the dependency is deliberate: `tests/` OWNS it and `evals/` re-exports it.
// The eval run path is deliberately isolated from `npm test`; pointing the ordinary suite
// INTO `evals/` would invert that isolation for no gain.
//
// Keyed by `string`, NOT by the eval's `ReferenceLanguageCode`. That union means
// "languages the eval has an authored reference text for"; this map means "languages the
// app ships". They coincide at five today and are not the same set — a sixth shipped
// language needs a `prompt_name`, but it does not need 800 characters of authored prose,
// and typing them together would make adding one a red DB assertion until somebody wrote
// it. The eval keeps its own `ReferenceLanguageCode` typing at its call sites, where the
// two sets genuinely do have to line up.
//
// The seeded-but-inactive `it` row has no entry here on purpose: it is a prepared,
// unshipped language, and its absence is what the DB test's per-row assertion reads.
export const PROMPT_LANGUAGE_NAMES: Record<string, string> = {
  pl: "Polish",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
};
