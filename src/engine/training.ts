/**
 * Weekly training focus. One decision a week with a visible, bounded effect.
 */
export type TrainingFocus = 'balanced' | 'attacking' | 'defensive' | 'set-pieces' | 'fitness' | 'recovery' | 'tactical'

export interface TrainingEffect {
  /** Multiplier on next match attack xG. */
  attack: number
  /** Multiplier on opposition xG next match. */
  defence: number
  /** Extra condition recovered this week. */
  recovery: number
  /** Sharpness change for everyone this week. */
  sharpness: number
  /** Familiarity change for everyone this week. */
  familiarity: number
  /** Multiplier on injury risk in training (1 = normal). */
  injuryRisk: number
  blurb: string
}

export const TRAINING: Record<TrainingFocus, TrainingEffect> = {
  balanced: { attack: 1, defence: 1, recovery: 0, sharpness: 2, familiarity: 1, injuryRisk: 1, blurb: 'A normal week. Nothing gained, nothing lost.' },
  attacking: { attack: 1.04, defence: 1.01, recovery: -2, sharpness: 3, familiarity: 1, injuryRisk: 1, blurb: 'Pattern play and finishing. Sharper in front of goal next match.' },
  defensive: { attack: 0.99, defence: 0.96, recovery: -2, sharpness: 2, familiarity: 1, injuryRisk: 1, blurb: 'Shape and pressing triggers. Harder to break down next match.' },
  'set-pieces': { attack: 1.03, defence: 0.98, recovery: 0, sharpness: 1, familiarity: 0, injuryRisk: 0.9, blurb: 'Corners and free kicks at both ends.' },
  fitness: { attack: 1, defence: 1, recovery: -4, sharpness: 4, familiarity: 0, injuryRisk: 1.35, blurb: 'Hard running. Builds sharpness, costs legs and raises injury risk this week.' },
  recovery: { attack: 0.99, defence: 1, recovery: 9, sharpness: -3, familiarity: 0, injuryRisk: 0.6, blurb: 'Pool, massage, early finish. Everyone comes back fresher.' },
  tactical: { attack: 1.01, defence: 0.99, recovery: 0, sharpness: 0, familiarity: 5, injuryRisk: 0.8, blurb: 'Walk-throughs and video. The system beds in faster.' },
}

export const TRAINING_LABEL: Record<TrainingFocus, string> = {
  balanced: 'Balanced',
  attacking: 'Attacking',
  defensive: 'Defensive',
  'set-pieces': 'Set pieces',
  fitness: 'Fitness',
  recovery: 'Recovery',
  tactical: 'Tactical',
}
