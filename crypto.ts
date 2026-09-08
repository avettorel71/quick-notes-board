/**
 * Cifratura del contenuto delle note quick, tramite la Web Crypto API nativa
 * (funziona identica su desktop e mobile, nessuna dipendenza da Electron/Node).
 *
 * Algoritmo: AES-256-GCM (cifratura autenticata: una password sbagliata o dati
 * manomessi fanno fallire esplicitamente la decifratura, invece di restituire
 * testo corrotto senza avviso).
 *
 * Derivazione chiave: PBKDF2-SHA256, salt casuale per ogni nota, 250.000 iterazioni.
 *
 * La password NON viene mai salvata da nessuna parte: se viene dimenticata,
 * il contenuto cifrato non è recuperabile.
 */

const ENC_PREFIX = "QNBENC1:";
const PBKDF2_ITERATIONS = 250000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class DecryptionError extends Error {}

/** True se la stringa data è un blob prodotto da encryptText (quindi va decifrato, non renderizzato). */
export function isEncryptedPayload(payload: string): boolean {
	return payload.startsWith(ENC_PREFIX);
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(password),
		"PBKDF2",
		false,
		["deriveKey"]
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Cifra il testo in chiaro con la password data. Ritorna un unico blob di testo,
 * autosufficiente (contiene salt e IV), pronto per essere salvato al posto del contenuto. */
export async function encryptText(plainText: string, password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const key = await deriveKey(password, salt);
	const enc = new TextEncoder();
	const cipherBuf = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv as BufferSource },
		key,
		enc.encode(plainText)
	);
	return `${ENC_PREFIX}${toBase64(salt)}:${toBase64(iv)}:${toBase64(cipherBuf)}`;
}

/** Decifra un blob prodotto da encryptText. Lancia DecryptionError se la password
 * è sbagliata, i dati sono corrotti, o il formato non è riconosciuto. */
export async function decryptText(payload: string, password: string): Promise<string> {
	if (!isEncryptedPayload(payload)) {
		throw new DecryptionError("Formato non riconosciuto");
	}
	const parts = payload.slice(ENC_PREFIX.length).split(":");
	if (parts.length !== 3) {
		throw new DecryptionError("Formato non riconosciuto");
	}
	const [saltB64, ivB64, dataB64] = parts;

	let salt: Uint8Array, iv: Uint8Array, data: Uint8Array;
	try {
		salt = fromBase64(saltB64);
		iv = fromBase64(ivB64);
		data = fromBase64(dataB64);
	} catch (e) {
		throw new DecryptionError("Dati corrotti");
	}

	const key = await deriveKey(password, salt);
	try {
		const plainBuf = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: iv as BufferSource },
			key,
			data as BufferSource
		);
		return new TextDecoder().decode(plainBuf);
	} catch (e) {
		// AES-GCM fa fallire la decifratura se la password (quindi la chiave) è
		// sbagliata, o se i dati sono stati alterati: non possiamo distinguere i due
		// casi, ma in entrambi è corretto non restituire nulla.
		throw new DecryptionError("Password errata o dati corrotti");
	}
}
