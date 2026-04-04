import * as assert from 'assert';
import { RegionCommands } from './RegionCommands';
import { Vector3 } from '../Vector3';
import { UUID } from '../UUID';
import { ObjectGrabMessage } from '../messages/ObjectGrab';
import { ObjectDeGrabMessage } from '../messages/ObjectDeGrab';
import { ObjectGrabUpdateMessage } from '../messages/ObjectGrabUpdate';

// Minimal mocks — just enough to exercise the grab/touch/move code paths.

function createMockRegionCommands(objectPosition: Vector3 = new Vector3([10, 20, 30]))
{
    const sentMessages: any[] = [];
    const testObjectUuid = UUID.random();
    const testLocalId = 42;

    const mockObject = {
        ID: testLocalId,
        FullID: testObjectUuid,
        Position: objectPosition,
        ParentID: 0,
        get absolutePosition(): Vector3 { return objectPosition; },
    };

    const mockRegion = {
        objects: {
            getObjectByUUID: (_uuid: UUID) => mockObject,
            getObjectByLocalID: (_id: number) => mockObject,
        },
        circuit: {
            sessionID: UUID.random(),
            sendMessage: (msg: any, _flags: any): number =>
            {
                sentMessages.push(msg);
                return 1;
            },
            waitForAck: (_seqID: number, _timeout: number): Promise<void> =>
            {
                return Promise.resolve();
            },
        },
    };

    const mockAgent = {
        agentID: UUID.random(),
    };

    const cmds = new RegionCommands(mockRegion as any, mockAgent as any, {} as any);

    return { cmds, sentMessages, testLocalId, testObjectUuid };
}

function isZeroVector(v: Vector3): boolean
{
    return v.x === 0 && v.y === 0 && v.z === 0;
}

