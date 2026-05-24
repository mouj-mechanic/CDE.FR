"use client";

import { motion } from "framer-motion";
import type { CategoryId, PhotoSceneId } from "@/types";

interface Props {
  category: CategoryId;
  scene: PhotoSceneId;
  /** Restart all animations when this key changes (step nav). */
  cycleKey: string | number;
}

/**
 * Tiny animated SVG vignette that demonstrates the action of the current
 * photo guide step, adapted to the targeted body part.
 *
 * Layout:
 *   [body silhouette with the targeted region highlighted]
 *   + scene-specific overlay (camera frame, light rays, plain background, ...)
 */
export function PhotoStepIllustration({ category, scene, cycleKey }: Props) {
  const region = getRegion(category);
  const body = renderBody(category, region);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[260px] overflow-hidden rounded-3xl bg-gradient-to-br from-cream-dark/70 via-cream to-cream-dark/40 ring-1 ring-ink/5">
      {/* Soft ambient grid */}
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_25%,rgba(201,169,110,0.18),transparent_55%),radial-gradient(circle_at_75%_80%,rgba(122,31,43,0.12),transparent_60%)]" />

      <svg
        key={cycleKey}
        viewBox="0 0 200 200"
        className="relative h-full w-full"
        aria-hidden
      >
        {/* Backdrop */}
        <SceneBackdrop scene={scene} />

        {/* Body */}
        <g transform={bodyTransform(category)}>{body}</g>

        {/* Region pulse */}
        <RegionPulse region={region} />

        {/* Scene-specific overlay */}
        <SceneOverlay scene={scene} region={region} />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Body + region per category                                          */
/* ------------------------------------------------------------------ */

type Region = { cx: number; cy: number; rx: number; ry: number };

function getRegion(category: CategoryId): Region {
  switch (category) {
    case "headwear":
      return { cx: 100, cy: 58, rx: 30, ry: 32 };
    case "glasses":
      return { cx: 100, cy: 70, rx: 26, ry: 12 };
    case "watch":
      return { cx: 138, cy: 132, rx: 14, ry: 14 };
    case "hand-jewelry":
      return { cx: 145, cy: 148, rx: 18, ry: 22 };
    case "clothes":
    default:
      return { cx: 100, cy: 130, rx: 42, ry: 50 };
  }
}

function bodyTransform(category: CategoryId): string {
  // Slight zoom on hand-only categories so the wrist/hand stays prominent.
  if (category === "watch" || category === "hand-jewelry") {
    return "translate(-10 0)";
  }
  return "translate(0 0)";
}

