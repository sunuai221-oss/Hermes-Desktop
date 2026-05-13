import type { Message } from '../types';

type SetState<T> = (value: T | ((current: T) => T)) => void;

interface CreateMessageMutationsParams {
  setMessages: SetState<Message[]>;
}

export function createMessageMutations(params: CreateMessageMutationsParams) {
  const updateLastAssistantMessage = (updater: (message: Message) => Message) => {
    params.setMessages(current => {
      const copy = [...current];
      for (let index = copy.length - 1; index >= 0; index -= 1) {
        if (copy[index].role !== 'assistant') continue;
        copy[index] = updater(copy[index]);
        return copy;
      }
      return current;
    });
  };

  const updateMessageAtIndex = (index: number, updater: (message: Message) => Message) => {
    params.setMessages(current => {
      if (index < 0 || index >= current.length) return current;
      const copy = [...current];
      copy[index] = updater(copy[index]);
      return copy;
    });
  };

  return { updateLastAssistantMessage, updateMessageAtIndex };
}
