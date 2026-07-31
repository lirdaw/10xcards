// Re-export, deliberately. The model-facing names are OWNED by tests/fixtures/language-names.ts
// and the arrow points that way on purpose: the eval run path is isolated from `npm test`
// (vitest.eval.config.ts replaces the include glob, and its preflight is the inverse of the
// main one), so pointing the ordinary suite INTO evals/ would invert that isolation for no
// gain. Both configs resolve the same repo, so one line here keeps the eval's import
// ergonomics with the dependency the right way round.
//
// Read the owner file before changing anything: these five strings are the single pin
// between what the eval shows the model and what the `language` table seeds.
export { PROMPT_LANGUAGE_NAMES } from "../../tests/fixtures/language-names";
