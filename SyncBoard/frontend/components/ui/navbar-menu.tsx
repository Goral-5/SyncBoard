"use client";
import React, { useState } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Menu as MenuIcon, Sun, X,Moon } from "lucide-react";
import { Switch } from "./switch";
import { Label } from "./label";

import { cn } from "@/lib/utils";

const transition = {
  type: "spring",
  mass: 0.5,
  damping: 11.5,
  stiffness: 100,
  restDelta: 0.001,
  restSpeed: 0.001,
};

export const Menu = ({
  setActive,
  children,
}: {
  setActive: (item: string | null) => void;
  children: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [isDarkMode, setIsDarkMode] = React.useState(true);
  const [scrolled, setScrolled] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [isDarkMode]);

  const handleAuthRedirect = (e: React.MouseEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (token) {
      router.push('/dashboard');
    } else {
      router.push('/auth');
    }
  };

  return (
    <nav
      onMouseLeave={() => setActive(null)}
      className={cn(
        "relative mx-auto flex w-full items-center justify-between rounded-full border transition-all duration-300 z-50 py-4 px-8 bg-neutral-950/50 border-white/10 shadow-[0_4px_20px_0_rgba(0,0,0,0.3)] backdrop-blur-md",
        scrolled && "border-white/15 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-xl"
      )}
    >
      {/* LEFT: LOGO */}
      <Link href="/" className="flex shrink-0 items-center gap-2 group">
        <div className="h-8 w-8 bg-white dark:bg-white rounded-lg flex items-center justify-center transition-transform group-hover:rotate-6">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-black">
            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
        </div>
        <span className="font-bold text-md text-white md:block xs:block">SyncBoard</span>
      </Link>

     <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
      className="text-neutral-400 hover:text-white transition-colors duration-200"
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </Button>

      {/* CENTER: DESKTOP NAV ITEMS */}
      <div className="hidden md:flex items-center space-x-6 text-neutral-300">
        {children}
      </div>

      {/* RIGHT: AUTH & MOBILE TOGGLE */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:block">
          <Button 
            variant="default" 
            className="rounded-full px-6 bg-white hover:bg-neutral-100 text-black font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_15px_rgba(255,255,255,0.4)]"
            onClick={handleAuthRedirect}
          >
            Sign up
          </Button>
        </div>
      

        {/* Hamburger Icon - Only Mobile */}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden p-2 text-neutral-300 hover:text-white transition-colors duration-200"
        >
          {isOpen ? <X size={24} /> : <MenuIcon size={24} />}
        </button>
      </div>

      {/* MOBILE MENU DRAWER */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-3 p-4 bg-neutral-950 border border-white/10 rounded-3xl shadow-xl md:hidden flex flex-col gap-4 z-50 backdrop-blur-xl"
          >
            <div className="flex flex-col items-start gap-4 px-4 py-2 text-neutral-300">
              {children}
            </div>
            <div className="w-full px-2 pb-2">
              <Button className="w-full rounded-xl bg-white text-black hover:bg-neutral-100 font-semibold" onClick={handleAuthRedirect}>Get Started</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export const MenuItem = ({
  setActive,
  active,
  item,
  children,
  href
}: {
  setActive: (item: string) => void;
  active: string | null;
  item: string;
  children?: React.ReactNode;
  href?: string;
}) => {
  return (
    <div 
      onMouseEnter={() => setActive(item)} 
      onClick={() => setActive(item)} // Helpful for mobile touch
      className="relative"
    >
     {href ? (
        <Link href={href}>
          <motion.p
            transition={{ duration: 0.3 }}
            className="cursor-pointer text-neutral-300 hover:text-white transition-colors duration-200 font-medium text-sm"
          >
            {item}
          </motion.p>
        </Link>
      ) : (
        <motion.p
          transition={{ duration: 0.3 }}
          className="cursor-pointer text-neutral-300 hover:text-white transition-colors duration-200 font-medium text-sm"
        >
          {item}
        </motion.p>
      )}
      {active === item && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={transition}
          className="absolute top-[calc(100%_+_1.2rem)] left-1/2 transform -translate-x-1/2 md:pt-4 z-[100]"
        >
          <div className="bg-neutral-900/90 backdrop-blur-xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
            <div className="w-max h-full p-4">
              {children}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};


export const HoveredLink = ({ children, ...rest }: any) => {
  return (
    <a
      {...rest}
      className="text-neutral-400 hover:text-white transition-colors duration-200 text-sm"
    >
      {children}
    </a>
  );
};