function renderBody(category: CategoryId, _region: Region) {
  const skin = "#E8C9A5";
  const torso = "#7A1F2B";
  const stroke = "#1A1410";

  const head = (
    <>
      <ellipse cx="100" cy="58" rx="22" ry="26" fill={skin} stroke={stroke} strokeWidth="1.2" />
      {/* Eyes */}
      <circle cx="92" cy="58" r="1.6" fill={stroke} />
      <circle cx="108" cy="58" r="1.6" fill={stroke} />
      {/* Mouth */}
      <path d="M93 70 Q100 74 107 70" stroke={stroke} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </>
  );
  const neck = (
    <rect x="94" y="80" width="12" height="10" rx="3" fill={skin} stroke={stroke} strokeWidth="1" />
  );
  const torsoPath = (
    <path
      d="M70 92 Q100 86 130 92 L138 175 Q100 184 62 175 Z"
      fill={torso}
      stroke={stroke}
      strokeWidth="1.2"
    />
  );

  if (category === "headwear" || category === "glasses" || category === "clothes") {
    return (
      <>
        {head}
        {neck}
        {torsoPath}
      </>
    );
  }

  // Hand / wrist focus — draw an arm + hand
  return (
    <>
      {/* Forearm */}
      <path
        d="M70 165 Q90 150 130 130 L160 145 Q120 175 80 180 Z"
        fill={skin}
        stroke={stroke}
        strokeWidth="1.2"
      />
      {/* Wrist crease */}
      <path
        d="M120 132 Q130 142 140 140"
        stroke={stroke}
        strokeOpacity="0.3"
        strokeWidth="1"
        fill="none"
      />
      {/* Fingers (simplified) */}
      <g fill={skin} stroke={stroke} strokeWidth="1">
        <rect x="148" y="138" width="9" height="22" rx="4" />
        <rect x="155" y="142" width="9" height="22" rx="4" />
        <rect x="162" y="146" width="9" height="20" rx="4" />
        <rect x="169" y="152" width="8" height="16" rx="4" />
      </g>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pulsating reticle on the targeted region                            */
/* ------------------------------------------------------------------ */

function RegionPulse({ region }: { region: Region }) {
  return (
    <g>
      <motion.ellipse
        cx={region.cx}
        cy={region.cy}
        rx={region.rx}
        ry={region.ry}
        fill="none"
        stroke="#C9A96E"
        strokeWidth="2"
        strokeDasharray="3 4"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: [0.45, 1, 0.45], scale: [1, 1.05, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: `${region.cx}px ${region.cy}px` }}
      />
      <motion.circle
        cx={region.cx}
        cy={region.cy}
        r="2.2"
        fill="#7A1F2B"
        animate={{ scale: [1, 1.6, 1], opacity: [1, 0.7, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: `${region.cx}px ${region.cy}px` }}
      />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Scene-specific backdrops                                            */
/* ------------------------------------------------------------------ */

function SceneBackdrop({ scene }: { scene: PhotoSceneId }) {
  if (scene === "background") {
    return <rect x="0" y="0" width="200" height="200" fill="#F5EFE6" />;
  }
  if (scene === "lighting") {
    return (
      <>
        <defs>
          <radialGradient id="lightGrad" cx="20%" cy="20%" r="80%">
            <stop offset="0%" stopColor="#FFEFC7" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#FBF7F2" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FBF7F2" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="200" height="200" fill="url(#lightGrad)" />
      </>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Scene-specific overlays                                             */
/* ------------------------------------------------------------------ */

function SceneOverlay({
  scene,
  region,
}: {
  scene: PhotoSceneId;
  region: Region;
}) {
  switch (scene) {
    case "frame":
      return <FrameScene region={region} />;
    case "angle":
      return <AngleScene region={region} />;
    case "lighting":
      return <LightingScene region={region} />;
    case "background":
      return <BackgroundScene />;
    case "remove":
      return <RemoveScene region={region} />;
    case "stable":
      return <StableScene region={region} />;
    case "pose":
      return <PoseScene />;
    case "outfit":
      return <OutfitScene />;
    default:
      return null;
  }
}

function FrameScene({ region }: { region: Region }) {
  // Animate camera viewfinder corners zooming in onto the region.
  const pad = 6;
  const x = region.cx - region.rx - pad;
  const y = region.cy - region.ry - pad;
  const w = (region.rx + pad) * 2;
  const h = (region.ry + pad) * 2;
  const corner = 10;
  return (
    <motion.g
      initial={{ opacity: 0, scale: 1.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: `${region.cx}px ${region.cy}px` }}
    >
      <g stroke="#1A1410" strokeWidth="2.4" fill="none" strokeLinecap="round">
        {/* TL */}
        <path d={`M${x},${y + corner} L${x},${y} L${x + corner},${y}`} />
        {/* TR */}
        <path d={`M${x + w - corner},${y} L${x + w},${y} L${x + w},${y + corner}`} />
        {/* BL */}
        <path d={`M${x},${y + h - corner} L${x},${y + h} L${x + corner},${y + h}`} />
        {/* BR */}
        <path d={`M${x + w - corner},${y + h} L${x + w},${y + h} L${x + w},${y + h - corner}`} />
      </g>
      {/* Camera glyph above */}
      <g transform={`translate(${region.cx - 14},${y - 28})`}>
        <rect x="0" y="6" width="28" height="20" rx="3" fill="#1A1410" />
        <rect x="9" y="2" width="10" height="6" rx="1" fill="#1A1410" />
        <circle cx="14" cy="16" r="5.5" fill="#FBF7F2" stroke="#1A1410" strokeWidth="1" />
        <circle cx="14" cy="16" r="2.5" fill="#7A1F2B" />
      </g>
    </motion.g>
  );
}

function AngleScene({ region }: { region: Region }) {
  // Curved arrow showing the rotation direction, with degree marker.
  const cx = region.cx;
  const cy = region.cy;
  const r = Math.max(region.rx, region.ry) + 14;
  return (
    <g>
      <motion.path
        d={`M ${cx - r},${cy} A ${r} ${r} 0 0 1 ${cx + r * 0.6},${cy - r * 0.8}`}
        stroke="#7A1F2B"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        strokeDasharray="80"
        initial={{ strokeDashoffset: 80 }}
        animate={{ strokeDashoffset: 0 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />
      <motion.polygon
        points="0,-6 9,0 0,6"
        fill="#7A1F2B"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.3, duration: 0.4 }}
        transform={`translate(${cx + r * 0.6},${cy - r * 0.8}) rotate(-30)`}
      />
      <motion.text
        x={cx + r + 4}
        y={cy - r * 0.4}
        fontSize="11"
        fontWeight="700"
        fill="#7A1F2B"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.4 }}
      >
        30°
      </motion.text>
    </g>
  );
}

function LightingScene({ region }: { region: Region }) {
  // Sun rays from upper-left.
  const rays = [0, 1, 2, 3, 4];
  return (
    <g>
      <motion.circle
        cx="36"
        cy="36"
        r="14"
        fill="#FFD27A"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: [1, 1.06, 1], opacity: 1 }}
        transition={{ duration: 1.4, repeat: Infinity, repeatType: "mirror" }}
        style={{ transformOrigin: "36px 36px" }}
      />
      {rays.map((i) => {
        const angle = -45 + i * 15;
        const rad = (angle * Math.PI) / 180;
        const x1 = 36 + Math.cos(rad) * 22;
        const y1 = 36 + Math.sin(rad) * 22;
        const x2 = 36 + Math.cos(rad) * 36;
        const y2 = 36 + Math.sin(rad) * 36;
        return (
          <motion.line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#E8B547"
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ opacity: 0, pathLength: 0 }}
            animate={{ opacity: [0, 1, 0.4, 1], pathLength: 1 }}
            transition={{
              duration: 1.6,
              delay: 0.1 * i,
              repeat: Infinity,
              repeatType: "mirror",
            }}
          />
        );
      })}
      {/* Soft glow on region */}
      <motion.ellipse
        cx={region.cx}
        cy={region.cy}
        rx={region.rx + 8}
        ry={region.ry + 8}
        fill="#FFE6A3"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.35, 0.15, 0.35] }}
        transition={{ duration: 2.4, repeat: Infinity }}
      />
    </g>
  );
}

