import type { CSSProperties } from 'react'
import type { WallItem } from '@shared/protocol.ts'
import '@/lightbox.css'
import '@/lightbox/markup.css'
import { Ask } from '@/lightbox/Ask.tsx'
import { Outs } from '@/lightbox/Outs.tsx'
import { ImageLightbox } from '@/lightbox/ImageLightbox.tsx'
import { PageLightbox } from '@/lightbox/PageLightbox.tsx'
import { VideoLightbox } from '@/lightbox/VideoLightbox.tsx'
import { MeshLightbox } from '@/lightbox/MeshLightbox.tsx'
import { GroupLightbox } from '@/lightbox/GroupLightbox.tsx'

/**
 * A DOM overlay either way, not a GL quad: full resolution costs the texture
 * budget nothing here, and right-click-save, copy and drag-to-Finder keep
 * working for a picture.
 *
 * One component per kind rather than one with a branch, so that paging a pile
 * across kinds unmounts one and mounts the other — which is also what stops an
 * iframe, or a playing video, surviving a move to the next artifact.
 */
export function Lightbox(props: {
  item: WallItem
  /** The zone's lifted project color. Absent for a zone with no `.hued`, which
   *  keeps the wall's own accent. */
  tint?: string
  now: number
  quietMs: number
  /** Playing its way out, after a reply. The caller unmounts it once done. */
  closing: boolean
  onClose: () => void
  onAnswer: (id: string, answer: { choice?: string; text: string; take?: string }) => void
  onDismiss: (id: string, take?: string) => void
}) {
  const { quietMs, onAnswer, onDismiss, closing, tint, ...rest } = props
  return (
    // One property for the lot: the frame, the keyline and the glow all read
    // it, and each falls back to the wall's accent where a zone has no color.
    <div
      className="lightbox__tint"
      style={tint ? ({ '--lb-accent': tint } as CSSProperties) : undefined}
    >
      {rest.item.kind === 'group' ? (
        // Keyed on the card, so opening another group starts on its own poster
        // rather than wherever the last one was left.
        <GroupLightbox
          key={rest.item.id}
          {...rest}
          closing={closing}
          quietMs={quietMs}
          onAnswer={(answer) => onAnswer(rest.item.id, answer)}
          onDismiss={(take) => onDismiss(rest.item.id, take)}
        />
      ) : (
        <>
          {rest.item.kind === 'page' ? (
            <PageLightbox {...rest} closing={closing} />
          ) : rest.item.kind === 'mesh' ? (
            // Keyed like the video, so paging from one model to the next builds
            // a new scene rather than leaving the first one's geometry in it.
            <MeshLightbox key={rest.item.id} {...rest} closing={closing} />
          ) : rest.item.kind === 'video' ? (
            // Keyed, so paging from one video to the next remounts rather than
            // reusing: the mute is mount state, and without this the second
            // video inherits the first one's unmute and the wall makes a noise
            // nobody asked it for.
            <VideoLightbox key={rest.item.id} {...rest} closing={closing} />
          ) : (
            <ImageLightbox {...rest} closing={closing} quietMs={quietMs} />
          )}
          <Ask
            asked={rest.item}
            closing={closing}
            onAnswer={(answer) => onAnswer(rest.item.id, answer)}
            onDismiss={() => onDismiss(rest.item.id)}
          />
          <Outs id={rest.item.id} apps={rest.item.apps} links={rest.item.links} />
        </>
      )}
    </div>
  )
}
