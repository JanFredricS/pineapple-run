/**
 * S4 style-guide harness (styleguide.html). Renders every asset through the
 * production pipeline, the themes, the blender loop and a motion test.
 * Not shipped in the game bundle's entry; built as a separate Vite page.
 */

import { Application, Container, Graphics, Text, TilingSprite } from 'pixi.js';
import { resolveAttachments } from '../../model/attach';
import type { CartDesign } from '../../model/cart';
import type { Camera } from '../../model/coords';
import { PX_PER_M } from '../../model/coords';
import { THEME_IDS, type ThemeId } from '../../model/level';
import type { BodyTransform, RenderSnapshot, SceneManifest } from '../../model/snapshot';
import { ART, coreAssetDefs } from '../artCatalog';
import { AssetLibrary, svgDataUri, rasterResolution } from '../assets';

import { BlenderView } from '../blender';
import { SceneRenderer } from '../scene';
import { THEMES, applyThemeCss, themeAssetDefs, PALETTE_KEYS } from '../themes';
import { manifestFromSpec, MockRunSource, mockLevel } from './mockRun';

const statusEl = document.getElementById('status')!;

async function main(): Promise<void> {
  const t0 = performance.now();
  const defs = [...coreAssetDefs(), ...THEME_IDS.flatMap((id) => themeAssetDefs(THEMES[id]))];
  const lib = new AssetLibrary(defs);
  await lib.ready;
  statusEl.textContent = `${defs.length} SVG assets rasterised at ${rasterResolution(devicePixelRatio)}× in ${Math.round(
    performance.now() - t0,
  )} ms · ${lib.atlasPageCount} atlas page(s)`;

  await Promise.all([mountParts(lib), mountThemes(lib), mountMotion(lib)]);
  buildStacks();
  showAtlas(lib);
}

async function makeApp(host: HTMLElement, background: number): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);
  return app;
}

const label = (text: string, size = 12, color = 0x5b616e) =>
  new Text({ text, style: { fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: size, fill: color, fontWeight: '600' } });

// ------------------------------------------------------------------ parts

/** One sample of every part (design px), laid out in a row; shock rig on the right. */
const PARTS_DESIGN: CartDesign = {
  version: 1,
  parts: [
    { id: 'st1', kind: 'straw', a: { x: 0, y: 6 }, b: { x: 36, y: 6 } },
    { id: 'st2', kind: 'straw', a: { x: 48, y: 18 }, b: { x: 96, y: -12 } },
    { id: 'cb1', kind: 'cube', center: { x: 122, y: 6 }, width: 20, height: 20, angle: 0 },
    { id: 'cb2', kind: 'cube', center: { x: 164, y: 6 }, width: 38, height: 14, angle: -0.25 },
    { id: 'lm1', kind: 'lime', center: { x: 206, y: 6 }, radius: 12 },
    { id: 'wh1', kind: 'wheel', center: { x: 246, y: 6 }, radius: 18 },
    { id: 'st3', kind: 'straw', a: { x: 280, y: -22 }, b: { x: 324, y: -22 } },
    { id: 'wh2', kind: 'wheel', center: { x: 302, y: 20 }, radius: 12 },
    { id: 'sh1', kind: 'shock', a: { x: 286, y: -22 }, b: { x: 302, y: 20 } },
    { id: 'sh2', kind: 'shock', a: { x: 318, y: -22 }, b: { x: 302, y: 20 } },
  ],
};

function partsSource(): { manifest: SceneManifest; snapshot(t: number): RenderSnapshot } {
  const spec = resolveAttachments(PARTS_DESIGN);
  const { bodies, ids } = manifestFromSpec(spec, 10);
  const pineId = 99;
  bodies.push({ id: pineId, role: 'pineapple', shapes: [{ type: 'circle', partId: 'pa', center: { x: 0, y: 0 }, radius: 1 / 3 }] });
  const manifest: SceneManifest = { revision: 1, bodies };
  return {
    manifest,
    snapshot(t) {
      const out: BodyTransform[] = [];
      for (const b of spec.bodies) {
        const id = ids.get(b.id)!;
        const spin = b.kind === 'wheel' || b.partIds.includes('lm1') ? t * 1.2 : 0;
        if (b.partIds.includes('wh2')) {
          // shock rig: wheel bobs so the coil springs compress and stretch
          out.push({ id, x: b.origin.x, y: b.origin.y + 0.32 * Math.sin(t * 1.6), angle: t * 0.8 });
        } else out.push({ id, x: b.origin.x, y: b.origin.y, angle: spin });
      }
      out.push({ id: pineId, x: 12.1, y: 0.2, angle: t * 0.9 });
      return { step: 0, simTime: t, alpha: 0, manifestRevision: 1, bodies: out };
    },
  };
}

