"use client";

import { Gamepad2, Heart, Library, Plus } from "lucide-react";

function GithubIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.68 5.38-5.24 5.67.41.36.78 1.05.78 2.12v3.15c0 .3.2.67.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

type RailFilter = "all" | "playing" | "favorites";

export default function SideRail({
  filter,
  onFilter,
  onAdd,
  count,
  playingCount,
  favoritesCount,
}: {
  filter: RailFilter;
  onFilter: (f: RailFilter) => void;
  onAdd: () => void;
  count: number;
  playingCount: number;
  favoritesCount: number;
}) {
  const items = [
    { id: "all" as const, icon: Library, label: "All games", count },
    { id: "playing" as const, icon: Gamepad2, label: "Now playing", count: playingCount },
    { id: "favorites" as const, icon: Heart, label: "Favorites", count: favoritesCount },
  ];

  return (
    <aside className="sticky top-0 z-40 hidden h-screen w-[76px] shrink-0 flex-col items-center justify-between border-r border-line bg-panel/60 py-5 backdrop-blur-xl lg:flex">
      {/* brand */}
      <a href="/" aria-label="Game Vault home" className="group">
        <div className="grid h-11 w-11 overflow-hidden rounded-xl bg-volt shadow-[0_0_30px_rgba(200,255,62,0.25)] transition-transform duration-300 group-hover:rotate-6">
          <img src="/icon.png" alt="Sabab's Games Logo" className="h-full w-full object-cover" />
        </div>
      </a>

      {/* nav */}
      <nav className="flex flex-col items-center gap-2">
        <button
          onClick={onAdd}
          aria-label="Add a game"
          className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-volt/50 text-volt transition-all duration-300 hover:bg-volt hover:text-void hover:shadow-[0_0_28px_rgba(200,255,62,0.35)]"
        >
          <Plus size={19} strokeWidth={2.4} />
        </button>
        {items.map((item) => {
          const active = filter === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onFilter(item.id)}
              aria-label={item.label}
              title={`${item.label} · ${item.count}`}
              className={`group relative grid h-11 w-11 place-items-center rounded-xl border transition-all duration-200 ${
                active
                  ? "border-white/20 bg-white/[0.08] text-ink"
                  : "border-transparent text-white/40 hover:bg-white/[0.05] hover:text-white/85"
              }`}
            >
              <Icon size={18} strokeWidth={2} />
              {active && (
                <span className="absolute -left-[18px] h-6 w-[3px] rounded-full bg-volt" />
              )}
              <span className="pointer-events-none absolute left-full ml-3 hidden rounded-md border border-white/10 bg-panel-2 px-2 py-1 font-mono text-[10px] whitespace-nowrap text-white/80 group-hover:block">
                {item.label} · {item.count}
              </span>
            </button>
          );
        })}
      </nav>

      {/* footer */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-1.5" title="Synced to your database">
          <span className="sync-dot h-2 w-2 rounded-full bg-volt" />
          <span className="font-mono text-[8px] tracking-[0.2em] text-white/35 uppercase [writing-mode:vertical-rl]">
            synced
          </span>
        </div>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          aria-label="View source on GitHub"
          className="text-white/35 transition-colors hover:text-white"
        >
          <GithubIcon size={17} />
        </a>
      </div>
    </aside>
  );
}
