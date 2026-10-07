import React, { useRef, useState } from 'react';
import type { RemoteParticipant } from '../hooks/useRoomCall';
import { VideoTile } from './CallPanel';

type Size = 'S' | 'M' | 'L';
const WIDTHS: Record<Size, number> = { S: 96, M: 160, L: 240 };
const NEXT: Record<Size, Size> = { S: 'M', M: 'L', L: 'S' };

interface Pos {x: number;y: number;}

interface FloatingCallOverlayProps {
  localStream: MediaStream | null;
  participants: RemoteParticipant[];
  username: string;
  muted: boolean;
  cameraOff: boolean;
}

/**
 * Call tiles floating on top of the movie. Each tile can be dragged anywhere inside the player
 * and resized (S/M/L). "Hide" only makes the tiles invisible — the media elements stay mounted so
 * you keep hearing everyone.
 * Render this INSIDE the player's `relative` container (it positions itself with absolute inset-0).
 */
export function FloatingCallOverlay({ localStream, participants, username, muted, cameraOff }: FloatingCallOverlayProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const drag = useRef<{id: string;dx: number;dy: number;} | null>(null);

  const tiles = [
  { id: 'self', stream: localStream, label: username, isSelf: true, muted, cameraOff, state: undefined as string | undefined },
  ...participants.map((p) => ({
    id: p.userId, stream: p.stream, label: p.username, isSelf: false,
    muted: p.muted, cameraOff: p.cameraOff, state: p.connectionState as string | undefined
  }))];


  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const layer = layerRef.current;
    if (!layer || (e.target as HTMLElement).closest('button')) return;
    const tileRect = e.currentTarget.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, dx: e.clientX - tileRect.left, dy: e.clientY - tileRect.top };
    // Lock the current spot as explicit coordinates so dragging starts from where it is.
    setPositions((prev) => prev[id] ? prev : { ...prev, [id]: { x: tileRect.left - layerRect.left, y: tileRect.top - layerRect.top } });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    const d = drag.current;
    if (!layer || !d) return;
    const layerRect = layer.getBoundingClientRect();
    const tile = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - layerRect.left - d.dx), Math.max(0, layerRect.width - tile.width));
    const y = Math.min(Math.max(0, e.clientY - layerRect.top - d.dy), Math.max(0, layerRect.height - tile.height));
    setPositions((prev) => ({ ...prev, [d.id]: { x, y } }));
  };

  const endDrag = () => {
    drag.current = null;
  };

  let stackIndex = 0;
  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <button
        type="button"
        onClick={() => setHidden((h) => !h)}
        className="pointer-events-auto absolute left-2 top-2 z-30 rounded-full bg-black/60 px-3 py-1 text-[0.65rem] font-semibold text-white/90 backdrop-blur hover:bg-black/80">
        
        {hidden ? 'Show call' : 'Hide call'}
      </button>

      {tiles.map((t) => {
        const size = sizes[t.id] ?? (t.isSelf ? 'S' : 'M');
        const width = WIDTHS[size];
        const pos = positions[t.id];
        const style: React.CSSProperties = {
          width,
          maxWidth: '45%',
          touchAction: 'none',
          ...(pos ?
          { left: pos.x, top: pos.y } :
          { right: 8, top: 40 + stackIndex * (Math.round(width * 9 / 16) + 8) })
        };
        if (!pos) stackIndex += 1;
        return (
          <div
            key={t.id}
            style={style}
            onPointerDown={(e) => onPointerDown(e, t.id)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`group/tile absolute cursor-grab select-none rounded-xl shadow-lg ring-1 ring-white/20 active:cursor-grabbing ${
            hidden ? 'invisible pointer-events-none' : 'pointer-events-auto'}`
            }>
            
            <VideoTile
              stream={t.stream}
              label={t.label}
              isSelf={t.isSelf}
              muted={t.muted}
              cameraOff={t.cameraOff}
              connectionState={t.state} />
            
            <button
              type="button"
              onClick={() => setSizes((s) => ({ ...s, [t.id]: NEXT[size] }))}
              aria-label="Resize video"
              className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[0.6rem] font-bold text-white opacity-80 hover:bg-black/80 group-hover/tile:opacity-100">
              
              {size}
            </button>
          </div>);

      })}
    </div>);

}
