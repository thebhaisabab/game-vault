"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import type { LibraryGame } from "@/db/schema";
import { CoverArt } from "./ui-bits";

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 110, damping: 22 });
  const display = useTransform(spring, (v) => Math.max(0, Math.round(v)).toString());
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className="tabular">{display}</motion.span>;
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] font-medium tracking-[0.26em] text-ink-dim uppercase">
        {label}
      </p>
      <p className="font-display mt-1.5 text-2xl font-bold sm:text-3xl" style={{ color: accent }}>
        <AnimatedNumber value={value} />
      </p>
    </div>
  );
}

export default function HeaderHero({ games }: { games: LibraryGame[] }) {
  const total = games.length;
  const playing = games.filter((g) => g.status === "playing").length;
  const completed = games.filter((g) => g.status === "completed").length;
  const hours = games.reduce((s, g) => s + (g.hoursPlayed ?? 0), 0);

  const marquee = games
    .filter((g) => g.coverUrl)
    .slice(0, 14)
    .map((g) => ({ id: g.id, title: g.title, coverUrl: g.coverUrl }));

  return (
    <header className="relative overflow-hidden border-b border-line">
      <div className="px-5 pt-10 pb-6 sm:px-8 lg:px-12">
        {/* eyebrow */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-mono text-[10px] font-medium tracking-[0.3em] text-volt uppercase"
        >
          {total === 1 ? "001 title catalogued" : String(total).padStart(3, "0") + " titles catalogued"} · synced across devices
        </motion.p>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-[clamp(2.6rem,7.5vw,5.5rem)] leading-[0.95] font-extrabold tracking-tight"
          >
            <span className="text-outline block">SABAB'S</span>
            <span className="block">
              GAME<span className="text-volt">VAULT</span>
              <span className="text-violet">.</span>
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
            className="grid max-w-md flex-1 grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4"
          >
            <Stat label="Titles" value={total} accent="#ececf1" />
            <Stat label="Playing" value={playing} accent="#c8ff3e" />
            <Stat label="Completed" value={completed} accent="#4dd6ff" />
            <Stat label="Hours" value={hours} accent="#9d7bff" />
          </motion.div>
        </div>
      </div>

      {/* cover marquee */}
      {marquee.length > 0 && (
        <div className="relative border-t border-line/60 py-3">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-void to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-void to-transparent" />
          <div className="overflow-hidden">
            <div className="marquee-track flex w-max items-center gap-3 px-3">
              {[...marquee, ...marquee].map((g, i) => (
                <div
                  key={`${g.id}-${i}`}
                  className="h-16 w-12 shrink-0 overflow-hidden rounded-md border border-white/10 opacity-70 transition-opacity hover:opacity-100"
                >
                  <CoverArt game={{ title: g.title, coverUrl: g.coverUrl }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
