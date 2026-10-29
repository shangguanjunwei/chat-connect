import { useId } from 'react'
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export function Logo({ size = 44 }: { size?: number }) {
  const raw = useId()
  const id = `logo-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id={id} x1="6" y1="2" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5B7CFA" />
          <stop offset="0.55" stopColor="#3A6BF5" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="48" height="48" rx="14" fill={`url(#${id})`} />
      <path
        d="M10 18.5c4.7-4.2 9.3-4.2 14 0s9.3 4.2 14 0"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.96"
      />
      <path
        d="M10 25.5c4.7-4.2 9.3-4.2 14 0s9.3 4.2 14 0"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      <path
        d="M10 32.5c4.7-4.2 9.3-4.2 14 0s9.3 4.2 14 0"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.42"
      />
    </svg>
  )
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="15" r="4.2" />
      <path d="M11.2 12.2 20 3.5M16 7.8l2.7 2.6M18.8 5l2.6 2.6" />
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2.4h6a2.5 2.5 0 0 1 2.5 2.5v7.6A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5Z" />
    </svg>
  )
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.2 5 6v5.4c0 4.2 2.9 7.6 7 9.4 4.1-1.8 7-5.2 7-9.4V6Z" />
      <path d="m9.2 12 2 2 3.7-4" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.4 4.3L19 6.8" />
    </svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4.2 21 20H3Z" />
      <path d="M12 9.5v4.2M12 17h.01" />
    </svg>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12h15M13.5 6.5 19.5 12l-6 5.5" />
    </svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 12H5M10.5 6.5 4.5 12l6 5.5" />
    </svg>
  )
}

export function ExternalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </svg>
  )
}

export function ServerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4" width="17" height="6" rx="2" />
      <rect x="3.5" y="14" width="17" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 11a8 8 0 1 0-2.3 6.4" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h7l5 5V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20Z" />
      <path d="M13 3.5V9h5M9 13h6M9 16.5h6" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5c.6 3.7 1.8 4.9 5.5 5.5-3.7.6-4.9 1.8-5.5 5.5-.6-3.7-1.8-4.9-5.5-5.5 3.7-.6 4.9-1.8 5.5-5.5Z" />
      <path d="M18 15.5c.3 1.8.9 2.4 2.7 2.7-1.8.3-2.4.9-2.7 2.7-.3-1.8-.9-2.4-2.7-2.7 1.8-.3 2.4-.9 2.7-2.7Z" />
    </svg>
  )
}
