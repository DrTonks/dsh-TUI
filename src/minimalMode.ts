/**
 * Minimal mode: one process-wide flag gating decorative UI (header splash,
 * emoji status glyphs, non-tool text colors, status-bar extras). The flag is
 * owned by the channel (settings `dsh-tui.minimal`, applied live through
 * scope.watch); leaf components read it here instead of threading a prop
 * through four render layers. Code highlighting and tool-name colors are
 * deliberately NOT gated — minimal keeps those.
 */

let minimal = false

/** True when minimal mode is active (settings `dsh-tui.minimal`). */
export function isMinimalMode(): boolean {
  return minimal
}

/** @internal channel-owned setter; also called once at boot. */
export function setMinimalMode(enabled: boolean): void {
  minimal = enabled
}