async function mountParts(lib: AssetLibrary): Promise<void> {
  const host = document.getElementById('parts')!;
  const app = await makeApp(host, 0xfbf8f1);
  // napkin (builder backdrop) behind everything
  const napkin = new TilingSprite({ texture: lib.texture(ART.napkin.id), width: 1, height: 1 });
  app.stage.addChild(napkin);

  const src = partsSource();
  const rows = [0.5, 1, 2].map((zoom) => {
    const r = new SceneRenderer(lib, { background: false });
    r.setCartDesign(PARTS_DESIGN);
    const mask = new Graphics();
    const cell = new Container();
    cell.addChild(r.view, mask);
    r.view.mask = mask;
    const tag = label(`${zoom}×`, 13, 0x22262e);
    cell.addChild(tag);
    app.stage.addChild(cell);
    return { r, zoom, cell, mask, tag, cam: { center: { x: 6, y: 0.2 }, zoom, viewportWidth: 1, viewportHeight: 1 } as Camera };
  });

  const blender = new BlenderView(lib, 0xfff1c9);
  const blenderSmall = new BlenderView(lib, 0xfff1c9);
  const bLabel = label('Blender goal — fill + whir loop', 13, 0x22262e);
  app.stage.addChild(blender.view, blenderSmall.view, bLabel);

  let t = 0;
  app.ticker.add((tk) => {
    const dt = tk.deltaMS / 1000;
    t += dt;
    const W = app.screen.width;
    const H = app.screen.height;
    napkin.width = W;
    napkin.height = H;
    const narrow = W < 800;
    const partsW = narrow ? W : W * 0.72;
    const heights = [0.2, 0.3, 0.5];
    const partsH = narrow ? H * 0.62 : H;
    let y = 0;
    const snap = src.snapshot(t);
    rows.forEach((row, i) => {
      const h = partsH * heights[i]!;
      row.cell.position.set(0, y);
      row.mask.clear().rect(0, 0, partsW, h).fill(0xffffff);
      row.cam.viewportWidth = partsW;
      row.cam.viewportHeight = h;
      row.tag.position.set(12, 8);
      row.r.render(src.manifest, snap, row.cam, dt);
      y += h;
    });
    // blender: 0..1 fill over 5 s with whir, hold, drain
    const cyc = t % 9;
    const progress = cyc < 5 ? cyc / 5 : cyc < 7 ? 1 : 1 - (cyc - 7) / 2;
    const whir = cyc < 5.5 ? 1 : cyc < 7 ? Math.max(0, 1 - (cyc - 5.5) / 1.5) : 0.15;
    for (const b of [blender, blenderSmall]) {
      b.progress = progress;
      b.whir = whir;
      b.update(dt);
    }
    if (narrow) {
      const bh = H - partsH;
      blender.view.scale.set((bh * 0.8) / 340);
      blender.view.position.set(W * 0.35, H - 16);
      blenderSmall.view.scale.set((bh * 0.35) / 340);
      blenderSmall.view.position.set(W * 0.75, H - 16);
      bLabel.position.set(12, partsH + 8);
    } else {
      blender.view.scale.set((H * 0.72) / 340);
      blender.view.position.set(partsW + (W - partsW) * 0.42, H - 24);
      blenderSmall.view.scale.set(3.6 / 340 * PX_PER_M); // in-game size at zoom 1
      blenderSmall.view.position.set(W - 40, H - 24);
      bLabel.position.set(partsW + 12, 8);
    }
  });
}

// ------------------------------------------------------------------ themes

async function mountThemes(lib: AssetLibrary): Promise<void> {
  const host = document.getElementById('themes')!;
  const app = await makeApp(host, 0x22262e);
  const cells = THEME_IDS.map((id) => {
    const src = new MockRunSource();
    src.time = 13.2; // parked on the slope before the dip
    const r = new SceneRenderer(lib, { theme: id });
    r.setLevel(mockLevel(id));
    r.setCartDesign(src.design);
    r.setGoal(0.55, 0.4);
    const mask = new Graphics();
    const cell = new Container();
    cell.addChild(r.view, mask);
    r.view.mask = mask;
    const tagBg = new Graphics();
    const tag = label(THEMES[id].name, 13, 0xffffff);
    cell.addChild(tagBg, tag);
    app.stage.addChild(cell);
    return { id, r, src, cell, mask, tag, tagBg, cam: { center: { x: 30, y: 6 }, zoom: 1, viewportWidth: 1, viewportHeight: 1 } as Camera };
  });
  const manifest = cells[0]!.src.manifest();
  let t = 0;
  app.ticker.add((tk) => {
    const dt = tk.deltaMS / 1000;
    t += dt;
    const W = app.screen.width;
    const H = app.screen.height;
    const cols = W < 700 ? 1 : 2;
    const rowsN = Math.ceil(cells.length / cols);
    const gap = 2;
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - gap * (rowsN - 1)) / rowsN;
    // pan across the course (ping-pong), camera slightly above terrain
    const px = 28 + 70 * (0.5 - 0.5 * Math.cos((t / 36) * Math.PI * 2));
    cells.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      c.cell.position.set(col * (cw + gap), row * (ch + gap));
      c.mask.clear().rect(0, 0, cw, ch).fill(0xffffff);
      c.cam.viewportWidth = cw;
      c.cam.viewportHeight = ch;
      c.cam.zoom = Math.max(0.6, Math.min(1.2, ch / 360));
      c.cam.center.x = px;
      c.cam.center.y = 5.6 + 0.08 * (px - 28);
      c.src.time = 13.2;
      c.r.render(manifest, c.src.snapshot(), c.cam, dt);
      c.tag.position.set(14, 10);
      c.tagBg.clear().roundRect(6, 6, c.tag.width + 16, c.tag.height + 8, 8).fill({ color: 0x000000, alpha: 0.35 });
    });
  });
}

