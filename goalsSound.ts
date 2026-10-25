import { GOAL_SOUND_MP3_BASE64 } from "./goalsSoundData";

/** Riproduce il suono incluso nel plugin per "Obiettivo raggiunto". Si usa solo se per quell'evento
 * non è stato scelto un suono proprio nelle impostazioni. */
export function playGoalSound(volume = 0.6) {
	try {
		const audio = new Audio(`data:audio/mpeg;base64,${GOAL_SOUND_MP3_BASE64}`);
		audio.volume = volume;
		// Alcuni ambienti bloccano la riproduzione automatica: non è un problema.
		audio.play().catch(() => undefined);
	} catch {
		// Nessun audio disponibile: si continua senza suono.
	}
}
