"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Database,
  Heart,
  Loader2,
  PenLine,
  Plus,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";

import { PLATFORM_SUGGESTIONS, titleGradient } from "@/lib/constants";
import { COOP_TAGS, type CoOpTag } from "@/lib/types";
import type { GameSearchResult } from "@/lib/types";
import { useCoverChain } from "./use-cover-chain";

export interface CoOpAddPayload {
  externalId?: string | null;
  source?: string;
  title: string;
  coverUrl?: string | null;
  heroUrl?: string | null;
  releaseYear?: number | null;
  platforms?: string[];
  isBought: boolean;
  coopTag: CoOpTag | null;
  notes: string | null;
}

export default function CoOpAddModal({
  onClose,
  onAdd,
  inCollection,
}: {
  onClose: () => void;
  onAdd: (payload: CoOpAddPayload) => Promise<"added" | "error">;
  inCollection: (externalId: string | null) => boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GameSearchResult[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

  // ---- the "date night preferences" every add inherits ----
  const [bucket, setBucket] = useState<"wishlist" | "bought">("wishlist");
  const [coopTag, setCoopTag] = useState<CoOpTag | null>("Couch Co-Op");
  const [note, setNote] = useState("");

  // ---- manual entry ----
  const [manualTitle, setManualTitle] = useState("");
  const [manualPlatform, setManualPlatform] = useState("");
  const [manualYear, setManualYear] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

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
      if (id !== seq.current) return;
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

  const searching = q.trim().length >= 2;

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) return; // derived `searching` hides stale UI
    timer.current = window.setTimeout(() => runSearch(q.trim()), 420);
    return () => window.clearTimeout(timer.current);
  }, [q, runSearch]);

  const sharedOptions = {
    isBought: bucket === "bought",
    coopTag,
    notes: note.trim() ? note.trim() : null,
  };

  const handleAddResult = async (r: GameSearchResult) => {
    setPending((p) => ({ ...p, [r.externalId]: true }));
    const outcome = await onAdd({
      externalId: r.externalId,
      source: r.source,
      title: r.title,
      coverUrl: r.coverUrl,
      heroUrl: r.heroUrl,
      releaseYear: r.releaseYear,
      platforms: r.platforms,
      ...sharedOptions,
    });
    setPending((p) => ({ ...p, [r.externalId]: false }));
    if (outcome === "added") {
      setAddedIds((p) => ({ ...p, [r.externalId]: true }));
    }
  };

  const handleManualAdd = async () => {
    const title = manualTitle.trim();
    if (!title) return;
    setManualBusy(true);
    const outcome = await onAdd({
      source: "manual",
      title,
      releaseYear: manualYear ? Number(manualYear) : null,
      platforms: manualPlatform ? [manualPlatform] : [],
      ...sharedOptions,
    });
    setManualBusy(false);
    if (outcome === "added") {
      setManualTitle("");
      setManualPlatform("");
      setManualYear("");
    }
  };

  const providerLabel =
    provider === "wikipedia"
      ? "Wikipedia + Steam · keyless search"
      : provider === "steam"
        ? "Steam Store · keyless search"
        : null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-x-3 top-[3dvh] z-50 mx-auto flex max-h-[94dvh] max-w-4xl flex-col overflow-hidden rounded-2xl border border-pink/20 bg-panel shadow-[0_60px_120px_-30px_rgba(255,77,141,0.25),0_60px_120px_-30px_rgba(0,0,0,0.9)] sm:inset-x-6"
        role="dialog"
        aria-label="Add a co-op game"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5 sm:px-6">
          {loading ? (
            <Loader2 size={19} className="shrink-0 animate-spin text-pink" />
          ) : (
            <Search size={19} className="shrink-0 text-white/45" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a game for the two of you… try “Stardew Valley”"
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
          {/* ------- date night preferences: status / tag / note ------- */}
          <div className="mb-5 rounded-2xl border border-pink/15 bg-gradient-to-br from-pink/[0.07] via-transparent to-violet/[0.09] p-3 sm:p-4">
            <p className="font-mono text-[9px] font-medium tracking-[0.28em] text-pink/80 uppercase">
              Date-night setup · applies to whatever you add next
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {/* status toggle */}
              <div
                className="inline-flex rounded-full border border-white/10 bg-black/40 p-1"
                role="group"
                aria-label="Initial status"
              >
                {(
                  [
                    { id: "wishlist", label: "Wishlist", icon: Heart },
                    { id: "bought", label: "Already Bought", icon: ShoppingBag },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = bucket === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setBucket(opt.id)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] uppercase transition-all ${
                        active
                          ? opt.id === "bought"
                            ? "bg-volt text-void shadow-[0_0_18px_rgba(200,255,62,0.35)]"
                            : "bg-pink text-void shadow-[0_0_18px_rgba(255,77,141,0.45)]"
                          : "text-white/55 hover:text-white"
                      }`}
                    >
                      <Icon size={11} strokeWidth={2.5} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {/* coop tag chips */}
              {COOP_TAGS.map((tag) => {
                const active = coopTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => setCoopTag(active ? null : tag)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1.5 font-mono text-[9px] font-medium tracking-[0.14em] uppercase transition-all ${
                      active
                        ? "border-violet/60 bg-violet/20 text-violet shadow-[0_0_16px_rgba(157,123,255,0.35)]"
                        : "border-white/10 text-white/50 hover:border-white/25 hover:text-white/80"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 140))}
              placeholder="A little note for the two of you… “For weekend date night”"
              className="coop-focus mt-2.5 w-full rounded-xl border border-white/10 bg-void/60 px-3 py-2 text-sm text-ink placeholder:text-white/30 focus:border-pink/50 focus:outline-none"
            />
          </div>

          {q.trim().length < 2 && (
            <div className="relative mx-auto max-w-lg overflow-hidden rounded-2xl border border-white/10">
              <div
                className="flex h-40 w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-pink/15 via-panel-2 to-violet/20 text-center"
                aria-hidden="true"
              >
                <Heart size={30} className="coop-heart text-pink" fill="currentColor" />
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-panel via-panel/40 to-transparent p-6 text-center">
                <p className="font-display text-lg font-bold text-white">
                  Two controllers. One couch.
                </p>
                <p className="mt-1.5 font-mono text-[9px] tracking-[0.22em] text-white/50 uppercase">
                  Couch · split-screen · online · pass-the-pad
                </p>
              </div>
            </div>
          )}

          {searching && stale && (
            <p className="py-8 text-center font-mono text-xs text-rose">
              Search hiccup — check your connection and try again, love.
            </p>
          )}

          {searching && !loading && !stale && results.length === 0 && (
            <p className="py-8 text-center font-mono text-xs text-white/45">
              No matches for “{q.trim()}”. Add it manually below — it still counts.
            </p>
          )}

          {searching && loading && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="skeleton aspect-[3/4] rounded-xl" />
              ))}
            </div>
          )}

          {searching && !loading && results.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {results.map((r) => {
                const already =
                  inCollection(r.externalId) || Boolean(addedIds[r.externalId]);
                const busy = Boolean(pending[r.externalId]);
                return (
                  <div
                    key={r.externalId}
                    className="group relative overflow-hidden rounded-xl border border-white/10 bg-panel-2 transition-colors hover:border-pink/40"
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
                      onClick={() => handleAddResult(r)}
                      className={`absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full border backdrop-blur transition-all ${
                        already
                          ? "border-pink/60 bg-pink text-void"
                          : busy
                            ? "border-white/20 bg-black/60 text-white"
                            : "border-white/20 bg-black/55 text-white opacity-0 group-hover:opacity-100 hover:bg-pink hover:text-void"
                      }`}
                      aria-label={
                        already ? `${r.title} is in the co-op vault` : `Add ${r.title}`
                      }
                      title={already ? "Already in the co-op vault" : "Add to the co-op vault"}
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
                      <span className="absolute top-3 left-2 rounded bg-pink/90 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.14em] text-void uppercase">
                        Together
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* footer: manual add */}
        <div className="border-t border-white/10 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">
              <Database size={11} className="text-white/30" />
              {providerLabel ?? "Keyless search · no accounts, no keys"}
            </p>
            <p className="font-mono text-[9px] tracking-[0.16em] text-pink/60 uppercase">
              {bucket === "bought" ? "→ Already Bought" : "→ Wishlist"}
              {coopTag ? ` · ${coopTag}` : ""}
            </p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
            <PenLine size={13} className="ml-1 shrink-0 text-white/35" />
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualAdd();
              }}
              placeholder="Can't find it? Type a title and add by hand…"
              className="min-w-40 flex-1 rounded-lg border border-white/10 bg-void px-3 py-2 text-sm text-ink placeholder:text-white/30 focus:border-pink/50 focus:outline-none"
            />
            <select
              value={manualPlatform}
              onChange={(e) => setManualPlatform(e.target.value)}
              className="cursor-pointer rounded-lg border border-white/10 bg-void px-2 py-2 font-mono text-xs text-white/75 focus:border-pink/50 focus:outline-none"
              aria-label="Platform"
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
              className="tabular w-20 rounded-lg border border-white/10 bg-void px-3 py-2 font-mono text-xs text-ink placeholder:text-white/30 focus:border-pink/50 focus:outline-none"
            />
            <button
              onClick={handleManualAdd}
              disabled={!manualTitle.trim() || manualBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pink px-4 py-2 font-mono text-xs font-bold tracking-[0.1em] text-void uppercase transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {manualBusy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={2.6} />
              )}
              Add
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function ResultCover({ title, url }: { title: string; url: string | null }) {
  const { currentSrc, exhausted, onError } = useCoverChain(url);
  if (currentSrc && !exhausted) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={currentSrc}
        alt={`Cover art for ${title}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={onError}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: titleGradient(title) }}
      aria-hidden="true"
    >
      <span className="font-display px-3 text-center text-xl leading-tight text-white/70">
        {title.slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}
