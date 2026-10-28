// Uses the repository's installed electron-builder compression configuration.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'../..');
const [receiptArg,sevenZip]=process.argv.slice(2);
if(!receiptArg||!sevenZip)throw new Error('Usage: node measure-packaging.mjs <receipt.json> <7za.exe>');
const file=path.resolve(receiptArg),receipt=JSON.parse(await fs.readFile(file,'utf8'));
const work=path.dirname(file),payload=path.join(work,'payload');
assert.ok(work.startsWith(path.join(root,'data','pdf-table-runtime')+path.sep));
const require=createRequire(path.join(root,'desktop/package.json'));
const {compute7zCompressArgs}=require('app-builder-lib/out/targets/archive.js');
const {configureDifferentialAwareArchiveOptions}=require('app-builder-lib/out/targets/differentialUpdateInfoBuilder.js');
delete process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
delete process.env.ELECTRON_BUILDER_7Z_FILTER;
const measurements={};
for(const [name,format,options]of [
  ['nsis','7z',configureDifferentialAwareArchiveOptions({compression:'normal'})],
  ['portable','7z',{compression:'normal'}],
  ['zip','zip',{compression:'normal'}],
]){
  const output=path.join(work,'builder-'+name+'.'+format),args=compute7zCompressArgs(format,options);
  execFileSync(sevenZip,[...args,output,'.'],{cwd:payload,stdio:'pipe',windowsHide:true});
  measurements[name]={bytes:(await fs.stat(output)).size,args};
}
const unpacked=path.join(work,'unpacked');
execFileSync(sevenZip,['x',path.join(work,'builder-nsis.7z'),'-o'+unpacked,'-y'],{stdio:'pipe',windowsHide:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PYTHON|PIP|VIRTUAL_ENV|CONDA)/i.test(k)));
const smoke=JSON.parse(execFileSync(path.join(unpacked,'python.exe'),['-I','-B',path.join(unpacked,'read_tables.py'),path.join(work,'synthetic-table.pdf')],{cwd:work,env,encoding:'utf8',windowsHide:true}));
assert.deepEqual(smoke.tables,[[['Item','Amount'],['Test','123.45']]]);
assert.ok(smoke.paths.every(p=>p.toLowerCase().startsWith(unpacked.toLowerCase()+path.sep)||p.toLowerCase()===unpacked.toLowerCase()));
receipt.electronBuilderPayload=measurements;
receipt.unpackedSmoke={status:'passed',...smoke};
await fs.writeFile(file,JSON.stringify(receipt,null,2));
console.log(JSON.stringify({status:'passed',electronBuilderPayload:measurements,unpackedSmoke:'passed',receipt:file}));
