import { OPENROUTER_API_KEY } from "astro:env/server";

// The INVERSE of tests/setup/preflight.ts, and load-bearing for the same reason in the
// opposite direction: the ordinary suite fails when OPENROUTER_API_KEY IS set (mock-mode
// determinism), while this eval fails when it is ABSENT. With no key,
// generateCandidates() silently returns fixed Polish mock strings
// (src/lib/openrouter.ts mockCards) — a PL language-fidelity case would then pass
// VACUOUSLY and every other language case would fail confusingly. An eval that can go
// green without ever reaching the real model is worse than no eval.
//
// Two seams, both required, both fed by ONE shell export in the same invocation:
//   1. `astro:env/server` — the exact transform-time-inlined value generateCandidates()
//      sees (same-seam discipline; a globalSetup under a getViteConfig() config is
//      Vite-transformed, as tests/setup/preflight.ts proves on every `npm test`).
//   2. `process.env.OPENROUTER_API_KEY` — what the judge client (evals/lib/judge.ts)
//      reads directly.
// A key in .env satisfies only seam 1 (Vite does not copy .env into process.env), so it
// is rejected here on seam 2 — deliberately: left in .env it would also make the next
// ordinary `npm test` fail loudly.
//
// This file must not import tests/setup/preflight.ts: that one asserts Supabase seams the
// eval never touches, and its assertMockGeneration() fails on exactly the state this run
// requires.

const INVOCATION = `
Run the eval with the key in the SHELL environment (feeds both seams at once):
  bash:       OPENROUTER_API_KEY=sk-... npx vitest run -c vitest.eval.config.ts
  PowerShell: $env:OPENROUTER_API_KEY="sk-..."; npx vitest run -c vitest.eval.config.ts
A key in .env is NOT a supported alternative (see evals/setup/eval-preflight.ts header).
`;

function fail(problem: string): never {
  throw new Error(`Eval preflight failed: ${problem}\n${INVOCATION}`);
}

// Sync on purpose (unlike tests/setup/preflight.ts, which awaits a health fetch): this
// preflight makes no I/O, and an async wrapper with no await fails lint (require-await).
export default function evalPreflight(): void {
  if (!OPENROUTER_API_KEY) {
    fail(
      `OPENROUTER_API_KEY is not set on the astro:env/server seam — generateCandidates() ` +
        `would silently fall back to fixed Polish mock cards, and the language-fidelity ` +
        `matrix would measure nothing (the PL cases pass vacuously).`,
    );
  }
  if (!process.env.OPENROUTER_API_KEY) {
    fail(
      `process.env.OPENROUTER_API_KEY is unset — the judge client reads this seam. The ` +
        `generator's astro:env seam is satisfied (a key in .env does that), but the judge ` +
        `would have no credential, so the run would abort after the paid generation calls.`,
    );
  }
  // No network calls here: reachability of openrouter.ai is proven by the first real
  // case, and a preflight ping would be a paid request spent proving nothing.
}
