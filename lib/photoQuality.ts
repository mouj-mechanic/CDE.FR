import type { CategoryId } from "@/types";
import { ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE } from "./utils";

export type CheckLevel = "ok" | "warning" | "error";

export interface QualityCheck {
  id: string;
  label: string;
  level: CheckLevel;
  hint?: string;
}

export interface QualityReport {
  checks: QualityCheck[];
  /** True when at least one `error` is present — generation should be blocked. */
  hasBlocker: boolean;
}

const MIN_DIMENSION = 480;
const RECOMMENDED_DIMENSION = 720;
const MIN_BRIGHTNESS = 60; // 0-255
const MAX_BRIGHTNESS = 230;
const BLUR_THRESHOLD = 12; // Laplacian variance (lower = blurrier)

const CATEGORY_HINTS: Record<CategoryId, string> = {
  headwear: "Cadrez votre tête et le haut des épaules, visage centré.",
  glasses: "Visage de face, yeux bien visibles, sans lunettes existantes.",
  watch: "Le poignet et la main doivent être nets et bien visibles.",
  "hand-jewelry": "Cadrez la main entière, doigts légèrement écartés.",
  clothes: "Buste ou corps entier visible, posture droite.",
};

interface FileReport {
  level: CheckLevel;
  label: string;
  hint?: string;
}

function checkFileBasics(file: File): FileReport[] {
  const reports: FileReport[] = [];

  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    reports.push({
      level: "error",
      label: "Format de fichier non supporté",
      hint: "Utilisez JPG, PNG ou WebP.",
    });
  } else {
    reports.push({ level: "ok", label: "Format de fichier valide" });
  }

  if (file.size > MAX_FILE_SIZE) {
    reports.push({
      level: "error",
      label: "Fichier trop volumineux",
      hint: `Maximum ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} Mo.`,
    });
  } else {
    reports.push({ level: "ok", label: "Taille de fichier OK" });
  }

  return reports;
}

interface CanvasMetrics {
  width: number;
  height: number;
  brightness: number;
  blurVariance: number;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Compute brightness + a very rough "is this blurry?" indicator on a
 * downsampled grayscale canvas. Pure heuristic, no AI / MediaPipe.
 */
function analyzeImage(img: HTMLImageElement): CanvasMetrics {
  const targetW = 128;
  const ratio = img.height / img.width;
  const targetH = Math.max(1, Math.round(targetW * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      brightness: 128,
      blurVariance: 100,
    };
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);
  const data = ctx.getImageData(0, 0, targetW, targetH).data;

  // Brightness (avg luma)
  let sum = 0;
  const gray = new Float32Array(targetW * targetH);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = luma;
    sum += luma;
  }
  const brightness = sum / (targetW * targetH);

  // Blur estimate — variance of the discrete Laplacian
  let lapSum = 0;
  let lapSumSq = 0;
  let count = 0;
  for (let y = 1; y < targetH - 1; y++) {
    for (let x = 1; x < targetW - 1; x++) {
      const i = y * targetW + x;
      const lap =
        -gray[i - targetW] -
        gray[i - 1] +
        4 * gray[i] -
        gray[i + 1] -
        gray[i + targetW];
      lapSum += lap;
      lapSumSq += lap * lap;
      count++;
    }
  }
  const lapMean = lapSum / Math.max(1, count);
  const blurVariance = lapSumSq / Math.max(1, count) - lapMean * lapMean;

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    brightness,
    blurVariance,
  };
}

export async function analyzePhotoQuality(
  file: File,
  category: CategoryId
): Promise<QualityReport> {
  const checks: QualityCheck[] = [];

  const basics = checkFileBasics(file);
  for (const b of basics) {
    checks.push({ id: `basic-${checks.length}`, ...b });
  }

  const hasFatalBasic = basics.some((b) => b.level === "error");

  if (!hasFatalBasic) {
    try {
      const img = await loadImage(file);
      const metrics = analyzeImage(img);

      // Dimensions
      const smallest = Math.min(metrics.width, metrics.height);
      if (smallest < MIN_DIMENSION) {
        checks.push({
          id: "dim",
          label: "Résolution insuffisante",
          level: "warning",
          hint: `Au moins ${MIN_DIMENSION}px conseillés sur le plus petit côté.`,
        });
      } else if (smallest < RECOMMENDED_DIMENSION) {
        checks.push({
          id: "dim",
          label: "Résolution acceptable",
          level: "warning",
          hint: `${RECOMMENDED_DIMENSION}px+ recommandés pour le meilleur rendu.`,
        });
      } else {
        checks.push({
          id: "dim",
          label: "Résolution suffisante",
          level: "ok",
        });
      }

      // Aspect ratio
      const ratio = metrics.width / metrics.height;
      if (ratio > 2.2 || ratio < 1 / 2.2) {
        checks.push({
          id: "ratio",
          label: "Cadrage très allongé",
          level: "warning",
          hint:
            "Préférez un cadrage portrait ou carré pour un meilleur résultat.",
        });
      } else {
        checks.push({
          id: "ratio",
          label: "Cadrage adapté",
          level: "ok",
        });
      }

      // Brightness
      if (metrics.brightness < MIN_BRIGHTNESS) {
        checks.push({
          id: "light",
          label: "Photo très sombre",
          level: "warning",
          hint: "Approchez-vous d'une fenêtre ou ajoutez de la lumière.",
        });
      } else if (metrics.brightness > MAX_BRIGHTNESS) {
        checks.push({
          id: "light",
          label: "Photo très claire / surexposée",
          level: "warning",
          hint: "Évitez le soleil direct dans le dos ou le flash trop proche.",
        });
      } else {
        checks.push({
          id: "light",
          label: "Lumière correcte",
          level: "ok",
        });
      }

      // Blur heuristic
      if (metrics.blurVariance < BLUR_THRESHOLD) {
        checks.push({
          id: "blur",
          label: "Photo potentiellement floue",
          level: "warning",
          hint: "Stabilisez votre téléphone ou réessayez avec une photo nette.",
        });
      } else {
        checks.push({
          id: "blur",
          label: "Netteté correcte",
          level: "ok",
        });
      }
    } catch {
      checks.push({
        id: "unreadable",
        label: "Image illisible",
        level: "error",
        hint: "Le fichier semble corrompu. Réessayez avec une autre photo.",
      });
    }
  }

  // Category-specific recommendation (informational)
  checks.push({
    id: "category-hint",
    label: "Cadrage conseillé pour cette catégorie",
    level: "ok",
    hint: CATEGORY_HINTS[category],
  });

  const hasBlocker = checks.some((c) => c.level === "error");
  return { checks, hasBlocker };
}
