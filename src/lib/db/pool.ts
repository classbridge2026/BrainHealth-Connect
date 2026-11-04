/** Pool defaults for the Neon pooler. */
export function withPoolSettings(raw: string, nodeEnv: string | undefined = process.env.NODE_ENV) {
  const queryIndex = raw.indexOf("?");
  const base = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : raw.slice(queryIndex + 1));
  const pooled = base.includes("-pooler.");
  if (pooled) params.set("pgbouncer", "true");
  if (!params.has("connection_limit")) {
    // One connection made every admin page wait in line for its own counts.
    // Ten connections exhausted the Neon pooler. Five lets one page overlap
    // its reads without holding a large idle pool.
    params.set("connection_limit", nodeEnv === "production" ? "5" : "15");
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
  return `${params.get("connection_limit") ?? ""}/${params.get("pool_timeout") ?? ""}/${params.get("connect_timeout") ?? ""}/${params.get("max_idle_connection_lifetime") ?? ""}`;
}
