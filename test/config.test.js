import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOrigin, databaseFailure, startupMessage} from '../server/config.js';
import {connectDatabase} from '../server/db.js';
test('startup diagnostics distinguish configuration failures without logging secrets',async()=>{
 const secret='do-not-print-this-password';
 for(const origin of ['https://example.com/','localhost:4174',`https://user:${secret}@example.com`,'http://example.com'])assert.throws(()=>validateOrigin(origin,true),e=>!e.message.includes(secret)&&e.message.includes('APP_ORIGIN'));
 assert.doesNotThrow(()=>validateOrigin('https://pokedo.alebyte.me',true));
 assert.doesNotThrow(()=>validateOrigin('http://localhost:4174',false));
 await assert.rejects(connectDatabase({}),e=>e.message.includes('MONGODB_URI'));
 await assert.rejects(connectDatabase({MONGODB_URI:secret}),e=>!e.message.includes(secret));
 assert.match(startupMessage(databaseFailure({code:18,message:secret})),/authentication failed/);
 assert.match(startupMessage(databaseFailure({name:'MongoServerSelectionError',message:secret})),/outbound IP/);
 assert(!startupMessage(new Error(secret)).includes(secret));
});
