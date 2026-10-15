import { useLightingCatalogOperation } from "./useLightingCatalogOperation";

/** Settings operations share the catalog's pending and unmount notification boundary. */
export function useLightingOperation() {
  return useLightingCatalogOperation();
}
