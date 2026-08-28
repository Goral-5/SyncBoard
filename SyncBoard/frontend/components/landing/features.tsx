"use client";

import React from "react";
import { Carousel, Card } from "@/components/ui/apple-cards-carousel";

export function Features () {
  const cards = data.map((card, index) => (
    <Card key={card.src} card={card} index={index} />
  ));

  return (
    <div id="features" className="w-full h-full py-5">
      <h2 className="w-full self-center align-middle text-center text-xl md:text-5xl font-bold text-neutral-800 dark:text-neutral-200 font-sans">
        Built for Real-Time Collaboration
      </h2>
      <Carousel items={cards} />
    </div>
  );
}


const data = [
  {
    category: "Performance",
    title: "Real-Time State Synchronization.",
    src: "https://www.nework.ai/cdn/shop/files/4K_smart_board_for_classroom_teaching_with_touchscreen_display_and_stand_-_Nework.jpg?v=1775109382",
    
  },
  {
    category: "Storage",
    title: "Persistent Shared Boards.",
    src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSH76FO5Hhnac6jiTyANuHY6XneHfMS-b7HUzg0otuaQg&s=10",
    
  },
  {
    category: "Security",
    title: "Secure Role-Based Access.",
    src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZufZNSNccmwDMf2hc_zA_LB0788i4IgSFeH8ZjsAuQw&s=10",
    
  },
];