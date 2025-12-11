declare module 'pdf-parse' {
  export interface PDFParseResult {
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }

  const pdfParse: (data: Buffer | Uint8Array | ArrayBuffer, options?: Record<string, unknown>) => Promise<PDFParseResult>;
  export default pdfParse;
}
