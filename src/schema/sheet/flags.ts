import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const flags: PrefGroup = {
  name: 'flags',
  children: {
    attention: {
      name: 'attention',
      children: {
        pulse: to('attention.pulse'),
        badgeSize: to('attention.badgeSize'),
        hoverScale: to('attention.hoverScale'),
        hoverEdge: to('attention.hoverEdge'),
        float: to('attention.float'),
        billboard: to('attention.billboard'),
        leaderElbow: to('attention.leaderElbow'),
        floatLift: to('attention.floatLift'),
        floatGap: to('attention.floatGap'),
        leaderWidth: to('attention.leaderWidth'),
        seek: to('attention.seek'),
        seekMs: to('attention.seekMs'),
        seekReach: to('attention.seekReach'),
        seekCover: to('attention.seekCover'),
        seekPull: to('attention.seekPull'),
        seekLineCost: to('attention.seekLineCost'),
        seekForeign: to('attention.seekForeign'),
        seekMismatch: to('attention.seekMismatch'),
        seekParallel: to('attention.seekParallel'),
        seekAlign: to('attention.seekAlign'),
        seekStack: to('attention.seekStack'),
        seekExposed: to('attention.seekExposed'),
        seekSettle: to('attention.seekSettle'),
        seekStiffness: to('attention.seekStiffness'),
        seekDamping: to('attention.seekDamping'),
        levels: {
          name: 'levels',
          children: {
            look: {
              name: 'look',
              children: {
                lift: to('attention.levels.look.lift'),
                haloWidth: to('attention.levels.look.haloWidth'),
                pulseAmp: to('attention.levels.look.pulseAmp'),
                pulseHz: to('attention.levels.look.pulseHz'),
              },
            },
            soon: {
              name: 'soon',
              children: {
                lift: to('attention.levels.soon.lift'),
                haloWidth: to('attention.levels.soon.haloWidth'),
                pulseAmp: to('attention.levels.soon.pulseAmp'),
                pulseHz: to('attention.levels.soon.pulseHz'),
              },
            },
            urgent: {
              name: 'urgent',
              children: {
                lift: to('attention.levels.urgent.lift'),
                haloWidth: to('attention.levels.urgent.haloWidth'),
                pulseAmp: to('attention.levels.urgent.pulseAmp'),
                pulseHz: to('attention.levels.urgent.pulseHz'),
              },
            },
            problem: {
              name: 'problem',
              children: {
                lift: to('attention.levels.problem.lift'),
                haloWidth: to('attention.levels.problem.haloWidth'),
                pulseAmp: to('attention.levels.problem.pulseAmp'),
                pulseHz: to('attention.levels.problem.pulseHz'),
              },
            },
          },
        },
      },
    },
    typeface: {
      name: 'typeface',
      children: {
        badge: to('typeface.badge'),
      },
    },
    colors: {
      name: 'colors',
      children: {
        attentionLook: to('colors.attentionLook'),
        attentionSoon: to('colors.attentionSoon'),
        attentionUrgent: to('colors.attentionUrgent'),
        attentionProblem: to('colors.attentionProblem'),
        flagInk: to('colors.flagInk'),
      },
    },
  },
}
