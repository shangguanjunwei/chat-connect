/**
 * Workspace brand layer.
 *
 * The embedded Web UI is an upstream, prebuilt client. It exposes stable
 * `data-slot` hooks for its brand marks, so Chat Connect can replace the visible
 * wordmark without patching upstream bundles. CSS is injected on every
 * navigation; the underlying engine and its notices stay untouched.
 */
export const WORKSPACE_BRAND_CSS = String.raw`
  /* Remove the upstream whale mark and wordmark. */
  [data-slot="sidebar.brand.mark"],
  [data-slot="sidebar.brand.name"],
  [data-slot="conversation.hero.brand.mark"] {
    display: none !important;
  }

  /* Replace the small sidebar mark with a Chat Connect tile. */
  span:has(> [data-slot="sidebar.brand.mark"]) {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    flex: none;
    background: linear-gradient(135deg, #5b7cfa 0%, #3a6bf5 55%, #22d3ee 100%);
  }
  span:has(> [data-slot="sidebar.brand.mark"])::after {
    content: "C";
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
  }

  /* Replace the full wordmark with Chat Connect. */
  span:has(> [data-slot="sidebar.brand.name"])::after {
    content: "Chat Connect";
    color: var(--dsw-alias-label-primary, currentColor);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
`
