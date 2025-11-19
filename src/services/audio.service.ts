
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AudioService {
  private audioCtx: AudioContext | null = null;

  private initAudio(): void {
    if (this.audioCtx || typeof window === 'undefined') return;

    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      this.audioCtx = new AudioContext();
    }
  }

  playSuccessSound(): void {
    this.initAudio();
    if (!this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const t = this.audioCtx.currentTime;
    const gainNode = this.audioCtx.createGain();
    gainNode.connect(this.audioCtx.destination);
    gainNode.gain.setValueAtTime(0, t);
    // A short, punchy envelope, max volume 0.15, total duration ~0.5s
    gainNode.gain.linearRampToValueAtTime(0.15, t + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

    // First tone (the "chime") - B5
    const osc1 = this.audioCtx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(987.77, t);
    osc1.connect(gainNode);
    osc1.start(t);
    osc1.stop(t + 0.5);

    // Second tone (the harmonic) - E6
    const osc2 = this.audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, t);
    osc2.connect(gainNode);
    osc2.start(t);
    osc2.stop(t + 0.5);
  }
}