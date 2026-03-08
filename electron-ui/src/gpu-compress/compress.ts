/**
 * compress.ts — Runs in a hidden BrowserWindow renderer process.
 * Provides WebGPU BC1/BC3 texture compression via compute shaders.
 * Single-pass pipeline: mipmap gen + BC compress + single readback.
 * Alpha detection done CPU-side by caller to avoid GPU sync stall.
 * Communicates with the main process via ipcRenderer.
 */

const { ipcRenderer } = require('electron');

interface CompressRequest {
  id: number;
  rgba: Uint8Array;
  width: number;
  height: number;
  format: 0 | 1; // 0=BC1, 1=BC3
}

interface FullCompressRequest {
  id: number;
  rgba: Uint8Array;
  width: number;
  height: number;
  format: 0 | 1; // 0=BC1, 1=BC3
}

let device: GPUDevice | null = null;
let bc1Pipeline: GPUComputePipeline | null = null;
let bc3Pipeline: GPUComputePipeline | null = null;
let downsamplePipeline: GPUComputePipeline | null = null;
let shaderModule: GPUShaderModule | null = null;

async function initWebGPU(): Promise<boolean> {
  try {
    const adapter = await navigator.gpu?.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) {
      console.error('[GpuCompress] No WebGPU adapter available');
      return false;
    }

    device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: 256 * 1024 * 1024, // 256MB
        maxBufferSize: 256 * 1024 * 1024,
      },
    });

    device.lost.then((info) => {
      console.error('[GpuCompress] Device lost:', info.message);
      device = null;
    });

    // Load shader via fetch (same origin, file:// served by Electron)
    const shaderUrl = new URL('./bc-compress.wgsl', document.baseURI).href;
    const resp = await fetch(shaderUrl);
    const shaderCode = await resp.text();

    shaderModule = device.createShaderModule({ code: shaderCode });

    // ─── BC1/BC3 pipeline layout (shared) ─────────────────
    const bcBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const bcPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bcBindGroupLayout],
    });

    bc1Pipeline = device.createComputePipeline({
      layout: bcPipelineLayout,
      compute: { module: shaderModule, entryPoint: 'compress_bc1' },
    });

    bc3Pipeline = device.createComputePipeline({
      layout: bcPipelineLayout,
      compute: { module: shaderModule, entryPoint: 'compress_bc3' },
    });

    // ─── Downsample pipeline ──────────────────────────────
    const downsampleBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: {
          access: 'write-only',
          format: 'rgba8unorm',
        }},
      ],
    });

    downsamplePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [downsampleBindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'downsample_2x' },
    });

    console.log('[GpuCompress] WebGPU initialized successfully (full pipeline)');
    return true;
  } catch (err) {
    console.error('[GpuCompress] Init failed:', err);
    return false;
  }
}

// ─── Mip chain computation (inline, mirrors bctex-format.ts) ──

function computeMipChain(baseWidth: number, baseHeight: number, bytesPerBlock: number) {
  const widths: number[] = [];
  const heights: number[] = [];
  const sizes: number[] = [];
  let w = baseWidth;
  let h = baseHeight;
  let totalSize = 0;

  while (w >= 1 && h >= 1) {
    widths.push(w);
    heights.push(h);
    const blocksX = Math.ceil(w / 4);
    const blocksY = Math.ceil(h / 4);
    const s = blocksX * blocksY * bytesPerBlock;
    sizes.push(s);
    totalSize += s;
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }

  return { widths, heights, sizes, totalSize };
}

// ─── Single-mip compression (legacy) ─────────────────────

