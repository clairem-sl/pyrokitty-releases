#!/usr/bin/env node
// Convert avatar_lad.xml → two JSON files optimized for rigged mesh:
//
//   avatar_lad_skeleton.json   — skeleton bone params with nested driven params + byteIndex
//   avatar_lad_attachments.json — attachment point name → joint map
//
// Skeleton JSON schema (array of params that affect bones):
// [
//   {
//     byteIndex: number,           // index into the VisualParam byte array
//     id: number,
//     valueMin: number,
//     valueMax: number,
//     bones: [{ name, scale: [x,y,z], offset: [x,y,z] }],  // direct bone effects
//     drivenParams: [{              // nested driven params (resolved, not IDs)
//       id: number,
//       valueMin: number,
//       valueMax: number,
//       min1?: number, max1?: number, max2?: number, min2?: number,  // trapezoidal activation
//       bones: [{ name, scale: [x,y,z], offset: [x,y,z] }]
//     }]
//   }
// ]
//
// Only params that actually affect skeleton bones are included.
// byteIndex lets you index directly into the appearance byte array.

const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

const xmlPath = process.argv[2] || path.join(__dirname, '..', 'electron-ui', 'viewer', 'character', 'avatar_lad.xml');
const outDir = process.argv[3] || __dirname;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['param', 'bone', 'driven'].includes(name),
});

const xml = fs.readFileSync(xmlPath, 'utf-8');
const doc = parser.parse(xml);

// ── Helpers ──

function parseVec3(s) {
  const parts = s.trim().split(/\s+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function collectAll(obj, tagName) {
  const result = [];
  if (!obj || typeof obj !== 'object') return result;
  if (Array.isArray(obj)) {
    for (const item of obj) result.push(...collectAll(item, tagName));
    return result;
  }
  if (obj[tagName]) {
    const arr = Array.isArray(obj[tagName]) ? obj[tagName] : [obj[tagName]];
    result.push(...arr);
  }
  for (const key of Object.keys(obj)) {
    if (key !== tagName && typeof obj[key] === 'object') {
      result.push(...collectAll(obj[key], tagName));
    }
  }
  return result;
}

// ── Pass 1: Parse ALL params into a flat map by ID ──

const allParamNodes = collectAll(doc, 'param');

// Parsed param: { id, group, valueMin, valueMax, bones?, driverEntries? }
// driverEntries = raw driven refs: [{ id, min1?, max1?, max2?, min2? }]
// bones = [{ name, scale, offset }]
const paramMap = new Map();

for (const node of allParamNodes) {
  const idStr = node['@_id'];
  if (idStr === undefined) continue;

  const id = parseInt(idStr, 10);
  const param = {
    id,
    group: parseInt(node['@_group'] || '0', 10),
    valueMin: parseFloat(node['@_value_min'] || '0'),
    valueMax: parseFloat(node['@_value_max'] || '1'),
  };

  // Skeleton bones
  const skel = node.param_skeleton;
  if (skel && skel.bone) {
    const bones = Array.isArray(skel.bone) ? skel.bone : [skel.bone];
    const parsed = [];
    for (const b of bones) {
      const name = b['@_name'];
      if (name) {
        parsed.push({
          name,
          scale: b['@_scale'] ? parseVec3(b['@_scale']) : [0, 0, 0],
          offset: b['@_offset'] ? parseVec3(b['@_offset']) : [0, 0, 0],
        });
      }
    }
    if (parsed.length > 0) param.bones = parsed;
  }

  // Raw driver → driven references
  const driver = node.param_driver;
  if (driver && driver.driven) {
    const drivens = Array.isArray(driver.driven) ? driver.driven : [driver.driven];
    const entries = [];
    for (const d of drivens) {
      const drivenId = d['@_id'];
      if (drivenId !== undefined) {
        const entry = { id: parseInt(drivenId, 10) };
        if (d['@_min1'] !== undefined) entry.min1 = parseFloat(d['@_min1']);
        if (d['@_max1'] !== undefined) entry.max1 = parseFloat(d['@_max1']);
        if (d['@_max2'] !== undefined) entry.max2 = parseFloat(d['@_max2']);
        if (d['@_min2'] !== undefined) entry.min2 = parseFloat(d['@_min2']);
        entries.push(entry);
      }
    }
    if (entries.length > 0) param.driverEntries = entries;
  }

  // Deduplicate: last wins (matches SL's std::map behavior for duplicate id=664)
  paramMap.set(id, param);
}

// ── Pass 2: Compute byte indices ──
// The appearance byte array contains groups 0 (TWEAKABLE) and 3 (TRANSMIT_NOT_TWEAKABLE),
// sorted by param ID. Groups 1 and 2 are NOT transmitted.

const transmittedParams = Array.from(paramMap.values())
  .filter(p => p.group === 0 || p.group === 3)
  .sort((a, b) => a.id - b.id);

const byteIndexMap = new Map();
transmittedParams.forEach((p, i) => byteIndexMap.set(p.id, i));

// ── Pass 3: Build skeleton output with nested driven params ──
// Include a param if:
//   (a) it has bones directly, OR
//   (b) it drives at least one param that has bones

const skeletonOutput = [];

for (const param of transmittedParams) {
  const hasBones = !!param.bones;
  let drivenParams;

  if (param.driverEntries) {
    // Resolve driven targets that have skeleton bones
    const resolved = [];
    for (const entry of param.driverEntries) {
      const driven = paramMap.get(entry.id);
      if (driven && driven.bones) {
        const nested = {
          id: driven.id,
          valueMin: driven.valueMin,
          valueMax: driven.valueMax,
          bones: driven.bones,
        };
        // Merge activation params onto the nested driven object
        if (entry.min1 !== undefined) nested.min1 = entry.min1;
        if (entry.max1 !== undefined) nested.max1 = entry.max1;
        if (entry.max2 !== undefined) nested.max2 = entry.max2;
        if (entry.min2 !== undefined) nested.min2 = entry.min2;
        resolved.push(nested);
      }
    }
    if (resolved.length > 0) drivenParams = resolved;
  }

  if (!hasBones && !drivenParams) continue;  // not skeleton-relevant

  const out = {
    byteIndex: byteIndexMap.get(param.id),
    id: param.id,
    valueMin: param.valueMin,
    valueMax: param.valueMax,
  };
  if (param.bones) out.bones = param.bones;
  if (drivenParams) out.drivenParams = drivenParams;

  skeletonOutput.push(out);
}

// ── Attachment points ──

const attachmentPoints = {};
const apNodes = collectAll(doc, 'attachment_point');
for (const ap of apNodes) {
  const name = ap['@_name'];
  const joint = ap['@_joint'];
  if (name && joint) attachmentPoints[name] = joint;
}

// ── Write output ──

function writeJson(filename, data) {
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  return { outPath, kb };
}

const s = writeJson('avatar_lad_skeleton.json', skeletonOutput);
const boneCount = skeletonOutput.filter(p => p.bones).length;
const driverCount = skeletonOutput.filter(p => p.drivenParams).length;
const totalDriven = skeletonOutput.reduce((n, p) => n + (p.drivenParams ? p.drivenParams.length : 0), 0);
console.log(`${s.outPath}`);
console.log(`  ${skeletonOutput.length} params (${boneCount} with direct bones, ${driverCount} drivers → ${totalDriven} nested driven)`);
console.log(`  ${s.kb} KB`);

const a = writeJson('avatar_lad_attachments.json', attachmentPoints);
console.log(`${a.outPath}`);
console.log(`  ${Object.keys(attachmentPoints).length} attachment points`);
console.log(`  ${a.kb} KB`);
