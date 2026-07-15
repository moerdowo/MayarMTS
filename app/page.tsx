"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DitherGradient } from "@/components/dither-kit/gradient";
import { hueFill } from "@/components/dither-kit/pixel";
import { rgb as rgbStr } from "@/components/dither-kit/palette";

/* ---------- constants ---------- */

const KEY_LS = "mayar_monitor_apikey";
const DEMO_LS = "mayar_monitor_demo";
const AGG_LS = "mayar_monitor_agg_v1";
const SETTINGS_LS = "mayar_monitor_settings_v1";
const TX_API = "/api/transactions";

const ACCENTS: Record<string, string> = {
  "Phosphor Green": "#2dff8a",
  Amber: "#ffb000",
  Cyan: "#3df0ff",
  "Mayar Blue": "#4d8dff",
};

type Theme = "crt" | "dither";

type Settings = {
  accent: string;
  theme: Theme;
  ditherHue: number; // 0–360, drives the Dither theme's colour
  refreshSeconds: number;
  scanlines: boolean;
  compactNumbers: boolean;
  showTicker: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  accent: "Phosphor Green",
  theme: "crt",
  ditherHue: 150, // phosphor green, to match the CRT identity
  refreshSeconds: 60,
  scanlines: true,
  compactNumbers: false,
  showTicker: true,
};

/** Accent colour for the Dither theme — the chosen hue as an rgb() string. */
const ditherAccent = (hue: number) => rgbStr(hueFill(hue));

type Tx = { id: string; amount: number; ms: number; name: string };
type Screen = "loading" | "setup" | "dashboard";
type Status = "connecting" | "live" | "demo" | "error";

/* ---------- formatting ---------- */

function fmtRp(n: number, compact: boolean) {
  n = Math.round(n || 0);
  if (compact && Math.abs(n) >= 1e6)
    return (
      "Rp " +
      new Intl.NumberFormat("id-ID", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n)
    );
  return "Rp " + n.toLocaleString("id-ID");
}

function fmtInt(n: number) {
  return Math.round(n || 0).toLocaleString("id-ID");
}

function hhmmss(ms: number) {
  try {
    return new Date(ms).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Jakarta",
    });
  } catch {
    return "--:--:--";
  }
}

/* Mayar API keys are JWTs whose payload carries the merchant identity
   ({ name, link, sub, ... }) — there is no profile endpoint, so decode it
   locally. Returns '' if the key isn't a parseable JWT. */
function merchantFromKey(key: string): string {
  try {
    const part = key.split(".")[1];
    const json = JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    );
    return (json.name || json.link || "").toString();
  } catch {
    return "";
  }
}

function maskName(s: string) {
  s = (s || "").trim();
  if (!s) return "Pelanggan";
  const at = s.indexOf("@");
  if (at > 1) return s.slice(0, 2) + "•••" + s.slice(at);
  const p = s.split(/\s+/);
  return p[0] + (p[1] ? " " + p[1][0].toUpperCase() + "•••" : " •••");
}

/* ---------- Mayar paid-transaction normalization ----------
   Real shape (docs.mayar.id, GET /hl/v1/transactions):
   { id, credit, status, paymentMethod, createdAt(epoch ms),
     customer: { name, email, mobile }, paymentLink: {...} } */
function normTx(t: Record<string, any>): Tx {
  const amount =
    Number(t.credit ?? t.amount ?? t.total ?? t.totalAmount ?? 0) || 0;
  const ts = t.createdAt ?? t.paidAt ?? t.created_at ?? t.updatedAt;
  let ms: number;
  if (typeof ts === "number") ms = ts < 1e12 ? ts * 1000 : ts;
  else {
    ms = Date.parse(ts);
    if (isNaN(ms)) ms = Date.now();
  }
  const name =
    (t.customer && (t.customer.name || t.customer.email)) ||
    t.customerName ||
    t.customerEmail ||
    t.name ||
    "Pelanggan";
  const id = String(t.id || t.transactionId || ms + "-" + amount + "-" + name);
  return { id, amount, ms, name };
}

/* ---------- demo data ---------- */

