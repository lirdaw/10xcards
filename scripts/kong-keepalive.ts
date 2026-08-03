// Everything about the Kong keep-alive recreation that can be decided WITHOUT touching
// Docker. No child_process, no filesystem, no console — all of that lives in the runner
// beside this file (./disable-kong-keepalive.ts), which is what makes this half testable
// with ordinary fixtures. Same split as scripts/schema-drift.ts, and here the reason is
// sharper: the runner removes the local stack's only proxy and puts it back, so a mistake
// in the argument vector below leaves a developer with no API on 54321.
//
// Why the recreation exists at all: Kong 2.8.1 and PostgREST/warp both idle out a
// keep-alive connection at exactly 60 s (measured, C10X-39 research). Equal timeouts are
// the pathological configuration — neither side reliably closes first, so whichever wins
// the race decides whether the next request finds a live socket, and the loser answers
// `502 upstream prematurely closed connection`. No supported Supabase CLI surface exposes
// either timeout: Kong's container env is a hardcoded Go slice, `kong.yml` is `//go:embed`-ed,
// and PostgREST has never had a keep-alive knob. So the lever is the one Kong issue #11160
// names as the community workaround — disable upstream pooling entirely — applied by
// recreating the container after `supabase start`.
//
// Why both files sit in `scripts/` rather than `src/`: the runner prints, and
// tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. Keeping this
// half next to it makes their import a sibling instead of the deep relative `../src/lib/…`
// path AGENTS.md's first Hard Rule forbids (the `@/*` alias does not resolve under Node's
// type stripping).

/**
 * The lever, as an environment variable.
 *
 * Pinned as a value rather than described in prose because Kong **silently ignores an env
 * var it does not recognise** — a typo here produces a container that starts perfectly and
 * changes nothing. That is precisely why `.kong_env` (below) is read back afterwards rather
 * than trusting the `docker run` exit code.
 *
 * `0` disables upstream keep-alive pooling outright, costing one TCP handshake per
 * Kong→PostgREST request. Lowering `upstream_keepalive_idle_timeout` instead is reported as
 * ineffective (Kong discussion #14417); the pool size is the lever that works.
 */
export const KONG_KEEPALIVE_ENV = {
  key: "KONG_UPSTREAM_KEEPALIVE_POOL_SIZE",
  value: "0",
} as const;

/**
 * The same key at Kong 2.8.1's own default — i.e. a deliberately UNFIXED container.
 *
 * It exists because "stock" cannot be expressed by leaving the variable out, which is the
 * one thing about this module that was measured rather than reasoned about. `docker commit`
 * bakes `Config.Env` into the image, so once the runner has committed an already-recreated
 * container the image itself carries `…POOL_SIZE=0`, and a vector that merely omits the `-e`
 * inherits it. Observed live on 2026-08-01: the "lever-less" restore came back up reading
 * `upstream_keepalive_pool_size = 0`.
 *
 * Harmless for the restore path; fatal for the before/after measurement's stock-pool control,
 * which must reproduce the flake at 60 — it would have produced no drops and been recorded as
 * *inconclusive*, discarding a real result because of a tooling bug.
 *
 * The number is pinned as a value for the same reason `KONG_KEEPALIVE_ENV` is: a wrong one
 * turns the control into a measurement of a third configuration nobody actually runs.
 */
export const KONG_KEEPALIVE_STOCK = {
  key: KONG_KEEPALIVE_ENV.key,
  value: "60",
} as const;

/** The two Docker object names the CLI derives from `project_id` in supabase/config.toml. */
export interface ContainerNames {
  /** The container `docker rm -f` targets and `docker exec` reads `.kong_env` from. */
  container: string;
  /** The network the replacement must rejoin, or it cannot reach PostgREST at all. */
  network: string;
}

/**
 * Both names, derived the way the Supabase CLI derives them.
 *
 * Kept as a function over `project_id` rather than as two literals so the runner reads the
 * id out of `supabase/config.toml` and a developer with a different `project_id` is not
 * silently operating on a container that is not theirs — or, worse, on nothing at all, since
 * `docker rm -f` on an absent name is the one failure that looks like a no-op.
 */
export function containerNames(projectId: string): ContainerNames {
  return {
    container: `supabase_kong_${projectId}`,
    network: `supabase_network_${projectId}`,
  };
}

/** The three settings that describe Kong's upstream keep-alive behaviour. */
export interface KeepAliveSettings {
  /** `null` when Kong's dump carries no such key — NOT the same as `0`, see below. */
  poolSize: number | null;
  maxRequests: number | null;
  idleTimeout: number | null;
}

/** `key = value`, which is the only shape `.kong_env` uses. Comments start with `#`. */
const SETTING_LINE = /^([a-z_]+)\s*=\s*(.*)$/;

