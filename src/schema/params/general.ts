import type { PrefGroup } from '@weasel-js/prefs'

export const general: PrefGroup = {
  name: 'general',
  children: {
    parallax: {
      kind: 'boolean',
      name: 'parallax',
      description: '',
      default: true,
    },
  },
}