async function compressTexture(req: CompressRequest): Promise<Uint8Array> {
  if (!device || !bc1Pipeline || !bc3Pipeline) {
    throw new Error('WebGPU not initialized');
  }

  const { rgba, width, height, format } = req;
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const bytesPerBlock = format === 0 ? 8 : 16;
  const totalBlocks = blocksWide * blocksHigh;
  const outputSizeBytes = totalBlocks * bytesPerBlock;

  const texture = device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  device.queue.writeTexture(
    { texture },
    rgba as Uint8Array<ArrayBuffer>,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  );

  const paramsData = new Uint32Array([width, height, blocksWide, format]);
  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const outputBuffer = device.createBuffer({
    size: outputSizeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const readbackBuffer = device.createBuffer({
    size: outputSizeBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const pipeline = format === 0 ? bc1Pipeline : bc3Pipeline;
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: { buffer: outputBuffer } },
    ],
  });

  const commandEncoder = device.createCommandEncoder();
  const pass = commandEncoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  const wgX = Math.ceil(blocksWide / 8);
  const wgY = Math.ceil(blocksHigh / 8);
  pass.dispatchWorkgroups(wgX, wgY, 1);
  pass.end();

  commandEncoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, outputSizeBytes);
  device.queue.submit([commandEncoder.finish()]);

  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(readbackBuffer.getMappedRange().slice(0));
  readbackBuffer.unmap();

  texture.destroy();
  paramsBuffer.destroy();
  outputBuffer.destroy();
  readbackBuffer.destroy();

  return result;
}

// ─── Full pipeline: mipmap gen + compress (single GPU submit) ──

interface FullPipelineResult {
  compressedData: Uint8Array;
  mipCount: number;
}

async function compressTextureFullPipeline(req: FullCompressRequest): Promise<FullPipelineResult> {
  if (!device || !bc1Pipeline || !bc3Pipeline || !downsamplePipeline) {
    throw new Error('WebGPU not initialized');
  }

  const { rgba, width, height, format } = req;
  const bytesPerBlock = format === 0 ? 8 : 16;

  // Compute mip chain
  const chain = computeMipChain(width, height, bytesPerBlock);
  const mipCount = chain.widths.length;

  // Track all GPU resources for cleanup
  const textures: GPUTexture[] = [];
  const buffers: GPUBuffer[] = [];

  try {
    // ─── Create base texture ──────────────────────────────
    const baseTex = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    textures.push(baseTex);

    device.queue.writeTexture(
      { texture: baseTex },
      rgba as Uint8Array<ArrayBuffer>,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height },
    );

    // ─── Create mip textures ──────────────────────────────
    // mipTextures[0] = baseTex, mipTextures[1..N] = downsampled
    const mipTextures: GPUTexture[] = [baseTex];

    for (let i = 1; i < mipCount; i++) {
      const tex = device.createTexture({
        size: { width: chain.widths[i], height: chain.heights[i] },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      textures.push(tex);
      mipTextures.push(tex);
    }

    // ─── Single submit: Downsample + Compress all mips ────

    // Storage buffer binding offsets must be aligned to 256 bytes (minStorageBufferOffsetAlignment).
    // Compute aligned offsets for each mip, then strip padding from readback.
    const ALIGN = 256;
    const alignedOffsets: number[] = [];
    let alignedTotal = 0;
    for (let i = 0; i < mipCount; i++) {
      if (i > 0) {
        alignedTotal = Math.ceil(alignedTotal / ALIGN) * ALIGN;
      }
      alignedOffsets.push(alignedTotal);
      alignedTotal += chain.sizes[i];
    }

    const outputBuf = device.createBuffer({
      size: alignedTotal,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    buffers.push(outputBuf);

    const readbackBuf = device.createBuffer({
      size: alignedTotal,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    buffers.push(readbackBuf);

    const enc = device.createCommandEncoder();

    // Downsample passes: generate mip levels 1..N
    for (let i = 1; i < mipCount; i++) {
      const srcW = chain.widths[i - 1];
      const srcH = chain.heights[i - 1];
      const dstW = chain.widths[i];
      const dstH = chain.heights[i];

      const uniformData = new Uint32Array([srcW, srcH]);
      const uniformBuf = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(uniformBuf, 0, uniformData);
      buffers.push(uniformBuf);

      const dsBindGroup = device.createBindGroup({
        layout: downsamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuf } },
          { binding: 1, resource: mipTextures[i - 1].createView() },
          { binding: 2, resource: mipTextures[i].createView() },
        ],
      });

      const pass = enc.beginComputePass();
      pass.setPipeline(downsamplePipeline);
      pass.setBindGroup(0, dsBindGroup);
      pass.dispatchWorkgroups(Math.ceil(dstW / 8), Math.ceil(dstH / 8), 1);
      pass.end();
    }

    // Compress passes: BC1 or BC3 for each mip level
    const bcPipeline = format === 1 ? bc3Pipeline : bc1Pipeline;

    for (let i = 0; i < mipCount; i++) {
      const mw = chain.widths[i];
      const mh = chain.heights[i];
      const blocksWide = Math.ceil(mw / 4);
      const blocksHigh = Math.ceil(mh / 4);

      const paramsData = new Uint32Array([mw, mh, blocksWide, format]);
      const paramsBuf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(paramsBuf, 0, paramsData);
      buffers.push(paramsBuf);

      const mipOutputSize = chain.sizes[i];
      const bcBindGroup = device.createBindGroup({
        layout: bcPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuf } },
          { binding: 1, resource: mipTextures[i].createView() },
          { binding: 2, resource: { buffer: outputBuf, offset: alignedOffsets[i], size: mipOutputSize } },
        ],
      });

      const pass = enc.beginComputePass();
      pass.setPipeline(bcPipeline);
      pass.setBindGroup(0, bcBindGroup);
      pass.dispatchWorkgroups(Math.ceil(blocksWide / 8), Math.ceil(blocksHigh / 8), 1);
      pass.end();
    }

    // Copy output to readback buffer
    enc.copyBufferToBuffer(outputBuf, 0, readbackBuf, 0, alignedTotal);
    device.queue.submit([enc.finish()]);

    // Map and read — strip alignment padding to produce dense mip data
    await readbackBuf.mapAsync(GPUMapMode.READ);
    const rawData = new Uint8Array(readbackBuf.getMappedRange());

    const compressedData = new Uint8Array(chain.totalSize);
    let writeOffset = 0;
    for (let i = 0; i < mipCount; i++) {
      compressedData.set(
        new Uint8Array(rawData.buffer, rawData.byteOffset + alignedOffsets[i], chain.sizes[i]),
        writeOffset,
      );
      writeOffset += chain.sizes[i];
    }
    readbackBuf.unmap();

    return { compressedData, mipCount };
  } finally {
    // Always clean up GPU resources
    for (const tex of textures) tex.destroy();
    for (const buf of buffers) buf.destroy();
  }
}

