// @ts-ignore
import OpenJPEGWASM from "./openjpegjs.js"
import { DecodeOptions, EncodeOptions, DecodedOpenJPEG, FrameInfo } from "./types";

let openjpegjs:any;

async function decode(imageBuffer:ArrayBuffer,options:DecodeOptions={}):Promise<DecodedOpenJPEG>{

    if(!openjpegjs){
      openjpegjs = await OpenJPEGWASM();
      console.log({openjpegjs});
    }

    const iterations = options.iterations || 1;
    const decodeLevel = options.decodeLevel || 0;
    const decodeLayer = options.decodeLayer || 0;

    const decoder = new openjpegjs.J2KDecoder();
    const buffer = new Uint8Array(imageBuffer);

    const encodedBuffer = decoder.getEncodedBuffer(buffer.length);
    encodedBuffer.set(buffer);

    for(let i=0; i < iterations; i++) {
      decoder.decodeSubResolution(decodeLevel, decodeLayer);
    }

    const resolutionAtLevel = decoder.calculateSizeAtDecompositionLevel(decodeLevel);

    const maxDecodeLevel = decoder.getNumDecompositions();
    const maxDecodeLayer = decoder.getNumLayers();

    const frameInfo = decoder.getFrameInfo();
    const imageOffset = decoder.getImageOffset();
    const numberOfDecompositions = decoder.getNumDecompositions();
    const progressionOrder = decoder.getProgressionOrder();
    const isReversible = decoder.getIsReversible();
    const blockDimensions = decoder.getBlockDimensions();
    const tileSize = decoder.getTileSize();
    const tileOffset = decoder.getTileOffset();

    const colorSpace = decoder.getColorSpace();

    var decodedBuffer = decoder.getDecodedBuffer();
   
    let subResolutions = '';
    for(let i=0; i < decoder.getNumDecompositions() + 1; i++) {
      const resolution = decoder.calculateSizeAtDecompositionLevel(i);
      subResolutions += resolution.width + 'x' + resolution.height + ' ';
    }

    frameInfo.width = resolutionAtLevel.width;
    frameInfo.height = resolutionAtLevel.height;    
    
    return {
        frameInfo,
        decodedBuffer,
        colorSpace,
        maxDecodeLevel,
        maxDecodeLayer,
        imageOffset,
        numberOfDecompositions,
        blockDimensions,
        progressionOrder,
        isReversible,
        tileSize,
        tileOffset, 
        resolutionAtLevel,
    }

}

async function encode(
  pixelData: Uint8Array,
  frameInfo: FrameInfo,
  options: EncodeOptions = {}
): Promise<Uint8Array> {
  if (!openjpegjs) {
    openjpegjs = await OpenJPEGWASM();
  }

  const encoder = new openjpegjs.J2KEncoder();
  try {
    const decodedBuffer = encoder.getDecodedBuffer({
      width: frameInfo.width,
      height: frameInfo.height,
      bitsPerSample: frameInfo.bitsPerSample,
      componentCount: frameInfo.componentCount,
      isSigned: frameInfo.isSigned,
    });
    decodedBuffer.set(pixelData);

    const decompositions = options.decompositions ?? 5;
    const lossless = options.lossless ?? false;
    const progressionOrder = options.progressionOrder ?? 2; // RPCL

    encoder.setDecompositions(decompositions);
    if (lossless) {
      encoder.setQuality(true, 1);
      encoder.setCompressionRatio(0, 0);
    } else {
      encoder.setQuality(false, 1);
      encoder.setCompressionRatio(0, options.compressionRatio ?? 1);
    }
    encoder.setProgressionOrder(progressionOrder);

    encoder.encode();

    const encoded = encoder.getEncodedBuffer();
    return new Uint8Array(encoded); // copy out of WASM heap
  } finally {
    encoder.delete();
  }
}

export default {
  decode,
  encode,
  OpenJPEGWASM
};