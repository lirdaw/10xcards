// Removing a credential from text the agent's stderr carries, BEFORE any of it can reach a
// comment on a public pull request.
//
// **Why this is a module and not a `sed` in the action.** It was
// `sed -i "s|${API_KEY}|***|g" "$STDERR_PATH" 2>/dev/null || true`, and that line had three
// defects at once: the key went into the pattern UNESCAPED (a `|` in it closes the s-command,
// a `\` starts an escape), the failure was discarded twice over (`2>/dev/null` and `|| true`),
// and nothing downstream could tell a successful scrub from one that never happened. Literal
// replacement here — `split(secret).join(REDACTION)` — cannot be broken by a metacharacter at
// all, because a string separator is matched literally. The class is removed rather than
// reported.
//
// **What the caller must do with `clean: false`.** Treat the text as unscrubbed and use none
// of it. `.github/workflows/pr-review.yml` renders a generic failure reason unless this says
// `true` — a public repository has to default to saying less, because a leak is irreversible
// and a missing sentence in a comment is not.
//
// Zero runtime dependencies, like the rest of `scripts/`: it runs under bare
// `node --experimental-strip-types` inside the composite action, with no install step.

export const REDACTION = "***";

/**
 * Below this length a "secret" is not scrubbable: a two-character value would redact half the
 * log, so a short one means something is wrong with the input rather than with the text. We
 * refuse instead of guessing, and the refusal travels as `clean: false`.
 */
export const MIN_SECRET_LENGTH = 12;

/**
 * Shapes to redact even when they are NOT the key we were handed — a rotated key still in a
 * cached error, a second provider's key, a key echoed back by an upstream service. The literal
 * pass cannot catch those, and they leak exactly as badly.
 */
export const KEY_SHAPES: readonly RegExp[] = [
  /sk-or-v1-[A-Za-z0-9_-]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-proj-[A-Za-z0-9_-]{8,}/g,
];

export interface ScrubResult {
  /** The text with every recognised credential replaced. Meaningless unless `clean` is true. */
  text: string;
  /** True only when the scrub can be VOUCHED for. False is not "an error happened" — it is
   *  "nobody may quote this text". */
  clean: boolean;
  /** Why the scrub could not be vouched for, for the run log. `null` when clean. */
  reason: string | null;
}

/**
 * A BOM or stray whitespace around a secret is not hypothetical here: `eval-ci-dispatch` had a
 * repository secret with a BOM that passed every "is it set?" check and failed on the first
 * real call. The value that reaches the provider is the trimmed one, so that is the value that
 * can appear in an error message.
 */
function normalise(secret: string): string {
  return secret.replace(/^\uFEFF/, "").trim();
}

export function scrubSecrets({ text, secret }: { text: string; secret: string }): ScrubResult {
  const needle = normalise(secret);

  if (needle.length < MIN_SECRET_LENGTH) {
    // Still redact by shape, so the returned text is not worse than the input — but refuse to
    // vouch for it, because the one value we were supposed to remove was never usable.
    return {
      text: redactShapes(text),
      clean: false,
      reason:
        needle.length === 0
          ? "nie podano klucza do wycięcia, więc czystości tekstu nie da się poświadczyć"
          : `podany klucz ma ${needle.length} znaków, poniżej progu ${MIN_SECRET_LENGTH} — wycięcie go zredagowałoby pół logu`,
    };
  }

  // Literal, and that is the whole point: `String.prototype.split` with a STRING separator does
  // no pattern matching, so `|`, `\`, `.` or `$` inside the key are just characters.
  const withoutLiteral = text.split(needle).join(REDACTION);
  const scrubbed = redactShapes(withoutLiteral);

  // Belt and braces: if anything key-shaped survived both passes, we do not understand this
  // text and must not let it be quoted.
  const residue = findResidue(scrubbed);
  if (residue !== null) {
    return {
      text: scrubbed,
      clean: false,
      reason: `po wycięciu w tekście nadal został fragment wyglądający na klucz (${residue})`,
    };
  }

  return { text: scrubbed, clean: true, reason: null };
}

function redactShapes(text: string): string {
  let out = text;
  for (const shape of KEY_SHAPES) {
    // A fresh regex per call: the shared literals carry `g`, and `g` regexes are stateful
    // through `lastIndex`. Reusing them across calls would make the SECOND scrub of a run skip
    // matches — a silent, order-dependent leak, and the kind that surfaces as a flake first.
    out = out.replace(new RegExp(shape.source, "g"), REDACTION);
  }
  return out;
}

function findResidue(text: string): string | null {
  for (const shape of KEY_SHAPES) {
    const hit = new RegExp(shape.source, "g").exec(text);
    if (hit) {
      return hit[0].slice(0, 12) + "…";
    }
  }
  return null;
}
