/* eslint-disable no-console -- this file IS the report: it is the operation's only output
   surface, and the before/after keepalive triple it prints is the evidence a reader has that
   the unsupported step did anything. It deliberately lives in `scripts/`, never `src/`,
   because tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of the Kong keep-alive fix. Everything decidable is next door in
// ./kong-keepalive.ts as pure functions with fixtures; this file inspects Docker, commits,
// removes, runs, waits, verifies, prints, and owns the exit code.
//
// **This is an UNSUPPORTED operation, and it is unsupported for a reason worth knowing.**
// Kong 2.8.1 and PostgREST/warp both idle out a keep-alive connection at exactly 60 s
// (measured, C10X-39 research), which is the pathological configuration — neither side
// reliably closes first, so whichever wins the race decides whether the next request finds a
// live socket, and the loser answers `502 upstream prematurely closed connection`. No
// supported Supabase CLI surface exposes either timeout: Kong's container env is a hardcoded
// Go slice with no host pass-through, `kong.yml` is `//go:embed`-ed, the Kong image is not
// settable from `config.toml`, `[api]` exposes only PostgREST settings, and PostgREST has
// never had a keep-alive knob in any version. (Nor does the official troubleshooting page's
// `KONG_NGINX_WORKER_PROCESSES=auto supabase start` work on this CLI — the value is a literal
// in that same slice.) So the lever is applied by recreating the container afterwards.
//
// Two consequences a reader must carry away. The recreation is **wiped by every
// `supabase stop`**, which is why tests/setup/retry-transport.ts stays regardless. And it is
// **per-machine**: nothing depends on it, there is no migration, and rollback is
// `npx supabase stop && npx supabase start`.
//
// **Fail closed.** Every failure path exits non-zero, including "the container came back but
// `.kong_env` still reads 60" — a stack that is UP but UNMODIFIED is precisely the false
// green this script exists to prevent. `docker run` reports success whether or not Kong
// understood the variable, so the exit code of the run is not evidence and is never treated
// as such.
//
// Zero runtime dependencies — `node:fs` and `node:child_process` only, matching
// ./check-schema-drift.ts. That is a property worth preserving rather than an accident: it
// is what lets CI invoke this with bare `node --experimental-strip-types`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  KONG_KEEPALIVE_ENV,
  KONG_KEEPALIVE_STOCK,
  buildRunArgs,
  containerNames,
  isKeepAlivePoolDisabled,
  parseKongEnv,
} from "./kong-keepalive.ts";
import type { KeepAliveSettings, KongContainerSpec } from "./kong-keepalive.ts";

/**
 * Resolved from this file's own location, not from `process.cwd()`, so the script operates on
 * the checkout it ships with no matter where it is invoked from.
 */
const CONFIG_TOML = new URL("../supabase/config.toml", import.meta.url);

/** Kong's own dump of every setting it actually resolved — the adoption oracle. */
const KONG_ENV_PATH = "/usr/local/kong/.kong_env";

/** Bounded, because an unbounded health wait on a container that will never come up hangs
 *  `npm run db:start` with no output and no way to tell it from a slow start. */
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 1_000;

/**
 * `project_id` out of supabase/config.toml, by regex.
 *
 * No TOML parser, deliberately: the zero-runtime-dependency property above is what keeps this
 * script invokable by bare `node --experimental-strip-types`, and one quoted scalar at the top
 * of a file does not justify giving that up.
 */
function readProjectId(): string {
  const toml = readFileSync(CONFIG_TOML, "utf8");
  const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (projectId === undefined) throw new Error(`no \`project_id\` found in ${CONFIG_TOML.pathname}`);
  return projectId;
}

/** `docker …`, with stderr surfaced on failure rather than swallowed. */
function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

function inspectJson(container: string, template: string): unknown {
  return JSON.parse(docker(["inspect", container, "--format", template]));
}

function readKeepAlive(container: string): KeepAliveSettings {
  // No `MSYS_NO_PATHCONV` needed here — that Git Bash path-rewriting trap bites the hand-run
  // `docker exec` in the plan's criteria, not `child_process`, which never goes near a shell.
  return parseKongEnv(docker(["exec", container, "cat", KONG_ENV_PATH]));
}

function describe(settings: KeepAliveSettings): string {
  const show = (value: number | null): string => (value === null ? "absent" : String(value));
  return (
    `pool_size = ${show(settings.poolSize)}, ` +
    `max_requests = ${show(settings.maxRequests)}, ` +
    `idle_timeout = ${show(settings.idleTimeout)}`
  );
}

/**
 * Read the running container's full runtime spec.
 *
 * Every field is taken from the live container rather than from a literal, so a Supabase CLI
 * that changes a port, an alias or a label produces a faithful replacement instead of one
 * built to last year's shape. `.Config.Cmd` is not read because on this container it is
 * **null** — see `KongContainerSpec` in ./kong-keepalive.ts for why that is the whole reason
 * the commit step exists.
 */
