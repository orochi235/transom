import type { PrefGroup } from '@weasel-js/prefs'

export const distance: PrefGroup = {
  name: 'distance',
  children: {
    enabled: {
      kind: 'boolean',
      name: 'enabled',
      description: '',
      default: true,
    },
    from: {
      kind: 'number',
      name: 'from',
      description: '',
      default: 1,
      min: 0,
      max: 200,
      step: 1,
      control: 'slider',
    },
    to: {
      kind: 'number',
      name: 'to',
      description: '',
      default: 22,
      min: 0,
      max: 200,
      step: 1,
      control: 'slider',
    },
    floor: {
      kind: 'number',
      name: 'floor',
      description: '',
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
    combine: {
      kind: 'enum',
      name: 'combine',
      description: '',
      default: 'ceiling',
      options: [
        { value: 'ceiling', label: 'ceiling' },
        { value: 'min', label: 'min' },
      ],
    },
  },
}
