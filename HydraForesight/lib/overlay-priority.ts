export type OverlayLayer = "ai" | "next-devtools"

export const OVERLAY_ACTIVATION_EVENT = "hydra-overlay-activate"

const DEVTOOLS_SELECTORS = [
  "[data-nextjs-toast]",
  "[data-nextjs-dev-tools-button]",
  "#nextjs-dev-tools-menu",
]

export function emitOverlayActivation(layer: OverlayLayer) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent<OverlayLayer>(OVERLAY_ACTIVATION_EVENT, { detail: layer }))
}

export function getOverlayZIndex(layer: OverlayLayer) {
  if (layer === "next-devtools") {
    return {
      trigger: 2147482100,
      overlay: 2147482200,
      resizeHandle: 2147482201,
    }
  }

  return {
    trigger: 2147483644,
    overlay: 2147483646,
    resizeHandle: 2147483646,
  }
}

export function isNextDevToolsTarget(target: EventTarget | null, path: EventTarget[] = []) {
  const candidates = [target, ...path]

  return candidates.some((candidate) => {
    if (!(candidate instanceof Element)) {
      return false
    }

    if (candidate.tagName === "NEXTJS-PORTAL") {
      return true
    }

    return DEVTOOLS_SELECTORS.some((selector) => candidate.matches(selector))
  })
}