const DEMO_NAMES = [
  "Andi Wijaya", "Sari Putri", "Budi Santoso", "Rina Melati",
  "Dewi Anggraini", "Agus Pratama", "Putri Maharani", "Bayu Saputra",
  "Fitri Handayani", "Eko Nugroho", "Maya Lestari", "Rizki Ramadhan",
  "Nina Kusuma", "Tono Hartanto", "Wulan Sari", "Galih Permana",
];
const DEMO_AMTS = [
  25000, 35000, 49000, 59000, 75000, 99000, 120000, 149000, 199000,
  249000, 349000, 499000, 750000, 1200000,
];
const randAmt = () => DEMO_AMTS[Math.floor(Math.random() * DEMO_AMTS.length)];
const randName = () =>
  DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];

/* ===================== component ===================== */

export default function MayarMonitor() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncPages, setSyncPages] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [targets, setTargets] = useState({
    lifetimeVolume: 0,
    totalTx: 0,
    todayVolume: 0,
    txPerHour: 0,
  });
  const [disp, setDisp] = useState({
    dispVolume: 0,
    dispTotal: 0,
    dispToday: 0,
    dispHour: 0,
  });
  const [buckets, setBuckets] = useState<{ count: number; vol: number }[]>([]);
  const [recent, setRecent] = useState<Tx[]>([]);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [merchantName, setMerchantName] = useState("");
  const [clock, setClock] = useState("");
  const [now, setNow] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // mutable aggregates (mirrors the design prototype's instance fields)
  const agg = useRef({
    apiKey: "",
    lifetime: 0,
    count: 0,
    apiTotal: 0, // totalTransaction reported by the Mayar API
    lastSeenMs: 0,
    window: [] as Tx[],
    seenIds: new Set<string>(),
  });
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const clearTimers = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (demoTimer.current) clearInterval(demoTimer.current);
    refreshTimer.current = null;
    demoTimer.current = null;
  }, []);

  const resetAgg = useCallback(() => {
    const a = agg.current;
    a.lifetime = 0;
    a.count = 0;
    a.apiTotal = 0;
    a.lastSeenMs = 0;
    a.window = [];
    a.seenIds = new Set();
  }, []);

  /* ---------- aggregation ---------- */

  const recompute = useCallback(() => {
    const a = agg.current;
    const nowMs = Date.now();
    const ds = new Date();
    ds.setHours(0, 0, 0, 0);
    const dayStart = ds.getTime();
    let today = 0,
      hour = 0;
    const bk = Array.from({ length: 24 }, () => ({ count: 0, vol: 0 }));
    for (const t of a.window) {
      if (t.ms >= dayStart) today += t.amount;
      if (t.ms >= nowMs - 3600000) hour++;
      const diffH = Math.floor((nowMs - t.ms) / 3600000);
      if (diffH >= 0 && diffH < 24) {
        const idx = 23 - diffH;
        bk[idx].count++;
        bk[idx].vol += t.amount;
      }
    }
    const rec = [...a.window].sort((x, y) => y.ms - x.ms).slice(0, 8);
    setTargets({
      lifetimeVolume: a.lifetime,
      totalTx: a.apiTotal || a.count,
      todayVolume: today,
      txPerHour: hour,
    });
    setBuckets(bk);
    setRecent(rec);
    setLastUpdated(nowMs);
  }, []);

  const ingest = useCallback(
    (list: Tx[], opts: { full?: boolean; incremental?: boolean }) => {
      const a = agg.current;
      if (opts.full) resetAgg();
      list.sort((x, y) => x.ms - y.ms);
      for (const t of list) {
        if (a.seenIds.has(t.id)) continue;
        if (opts.incremental && a.lastSeenMs && t.ms <= a.lastSeenMs) continue;
        a.seenIds.add(t.id);
        a.lifetime += t.amount;
        a.count += 1;
        a.window.push(t);
        if (t.ms > a.lastSeenMs) a.lastSeenMs = t.ms;
      }
      const cutoff = Date.now() - 48 * 3600000;
      a.window = a.window.filter((t) => t.ms >= cutoff).slice(-1200);
      recompute();
    },
    [recompute, resetAgg]
  );

  /* ---------- persistence ---------- */

  const saveAgg = useCallback(() => {
    const a = agg.current;
    try {
      localStorage.setItem(
        AGG_LS,
        JSON.stringify({
          lifetime: a.lifetime,
          count: a.count,
          apiTotal: a.apiTotal,
          lastSeenMs: a.lastSeenMs,
          window: a.window.slice(-600),
        })
      );
    } catch {}
  }, []);

  const loadAgg = useCallback(() => {
    try {
      const r = localStorage.getItem(AGG_LS);
      if (!r) return false;
      const s = JSON.parse(r);
      const a = agg.current;
      a.lifetime = s.lifetime || 0;
      a.count = s.count || 0;
      a.apiTotal = s.apiTotal || 0;
      a.lastSeenMs = s.lastSeenMs || 0;
      a.window = Array.isArray(s.window) ? s.window : [];
      a.seenIds = new Set(a.window.map((t: Tx) => t.id));
      recompute();
      return true;
    } catch {
      return false;
    }
  }, [recompute]);

  /* ---------- live fetch ---------- */

  const fetchPage = useCallback(
    async (page: number, pageSize: number, attempt = 0): Promise<{
      txs: Tx[];
      hasMore: boolean;
      pageCount: number;
      total: number;
    }> => {
      const res = await fetch(`${TX_API}?page=${page}&pageSize=${pageSize}`, {
        headers: { "x-mayar-key": agg.current.apiKey },
      });
      if (res.status === 401 || res.status === 403)
        throw new Error("INVALID API KEY (" + res.status + ")");
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          return fetchPage(page, pageSize, attempt + 1);
        }
        throw new Error("HTTP " + res.status);
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const arr: any[] = Array.isArray(j?.data)
        ? j.data
        : Array.isArray(j?.data?.docs)
          ? j.data.docs
          : Array.isArray(j)
            ? j
            : [];
      return {
        txs: arr.map(normTx),
        hasMore: j?.hasMore === true,
        pageCount: Number(j?.pageCount) || 0,
        total: Number(j?.totalTransaction) || 0,
      };
    },
    []
  );

  const refreshLive = useCallback(async () => {
    try {
      const PS = 100;
      let page = 1;
      let all: Tx[] = [];
      while (page <= 4) {
        const { txs, hasMore, total } = await fetchPage(page, PS);
        all = all.concat(txs);
        if (total) agg.current.apiTotal = total;
        if (!hasMore && txs.length < PS) break;
        page++;
      }
      ingest(all, { incremental: true });
      setStatus("live");
      setErrorMsg("");
      saveAgg();
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message || "CONNECTION FAILED");
    }
  }, [fetchPage, ingest, saveAgg]);

  const startLive = useCallback(
    async (refreshSeconds: number) => {
      clearTimers();
      setStatus("connecting");
      setErrorMsg("");
      const hadCache = loadAgg();
      setSyncing(true);
      setSyncPages(0);
      setSyncTotal(0);
      try {
        const PS = 100;
        if (hadCache) {
          await refreshLive();
        } else {
          // full sync: page 1 tells us how many pages exist, then fetch the
          // rest in small concurrent batches (the API has no documented rate
          // limit; fetchPage retries 429/5xx with backoff)
          const MAX_PAGES = 500;
          const BATCH = 4;
          const first = await fetchPage(1, PS);
          const pages = Math.min(first.pageCount || 1, MAX_PAGES);
          setSyncTotal(pages);
          setSyncPages(1);
          let all: Tx[] = first.txs;
          let stop = !first.hasMore && first.txs.length < PS;
          for (let p = 2; p <= pages && !stop; p += BATCH) {
            const nums = [];
            for (let q = p; q <= Math.min(p + BATCH - 1, pages); q++)
              nums.push(q);
            const batch = await Promise.all(
              nums.map((pg) => fetchPage(pg, PS))
            );
            for (const b of batch) all = all.concat(b.txs);
            setSyncPages(nums[nums.length - 1]);
            const last = batch[batch.length - 1];
            stop = !last.hasMore && last.txs.length < PS;
          }
          ingest(all, { full: true }); // resets aggregates, so set apiTotal after
          if (first.total) {
            agg.current.apiTotal = first.total;
            recompute();
          }
          setStatus("live");
          setErrorMsg("");
          saveAgg();
        }
        setSyncing(false);
      } catch (e: any) {
        setStatus("error");
        setSyncing(false);
        setErrorMsg(e?.message || "CONNECTION FAILED");
      }
      const sec = Math.max(60, refreshSeconds || 60);
      refreshTimer.current = setInterval(() => refreshLive(), sec * 1000);
    },
    [clearTimers, fetchPage, ingest, loadAgg, recompute, refreshLive, saveAgg]
  );

  /* ---------- demo ---------- */

  const demoIncoming = useCallback(() => {
    const a = agg.current;
    const n = 1 + Math.floor(Math.random() * 3);
    const nowMs = Date.now();
    for (let i = 0; i < n; i++) {
      const amt = randAmt();
      a.window.push({
        id: "live-" + nowMs + "-" + i,
        amount: amt,
        ms: nowMs - i * 250,
        name: randName(),
      });
      a.lifetime += amt;
      a.count += 1;
    }
    a.lastSeenMs = nowMs;
    const cutoff = nowMs - 48 * 3600000;
    a.window = a.window.filter((t) => t.ms >= cutoff).slice(-1400);
    recompute();
  }, [recompute]);

  const startDemo = useCallback(() => {
    clearTimers();
    resetAgg();
    const a = agg.current;
    a.apiKey = "";
    a.lifetime = 16721122619;
    a.count = 204725;
    const nowMs = Date.now();
    for (let h = 23; h >= 0; h--) {
      const base =
        70 +
        Math.round(60 * Math.sin((h / 24) * Math.PI * 2 + 1)) +
        Math.floor(Math.random() * 40);
      const cnt = Math.max(18, base);
      for (let i = 0; i < cnt; i++) {
        const ms = nowMs - h * 3600000 - Math.floor(Math.random() * 3600000);
        a.window.push({
          id: "d" + h + "-" + i,
          amount: randAmt(),
          ms,
          name: randName(),
        });
      }
    }
    a.lastSeenMs = nowMs;
    recompute();
    setMerchantName("TOKO DEMO");
    setScreen("dashboard");
    setStatus("demo");
    demoTimer.current = setInterval(() => demoIncoming(), 3200);
  }, [clearTimers, demoIncoming, recompute, resetAgg]);

  /* ---------- boot ---------- */

  useEffect(() => {
    let stored = DEFAULT_SETTINGS;
    try {
      const raw = localStorage.getItem(SETTINGS_LS);
      if (raw) stored = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {}
    stored.refreshSeconds = Math.min(
      300,
      Math.max(60, stored.refreshSeconds || 60)
    );
    stored.theme = stored.theme === "dither" ? "dither" : "crt";
    stored.ditherHue = ((Math.round(stored.ditherHue) % 360) + 360) % 360;
    setSettings(stored);

    const demo = localStorage.getItem(DEMO_LS) === "1";
    const key = localStorage.getItem(KEY_LS);
    if (demo) startDemo();
    else if (key) {
      agg.current.apiKey = key;
      setMerchantName(merchantFromKey(key));
      setScreen("dashboard");
      startLive(stored.refreshSeconds);
    } else setScreen("setup");

    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* clock */
  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta" })
      );
      setNow(Date.now());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  /* count-up tween (~30fps) */
  useEffect(() => {
    const id = setInterval(() => {
      setDisp((c) => {
        const t = targetsRef.current;
        const pairs: [keyof typeof c, number][] = [
          ["dispVolume", t.lifetimeVolume],
          ["dispTotal", t.totalTx],
          ["dispToday", t.todayVolume],
          ["dispHour", t.txPerHour],
        ];
        let changed = false;
        const next = { ...c };
        for (const [k, target] of pairs) {
          const cur = c[k];
          if (Math.abs(target - cur) < 0.5) {
            if (cur !== target) {
              next[k] = target;
              changed = true;
            }
            continue;
          }
          next[k] = cur + (target - cur) * 0.14;
          changed = true;
        }
        return changed ? next : c;
      });
    }, 33);
    return () => clearInterval(id);
  }, []);

  /* ---------- handlers ---------- */

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_LS, JSON.stringify(next));
      } catch {}
      if (
        patch.refreshSeconds !== undefined &&
        refreshTimer.current &&
        status !== "demo"
      ) {
        clearInterval(refreshTimer.current);
        const sec = Math.max(60, next.refreshSeconds || 60);
        refreshTimer.current = setInterval(() => refreshLive(), sec * 1000);
      }
      return next;
    });
  };

  const connect = () => {
    const k = keyInput.trim();
    if (!k) {
      setSetupError("API key is required.");
      return;
    }
    localStorage.setItem(KEY_LS, k);
    localStorage.removeItem(DEMO_LS);
    localStorage.removeItem(AGG_LS);
    agg.current.apiKey = k;
    resetAgg();
    setMerchantName(merchantFromKey(k));
    setScreen("dashboard");
    setSetupError("");
    setStatus("connecting");
    startLive(settings.refreshSeconds);
  };

  const useDemo = () => {
    localStorage.setItem(DEMO_LS, "1");
    localStorage.removeItem(KEY_LS);
    startDemo();
  };

  const disconnect = () => {
    localStorage.removeItem(KEY_LS);
    localStorage.removeItem(DEMO_LS);
    localStorage.removeItem(AGG_LS);
    clearTimers();
    resetAgg();
    agg.current.apiKey = "";
    setScreen("setup");
    setMerchantName("");
    setKeyInput("");
    setSetupError("");
    setStatus("connecting");
    setTargets({ lifetimeVolume: 0, totalTx: 0, todayVolume: 0, txPerHour: 0 });
    setDisp({ dispVolume: 0, dispTotal: 0, dispToday: 0, dispHour: 0 });
    setBuckets([]);
    setRecent([]);
    setLastUpdated(0);
    setSettingsOpen(false);
  };

  /* ---------- derived render values ---------- */

  const accentColor =
    settings.theme === "dither"
      ? ditherAccent(settings.ditherHue)
      : ACCENTS[settings.accent] || "#2dff8a";
  const hasData = lastUpdated > 0;
  const DASH = "———";

  const statusMap: Record<Status, [string, string]> = {
    live: ["LIVE", accentColor],
    demo: ["DEMO", accentColor],
    connecting: ["SYNC", "#e0b54a"],
    error: ["OFFLINE", "#ff6a6a"],
  };
  const [statusLabel, statusColor] = statusMap[status];

  const bk = buckets.length
    ? buckets
    : Array.from({ length: 24 }, () => ({ count: 0, vol: 0 }));
  const maxCount = Math.max(1, ...bk.map((b) => b.count));
  const bars = bk.map((b) => (5 + 95 * (b.count / maxCount)).toFixed(1) + "%");

  const ticker = recent.map((t) => ({
    id: t.id,
    time: hhmmss(t.ms),
    name: maskName(t.name),
    amount: fmtRp(t.amount, false),
  }));

  const agoStr = (() => {
    if (!lastUpdated) return "—";
    const s = Math.max(0, Math.round((now - lastUpdated) / 1000));
    if (s < 60) return s + "S AGO";
    return Math.floor(s / 60) + "M AGO";
  })();

  const sec = Math.max(60, settings.refreshSeconds || 60);
  let footerStatus: string;
  if (status === "demo") footerStatus = "◆ DEMO DATA · SIMULATED FEED · NOT LIVE";
  else if (status === "error")
    footerStatus =
      "✕ OFFLINE · " +
      (errorMsg || "CONNECTION FAILED") +
      (hasData ? " · SHOWING CACHED" : "");
  else if (status === "connecting")
    footerStatus = syncing
      ? "⟳ SYNCING" +
        (syncPages
          ? " · PAGE " + syncPages + (syncTotal ? "/" + syncTotal : "")
          : "") +
        "…"
      : "CONNECTING…";
  else footerStatus = "● LIVE · UPDATED " + agoStr + " · REFRESH " + sec + "S";

  const headerDate = new Date()
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    })
    .toUpperCase();

  /* ===================== render ===================== */

  return (
    <div
      className="crt-root"
      style={
        {
          "--acc": accentColor,
          "--status": statusColor,
        } as React.CSSProperties
      }
    >
      {settings.scanlines && <div className="scanlines" />}
      {settings.theme === "dither" ? (
        <DitherGradient
          from={settings.ditherHue}
          to="transparent"
          direction="up"
          cell={4}
          opacity={0.32}
          bloom="low"
          style={{ position: "fixed", zIndex: 1 }}
        />
      ) : (
        <div className="glow-top" />
      )}
      <div className="vignette" />

      {/* ===================== SETUP ===================== */}
      {screen === "setup" && (
        <div className="setup-wrap">
          <div className="setup-box">
            <div className="setup-brand">MAYAR</div>
            <div className="setup-title">
              TRANSACTION
              <br />
              MONITOR
              <span className="setup-caret">&nbsp;</span>
            </div>
            <div className="setup-sub">
              // live big-screen dashboard for your Mayar account
            </div>

            <div className="setup-label">ENTER API KEY</div>
            <div className="key-row">
              <input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setSetupError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") connect();
                }}
                placeholder="paste your secret API key"
                spellCheck={false}
                autoComplete="off"
                className="key-input"
              />
              <button
                className="btn-show"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "HIDE" : "SHOW"}
              </button>
            </div>
            {setupError && <div className="setup-error">! {setupError}</div>}
            <button className="btn-connect" onClick={connect}>
              CONNECT ▸
            </button>

            <div className="setup-links">
              <a
                href="https://web.mayar.id/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="link-getkey"
              >
                GET KEY → web.mayar.id/api-keys
              </a>
              <button className="btn-demo" onClick={useDemo}>
                explore with demo data
              </button>
            </div>
            <div className="setup-note">
              Stored only in this browser (localStorage). Requests are routed
              through this app&apos;s own serverless proxy to api.mayar.id over
              HTTPS — the key is never stored server-side.
            </div>
          </div>
        </div>
      )}

      {/* ===================== LOADING ===================== */}
      {screen === "loading" && (
        <div className="boot">
          BOOTING<span className="boot-caret">_</span>
        </div>
      )}

      {/* ===================== DASHBOARD ===================== */}
      {screen === "dashboard" && (
        <div className="dash">
          <div className="dash-header">
            <div className="logo-row">
              <div className="logo-dot" />
              <span className="logo-text">
                {(merchantName || "MAYAR").toUpperCase()}
              </span>
            </div>
            <div className="header-right">
              <div>{headerDate}</div>
              <div className="sub">TRANSACTION MONITOR</div>
            </div>
          </div>

          <div className="hero">
            <div className="hero-top">
              <span className="hero-label">Transaction Volume · Lifetime</span>
              <span className="status-badge">
                <span className="status-dot" />
                {statusLabel}{" "}
                <span className="status-i" title={footerStatus}>
                  i
                </span>
              </span>
            </div>
            <div className="hero-value">
              {hasData
                ? fmtRp(disp.dispVolume, settings.compactNumbers)
                : "Rp " + DASH}
            </div>
          </div>

          <div className="dash-grid">
            <div className="col-left">
              <div>
                <div className="stat-label">Total Transactions</div>
                <div className="stat-value">
                  {hasData ? fmtInt(disp.dispTotal) : DASH}
                </div>
              </div>
              <div>
                <div className="stat-label">Transactions / Hour</div>
                <div className="stat-value accent">
                  {hasData ? fmtInt(disp.dispHour) : DASH}
                </div>
              </div>
              <div>
                <div className="stat-label">Today&apos;s Volume</div>
                <div className="stat-value today">
                  {hasData
                    ? fmtRp(disp.dispToday, settings.compactNumbers)
                    : "Rp " + DASH}
                </div>
              </div>
            </div>

            <div className="col-right">
              <div>
                <div className="panel-head">
                  <span className="stat-label">Last 24 Hours</span>
                  <span className="panel-hint">TX / HOUR</span>
                </div>
                <div className="chart-bars">
                  {bars.map((h, i) => (
                    <div key={i} className="chart-bar" style={{ height: h }} />
                  ))}
                </div>
              </div>

              {settings.showTicker && (
                <div>
                  <div className="panel-head">
                    <span className="stat-label">Live Transactions</span>
                    <span className="panel-hint">{agoStr}</span>
                  </div>
                  <div className="ticker-rows">
                    {ticker.length === 0 && (
                      <div className="ticker-empty">
                        AWAITING TRANSACTIONS…
                      </div>
                    )}
                    {ticker.map((row, i) => (
                      <div
                        key={row.id}
                        className="ticker-row"
                        style={{ animationDelay: `${i * 70}ms` }}
                      >
                        <div className="ticker-left">
                          <span className="ticker-time">{row.time}</span>
                          <span className="ticker-name">{row.name}</span>
                        </div>
                        <span className="ticker-amount">{row.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="dash-footer">
            <div className="footer-status">{footerStatus}</div>
            <div className="footer-powered">
              POWERED BY <span className="powered-mayar">MAYAR</span>
            </div>
            <div className="footer-clock">{clock} WIB</div>
            <div className="footer-actions">
              {status === "error" && (
                <button
                  className="btn-retry"
                  onClick={() => startLive(settings.refreshSeconds)}
                >
                  RETRY
                </button>
              )}
              <button className="btn-ghost" onClick={disconnect}>
                DISCONNECT
              </button>
            </div>
          </div>

          <button
            className={"fab-tweaks" + (settingsOpen ? " active" : "")}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Customize"
            title="Customize"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <line x1="4" y1="9" x2="20" y2="9" />
              <line x1="4" y1="16" x2="20" y2="16" />
              <circle cx="9" cy="9" r="2.6" fill="#070d0a" />
              <circle cx="15" cy="16" r="2.6" fill="#070d0a" />
            </svg>
          </button>

          {settingsOpen && (
            <div className="settings-panel">
              <div className="settings-title">TWEAKS</div>
              <div className="settings-row">
                <span>THEME</span>
                <span className="theme-toggle">
                  {(["crt", "dither"] as Theme[]).map((th) => (
                    <button
                      key={th}
                      className={
                        "theme-btn" + (settings.theme === th ? " active" : "")
                      }
                      onClick={() => updateSettings({ theme: th })}
                    >
                      {th.toUpperCase()}
                    </button>
                  ))}
                </span>
              </div>
              {settings.theme === "crt" ? (
                <div className="settings-row">
                  <span>ACCENT</span>
                  <span className="accent-swatches">
                    {Object.entries(ACCENTS).map(([name, color]) => (
                      <button
                        key={name}
                        title={name}
                        className={
                          "accent-swatch" +
                          (settings.accent === name ? " active" : "")
                        }
                        style={{ background: color }}
                        onClick={() => updateSettings({ accent: name })}
                      />
                    ))}
                  </span>
                </div>
              ) : (
                <div className="settings-row">
                  <span>DITHER HUE</span>
                  <span className="hue-control">
                    <input
                      className="hue-slider"
                      type="range"
                      min={0}
                      max={360}
                      value={settings.ditherHue}
                      onChange={(e) =>
                        updateSettings({ ditherHue: Number(e.target.value) })
                      }
                    />
                    <span
                      className="hue-swatch"
                      style={{ background: ditherAccent(settings.ditherHue) }}
                      title={`hue ${settings.ditherHue}°`}
                    />
                  </span>
                </div>
              )}
              <div className="settings-row">
                <span>REFRESH (S)</span>
                <input
                  className="settings-input"
                  type="number"
                  min={60}
                  max={300}
                  value={settings.refreshSeconds}
                  onChange={(e) =>
                    updateSettings({
                      refreshSeconds: Math.min(
                        300,
                        Math.max(60, Number(e.target.value) || 60)
                      ),
                    })
                  }
                />
              </div>
              <div className="settings-row">
                <span>SCANLINES</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={settings.scanlines}
                  onChange={(e) =>
                    updateSettings({ scanlines: e.target.checked })
                  }
                />
              </div>
              <div className="settings-row">
                <span>COMPACT NUMBERS</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={settings.compactNumbers}
                  onChange={(e) =>
                    updateSettings({ compactNumbers: e.target.checked })
                  }
                />
              </div>
              <div className="settings-row">
                <span>LIVE TICKER</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={settings.showTicker}
                  onChange={(e) =>
                    updateSettings({ showTicker: e.target.checked })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
