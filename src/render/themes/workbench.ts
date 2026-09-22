import fill from '../../../assets/svg/workbench/ground-fill.svg?raw';
import edge from '../../../assets/svg/workbench/ground-edge.svg?raw';
import pegboard from '../../../assets/svg/workbench/pegboard.svg?raw';
import tools from '../../../assets/svg/workbench/tools.svg?raw';
import shelf from '../../../assets/svg/workbench/shelf.svg?raw';
import type { Theme } from './types';

/** Workbench: plank terrain with a ruler edge, pegboard, blueprint homage. */
export const workbench: Theme = {
  id: 'workbench',
  name: 'Workbench',
  palette: {
    skyTop: '#CFAA78',
    skyBottom: '#B98F5E',
    ground: '#DDB57B',
    groundEdge: '#FBE3A1',
    groundShade: '#3E2812',
    ink: '#1E2F45',
    paper: '#F4F7FB',
    accent: '#2D5E91',
    accentAlt: '#E84855',
    uiPanel: '#1E3A5F',
    uiText: '#F4F7FB',
    good: '#3DAA6B',
    ok: '#F2B632',
    bad: '#E84855',
    blenderFill: '#FFF1CC',
  },
  terrain: {
    fill: { svg: fill, metresPerTile: 5 },
    edge: { svg: edge, metresPerTile: 4, above: 0, below: 0.45 },
    shade: { depth: 5, alpha: 0.4 },
  },
  parallax: [
    { id: 'pegboard', svg: pegboard, mode: 'fill', factor: 0.04 },
    { id: 'tools', svg: tools, mode: 'band', factor: 0.12, bottom: 30 },
    { id: 'shelf', svg: shelf, mode: 'band', factor: 0.28, bottom: 160, fillBelow: '#B98F5E' },
  ],
  horizonLift: 1.5,
};
