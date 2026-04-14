"use client"

import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  OVERLAY_ACTIVATION_EVENT,
  emitOverlayActivation,
  getOverlayZIndex,
  isNextDevToolsTarget,
  type OverlayLayer,
} from "@/lib/overlay-priority"
import AIAssistantPanel from "./ai-assistant-panel"

const MIN_DIALOG_WIDTH = 520
const MIN_DIALOG_HEIGHT = 560
const DEFAULT_DIALOG_WIDTH = 960
const DEFAULT_DIALOG_HEIGHT = 760
const MAX_DIALOG_WIDTH = 1240
const MAX_DIALOG_HEIGHT = 920
const VIEWPORT_PADDING = 24

type DialogSize = {
  width: number
  height: number
}

type ResizeSession = {
  startX: number
  startY: number
  startWidth: number
  startHeight: number
}

function getDialogBounds() {
  if (typeof window === "undefined") {
    return {
      maxWidth: DEFAULT_DIALOG_WIDTH,
      maxHeight: DEFAULT_DIALOG_HEIGHT,
    }
  }

  return {
    maxWidth: Math.max(MIN_DIALOG_WIDTH, Math.min(MAX_DIALOG_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)),
    maxHeight: Math.max(MIN_DIALOG_HEIGHT, Math.min(MAX_DIALOG_HEIGHT, window.innerHeight - VIEWPORT_PADDING * 2)),
  }
}

function clampDialogSize(size: DialogSize, bounds: { maxWidth: number; maxHeight: number }) {
  return {
    width: Math.min(Math.max(size.width, MIN_DIALOG_WIDTH), bounds.maxWidth),
    height: Math.min(Math.max(size.height, MIN_DIALOG_HEIGHT), bounds.maxHeight),
  }
}

export default function AIAssistantButton() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [activeLayer, setActiveLayer] = useState<OverlayLayer>("ai")
  const [dialogSize, setDialogSize] = useState<DialogSize>({
    width: DEFAULT_DIALOG_WIDTH,
    height: DEFAULT_DIALOG_HEIGHT,
  })
  const [dialogBounds, setDialogBounds] = useState(() => getDialogBounds())
  const [isResizing, setIsResizing] = useState(false)
  const resizeSessionRef = useRef<ResizeSession | null>(null)
  const dialogBoundsRef = useRef(dialogBounds)
  const zIndex = getOverlayZIndex(activeLayer)

  useEffect(() => {
    dialogBoundsRef.current = dialogBounds
  }, [dialogBounds])

  useEffect(() => {
    const handleOverlayActivation = (event: Event) => {
      const customEvent = event as CustomEvent<OverlayLayer>
      setActiveLayer(customEvent.detail || "ai")
    }

    const handlePointerDown = (event: PointerEvent) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : []

      if (isNextDevToolsTarget(event.target, path)) {
        emitOverlayActivation("next-devtools")
        return
      }

      if (path.some((candidate) => candidate instanceof HTMLElement && candidate.dataset.hydraAiSurface === "true")) {
        emitOverlayActivation("ai")
      }
    }

    window.addEventListener(OVERLAY_ACTIVATION_EVENT, handleOverlayActivation as EventListener)
    document.addEventListener("pointerdown", handlePointerDown, true)

    return () => {
      window.removeEventListener(OVERLAY_ACTIVATION_EVENT, handleOverlayActivation as EventListener)
      document.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [])

  useEffect(() => {
    if (!isDialogOpen) {
      return
    }

    const syncBounds = () => {
      const nextBounds = getDialogBounds()
      dialogBoundsRef.current = nextBounds
      setDialogBounds(nextBounds)
      setDialogSize((current) => clampDialogSize(current, nextBounds))
    }

    syncBounds()
    window.addEventListener("resize", syncBounds)

    return () => {
      window.removeEventListener("resize", syncBounds)
    }
  }, [isDialogOpen])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor

    const handleMouseMove = (event: MouseEvent) => {
      const session = resizeSessionRef.current
      if (!session) {
        return
      }

      setDialogSize(
        clampDialogSize(
          {
            width: session.startWidth + (event.clientX - session.startX),
            height: session.startHeight + (event.clientY - session.startY),
          },
          dialogBoundsRef.current
        )
      )
    }

    const handleMouseUp = () => {
      resizeSessionRef.current = null
      setIsResizing(false)
    }

    document.body.style.userSelect = "none"
    document.body.style.cursor = "nwse-resize"
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing])

  const handleResizeStart = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    emitOverlayActivation("ai")

    resizeSessionRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: dialogSize.width,
      startHeight: dialogSize.height,
    }
    setIsResizing(true)
  }

  return (
    <>
      <Button
        onClick={() => {
          emitOverlayActivation("ai")
          setIsDialogOpen(true)
        }}
        className="fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-lg"
        size="icon"
        style={{ zIndex: zIndex.trigger }}
        data-hydra-ai-surface="true"
      >
        <Bot className="h-6 w-6" />
        <span className="sr-only">打开AI助手</span>
      </Button>

      {isDialogOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-md pointer-events-auto"
          style={{ zIndex: zIndex.overlay }}
          data-hydra-ai-surface="true"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="pointer-events-auto relative isolate flex min-w-0 max-w-none overflow-hidden rounded-[28px] border border-slate-200/90 bg-white/98 shadow-[0_32px_96px_rgba(15,23,42,0.45)] ring-1 ring-black/5 dark:border-slate-700/90 dark:bg-slate-950/98"
            style={{
              width: `${dialogSize.width}px`,
              height: `${dialogSize.height}px`,
              minWidth: `${MIN_DIALOG_WIDTH}px`,
              minHeight: `${MIN_DIALOG_HEIGHT}px`,
              maxWidth: `${dialogBounds.maxWidth}px`,
              maxHeight: `${dialogBounds.maxHeight}px`,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            data-hydra-ai-surface="true"
          >
            <AIAssistantPanel
              onClose={() => setIsDialogOpen(false)}
              className="h-full w-full rounded-[inherit] border-0 bg-transparent shadow-none"
            />

            <button
              type="button"
              aria-label="调整窗口大小"
              className="absolute bottom-0 right-0 flex h-7 w-7 cursor-nwse-resize items-end justify-end rounded-tl-xl bg-slate-200/90 p-1.5 text-slate-500 transition hover:bg-slate-300 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-700"
              onMouseDown={handleResizeStart}
              style={{ zIndex: zIndex.resizeHandle }}
              data-hydra-ai-surface="true"
            >
              <span className="pointer-events-none block h-3.5 w-3.5 bg-[linear-gradient(135deg,transparent_0,transparent_40%,currentColor_40%,currentColor_50%,transparent_50%,transparent_65%,currentColor_65%,currentColor_75%,transparent_75%)] opacity-80" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
