// The "is the review agent's distilled prompt still describing the current repo?" check, as
// pure functions over Markdown text. No console, no argv — all of that lives in the runner
// beside this file (./run-prompt-sources.ts), same pure/runner pattern as
// ./schema-drift.ts ↔ ./check-schema-drift.ts and ./review-verdict.ts ↔ ./run-review-verdict.ts.
// The split is load-bearing rather than stylistic: tests/lib/review-prompt-sources.test.ts
// imports this module and vitest.config.ts pins `sequence: { shuffle: true }`, so CLI code at
// module scope would run against vitest's argv at a random point in the suite.
//
// What this guards. `agents/review/prompt.ts` is a DISTILLATE — a hand-written copy of rules
// that live somewhere else. Nothing links the copy to its sources, so the day `AGENTS.md`
// gains a hard rule the agent keeps reviewing against the old one, quietly, and the only
// symptom is scores that look plausible and are not.
//
// **Sections, never whole files.** `context/foundation/test-plan.md` is ~6.7k lines; a hash
// over the whole file would go red on every typo anywhere in it, and a gate that is red for
// reasons nobody caused is a gate everybody learns to regenerate without reading. Hashing the
// three sections the distillate was actually cut from keeps the red rare and meaningful.
//
// Why the record lives on the agent's side (`agents/review/prompt-sources.json`): it states a
// property of the PROMPT ("this is the version of the documents it was distilled from"), not
// a property of the repository. `scripts/` reading it back is the same data-only crossing as
// `criteria.json` — a generated JSON file, never a module.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** One hashed source: a file, and the one section of it the distillate was cut from. */
export interface PromptSource {
  /** Repo-relative, POSIX separators — it is written into a committed JSON file. */
  path: string;
  /** The heading line verbatim, `#` marks included; the level decides where the section ends. */
  heading: string;
}

/** A `PromptSource` plus the digest of the section text as it stands on disk. */
export interface PromptSourceRecord extends PromptSource {
  sha256: string;
}

/**
 * The three sections `agents/review/prompt.ts` was distilled from, in the order its blocks
 * appear: `REPO_RULES` from the first two, `RISK_MAP` from the third.
 *
 * `SWALLOWED_SIGNATURE` and `SCOPE_CALIBRATION` are deliberately absent. They were written
 * for this change out of measured incidents rather than copied from a section, so there is no
 * upstream text that could drift away from them — listing a source they do not descend from
 * would produce reds nobody can act on, which is the failure mode this whole file is built to
 * avoid.
 */
export const PROMPT_SOURCES: readonly PromptSource[] = [
  { path: "AGENTS.md", heading: "## Hard Rules" },
  { path: "AGENTS.md", heading: "## Conventions" },
  { path: "context/foundation/test-plan.md", heading: "## 2. Risk Map" },
];

/**
 * Both resolved from this file's own location rather than `process.cwd()`, so the digests
 * describe the checkout this code ships with no matter where it was invoked from — the same
 * reason ./check-schema-drift.ts resolves its migrations directory this way.
 */
const REPO_ROOT = new URL("../", import.meta.url);
export const RECORD_PATH = new URL("../agents/review/prompt-sources.json", import.meta.url);

/** The command that refreshes the record, quoted in every remedy so it can be pasted. */
export const REFRESH_COMMAND = "node --experimental-strip-types scripts/run-prompt-sources.ts --write";

