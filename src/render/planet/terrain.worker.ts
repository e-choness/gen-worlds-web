// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/// <reference lib="webworker" />
/**
 * Terrain worker: turns chunk requests into vertex buffers and transfers them back (zero copy).
 * Keeps a small cache of TerrainField instances keyed by body id (their noise tables are the only
 * expensive state).
 */
import type { HeightmapData } from '@/universe/heightmap';
import { TerrainField } from '@/universe/terrain-field';
import type { TerrainDesc } from '@/universe/types';
import { buildChunk, type ChunkAddress, type ChunkData } from './chunk-builder';

export interface ChunkRequest {
  requestId: number;
  bodyId: string;
  terrain: TerrainDesc;
  radius: number;
  hasOcean: boolean;
  address: ChunkAddress;
}

/** Sent once per real body, before any chunk request for it. */
export interface HeightmapMessage {
  heightmapFor: string;
  heightmap: HeightmapData;
}

export interface ChunkResponse {
  requestId: number;
  data: ChunkData;
}

const fields = new Map<string, TerrainField>();
const MAX_FIELDS = 4;
const heightmaps = new Map<string, HeightmapData>();

function fieldFor(req: ChunkRequest): TerrainField {
  let field = fields.get(req.bodyId);
  if (!field) {
    if (fields.size >= MAX_FIELDS) fields.delete(fields.keys().next().value as string);
    field = new TerrainField(req.terrain, req.radius, heightmaps.get(req.bodyId) ?? null);
    fields.set(req.bodyId, field);
  }
  return field;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ChunkRequest | HeightmapMessage>) => {
  if ('heightmapFor' in event.data) {
    heightmaps.set(event.data.heightmapFor, event.data.heightmap);
    fields.delete(event.data.heightmapFor);
    return;
  }
  const req = event.data;
  const data = buildChunk(fieldFor(req), req.address, req.hasOcean);
  const transfer: Transferable[] = [data.positions.buffer, data.normals.buffer, data.surface.buffer];
  if (data.water)
    transfer.push(data.water.positions.buffer, data.water.normals.buffer, data.water.depth.buffer);
  const response: ChunkResponse = { requestId: req.requestId, data };
  scope.postMessage(response, transfer);
};
