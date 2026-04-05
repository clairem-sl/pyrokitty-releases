import { GameObject } from './GameObject';
import { Vector3 } from '../Vector3';
import { Quaternion } from '../Quaternion';
import * as assert from 'assert';

/** Create a GameObject with the given localID, position, rotation, and optional parentID. */
function makeObj(localID: number, pos: number[], rot?: number[], parentID?: number): GameObject
{
    const obj = new GameObject();
    obj.ID = localID;
    obj.Position = new Vector3(pos);
    if (rot)
    {
        obj.Rotation = new Quaternion(rot);
    }
    if (parentID !== undefined)
    {
        obj.ParentID = parentID;
    }
    return obj;
}

/** Wire up a fake region.objects store so absolutePosition can walk the parent chain. */
function wireRegion(objects: GameObject[]): void
{
    const byLocalID = new Map<number, GameObject>();
    for (const obj of objects)
    {
        byLocalID.set(obj.ID, obj);
    }
    const fakeRegion = {
        objects: {
            getObjectByLocalID: (id: number) =>
            {
                const o = byLocalID.get(id);
                if (!o) throw new Error(`No object with localID ${id}`);
                return o;
            }
        }
    };
    for (const obj of objects)
    {
        (obj as any).region = fakeRegion;
    }
}

describe('GameObject.absolutePosition', () =>
{
    it('returns Position directly for a root prim (no parent)', () =>
    {
        const root = makeObj(1, [128, 128, 40]);
        wireRegion([root]);

        const abs = root.absolutePosition;
        assert.notEqual(abs, null);
        assert.equal(abs!.x, 128);
        assert.equal(abs!.y, 128);
        assert.equal(abs!.z, 40);
    });

    it('returns null when Position is missing', () =>
    {
        const obj = new GameObject();
        obj.Position = undefined as any;
        wireRegion([obj]);

        assert.equal(obj.absolutePosition, null);
    });

    it('computes absolute position for an unrotated child prim', () =>
    {
        const root = makeObj(1, [100, 100, 50]);
        const child = makeObj(2, [1, 2, 3], undefined, 1);
        wireRegion([root, child]);

        const abs = child.absolutePosition;
        assert.notEqual(abs, null);
        assertClose(abs!.x, 101);
        assertClose(abs!.y, 102);
        assertClose(abs!.z, 53);
    });

    it('applies parent rotation to child offset', () =>
    {
        // 90 degrees around Z axis: (x,y,z) -> (-y,x,z)
        const halfSqrt2 = Math.SQRT1_2;
        const root = makeObj(1, [100, 100, 50], [0, 0, halfSqrt2, halfSqrt2]);
        const child = makeObj(2, [1, 0, 0], undefined, 1);
        wireRegion([root, child]);

        const abs = child.absolutePosition;
        assert.notEqual(abs, null);
        // Child at (1,0,0) rotated 90° around Z → (0,1,0)
        assertClose(abs!.x, 100);
        assertClose(abs!.y, 101);
        assertClose(abs!.z, 50);
    });

    it('walks a grandparent chain', () =>
    {
        const root = makeObj(1, [100, 100, 50]);
        const child = makeObj(2, [10, 0, 0], undefined, 1);
        const grandchild = makeObj(3, [0, 5, 0], undefined, 2);
        wireRegion([root, child, grandchild]);

        const abs = grandchild.absolutePosition;
        assert.notEqual(abs, null);
        assertClose(abs!.x, 110);
        assertClose(abs!.y, 105);
        assertClose(abs!.z, 50);
    });

    it('returns null when parent is missing from object store', () =>
    {
        const child = makeObj(2, [1, 2, 3], undefined, 999);
        wireRegion([child]);

        assert.equal(child.absolutePosition, null);
    });

    it('handles identity rotation correctly', () =>
    {
        const root = makeObj(1, [50, 60, 70], [0, 0, 0, 1]);
        const child = makeObj(2, [5, 5, 5], undefined, 1);
        wireRegion([root, child]);

        const abs = child.absolutePosition;
        assert.notEqual(abs, null);
        assertClose(abs!.x, 55);
        assertClose(abs!.y, 65);
        assertClose(abs!.z, 75);
    });

    it('handles 180° rotation', () =>
    {
        // 180° around Z: (x,y,z) -> (-x,-y,z)
        const root = makeObj(1, [128, 128, 50], [0, 0, 1, 0]);
        const child = makeObj(2, [3, 0, 0], undefined, 1);
        wireRegion([root, child]);

        const abs = child.absolutePosition;
        assert.notEqual(abs, null);
        assertClose(abs!.x, 125);
        assertClose(abs!.y, 128);
        assertClose(abs!.z, 50);
    });
});

function assertClose(actual: number, expected: number, epsilon = 0.0001): void
{
    assert.ok(
        Math.abs(actual - expected) < epsilon,
        `Expected ${expected}, got ${actual} (diff ${Math.abs(actual - expected)})`
    );
}
