import * as THREE from 'three'
import { ago } from '@/age.ts'
import { ASK_GLYPH } from '@/asks.ts'
import type { StackParams } from '@/params.ts'
import { PIN_GLYPH, PLAYS_GLYPH, type asksTextOf } from '@/backends/webgl/cardText.ts'
import { BADGE_LIFT } from '@/backends/webgl/constants.ts'
import type { Chrome } from '@/backends/webgl/useChrome.ts'

export function placeCornerChips(
  f: {
    params: StackParams
    chips: Chrome['chips']
    pins: Chrome['pins']
    plays: Chrome['plays']
    asks: Chrome['asks']
    chipHeight: number
    badgeFamily: string
    fontsReady: boolean
    now: number
    bornAt: Map<string, number>
    pinned: Set<string>
    playsText: Map<string, string>
    asksText: ReturnType<typeof asksTextOf>
    fronts: Set<string>
  },
  card: { id: string; mesh: THREE.Mesh; drawnW: number; drawnH: number; swell: number; cut: number },
): void {
  const { params, chips, pins, plays, asks, chipHeight, badgeFamily, fontsReady } = f
  const { now, bornAt, pinned, playsText, asksText, fronts } = f
  const { id, mesh, drawnW, drawnH, swell, cut } = card
  const chip = chips.byId.get(id)
  const wearsChip = params.chips.cards && fronts.has(id)
  if (chip || wearsChip) {
    const text = ago(now - (bornAt.get(id) ?? now))
    const look = {
      fill: params.colors.chipFill,
      ink: params.colors.chipInk,
      icon: params.colors.chipIcon,
      family: badgeFamily,
    }
    const held = chips.sync(
      id,
      `${text}|${look.fill}|${look.icon}|${look.ink}|${badgeFamily}|${fontsReady}`,
      text,
      look,
    )
    held.plate.visible = wearsChip
    if (wearsChip) {
      const h = chipHeight
      const w = h * held.aspect
      const inset = params.chips.inset
      held.plate.scale.set(w, h, 1)
      held.plate.rotation.copy(mesh.rotation)
      // Inside the artifact's top-left corner. Measured in the card's own
      // frame and then turned with it, so it holds that corner from every
      // angle rather than sliding off it as the wall turns.
      held.plate.position
        .copy(mesh.position)
        .add(
          new THREE.Vector3(
            -(drawnW * swell) / 2 + w / 2 + inset,
            (drawnH * swell) / 2 - h / 2 - inset,
            BADGE_LIFT,
          ).applyEuler(mesh.rotation),
        )
      const material = held.plate.material as THREE.MeshBasicMaterial
      material.opacity = cut
    }
  }

  // A pin says the wall will not take this one. Its own corner, opposite the
  // age chip, because a pinned front card wears both at once.
  const pin = pins.byId.get(id)
  // Not gated on `chips.cards`: that switch is about the age chip, and a
  // pin is state rather than decoration. Gated on the front all the same:
  // a chip draws over the wall, so one on a buried card shows through the
  // front card and reads as the front card's.
  const wearsPin = pinned.has(id) && fronts.has(id)
  if (pin || wearsPin) {
    const held = pins.sync(
      id,
      `pin|${params.colors.chipFill}|${params.colors.chipInk}|${badgeFamily}|${fontsReady}`,
      PIN_GLYPH,
      {
        fill: params.colors.chipFill,
        ink: params.colors.chipInk,
        family: badgeFamily,
      },
    )
    held.plate.visible = wearsPin
    if (wearsPin) {
      const h = chipHeight
      const w = h * held.aspect
      const inset = params.chips.inset
      held.plate.scale.set(w, h, 1)
      held.plate.rotation.copy(mesh.rotation)
      held.plate.position
        .copy(mesh.position)
        .add(
          new THREE.Vector3(
            (drawnW * swell) / 2 - w / 2 - inset,
            (drawnH * swell) / 2 - h / 2 - inset,
            BADGE_LIFT,
          ).applyEuler(mesh.rotation),
        )
      const material = held.plate.material as THREE.MeshBasicMaterial
      material.opacity = cut
    }
  }

  // The bottom-left corner, clear of both the age chip and the pin: a card
  // with more in it than the wall draws can be the front of its pile and
  // rescued at once.
  const play = plays.byId.get(id)
  const playText = playsText.get(id)
  const wearsPlay = playText !== undefined && fronts.has(id)
  if (play || wearsPlay) {
    const text = playText ?? PLAYS_GLYPH
    const held = plays.sync(
      id,
      `${text}|${params.colors.chipFill}|${params.colors.chipInk}|${badgeFamily}|${fontsReady}`,
      text,
      {
        fill: params.colors.chipFill,
        ink: params.colors.chipInk,
        family: badgeFamily,
      },
    )
    held.plate.visible = wearsPlay
    if (wearsPlay) {
      const h = chipHeight
      const w = h * held.aspect
      const inset = params.chips.inset
      held.plate.scale.set(w, h, 1)
      held.plate.rotation.copy(mesh.rotation)
      held.plate.position
        .copy(mesh.position)
        .add(
          new THREE.Vector3(
            -(drawnW * swell) / 2 + w / 2 + inset,
            -(drawnH * swell) / 2 + h / 2 + inset,
            BADGE_LIFT,
          ).applyEuler(mesh.rotation),
        )
      const material = held.plate.material as THREE.MeshBasicMaterial
      material.opacity = cut
    }
  }

  // The bottom-right corner, the last one free. A card can be pinned, hold
  // more than the wall draws, wear its age and still be waiting on a reply.
  const ask = asks.byId.get(id)
  const asksHere = asksText.get(id)
  const wearsAsk = asksHere !== undefined && fronts.has(id)
  if (ask || wearsAsk) {
    // Waiting reads as signage, in the flag's own color: the plate that
    // said so may have lapsed hours ago. Answered reads as a record, in the
    // ordinary chip colors, because nobody has to act on it.
    const look = asksHere?.open
      ? { fill: params.colors.attentionLook, ink: params.colors.flagInk, family: badgeFamily }
      : { fill: params.colors.chipFill, ink: params.colors.chipInk, family: badgeFamily }
    const text = asksHere?.text ?? ASK_GLYPH
    const held = asks.sync(
      id,
      `${text}|${look.fill}|${look.ink}|${badgeFamily}|${fontsReady}`,
      text,
      look,
    )
    held.plate.visible = wearsAsk
    if (wearsAsk) {
      const h = chipHeight
      const w = h * held.aspect
      const inset = params.chips.inset
      held.plate.scale.set(w, h, 1)
      held.plate.rotation.copy(mesh.rotation)
      held.plate.position
        .copy(mesh.position)
        .add(
          new THREE.Vector3(
            (drawnW * swell) / 2 - w / 2 - inset,
            -(drawnH * swell) / 2 + h / 2 + inset,
            BADGE_LIFT,
          ).applyEuler(mesh.rotation),
        )
      const material = held.plate.material as THREE.MeshBasicMaterial
      material.opacity = cut
    }
  }
}