function buildStacks(): void {
  const host = document.getElementById('stacks')!;
  for (const id of THEME_IDS) {
    const theme = THEMES[id];
    const card = document.createElement('div');
    card.className = 'card';
    applyThemeCss(theme, card);
    const layerRows = [
      ...theme.parallax.map((l) => ({ name: `${l.id} · ${l.mode} · f ${l.factor}`, svg: l.svg })),
      { name: `terrain fill · ${theme.terrain.fill.metresPerTile} m/tile`, svg: theme.terrain.fill.svg },
      { name: `terrain edge · ${theme.terrain.edge.metresPerTile} m/tile`, svg: theme.terrain.edge.svg },
    ];
    card.innerHTML = `
      <h3>${theme.name} <small>${theme.parallax.length} parallax layers</small></h3>
      <div class="layers">${layerRows
        .map((r) => `<div class="layer"><div class="img"><img alt="" src="${svgDataUri(r.svg)}"></div><span>${r.name}</span></div>`)
        .join('')}</div>
      <div class="swatches">${PALETTE_KEYS.map((k) => `<div class="swatch" title="${k} ${theme.palette[k]}" style="background:${theme.palette[k]}"></div>`).join('')}</div>
      <div class="hud"><span class="timer">0:24</span><span class="pill">Release</span><span class="pill alt">Give up</span>
        <span class="rating"><span style="background:var(--pr-bad)"></span><span style="background:var(--pr-ok)"></span><span style="background:var(--pr-good)"></span></span></div>`;
    host.appendChild(card);
  }
}

// ------------------------------------------------------------------ motion

