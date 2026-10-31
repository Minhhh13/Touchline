/** Where a phone's sheet is pulled from (src/ui/useSheetDrag.ts): the grip and the header, never their own controls */
import { describe, expect, it } from 'vitest'
import { DRAWER_SHEET_HANDLE, MODAL_SHEET_HANDLE, SHEET_HANDLE_CONTROLS } from '../useSheetDrag'

describe('the sheet handles', () => {
  it("are each sheet's grip and header", () => {
    expect(MODAL_SHEET_HANDLE.split(', ')).toEqual(['.sheet-grip', '.modal > .panel-head'])
    expect(DRAWER_SHEET_HANDLE.split(', ')).toEqual(['.sheet-grip', '.md-drawer-head'])
  })
  it("leave a press on the header's own controls to them", () => {
    for (const c of ['button', 'a', 'input', 'select', 'textarea', '[role=tab]']) expect(SHEET_HANDLE_CONTROLS.split(', ')).toContain(c)
  })
})