function inspectSpec(container: string, network: string, image: string): KongContainerSpec {
  // `| undefined` on the value is not pedantry: a wrong `project_id`, or a CLI that renames
  // the network, lands here — and the guard below is the difference between a named error and
  // a `Cannot read properties of undefined` after the container has already been removed.
  const networks = inspectJson(container, "{{json .NetworkSettings.Networks}}") as Record<
    string,
    { Aliases: string[] | null } | undefined
  >;
  const attached = networks[network];
  if (!attached) {
    throw new Error(
      `container ${container} is not attached to ${network} (found: ${Object.keys(networks).join(", ")})`,
    );
  }

  // This function is an ALLOWLIST, and an allowlist silently drops whatever it does not name.
  // Measured on the live container: `Binds` is null and `Mounts` is empty, so there is no
  // defect today — but the module's contract is a faithful replacement, and NEITHER of the
  // runner's two oracles could see this gap. `kong health` is process-local and `.kong_env`
  // reports settings, not storage, so a CLI upgrade that added a bind mount would produce a
  // container that is up, healthy, verified and subtly wrong. Fail closed instead, and do it
  // HERE — before the `docker commit`/`docker rm -f` below, so the refusal costs nothing and
  // the stack is untouched. Added by C10X-39's impl-review, F4.
  const binds = (inspectJson(container, "{{json .HostConfig.Binds}}") as string[] | null) ?? [];
  const mounts = (inspectJson(container, "{{json .Mounts}}") as unknown[] | null) ?? [];
  if (binds.length > 0 || mounts.length > 0) {
    throw new Error(
      `container ${container} carries ${binds.length} bind(s) and ${mounts.length} mount(s), which this ` +
        `recreation does not reproduce. Refusing before anything is changed — the replacement would come ` +
        `up healthy and be missing them. Re-derive inspectSpec() in scripts/disable-kong-keepalive.ts.`,
    );
  }

  return {
    name: container,
    image,
    user: inspectJson(container, "{{json .Config.User}}") as string,
    labels: inspectJson(container, "{{json .Config.Labels}}") as Record<string, string>,
    env: inspectJson(container, "{{json .Config.Env}}") as string[],
    restartPolicy: inspectJson(container, "{{json .HostConfig.RestartPolicy.Name}}") as string,
    portBindings: inspectJson(container, "{{json .HostConfig.PortBindings}}") as KongContainerSpec["portBindings"],
    network,
    // The aliases the CLI set, minus nothing. Every other service in the stack reaches the
    // proxy by alias, so losing `api.supabase.internal` yields a healthy, unreachable Kong.
    aliases: attached.Aliases ?? [],
    healthcheck: inspectJson(container, "{{json .Config.Healthcheck}}") as KongContainerSpec["healthcheck"],
  };
}

function waitForHealthy(container: string): void {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  for (;;) {
    // `.State.Health.Status` is `starting` → `healthy`; a container that exited outright has
    // no Health at all, which the `Status` read below distinguishes.
    const state = inspectJson(container, "{{json .State}}") as {
      Running: boolean;
      Status: string;
      Health?: { Status: string };
    };

    if (state.Health?.Status === "healthy") return;
    // A container with NO healthcheck at all is running-and-done, not unhealthy — and this
    // branch mirrors `buildRunArgs`, which already tolerates `spec.healthcheck` being absent
    // or `NONE`. Without the mirror the two halves disagree: a Kong created without one could
    // never satisfy the line above, so the poll would burn its full timeout, throw, and fire
    // `attemptRestore` — which recreates it the same way and burns the timeout again. Net
    // effect: a WORKING proxy destroyed, rebuilt, and the script exiting non-zero two minutes
    // later. Unreachable today (the CLI sets `["CMD-SHELL","kong health"]`, verified on the
    // live container), and this exists so it stays unreachable rather than latent. Added by
    // C10X-39's impl-review, F3.
    if (state.Health === undefined && state.Running) return;
    if (!state.Running) throw new Error(`container ${container} is ${state.Status}, not running`);
    if (Date.now() > deadline) {
      throw new Error(
        `container ${container} did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s ` +
          `(last: ${state.Health?.Status ?? state.Status})`,
      );
    }

    // Synchronous by design: this script's whole job is a strictly ordered sequence, and an
    // async sleep would buy nothing while making that ordering harder to read. `Atomics.wait`
    // blocks the thread without a timer and without spawning anything.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, HEALTH_POLL_MS);
  }
}

/**
 * Put the stack back after a failed recreation — one attempt, from the committed image, at
 * Kong's STOCK pool size.
 *
 * This exists because of the window the script opens, not as a courtesy. Everything after
 * `docker rm -f` runs with the stack's only proxy gone, so a failure at the run, the health
 * wait or the verification leaves the developer with no API on 54321 — and since this is
 * reached through `npm run db:start`, that reads as "my stack is broken", not "one optional
 * step did not apply". The restore narrows the blast radius; it is **not** a success path,
 * and the caller still exits non-zero either way.
 *
 * `KONG_KEEPALIVE_STOCK` rather than "no `-e` at all", because the committed image may itself
 * carry the lever — see the constant's own note, which records the live run where that made
 * the restore silently keep the fix while reporting the opposite.
 */