async function mountMotion(lib: AssetLibrary): Promise<void> {
  const host = document.getElementById('motion')!;
  const app = await makeApp(host, 0x22262e);
  let theme: ThemeId = 'beach';
  const renderer = new SceneRenderer(lib, { theme });
  app.stage.addChild(renderer.view);
  const hudBg = new Graphics();
  const hud = label('', 12, 0xffffff);
  hud.position.set(16, 12);
  app.stage.addChild(hudBg, hud);

  const mock = new MockRunSource();
  let mode: 'mock' | 'physics' = 'mock';
  let physics: Awaited<ReturnType<typeof startPhysics>> | null = null;
  const cam: Camera = { center: { x: 0, y: 6 }, zoom: 1.4, viewportWidth: 1, viewportHeight: 1 };
  let slowmo = false;

  const setupMock = () => {
    renderer.setLevel(mockLevel(theme));
    renderer.setCartDesign(mock.design);
  };
  setupMock();

  // controls
  const themeSeg = document.getElementById('motion-theme')!;
  for (const id of THEME_IDS) {
    const b = document.createElement('button');
    b.textContent = THEMES[id].name;
    b.setAttribute('aria-pressed', String(id === theme));
    b.onclick = () => {
      theme = id;
      themeSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderer.setTheme(id);
      if (mode === 'mock') renderer.setLevel(mockLevel(id));
    };
    themeSeg.appendChild(b);
  }
  const speed = document.getElementById('motion-speed') as HTMLInputElement;
  const zoom = document.getElementById('motion-zoom') as HTMLInputElement;
  const slow = document.getElementById('motion-slowmo') as HTMLInputElement;
  speed.oninput = () => (mock.speed = Number(speed.value));
  zoom.oninput = () => (cam.zoom = Number(zoom.value));
  slow.onchange = () => (slowmo = slow.checked);
  const srcSeg = document.getElementById('motion-source')!;
  // Each switch gets a token; a physics world whose async init finishes after
  // a later switch is destroyed instead of installed (no stale level/design,
  // no orphaned world or key listeners).
  let switchToken = 0;
  srcSeg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', async () => {
      const next = b.dataset.src as 'mock' | 'physics';
      if (next === mode) return;
      const token = ++switchToken;
      srcSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      mode = next;
      physics?.destroy();
      physics = null;
      renderer.resetSource();
      if (mode === 'physics') {
        const started = await startPhysics();
        if (token !== switchToken || mode !== 'physics') {
          started.destroy();
          return;
        }
        physics = started;
        renderer.setLevel(physics.level);
        renderer.setTheme(theme);
        renderer.setCartDesign(physics.design);
      } else setupMock();
    });
  });

  let fps = 60;
  app.ticker.add((tk) => {
    const dt = (tk.deltaMS / 1000) * (slowmo ? 0.25 : 1);
    fps = fps * 0.95 + (1000 / Math.max(1, tk.deltaMS)) * 0.05;
    cam.viewportWidth = app.screen.width;
    cam.viewportHeight = app.screen.height;
    let manifest: SceneManifest;
    let snap: RenderSnapshot;
    let focus: { x: number; y: number };
    if (mode === 'physics' && physics) {
      physics.advance(dt);
      manifest = physics.manifest();
      snap = physics.snapshot();
      focus = physics.focus(snap);
    } else {
      mock.advance(dt);
      manifest = mock.manifest();
      snap = mock.snapshot();
      focus = mock.chassisPosition(snap);
    }
    // look ahead a little; keep the wheels in frame when zoomed in
    const tx = focus.x + 1 + 2 / cam.zoom;
    const ty = focus.y + 0.2 - 1.4 / cam.zoom;
    if (Math.abs(tx - cam.center.x) > 30) cam.center.x = tx; // loop wrap: snap
    cam.center.x += (tx - cam.center.x) * Math.min(1, dt * 6);
    cam.center.y += (ty - cam.center.y) * Math.min(1, dt * 4);
    renderer.setGoal(Math.min(1, Math.max(0, (focus.x - 70) / 30)), focus.x > 80 ? 1 : 0.1);
    renderer.render(manifest, snap, cam, dt);
    hud.text = `${mode === 'mock' ? 'mock snapshot source' : 'S0 spike physics — ←/→ drive'} · ${fps.toFixed(0)} fps · t ${snap.simTime.toFixed(1)} s`;
    hudBg.clear().roundRect(8, 7, hud.width + 16, hud.height + 10, 8).fill({ color: 0x000000, alpha: 0.4 });
  });
}

/** Live S0 spike physics behind the same snapshot interface (harness only). */
async function startPhysics() {
  const [{ PhysicsWorld }, { createSpikeScene }] = await Promise.all([import('../../physics/engine'), import('../../spike/scene')]);
  const world = await PhysicsWorld.create();
  const scene = createSpikeScene(world);
  const held = { left: false, right: false };
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') held.left = down;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') held.right = down;
    else return;
    e.preventDefault();
  };
  const kd = onKey(true);
  const ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  const blur = () => {
    held.left = held.right = false;
  };
  window.addEventListener('blur', blur);
  let acc = 0;
  let alpha = 0;
  return {
    level: scene.level,
    design: scene.design,
    advance(dt: number) {
      acc = Math.min(acc + dt, 0.25);
      while (acc >= 1 / 60) {
        scene.cart.setDrive(held.right === held.left ? 0 : held.right ? 1 : -1);
        scene.step();
        acc -= 1 / 60;
      }
      alpha = acc * 60;
    },
    manifest: () => world.manifest(),
    snapshot: () => world.snapshot(alpha),
    focus(snap: RenderSnapshot) {
      const c = snap.bodies.find((b) => b.id === scene.chassis);
      return c ? { x: c.x, y: c.y } : { x: 0, y: 0 };
    },
    destroy() {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      world.destroy();
    },
  };
}

// ------------------------------------------------------------------ atlas

function showAtlas(lib: AssetLibrary): void {
  const host = document.getElementById('atlas')!;
  for (let i = 0; i < lib.atlasPageCount; i++) {
    const tex = lib.atlasPage(i);
    const canvas = tex.source.resource as HTMLCanvasElement;
    const clone = document.createElement('canvas');
    clone.width = canvas.width;
    clone.height = canvas.height;
    clone.getContext('2d')!.drawImage(canvas, 0, 0);
    clone.style.width = `${canvas.width / lib.resolution}px`;
    host.appendChild(clone);
  }
  const info = document.createElement('p');
  info.className = 'status';
  info.textContent = lib
    .ids()
    .map((id) => {
      const e = lib.entry(id)!;
      return `${id} ${e.size.width}×${e.size.height}${e.page < 0 ? (e.repeat ? ' (repeat)' : ' (standalone)') : ` @p${e.page}`}`;
    })
    .join(' · ');
  host.appendChild(info);
}

main().catch((err: unknown) => {
  console.error(err);
  statusEl.className = 'err';
  statusEl.textContent = `Style guide failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
});
