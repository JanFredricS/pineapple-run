import fill from '../../../assets/svg/tiki/ground-fill.svg?raw';
import edge from '../../../assets/svg/tiki/ground-edge.svg?raw';
import skyMoon from '../../../assets/svg/tiki/sky-moon.svg?raw';
import lagoon from '../../../assets/svg/tiki/lagoon.svg?raw';
import barBack from '../../../assets/svg/tiki/bar-back.svg?raw';
import lanterns from '../../../assets/svg/tiki/lanterns.svg?raw';
import type { Theme } from './types';

/**
 * Tiki (S9, Zero-G Tiki Bar): a dusk-to-space sky with a low moon, a violet
 * lagoon with floating islets, a back bar whose bottles drift off the
 * shelves, lanterns and torches; bamboo terrain with a glossy bar-top rail.
 * Zones are tinted with accentAlt (low gravity) and accent (shooters), scene.ts.
 */
export const tiki: Theme = {
  id: 'tiki',
  name: 'Tiki Bar',
  palette: {
    skyTop: '#2B1B4E',
    skyBottom: '#F2856B',
    ground: '#A06E3A',
    groundEdge: '#E8C77A',
    groundShade: '#2A160A',
    ink: '#1C1233',
    paper: '#FFF4E0',
    accent: '#FF5E8A',
    accentAlt: '#36D6C3',
    uiPanel: '#3B1F5C',
    uiText: '#FFF4E0',
    good: '#3ACB8B',
    ok: '#F7B733',
    bad: '#F0544F',
    blenderFill: '#FFE9C4',
  },
  terrain: {
    fill: { svg: fill, metresPerTile: 4 },
    edge: { svg: edge, metresPerTile: 3, above: 0.05, below: 0.5 },
    shade: { depth: 5, alpha: 0.45 },
  },
  parallax: [
    { id: 'sky-moon', svg: skyMoon, mode: 'band', factor: 0.02, bottom: -40 },
    { id: 'lagoon', svg: lagoon, mode: 'band', factor: 0.08, bottom: 70, fillBelow: '#4E3A8A' },
    { id: 'bar-back', svg: barBack, mode: 'band', factor: 0.2, bottom: 130, fillBelow: '#3E2A4F' },
    { id: 'lanterns', svg: lanterns, mode: 'band', factor: 0.4, bottom: 170 },
  ],
  horizonLift: 2,
};
