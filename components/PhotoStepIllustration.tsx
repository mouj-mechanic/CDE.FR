"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CategoryId, PhotoSceneId } from "@/types";
import { getGuideMedia } from "@/lib/guideMedia";
import { cn } from "@/lib/utils";

interface Props {
  category: CategoryId;
  scene: PhotoSceneId;
  /** Restart all animations when this key changes (step nav). */
  cycleKey: string | number;
  /**
   * When true, the registered media is treated as a full mockup card
   * (already containing step number, title and hint). Renders edge-to-edge,
   * larger, and with `object-contain` so nothing is cropped.
   */
  fullCard?: boolean;
}

/**
 * Animated vignette that demonstrates the action of the current photo guide
 * step. If a custom GIF/video has been registered for the (category, scene)
 * pair via lib/guideMedia, that media is shown — otherwise (or if loading
 * the media fails) we fall back to the procedurally-drawn SVG animation.
 */
export function PhotoStepIllustration({
  category,
  scene,
  cycleKey,
  fullCard = false,
}: Props) {
  const media = getGuideMedia(category, scene);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(!!media);

  // Reset state when the (category, scene) pair changes
  useEffect(() => {
    setMediaFailed(false);
    setMediaLoading(!!media);
  }, [category, scene, media]);

  const showMedia = media && !mediaFailed;

  return (
    <div
      className={cn(
        "relative mx-auto aspect-square w-full overflow-hidden rounded-3xl bg-gradient-to-br from-cream-dark/70 via-cream to-cream-dark/40 ring-1 ring-ink/5",
        fullCard ? "max-w-[640px]" : "max-w-[260px]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_25%,rgba(236,72,153,0.18),transparent_55%),radial-gradient(circle_at_75%_80%,rgba(124,58,237,0.12),transparent_60%)]" />

      <AnimatePresence mode="wait">
        {showMedia ? (
          <motion.div
            key={`media-${cycleKey}`}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative h-full w-full"
          >
            {media.kind === "video" ? (
              <video
                src={media.src}
                poster={media.poster}
                autoPlay
                loop
                muted
                playsInline
                onLoadedData={() => setMediaLoading(false)}
                onError={() => {
                  if (process.env.NODE_ENV !== "production") {
                    console.warn(
                      `[PhotoGuide] Missing media for ${category}/${scene}: ${media.src}. Falling back to SVG vignette.`
                    );
                  }
                  setMediaFailed(true);
                }}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  fullCard ? "object-contain" : "object-cover"
                )}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={media.src}
                alt=""
                aria-hidden
                onLoad={() => setMediaLoading(false)}
                onError={() => {
                  if (process.env.NODE_ENV !== "production") {
                    console.warn(
                      `[PhotoGuide] Missing media for ${category}/${scene}: ${media.src}. Falling back to SVG vignette.`
                    );
                  }
                  setMediaFailed(true);
                }}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  fullCard ? "object-contain" : "object-cover"
                )}
              />
            )}

            {/* Loading shimmer */}
            {mediaLoading && (
              <div
                className="absolute inset-0 animate-pulse bg-gradient-to-br from-cream-dark via-cream to-cream-dark"
                aria-hidden
              />
            )}
          </motion.div>
        ) : (
          <SvgVignette
            key={`svg-${cycleKey}`}
            category={category}
            scene={scene}
            cycleKey={cycleKey}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Default procedurally-drawn SVG fallback (used when no GIF/video is set). */
function SvgVignette({ category, scene, cycleKey }: Props) {
  const region = getRegion(category);
  const body = renderBody(category, region);

  return (
    <motion.svg
      key={cycleKey}
      viewBox="0 0 200 200"
      className="relative h-full w-full"
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <SceneBackdrop scene={scene} />
      <g transform={bodyTransform(category)}>{body}</g>
      <RegionPulse region={region} />
      <SceneOverlay scene={scene} region={region} />
    </motion.svg>
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
      // Centered on the wrist band of the new anatomical hand.
      return { cx: 100, cy: 152, rx: 26, ry: 12 };
    case "hand-jewelry":
      // Centered on the ring finger of the new hand.
      return { cx: 110, cy: 80, rx: 14, ry: 16 };
    case "clothes":
    default:
      return { cx: 100, cy: 130, rx: 42, ry: 50 };
  }
}

function bodyTransform(_category: CategoryId): string {
  return "translate(0 0)";
}

function renderBody(category: CategoryId, _region: Region) {
  const skin = "#E8C9A5";
  const torso = "#7C3AED";
  const stroke = "#1E1B4B";

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

  return <Hand category={category} skin={skin} stroke={stroke} />;
}

/* ------------------------------------------------------------------ */
/* Anatomical hand (palm-up, fingers spread)                           */
/* ------------------------------------------------------------------ */

interface HandProps {
  category: CategoryId;
  skin: string;
  stroke: string;
}

function Hand({ category, skin, stroke }: HandProps) {
  // Hand is drawn vertically, fingers up, wrist down — clearer "hand" silhouette
  // than the previous horizontal forearm. Coordinate system: 200x200.
  const skinDark = "#C8A581";
  const skinLight = "#F4D9B8";

  return (
    <g>
      {/* Cuff / sleeve hint at the bottom for context */}
      <path
        d="M68 192 L68 175 Q100 168 132 175 L132 192 Z"
        fill="#7C3AED"
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Forearm */}
      <path
        d="M76 175 Q100 170 124 175 L122 158 Q100 154 78 158 Z"
        fill={skin}
        stroke={stroke}
        strokeWidth="1.2"
      />

      {/* Wrist (slightly narrower) */}
      <path
        d="M78 158 Q100 152 122 158 L120 145 Q100 142 80 145 Z"
        fill={skin}
        stroke={stroke}
        strokeWidth="1.2"
      />

      {/* Wrist crease */}
      <path
        d="M82 156 Q100 152 118 156"
        stroke={stroke}
        strokeOpacity="0.3"
        strokeWidth="1"
        fill="none"
      />

      {/* Watch on the wrist (only for the watch category) */}
      {category === "watch" && (
        <g>
          {/* Strap */}
          <rect x="80" y="146" width="40" height="14" rx="2" fill="#0E1A14" />
          <rect x="80" y="146" width="40" height="14" rx="2" fill="none" stroke={stroke} strokeWidth="1" />
          {/* Case */}
          <rect x="89" y="142" width="22" height="22" rx="3" fill="#D4AF37" stroke={stroke} strokeWidth="1.2" />
          {/* Dial */}
          <rect x="91.5" y="144.5" width="17" height="17" rx="2" fill="#0F4A2E" />
          {/* Hands */}
          <line x1="100" y1="153" x2="100" y2="147" stroke="#F9A8D4" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="100" y1="153" x2="105" y2="156" stroke="#F9A8D4" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="100" cy="153" r="1.2" fill="#F9A8D4" />
        </g>
      )}

      {/* Palm */}
      <path
        d="M80 145 Q78 122 84 102 Q92 92 100 92 Q108 92 116 102 Q122 122 120 145 Z"
        fill={skin}
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* Palm shading */}
      <path
        d="M86 130 Q88 118 96 110"
        stroke={skinDark}
        strokeOpacity="0.45"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M114 130 Q112 118 104 110"
        stroke={skinDark}
        strokeOpacity="0.4"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Fingers — index, middle, ring, pinky (drawn back-to-front for layering) */}
      {/* Pinky */}
      <Finger
        x={120}
        baseY={102}
        length={28}
        width={11}
        skin={skin}
        stroke={stroke}
        skinLight={skinLight}
      />
      {/* Index */}
      <Finger
        x={80}
        baseY={102}
        length={32}
        width={11}
        skin={skin}
        stroke={stroke}
        skinLight={skinLight}
      />
      {/* Middle */}
      <Finger
        x={94}
        baseY={97}
        length={42}
        width={12}
        skin={skin}
        stroke={stroke}
        skinLight={skinLight}
      />
      {/* Ring (with optional ring band when category === hand-jewelry) */}
      <g>
        <Finger
          x={107}
          baseY={97}
          length={38}
          width={12}
          skin={skin}
          stroke={stroke}
          skinLight={skinLight}
        />
        {category === "hand-jewelry" && (
          <g>
            {/* Gold band on the ring finger */}
            <rect x={107} y={75} width={12} height={5} rx={1.5} fill="#D4AF37" stroke={stroke} strokeWidth="0.8" />
            <rect x={107} y={75} width={12} height={1.4} fill="#F9A8D4" />
            {/* Tiny gem */}
            <circle cx={113} cy={73.5} r={2} fill="#7C3AED" stroke="#F9A8D4" strokeWidth="0.6" />
          </g>
        )}
      </g>

      {/* Thumb — to the left, bent outward */}
      <path
        d="M80 130 Q66 128 60 142 Q60 154 72 152 Q80 150 82 138 Z"
        fill={skin}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Thumb nail */}
      <ellipse cx="64" cy="142" rx="3" ry="2" fill={skinLight} opacity="0.8" />
    </g>
  );
}