function attemptRestore(spec: KongContainerSpec): void {
  console.error("");
  console.error("kong-keepalive: attempting to restore the stock container so the stack keeps working…");
  try {
    // `stdio: "ignore"` on stderr: the container is USUALLY already gone at this point (the
    // failure was often the run itself), and letting daemon's "No such container" reach the
    // console makes a successful restore read like a second failure.
    execFileSync("docker", ["rm", "-f", spec.name], { stdio: "ignore" });
  } catch {
    // Nothing to remove is the ordinary case. Never let cleanup mask the real error above.
  }
  try {
    docker(buildRunArgs(spec, KONG_KEEPALIVE_STOCK));
    waitForHealthy(spec.name);
    const restored = readKeepAlive(spec.name);
    // Read back rather than announced: this whole script exists because `docker run` reporting
    // success says nothing about what Kong resolved, and the restore is not exempt from that.
    console.error(`kong-keepalive: the stock container is back up — ${describe(restored)}`);
  } catch (err) {
    console.error(`kong-keepalive: the restore also failed (${String(err)}).`);
  }
  console.error("kong-keepalive: recover with `npx supabase stop && npx supabase start`.");
}

function main(): number {
  const projectId = readProjectId();
  const { container, network } = containerNames(projectId);

  const before = readKeepAlive(container);
  console.log(`kong-keepalive: before — ${describe(before)}`);

  // Idempotency is about DETECTION, not about repetition. A second `-e` of the same key would
  // win in `docker run`, so re-applying would "work" — but it would also pointlessly bounce
  // Kong and reset the very log the before/after flake measurement reads as its oracle.
  if (isKeepAlivePoolDisabled(before)) {
    console.log("kong-keepalive: already applied — nothing to do.");
    return 0;
  }

  // The image name is project-scoped, and this must be said out loud at the site rather than
  // discovered later: the committed image bakes this project's local `kong.yml`, which embeds
  // the stack's anon/service_role JWTs. They are Supabase's well-known local demo keys and
  // this image is local-only and never pushed — but an unscoped tag would be a foot-gun the
  // moment two projects share a machine.
  const image = `supabase-kong-keepalive-${projectId}:latest`;
  const spec = inspectSpec(container, network, image);

  // ORDER IS LOAD-BEARING: commit BEFORE remove. The writable layer holds `kong.yml`, the
  // custom nginx template and the TLS keypair that the CLI's entrypoint heredoc wrote at
  // first start, and all of it dies with the container. A script that removed first and
  // committed second would destroy the stack and be unable to put it back.
  console.log(`kong-keepalive: committing ${container} → ${image}`);
  docker(["commit", container, image]);

  console.log(`kong-keepalive: recreating ${container} with ${KONG_KEEPALIVE_ENV.key}=${KONG_KEEPALIVE_ENV.value}`);
  docker(["rm", "-f", container]);

  // Past this point the stack has no proxy on 54321, so every failure restores.
  //
  // The verification READ is inside this window too, and that placement is deliberate rather
  // than incidental (C10X-39 impl-review, F2). Left outside, a throwing `docker exec` — a
  // daemon hiccup, or a race just after `healthy` — escaped to the top-level catch, which
  // announces "The local stack must be running before this step" and "Nothing was changed":
  // both false here, since Kong has just been recreated, and both aimed at a developer who
  // arrived through `npm run db:start`. No restore was attempted either. It exits non-zero
  // either way, so this was a red with the wrong explanation, not a false green.
  let after;
  try {
    docker(buildRunArgs(spec));
    waitForHealthy(container);
    after = readKeepAlive(container);
  } catch (err) {
    console.error(`kong-keepalive: recreation failed — ${String(err)}`);
    attemptRestore(spec);
    return 1;
  }

  console.log(`kong-keepalive: after  — ${describe(after)}`);

  // The one assertion that matters. Kong silently ignores an env var it does not recognise,
  // so the `docker run` exit code says nothing about adoption — only Kong's own dump does.
  if (!isKeepAlivePoolDisabled(after)) {
    console.error("");
    console.error(`kong-keepalive: the container came back but ${KONG_ENV_PATH} still reads`);
    console.error(`  ${describe(after)}`);
    console.error("  Kong did not adopt the setting. A stack that is up but unmodified is the");
    console.error("  false green this script exists to prevent, so this is a failure.");
    attemptRestore(spec);
    return 1;
  }

  console.log("kong-keepalive: OK — upstream keep-alive pooling is disabled.");
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error("");
  console.error(`kong-keepalive: ${String(err)}`);
  console.error("");
  console.error("  The local stack must be running before this step — `npx supabase start`.");
  console.error("  Nothing was changed unless a message above says otherwise.");
  process.exitCode = 1;
}
