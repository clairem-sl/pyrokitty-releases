import OpenJPEGWASM from "./index"
import { DecodeOptions, DecodedOpenJPEG } from "./types";

let openjpegjs:any;

async function decode(imageBuffer:ArrayBuffer,options:DecodeOptions={}):Promise<DecodedOpenJPEG>{

    if(!openjpegjs){
      openjpegjs = await OpenJPEGWASM()
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

export default decode;