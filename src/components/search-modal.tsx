"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Database, Loader2, PenLine, Plus, Search, X } from "lucide-react";
import { PLATFORM_SUGGESTIONS, titleGradient } from "@/lib/constants";
import type { GameSearchResult } from "@/lib/types";

export type AddOutcome = "added" | "exists" | "error";

export default function SearchModal({
  onClose,
  onAdd,
  onAddManual,
  inLibrary,
}: {
  onClose: () => void;
  onAdd: (r: GameSearchResult) => Promise<AddOutcome>;
  onAddManual: (input: {
    title: string;
    platform: string | null;
    releaseYear: number | null;
  }) => Promise<AddOutcome>;
  inLibrary: (externalId: string | null) => boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GameSearchResult[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualPlatform, setManualPlatform] = useState("");
  const [manualYear, setManualYear] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/games/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        results: GameSearchResult[];
        provider: string | null;
      };
      if (id !== seq.current) return; // stale response
      setResults(data.results);
      setProvider(data.provider);
      setStale(false);
    } catch {
      if (id !== seq.current) return;
      setStale(true);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      setProvider(null);
      setStale(false);
      setLoading(false);
      return;
    }
    timer.current = window.setTimeout(() => runSearch(q.trim()), 420);
    return () => window.clearTimeout(timer.current);
  }, [q, runSearch]);

  const handleAdd = async (r: GameSearchResult) => {
    setPending((p) => ({ ...p, [r.externalId]: true }));
    await onAdd(r);
    setPending((p) => ({ ...p, [r.externalId]: false }));
  };

  const handleManual = async () => {
    const title = manualTitle.trim();
    if (!title) return;
    const outcome = await onAddManual({
      title,
      platform: manualPlatform || null,
      releaseYear: manualYear ? Number(manualYear) : null,
    });
    if (outcome !== "error") {
      setManualTitle("");
      setManualYear("");
      setManualPlatform("");
      setManualOpen(false);
    }
  };

  const providerLabel =
    provider === "igdb"
      ? "IGDB · the full game database"
      : provider === "rawg"
        ? "RAWG · the full game database"
        : provider === "steam"
          ? "Steam catalogue · add IGDB or RAWG keys for consoles"
          : null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-x-3 top-[4dvh] z-50 mx-auto flex max-h-[90dvh] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-panel shadow-[0_60px_120px_-30px_rgba(0,0,0,0.9)] sm:inset-x-6"
        role="dialog"
        aria-label="Add a game"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5 sm:px-6">
          {loading ? (
            <Loader2 size={19} className="shrink-0 animate-spin text-volt" />
          ) : (
            <Search size={19} className="shrink-0 text-white/45" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search every game ever made… try “Elden Ring”"
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink placeholder:text-white/30 focus:outline-none sm:text-lg"
          />
          <span className="hidden rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/40 sm:block">
            ESC
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-white/60 transition-colors hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {q.trim().length < 2 && (
            <div className="relative mx-auto max-w-lg overflow-hidden rounded-2xl border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/vault-void.jpg"
                alt=""
                className="h-44 w-full object-cover opacity-60"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-panel via-panel/30 to-transparent p-6 text-center">
                <p className="font-display text-lg font-bold text-white">
                  Find anything. Add it to the vault.
                </p>
                <p className="mt-1.5 font-mono text-[10px] tracking-[0.2em] text-white/50 uppercase">
                  PS5 · PS4 · Xbox · Switch · PC · retro
                </p>
              </div>
            </div>
          )}

          {stale && (
            <p className="py-10 text-center font-mono text-xs text-rose">
              Search hiccup — check your connection and try again.
            </p>
          )}

          {q.trim().length >= 2 && !loading && !stale && results.length === 0 && (
            <p className="py-10 text-center font-mono text-xs text-white/45">
              No matches for “{q.trim()}”. Try another spelling — or add it manually below.
            </p>
          )}

          {loading && q.trim().length >= 2 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="skeleton aspect-[3/4] rounded-xl" />
              ))}
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {results.map((r) => {
                const already = inLibrary(r.externalId);
                const busy = pending[r.externalId];
                return (
                  <div
                    key={r.externalId}
                    className="group relative overflow-hidden rounded-xl border border-white/10 bg-panel-2 transition-colors hover:border-white/30"
                  >
                    <div className="aspect-[3/4]">
                      <ResultCover title={r.title} url={r.coverUrl} />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 pt-8">
                      <p className="line-clamp-2 text-[11px] leading-tight font-semibold text-white">
                        {r.title}
                      </p>
                      <p className="tabular mt-1 font-mono text-[9px] tracking-[0.1em] text-white/50 uppercase">
                        {r.releaseYear ?? "TBA"}
                        {r.platforms.length > 0 &&
                          ` · ${r.platforms.slice(0, 3).join(" ")}${r.platforms.length > 3 ? "+" : ""}`}
                      </p>
                    </div>

                    <button
                      disabled={already || busy}
                      onClick={() => handleAdd(r)}
                      className={`absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full border backdrop-blur transition-all ${
                        already
                          ? "border-volt/60 bg-volt text-void"
                          : busy
                            ? "border-white/20 bg-black/60 text-white"
                            : "border-white/20 bg-black/55 text-white opacity-0 group-hover:opacity-100 hover:bg-volt hover:text-void"
                      }`}
                      aria-label={already ? `${r.title} is in your vault` : `Add ${r.title}`}
                      title={already ? "Already in your vault" : "Add to vault"}
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : already ? (
                        <Check size={14} strokeWidth={3} />
                      ) : (
                        <Plus size={14} strokeWidth={2.6} />
                      )}
                    </button>
                    {already && (
                      <span className="absolute top-3 left-2 rounded bg-volt/90 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.14em] text-void uppercase">
                        In vault
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-white/10 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">
              <Database size={11} className="text-white/30" />
              {providerLabel ?? "Search database"}
            </p>
            <button
              onClick={() => setManualOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-white/55 uppercase transition-colors hover:text-volt"
            >
              <PenLine size={11} />
              {manualOpen ? "Hide manual add" : "Can't find it? Add manually"}
            </button>
          </div>

          {manualOpen && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <input
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Game title"
                className="min-w-40 flex-1 rounded-lg border border-white/10 bg-void px-3 py-2 text-sm text-ink placeholder:text-white/30 focus:border-volt/60 focus:outline-none"
              />
              <select
                value={manualPlatform}
                onChange={(e) => setManualPlatform(e.target.value)}
                className="cursor-pointer rounded-lg border border-white/10 bg-void px-2 py-2 font-mono text-xs text-white/75 focus:border-volt/60 focus:outline-none"
              >
                <option value="">Platform…</option>
                {PLATFORM_SUGGESTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                value={manualYear}
                onChange={(e) => setManualYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="Year"
                inputMode="numeric"
                className="tabular w-20 rounded-lg border border-white/10 bg-void px-3 py-2 font-mono text-xs text-ink placeholder:text-white/30 focus:border-volt/60 focus:outline-none"
              />
              <button
                onClick={handleManual}
                disabled={!manualTitle.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-volt px-4 py-2 font-mono text-xs font-bold tracking-[0.1em] text-void uppercase transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={13} strokeWidth={2.6} />
                Add
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function ResultCover({ title, url }: { title: string; url: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-3"
        style={{ background: titleGradient(title) }}
      >
        <span className="font-display text-center text-sm leading-tight text-white/75">
          {title.slice(0, 2).toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Cover art for ${title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-full w-full object-cover"
    />
  );
}
