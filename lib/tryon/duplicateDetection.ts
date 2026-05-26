import sharp from "sharp";
import type { CategoryId } from "@/types";

/**
 * Detect whether the AI result contains more than one product instance.
 *
 *  Approach:
 *    1. Diff the AI result against the original user photo (same logic
 *       as `productLockComposite` / `productFidelityCheck`).
 *    2. Run a 4-neighbour connected-components flood-fill on the
 *       resulting binary silhouette.
 *    3. Keep components whose area is large enough to plausibly be the
 *       product (≥ 30 % of the expected silhouette area).
 *    4. Two or more such components ⇒ duplication.
 *
 *  Why not just compare total silhouette area?
 *    A larger silhouette can mean "the AI drew the product slightly
 *    bigger" rather than "two products". By counting *separate*
 *    components we discriminate between those two cases.
 *
 *  Cost:
 *    The flood-fill runs on a 128×128 downsample so even pathological
 *    inputs complete in <30 ms. It's pure JS, no native bindings.
 */

const DOWNSAMPLE = 128;

export interface DuplicateDetectionInput {
  /** PNG buffer of the AI result. */
  aiResult: Buffer;
  /** PNG buffer of the original user photo (no product). */
  userBase: Buffer;
  /**
   * Expected product silhouette area as a ratio of total pixels
   * (0..1). Computed from the deterministic composite. We compare
   * connected components against this number to know what counts as
   * "another full product".
   */
  expectedSilhouetteRatio: number;
  category: CategoryId;
  /**
   * Pixel diff threshold (0..255). Default 18 — same as the rest of the
   * fidelity stack.
   */
  diffThreshold?: number;
}

export interface DetectedComponent {
  /** Area of the component, expressed as ratio of total pixels (0..1). */
  areaRatio: number;
  /** Bounding box, in downsampled image space (0..DOWNSAMPLE). */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface DuplicateDetectionResult {
  /** True when two or more product-sized components were found. */
  duplicateDetected: boolean;
  /** Number of components large enough to plausibly be the product. */
  componentCount: number;
  /** Sorted by area descending. The first one is the "intended" product. */
  components: DetectedComponent[];
  /**
   * Why the result is what it is. Useful for the API debug payload
   * and for QA dashboards.
   */
  reason: string;
}

interface RawRGBA {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

async function rawAt(src: Buffer, dim: number): Promise<RawRGBA> {
  const { data, info } = await sharp(src)
    .resize(dim, dim, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels === 4 ? 4 : 3,
  };
}

function buildSilhouette(
  user: RawRGBA,
  result: RawRGBA,
  threshold: number
): Uint8Array {
  const px = user.width * user.height;
  const mask = new Uint8Array(px);
  for (let i = 0; i < px; i++) {
    const ui = i * user.channels;
    const ri = i * result.channels;
    const dr = Math.abs(user.data[ui] - result.data[ri]);
    const dg = Math.abs(user.data[ui + 1] - result.data[ri + 1]);
    const db = Math.abs(user.data[ui + 2] - result.data[ri + 2]);
    if ((dr + dg + db) / 3 > threshold) {
      mask[i] = 1;
    }
  }
  return mask;
}

/** 4-neighbour flood-fill connected components. Returns components sorted by area desc. */
function findComponents(
  mask: Uint8Array,
  w: number,
  h: number
): Array<{
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}> {
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  const components: Array<{
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }> = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || visited[start]) continue;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      stack.length = 0;
      stack.push(start);
      while (stack.length > 0) {
        const idx = stack.pop() as number;
        if (visited[idx]) continue;
        visited[idx] = 1;
        area++;
        const px2 = idx % w;
        const py2 = (idx - px2) / w;
        if (px2 < minX) minX = px2;
        if (px2 > maxX) maxX = px2;
        if (py2 < minY) minY = py2;
        if (py2 > maxY) maxY = py2;
        if (px2 > 0 && mask[idx - 1] && !visited[idx - 1]) stack.push(idx - 1);
        if (px2 < w - 1 && mask[idx + 1] && !visited[idx + 1])
          stack.push(idx + 1);
        if (py2 > 0 && mask[idx - w] && !visited[idx - w]) stack.push(idx - w);
        if (py2 < h - 1 && mask[idx + w] && !visited[idx + w])
          stack.push(idx + w);
      }
      components.push({ area, minX, minY, maxX, maxY });
    }
  }
  components.sort((a, b) => b.area - a.area);
  return components;
}

/**
 * Threshold above which a connected component counts as "an extra
 * product instance". Tuned per category — watches/glasses have a
 * single sharp silhouette so 30 % of the expected area is enough to
 * count as a second product; headwear can produce smaller secondary
 * components from hair occlusion artefacts so the bar is higher.
 */
function secondInstanceMinRatio(category: CategoryId): number {
  switch (category) {
    case "watch":
    case "hand-jewelry":
    case "glasses":
      return 0.3;
    case "headwear":
      return 0.45;
    case "clothes":
      // Clothes legitimately occupy a large continuous region; we
      // never flag duplication for them.
      return 0.95;
  }
}

export async function detectDuplicateProductPlacement(
  input: DuplicateDetectionInput
): Promise<DuplicateDetectionResult> {
  if (input.category === "clothes") {
    return {
      duplicateDetected: false,
      componentCount: 0,
      components: [],
      reason: "Clothes do not use duplicate detection.",
    };
  }
  if (input.expectedSilhouetteRatio <= 0.005) {
    return {
      duplicateDetected: false,
      componentCount: 0,
      components: [],
      reason: "Expected silhouette ratio is too small to discriminate.",
    };
  }

  const threshold = input.diffThreshold ?? 18;
  const [userRaw, resultRaw] = await Promise.all([
    rawAt(input.userBase, DOWNSAMPLE),
    rawAt(input.aiResult, DOWNSAMPLE),
  ]);
  const mask = buildSilhouette(userRaw, resultRaw, threshold);
  const components = findComponents(mask, DOWNSAMPLE, DOWNSAMPLE);
  const totalPx = DOWNSAMPLE * DOWNSAMPLE;

  const minInstanceRatio =
    input.expectedSilhouetteRatio * secondInstanceMinRatio(input.category);

  const significant = components.filter(
    (c) => c.area / totalPx >= minInstanceRatio
  );

  const detected = significant.length >= 2;

  return {
    duplicateDetected: detected,
    componentCount: significant.length,
    components: significant.map((c) => ({
      areaRatio: c.area / totalPx,
      bbox: {
        x: c.minX,
        y: c.minY,
        w: c.maxX - c.minX + 1,
        h: c.maxY - c.minY + 1,
      },
    })),
    reason: detected
      ? `Found ${significant.length} product-sized regions in the AI output (expected 1).`
      : significant.length === 0
        ? "No product-sized region detected (product may be missing)."
        : "Single product region detected.",
  };
}
