"use client";

import { ArrowUpDown, Heart, Images, LayoutGrid, Rows3, Search, X } from "lucide-react";
import {
  PLATFORM_SUGGESTIONS,
  SORT_OPTIONS,
  STATUS_META,
  STATUS_ORDER,
  platformTone,
  type LibraryView,
  type SortId,
} from "@/lib/constants";
import type { GameStatus } from "@/lib/types";

export type StatusFilter = "all" | "favorites" | GameStatus;

const VIEWS: { id: LibraryView; label: string; icon: typeof LayoutGrid }[] = [
  { id: "grid", label: "Tile view", icon: LayoutGrid },
  { id: "list", label: "List view", icon: Rows3 },
  { id: "showcase", label: "Showcase view", icon: Images },
];

export default function FilterBar({
  statusFilter,
  onStatusFilter,
  statusCounts,
  favoritesCount,
  platformFilter,
  onPlatformFilter,
  platformCounts,
  query,
  onQuery,
  sort,
  onSort,
  view,
  onView,
  total,
}: {
  statusFilter: StatusFilter;
  onStatusFilter: (f: StatusFilter) => void;
  statusCounts: Record<string, number>;
  favoritesCount: number;
  platformFilter: string | null;
  onPlatformFilter: (p: string | null) => void;
  platformCounts: Record<string, number>;
  query: string;
  onQuery: (q: string) => void;
  sort: SortId;
  onSort: (s: SortId) => void;
  view: LibraryView;
  onView: (v: LibraryView) => void;
  total: number;
}) {
  const platforms = Object.keys(platformCounts).sort((a, b) => {
    const ia = PLATFORM_SUGGESTIONS.indexOf(a);
    const ib = PLATFORM_SUGGESTIONS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  const hasFilters =
    statusFilter !== "all" || platformFilter !== null || query.length > 0;

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-void/85 backdrop-blur-xl">
      {/* status row */}
      <div className="flex items-center gap-2 overflow-x-auto px-5 pt-3 pb-2 [scrollbar-width:none] sm:px-8 lg:px-12 [&::-webkit-scrollbar]:hidden">
        <FilterPill
          active={statusFilter === "all"}
          onClick={() => onStatusFilter("all")}
          label="All"
          count={total}
        />
        {STATUS_ORDER.map((s) => (
          <FilterPill
            key={s}
            active={statusFilter === s}
            onClick={() => onStatusFilter(s)}
            label={STATUS_META[s].label}
            count={statusCounts[s] ?? 0}
            color={STATUS_META[s].color}
          />
        ))}
        <FilterPill
          active={statusFilter === "favorites"}
          onClick={() => onStatusFilter("favorites")}
          label="Favorites"
          count={favoritesCount}
          icon={<Heart size={11} fill={statusFilter === "favorites" ? "currentColor" : "none"} />}
        />

        {hasFilters && (
          <button
            onClick={() => {
              onStatusFilter("all");
              onPlatformFilter(null);
              onQuery("");
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] text-white/50 uppercase transition-colors hover:border-white/25 hover:text-white"
          >
            <X size={11} /> clear
          </button>
        )}

        {/* tools (pushed right on wide screens) */}
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-4">
          <label className="relative hidden md:block">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/40" />
            <input
              data-lib-search
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Filter library…"
              className="w-44 rounded-full border border-white/10 bg-white/[0.03] py-2 pr-8 pl-9 text-sm text-ink transition-all placeholder:text-white/30 focus:w-56 focus:border-volt/60 focus:outline-none"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-white/15 bg-white/5 px-1 font-mono text-[10px] text-white/40">
              /
            </kbd>
          </label>

          <label className="relative hidden sm:block">
            <ArrowUpDown size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/40" />
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value as SortId)}
              aria-label="Sort library"
              className="cursor-pointer appearance-none rounded-full border border-white/10 bg-white/[0.03] py-2 pr-4 pl-8 font-mono text-[11px] text-white/75 uppercase transition-colors focus:border-volt/60 focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const active = view === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => onView(v.id)}
                  aria-label={v.label}
                  title={v.label}
                  className={`grid h-7 w-9 place-items-center rounded-full transition-all ${
                    active
                      ? "bg-volt text-void shadow-[0_0_16px_rgba(200,255,62,0.3)]"
                      : "text-white/45 hover:text-white"
                  }`}
                >
                  <Icon size={14} strokeWidth={2.2} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* mobile search */}
      <div className="px-5 pb-2 sm:hidden">
        <label className="relative block">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/40" />
          <input
            data-lib-search
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Filter library…"
            className="w-full rounded-full border border-white/10 bg-white/[0.03] py-2 pr-4 pl-9 text-sm text-ink placeholder:text-white/30 focus:border-volt/60 focus:outline-none"
          />
        </label>
      </div>

      {/* platform row */}
      {platforms.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-white/[0.05] px-5 py-2 [scrollbar-width:none] sm:px-8 lg:px-12 [&::-webkit-scrollbar]:hidden">
          <span className="mr-1 shrink-0 font-mono text-[9px] tracking-[0.24em] text-white/30 uppercase">
            Platform
          </span>
          {platforms.map((p) => {
            const active = platformFilter === p;
            return (
              <button
                key={p}
                onClick={() => onPlatformFilter(active ? null : p)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.1em] uppercase transition-all ${
                  active
                    ? "border-white/60 bg-white text-void"
                    : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: active ? "#070709" : platformTone(p) }}
                />
                {p}
                <span className={active ? "text-void/60" : "text-white/30"}>
                  {platformCounts[p]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
  color,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase transition-all duration-200 ${
        active
          ? "border-volt/60 bg-volt/10 text-volt"
          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"
      }`}
    >
      {color && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      )}
      {icon}
      {label}
      <span className={active ? "text-volt/70" : "text-white/30"}>{count}</span>
    </button>
  );
}
