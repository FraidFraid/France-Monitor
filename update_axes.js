const fs = require('fs');
const files = [
  '/Users/fraid/Desktop/FranceMonitor/src/plugins/france-intel-proxy.ts',
  '/Users/fraid/Desktop/FranceMonitor/api/intelligence/v1/france-intel-brief.js'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/axes:\s*\{\s*troubles:\s*number;\s*conflict:\s*number;\s*security:\s*number;\s*information:\s*number\s*\}/g, 'axes: { continuity: number; defense: number; security: number; signal: number }');
  content = content.replace(/axes\?\.\s*troubles/g, 'axes?.continuity');
  content = content.replace(/axes\.troubles/g, 'axes.continuity');
  content = content.replace(/axes\.conflict/g, 'axes.defense');
  content = content.replace(/axes\.information/g, 'axes.signal');
  content = content.replace(/troubles:\s*typeof/g, 'continuity: typeof');
  content = content.replace(/conflict:\s*typeof\s*body\.axes\?.conflict/g, 'defense: typeof body.axes?.defense');
  content = content.replace(/conflict:\s*typeof\s*parsed\.axes\?.conflict/g, 'defense: typeof parsed.axes?.defense');
  content = content.replace(/information:\s*typeof\s*body\.axes\?.information/g, 'signal: typeof body.axes?.signal');
  content = content.replace(/information:\s*typeof\s*parsed\.axes\?.information/g, 'signal: typeof parsed.axes?.signal');
  content = content.replace(/axes\?\:\s*\{\s*troubles\?\:\s*unknown;\s*conflict\?\:\s*unknown;\s*security\?\:\s*unknown;\s*information\?\:\s*unknown\s*\}/g, 'axes?: { continuity?: unknown; defense?: unknown; security?: unknown; signal?: unknown }');
  content = content.replace(/troublesLabel\s*=\s*describeAxis/g, 'continuityLabel = describeAxis');
  // the variables troublesLabel, conflictLabel, informationLabel aren't used in v11, but let's be thorough if they are there.
  fs.writeFileSync(file, content);
});
console.log('Done replacing axis variables');
