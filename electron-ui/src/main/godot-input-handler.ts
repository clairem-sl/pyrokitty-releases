/**
 * Handles input from Godot (movement, object interaction).
 */

import type { Bot } from '../../node-metaverse/dist/lib';
import { ControlFlags, PacketFlags } from '../../node-metaverse/dist/lib';
import { ObjectSelectMessage } from '../../node-metaverse/dist/lib/classes/messages/ObjectSelect';
import { ObjectDeselectMessage } from '../../node-metaverse/dist/lib/classes/messages/ObjectDeselect';
import { SetAlwaysRunMessage } from '../../node-metaverse/dist/lib/classes/messages/SetAlwaysRun';
import type { SendFn } from './godot-bridge-types';

const CLICK_ACTION_SIT = 1;

export class GodotInputHandler {
  private _dbgMoving = false;
  private _dbgAgentNullAt = 0;
  private _lastRunning = false;
  private _sittingOnLocalId = 0;

  constructor(private bot: Bot, private send: SendFn) {}

  handleInputMove(msg: any): void {
    const agent = this.bot.agent;
    if (!agent) {
      const now = Date.now();
      if (this._dbgAgentNullAt === 0) this._dbgAgentNullAt = now;
      if (now - this._dbgAgentNullAt < 1100) {
        console.warn(`[GodotBridge] input_move dropped — bot.agent is null (no circuit?)`);
      }
      return;
    }
    if (this._dbgAgentNullAt !== 0) {
      console.log(`[GodotBridge] bot.agent restored after ${((Date.now() - this._dbgAgentNullAt) / 1000).toFixed(1)}s`);
      this._dbgAgentNullAt = 0;
    }

    const isMoving = msg.forward || msg.backward || msg.strafe_left || msg.strafe_right
      || msg.jump || msg.crouch;
    if (isMoving && !this._dbgMoving) {
      console.log(`[GodotBridge] Movement started fwd=${msg.forward} back=${msg.backward} sl=${msg.strafe_left} sr=${msg.strafe_right}`);
      this._dbgMoving = true;
    } else if (!isMoving && this._dbgMoving) {
      console.log(`[GodotBridge] Movement stopped`);
      this._dbgMoving = false;
    }

    // Forward/backward — always pair with FAST_AT (matching Firestorm llagent.cpp:774)
    if (msg.forward) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_AT_POS | ControlFlags.AGENT_CONTROL_FAST_AT);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
    }
    if (msg.backward) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_AT_NEG | ControlFlags.AGENT_CONTROL_FAST_AT);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_AT_NEG);
    }
    if (msg.jump) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
    }
    if (msg.crouch) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
    }

    // Strafe
    if (msg.strafe_left) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_LEFT_POS);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_LEFT_POS);
    }
    if (msg.strafe_right) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_LEFT_NEG);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_LEFT_NEG);
    }

    // Run — send SetAlwaysRun on change
    const running = !!msg.running;
    if (!msg.forward && !msg.backward) {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_FAST_AT);
    }
    if (running !== this._lastRunning) {
      console.log(`[GodotBridge] Running changed: ${running} — sending SetAlwaysRun`);
      this._lastRunning = running;
      const runMsg = new SetAlwaysRunMessage();
      runMsg.AgentData = {
        AgentID: this.bot.agent.agentID,
        SessionID: this.bot.currentRegion!.circuit.sessionID,
        AlwaysRun: running,
      };
      this.bot.currentRegion!.circuit.sendMessage(runMsg, PacketFlags.Reliable);
    }

    // Fly toggle
    if (typeof msg.fly === 'boolean') {
      if (msg.fly) {
        agent.setControlFlag(ControlFlags.AGENT_CONTROL_FLY);
      } else {
        agent.clearControlFlag(ControlFlags.AGENT_CONTROL_FLY);
      }
    }

    // Set body rotation from camera yaw
    if (typeof msg.yaw === 'number') {
      const slHeading = msg.yaw + Math.PI / 2;
      const halfAngle = slHeading / 2;
      let qz = Math.sin(halfAngle);
      let qw = Math.cos(halfAngle);
      if (qw < 0) { qz = -qz; qw = -qw; }
      (agent as any).bodyRotation.x = 0;
      (agent as any).bodyRotation.y = 0;
      (agent as any).bodyRotation.z = qz;
      (agent as any).bodyRotation.w = qw;
    }

    agent.sendAgentUpdate();
  }

  async handleRequestObjectProperties(localId: number): Promise<void> {
    try {
      const region = this.bot.currentRegion;
      if (!region) return;
      const obj = region.objects?.getObjectByLocalID(localId);
      if (!obj) {
        this.send({ type: 'object_properties', localId, name: '', description: '' });
        return;
      }

      if (obj.resolvedAt) {
        this.send({ type: 'object_properties', localId, name: obj.name || '', description: obj.description || '' });
        return;
      }

      // Send ObjectSelect to request properties from server
      const selectMsg = new ObjectSelectMessage();
      selectMsg.AgentData = {
        AgentID: region.agent.agentID,
        SessionID: region.circuit.sessionID,
      };
      selectMsg.ObjectData = [{ ObjectLocalID: localId }];
      region.circuit.sendMessage(selectMsg, PacketFlags.Reliable);

      // Poll for properties
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (obj.resolvedAt || obj.name !== undefined) break;
      }

      // Deselect
      const deselectMsg = new ObjectDeselectMessage();
      deselectMsg.AgentData = {
        AgentID: region.agent.agentID,
        SessionID: region.circuit.sessionID,
      };
      deselectMsg.ObjectData = [{ ObjectLocalID: localId }];
      region.circuit.sendMessage(deselectMsg, PacketFlags.Reliable);

      this.send({ type: 'object_properties', localId, name: obj.name || '', description: obj.description || '' });
    } catch (e) {
      console.error(`[GodotBridge] request_object_properties failed for ${localId}:`, e);
      this.send({ type: 'object_properties', localId, name: '', description: '' });
    }
  }

  async handleSetObjectName(localId: number, name: string): Promise<void> {
    try {
      const obj = this.bot.currentRegion?.objects?.getObjectByLocalID(localId);
      if (!obj) {
        console.warn(`[GodotBridge] set_object_name: object ${localId} not found`);
        return;
      }
      await obj.setName(name);
      console.log(`[GodotBridge] Renamed object ${localId} to "${name}"`);
    } catch (e) {
      console.error(`[GodotBridge] set_object_name failed for ${localId}:`, e);
    }
  }

  async handleSetObjectDescription(localId: number, description: string): Promise<void> {
    try {
      const obj = this.bot.currentRegion?.objects?.getObjectByLocalID(localId);
      if (!obj) {
        console.warn(`[GodotBridge] set_object_description: object ${localId} not found`);
        return;
      }
      await obj.setDescription(description);
      console.log(`[GodotBridge] Set description on object ${localId}`);
    } catch (e) {
      console.error(`[GodotBridge] set_object_description failed for ${localId}:`, e);
    }
  }

  handleStandUp(): void {
    this.bot.clientCommands.movement.stand();
    this._sittingOnLocalId = 0;
    this.send({ type: 'sitting_state', sitting: false });
    console.log('[GodotBridge] Stood up');
  }

  /** Called by GodotBridge when server confirms a ParentID change on the self avatar. */
  setSittingState(sitting: boolean, seatLocalId: number): void {
    this._sittingOnLocalId = sitting ? seatLocalId : 0;
  }

  async handleObjectTouch(msg: any): Promise<void> {
    try {
      const region = this.bot.currentRegion;
      if (!region) return;
      const localId: number = msg.localId;
      const obj = region.objects?.getObjectByLocalID(localId);
      if (!obj) {
        console.warn(`[GodotBridge] object_touch: object ${localId} not found`);
        return;
      }

      // If the object's default action is SIT and we're not already sitting on it, sit.
      if (obj.ClickAction === CLICK_ACTION_SIT && this._sittingOnLocalId !== localId) {
        const { UUID } = await import('../../node-metaverse/lib/classes/UUID');
        const { Vector3 } = await import('../../node-metaverse/lib/classes/Vector3');
        const targetUuid = new UUID(obj.FullID.toString());
        await this.bot.clientCommands.movement.sitOnObject(targetUuid, Vector3.getZero());
        this._sittingOnLocalId = localId;
        console.log(`[GodotBridge] Sat on object ${localId} (ClickAction=Sit)`);
        return;
      }

      const { Vector3 } = await import('../../node-metaverse/lib/classes/Vector3');
      const pos = msg.position || {};
      const norm = msg.normal || {};
      const st = msg.st || {};
      const faceIndex: number = msg.faceIndex || 0;
      const position = new Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
      const normal = new Vector3(norm.x || 0, norm.y || 0, norm.z || 0);
      const stCoord = new Vector3(st.x || 0, st.y || 0, 0);
      const uvCoord = new Vector3(st.x || 0, st.y || 0, 0);
      const grabOffset = new Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
      const binormal = Vector3.getZero();
      await this.bot.clientCommands.region.touchObject(
        localId, grabOffset, uvCoord, stCoord, faceIndex, position, normal, binormal
      );
      console.log(`[GodotBridge] Touched object ${localId} face=${faceIndex} st=(${st.x?.toFixed(2)},${st.y?.toFixed(2)})`);
    } catch (e) {
      console.error(`[GodotBridge] object_touch failed for ${msg.localId}:`, e);
    }
  }
}
