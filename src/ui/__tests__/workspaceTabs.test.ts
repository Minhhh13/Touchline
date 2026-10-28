import { describe, expect, it } from 'vitest'
import { workspaceTabKey } from '../workspaceTabs'

describe('phone workspace navigation', () => {
  const ids = ['spin', 'players', 'pitch'] as const
  it('moves both ways and wraps at the ends', () => {
    expect(workspaceTabKey(ids, 'spin', 'ArrowRight')).toBe('players')
    expect(workspaceTabKey(ids, 'pitch', 'ArrowRight')).toBe('spin')
    expect(workspaceTabKey(ids, 'spin', 'ArrowLeft')).toBe('pitch')
    expect(workspaceTabKey(ids, 'pitch', 'ArrowLeft')).toBe('players')
  })
  it('supports the first and last tab without taking over ordinary keys', () => {
    expect(workspaceTabKey(ids, 'players', 'Home')).toBe('spin')
    expect(workspaceTabKey(ids, 'spin', 'End')).toBe('pitch')
    expect(workspaceTabKey(ids, 'players', 'Tab')).toBeNull()
    expect(workspaceTabKey([], 'spin', 'Home')).toBeNull()
  })
})
