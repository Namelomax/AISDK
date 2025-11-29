'use client';

import { Pencil, Trash2 } from 'lucide-react';

type Conversation = {
  id: string;
  title?: string | null;
  created?: string | null;
  messages?: any[];
  [key: string]: any;
};

type SidebarProps = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (conversation: Conversation) => void;
  onNewLocal: () => void;
  onRename: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
};

export const Sidebar = ({
  conversations,
  activeId,
  onSelect,
  onNewLocal,
  onRename,
  onDelete,
}: SidebarProps) => {
  return (
    <div className="w-42 border-r flex flex-col shrink-0 bg-muted/10">
      <div className="p-2 flex items-center justify-between border-b">
        <span className="text-xs font-medium">Ваши чаты</span>
        <button onClick={onNewLocal} className="text-xs px-2 py-1 border rounded">
          Новый
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <ul className="text-sm">
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={`px-2 py-1 cursor-pointer border-b hover:bg-muted/30 ${
                conversation.id === activeId ? 'bg-muted/50 font-medium' : ''
              }`}
              onClick={() => onSelect(conversation)}
            >
              <div className="flex items-start gap-1" title={conversation.title || 'Чат'}>
                <span className="flex-1 truncate">{conversation.title || 'Чат'}</span>
                <div className="flex flex-col gap-1">
                  <button
                    className="shrink-0 p-0.5 rounded hover:bg-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRename(conversation);
                    }}
                    aria-label="Переименовать чат"
                  >
                    <Pencil className="w-3 h-3 opacity-70" />
                  </button>
                  <button
                    className="shrink-0 p-0.5 rounded hover:bg-muted/40 text-red-500"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(conversation);
                    }}
                    aria-label="Удалить чат"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="text-[10px] opacity-60 truncate">
                {conversation.created?.slice(0, 19)}
              </div>
            </li>
          ))}
          {conversations.length === 0 && (
            <li className="px-2 py-2 text-xs opacity-60">Нет сохранённых чатов</li>
          )}
        </ul>
      </div>
    </div>
  );
};
