"use client";

/**
 * Floating animated colour blobs that sit behind the whole app.
 * Pure CSS — no JS frame loop. Disabled for users with reduced motion.
 *
 * Drop this once at the root (app/layout.tsx) so every page benefits.
 */
export function ColorfulBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden motion-reduce:hidden"
    >
      <div
        className="bg-blob h-[44rem] w-[44rem] animate-blob"
        style={{ top: "-10rem", left: "-12rem", background: "#A855F7" }}
      />
      <div
        className="bg-blob h-[36rem] w-[36rem] animate-blob-slow"
        style={{
          top: "10%",
          right: "-10rem",
          background: "#EC4899",
          animationDelay: "-4s",
        }}
      />
      <div
        className="bg-blob h-[40rem] w-[40rem] animate-blob"
        style={{
          bottom: "-12rem",
          left: "10%",
          background: "#FDA4AF",
          animationDelay: "-9s",
        }}
      />
      <div
        className="bg-blob h-[28rem] w-[28rem] animate-blob-slow"
        style={{
          bottom: "10%",
          right: "5%",
          background: "#7DD3FC",
          animationDelay: "-14s",
          opacity: 0.35,
        }}
      />
    </div>
  );
}
