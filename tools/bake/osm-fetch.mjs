// Downloads the OSM data a world needs (descent line, places, glaciers) from Overpass and caches the
// raw JSON in data/raw/osm/<id>/. Usage: node tools/bake/osm-fetch.mjs <id> [--force]
// The bake calls the same code for missing files, so this is only needed to refetch (--force) or to
// warm the cache. Fallback when Overpass is down: a Geofabrik extract through osmium (osm-geofabrik.mjs),
// for worlds whose config names one (osm.geofabrik); places then come from the world config.
import { loadConfig } from './config.mjs';
import { fetchOsm } from './osm.mjs';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) || 'dolomiti';
const failed = await fetchOsm(loadConfig(id), { force: args.includes('--force') });
if (failed.length) console.log(`not fetched: ${failed.join(', ')}`);
process.exit(failed.length ? 1 : 0);
