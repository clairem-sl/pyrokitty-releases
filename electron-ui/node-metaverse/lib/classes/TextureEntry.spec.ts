import { describe, it, assert } from 'vitest';
import { TextureEntry } from './TextureEntry';
import { TextureEntryFace } from './TextureEntryFace';
import { UUID } from './UUID';
import { Color4 } from './Color4';
import { MappingType } from '../enums/MappingType';

describe('TextureEntry', () =>
{
    /** Helper: build a minimal TextureEntry with a default face */
    function makeEntry(): TextureEntry
    {
        const te = new TextureEntry();
        te.defaultTexture = new TextureEntryFace(null);
        te.defaultTexture.textureID = new UUID('89556747-24cb-43ed-920b-47caed15465f');
        te.defaultTexture.rgba = new Color4(1, 1, 1, 1);
        te.defaultTexture.repeatU = 1;
        te.defaultTexture.repeatV = 1;
        te.defaultTexture.offsetU = 0;
        te.defaultTexture.offsetV = 0;
        te.defaultTexture.rotation = 0;
        te.defaultTexture.material = 0;
        te.defaultTexture.media = 0;
        te.defaultTexture.glow = 0;
        te.defaultTexture.materialID = UUID.zero();
        return te;
    }

    /** Helper: add a face with a specific media byte */
    function addFace(te: TextureEntry, faceIndex: number, media: number): void
    {
        while (te.faces.length <= faceIndex)
        {
            te.faces.push(new TextureEntryFace(te.defaultTexture));
        }
        // Set the same texture/color as default so only media differs
        te.faces[faceIndex].textureID = te.defaultTexture!.textureID;
        te.faces[faceIndex].rgba = te.defaultTexture!.rgba;
        te.faces[faceIndex].repeatU = te.defaultTexture!.repeatU;
        te.faces[faceIndex].repeatV = te.defaultTexture!.repeatV;
        te.faces[faceIndex].offsetU = te.defaultTexture!.offsetU;
        te.faces[faceIndex].offsetV = te.defaultTexture!.offsetV;
        te.faces[faceIndex].rotation = te.defaultTexture!.rotation;
        te.faces[faceIndex].material = te.defaultTexture!.material;
        te.faces[faceIndex].media = media;
        te.faces[faceIndex].glow = te.defaultTexture!.glow;
        te.faces[faceIndex].materialID = te.defaultTexture!.materialID;
    }

    describe('per-face mappingType', () =>
    {
        it('should set mappingType directly on face via media setter', () =>
        {
            const face = new TextureEntryFace(null);
            face.media = MappingType.Planar;
            assert.equal(face.mappingType, MappingType.Planar,
                'mappingType should be planar after setting media=2');
        });

        it('should decode planar mapping on face 0 via roundtrip', () =>
        {
            const te = makeEntry();
            addFace(te, 0, MappingType.Planar); // media byte = 2

            // Verify pre-serialize state
            assert.equal(te.faces[0].media, MappingType.Planar, 'face media should be 2 before serialize');
            assert.equal(te.faces[0].mappingType, MappingType.Planar, 'face mappingType should be planar before serialize');

            const buf = te.toBuffer();
            const parsed = TextureEntry.from(buf);

            assert.equal(parsed.faces.length > 0, true, 'should have parsed faces');
            if (parsed.faces[0]) {
                assert.equal(parsed.faces[0].media, MappingType.Planar, 'parsed media should be 2');
            }
            assert.equal(parsed.faces[0].mappingType, MappingType.Planar,
                'face 0 should be planar');
            assert.equal(parsed.defaultTexture!.mappingType, MappingType.Default,
                'default should remain default');
        });

        it('should decode spherical mapping on face 2 via roundtrip', () =>
        {
            const te = makeEntry();
            addFace(te, 0, MappingType.Default);
            addFace(te, 1, MappingType.Default);
            addFace(te, 2, MappingType.Spherical); // media byte = 4

            const buf = te.toBuffer();
            const parsed = TextureEntry.from(buf);

            assert.equal(parsed.faces[2].mappingType, MappingType.Spherical,
                'face 2 should be spherical');
            assert.equal(parsed.faces[0].mappingType, MappingType.Default,
                'face 0 should be default');
        });

        it('should decode mixed mapping types across faces', () =>
        {
            const te = makeEntry();
            addFace(te, 0, MappingType.Planar);
            addFace(te, 1, MappingType.Default);
            addFace(te, 2, MappingType.Spherical);
            addFace(te, 3, MappingType.Planar);

            const buf = te.toBuffer();
            const parsed = TextureEntry.from(buf);

            assert.equal(parsed.faces[0].mappingType, MappingType.Planar);
            assert.equal(parsed.faces[1].mappingType, MappingType.Default);
            assert.equal(parsed.faces[2].mappingType, MappingType.Spherical);
            assert.equal(parsed.faces[3].mappingType, MappingType.Planar);
        });
    });

    describe('per-face fullBright', () =>
    {
        it('should decode fullBright on face 0 when default is not fullBright', () =>
        {
            const te = makeEntry();
            addFace(te, 0, MappingType.Default);
            te.faces[0].material = 0x20; // fullBright bit set

            const buf = te.toBuffer();
            const parsed = TextureEntry.from(buf);

            assert.equal((parsed.faces[0].material & TextureEntryFace.FULLBRIGHT_MASK) !== 0, true,
                'face 0 should be fullBright');
            assert.equal((parsed.defaultTexture!.material & TextureEntryFace.FULLBRIGHT_MASK) !== 0, false,
                'default should not be fullBright');
        });
    });

    describe('from() with real-world buffer', () =>
    {
        it('should parse the TextureEntryTest hex buffer without error', () =>
        {
            const buf = Buffer.from(
                'CAD82CAD56668BF13CAC8CDAB40DD20C00000000000000000040000000004000' +
                '0000000000000000000000000000006FB900FB728A247A72B75BC55CD5257A00',
                'hex');
            const parsed = TextureEntry.from(buf);

            assert.ok(parsed.defaultTexture, 'should have a default texture');
            assert.ok(parsed.defaultTexture!.textureID, 'default should have a textureID');
        });
    });
});
