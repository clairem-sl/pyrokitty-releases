#!/usr/bin/env node
// Convert avatar_skeleton.xml → avatar_skeleton.json
//
// Output schema (flat array in parent-first order):
// [
//   {
//     name: string,
//     parent: string,          // "" for root
//     pos: [x, y, z],          // SL space local position
//     rot: [x, y, z],          // Euler degrees
//     scale: [x, y, z],
//     cv: boolean,             // true for collision_volume
//     aliases?: string[]       // bone aliases (from XML aliases attr, omitted if empty)
//   }
// ]
//
// Usage:
//   NODE_PATH=electron-ui/node_modules node shared/convert-avatar-skeleton.js [input.xml] [output-dir]

const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

const xmlPath = process.argv[2] || path.join(__dirname, '..', 'electron-ui', 'viewer', 'character', 'avatar_skeleton.xml');
const outDir = process.argv[3] || __dirname;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['bone', 'collision_volume'].includes(name),
  preserveOrder: true,
});

const xml = fs.readFileSync(xmlPath, 'utf-8');
const doc = parser.parse(xml);

function parseVec3(s) {
  if (!s) return [0, 0, 0];
  const parts = s.trim().split(/\s+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

const bones = [];

function walk(nodes, parentName) {
  if (!nodes || !Array.isArray(nodes)) return;
  for (const node of nodes) {
    const tag = Object.keys(node).find(k => k !== ':@');
    if (!tag) continue;

    if (tag === 'bone' || tag === 'collision_volume') {
      const attrs = node[':@'] || {};
      const name = attrs['@_name'] || '';
      if (!name) continue;
      const isCv = tag === 'collision_volume';

      const entry = {
        name,
        parent: parentName,
        pos: parseVec3(attrs['@_pos']),
        rot: parseVec3(attrs['@_rot']),
        scale: parseVec3(attrs['@_scale']),
        cv: isCv,
      };

      // Include aliases if present (used by mesh-converter for joint name resolution)
      const aliasStr = attrs['@_aliases'];
      if (aliasStr) {
        const aliases = aliasStr.trim().split(/\s+/).filter(Boolean);
        if (aliases.length > 0) entry.aliases = aliases;
      }

      bones.push(entry);

      // Recurse into children (bones can nest, CVs don't)
      if (!isCv && Array.isArray(node[tag])) {
        walk(node[tag], name);
      }
    } else {
      // Recurse into container elements (e.g. linden_skeleton root)
      if (Array.isArray(node[tag])) {
        walk(node[tag], parentName);
      }
    }
  }
}

walk(doc, '');

// Write output to shared/ and copy to all consumer directories
const json = JSON.stringify(bones, null, 1);
const filename = 'avatar_skeleton.json';
const destinations = [
  outDir,
  path.join(__dirname, '..', 'godot-viewer', 'data'),
];

const cvCount = bones.filter(b => b.cv).length;
const aliasCount = bones.filter(b => b.aliases).length;
for (const dir of destinations) {
  const outPath = path.join(dir, filename);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, json);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`${outPath} (${kb} KB)`);
}
console.log(`  ${bones.length} entries (${bones.length - cvCount} bones, ${cvCount} collision volumes, ${aliasCount} with aliases)`);
