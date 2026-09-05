// Toggle dispatch for emoji reactions — used by notification rows so one code
// path can react onto the message, announcement or task a notification points
// at, without the view caring which domain it is.
//
// Each branch delegates to its domain store (which calls the REST endpoint,
// patches its own cache and returns the fresh reaction list the server sent
// back). Null means the request failed.
import type { Reaction } from '../models';
import type { ReactionTarget } from './reactions';
import { useChatStore } from '../store/chatStore';
import { useAnnouncementStore } from '../store/announcementStore';
import { useTaskStore } from '../store/taskStore';

export const toggleTargetReaction = async (
  target: ReactionTarget,
  emoji: string,
  mine: boolean,
): Promise<Reaction[] | null> => {
  switch (target.kind) {
    case 'message':
      return useChatStore
        .getState()
        .toggleReaction(target.conversationId, target.messageId, emoji, mine);
    case 'announcement':
      return useAnnouncementStore
        .getState()
        .toggleReaction(target.announcementId, emoji, mine);
    case 'task':
      return useTaskStore.getState().toggleReaction(target.taskId, emoji, mine);
  }
};
