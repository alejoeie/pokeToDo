import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
export const catalog=JSON.parse(readFileSync(new URL('../data/pokemon.json',import.meta.url),'utf8')).species;
export const baseCompanions=catalog.filter(p=>p.isBase).map(p=>p.id);
// Previously assigned companions remain valid, including those with baby pre-evolutions.
export const allowedCompanions=[...new Set([...baseCompanions,1,4,7,25,39,133,252])];
export const randomCompanion=()=>baseCompanions[randomInt(baseCompanions.length)];
