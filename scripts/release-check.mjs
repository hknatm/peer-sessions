import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forbiddenName=/(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|auth\.json|settings\.json|models\.json|config\.json|identity\.crt|peer-.*\.crt|state|runtime|sessions)(?:$|\/)|\.(?:key|pem|p12|pfx|secret|sqlite(?:-wal|-shm)?|db|sock|tgz)$/i;
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})\b/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,/https?:\/\/[^\s/:]+:[^\s/@]+@/,/\/Users\/[a-zA-Z0-9_-]+\//];
const failures=[];
function inspect(file){const relative=path.relative(root,file);if(forbiddenName.test(relative))failures.push(`${relative}: forbidden artifact`);const stat=fs.lstatSync(file);if(stat.isSymbolicLink()){failures.push(`${relative}: symlink`);return;}if(!stat.isFile())return;const content=fs.readFileSync(file,'utf8');if(patterns.some(p=>p.test(content)))failures.push(`${relative}: potential secret/personal path (value not shown)`);}
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','artifacts'].includes(item.name))continue;const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else inspect(file);}}
walk(root);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.type,'module');assert.ok(pkg.pi.extensions.includes('extensions/peer.ts'));assert.ok(!pkg.dependencies||Object.keys(pkg.dependencies).length===0);
for(const range of Object.values(pkg.peerDependencies))assert.equal(range,'*');
for(const script of ['install','postinstall','preinstall'])assert.equal(pkg.scripts[script],undefined);
const output=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:root,encoding:'utf8'}));
const files=output[0].files.map(f=>f.path);
for(const name of files){if(!/^(?:package\.json|README\.md|SECURITY\.md|CHANGELOG\.md|RELEASE\.md|LICENSE|src\/[a-z-]+\.mjs|extensions\/[a-z-]+\.ts)$/.test(name))failures.push(`${name}: not in release allowlist`);inspect(path.join(root,name));}
for(const name of ['LICENSE','src/service.mjs','src/setup.mjs','src/pairing.mjs','src/project.mjs','extensions/peer.ts','extensions/manage.ts'])assert.ok(files.includes(name),`Missing ${name}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`Release check passed: ${files.length} npm files, no detected secret artifacts/personal paths, no bundled host dependencies. Static scanning is not proof against every secret format.`);
