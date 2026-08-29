"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Database,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Sparkles,
  Radio,
  HardDrive,
  Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Features() {
  const featureCards = [
    {
      category: "REAL-TIME SYNC",
      title: "WebSocket State Synchronization",
      description:
        "Instant bi-directional canvas state updates powered by Socket.io, broadcasting element mutations and cursor movements across room participants.",
      badgeColor: "text-neutral-300 bg-white/5 border-white/10",
      icon: Zap,
      pills: ["WebSocket Protocol", "Bi-Directional Broadcast", "Live Cursor Tracking"],
      customVisual: (
        <div className="mt-6 w-full rounded-2xl border border-white/10 bg-neutral-950/90 p-4 shadow-inner font-mono text-xs">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white"></span>
              </span>
              <span className="text-neutral-200 font-semibold">Socket.io Channel</span>
            </div>
            <span className="text-[10px] text-neutral-300 bg-white/10 px-2 py-0.5 rounded border border-white/15">
              CONNECTED
            </span>
          </div>

          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex items-center justify-between text-neutral-400 bg-white/5 p-2 rounded-lg border border-white/5">
              <span className="text-neutral-200 font-medium flex items-center gap-1.5">
                <Radio className="h-3 w-3 text-neutral-400" /> event: element:draw
              </span>
              <span className="text-[10px] text-neutral-500">Broadcast to Room</span>
            </div>
            <div className="flex items-center justify-between text-neutral-400 bg-white/5 p-2 rounded-lg border border-white/5">
              <span className="text-neutral-200 font-medium flex items-center gap-1.5">
                <Code2 className="h-3 w-3 text-neutral-400" /> event: cursor:move
              </span>
              <span className="text-[10px] text-neutral-500">Delta Position</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      category: "PERSISTENCE",
      title: "Persistent Board Storage",
      description:
        "Whiteboard drawings and elements automatically persist to MongoDB with Redis caching, guaranteeing state preservation across browser reloads.",
      badgeColor: "text-neutral-300 bg-white/5 border-white/10",
      icon: Database,
      pills: ["MongoDB Database", "Auto-Save Debounce", "Session Recovery"],
      customVisual: (
        <div className="mt-6 w-full rounded-2xl border border-white/10 bg-neutral-950/90 p-4 shadow-inner text-xs">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-neutral-300" />
              <span className="font-semibold text-neutral-200">Database Persistence</span>
            </div>
            <span className="text-[10px] font-mono text-neutral-300 bg-white/10 px-2 py-0.5 rounded border border-white/15">
              MongoDB + Redis
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px]">
            <div className="rounded-xl border border-white/5 bg-white/5 p-2">
              <div className="font-semibold text-neutral-200">State Sync</div>
              <div className="text-[10px] text-neutral-400 mt-0.5">Debounced Writes</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 p-2">
              <div className="font-semibold text-neutral-200">Canvas History</div>
              <div className="text-[10px] text-neutral-400 mt-0.5">Stored as JSON</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      category: "SECURITY",
      title: "JWT & Room Authorization",
      description:
        "Secure whiteboard sessions utilizing JWT authentication tokens and socket handshake validation to ensure protected workspace access.",
      badgeColor: "text-neutral-300 bg-white/5 border-white/10",
      icon: ShieldCheck,
      pills: ["JWT Token Auth", "Socket Handshake", "Protected Canvas"],
      customVisual: (
        <div className="mt-6 w-full rounded-2xl border border-white/10 bg-neutral-950/90 p-4 shadow-inner text-xs">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-neutral-300" />
              <span className="font-semibold text-neutral-200">Auth Validation</span>
            </div>
            <span className="text-[10px] font-mono text-neutral-300 bg-white/10 px-2 py-0.5 rounded border border-white/15">
              JWT Bearer
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] bg-white/5 p-2 rounded-lg border border-white/5">
            <span className="text-neutral-300 font-mono">authHeader: Bearer Token</span>
            <span className="text-neutral-200 font-medium">Validated ✓</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section id="features" className="relative w-full py-16 md:py-24 bg-gradient-to-b from-neutral-950 via-black to-neutral-950 overflow-hidden">
      {/* Subtle Soft Radial Vignette Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold tracking-wider text-neutral-300 uppercase mb-4"
          >
            <Sparkles className="h-3.5 w-3.5 text-white" />
            Features
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white"
          >
            Built for Real-Time Collaboration
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-4 text-base sm:text-lg text-neutral-400"
          >
            Engineered with WebSockets MongoDB state persistence and JWT session authorization for seamless visual teamwork.
          </motion.p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {featureCards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: idx * 0.15 }}
                whileHover={{ y: -6 }}
                className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/50 p-6 md:p-8 backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-neutral-900/80 hover:shadow-2xl hover:shadow-white/5"
              >
                {/* Top Subtle Light Reflection Gradient */}
                <div
                  className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-gradient-to-br from-white/10 via-white/5 to-transparent opacity-40 transition-opacity duration-500 group-hover:opacity-100 blur-2xl pointer-events-none"
                />

                <div>
                  {/* Category Pill & Icon */}
                  <div className="flex items-center justify-between mb-6">
                    <span className={cn("px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider border", card.badgeColor)}>
                      {card.category}
                    </span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-neutral-950/80 shadow-md">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-xl md:text-2xl font-semibold text-white tracking-tight group-hover:text-neutral-200 transition-colors duration-200">
                    {card.title}
                  </h3>
                  <p className="mt-3 text-sm text-neutral-400 leading-relaxed">
                    {card.description}
                  </p>
                </div>

                {/* Custom Technical Visual Widget */}
                {card.customVisual}

                {/* Feature Tags / Pills */}
                <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-white/5">
                  {card.pills.map((pill) => (
                    <span
                      key={pill}
                      className="inline-flex items-center gap-1.5 text-xs text-neutral-300 bg-white/5 px-2.5 py-1 rounded-lg border border-white/5"
                    >
                      <CheckCircle2 className="h-3 w-3 text-neutral-400" />
                      {pill}
                    </span>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}