/**
 * Backward-compatibility shim. The actual implementation now lives in
 * `falKontext.ts`. New code should import from there or use the router
 * exposed by `tryOnService.ts`.
 */
export { falKontextTryOn as falTryOn } from "./falKontext";
