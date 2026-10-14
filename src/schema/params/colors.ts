import type { PrefGroup } from '@weasel-js/prefs'

export const colors: PrefGroup = {
  name: 'colors',
  children: {
    cardEdge: {
      kind: 'color',
      name: 'card edge',
      description: '',
      default: '#22d3ee',
    },
    cardBlank: {
      kind: 'color',
      name: 'card blank',
      description: '',
      default: '#0b1020',
    },
    attentionLook: {
      kind: 'color',
      name: 'attention look',
      description: '',
      default: '#00ff00',
    },
    attentionSoon: {
      kind: 'color',
      name: 'attention soon',
      description: '',
      default: '#ffff00',
    },
    attentionUrgent: {
      kind: 'color',
      name: 'attention urgent',
      description: '',
      default: '#ff8000',
    },
    attentionProblem: {
      kind: 'color',
      name: 'attention problem',
      description: '',
      default: '#ff0000',
    },
    flagInk: {
      kind: 'color',
      name: 'flag ink',
      description: '',
      default: '#000000',
    },
    chipFill: {
      kind: 'color',
      name: 'chip fill',
      description: '',
      default: '#000000',
    },
    chipIcon: {
      kind: 'color',
      name: 'chip icon',
      description: '',
      default: '#ffe58f',
    },
    chipInk: {
      kind: 'color',
      name: 'chip ink',
      description: '',
      default: '#ffffff',
    },
    zoneIdle: {
      kind: 'color',
      name: 'zone idle',
      description: '',
      default: '#64748b',
    },
    zoneFocus: {
      kind: 'color',
      name: 'zone focus',
      description: '',
      default: '#38bdf8',
    },
    zoneBackdrop: {
      kind: 'color',
      name: 'zone backdrop',
      description: '',
      default: '#64748b',
    },
    label: {
      kind: 'color',
      name: 'label',
      description: '',
      default: '#e2e8f0',
    },
    skyBase: {
      kind: 'color',
      name: 'sky base',
      description: '',
      default: '#05060a',
    },
    skyGlow: {
      kind: 'color',
      name: 'sky glow',
      description: '',
      default: '#2b3f6b',
    },
    bg: {
      kind: 'color',
      name: 'bg',
      description: '',
      default: '#0a0a0c',
    },
    scrim: {
      kind: 'color',
      name: 'scrim',
      description: '',
      default: '#000000',
    },
    ink: {
      kind: 'color',
      name: 'ink',
      description: '',
      default: '#e2e8f0',
    },
    muted: {
      kind: 'color',
      name: 'muted',
      description: '',
      default: '#94a3b8',
    },
    accent: {
      kind: 'color',
      name: 'accent',
      description: '',
      default: '#38bdf8',
    },
    danger: {
      kind: 'color',
      name: 'danger',
      description: '',
      default: '#e0796b',
    },
  },
}
