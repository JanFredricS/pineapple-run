import fill from '../../../assets/svg/blueprint/ground-fill.svg?raw';
import edge from '../../../assets/svg/blueprint/ground-edge.svg?raw';
import paper from '../../../assets/svg/blueprint/graph-paper.svg?raw';
import sketch from '../../../assets/svg/blueprint/sketch.svg?raw';
import rocks from '../../../assets/svg/blueprint/rocks.svg?raw';
import type { Theme } from './types';

/**
 * Blueprint: graph paper, pale faceted rock and drafting-blue linework — a
 * nod to the original game's look. The Original Course (2008) ships in it
 * (B1), so the recovered course reads as the original's blueprint; the S0
 * spike and the run fixtures use it too. Was theme id 'test' until B1
 * (still accepted by validateLevelDef as a legacy alias).
 */
export const blueprint: Theme = {
  id: 'blueprint',
  name: 'Blueprint',
  palette: {
    skyTop: '#F9FBFD',
    skyBottom: '#E4EBF4',
    ground: '#CBD3DF',
    groundEdge: '#EEF2F7',
    groundShade: '#2E4A72',
    ink: '#1F3A60',
    paper: '#FFFFFF',
    accent: '#2F6DB5',
    accentAlt: '#F29E4C',
    uiPanel: '#1F3A60',
    uiText: '#FFFFFF',
    good: '#3DAA6B',
    ok: '#F2B632',
    bad: '#E84855',
    blenderFill: '#FFF1CC',
  },
  terrain: {
    fill: { svg: fill, metresPerTile: 6 },
    edge: { svg: edge, metresPerTile: 6, above: 0.02, below: 0.4 },
    shade: { depth: 6, alpha: 0.22 },
  },
  parallax: [
    { id: 'graph-paper', svg: paper, mode: 'fill', factor: 0.1 },
    { id: 'sketch', svg: sketch, mode: 'band', factor: 0.2, bottom: 60 },
    { id: 'rocks', svg: rocks, mode: 'band', factor: 0.35, bottom: 150, fillBelow: '#DDE3EC' },
  ],
  horizonLift: 1,
  goalOutline: '#2A62A8',
};
