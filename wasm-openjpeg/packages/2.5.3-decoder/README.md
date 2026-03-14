## @abasb75/jpeg2000-decoder (only decoder)
JS/WebAssembly build of [OpenJPEG](https://github.com/uclouvain/openjpeg)

## Description
`OpenJPEG` support most of `OpenJPEG2000` decoding or encoding.

## Using generated Javascript File:
1. install From `npm`:

```bash
npm i --save @abasb75/jpeg2000-decoder@2.5.2-decoder
```

2. import `@abasb75/jpeg2000-decoder`:

```js
import OpenJPEG from '@abasb75/jpeg2000-decoder'

...
let decoder,encoder;
OpenJPEGWASM().then(function(openjpegjs) {
    decoder = new openjpegjs.J2KDecoder();
});
...

```

# Decode

```javascript

import {decode} from "@abasb75/jpeg2000-decoder";

const decoded = await decode(arrayBuffer); // ArrayBuffer


```

For see example you can use <a href="https://github.com/abasb75/openjpeg/blob/master/test/browser/index.html">this link</a>