/** A single finger with a fingernail. baseY is the top of the palm where it attaches. */
function Finger({
  x,
  baseY,
  length,
  width,
  skin,
  stroke,
  skinLight,
}: {
  x: number;
  baseY: number;
  length: number;
  width: number;
  skin: string;
  stroke: string;
  skinLight: string;
}) {
  const top = baseY - length;
  const r = width / 2;
  return (
    <g>
      <path
        d={`M${x},${baseY}
            L${x},${top + r}
            Q${x + r},${top - r * 0.4} ${x + width},${top + r}
            L${x + width},${baseY}
            Z`}
        fill={skin}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Knuckle line */}
      <path
        d={`M${x + 1.5},${top + length * 0.45} Q${x + width / 2},${top + length * 0.42} ${x + width - 1.5},${top + length * 0.45}`}
        stroke="#C8A581"
        strokeOpacity="0.5"
        strokeWidth="0.8"
        fill="none"
      />
      {/* Fingernail */}
      <ellipse
        cx={x + width / 2}
        cy={top + r * 0.7}
        rx={r * 0.55}
        ry={r * 0.45}
        fill={skinLight}
        opacity="0.85"
      />
    </g>
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
        stroke="#EC4899"
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
        fill="#7C3AED"
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
            <stop offset="60%" stopColor="#FDF4FF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FDF4FF" stopOpacity="0" />
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
      <g stroke="#1E1B4B" strokeWidth="2.4" fill="none" strokeLinecap="round">
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
        <rect x="0" y="6" width="28" height="20" rx="3" fill="#1E1B4B" />
        <rect x="9" y="2" width="10" height="6" rx="1" fill="#1E1B4B" />
        <circle cx="14" cy="16" r="5.5" fill="#FDF4FF" stroke="#1E1B4B" strokeWidth="1" />
        <circle cx="14" cy="16" r="2.5" fill="#7C3AED" />
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
        stroke="#7C3AED"
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
        fill="#7C3AED"
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
        fill="#7C3AED"
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
          fill="#1E1B4B"
          fillOpacity="0.18"
          stroke="#1E1B4B"
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
          stroke="#1E1B4B"
          strokeWidth="1.2"
        />
      </motion.g>
    </g>
  );
}

function StableScene({ region }: { region: Region }) {
  // Use the bottom of the SVG as the "table" so the surface line is always
  // under the forearm, regardless of region position.
  const surfaceY = 190;
  return (
    <g>
      <line
        x1={20}
        y1={surfaceY}
        x2={180}
        y2={surfaceY}
        stroke="#EC4899"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Hatching under the surface */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line
          key={i}
          x1={28 + i * 26}
          y1={surfaceY + 1}
          x2={20 + i * 26}
          y2={surfaceY + 8}
          stroke="#EC4899"
          strokeOpacity="0.6"
          strokeWidth="1"
        />
      ))}
      {/* "Stable" radiating waves on the region */}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={region.cx}
          cy={region.cy}
          r={Math.max(region.rx, region.ry) + 6 + i * 6}
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
        stroke="#EC4899"
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
      stroke="#1E1B4B"
      strokeOpacity="0.5"
      strokeWidth="1.2"
      strokeDasharray="3 3"
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 0.85 }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}
