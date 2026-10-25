/**
 * Fuochi d'artificio su un canvas, per la finestra di festeggiamento degli obiettivi.
 * Nessuna dipendenza da Obsidian. Pensati per essere leggeri: partono solo quando la finestra
 * si apre, smettono di lanciare razzi dopo qualche secondo, il ciclo si ferma da solo quando
 * non resta più nulla da disegnare e si ferma subito alla chiusura (`stop`).
 */

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	hue: number;
	size: number;
}

interface Rocket {
	x: number;
	y: number;
	vy: number;
	targetY: number;
	hue: number;
}

const GRAVITY = 140; // pixel al secondo quadrato
const MAX_PARTICLES = 420;
/** Per quanto tempo continuano a partire nuovi razzi. */
const LAUNCH_MS = 9000;

export class Fireworks {
	private ctx: CanvasRenderingContext2D | null;
	private particles: Particle[] = [];
	private rockets: Rocket[] = [];
	private raf = 0;
	private last = 0;
	private elapsed = 0;
	private nextLaunch = 0;
	private running = false;
	private width = 0;
	private height = 0;

	constructor(private canvas: HTMLCanvasElement) {
		this.ctx = canvas.getContext("2d");
	}

	start() {
		if (this.running || !this.ctx) return;
		// Chi preferisce meno movimento vede un solo scoppio, senza animazione continua.
		const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.width = this.canvas.clientWidth;
		this.height = this.canvas.clientHeight;
		this.canvas.width = Math.max(1, Math.round(this.width * dpr));
		this.canvas.height = Math.max(1, Math.round(this.height * dpr));
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.running = true;
		if (reduced) {
			this.burst(this.width / 2, this.height * 0.35, 200);
			this.draw(1 / 60, true);
			this.running = false;
			return;
		}
		this.last = performance.now();
		this.raf = requestAnimationFrame((t) => this.frame(t));
	}

	stop() {
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.particles = [];
		this.rockets = [];
	}

	private frame(now: number) {
		if (!this.running) return;
		const dt = Math.min(0.05, (now - this.last) / 1000);
		this.last = now;
		this.elapsed += dt * 1000;
		const launching = this.elapsed < LAUNCH_MS;
		if (launching && this.elapsed >= this.nextLaunch) {
			this.launch();
			this.nextLaunch = this.elapsed + 350 + Math.random() * 450;
		}
		this.draw(dt, false);
		// Finito di lanciare e di disegnare: il ciclo si ferma da solo.
		if (!launching && this.rockets.length === 0 && this.particles.length === 0) {
			this.running = false;
			this.ctx?.clearRect(0, 0, this.width, this.height);
			return;
		}
		this.raf = requestAnimationFrame((t) => this.frame(t));
	}

	private launch() {
		this.rockets.push({
			x: this.width * (0.15 + Math.random() * 0.7),
			y: this.height,
			vy: -(this.height * (0.9 + Math.random() * 0.3)),
			targetY: this.height * (0.12 + Math.random() * 0.35),
			hue: Math.floor(Math.random() * 360),
		});
	}

	private burst(x: number, y: number, count: number, hue = Math.floor(Math.random() * 360)) {
		const room = MAX_PARTICLES - this.particles.length;
		const n = Math.min(count, Math.max(0, room));
		for (let i = 0; i < n; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 40 + Math.random() * 150;
			this.particles.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 0,
				maxLife: 0.9 + Math.random() * 0.9,
				hue: (hue + Math.random() * 40 - 20 + 360) % 360,
				size: 1.5 + Math.random() * 1.5,
			});
		}
	}

	private draw(dt: number, still: boolean) {
		const ctx = this.ctx;
		if (!ctx) return;
		// Dissolvenza leggera al posto della pulizia completa: lascia la scia dietro le scintille.
		ctx.globalCompositeOperation = "destination-out";
		ctx.fillStyle = still ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.22)";
		ctx.fillRect(0, 0, this.width, this.height);
		ctx.globalCompositeOperation = "source-over";

		for (let i = this.rockets.length - 1; i >= 0; i--) {
			const r = this.rockets[i];
			r.y += r.vy * dt;
			if (r.y <= r.targetY) {
				this.burst(r.x, r.y, 55 + Math.floor(Math.random() * 25), r.hue);
				this.rockets.splice(i, 1);
				continue;
			}
			ctx.fillStyle = `hsl(${r.hue} 100% 75%)`;
			ctx.fillRect(r.x - 1, r.y, 2, 6);
		}

		for (let i = this.particles.length - 1; i >= 0; i--) {
			const p = this.particles[i];
			p.life += dt;
			if (p.life >= p.maxLife) {
				this.particles.splice(i, 1);
				continue;
			}
			p.vy += GRAVITY * dt;
			p.vx *= 0.992;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			ctx.globalAlpha = 1 - p.life / p.maxLife;
			ctx.fillStyle = `hsl(${p.hue} 100% 62%)`;
			ctx.fillRect(p.x, p.y, p.size, p.size);
		}
		ctx.globalAlpha = 1;
	}
}
