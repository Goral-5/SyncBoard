"use client";
import { cn } from "@/lib/utils";
// this is a client component
import { useRouter } from "next/navigation";
// Disabled: the hero mouse-trail canvas effect was causing constant animation
// work across the whole page and the cursor-trace visual is not needed.
// import { renderCanvas } from "@/components/ui/canvas"
import { DIcons } from "dicons";
import { Button } from "@/components/ui/button";

export function Hero() {
  const router = useRouter();

  // Disabled: hero canvas trail animation
  // useEffect(() => {
  //   renderCanvas();
  // }, []);

  const handleGetStarted = () => {
    const token = localStorage.getItem('token');
    if (token) {
      router.push('/dashboard');
    } else {
      router.push('/auth');
    }
  };

  return (
    <section id="home">
      <div className="animation-delay-8 animate-fadeIn mt-20 flex  flex-col items-center justify-center px-4 text-center md:mt-20">
          <div
        className={cn(
          "absolute inset-0",
          "[background-size:20px_20px]",
          "[background-image:radial-gradient(#d4d4d4_1px,transparent_2px)]",
          "dark:[background-image:radial-gradient(#404040_1px,transparent_2px)]",
        )}
      />
        <div className="mb-2 mt-4  md:mt-6">
          <div className="px-2">
            <div className="border-ali relative mx-auto h-full max-w-7xl border p-6 [mask-image:radial-gradient(800rem_96rem_at_center,white,transparent)] md:px-12 md:py-20">
              <h1 className="flex  select-none flex-col  px-3 py-2 text-center text-5xl font-semibold leading-none tracking-tight md:flex-col md:text-8xl lg:flex-row lg:text-8xl">
                <DIcons.Plus
                  strokeWidth={4}
                  className="text-ali absolute -left-5 -top-5 h-10 w-10"
                />
                <DIcons.Plus
                  strokeWidth={4}
                  className="text-ali absolute -bottom-5 -left-5 h-10 w-10"
                />
                <DIcons.Plus
                  strokeWidth={4}
                  className="text-ali absolute -right-5 -top-5 h-10 w-10"
                />
                <DIcons.Plus
                  strokeWidth={4}
                  className="text-ali absolute -bottom-5 -right-5 h-10 w-10"
                />
                Create. Collaborate. Synchronized.

              </h1>
              
                
                <div className="flex justify-center gap-2">
            <Button variant="default" size="lg" onClick={handleGetStarted}>
              Open Workspace
            </Button>
          </div>
              
            </div>
          </div>

          <h1 className="mt-8 text-2xl md:text-2xl">
            A real-time collaborative whiteboard where teams can brainstorm, design, and build together on one shared canvas.  
            <span className="text-ali font-bold"></span>
          </h1>

          <p className="md:text-md mx-auto mb-16 mt-2 max-w-2xl px-6 text-sm text-primary/60 sm:px-6 md:max-w-4xl md:px-20 lg:text-lg">
            Brainstorm ideas, map concepts, and collaborate in real time on an infinite digital canvas.
          </p>
          
        </div>
      </div>
      {/*
      <canvas
        className="bg-skin-base pointer-events-none absolute inset-0 mx-auto"
        id="canvas"
      ></canvas>
      */}
    </section>
  );
};
