'use client';

import { useState, useEffect } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PlusIcon, PencilIcon, Trash2Icon } from 'lucide-react';

type Prompt = {
  id: string;
  title: string;
  content: string;
  isDefault: boolean;
};

export function PromptsManager({ 
  className, 
  onPromptSelect 
}: { 
  className?: string;
  onPromptSelect: (content: string) => void;
}) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    loadPrompts();
  }, []);

const loadPrompts = async () => {
  try {
    const res = await fetch('/api/promts');
    const data = await res.json();
    
    console.log('Received prompts:', data); // Для отладки
    
    if (Array.isArray(data)) {
      setPrompts(data);
      if (data.length > 0) {
        setSelectedId(data[0].id);
        onPromptSelect(data[0].content);
      }
    } else {
      console.error('Expected array but got:', typeof data);
      setPrompts([]);
    }
  } catch (error) {
    console.error('Failed to load prompts:', error);
    setPrompts([]);
  }
};

const handleSelect = async (id: string) => {
  setSelectedId(id);
  const prompt = prompts.find(p => p.id === id);
  if (!prompt) return;

  try {
    // 🔥 Отправляем новый systemPrompt сразу в API
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [],
        newSystemPrompt: prompt.content,
      }),
    });

    if (!res.ok) throw new Error('Failed to update system prompt');
    console.log(`✅ System prompt updated to: ${prompt.title}`);
  } catch (err) {
    console.error('Failed to send prompt to /api/chat:', err);
  }
};


  const openNew = () => {
    setEditingPrompt(null);
    setTitle('');
    setContent('');
    setDialogOpen(true);
  };

  const openEdit = () => {
    const prompt = prompts.find(p => p.id === selectedId);
    if (!prompt || prompt.isDefault) return;
    setEditingPrompt(prompt);
    setTitle(prompt.title);
    setContent(prompt.content);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) return;

    if (editingPrompt) {
      await fetch('/api/promts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingPrompt.id, title, content }),
      });
    } else {
      await fetch('/api/promts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
    }

    setDialogOpen(false);
    loadPrompts();
  };

  const deletePrompt = async () => {
    const prompt = prompts.find(p => p.id === selectedId);
    if (!prompt || prompt.isDefault) return;
    
    if (confirm(`Удалить промпт "${prompt.title}"?`)) {
      await fetch('/api/promts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId }),
      });
      loadPrompts();
    }
  };

  const selectedPrompt = prompts.find(p => p.id === selectedId);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Select value={selectedId} onValueChange={handleSelect}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Выберите промпт..." />
        </SelectTrigger>
        <SelectContent>
          {prompts.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="outline" size="icon" onClick={openNew}>
        <PlusIcon className="size-4" />
      </Button>

      <Button 
        variant="outline" 
        size="icon" 
        onClick={openEdit}
        disabled={!selectedPrompt || selectedPrompt.isDefault}
      >
        <PencilIcon className="size-4" />
      </Button>

      <Button 
        variant="outline" 
        size="icon" 
        onClick={deletePrompt}
        disabled={!selectedPrompt || selectedPrompt.isDefault}
      >
        <Trash2Icon className="size-4" />
      </Button>

      {dialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-lg w-[600px]">
            <h2 className="text-lg font-semibold mb-4">
              {editingPrompt ? 'Редактировать промпт' : 'Новый промпт'}
            </h2>
            <input
              className="w-full p-2 mb-3 border rounded"
              placeholder="Название промпта"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <textarea
              className="w-full p-2 mb-3 border rounded resize-none"
              rows={8}
              placeholder="Содержание промпта"
              value={content}
              onChange={e => setContent(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={save}>Сохранить</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}