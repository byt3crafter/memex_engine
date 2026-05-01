import { createId } from '@paralleldrive/cuid2';

const PREFIXES = {
  user: 'usr',
  pantry: 'pty',
  foodEvent: 'fev',
  foodEventItem: 'fei',
  recommendation: 'rec',
  outcome: 'out',
  recipe: 'rcp',
  menu: 'mnu',
  measurement: 'msr',
  exercise: 'exr',
} as const;

export type IdKind = keyof typeof PREFIXES;

export function newId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${createId()}`;
}
