/**
 * Reusable prompt blocks composed into every OpenAI try-on prompt.
 *
 *  Why split them out?
 *    - GPT Image edit will happily redesign the customer or the product
 *      unless the prompt explicitly forbids it, repeatedly.
 *    - Centralising the wording guarantees that all five categories share
 *      the same fidelity guarantees.
 *    - Tuning a block (e.g. tightening hand preservation) is one edit,
 *      not five.
 *
 *  Each block is a complete sentence-paragraph designed to be appended
 *  with a blank line between it and the next block.
 */

export const CUSTOMER_PRESERVATION_BLOCK =
  "Preserve the customer exactly. Do not change identity, face, eyes, " +
  "mouth, nose, hand shape, fingers, nails, skin texture, skin tone, arm " +
  "hair, body proportions, pose, camera angle, lighting, or background " +
  "outside the masked area. Everything outside the mask must remain " +
  "visually unchanged.";

export const PRODUCT_FIDELITY_BLOCK =
  "Preserve the product reference as faithfully as possible. Do not " +
  "redesign, simplify, recolor, invent, replace, distort, or change the " +
  "product. Preserve its shape, material, texture, pattern, logo, dial " +
  "details, frame shape, metal finish, gemstone placement, fabric " +
  "texture, color, and visible details. The final product must remain " +
  "recognizable as the exact reference product.";

export const NO_HALLUCINATION_BLOCK =
  "Do not create extra fingers, extra limbs, extra jewelry, duplicated " +
  "products, fake reflections, product background rectangles, or " +
  "unrelated accessories.";

export const MASK_BLOCK =
  "Edit only inside the provided mask. Do not modify any pixel outside " +
  "the masked area except for extremely subtle natural blending at the " +
  "mask edge.";

/** No-mask variant: still demands tight area focus + customer preservation. */
export const NO_MASK_FOCUS_BLOCK =
  "No mask was provided. Restrict edits to the smallest area strictly " +
  "necessary to add the product. Treat the rest of the image as " +
  "preserved pixels and never modify them.";

/**
 * Compose the four blocks together. Caller picks whether the mask block
 * or the no-mask focus block is appended.
 */
export function preservationFooter(opts: { maskUsed: boolean }): string {
  return [
    CUSTOMER_PRESERVATION_BLOCK,
    PRODUCT_FIDELITY_BLOCK,
    NO_HALLUCINATION_BLOCK,
    opts.maskUsed ? MASK_BLOCK : NO_MASK_FOCUS_BLOCK,
  ].join("\n\n");
}
