import { useState, useEffect } from 'react';
import { Copy, Edit, Trash2, Plus, Save, X } from 'lucide-react';
import type { Prompt } from '@/lib/db/config';

interface PromptManagerProps {
  userId: string;
  onSelectPrompt: (promptId: string) => void;
  currentPromptId?: string;
}

export function PromptManager({ userId, onSelectPrompt, currentPromptId }: PromptManagerProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', content: '' });
  const [isCreating, setIsCreating] = useState(false);

  // Загрузить промпты
  const fetchPrompts = async () => {
    try {
      const res = await fetch(`/api/prompts?userId=${userId}`);
      const data = await res.json();
      setPrompts(data);
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [userId]);

  // Создать новый промпт
  const handleCreate = async () => {
    if (!editForm.name || !editForm.content) return;

    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          name: editForm.name,
          content: editForm.content,
        }),
      });

      if (res.ok) {
        await fetchPrompts();
        setIsCreating(false);
        setEditForm({ name: '', content: '' });
      }
    } catch (error) {
      console.error('Failed to create prompt:', error);
    }
  };

  // Обновить промпт
  const handleUpdate = async (promptId: string) => {
    try {
      const res = await fetch('/api/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptId,
          userId,
          name: editForm.name,
          content: editForm.content,
        }),
      });

      if (res.ok) {
        await fetchPrompts();
        setEditingId(null);
        setEditForm({ name: '', content: '' });
      }
    } catch (error) {
      console.error('Failed to update prompt:', error);
    }
  };

  // Удалить промпт
  const handleDelete = async (promptId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот промпт?')) return;

    try {
      const res = await fetch(`/api/prompts?promptId=${promptId}&userId=${userId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchPrompts();
      }
    } catch (error) {
      console.error('Failed to delete prompt:', error);
    }
  };

  // Копировать промпт
  const handleCopy = async (promptId: string) => {
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt) return;

    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          name: `${prompt.name} (копия)`,
          copyFromId: promptId,
        }),
      });

      if (res.ok) {
        await fetchPrompts();
      }
    } catch (error) {
      console.error('Failed to copy prompt:', error);
    }
  };

  // Начать редактирование
  const startEdit = (prompt: Prompt) => {
    setEditingId(prompt.id!);
    setEditForm({ name: prompt.name, content: prompt.content });
  };

  if (isLoading) {
    return <div className="p-4 text-center">Загрузка...</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Системные промпты</h2>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Создать
        </button>
      </div>

      {/* Форма создания */}
      {isCreating && (
        <div className="bg-muted/50 rounded-lg border p-4 space-y-3">
          <input
            type="text"
            placeholder="Название промпта"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-md"
          />
          <textarea
            placeholder="Содержимое промпта"
            value={editForm.content}
            onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
            className="w-full px-3 py-2 border rounded-md min-h-[200px] font-mono text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
            >
              <Save className="size-4" />
              Сохранить
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setEditForm({ name: '', content: '' });
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700"
            >
              <X className="size-4" />
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Список промптов */}
      <div className="space-y-2">
        {prompts.map((prompt) => (
          <div
            key={prompt.id}
            className={`bg-background rounded-lg border p-3 ${
              currentPromptId === prompt.id ? 'ring-2 ring-primary' : ''
            }`}
          >
            {editingId === prompt.id ? (
              // Режим редактирования
              <div className="space-y-3">
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                />
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md min-h-[200px] font-mono text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(prompt.id!)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                  >
                    <Save className="size-4" />
                    Сохранить
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditForm({ name: '', content: '' });
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700"
                  >
                    <X className="size-4" />
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              // Режим просмотра
              <>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h3 className="font-medium flex items-center gap-2">
                      {prompt.name}
                      {prompt.isDefault && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                          По умолчанию
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {prompt.content}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onSelectPrompt(prompt.id!)}
                      className="p-1.5 hover:bg-muted rounded"
                      title="Использовать"
                    >
                      <span className="text-xs">✓</span>
                    </button>
                    <button
                      onClick={() => handleCopy(prompt.id!)}
                      className="p-1.5 hover:bg-muted rounded"
                      title="Копировать"
                    >
                      <Copy className="size-4" />
                    </button>
                    {!prompt.isDefault && (
                      <>
                        <button
                          onClick={() => startEdit(prompt)}
                          className="p-1.5 hover:bg-muted rounded"
                          title="Редактировать"
                        >
                          <Edit className="size-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(prompt.id!)}
                          className="p-1.5 hover:bg-red-100 text-red-600 rounded"
                          title="Удалить"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}