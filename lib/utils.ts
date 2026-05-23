import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

export const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 o";
  const k = 1024;
  const sizes = ["o", "Ko", "Mo"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function validateImageFile(file: File): {
  valid: boolean;
  error?: string;
} {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Format non accepté. Utilisez JPG, PNG ou WebP.",
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `Fichier trop volumineux (max ${formatBytes(MAX_FILE_SIZE)}).`,
    };
  }
  return { valid: true };
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Resolve relative or localhost media URLs against the current browser origin (LAN-safe). */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let resolved = url.trim();
  if (typeof window === "undefined") return resolved;

  if (resolved.startsWith("//")) {
    resolved = `${window.location.protocol}${resolved}`;
  } else if (resolved.startsWith("/")) {
    resolved = `${window.location.origin}${resolved}`;
  }

  try {
    const parsed = new URL(resolved);
    const localHosts = ["localhost", "127.0.0.1"];
    const curHost = window.location.hostname;
    if (
      localHosts.includes(parsed.hostname) &&
      !localHosts.includes(curHost)
    ) {
      parsed.hostname = curHost;
      parsed.port = window.location.port;
      parsed.protocol = window.location.protocol;
      return parsed.toString();
    }
  } catch {
    return resolved;
  }

  return resolved;
}
