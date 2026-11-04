type Slot = { until: number; value: unknown };

const slots = new Map<string, Slot>();
const flights = new Map<string, Promise<unknown>>();

/** Reuses a recent result and shares one in-flight load across callers. */
export async function rememberFor<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
): Promise<T> {
  const hit = slots.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const pending = flights.get(key);
  if (pending) return pending as Promise<T>;
  const flight = load()
    .then((value) => {
      if (keep(value)) slots.set(key, { until: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      flights.delete(key);
    });
  flights.set(key, flight);
  return flight;
}

export function forgetRemembered(prefix: string) {
  for (const key of slots.keys()) {
    if (key.startsWith(prefix)) slots.delete(key);
  }
}
