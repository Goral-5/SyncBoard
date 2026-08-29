"use client";
import React from "react";
import { cn } from "@/lib/utils";
import createGlobe from "cobe";
import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react"; 
import { motion, type Variants } from "motion/react";

export default function Discover() {
  const features = [
    {
      title: "Responsive Canvas",
      description: "Designed for smooth interactions across diagrams, shapes, notes, and complex collaborative boards.",
      skeleton: <SkeletonOne />,
      id: "workspace",
      className: "col-span-1 lg:col-span-4 border-b lg:border-r dark:border-neutral-800",
    },
    {
  title: "See Who's Creating",
  description:
    "Live cursors and presence indicators make it easy to see who's on the board and follow their work.",
  skeleton: <SkeletonTwo />,
  className: "border-b col-span-1 lg:col-span-2 dark:border-neutral-800",
},
{
  title: "Share Ideas Anywhere",
  description:
    "Invite teammates to your boards, share ideas instantly, and keep everyone working from the same canvas.",
  skeleton: <SkeletonThree />,
  className: "col-span-1 lg:col-span-6 border-b lg:border-none",
},
  ];

  return (
    <div id="discover" className="relative z-20 py-10 lg:py-20 max-w-7xl mx-auto">
      <div className="px-8">
        <h4 className="text-3xl lg:text-5xl lg:leading-tight max-w-5xl mx-auto text-center tracking-tight font-medium text-black dark:text-white">
          Complex Systems Made Visual
        </h4>
        <p className="text-sm lg:text-base max-w-2xl my-4 mx-auto text-neutral-500 text-center font-normal dark:text-neutral-300">
          Design architectures map data flows and turn complex ideas into clear visual diagrams on a shared canvas
        </p>
      </div>

      <div className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-6 mt-12 gap-6">
          {features.map((feature, idx) => {
            const isFullRow = feature.className.includes("lg:col-span-6");
            return (
              <FeatureCard key={feature.title} className={feature.className} index={idx}>
                {isFullRow ? (
                  <div className="flex flex-col lg:flex-row items-center justify-between h-full w-full p-2">
                    <div className="lg:w-1/2 flex flex-col justify-center">
                      <FeatureTitle>{feature.title}</FeatureTitle>
                      <FeatureDescription>{feature.description}</FeatureDescription>
                    </div>
                    <div className="lg:w-1/2 h-full w-full flex items-center justify-center">
                      {feature.skeleton}
                    </div>
                  </div>
                ) : (
                  <>
                    <FeatureTitle>{feature.title}</FeatureTitle>
                    <FeatureDescription>{feature.description}</FeatureDescription>
                    <div className="flex-1 w-full mt-4 overflow-hidden relative">{feature.skeleton}</div>
                  </>
                )}
              </FeatureCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const cardVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 40,
  },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.12, // Staggered delays: 0ms, 120ms, 240ms
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

const FeatureCard = ({ children, className, index }: { children?: React.ReactNode; className?: string; index: number }) => {
  return (
    <motion.div
      variants={cardVariants}
      custom={index}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      className={cn(
        "p-4 sm:p-8 relative overflow-hidden h-[500px] md:h-[500px] flex flex-col bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl",
        className
      )}
    >
      {children}
    </motion.div>
  );
};

const FeatureTitle = ({ children }: { children?: React.ReactNode }) => {
  return (
    <p className="max-w-5xl text-left tracking-tight text-black dark:text-white text-xl md:text-2xl md:leading-snug">
      {children}
    </p>
  );
};

const FeatureDescription = ({ children }: { children?: React.ReactNode }) => {
  return (
    <p className="text-sm md:text-base max-w-sm text-left mx-0 text-neutral-500 font-normal dark:text-neutral-300 my-2">
      {children}
    </p>
  );
};

export const SkeletonOne = () => {
  return (
    <div id="workspace" className="relative flex h-full w-full overflow-hidden">
      <img
        src="/Canvas.jpeg"
        alt="Excalidraw Interface"
        className="h-full w-full object-cover object-left-top rounded-lg opacity-100"
      />
    </div>
  );
};

export const SkeletonTwo = () => {
  return (
    <div className="relative flex flex-col items-start p-4 h-full w-full overflow-hidden bg-neutral-50/50 dark:bg-neutral-900/50 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800">
      <div className="w-full h-full relative flex flex-col"> 
        <div className="absolute top-2 right-2 z-50 flex flex-col gap-2 items-end">
          {/* First Message */}
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex items-center gap-2 bg-white dark:bg-neutral-800 p-2 px-3 rounded-2xl shadow-md border border-neutral-200 dark:border-neutral-700"
          >
            <MessageSquare className="w-3 h-3 text-blue-500" />
            <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
              Should we use this logo?
            </span>
          </motion.div>

          {/* Second Message (Reply) */}
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="flex items-center gap-2 bg-white dark:bg-neutral-800 p-2 px-3 rounded-2xl shadow-md border border-neutral-200 dark:border-neutral-700"
          >
            <MessageSquare className="w-3 h-3 text-green-500" />
            <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
              Looks great, scaling it!
            </span>
          </motion.div>
        </div>

        {/* Animated Cursor 1 (Alex) */}
        <motion.div
          animate={{ x: [20, 100, 60], y: [80, 140, 100] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="absolute z-40 flex flex-col items-start gap-1"
        >
          <CursorIcon color="#3b82f6" />
          <span className="bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">Alex</span>
        </motion.div>

        {/* Animated Cursor 2 (Sarah) */}
        <motion.div
          animate={{ x: [220, 160, 200], y: [40, 90, 50] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute z-40 flex flex-col items-start gap-1"
        >
          <CursorIcon color="#ef4444" />
          <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">Sarah</span>
        </motion.div>

        {/* Board Simulation */}
        <div className="flex-1 w-full mt-4 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-black p-2 overflow-hidden">
           <img 
            src="/Canvas.jpeg"
            className="w-full h-full object-contain opacity-90 dark:opacity-10 grayscale" 
            alt="canvas" 
           />
        </div>
      </div>
    </div>
  );
};

export const SkeletonThree = () => {
  return (
    <div className="h-full w-full flex items-center justify-center bg-transparent overflow-hidden">
      <Globe className="w-full h-full max-w-[360px] max-h-[360px] md:max-w-[420px] md:max-h-[420px]" />
    </div>
  );
};

const CursorIcon = ({ color }: { color: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M5.6691 12.3174L2.8851 3.7928C2.51501 2.65715 3.65715 1.51501 4.7928 1.8851L13.3174 4.6691C14.4551 5.04017 14.4714 6.64336 13.3424 7.03741L8.9631 8.5641L7.43641 12.9434C7.04236 14.0724 5.43917 14.0561 5.6691 12.3174Z" fill={color} />
  </svg>
);

export const Globe = ({ className }: { className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let phi = 0;
    if (!canvasRef.current) return;
    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: 450 * 2,
      height: 450 * 2,
      phi: 0,
      theta: 0,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.3, 0.3, 0.3],
      markerColor: [0.1, 0.8, 1],
      glowColor: [1, 1, 1],
      markers: [
        { location: [37.7595, -122.4367], size: 0.03 },
        { location: [40.7128, -74.006], size: 0.1 },
      ],
      onRender: (state) => {
        state.phi = phi;
        phi += 0.018; // Speed up from 0.01
      },
    });
    return () => globe.destroy();
  }, []);
  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", maxWidth: "100%", aspectRatio: 1 }}
      className={className}
    />
  );
};