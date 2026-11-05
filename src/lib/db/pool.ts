/** Pool defaults for the Neon pooler. */
export function withPoolSettings(raw: string, nodeEnv: string | undefined = process.env.NODE_ENV) {
  const queryIndex = raw.indexOf("?");
  const base = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : raw.slice(queryIndex + 1));
  const pooled = base.includes("-pooler.");
  if (pooled) {
    params.set("pgbouncer", "true");
    // The Neon pooler is PgBouncer. It cannot finish SCRAM channel binding.
    // channel_binding=require makes Prisma wait for connect_timeout, then fail with P1001.
    params.set("channel_binding", "disable");
  }
  if (!params.has("connection_limit")) {
    // A wide pool made Neon open many new connections at once. Each of those
    // waited about 15 seconds, so saving sign-in details sat behind them.
    params.set("connection_limit", "5");
  }
  if (!params.has("pool_timeout")) params.set("pool_timeout", nodeEnv === "production" ? "10" : "20");
  if (!params.has("connect_timeout")) params.set("connect_timeout", nodeEnv === "production" ? "10" : "30");
  // Keep a live connection for a minute. A short idle limit was reconnecting on every pause,
  // and each new connection to Neon costs a few seconds.
  if (!params.has("max_idle_connection_lifetime")) params.set("max_idle_connection_lifetime", "90");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function poolTag(url: string) {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  return `${params.get("connection_limit") ?? ""}/${params.get("pool_timeout") ?? ""}/${params.get("connect_timeout") ?? ""}/${params.get("max_idle_connection_lifetime") ?? ""}/${params.get("channel_binding") ?? ""}`;
}
