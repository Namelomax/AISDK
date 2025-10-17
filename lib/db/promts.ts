import { BaseRepository } from "./base";

export interface Prompt {
  id: string;
  title: string;
  content: string;
  time: {
    created: string;
    updated: string;
  };
  isDefault?: boolean;
  userId?: string; // Добавляем userId для мультиюзерности
  [key: string]: unknown;
}

export class PromptsRepository extends BaseRepository<Prompt> {
  constructor() {
    super("prompt");
  }

  /**
   * Get all prompts (optionally filtered by userId)
   */
  async getPrompts(userId?: string): Promise<Prompt[]> {
    try {
      const allPrompts = await this.findAll();
      
      if (!userId) {
        // Если нет userId, возвращаем только дефолтный
        return allPrompts.filter(p => p.isDefault === true);
      }
      
      // Возвращаем дефолтный + промпты пользователя
      return allPrompts.filter(p => 
        p.isDefault === true || p.userId === userId
      );
    } catch (error) {
      console.error("Failed to get prompts:", error);
      return [];
    }
  }

  /**
   * Get user prompts only (without default)
   */
  async getUserPrompts(userId: string): Promise<Prompt[]> {
    try {
      const allPrompts = await this.findAll();
      return allPrompts.filter(p => p.userId === userId);
    } catch (error) {
      console.error("Failed to get user prompts:", error);
      return [];
    }
  }

  /**
   * Create new prompt
   */
  async createPrompt(promptData: Omit<Prompt, "id" | "time">): Promise<Prompt> {
    return this.create(promptData);
  }

  /**
   * Update existing prompt (only if not default and user owns it)
   */
  async updatePrompt(
    id: string,
    updates: Partial<Omit<Prompt, "id" | "time">>,
    userId?: string,
  ): Promise<Prompt> {
    // Проверяем права доступа
    const prompt = await this.findById(id);
    
    if (!prompt) {
      throw new Error("Prompt not found");
    }
    
    if (prompt.isDefault) {
      throw new Error("Cannot edit default prompt");
    }
    
    if (userId && prompt.userId !== userId) {
      throw new Error("Access denied: You can only edit your own prompts");
    }
    
    return this.update(id, updates);
  }

  /**
   * Delete prompt (only if not default and user owns it)
   */
  async deletePrompt(id: string, userId?: string): Promise<void> {
    const prompt = await this.findById(id);
    
    if (!prompt) {
      throw new Error("Prompt not found");
    }
    
    if (prompt.isDefault) {
      throw new Error("Cannot delete default prompt");
    }
    
    if (userId && prompt.userId !== userId) {
      throw new Error("Access denied: You can only delete your own prompts");
    }
    
    return this.delete(id);
  }

  /**
   * Get prompt by ID
   */
  async getPromptById(id: string): Promise<Prompt | null> {
    return this.findById(id);
  }

  /**
   * Check if prompt is default
   */
  async isDefaultPrompt(id: string): Promise<boolean> {
    const prompt = await this.findById(id);
    return prompt?.isDefault === true;
  }

  /**
   * Get default prompt
   */
  async getDefaultPrompt(): Promise<Prompt | null> {
    try {
      const prompts = await this.findAll();
      return prompts.find((prompt) => prompt.isDefault === true) || null;
    } catch (error) {
      console.error("Failed to get default prompt:", error);
      return null;
    }
  }

  /**
   * Create prompt copy
   */
  async copyPrompt(
    sourceId: string, 
    userId: string, 
    title?: string
  ): Promise<Prompt | null> {
    const sourcePrompt = await this.findById(sourceId);
    
    if (!sourcePrompt) {
      throw new Error("Source prompt not found");
    }
    
    const copyTitle = title || `${sourcePrompt.title} (копия)`;
    
    return this.create({
      title: copyTitle,
      content: sourcePrompt.content,
      isDefault: false,
      userId,
    });
  }

  /**
   * Check if prompt can be modified (not default)
   */
  async canModify(id: string): Promise<boolean> {
    const isDefault = await this.isDefaultPrompt(id);
    return !isDefault;
  }

  /**
   * Check if prompt can be deleted (not default)
   */
  async canDelete(id: string): Promise<boolean> {
    return this.canModify(id);
  }
}

// Export singleton instance
export const promptsRepository = new PromptsRepository();