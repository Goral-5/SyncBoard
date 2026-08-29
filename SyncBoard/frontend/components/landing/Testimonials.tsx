"use client";
import { TestimonialsColumn } from "@/components/ui/testimonials-columns-1";
import { motion } from "motion/react";

const testimonials = [
  {
    text: "SyncBoard made our architecture reviews so much faster. Having a live canvas where everyone can draw and discuss in real time is a game changer.",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&h=200&fit=crop",
    name: "Rameshwar Khande",
    role: "Director, Platform Engineering",
  },
  {
    text: "Brainstorming complex cloud systems now feels effortless. The real-time sync is smooth and keeps our remote team completely aligned.",
    image: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?q=80&w=200&h=200&fit=crop",
    name: "Ananya 'Ann' Sharma",
    role: "Staff Engineer, Cloud Systems",
  },
  {
    text: "We replaced our static slide decks with SyncBoard. It's the easiest way to sketch out workflows and collaborate during sprint planning.",
    image: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=200&h=200&fit=crop",
    name: "Rohan Das",
    role: "Engineering Manager, Solutions",
  },
  {
    text: "Super smooth performance even with multiple engineers drawing on the board together. Everything saves automatically without any hassle.",
    image: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=200&h=200&fit=crop",
    name: "Kirito Gupta",
    role: "VP of Engineering, Systems Group",
  },
  {
    text: "Simple, reliable, and super intuitive. SyncBoard has quickly become our go-to tool for mapping out infrastructure and team ideas.",
    image: "https://images.unsplash.com/photo-1614289371518-722f2615943d?q=80&w=200&h=200&fit=crop",
    name: "B. N. Reddy",
    role: "Head of Infrastructure, Platform",
  },
  {
    text: "Live cursors and multi-user drawing make online design sessions feel like we're standing right together at the same physical whiteboard.",
    image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?q=80&w=200&h=200&fit=crop",
    name: "Pooja Varma",
    role: "Director, Architecture Office",
  },
  {
    text: "Clean interface with zero learning curve. It gives us exactly what we need for technical reviews without distracting clutter.",
    image: "https://images.unsplash.com/photo-1607990281513-2c110a25bb8c?q=80&w=200&h=200&fit=crop",
    name: "Farhan Siddiqui",
    role: "Product Lead, DevOps",
  },
  {
    text: "SyncBoard brings speed and visual clarity to all our team discussions. Sharing ideas and getting feedback has never been easier.",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200&h=200&fit=crop",
    name: "Sana Sheikh",
    role: "Solutions Architect, Enterprise",
  },
  {
    text: "It completely changed how our engineering team aligns on technical decisions. Fast, clear, and genuinely fun to use.",
    image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&h=200&fit=crop",
    name: "Hassan Ali",
    role: "Engineering Enablement Manager",
  },
];


const firstColumn = testimonials.slice(0, 3);
const secondColumn = testimonials.slice(3, 6);
const thirdColumn = testimonials.slice(6, 9);


export  const Testimonials = () => {
  return (
    <section id="testimonials" className="bg-background my-20 relative">

      <div className="container z-10 mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true }}
          className="flex flex-col items-center justify-center max-w-[900px] mx-auto"
        >
          <div className="flex justify-center">
            <div className="border py-1 px-4 rounded-lg">Testimonials</div>
          </div>

          <h2 className="mt-5 whitespace-nowrap text-center text-xl font-bold tracking-tighter sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl">
            Trusted by High-Performance Engineering Teams
          </h2>
          <p className="text-center mt-5 opacity-75">
            Teams rely on SyncBoard for low-latency system design, reviews, and distributed collaboration.
          </p>
        </motion.div>

        <div className="flex justify-center gap-6 mt-10 [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] max-h-[740px] overflow-hidden">
          <TestimonialsColumn testimonials={firstColumn} duration={15} />
          <TestimonialsColumn testimonials={secondColumn} className="hidden md:block" duration={19} />
          <TestimonialsColumn testimonials={thirdColumn} className="hidden lg:block" duration={17} />
        </div>
      </div>
    </section>
  );
};

export default { Testimonials };