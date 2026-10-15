import { usePersistedFlag } from '@/usePersistedFlag.ts'

export function Section({
  name,
  storageKey,
  children,
}: {
  name: string
  storageKey: string
  children: React.ReactNode
}) {
  const [open, setOpen] = usePersistedFlag(storageKey, true)
  return (
    <details className="sidebar__section" open={open}>
      <summary
        className="sidebar__sectionName"
        onClick={(e) => {
          e.preventDefault()
          setOpen((was) => !was)
        }}
      >
        {name}
      </summary>
      <div className="sidebar__sectionBody">{children}</div>
    </details>
  )
}
