import type { ReactNode } from 'react'
import { IconRegistryProvider } from '@weasel-js/core'
import icons from 'virtual:weasel-icons'

/** The glyphs weasel's `Icon` draws from — the ones this build names, gathered by `weaselIcons` in vite.config.ts. */
export function WeaselIcons({ children }: { children: ReactNode }) {
  return <IconRegistryProvider icons={icons}>{children}</IconRegistryProvider>
}
