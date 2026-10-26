import { armAudio } from './synth'

/*
 * Arms the sound once for the whole app (App.tsx imports this for its side
 * effect): the first gesture anywhere unlocks the audio, so the match's
 * kick-off whistle and a primary button's click can sound, not only the reel.
 * Nothing plays before that gesture, with sound off, or without Web Audio.
 */
armAudio()
