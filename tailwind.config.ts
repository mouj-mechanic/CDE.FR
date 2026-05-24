import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Light, airy lavender / peach background tones
        cream: {
          DEFAULT: "#FBF5FF",
          dark: "#F3E8FF",
        },
        // PRIMARY — vivid violet (was "bordeaux"; name kept to avoid mass refactor)
        bordeaux: {
          DEFAULT: "#7C3AED",
          light: "#A855F7",
          dark: "#5B21B6",
        },
        // ACCENT — hot pink (was "gold")
        gold: {
          DEFAULT: "#EC4899",
          light: "#F9A8D4",
          muted: "#FBCFE8",
        },
        // Text / ink — deep indigo, readable on lavender
        ink: {
          DEFAULT: "#1E1B4B",
          muted: "#4C1D95",
          light: "#7C3AED",
        },
        // Bonus accents for the vivid look
        peach: {
          DEFAULT: "#FDA4AF",
          light: "#FFE4E6",
        },
        sky: {
          DEFAULT: "#7DD3FC",
          light: "#E0F2FE",
        },
      },
      fontFamily: {
        display: ["var(--font-cormorant)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      boxShadow: {
        soft: "0 4px 24px -4px rgba(124, 58, 237, 0.18)",
        lifted: "0 16px 48px -10px rgba(124, 58, 237, 0.28)",
        glow: "0 0 48px -8px rgba(236, 72, 153, 0.45)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        blob: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(40px, -50px) scale(1.1)" },
          "66%": { transform: "translate(-30px, 30px) scale(0.95)" },
        },
        gradient: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        shimmer: "shimmer 2.5s ease-in-out infinite",
        "pulse-soft": "pulseSoft 1.5s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
        blob: "blob 18s ease-in-out infinite",
        "blob-slow": "blob 28s ease-in-out infinite",
        "gradient-x": "gradient 8s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
