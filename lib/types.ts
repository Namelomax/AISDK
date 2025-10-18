// lib/ai/types.ts
import type { UIMessage } from 'ai';

export type Document = {
  title: string;
  content: string;
};

export type ChatUIMessage = UIMessage & {
};

export type DocumentDataEvent = 
  | {
      type: 'data-title';
      data: string;
      transient: true;
    }
  | {
      type: 'data-clear';
      data: null;
      transient: true;
    }
  | {
      type: 'data-documentDelta';
      data: string;
      transient: true;
    }
  | {
      type: 'data-finish';
      data: null;
      transient: true;
    };

export type SerpResult = {
  title: string;
  link: string;
  snippet: string;
};

export type SerpOutput = {
  query: string;
  results: SerpResult[];
};