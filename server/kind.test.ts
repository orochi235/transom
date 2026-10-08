import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HELD_EXT, kindOf } from './kind.ts'

describe('kindOf', () => {
  it('reads the extensions the wall already holds as pictures', () => {
    expect(kindOf('/transom/inbox/z/a.png')).toBe('image')
    expect(kindOf('/transom/inbox/z/a.JPG')).toBe('image')
    expect(kindOf('/transom/inbox/z/a.webp')).toBe('image')
    expect(kindOf('/transom/inbox/z/a.SVG')).toBe('image')
  })

  it('reads a self-contained page', () => {
    expect(kindOf('/transom/inbox/z/a.html')).toBe('page')
    expect(kindOf('/transom/inbox/z/a.HTM')).toBe('page')
  })

  it('is null for anything the wall cannot hold', () => {
    // The sidecar lands in the same directory and must never be ingested.
    expect(kindOf('/transom/inbox/z/a.png.transom.json')).toBe(null)
    expect(kindOf('/transom/inbox/z/a.pdf')).toBe(null)
    expect(kindOf('/transom/inbox/z/a')).toBe(null)
    // ffmpeg reads it; Chrome does not play it, so the lightbox could not.
    expect(kindOf('/transom/inbox/z/clip.mkv')).toBe(null)
    expect(kindOf('/transom/inbox/z/clip.avi')).toBe(null)
  })

  it('reads a video', () => {
    expect(kindOf('/transom/inbox/z/clip.mp4')).toBe('video')
    expect(kindOf('/transom/inbox/z/clip.MOV')).toBe('video')
    expect(kindOf('/transom/inbox/z/clip.webm')).toBe('video')
    expect(kindOf('/transom/inbox/z/clip.m4v')).toBe('video')
  })

  it('reads a mesh', () => {
    expect(kindOf('/transom/inbox/z/head.glb')).toBe('mesh')
    expect(kindOf('/transom/inbox/z/head.GLB')).toBe('mesh')
    expect(kindOf('/transom/inbox/z/part.stl')).toBe('mesh')
  })

  it('is null for a .gltf, which arrives without the files it points at', () => {
    expect(kindOf('/transom/inbox/z/head.gltf')).toBe(null)
  })

  it('holds every extension it advertises', () => {
    for (const ext of HELD_EXT) expect(kindOf(`/transom/inbox/z/a${ext}`)).not.toBe(null)
  })
})

/** `bin/transom` refuses what the wall cannot hold, which only helps while its
 *  list and this one agree. A file that passes the send and is then dropped at
 *  ingest is the silently invisible artifact, one step further along. */
describe('bin/transom agrees about what the wall holds', () => {
  it('lists exactly the extensions kindOf accepts', () => {
    const script = readFileSync(
      fileURLToPath(new URL('../bin/transom', import.meta.url)),
      'utf8',
    )
    const line = script.match(/^held_ext="([^"]*)"$/m)
    expect(line, 'held_ext not found in bin/transom').not.toBe(null)
    const fromScript = line![1]!.split(/\s+/).filter(Boolean).sort()
    expect(fromScript).toEqual([...HELD_EXT].map((e) => e.slice(1)).sort())
  })
})

/** The second list in `bin/transom`: the containers whose poster needs ffmpeg.
 *  It must be a subset of what the wall holds, or the send refuses a file over
 *  a decoder the daemon was never going to reach for. */
describe('bin/transom knows which held extensions need ffmpeg', () => {
  it('names a subset of what the wall holds', () => {
    const script = readFileSync(
      fileURLToPath(new URL('../bin/transom', import.meta.url)),
      'utf8',
    )
    const line = script.match(/^video_ext="([^"]*)"$/m)
    expect(line, 'video_ext not found in bin/transom').not.toBe(null)
    const video = line![1]!.split(/\s+/).filter(Boolean)
    expect(video.length).toBeGreaterThan(0)
    for (const ext of video) expect(kindOf(`/transom/inbox/z/a.${ext}`)).toBe('video')
  })

  it('names every video extension, so none is sent to a machine that cannot poster it', () => {
    const script = readFileSync(
      fileURLToPath(new URL('../bin/transom', import.meta.url)),
      'utf8',
    )
    const video = script.match(/^video_ext="([^"]*)"$/m)![1]!.split(/\s+/).filter(Boolean).sort()
    const held = HELD_EXT.filter((e) => kindOf(`/a${e}`) === 'video')
      .map((e) => e.slice(1))
      .sort()
    expect(video).toEqual(held)
  })
})