function BackgroundScene() {
  // Sweep effect: a "clean" bar wipes across replacing patterns.
  return (
    <g>
      <motion.rect
        x="-220"
        y="0"
        width="200"
        height="200"
        fill="#F5EFE6"
        initial={{ x: -220 }}
        animate={{ x: 0 }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* Confirmation tick */}
      <motion.g
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.5, duration: 0.5 }}
      >
        <circle cx="172" cy="28" r="14" fill="#3B7A4E" />
        <path
          d="M165 28 L171 34 L180 22"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </motion.g>
    </g>
  );
}

function RemoveScene({ region }: { region: Region }) {
  return (
    <g>
      {/* Old item being lifted off (small dashed shape) */}
      <motion.g
        initial={{ y: 0, opacity: 1 }}
        animate={{ y: -38, opacity: 0 }}
        transition={{ duration: 1.6, ease: "easeIn", repeat: Infinity, repeatDelay: 0.4 }}
      >
        <ellipse
          cx={region.cx}
          cy={region.cy}
          rx={region.rx}
          ry={region.ry * 0.6}
          fill="#1A1410"
          fillOpacity="0.18"
          stroke="#1A1410"
          strokeDasharray="3 3"
          strokeWidth="1.4"
        />
      </motion.g>
      {/* Hand glyph pulling up */}
      <motion.g
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: -34, opacity: [0, 1, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 0.4 }}
      >
        <path
          d={`M${region.cx - 6},${region.cy - region.ry - 8} q6 -8 12 0 q4 6 -2 10 q-6 -2 -10 -10 z`}
          fill="#E8C9A5"
          stroke="#1A1410"
          strokeWidth="1.2"
        />
      </motion.g>
    </g>
  );
}

function StableScene({ region }: { region: Region }) {
  return (
    <g>
      {/* Surface line under the wrist */}
      <line
        x1={region.cx - 60}
        y1={region.cy + region.ry + 8}
        x2={region.cx + 60}
        y2={region.cy + region.ry + 8}
        stroke="#C9A96E"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* "Stable" radiating waves */}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={region.cx}
          cy={region.cy}
          r={region.rx + 6 + i * 6}
          fill="none"
          stroke="#3B7A4E"
          strokeWidth="1.5"
          initial={{ opacity: 0.6, scale: 0.6 }}
          animate={{ opacity: 0, scale: 1.2 }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            delay: i * 0.4,
            ease: "easeOut",
          }}
          style={{ transformOrigin: `${region.cx}px ${region.cy}px` }}
        />
      ))}
    </g>
  );
}

function PoseScene() {
  // Vertical alignment line + tick marks on the body.
  return (
    <g>
      <motion.line
        x1="100"
        y1="32"
        x2="100"
        y2="180"
        stroke="#C9A96E"
        strokeWidth="1.4"
        strokeDasharray="3 4"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2 }}
      />
      {[60, 100, 140, 170].map((y, i) => (
        <motion.path
          key={y}
          d={`M93 ${y} L99 ${y + 5} L107 ${y - 4}`}
          stroke="#3B7A4E"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ opacity: 0, pathLength: 0 }}
          animate={{ opacity: 1, pathLength: 1 }}
          transition={{ delay: 0.3 + i * 0.18, duration: 0.5 }}
        />
      ))}
    </g>
  );
}

function OutfitScene() {
  // Animated "fitted layer" sliding under the torso.
  return (
    <motion.path
      d="M70 96 Q100 90 130 96 L132 142 Q100 150 68 142 Z"
      fill="#F5EFE6"
      stroke="#1A1410"
      strokeOpacity="0.5"
      strokeWidth="1.2"
      strokeDasharray="3 3"
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 0.85 }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}
