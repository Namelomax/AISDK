export type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
};

export type ProcessDiagramState = {
  rawDrawioXml?: string | null;
  organization?: { name?: string | null; activity?: string | null };
  process?: { name?: string | null; description?: string | null };
  owner?: { fullName?: string | null; position?: string | null };
  goal?: string | null;
  product?: string | null;
  productDescription?: string | null;
  productRequirements?: string | null;
  productArtifacts?: string | null;
  consumers?: Array<
    | string
    | {
        kind?: 'person' | 'org' | 'group';
        name?: string | null;
        fullName?: string | null;
        position?: string | null;
      }
  >;
  boundaries?: { start?: string | null; end?: string | null };
  participants?: Array<{
    role?: string | null;
    name: string;
    fullName?: string | null;
  }>;
  graph?: {
    layout?: string;
    nodes?: Array<{
      id?: string | null;
      label: string;
      type?: 'start' | 'process' | 'decision' | 'end' | 'actor' | 'doc' | 'note' | 'user-process' | string;
      details?: string | null;
    }>;
    edges?: Array<{
      from: string;
      to: string;
      label?: string | null;
    }>;
  };
  updatedAt?: string;
};

export type Attachment = {
  id?: string;
  name?: string;
  filename?: string;
  url?: string;
  mediaType?: string;
  bytes?: number;
};
