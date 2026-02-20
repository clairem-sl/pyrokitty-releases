import type Long from 'long';

export interface EnableSimulatorEvent {
    regionHandle: Long;
    ipAddress: string;
    port: number;
}
