import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectReadinessTracker } from '../bridge/object-readiness-tracker';

describe('ObjectReadinessTracker', () => {
  let send: ReturnType<typeof vi.fn>;
  let tracker: ObjectReadinessTracker;

  beforeEach(() => {
    send = vi.fn();
    tracker = new ObjectReadinessTracker(send);
  });

  describe('track & emit', () => {
    it('emits immediately for procedural prims (no mesh needed)', () => {
      const msg = { type: 'object_complete', uuid: 'obj-1' };
      tracker.track('obj-1', null, new Set(), msg);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(msg);
    });

    it('does not emit when mesh is pending', () => {
      tracker.track('obj-1', 'mesh-abc', new Set(), { type: 'object_complete' });
      expect(send).not.toHaveBeenCalled();
    });

    it('emits when pending mesh becomes ready', () => {
      const msg = { type: 'object_complete', uuid: 'obj-1' };
      tracker.track('obj-1', 'mesh-abc', new Set(), msg);
      expect(send).not.toHaveBeenCalled();

      tracker.onMeshReady('mesh-abc');
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(msg);
    });

    it('cleans up after emit (pendingCount decreases)', () => {
      tracker.track('obj-1', 'mesh-abc', new Set(), { type: 'object_complete' });
      expect(tracker.pendingCount).toBe(1);

      tracker.onMeshReady('mesh-abc');
      expect(tracker.pendingCount).toBe(0);
    });
  });

  describe('multiple objects waiting on same mesh', () => {
    it('emits for all objects when mesh becomes ready', () => {
      const msg1 = { type: 'object_complete', uuid: 'obj-1' };
      const msg2 = { type: 'object_complete', uuid: 'obj-2' };
      tracker.track('obj-1', 'mesh-shared', new Set(), msg1);
      tracker.track('obj-2', 'mesh-shared', new Set(), msg2);
      expect(tracker.pendingCount).toBe(2);

      tracker.onMeshReady('mesh-shared');
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledWith(msg1);
      expect(send).toHaveBeenCalledWith(msg2);
      expect(tracker.pendingCount).toBe(0);
    });
  });

  describe('onMeshFailed', () => {
    it('emits with meshId cleared', () => {
      const msg = { type: 'object_complete', uuid: 'obj-1', meshId: 'mesh-abc' } as any;
      tracker.track('obj-1', 'mesh-abc', new Set(), msg);

      tracker.onMeshFailed('mesh-abc');
      expect(send).toHaveBeenCalledOnce();
      expect(msg.meshId).toBeUndefined();
    });

    it('resolves all waiting objects', () => {
      tracker.track('obj-1', 'mesh-fail', new Set(), { uuid: 'obj-1', meshId: 'mesh-fail' });
      tracker.track('obj-2', 'mesh-fail', new Set(), { uuid: 'obj-2', meshId: 'mesh-fail' });

      tracker.onMeshFailed('mesh-fail');
      expect(send).toHaveBeenCalledTimes(2);
      expect(tracker.pendingCount).toBe(0);
    });
  });

  describe('remove', () => {
    it('removes a pending object', () => {
      tracker.track('obj-1', 'mesh-abc', new Set(), { uuid: 'obj-1' });
      expect(tracker.pendingCount).toBe(1);

      tracker.remove('obj-1');
      expect(tracker.pendingCount).toBe(0);
    });

    it('does not emit after removal', () => {
      tracker.track('obj-1', 'mesh-abc', new Set(), { uuid: 'obj-1' });
      tracker.remove('obj-1');

      tracker.onMeshReady('mesh-abc');
      expect(send).not.toHaveBeenCalled();
    });

    it('no-op for unknown uuid', () => {
      tracker.remove('nonexistent');
      expect(tracker.pendingCount).toBe(0);
    });

    it('cleans up mesh reverse index', () => {
      tracker.track('obj-1', 'mesh-abc', new Set(), { uuid: 'obj-1' });
      tracker.track('obj-2', 'mesh-abc', new Set(), { uuid: 'obj-2' });
      tracker.remove('obj-1');

      // Only obj-2 should emit
      tracker.onMeshReady('mesh-abc');
      expect(send).toHaveBeenCalledOnce();
    });
  });

  describe('re-tracking (object re-creation)', () => {
    it('replaces prior entry for same uuid', () => {
      const msg1 = { type: 'object_complete', version: 1 };
      const msg2 = { type: 'object_complete', version: 2 };
      tracker.track('obj-1', 'mesh-old', new Set(), msg1);
      tracker.track('obj-1', 'mesh-new', new Set(), msg2);

      expect(tracker.pendingCount).toBe(1);

      // Old mesh should not trigger emit
      tracker.onMeshReady('mesh-old');
      expect(send).not.toHaveBeenCalled();

      // New mesh should
      tracker.onMeshReady('mesh-new');
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(msg2);
    });
  });

  describe('clearAll', () => {
    it('removes all pending objects', () => {
      tracker.track('obj-1', 'mesh-a', new Set(), { uuid: 'obj-1' });
      tracker.track('obj-2', 'mesh-b', new Set(), { uuid: 'obj-2' });
      tracker.track('obj-3', null, new Set(), { uuid: 'obj-3' }); // emits immediately
      send.mockClear();

      tracker.clearAll();
      expect(tracker.pendingCount).toBe(0);

      // Nothing should emit after clear
      tracker.onMeshReady('mesh-a');
      tracker.onMeshReady('mesh-b');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('texture no-ops', () => {
    it('onTextureReady is a no-op', () => {
      tracker.track('obj-1', null, new Set(['tex-1']), { uuid: 'obj-1' });
      send.mockClear();
      tracker.onTextureReady('tex-1');
      // Should not emit again
      expect(send).not.toHaveBeenCalled();
    });

    it('onTextureFailed is a no-op', () => {
      tracker.onTextureFailed('tex-1');
      // Just verifying it doesn't throw
    });

    it('addTextures is a no-op', () => {
      tracker.addTextures('obj-1', new Set(['tex-1']));
      // Just verifying it doesn't throw
    });
  });

  describe('sweepTimeouts', () => {
    it('does not crash with no pending objects', () => {
      tracker.sweepTimeouts();
    });

    it('logs stale objects (does not remove them)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      tracker.track('obj-1', 'mesh-abc', new Set(), { uuid: 'obj-1' });

      // Wait a tick so Date.now() advances past createdAt
      await new Promise(r => setTimeout(r, 2));
      tracker.sweepTimeouts(1);
      expect(consoleSpy).toHaveBeenCalled();
      // Object is still pending
      expect(tracker.pendingCount).toBe(1);
      consoleSpy.mockRestore();
    });
  });
});
