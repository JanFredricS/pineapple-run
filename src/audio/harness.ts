/**
 * S7 manual listening harness (audio-harness.html). Drives the GameAudio
 * facade exactly as S6 will; no game modules involved.
 */

import { GameAudio, MUSIC_THEMES, stageForProgress, type MusicStage } from './index';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

let audio = new GameAudio();
audio.init(document.body);

const status = el('status');
const themes = el('themes');
const stages = el('stages');

for (const theme of MUSIC_THEMES) {
  const b = document.createElement('button');
  b.textContent = theme;
  b.dataset.theme = theme;
  b.addEventListener('click', () => audio.music.play(theme));
  themes.append(b);
}
const stop = document.createElement('button');
stop.textContent = 'Stop';
stop.addEventListener('click', () => audio.music.stop());
themes.append(stop);

for (const stage of [0, 1, 2, 3] as const) {
  const b = document.createElement('button');
  b.textContent = `Stage ${stage}`;
  b.dataset.stage = String(stage);
  b.addEventListener('click', () => audio.music.setStage(stage));
  stages.append(b);
}

const progress = el<HTMLInputElement>('progress');
progress.addEventListener('input', () => {
  const p = Number(progress.value);
  audio.setCourseProgress(p);
  el('progressOut').textContent = `${p.toFixed(2)} → stage ${stageForProgress(p)}`;
});

const bounceSpeed = el<HTMLInputElement>('bounceSpeed');
bounceSpeed.addEventListener('input', () => (el('bounceOut').textContent = Number(bounceSpeed.value).toFixed(1)));
el('clatter').addEventListener('click', () => audio.sfx.strawClatter(1));
el('bounce').addEventListener('click', () => audio.sfx.pineappleBounce(Number(bounceSpeed.value)));
el('storm').addEventListener('click', () => {
  let n = 0;
  for (let i = 0; i < 100; i++) if (audio.sfx.pineappleBounce(3 + (i % 5))) n++;
  el('storm').textContent = `Bounce storm ×100 (played ${n})`;
});
el('boing').addEventListener('click', () => audio.sfx.springBoing(1));
el('click').addEventListener('click', () => audio.sfx.uiClick());
el('goal').addEventListener('click', () => audio.sfx.goalSting());
el('lose').addEventListener('click', () => audio.sfx.loseSting());

const motorSpeed = el<HTMLInputElement>('motorSpeed');
el('motor').addEventListener('click', () => {
  if (audio.sfx.wheelMotor.running) audio.sfx.wheelMotor.stop();
  else audio.sfx.wheelMotor.start(Number(motorSpeed.value));
});
motorSpeed.addEventListener('input', () => audio.sfx.wheelMotor.set(Number(motorSpeed.value)));
el('blender').addEventListener('click', () => {
  if (audio.sfx.blenderWhir.running) audio.sfx.blenderWhir.stop();
  else audio.sfx.blenderWhir.start(0.7);
});

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-event]')) {
  b.addEventListener('click', () => {
    switch (b.dataset.event) {
      case 'started':
        audio.onRunEvent({ type: 'started', simTime: 0 });
        break;
      case 'released':
        audio.onRunEvent({ type: 'released', simTime: 0 });
        break;
      case 'goalReached':
        audio.onRunEvent({ type: 'goalReached', simTime: 20, delivered: 12 });
        break;
      case 'gaveUp':
        audio.onRunEvent({ type: 'gaveUp', simTime: 20 });
        break;
      case 'allLost':
        audio.onRunEvent({ type: 'allLost', simTime: 20 });
        break;
    }
  });
}

const mute = el<HTMLInputElement>('mute');
const musicVol = el<HTMLInputElement>('musicVol');
const sfxVol = el<HTMLInputElement>('sfxVol');
const persist = el('persist');
function syncMix() {
  mute.checked = audio.settings.muted;
  musicVol.value = String(audio.settings.music);
  sfxVol.value = String(audio.settings.sfx);
}
const report = (ok: boolean) => (persist.textContent = ok ? 'saved' : 'NOT saved (storage unavailable)');
mute.addEventListener('change', () => report(audio.setMuted(mute.checked)));
musicVol.addEventListener('input', () => report(audio.setMusicVolume(Number(musicVol.value))));
sfxVol.addEventListener('input', () => report(audio.setSfxVolume(Number(sfxVol.value))));
syncMix();

el('destroy').addEventListener('click', () => {
  const old = audio;
  void old.destroy().then(() => {
    audio = new GameAudio();
    audio.init(document.body);
    syncMix();
  });
});

function render() {
  const theme = audio.music.theme;
  const ramps = audio.music.layerRamps.map((r) => `${r.from.toFixed(2)}→${r.to.toFixed(2)}`).join('  ');
  const ctx = audio.engine.graph?.ctx;
  status.textContent =
    `context: ${audio.engine.state}${audio.unlocked ? ' (unlocked)' : ''}   t=${ctx ? ctx.currentTime.toFixed(2) : '-'}\n` +
    `music:   ${theme ?? '(stopped)'}   stage ${audio.music.stage}   retiring ${audio.music.retiringCount}\n` +
    `layers:  ${ramps || '-'}\n` +
    `loops:   motor ${audio.sfx.wheelMotor.running ? `on ${audio.sfx.wheelMotor.param.toFixed(2)}` : 'off'}   blender ${audio.sfx.blenderWhir.running ? 'on' : 'off'}`;
  for (const b of themes.querySelectorAll<HTMLButtonElement>('button[data-theme]')) b.classList.toggle('on', b.dataset.theme === theme);
  for (const b of stages.querySelectorAll<HTMLButtonElement>('button[data-stage]')) b.classList.toggle('on', Number(b.dataset.stage) === (audio.music.stage as MusicStage));
  el('motor').classList.toggle('on', audio.sfx.wheelMotor.running);
  el('blender').classList.toggle('on', audio.sfx.blenderWhir.running);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
