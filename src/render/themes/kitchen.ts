import fill from '../../../assets/svg/kitchen/ground-fill.svg?raw';
import edge from '../../../assets/svg/kitchen/ground-edge.svg?raw';
import tiles from '../../../assets/svg/kitchen/tiles.svg?raw';
import windowSvg from '../../../assets/svg/kitchen/window.svg?raw';
import shelf from '../../../assets/svg/kitchen/shelf.svg?raw';
import counter from '../../../assets/svg/kitchen/counter.svg?raw';
import type { Theme } from './types';

/** Kitchen bench: marble-topped butcher block, tiled wall, warm morning light. */
export const kitchen: Theme = {
  id: 'kitchen',
  name: 'Kitchen bench',
  palette: {
    skyTop: '#FFF6E8',
    skyBottom: '#F3D9B5',
    ground: '#D9A566',
    groundEdge: '#FFFFFF',
    groundShade: '#5A3414',
    ink: '#3B2A20',
    paper: '#FFFBF4',
    accent: '#E07A5F',
    accentAlt: '#3FA7A0',
    uiPanel: '#3B2A20',
    uiText: '#FFF8EE',
    good: '#4CAF6A',
    ok: '#E9B949',
    bad: '#D9534F',
    blenderFill: '#FFF4D6',
  },
  terrain: {
    fill: { svg: fill, metresPerTile: 5 },
    edge: { svg: edge, metresPerTile: 7, above: 0.02, below: 0.5 },
    shade: { depth: 5, alpha: 0.4 },
  },
  parallax: [
    { id: 'tiles', svg: tiles, mode: 'fill', factor: 0.04 },
    { id: 'window', svg: windowSvg, mode: 'band', factor: 0.06, bottom: 40 },
    { id: 'shelf', svg: shelf, mode: 'band', factor: 0.16, bottom: -20 },
    { id: 'counter', svg: counter, mode: 'band', factor: 0.32, bottom: 150, fillBelow: '#EAE3D8' },
  ],
  horizonLift: 1.5,
};