/**
 * Parse `/usr/local/kong/.kong_env` — Kong's own dump of every setting it actually resolved.
 *
 * This is the adoption oracle for the whole unsupported operation. `docker run -e …` reports
 * success whether or not Kong understood the variable, so the dump is the only thing that
 * can tell "Kong took the setting" from "Kong started fine and ignored it".
 *
 * A missing key reads as `null`, never as `0`. The distinction is load-bearing rather than
 * pedantic: a future Kong that renamed the setting would emit no `upstream_keepalive_pool_size`
 * line at all, and a parser defaulting to zero would report the lever as adopted while the
 * flake was untouched — the exact false green this module exists to prevent.
 */
export function parseKongEnv(dump: string): KeepAliveSettings {
  const settings = new Map<string, string>();

  for (const rawLine of dump.split("\n")) {
    const line = rawLine.trim();
    // The first seven lines of every real dump are a `#` banner, and one of them contains
    // the word `configuration` — splitting on `=` without skipping comments reads the
    // banner as settings.
    if (line === "" || line.startsWith("#")) continue;

    // Both groups are non-optional in `SETTING_LINE`, so a match always carries both — but
    // `noUncheckedIndexedAccess` types them `string | undefined` and the narrowing is what
    // keeps the "missing key reads as null, never 0" property above true by construction.
    const [, key, value] = SETTING_LINE.exec(line) ?? [];
    if (key !== undefined && value !== undefined) settings.set(key, value.trim());
  }

  const numberAt = (key: string): number | null => {
    const raw = settings.get(key);
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    poolSize: numberAt("upstream_keepalive_pool_size"),
    maxRequests: numberAt("upstream_keepalive_max_requests"),
    idleTimeout: numberAt("upstream_keepalive_idle_timeout"),
  };
}

/**
 * Has Kong adopted the lever?
 *
 * The runner exits 0 on this and only this. `null` is false by construction — see
 * `parseKongEnv` on why an absent key must never read as a disabled pool.
 */
export function isKeepAlivePoolDisabled(settings: KeepAliveSettings): boolean {
  return settings.poolSize === 0;
}

/** One `KEY=VALUE` environment entry, the shape both `docker inspect` and `-e` use. */
export interface EnvVar {
  key: string;
  value: string;
}

/**
 * A Kong container's runtime spec, transcribed from `docker inspect` with as little
 * translation as possible — the field names and value SHAPES are Docker's own, so the
 * runner's job is field selection rather than interpretation, and the shapes that are easy
 * to get wrong are pinned by this module's tests instead of living in the runner.
 *
 * `Cmd` is deliberately absent, and that absence is a design decision rather than an
 * omission: on the real container `.Config.Cmd` is **null** and `.Config.Entrypoint` is a
 * single `sh -c` heredoc the CLI installed at create time, which writes `kong.yml`, the
 * custom nginx template and a TLS keypair before exec'ing Kong. It lives on the container
 * and in no image, so the runner commits the container first and the replacement inherits
 * the heredoc from the committed image — no command, no `--entrypoint`, and the recreated
 * container therefore differs from the original in exactly one thing: the extra `-e`.
 */
export interface KongContainerSpec {
  /** The name to give the replacement — `containerNames(projectId).container`. */
  name: string;
  /** The image to run: the tag `docker commit` just wrote, never the upstream Kong image. */
  image: string;
  /** `.Config.User` */
  user: string;
  /** `.Config.Labels` */
  labels: Record<string, string>;
  /** `.Config.Env`, as `KEY=VALUE` strings. */
  env: string[];
  /** `.HostConfig.RestartPolicy.Name` */
  restartPolicy: string;
  /**
   * `.HostConfig.PortBindings`. The value is nullable because Docker reports `null` for a
   * port that is exposed but not published — treating that as an array is a crash, not a
   * mis-publish.
   */
  portBindings: Record<string, { HostIp?: string; HostPort: string }[] | null>;
  /** The network to rejoin — `containerNames(projectId).network`. */
  network: string;
  /** `.NetworkSettings.Networks[network].Aliases` */
  aliases: string[];
  /** `.Config.Healthcheck`, with Docker's **nanosecond** durations left as reported. */
  healthcheck: {
    Test: string[];
    Interval: number;
    Timeout: number;
    Retries: number;
  } | null;
}

/**
 * Docker reports healthcheck durations in nanoseconds and `docker run` accepts a duration
 * STRING, so this conversion is the one place the two representations meet.
 *
 * Passing the inspected number through unconverted is not a cosmetic slip: it yields
 * `--health-interval 10000000000`, roughly 317 years, so the container never leaves
 * `starting`, the runner's health wait times out, and the restore path fires over a Kong
 * that was working all along.
 */
