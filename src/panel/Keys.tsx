import { KeyCap } from '@weasel-js/ui'
import './panel.css'

/**
 * The keys a row is worked with, drawn as caps.
 *
 * Sized down from the kit's own: its cap is built to sit in body text and
 * stands a head taller than a panel's type. Carries `.wzl-skin`, which is
 * where the kit's tokens are mapped onto the host's palette.
 */
export function Keys({ labels, title }: { labels: readonly string[]; title?: string }) {
  return (
    <span className="keys wzl-skin" title={title}>
      {labels.map((label) => (
        <KeyCap key={label} label={label} variant="default" />
      ))}
    </span>
  )
}
