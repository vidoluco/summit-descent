// Compatibility: the Dolomiti config now lives in dolomiti.json (one JSON config per world, see
// tools/bake/config.mjs). This module re-exports it, with defaults filled, for older importers.
import { loadConfig } from '../config.mjs';

export default loadConfig('dolomiti');
