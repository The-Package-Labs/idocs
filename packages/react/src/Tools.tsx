/** Buttons the toolbar over the picture shares between the canvas and the scrolling presentations. */

export function FullscreenTool({
  fullscreen,
  onToggle,
}: {
  fullscreen: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="idocs-tool"
      title={fullscreen ? 'Exit full screen' : 'Full screen'}
      aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {fullscreen ? (
          <path d="M13.5 6.5H9.5v-4M9.5 6.5l4.5-4.5M2.5 9.5h4v4M6.5 9.5L2 14" />
        ) : (
          <path d="M9.5 2.5h4v4M13.5 2.5l-5 5M6.5 13.5h-4v-4M2.5 13.5l5-5" />
        )}
      </svg>
    </button>
  )
}