const HEADING_LINE = /^(#{1,6})\s+\S/;
const FENCE_LINE = /^\s*(?:```|~~~)/;

/**
 * Cut one Markdown section out of `text`: the heading line itself, through the line before
 * the next heading of the same or a higher level.
 *
 * **The heading line is included**, so renaming a section reds the gate. A rename is exactly
 * the edit most likely to leave the distillate pointing at something that no longer exists.
 *
 * **Sub-sections are included.** `## 2. Risk Map` owns the `### Risk Response Guidance` under
 * it; that guidance is part of what the distillate's `RISK_MAP` block speaks for, and a reader
 * asked "did §2 change?" would answer yes if it moved.
 *
 * Fenced blocks are skipped over rather than scanned, because a `# comment` on the first
 * column of a shell snippet would otherwise end the section early — and a section truncated
 * that way still hashes perfectly happily, so the gate would go on being green while it had
 * stopped watching the tail. Neither source file contains a fence today; this costs four
 * lines and removes the possibility of that silent narrowing later.
 *
 * A missing heading throws rather than returning `""`. An empty section hashes to a perfectly
 * stable digest, so the miss would be recorded once and then never noticed again — the gate
 * would be watching nothing, and reporting that as agreement.
 */
export function extractSection(text: string, heading: string): string {
  const level = /^#{1,6}(?=\s)/.exec(heading)?.[0].length;
  if (level === undefined) {
    throw new Error(`Nagłówek ${JSON.stringify(heading)} nie jest nagłówkiem Markdown (spodziewane np. "## Nazwa").`);
  }

  // CRLF folded away before anything else. `.gitattributes` pins `eol=lf`, so the two agree
  // today — but if that ever slips, the symptom is a digest that differs between a Windows
  // checkout and the Linux runner, i.e. a red that reproduces nowhere.
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const starts: number[] = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE_LINE.test(line)) fenced = !fenced;
    else if (!fenced && line.trimEnd() === heading) starts.push(index);
  }

  if (starts.length === 0) {
    throw new Error(
      `Nagłówek ${JSON.stringify(heading)} nie występuje w źródle — sekcja zniknęła albo zmieniła nazwę.`,
    );
  }
  if (starts.length > 1) {
    throw new Error(
      `Nagłówek ${JSON.stringify(heading)} występuje ${starts.length} razy — rekord wskazywałby na dowolne z tych ` +
        `wystąpień. Nadaj sekcjom rozróżnialne tytuły albo dopisz numer, tak jak robi to test-plan.md.`,
    );
  }

  const start = starts[0] ?? 0;
  let end = lines.length;
  fenced = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE_LINE.test(line)) {
      fenced = !fenced;
      continue;
    }
    const marks = fenced ? null : HEADING_LINE.exec(line)?.[1];
    if (marks !== null && marks !== undefined && marks.length <= level) {
      end = index;
      break;
    }
  }

  // Trailing blank lines dropped: how many of them sit between this section and the next is
  // formatting, and prettier owns it. Leaving them in would hand `prettier --write` the power
  // to red this gate.
  return lines.slice(start, end).join("\n").trimEnd();
}

/** The digest recorded for a section. Hex sha256 over its UTF-8 bytes — nothing clever. */
export function hashSection(section: string): string {
  return createHash("sha256").update(section, "utf8").digest("hex");
}

/**
 * Read every source off disk and digest its section.
 *
 * Reads, so not pure in the strictest sense — but it has no console, no argv and no exit
 * code, which is the property the runner/test split actually needs. Both callers want the
 * live files: the runner to write the record, the test to compare against it.
 */
export function hashSections(sources: readonly PromptSource[] = PROMPT_SOURCES): PromptSourceRecord[] {
  return sources.map(({ path, heading }) => {
    const text = readFileSync(new URL(path, REPO_ROOT), "utf8");
    return { path, heading, sha256: hashSection(extractSection(text, heading)) };
  });
}

/**
 * The record file's exact bytes.
 *
 * Two-space indent and a closing newline are not a preference: `lint-staged` runs
 * `prettier --write` on every staged `*.json` and `agents/**` is not in `.prettierignore`, so
 * a generator emitting anything else would have its output rewritten by the first commit —
 * leaving the `git diff --exit-code` gate red forever, and red about formatting rather than
 * about drift. `npx prettier --check agents/review/prompt-sources.json` is a success criterion
 * of this phase rather than an assumption.
 */
export function serializeRecord(records: readonly PromptSourceRecord[]): string {
  return `${JSON.stringify(records, null, 2)}\n`;
}

/**
 * What to DO about a drifted section — not just that two hex strings differ.
 *
 * The order matters and is the whole message: read the section, then update the distillate,
 * and only then refresh the record. Refreshing first is the one move that makes the gate
 * worse than useless, because it records agreement with a prompt nobody re-read.
 */
export function remedyFor({ path, heading }: PromptSource): string {
  return [
    `${path} §${heading} zmieniło się, a destylat promptu w agents/review/prompt.ts — nie.`,
    "",
    "Co zrobić, w tej kolejności:",
    `  1. Przeczytaj sekcję ${heading} w ${path} i zobacz, co się w niej zmieniło.`,
    "  2. Zaktualizuj odpowiadający jej blok w agents/review/prompt.ts, żeby znów ją opisywał.",
    `  3. Dopiero teraz odśwież rekord: ${REFRESH_COMMAND}`,
    "  4. Zacommituj agents/review/prompt-sources.json RAZEM ze zmianą destylatu.",
    "",
    "Sam krok 3 zieleni ten test i nie naprawia niczego — zapisze zgodę na prompt, którego nikt nie przeczytał.",
  ].join("\n");
}