function nanosToDuration(nanos: number): string {
  if (nanos % 1_000_000_000 === 0) return `${nanos / 1_000_000_000}s`;
  return `${Math.round(nanos / 1_000_000)}ms`;
}

/**
 * `{ "8000/tcp": [{ HostIp: "", HostPort: "54321" }] }` → `54321:8000`.
 *
 * `/tcp` is dropped because it is `docker run`'s default and re-stating it is noise; any
 * other protocol is kept, since dropping THAT would silently publish the wrong port.
 */
function publishSpecs(portBindings: KongContainerSpec["portBindings"]): string[] {
  const specs: string[] = [];

  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    const port = containerPort.endsWith("/tcp") ? containerPort.slice(0, -"/tcp".length) : containerPort;
    for (const binding of bindings ?? []) {
      specs.push(binding.HostIp ? `${binding.HostIp}:${binding.HostPort}:${port}` : `${binding.HostPort}:${port}`);
    }
  }

  return specs;
}

/**
 * The `docker run` argument vector that recreates Kong from the committed image with upstream
 * keep-alive pooling disabled.
 *
 * Everything is reproduced **from the inspected spec**, never from literals, so a Supabase
 * CLI that changes a port, an alias or a label produces a faithful replacement rather than a
 * container built to last year's shape. The one thing this function adds is the extra `-e`.
 *
 * Two properties are worth stating because neither is visible from the return type:
 *
 * - **The vector ends at the image reference.** No command and no `--entrypoint`: the
 *   committed image already carries the CLI's own startup heredoc (see `KongContainerSpec`).
 *   A command appended here would be swallowed by that `sh -c` script as ignored positional
 *   args — the container would still come up and `.kong_env` would still read 0 — so this is
 *   an absence nothing else in the vector can reveal, and it has its own test.
 * - **It is idempotent.** The lever is stripped from the pass-through and appended exactly
 *   once, so re-running against an already-recreated container yields the identical vector
 *   rather than accumulating a second `-e` per run.
 *
 * @param lever the pool size this container is to run at. There is deliberately **no option
 *   to emit nothing**: `docker commit` bakes the value into the image, so omitting the `-e`
 *   silently inherits whatever the committed container had — see `KONG_KEEPALIVE_STOCK`,
 *   which every caller wanting an unfixed container passes instead. Making the caller always
 *   state the size renders that trap unrepresentable rather than merely documented.
 */
export function buildRunArgs(spec: KongContainerSpec, lever: EnvVar = KONG_KEEPALIVE_ENV): string[] {
  const args = ["run", "-d", "--name", spec.name, "--user", spec.user, "--restart", spec.restartPolicy];

  args.push("--network", spec.network);
  for (const alias of spec.aliases) args.push("--network-alias", alias);
  for (const publish of publishSpecs(spec.portBindings)) args.push("-p", publish);

  // Every label, not just the two the CLI sets. `maintainer` rides along from the image and
  // is re-set to the value it would inherit anyway, so the superset costs nothing — while an
  // allowlist of two would silently drop a label a future CLI starts relying on. The two
  // that matter are `com.supabase.cli.project` and `com.docker.compose.project`: without
  // them `supabase stop` orphans this container, and it then collides on the name at the
  // next `supabase start`.
  for (const [key, value] of Object.entries(spec.labels)) args.push("--label", `${key}=${value}`);

  if (spec.healthcheck && spec.healthcheck.Test[0] !== "NONE") {
    // `["CMD-SHELL", "kong health"]` is what the CLI sets. The `CMD` form has no exact
    // `docker run` equivalent — `--health-cmd` is always shell-interpreted — so joining is
    // the closest faithful reading rather than a shortcut.
    const [form, ...rest] = spec.healthcheck.Test;
    args.push(
      "--health-cmd",
      form === "CMD-SHELL" || form === "CMD" ? rest.join(" ") : spec.healthcheck.Test.join(" "),
    );
    args.push("--health-interval", nanosToDuration(spec.healthcheck.Interval));
    args.push("--health-timeout", nanosToDuration(spec.healthcheck.Timeout));
    args.push("--health-retries", String(spec.healthcheck.Retries));
  }

  // The lever is filtered out of the pass-through and re-appended below, which is what makes
  // the vector idempotent. Appending it LAST also means it wins outright: `docker run` takes
  // the last occurrence of a repeated key.
  for (const entry of spec.env) {
    if (entry.startsWith(`${lever.key}=`)) continue;
    args.push("-e", entry);
  }
  args.push("-e", `${lever.key}=${lever.value}`);

  // Last, and nothing after it.
  args.push(spec.image);

  return args;
}
