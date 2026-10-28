/**
 * Every English catalogue, for the tests and the translation type only: a screen imports its own catalogue
 * (`./home`), never this file, or every screen's English would ride in the first download.
 */
import { app } from './app'
import { boxes } from './boxes'
import { common } from './common'
import { screenText } from './screenText'
import { home } from './home'
import { profile } from './profile'
import { setup } from './setup'
import { draft } from './draft'
import { summary } from './summary'
import { howto } from './howto'
import { privacy } from './privacy'
import { explore } from './explore'
import { season } from './season'
import { h2h } from './h2h'
import { arena } from './arena'
import { runin } from './runin'
import { dugout } from './dugout'
import { match } from './match'
import { online } from './online'
import { saving } from './saving'
import { shell } from './shell'
import { trophies } from './trophies'
import { playerCard } from './playerCard'

export const CATALOGS = { app, boxes, common, screenText, home, profile, setup, draft, summary, howto, privacy, explore, season, h2h, arena, runin, dugout, match, online, saving, shell, trophies, playerCard } as const
