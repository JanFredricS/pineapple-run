import fill from '../../../assets/svg/test/ground-fill.svg?raw';
import edge from '../../../assets/svg/test/ground-edge.svg?raw';
import paper from '../../../assets/svg/test/graph-paper.svg?raw';
import sketch from '../../../assets/svg/test/sketch.svg?raw';
import rocks from '../../../assets/svg/test/rocks.svg?raw';
import type { Theme } from './types';

/** Test levels (S0 spike, harnesses): graph paper + pale rock — a nod to the original's look. */
export const test: Theme = {
  id: 'test',
  name: 'Blueprint (test)',
  palette: {
    skyTop: '#F9FBFD',
    skyBottom: '#E8EEF6',
    ground: '#CBD3DF',
    groundEdge: '#EEF2F7',
    groundShade: '#3A4658',
    ink: '#2B3445',
    paper: '#FFFFFF',
    accent: '#3A7BD5',
    accentAlt: '#F29E4C',
    uiPanel: '#2B3445',
    uiText: '#FFFFFF',
    good: '#3DAA6B',
    ok: '#F2B632',
    bad: '#E84855',
    blenderFill: '#FFF1CC',
  },
  terrain: {
    fill: { svg: fill, metresPerTile: 6 },
    edge: { svg: edge, metresPerTile: 6, above: 0.02, below: 0.4 },
    shade: { depth: 6, alpha: 0.25 },
  },
  parallax: [
    { id: 'graph-paper', svg: paper, mode: 'fill', factor: 0.1 },
    { id: 'sketch', svg: sketch, mode: 'band', factor: 0.2, bottom: 60 },
    { id: 'rocks', svg: rocks, mode: 'band', factor: 0.35, bottom: 150, fillBelow: '#DDE3EC' },
  ],
  horizonLift: 1,
};
