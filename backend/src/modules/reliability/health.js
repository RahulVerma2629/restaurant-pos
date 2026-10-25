// Liveness = "process is up". Readiness = "dependencies work, send me traffic".
const checks = new Map();
const startedAt = Date.now();

export function registerReadinessCheck(name, fn) {
  checks.set(name, fn);
}
export const clearReadinessChecks = () => checks.clear();

export async function runReadiness(timeoutMs = 2000) {
  const out = {};
  let ok = true;
  for (const [name, fn] of checks) {
    const t0 = Date.now();
    try {
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      out[name] = { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      ok = false;
      out[name] = { ok: false, error: e.message };
    }
  }
  return { ok, checks: out };
}

export const uptimeSeconds = () => Math.round((Date.now() - startedAt) / 1000);
