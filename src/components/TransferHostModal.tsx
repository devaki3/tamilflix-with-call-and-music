import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CrownIcon, XIcon } from 'lucide-react';
import type { PartyMember } from '../types/movie';

interface TransferHostModalProps {
  open: boolean;
  members: PartyMember[];
  currentHostId: string;
  onClose: () => void;
  onConfirm: (memberId: string) => void;
}

const EASE = [0.23, 1, 0.32, 1] as const;

export function TransferHostModal({
  open,
  members,
  currentHostId,
  onClose,
  onConfirm
}: TransferHostModalProps) {
  const candidates = members.filter((m) => m.userId !== currentHostId);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <AnimatePresence>
      {open &&
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[95] grid place-items-center bg-black/70 px-4 backdrop-blur-sm"
        onClick={onClose}>
        
          <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: EASE }}
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-sm rounded-3xl border border-rose-400/15 bg-ink-800/95 p-6 shadow-cherry backdrop-blur-xl">
          
            <div className="flex items-start justify-between">
              <h2 className="flex items-center gap-2 font-display text-2xl text-white">
                <CrownIcon className="h-5 w-5 text-rose-300" />
                Transfer Host
              </h2>
              <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:text-rose-200">
              
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {candidates.length === 0 ?
          <p className="mt-4 text-sm text-muted">No other members to transfer host to yet.</p> :

          <>
                <p className="mt-2 text-sm text-muted">Select a new host</p>
                <ul className="mt-4 space-y-2">
                  {candidates.map((member) =>
              <li key={member.userId}>
                      <button
                  type="button"
                  onClick={() => setSelected(member.userId)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  selected === member.userId ?
                  'border-rose-400/70 bg-rose-400/10 text-white' :
                  'border-white/[0.08] bg-white/[0.03] text-white/85 hover:border-rose-400/30'}`
                  }>
                  
                        <span
                    className={`grid h-4 w-4 place-items-center rounded-full border ${
                    selected === member.userId ? 'border-rose-400 bg-rose-400' : 'border-white/30'}`
                    } />
                  
                        {member.username}
                      </button>
                    </li>
              )}
                </ul>
                <button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (selected) {
                  onConfirm(selected);
                  onClose();
                  setSelected(null);
                }
              }}
              className="mt-6 w-full rounded-full bg-cherry-700 px-6 py-2.5 text-sm font-bold text-white shadow-cherry transition-[background-color,opacity] duration-200 ease-cine hover:bg-rose-400 hover:text-ink disabled:opacity-40">
              
                  Confirm Transfer
                </button>
              </>
          }
          </motion.div>
        </motion.div>
      }
    </AnimatePresence>);

}
