import type { ReactNode } from 'react'

export type IconName = 'activity' | 'archive' | 'arrow' | 'cart' | 'cube' | 'layers' | 'refresh' | 'shield'

const paths: Record<IconName, ReactNode> = {
  activity: <path d="M3 12h4l2.4-6 4.2 12 2.4-6h5" />,
  archive: <><path d="M4 7h16v13H4z" /><path d="M2.5 3.5h19v3.5h-19zM9 11h6" /></>,
  arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
  cart: <><path d="M3 4h2l2.2 10h9.9l2-7H6" /><circle cx="9" cy="19" r="1" /><circle cx="17" cy="19" r="1" /></>,
  cube: <><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9z" /><path d="m4.5 6.8 7.5 4.3 7.5-4.3M12 11v9" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M18.2 17a8 8 0 1 1 1.5-8.4L20 12" /></>,
  shield: <path d="M12 2 20 5v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z" />,
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
    >
      {paths[name]}
    </svg>
  )
}
