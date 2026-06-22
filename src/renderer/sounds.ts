import chimeUrl from './assets/sounds/chime.wav';
import cashUrl from './assets/sounds/cash.wav';
import pingUrl from './assets/sounds/ping.wav';
import dropletUrl from './assets/sounds/droplet.wav';
import marimbaUrl from './assets/sounds/marimba.wav';

// Peon mode sounds (Warcraft 3 easter egg)
import peonReady1 from './assets/sounds/peon/PeonReady1.ogg';
import peonWhat1 from './assets/sounds/peon/PeonWhat1.ogg';
import peonWhat3 from './assets/sounds/peon/PeonWhat3.ogg';
import peonWhat4 from './assets/sounds/peon/PeonWhat4.ogg';
import peonYes1 from './assets/sounds/peon/PeonYes1.ogg';
import peonYes2 from './assets/sounds/peon/PeonYes2.ogg';
import peonYes3 from './assets/sounds/peon/PeonYes3.ogg';
import peonYes4 from './assets/sounds/peon/PeonYes4.ogg';

export const NOTIFICATION_SOUNDS = [
  'off',
  'chime',
  'cash',
  'ping',
  'droplet',
  'marimba',
  'peon',
] as const;
export type NotificationSound = (typeof NOTIFICATION_SOUNDS)[number];

export const SOUND_LABELS: Record<NotificationSound, string> = {
  off: 'Off',
  chime: 'Chime',
  cash: 'Cash Register',
  ping: 'Ping',
  droplet: 'Droplet',
  marimba: 'Marimba',
  peon: 'Peon',
};

const urls: Record<Exclude<NotificationSound, 'off' | 'peon'>, string> = {
  chime: chimeUrl,
  cash: cashUrl,
  ping: pingUrl,
  droplet: dropletUrl,
  marimba: marimbaUrl,
};

export type PeonEvent = 'ready' | 'what' | 'yes';

const PEON_SOUNDS: Record<PeonEvent, string[]> = {
  ready: [peonReady1],
  what: [peonWhat1, peonWhat3, peonWhat4],
  yes: [peonYes1, peonYes2, peonYes3, peonYes4],
};

const cache = new Map<string, HTMLAudioElement>();

function playUrl(url: string): void {
  let audio = cache.get(url);
  if (!audio) {
    audio = new Audio(url);
    cache.set(url, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playPeonSound(event: PeonEvent): void {
  const sounds = PEON_SOUNDS[event];
  const url = sounds[Math.floor(Math.random() * sounds.length)]!;
  playUrl(url);
}

export function playNotificationSound(sound: NotificationSound): void {
  if (sound === 'off') return;
  if (sound === 'peon') {
    playPeonSound('ready');
    return;
  }
  playUrl(urls[sound]);
}
