import {
  Gem,
  Glasses,
  Shirt,
  Watch,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/types";

function HatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 14c0-4 3.5-7 8-7s8 3 8 7" />
      <path d="M2 14h20v2c0 1-1 2-2 2H4c-1 0-2-1-2-2v-2z" />
      <ellipse cx="12" cy="7" rx="5" ry="2" />
    </svg>
  );
}

const ICON_MAP: Record<IconName, LucideIcon | typeof HatIcon> = {
  hat: HatIcon,
  watch: Watch,
  gem: Gem,
  shirt: Shirt,
  glasses: Glasses,
};

interface CategoryIconProps {
  name: IconName;
  className?: string;
}

export function CategoryIcon({ name, className = "h-8 w-8" }: CategoryIconProps) {
  const Icon = ICON_MAP[name];
  return <Icon className={className} aria-hidden />;
}
