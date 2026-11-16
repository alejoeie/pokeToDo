import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,baseCompanions,randomCompanion,allowedCompanions} from '../server/pokemon.js';
import {LOGIN_IDS} from '../server/domain.js';
test('random encounters use actual base species with valid consistent evolution paths',()=>{
 const byId=new Map(catalog.map(p=>[p.id,p]));
 assert(catalog.length>=1000);assert(baseCompanions.length>=500);
 for(const id of baseCompanions){assert.equal(byId.get(id).isBase,true);assert.equal(byId.get(id).stages[0],id);}
 for(const p of catalog){assert.equal(p.stages.length,3);for(const id of p.stages)assert(byId.has(id));}
 for(let i=0;i<1000;i++)assert(baseCompanions.includes(randomCompanion()));
 assert(!baseCompanions.includes(5));assert(!baseCompanions.includes(6));assert(!baseCompanions.includes(25));
 assert(allowedCompanions.includes(25));assert.deepEqual(byId.get(4).stages,[4,5,6]);
 assert.deepEqual(LOGIN_IDS,{alejoeie:'ale',shar:'sharlotte'});
});
