import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { FileUIPart } from 'ai';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export async function convertBlobFilesToDataURLs(files: File[]): Promise<string[]> {
  const promises = files.map(
    (file) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })
  );
  return Promise.all(promises);
}

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export async function extractTextFromFileUIPart(file: FileUIPart): Promise<string> {
  const res = await fetch(file.url);
  const blob = await res.blob();
  const buffer = await blob.arrayBuffer();
  const mimeType = file.mediaType;

  try {
    // ----- DOCX -----
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value;
    }

    // ----- XLSX -----
    if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      const workbook = XLSX.read(buffer, { type: "array" });
      let text = "";

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        text += `\n--- Sheet: ${sheetName} ---\n`;
        text += XLSX.utils.sheet_to_txt(sheet);
      });

      return text;
    }

    // ----- Plain text -----
    if (mimeType.startsWith("text/")) {
      return await blob.text();
    }

    return "";
  } catch (e) {
    console.error("Error parsing file:", e);
    throw new Error(`Failed to parse ${file.url}`);
  }
}


export function isTextExtractable(mimeType: string): boolean {
  return [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'text/plain',
    'text/markdown',
    'text/csv',
  ].includes(mimeType);
}