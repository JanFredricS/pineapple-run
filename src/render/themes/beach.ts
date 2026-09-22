import fill from '../../../assets/svg/beach/ground-fill.svg?raw';
import edge from '../../../assets/svg/beach/ground-edge.svg?raw';
import skySun from '../../../assets/svg/beach/sky-sun.svg?raw';
import sea from '../../../assets/svg/beach/sea.svg?raw';
import dunesFar from '../../../assets/svg/beach/dunes-far.svg?raw';
import dunesNear from '../../../assets/svg/beach/dunes-near.svg?raw';
import type { Theme } from './types';

/** Beach: golden sand, turquoise sea, palms, sunny sky. */
export const beach: Theme = {
  id: 'beach',
  name: 'Beach',
  palette: {
    skyTop: '#6CC6EE',
    skyBottom: '#FFF1D2',
    ground: '#E7C487',
    groundEdge: '#FFF0CC',
    groundShade: '#8A5A22',
    ink: '#1D3B4F',
    paper: '#FFF8EA',
    accent: '#FF6F61',
    accentAlt: '#2EC4B6',
    uiPanel: '#0F4C5C',
    uiText: '#FFFFFF',
    good: '#2BB673',
    ok: '#F4B400',
    bad: '#E94F37',
    blenderFill: '#FFF1C9',
  },
  terrain: {
    fill: { svg: fill, metresPerTile: 6 },
    edge: { svg: edge, metresPerTile: 6, above: 0.06, below: 0.55 },
    shade: { depth: 6, alpha: 0.35 },
  },
  parallax: [
    { id: 'sky-sun', svg: skySun, mode: 'band', factor: 0.02, bottom: -40 },
    { id: 'sea', svg: sea, mode: 'band', factor: 0.08, bottom: 70, fillBelow: '#7EE0DA' },
    { id: 'dunes-far', svg: dunesFar, mode: 'band', factor: 0.2, bottom: 110, fillBelow: '#E2C791' },
    { id: 'dunes-near', svg: dunesNear, mode: 'band', factor: 0.4, bottom: 170, fillBelow: '#DDB678' },
  ],
  horizonLift: 2,
};
