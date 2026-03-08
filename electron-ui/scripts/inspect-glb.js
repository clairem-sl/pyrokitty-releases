const fs = require('fs');
const path = process.argv[2];
if (!path) { console.log('Usage: node inspect-glb.js <path>'); process.exit(1); }
const buf = fs.readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const nodes = json.nodes || [];
const skins = json.skins || [];
console.log('Nodes:', nodes.length);
console.log('Skins:', skins.length);
if (skins[0]) {
  console.log('Skin joints:', skins[0].joints.length);
  const jointNames = skins[0].joints.map(i => nodes[i] ? nodes[i].name : 'unnamed');
  console.log('Joint names:', jointNames.join(', '));
  // Check IBM accessor
  if (skins[0].inverseBindMatrices !== undefined) {
    const acc = json.accessors[skins[0].inverseBindMatrices];
    console.log('IBM accessor: count=' + acc.count + ' type=' + acc.type);
  }
}
for (const n of nodes) {
  if (n.mesh !== undefined) {
    console.log('Mesh node:', n.name, JSON.stringify({t: n.translation, s: n.scale, m: n.matrix ? 'yes' : undefined}));
  }
  if (n.skin !== undefined) {
    console.log('Skin node:', n.name);
  }
}
// Print root node transforms
console.log('\nRoot nodes (scene):');
const scene = json.scenes[0];
for (const idx of scene.nodes) {
  const n = nodes[idx];
  console.log(' ', n.name, JSON.stringify({t: n.translation, s: n.scale, r: n.rotation, m: n.matrix ? 'has matrix' : undefined}));
}