// ─── IPC Handlers ─────────────────────────────────────────

// Legacy single-mip handler (backward compatibility)
ipcRenderer.on('gpu-compress-request', async (_event: any, req: CompressRequest) => {
  try {
    const rgba = req.rgba instanceof Uint8Array ? req.rgba : new Uint8Array(req.rgba);
    const result = await compressTexture({ ...req, rgba });
    ipcRenderer.send('gpu-compress-response', { id: req.id, data: result });
  } catch (err: any) {
    ipcRenderer.send('gpu-compress-response', { id: req.id, error: err.message || String(err) });
  }
});

// Full pipeline handler (mipmap gen + compress in one round trip)
ipcRenderer.on('gpu-compress-full-request', async (_event: any, req: FullCompressRequest) => {
  try {
    const rgba = req.rgba instanceof Uint8Array ? req.rgba : new Uint8Array(req.rgba);
    const result = await compressTextureFullPipeline({ ...req, rgba });
    ipcRenderer.send('gpu-compress-full-response', {
      id: req.id,
      compressedData: result.compressedData,
      mipCount: result.mipCount,
    });
  } catch (err: any) {
    ipcRenderer.send('gpu-compress-full-response', { id: req.id, error: err.message || String(err) });
  }
});

// ─── Init ─────────────────────────────────────────────

(async () => {
  const ok = await initWebGPU();
  ipcRenderer.send('gpu-compress-ready', { available: ok });
})();
