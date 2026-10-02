import React, { useState } from 'react';
import { CrownIcon, UserMinusIcon, UsersIcon } from 'lucide-react';
import { TransferHostModal } from './TransferHostModal';
import type { PartyMember } from '../types/movie';

interface RoomMembersPanelProps {
  members: PartyMember[];
  currentUserId: string;
  hostId: string;
  isHost: boolean;
  onTransferHost: (memberId: string) => void;
  onRemoveMember: (memberId: string) => void;
}

export function RoomMembersPanel({
  members,
  currentUserId,
  hostId,
  isHost,
  onTransferHost,
  onRemoveMember
}: RoomMembersPanelProps) {
  const [transferOpen, setTransferOpen] = useState(false);

  return (
    <section
      aria-label="Members"
      className="rounded-3xl border border-rose-400/10 bg-ink-800/70 p-5 backdrop-blur-xl">
      
      <h2 className="flex items-center justify-between font-display text-xl tracking-wide text-white">
        <span className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-rose-300" />
          In the room
        </span>
        <span className="text-sm text-muted">{members.length}</span>
      </h2>

      <ul className="mt-4 space-y-2">
        {members.map((member) => {
          const isThisHost = member.userId === hostId;
          return (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/85">
              
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cherry-800 text-xs uppercase">
                {member.username.charAt(0)}
              </span>
              <span className="truncate">
                {member.username}
                {member.userId === currentUserId && ' (you)'}
              </span>
              {isThisHost && <CrownIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-rose-300" />}
              {isHost && !isThisHost &&
              <button
                type="button"
                onClick={() => onRemoveMember(member.userId)}
                aria-label={`Remove ${member.username}`}
                className={`${isThisHost ? '' : 'ml-auto'} grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:text-rose-200`}>
                
                  <UserMinusIcon className="h-3.5 w-3.5" />
                </button>
              }
            </li>);

        })}
      </ul>

      {isHost && members.length > 1 &&
      <button
        type="button"
        onClick={() => setTransferOpen(true)}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
        
          <CrownIcon className="h-3.5 w-3.5" />
          Transfer Host
        </button>
      }

      <TransferHostModal
        open={transferOpen}
        members={members}
        currentHostId={hostId}
        onClose={() => setTransferOpen(false)}
        onConfirm={onTransferHost} />
      
    </section>);

}
