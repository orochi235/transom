import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App.tsx'
import { carryIn } from '@/carry.ts'
import { WeaselIcons } from '@/WeaselIcons.tsx'
import '@/styles.css'
// The component styles only. Deliberately not `@weasel-js/theme`'s tokens.css,
// which also sets a document font and would re-type the whole wall.
import '@weasel-js/ui/style.css'
import '@/weasel.css'

// The demo daemon installs before the first render, so the wall never opens a
// socket it has no daemon for. `__TRANSOM_DEMO__` is a build-time literal, which
// is how the daemon and its forty pictures stay out of the ordinary bundle.
// Wrapped rather than awaited at the top level, which the build target refuses.
const boot = async () => {
  if (carryIn(location.hash, localStorage)) {
    history.replaceState(null, '', location.pathname + location.search)
  }
  if (__TRANSOM_DEMO__) await import('@/demo/install.ts')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WeaselIcons>
        <App />
      </WeaselIcons>
    </StrictMode>,
  )
}

void boot()
