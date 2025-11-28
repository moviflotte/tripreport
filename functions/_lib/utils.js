// -------- PinMe API Helpers --------
export async function pinmeFetchJson(env, path, cookieHeader, options = {}) {
  const PINME_BASE = env.PINME_BASE || env.PINME_BASE_URL || "https://api.pinme.io/api";
  const url = PINME_BASE + path;
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${res.statusText} :: ${t}`);
  }
  return res.json();
}

// -------- Concurrency Control --------
export async function mapWithConcurrency(items, limit, mapper) {
  const out = [];
  const running = new Set();
  let i = 0;
  const run = async (idx) => {
    const p = Promise.resolve().then(() => mapper(items[idx], idx));
    running.add(p);
    try { out[idx] = await p; } finally { running.delete(p); }
  };
  while (i < items.length) {
    while (running.size < limit && i < items.length) run(i++);
    if (running.size) await Promise.race(running);
  }
  await Promise.all(running);
  return out;
}

// -------- Formatting Utils --------
export function roundN(num, n = 2) {
  const f = Math.pow(10, n);
  return Math.round((Number(num) || 0) * f) / f;
}

const pad = (n) => String(n).padStart(2, "0");

export function fmtDateUTC(iso) {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
}

export function fmtTimeUTC(iso) {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function fmtDuration(ms) {
  if (ms == null || ms < 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// -------- Distance & Speed --------
export const KNOT_TO_KMH = 1.852;

export function approxDistance1Dec(num) {
  const two = roundN(num, 2);
  return roundN(two, 1);
}