describe('RegionCommands touch vs move', () =>
{
    // ─── Touch methods must NEVER include position data ──────────────

    it('grabObject sends zero GrabOffset and zero SurfaceInfo.Position', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        await cmds.grabObject(testLocalId, 2);

        assert.strictEqual(sentMessages.length, 1);
        const msg: ObjectGrabMessage = sentMessages[0];
        assert.ok(msg instanceof ObjectGrabMessage);
        assert.ok(isZeroVector(msg.ObjectData.GrabOffset), 'GrabOffset must be zero');
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Position), 'SurfaceInfo.Position must be zero');
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Normal), 'SurfaceInfo.Normal must be zero');
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Binormal), 'SurfaceInfo.Binormal must be zero');
        assert.strictEqual(msg.SurfaceInfo[0].FaceIndex, 2);
    });

    it('deGrabObject sends zero SurfaceInfo.Position', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        await cmds.deGrabObject(testLocalId, 3);

        assert.strictEqual(sentMessages.length, 1);
        const msg: ObjectDeGrabMessage = sentMessages[0];
        assert.ok(msg instanceof ObjectDeGrabMessage);
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Position), 'SurfaceInfo.Position must be zero');
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Normal), 'SurfaceInfo.Normal must be zero');
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Binormal), 'SurfaceInfo.Binormal must be zero');
        assert.strictEqual(msg.SurfaceInfo[0].FaceIndex, 3);
    });

    it('dragGrabbedObject sends object current position as GrabPosition (no movement)', async () =>
    {
        const objPos = new Vector3([10, 20, 30]);
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands(objPos);
        await cmds.dragGrabbedObject(testLocalId, 1);

        assert.strictEqual(sentMessages.length, 1);
        const msg: ObjectGrabUpdateMessage = sentMessages[0];
        assert.ok(msg instanceof ObjectGrabUpdateMessage);
        assert.ok(isZeroVector(msg.ObjectData.GrabOffsetInitial), 'GrabOffsetInitial must be zero');
        assert.strictEqual(msg.ObjectData.GrabPosition.x, objPos.x);
        assert.strictEqual(msg.ObjectData.GrabPosition.y, objPos.y);
        assert.strictEqual(msg.ObjectData.GrabPosition.z, objPos.z);
        assert.ok(isZeroVector(msg.SurfaceInfo[0].Position), 'SurfaceInfo.Position must be zero');
    });

    it('touchObject sends zero positions on both grab and degrab', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        await cmds.touchObject(testLocalId, 5);

        assert.strictEqual(sentMessages.length, 2);

        const grab: ObjectGrabMessage = sentMessages[0];
        assert.ok(grab instanceof ObjectGrabMessage);
        assert.ok(isZeroVector(grab.ObjectData.GrabOffset), 'grab GrabOffset must be zero');
        assert.ok(isZeroVector(grab.SurfaceInfo[0].Position), 'grab Position must be zero');
        assert.strictEqual(grab.SurfaceInfo[0].FaceIndex, 5);

        const degrab: ObjectDeGrabMessage = sentMessages[1];
        assert.ok(degrab instanceof ObjectDeGrabMessage);
        assert.ok(isZeroVector(degrab.SurfaceInfo[0].Position), 'degrab Position must be zero');
        assert.strictEqual(degrab.SurfaceInfo[0].FaceIndex, 5);
    });

    it('grabObject accepts UUID and resolves to localID', async () =>
    {
        const { cmds, sentMessages, testObjectUuid, testLocalId } = createMockRegionCommands();
        await cmds.grabObject(testObjectUuid);

        const msg: ObjectGrabMessage = sentMessages[0];
        assert.strictEqual(msg.ObjectData.LocalID, testLocalId);
        assert.ok(isZeroVector(msg.ObjectData.GrabOffset));
    });

    it('grabObject works with just localID or localID + faceIndex', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        await cmds.grabObject(testLocalId);
        await cmds.grabObject(testLocalId, 3);
        assert.strictEqual(sentMessages.length, 2);
        assert.strictEqual((sentMessages[0] as ObjectGrabMessage).SurfaceInfo[0].FaceIndex, 0);
        assert.strictEqual((sentMessages[1] as ObjectGrabMessage).SurfaceInfo[0].FaceIndex, 3);
    });

    // ─── Move methods MUST include position data ─────────────────────

    it('moveGrabStart sends the provided grabOffset', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        const offset = new Vector3([1.5, 2.5, 3.5]);
        await cmds.moveGrabStart(testLocalId, offset, 0);

        assert.strictEqual(sentMessages.length, 1);
        const msg: ObjectGrabMessage = sentMessages[0];
        assert.ok(msg instanceof ObjectGrabMessage);
        assert.strictEqual(msg.ObjectData.GrabOffset.x, 1.5);
        assert.strictEqual(msg.ObjectData.GrabOffset.y, 2.5);
        assert.strictEqual(msg.ObjectData.GrabOffset.z, 3.5);
    });

    it('moveGrabUpdate sends the provided grabPosition', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        const target = new Vector3([100, 200, 50]);
        await cmds.moveGrabUpdate(testLocalId, target);

        assert.strictEqual(sentMessages.length, 1);
        const msg: ObjectGrabUpdateMessage = sentMessages[0];
        assert.ok(msg instanceof ObjectGrabUpdateMessage);
        assert.strictEqual(msg.ObjectData.GrabPosition.x, 100);
        assert.strictEqual(msg.ObjectData.GrabPosition.y, 200);
        assert.strictEqual(msg.ObjectData.GrabPosition.z, 50);
    });

    it('moveGrabEnd sends a deGrab message', async () =>
    {
        const { cmds, sentMessages, testLocalId } = createMockRegionCommands();
        await cmds.moveGrabEnd(testLocalId);

        assert.strictEqual(sentMessages.length, 1);
        const msg: ObjectDeGrabMessage = sentMessages[0];
        assert.ok(msg instanceof ObjectDeGrabMessage);
    });
});
