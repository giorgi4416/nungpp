import hungaroring from './hungaroring.js';
import monaco from './monaco.js';
import spa from './spa.js';
import suzuka from './suzuka.js';

/** Circuit registry. Add a new circuit by creating a definition file and listing it here. */
export const CIRCUITS = { hungaroring, monaco, spa, suzuka };
export const CIRCUIT_ORDER = ['hungaroring', 'monaco', 'spa', 'suzuka'];
